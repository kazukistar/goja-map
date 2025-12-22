// ================================
// ごじゃ地図 app.js
// 変更点（重要）
// - 「重心を計算」でおすすめ検索を内部で開始（プリフェッチ）
// - おすすめ表示は「重心付近の観光地を表示」を押した時だけ
// - 「計算中…」を最低4秒表示（検索が速くても4秒は出す）
// ※ UI(HTML/CSS)は一切変更しない：既存のID/ボタン/レイアウトに合わせる
// ================================

// ================================
// Leaflet 初期化
// ================================
const map = L.map("map").setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// ================================
// DOM 参照（UI変更しないためID固定）
// ================================
const elPinList = document.getElementById("pinList");
const elResult = document.getElementById("result");

const btnCalc = document.getElementById("btnCalc");
const btnClear = document.getElementById("btnClear");
const btnRecommend = document.getElementById("btnRecommend");

const radiusSlider = document.getElementById("radiusSlider");
const radiusValue = document.getElementById("radiusValue");

// ================================
// 状態
// ================================
let points = [];
let nextPointId = 1;

let centroidMarkers = [];
let lastCentroids = null; // { weighted:{lat,lon}, unweighted:{lat,lon} }

// おすすめ（プリフェッチ）管理
let rec = {
  status: "idle", // idle | fetching | ready | error
  radiusKm: 30,
  weighted: null, // {lat, lon}
  promise: null,
  html: "",
  errorMsg: "",
  pendingDisplay: false, // 表示ボタンを先に押した場合、準備でき次第表示する
  lastFetchStartedAt: 0, // performance.now
  lastFetchDoneAt: 0,
};

// 「計算中…」を最低この時間表示（要件：4秒）
const MIN_CALC_DISPLAY_MS = 4000;

// ================================
// Overpass（OSM）設定
// ================================
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// カテゴリごとの最大表示数
const POI_LIMIT_EACH = 6;

// ================================
// 小道具：距離計算（Haversine km）
// ================================
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ================================
// 球面重心（重みなし）
// ================================
function centroidUnweighted(pts) {
  let x = 0,
    y = 0,
    z = 0;
  const n = pts.length;

  pts.forEach((p) => {
    const lat = (p.lat * Math.PI) / 180;
    const lon = (p.lon * Math.PI) / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  });

  x /= n;
  y /= n;
  z /= n;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

// ================================
// 球面重心（重み付き：人数）
// ================================
function centroidWeighted(pts) {
  let x = 0,
    y = 0,
    z = 0;
  let total = 0;

  pts.forEach((p) => {
    const lat = (p.lat * Math.PI) / 180;
    const lon = (p.lon * Math.PI) / 180;
    const w = p.count;

    x += w * Math.cos(lat) * Math.cos(lon);
    y += w * Math.cos(lat) * Math.sin(lon);
    z += w * Math.sin(lat);
    total += w;
  });

  x /= total;
  y /= total;
  z /= total;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

// ================================
// マーカー（ピン/重心）管理
// ================================
function clearCentroidMarkers() {
  centroidMarkers.forEach((m) => map.removeLayer(m));
  centroidMarkers = [];
}

function makeIcon(url) {
  return L.icon({
    iconUrl: url,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

const ICON_RED = makeIcon("https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png");
const ICON_GREEN = makeIcon("https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png");

// ================================
// ピン一覧 UI（UIは変えない：result/pinList の中身だけ更新）
// ================================
function renderPinList() {
  if (!elPinList) return;

  if (points.length === 0) {
    elPinList.innerHTML = `<div class="muted">地図をタップしてピンを追加</div>`;
    return;
  }

  const rows = points
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((p) => {
      const lat = p.lat.toFixed(5);
      const lon = p.lon.toFixed(5);
      return `
        <div class="pinRow">
          <div class="pinMeta">
            <div><b>#${p.id}</b>　${p.count}人</div>
            <div class="muted">${lat}, ${lon}</div>
          </div>
          <button class="btn small" data-del="${p.id}">削除</button>
        </div>
      `;
    })
    .join("");

  elPinList.innerHTML = rows;

  // 削除ボタン（イベント委譲）
  elPinList.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.getAttribute("data-del"), 10);
      deletePointById(id);
    });
  });
}

function deletePointById(id) {
  const idx = points.findIndex((p) => p.id === id);
  if (idx === -1) return;

  map.removeLayer(points[idx].marker);
  points.splice(idx, 1);

  renderPinList();

  // 重心結果は古くなるのでクリア
  clearCentroidMarkers();
  lastCentroids = null;

  // おすすめプリフェッチもクリア
  resetRecommendationState(true);

  // 結果欄
  if (elResult) {
    elResult.innerHTML = `<div class="muted">まずはピンを置いて「重心を計算」</div>`;
  }

  // 表示ボタンは無効
  if (btnRecommend) btnRecommend.disabled = true;
}

function clearAllPoints() {
  points.forEach((p) => map.removeLayer(p.marker));
  points = [];
  nextPointId = 1;

  renderPinList();
  clearCentroidMarkers();
  lastCentroids = null;
  resetRecommendationState(true);

  if (elResult) {
    elResult.innerHTML = `<div class="muted">まずはピンを置いて「重心を計算」</div>`;
  }

  if (btnRecommend) btnRecommend.disabled = true;
}

// ================================
// 地図クリック → ピン追加
// ================================
map.on("click", (e) => {
  const input = prompt("この地点には何人いますか？");
  if (input === null) return;

  if (input.trim() === "" || isNaN(input)) {
    alert("数字を入力してください");
    return;
  }

  const count = parseInt(input, 10);
  if (!Number.isFinite(count) || count <= 0) {
    alert("1以上の人数を入力してください");
    return;
  }

  const id = nextPointId++;

  const marker = L.marker(e.latlng).addTo(map);

  const p = {
    id,
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    count,
    marker,
  };
  points.push(p);

  marker.bindPopup(`人数：${count}人<br>（ピン一覧から削除できます）`);

  renderPinList();

  // 既存の重心/おすすめは古くなる
  clearCentroidMarkers();
  lastCentroids = null;
  resetRecommendationState(true);

  if (elResult) {
    elResult.innerHTML = `<div class="muted">ピンを追加しました。「重心を計算」を押してください</div>`;
  }

  if (btnRecommend) btnRecommend.disabled = true;
});

// ================================
// result欄の基本表示（おすすめは出さない）
// ================================
function renderCentroidBaseResult(weighted, unweighted) {
  const gW = `https://www.google.com/maps?q=${weighted.lat},${weighted.lon}`;
  const gU = `https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}`;

  // おすすめ表示枠はここに必ず確保（UI変更無し：result欄だけ）
  // ※ 実際のおすすめ一覧は btnRecommend 押下時に差し込む
  const html = `
    <div>
      <b>🔴 重み付き重心（人数考慮）</b><br>
      緯度：${weighted.lat.toFixed(5)} / 経度：${weighted.lon.toFixed(5)}<br>
      <a href="${gW}" target="_blank" rel="noopener">Googleマップで開く</a>
    </div>
    <br>
    <div>
      <b>🟢 重みなし重心（乗り合い前提）</b><br>
      緯度：${unweighted.lat.toFixed(5)} / 経度：${unweighted.lon.toFixed(5)}<br>
      <a href="${gU}" target="_blank" rel="noopener">Googleマップで開く</a>
    </div>
    <br>
    <div id="recArea">
      <b>⭐ おすすめ</b><br>
      <div id="recStatus" class="muted">「重心付近の観光地を表示」を押すと表示します</div>
      <div id="recContent"></div>
    </div>
  `;

  if (elResult) elResult.innerHTML = html;
}

// ================================
// おすすめ状態の初期化
// ================================
function resetRecommendationState(keepRadius) {
  rec.status = "idle";
  rec.weighted = null;
  rec.promise = null;
  rec.html = "";
  rec.errorMsg = "";
  rec.pendingDisplay = false;
  rec.lastFetchStartedAt = 0;
  rec.lastFetchDoneAt = 0;

  if (!keepRadius) rec.radiusKm = 30;

  // result欄のおすすめ枠が存在するなら、表示を戻す（一覧は消す）
  const st = document.getElementById("recStatus");
  const cont = document.getElementById("recContent");
  if (st) st.textContent = `「重心付近の観光地を表示」を押すと表示します`;
  if (cont) cont.innerHTML = "";
}

// ================================
// Overpass クエリ生成
// ================================
function buildOverpassQuery(lat, lon, radiusM) {
  // out center で way/relation も中心座標を得る
  return `
[out:json][timeout:25];
(
  nwr(around:${radiusM},${lat},${lon})["amenity"="public_bath"];
  nwr(around:${radiusM},${lat},${lon})["bath:type"="onsen"];
  nwr(around:${radiusM},${lat},${lon})["bath:type"="hot_spring"];
  nwr(around:${radiusM},${lat},${lon})["natural"="hot_spring"];

  nwr(around:${radiusM},${lat},${lon})["historic"];
  nwr(around:${radiusM},${lat},${lon})["tourism"="attraction"];

  nwr(around:${radiusM},${lat},${lon})["tourism"="theme_park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="water_park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="sports_centre"];

  nwr(around:${radiusM},${lat},${lon})["landuse"="winter_sports"];
  relation(around:${radiusM},${lat},${lon})["site"="piste"];
  nwr(around:${radiusM},${lat},${lon})["piste:type"];
);
out tags center 250;
`;
}

async function overpassFetch(query) {
  const body = "data=" + encodeURIComponent(query);
  let lastErr = null;

  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Overpass fetch failed");
}

function elementLatLon(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number")
    return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function categorizeOsm(tags = {}) {
  // 温泉
  if (
    tags["amenity"] === "public_bath" ||
    tags["bath:type"] === "onsen" ||
    tags["bath:type"] === "hot_spring" ||
    tags["natural"] === "hot_spring"
  ) return "♨ 温泉";

  // スキー
  if (tags["landuse"] === "winter_sports" || tags["site"] === "piste" || tags["piste:type"])
    return "🎿 スキー場";

  // 歴史
  if (tags["historic"] || tags["tourism"] === "attraction") return "🏯 歴史的観光地";

  // レジャー
  if (
    tags["tourism"] === "theme_park" ||
    tags["leisure"] === "water_park" ||
    tags["leisure"] === "park" ||
    tags["leisure"] === "sports_centre"
  ) return "🎡 レジャー施設";

  return null;
}

async function buildRecommendationsHtml(lat, lon, radiusKm) {
  const radiusM = Math.max(0, Math.round(radiusKm * 1000));

  if (radiusM <= 0) {
    return `<div class="muted">検索半径が0 kmのため、おすすめは表示できません。</div>`;
  }

  const query = buildOverpassQuery(lat, lon, radiusM);
  const data = await overpassFetch(query);

  const seen = new Set();
  const items = [];

  for (const el of data.elements || []) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ll = elementLatLon(el);
    if (!ll) continue;

    const cat = categorizeOsm(el.tags || {});
    if (!cat) continue;

    const name = el.tags && el.tags.name ? el.tags.name : "(名前なし)";
    const dist = haversineKm(lat, lon, ll.lat, ll.lon);

    items.push({
      cat,
      name,
      lat: ll.lat,
      lon: ll.lon,
      distKm: dist,
    });
  }

  const order = ["♨ 温泉", "🏯 歴史的観光地", "🎡 レジャー施設", "🎿 スキー場"];

  // カテゴリ別・距離順
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  for (const [k, arr] of byCat.entries()) {
    arr.sort((a, b) => a.distKm - b.distKm);
    byCat.set(k, arr.slice(0, POI_LIMIT_EACH));
  }

  let html = `<div><b>⭐ おすすめ（半径 ${radiusKm} km）</b></div>`;
  html += `<div style="font-size:13px; line-height:1.5;">`;

  let any = false;
  for (const cat of order) {
    const arr = byCat.get(cat) || [];
    html += `<b>${cat}</b><ul>`;
    if (arr.length === 0) {
      html += `<li class="muted">近くに見つからない（OSM未登録の可能性あり）</li>`;
    } else {
      any = true;
      for (const it of arr) {
        const g = `https://www.google.com/maps?q=${it.lat},${it.lon}`;
        html += `<li><a href="${g}" target="_blank" rel="noopener">${it.name}</a>（約${it.distKm.toFixed(
          1
        )} km）</li>`;
      }
    }
    html += `</ul>`;
  }

  if (!any) {
    html += `<div class="muted">おすすめが少ない場所です（OSM登録が少ない可能性）。</div>`;
  }

  html += `</div>`;
  return html;
}

// ================================
// 「計算中…」を最低4秒表示（おすすめは出さない）
// ================================
function showCalcStatusForAtLeast4s() {
  const st = document.getElementById("recStatus");
  const cont = document.getElementById("recContent");

  if (cont) cont.innerHTML = ""; // 一覧は消す（表示は押すまで出さない）
  if (st) st.textContent = "計算中…（おすすめを準備しています）";

  const startedAt = performance.now();

  // 4秒経過後に、状況に応じたメッセージへ戻す
  setTimeout(() => {
    const elapsed = performance.now() - startedAt;
    if (elapsed < MIN_CALC_DISPLAY_MS) return; // 念のため

    // ここでおすすめを表示しない（要件）
    const st2 = document.getElementById("recStatus");
    if (!st2) return;

    if (rec.status === "ready") {
      st2.textContent = "準備完了。「重心付近の観光地を表示」を押してください";
    } else if (rec.status === "error") {
      st2.textContent = "取得に失敗しました。「重心付近の観光地を表示」を押して再試行できます";
    } else {
      // fetching のまま（Overpass混雑など）
      st2.textContent = "まだ計算中です…（準備でき次第、表示ボタンで即表示できます）";
    }
  }, MIN_CALC_DISPLAY_MS);
}

// ================================
// おすすめプリフェッチ開始（重心計算時点で内部開始）
// ================================
function startPrefetchRecommendations(weighted, radiusKm) {
  rec.status = "fetching";
  rec.weighted = weighted;
  rec.radiusKm = radiusKm;
  rec.html = "";
  rec.errorMsg = "";
  rec.lastFetchStartedAt = performance.now();
  rec.lastFetchDoneAt = 0;

  // ボタンは押せる（ただし表示はreadyになるまで待機）
  if (btnRecommend) btnRecommend.disabled = false;

  const p = (async () => {
    try {
      const html = await buildRecommendationsHtml(weighted.lat, weighted.lon, radiusKm);
      rec.html = html;
      rec.status = "ready";
      rec.lastFetchDoneAt = performance.now();
      return html;
    } catch (e) {
      rec.status = "error";
      rec.errorMsg = String(e && e.message ? e.message : e);
      rec.lastFetchDoneAt = performance.now();
      throw e;
    }
  })();

  rec.promise = p;

  // もし「表示」を先に押して待機中なら、準備でき次第その場で表示
  p.then(() => {
    if (rec.pendingDisplay) {
      rec.pendingDisplay = false;
      renderRecommendationsNow(); // ここで初めて一覧を表示
    } else {
      // 4秒表示後に「準備完了」にしたいので、ここではUIを弄らない
      // （showCalcStatusForAtLeast4s側が最終文言を出す）
    }
  }).catch(() => {
    if (rec.pendingDisplay) {
      rec.pendingDisplay = false;
      renderRecommendationsNow(); // エラー文を出す（一覧は出ない）
    }
  });
}

// ================================
// おすすめを「今」表示（表示ボタン押下時）
// ================================
function renderRecommendationsNow() {
  const st = document.getElementById("recStatus");
  const cont = document.getElementById("recContent");

  if (!st || !cont) return;

  if (!lastCentroids || !rec.weighted) {
    st.textContent = "先に「重心を計算」を押してください";
    cont.innerHTML = "";
    return;
  }

  // readyなら即表示
  if (rec.status === "ready") {
    st.textContent = "";
    cont.innerHTML = rec.html || "";
    return;
  }

  // errorならエラーを表示（再試行は次のcalc or スライダー変更でプリフェッチ再開）
  if (rec.status === "error") {
    st.textContent = "取得に失敗しました（回線/混雑の可能性）。もう一度「重心を計算」して再試行してください";
    cont.innerHTML = "";
    return;
  }

  // fetching中：まだ準備できてない
  // 要件：押したら即結果が出るように → 基本はプリフェッチで間に合う想定
  // ただ混雑時だけは「準備でき次第表示」へ切り替える
  rec.pendingDisplay = true;
  st.textContent = "準備中…（完了し次第ここに表示します）";
  cont.innerHTML = "";
}

// ================================
// 重心計算（メイン）
// ================================
function calculateCentroidMain() {
  if (points.length === 0) {
    alert("地点が登録されていません");
    return;
  }

  // 重心計算
  const weighted = centroidWeighted(points);
  const unweighted = centroidUnweighted(points);

  lastCentroids = { weighted, unweighted };

  // 重心マーカー描画（既存UI変更しない）
  clearCentroidMarkers();

  const weightedMarker = L.marker([weighted.lat, weighted.lon], { icon: ICON_RED })
    .addTo(map)
    .bindPopup("🔴 重み付き重心（人数考慮）");

  const unweightedMarker = L.marker([unweighted.lat, unweighted.lon], { icon: ICON_GREEN })
    .addTo(map)
    .bindPopup("🟢 重みなし重心（乗り合い前提）");

  centroidMarkers.push(weightedMarker, unweightedMarker);

  map.setView([weighted.lat, weighted.lon], 7);

  // 結果欄：おすすめは出さない（枠＋ステータスだけ）
  renderCentroidBaseResult(weighted, unweighted);

  // 表示ボタンは有効化（ただし押すまで一覧は出さない）
  if (btnRecommend) btnRecommend.disabled = false;

  // ここで「計算中…」を4秒表示（おすすめは出さない）
  showCalcStatusForAtLeast4s();

  // ここで内部プリフェッチ開始
  const radiusKm = parseInt(radiusValue ? radiusValue.textContent : "30", 10) || 30;
  startPrefetchRecommendations(weighted, radiusKm);
}

// ================================
// 半径スライダー
// ================================
function initRadiusSlider() {
  if (!radiusSlider || !radiusValue) return;

  const apply = () => {
    const v = parseInt(radiusSlider.value, 10);
    radiusValue.textContent = String(v);

    // 重心が既にあるなら、半径変更＝おすすめ再プリフェッチ（ただし表示は押すまで出さない）
    if (lastCentroids && lastCentroids.weighted) {
      resetRecommendationState(true);

      // 「計算中…」を4秒表示（再計算扱い）
      showCalcStatusForAtLeast4s();

      // 内部で即プリフェッチ
      startPrefetchRecommendations(lastCentroids.weighted, v);
    }
  };

  radiusSlider.addEventListener("input", apply);
  // 初期反映
  apply();
}

// ================================
// ボタン配線（UIは変えない）
// ================================
if (btnCalc) btnCalc.addEventListener("click", calculateCentroidMain);
if (btnClear) btnClear.addEventListener("click", clearAllPoints);
if (btnRecommend) btnRecommend.addEventListener("click", renderRecommendationsNow);

// 初期状態：おすすめは重心計算まで無効
if (btnRecommend) btnRecommend.disabled = true;

// 初期描画
renderPinList();
initRadiusSlider();
