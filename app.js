// ================================
// ごじゃ地図：おすすめは「result欄」に表示する版
// - ポップアップ肥大化しない
// - 「おすすめを表示」ボタン押下で取得
// - 半径スライダー（0〜100km）対応
// ================================

// --------------------
// 地図初期化
// --------------------
const map = L.map("map").setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

// --------------------
// UI（スライダー）
// --------------------
const radiusSlider = document.getElementById("radiusSlider");
const radiusValue = document.getElementById("radiusValue");
const resultEl = document.getElementById("result");

let poiRadiusKm = Number(radiusSlider?.value ?? 30);
if (radiusValue) radiusValue.textContent = String(poiRadiusKm);

radiusSlider?.addEventListener("input", () => {
  poiRadiusKm = Number(radiusSlider.value);
  if (radiusValue) radiusValue.textContent = String(poiRadiusKm);

  // 半径が変わったら、過去のおすすめキャッシュは無効化（再取得させる）
  lastRecommendationsHtml = "";

  // 「重心は出てる」状態なら、result欄の表示だけ更新（おすすめは未表示状態に戻す）
  if (lastCentroid) {
    renderResult({
      weighted: lastCentroid,
      unweighted: lastUnweightedCentroid,
      message: `おすすめ半径を ${poiRadiusKm}km に変更。必要なら「おすすめを表示」を押して再取得して。`,
      showRecoButton: true
    });
  }
});

// --------------------
// ピン管理
// --------------------
let points = [];
let nextPointId = 1;

let centroidMarkers = [];
let lastCentroid = null;            // 🔴重み付き重心 {lat, lon}
let lastUnweightedCentroid = null;  // 🟢重みなし重心 {lat, lon}
let lastRecommendationsHtml = "";   // result欄に出すおすすめHTML（半径変更でクリア）
let lastRecoStatus = "none";        // "none" | "loading" | "ready"

// --------------------
// Overpass（OSM）設定
// --------------------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

const POI_LIMIT_EACH = 5; // カテゴリ毎の最大表示

// --------------------
// 地図クリック → ピン追加
// --------------------
map.on("click", function (e) {
  const input = prompt("この地点には何人いますか？（数字）", "1");
  if (input === null) return;

  const count = Number(input);
  if (!Number.isFinite(count) || count <= 0) {
    alert("人数は1以上の数字にして。");
    return;
  }

  const id = nextPointId++;
  const marker = L.marker(e.latlng).addTo(map);

  const p = {
    id,
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    count: Math.floor(count),
    marker
  };
  points.push(p);

  marker.bindPopup(`人数：${p.count}人<br><small>ピンをクリック → 確認で削除</small>`);

  marker.on("click", () => {
    const ok = confirm("このピンを削除しますか？");
    if (!ok) return;

    map.removeLayer(marker);
    points = points.filter(x => x.id !== id);
    clearCentroids();
  });

  marker.openPopup();
});

// --------------------
// 重心マーカー削除
// --------------------
function clearCentroids() {
  centroidMarkers.forEach(m => map.removeLayer(m));
  centroidMarkers = [];
  lastCentroid = null;
  lastUnweightedCentroid = null;
  lastRecommendationsHtml = "";
  lastRecoStatus = "none";
  resultEl.innerHTML = "";
}

// --------------------
// 距離（km）：Haversine
// --------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// --------------------
// 球面重心（重みなし：地点数で平均＝乗り合い想定）
// --------------------
function centroidUnweighted(pts) {
  let x = 0, y = 0, z = 0;
  const n = pts.length;

  pts.forEach(p => {
    const lat = p.lat * Math.PI / 180;
    const lon = p.lon * Math.PI / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  });

  x /= n; y /= n; z /= n;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// --------------------
// 球面重心（重みあり：人数考慮＝各自バラバラ想定）
// --------------------
function centroidWeighted(pts) {
  let x = 0, y = 0, z = 0;
  let total = 0;

  pts.forEach(p => {
    const lat = p.lat * Math.PI / 180;
    const lon = p.lon * Math.PI / 180;
    const w = p.count;

    x += w * Math.cos(lat) * Math.cos(lon);
    y += w * Math.cos(lat) * Math.sin(lon);
    z += w * Math.sin(lat);
    total += w;
  });

  x /= total; y /= total; z /= total;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// --------------------
// Googleマップ検索リンク（保険）
// --------------------
function generateGoogleSearchLinks(lat, lon) {
  const zoom = 11;
  const categories = [
    { name: "♨ 温泉（Googleで探す）", query: "温泉" },
    { name: "🏯 歴史（Googleで探す）", query: "史跡 OR 城 OR 寺 OR 神社" },
    { name: "🎡 レジャー（Googleで探す）", query: "テーマパーク OR レジャー施設" },
    { name: "🎿 スキー場（Googleで探す）", query: "スキー場" },
    { name: "🍽 グルメ（Googleで探す）", query: "ご当地グルメ OR 名物 OR 郷土料理 OR 飲食店" },
    { name: "🌃 繁華街（Googleで探す）", query: "繁華街 OR 飲み屋街" },
    { name: "🏨 宿（Googleで探す）", query: "ホテル OR 旅館" },
    { name: "🅿 駐車場（Googleで探す）", query: "駐車場" }
  ];

  let html = `<div style="margin-top:10px;">
    <div style="font-weight:900; margin-bottom:6px;">🔎 周辺検索（Googleマップ）</div>
    <ul style="margin:0; padding-left:18px; line-height:1.5; font-size:13px;">`;
  for (const cat of categories) {
    const url =
      `https://www.google.com/maps/search/${encodeURIComponent(cat.query)}` +
      `/@${lat},${lon},${zoom}z`;
    html += `<li><a href="${url}" target="_blank" rel="noopener">${cat.name}</a></li>`;
  }
  html += `</ul></div>`;
  return html;
}

// --------------------
// Overpassクエリ（おすすめ取得）
// --------------------
function buildOverpassQuery(lat, lon, radiusM) {
  return `
[out:json][timeout:25];
(
  // 温泉・銭湯系
  nwr(around:${radiusM},${lat},${lon})["amenity"="public_bath"];
  nwr(around:${radiusM},${lat},${lon})["bath:type"="onsen"];
  nwr(around:${radiusM},${lat},${lon})["bath:type"="hot_spring"];
  nwr(around:${radiusM},${lat},${lon})["natural"="hot_spring"];

  // 歴史・観光
  nwr(around:${radiusM},${lat},${lon})["historic"];
  nwr(around:${radiusM},${lat},${lon})["tourism"="attraction"];

  // レジャー
  nwr(around:${radiusM},${lat},${lon})["tourism"="theme_park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="water_park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="park"];
  nwr(around:${radiusM},${lat},${lon})["leisure"="sports_centre"];

  // スキー
  nwr(around:${radiusM},${lat},${lon})["landuse"="winter_sports"];
  relation(around:${radiusM},${lat},${lon})["site"="piste"];
  nwr(around:${radiusM},${lat},${lon})["piste:type"];
);
out tags center 200;
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
        body
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Overpass fetch failed");
}

function categorizeOsm(tags = {}) {
  if (
    tags["amenity"] === "public_bath" ||
    tags["bath:type"] === "onsen" ||
    tags["bath:type"] === "hot_spring" ||
    tags["natural"] === "hot_spring"
  ) return "♨ 温泉";

  if (tags["landuse"] === "winter_sports" || tags["site"] === "piste" || tags["piste:type"]) {
    return "🎿 スキー場";
  }

  if (tags["historic"] || tags["tourism"] === "attraction") {
    return "🏯 歴史的観光地";
  }

  if (
    tags["tourism"] === "theme_park" ||
    tags["leisure"] === "water_park" ||
    tags["leisure"] === "park" ||
    tags["leisure"] === "sports_centre"
  ) return "🎡 レジャー施設";

  return null;
}

function elementLatLon(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function getRecommendationsHtml(lat, lon, radiusKm) {
  // 0kmは「おすすめ無し」
  if (radiusKm <= 0) {
    return `
      <div style="font-weight:900; font-size:15px; margin-top:10px;">⭐ おすすめ（半径0km）</div>
      <div style="color:#6b7280; font-size:13px; margin-top:4px;">
        半径が0kmなので、おすすめは表示しない。必要ならスライダーを上げて。
      </div>
    `;
  }

  const radiusM = Math.round(radiusKm * 1000);
  const query = buildOverpassQuery(lat, lon, radiusM);
  const data = await overpassFetch(query);

  const seen = new Set();
  const items = [];

  for (const el of (data.elements || [])) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ll = elementLatLon(el);
    if (!ll) continue;

    const cat = categorizeOsm(el.tags || {});
    if (!cat) continue;

    const name = (el.tags && el.tags.name) ? el.tags.name : "(名前なし)";
    const dist = haversineKm(lat, lon, ll.lat, ll.lon);

    items.push({ cat, name, lat: ll.lat, lon: ll.lon, distKm: dist });
  }

  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  for (const [k, arr] of byCat.entries()) {
    arr.sort((a, b) => a.distKm - b.distKm);
    byCat.set(k, arr.slice(0, POI_LIMIT_EACH));
  }

  const order = ["♨ 温泉", "🏯 歴史的観光地", "🎡 レジャー施設", "🎿 スキー場"];

  let html = `
    <div style="font-weight:900; font-size:15px; margin-top:10px;">⭐ おすすめ（重心から近い順）</div>
    <div style="color:#6b7280; font-size:13px; margin-top:4px;">
      半径 約${radiusKm}km / カテゴリ毎に最大${POI_LIMIT_EACH}件
    </div>
  `;

  let any = false;

  for (const cat of order) {
    const arr = byCat.get(cat) || [];
    html += `<div style="margin-top:10px;"><div style="font-weight:900; margin-bottom:4px;">${cat}</div>`;
    html += `<ul style="margin:0; padding-left:18px; line-height:1.5; font-size:13px;">`;

    if (arr.length === 0) {
      html += `<li>近くに見つからない（OSM未登録の可能性あり）</li>`;
    } else {
      any = true;
      for (const it of arr) {
        const g = `https://www.google.com/maps?q=${it.lat},${it.lon}`;
        html += `<li><a href="${g}" target="_blank" rel="noopener">${it.name}</a>（約${it.distKm.toFixed(1)}km）</li>`;
      }
    }

    html += `</ul></div>`;
  }

  if (!any) {
    html += `<div style="color:#6b7280; font-size:13px; margin-top:8px;">
      おすすめが少ない場所かも。下のGoogle検索が確実。
    </div>`;
  }

  return html;
}

// --------------------
// result欄の描画（重心 + ボタン + おすすめ）
// --------------------
function renderResult({ weighted, unweighted, message = "", showRecoButton = true }) {
  if (!weighted || !unweighted) return;

  const gW = `https://www.google.com/maps?q=${weighted.lat},${weighted.lon}`;
  const gU = `https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}`;

  let recoArea = "";
  if (lastRecoStatus === "loading") {
    recoArea = `<div style="margin-top:10px; font-weight:900;">⭐ おすすめ取得中…</div>`;
  } else if (lastRecoStatus === "ready" && lastRecommendationsHtml) {
    recoArea = lastRecommendationsHtml;
  }

  const recoBtnHtml = showRecoButton ? `
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
      <button id="btn-reco" class="btn primary">おすすめを表示（半径 ${poiRadiusKm}km）</button>
      <button id="btn-reco-clear" class="btn">おすすめを消す</button>
    </div>
  ` : "";

  const msgHtml = message
    ? `<div style="margin-top:10px; color:#6b7280; font-size:13px;">${escapeHtml(message)}</div>`
    : "";

  resultEl.innerHTML = `
    <div style="font-weight:900; font-size:15px;">結果</div>
    <div style="margin-top:8px;">
      <b>🔴 重み付き重心（人数考慮）</b><br>
      緯度：${weighted.lat.toFixed(5)} / 経度：${weighted.lon.toFixed(5)}　
      <a href="${gW}" target="_blank" rel="noopener">Googleマップで開く</a>
    </div>

    <div style="margin-top:10px;">
      <b>🟢 重みなし重心（乗り合い想定）</b><br>
      緯度：${unweighted.lat.toFixed(5)} / 経度：${unweighted.lon.toFixed(5)}　
      <a href="${gU}" target="_blank" rel="noopener">Googleマップで開く</a>
    </div>

    ${msgHtml}
    ${recoBtnHtml}

    <div id="recoArea">
      ${recoArea}
    </div>
  `;

  // ボタン配線
  const btnReco = document.getElementById("btn-reco");
  if (btnReco) btnReco.onclick = () => fetchAndShowRecommendations();

  const btnRecoClear = document.getElementById("btn-reco-clear");
  if (btnRecoClear) btnRecoClear.onclick = () => {
    lastRecoStatus = "none";
    lastRecommendationsHtml = "";
    renderResult({
      weighted: lastCentroid,
      unweighted: lastUnweightedCentroid,
      message: "おすすめを消した。必要ならもう一回「おすすめを表示」。",
      showRecoButton: true
    });
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --------------------
// おすすめ取得 → result欄へ表示
// --------------------
async function fetchAndShowRecommendations() {
  if (!lastCentroid) return;

  // 既に表示済みなら、そのまま再描画（無駄に叩かない）
  if (lastRecoStatus === "ready" && lastRecommendationsHtml) {
    renderResult({
      weighted: lastCentroid,
      unweighted: lastUnweightedCentroid,
      message: "おすすめは表示済み。半径を変えたら再取得される。",
      showRecoButton: true
    });
    return;
  }

  lastRecoStatus = "loading";
  renderResult({
    weighted: lastCentroid,
    unweighted: lastUnweightedCentroid,
    message: "おすすめを取得中…",
    showRecoButton: true
  });

  try {
    const rec = await getRecommendationsHtml(lastCentroid.lat, lastCentroid.lon, poiRadiusKm);
    const extra = generateGoogleSearchLinks(lastCentroid.lat, lastCentroid.lon);

    lastRecommendationsHtml = rec + extra;
    lastRecoStatus = "ready";
    renderResult({
      weighted: lastCentroid,
      unweighted: lastUnweightedCentroid,
      message: "",
      showRecoButton: true
    });
  } catch (e) {
    lastRecoStatus = "ready";
    lastRecommendationsHtml = `
      <div style="font-weight:900; font-size:15px; margin-top:10px;">⭐ おすすめ</div>
      <div style="color:#6b7280; font-size:13px; margin-top:4px;">
        取得に失敗（回線/混雑の可能性）。下のGoogle検索を使って。
      </div>
    ` + generateGoogleSearchLinks(lastCentroid.lat, lastCentroid.lon);

    renderResult({
      weighted: lastCentroid,
      unweighted: lastUnweightedCentroid,
      message: "取得に失敗したので、Google検索リンクを表示した。",
      showRecoButton: true
    });
  }
}

// --------------------
// 重心計算（メイン）
// --------------------
function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が登録されていません。地図をタップして追加して。");
    return;
  }

  clearCentroids(); // 既存の重心やおすすめを一旦クリア（ピン自体は残る）

  const weighted = centroidWeighted(points);
  const unweighted = centroidUnweighted(points);

  lastCentroid = { lat: weighted.lat, lon: weighted.lon };
  lastUnweightedCentroid = { lat: unweighted.lat, lon: unweighted.lon };
  lastRecommendationsHtml = "";
  lastRecoStatus = "none";

  // 重心マーカー（軽量）
  const wMarker = L.circleMarker([weighted.lat, weighted.lon], {
    radius: 10,
    color: "red",
    fillColor: "red",
    fillOpacity: 0.65
  }).addTo(map);

  const uMarker = L.circleMarker([unweighted.lat, unweighted.lon], {
    radius: 10,
    color: "green",
    fillColor: "green",
    fillOpacity: 0.65
  }).addTo(map);

  centroidMarkers.push(wMarker, uMarker);

  map.setView([weighted.lat, weighted.lon], 7);

  // ポップアップは小さく情報だけ（おすすめはresult欄）
  wMarker.bindPopup(`🔴 重み付き重心<br><small>おすすめは下の「おすすめを表示」</small>`).openPopup();
  uMarker.bindPopup("🟢 重みなし重心");

  renderResult({
    weighted: lastCentroid,
    unweighted: lastUnweightedCentroid,
    message: `おすすめ半径：${poiRadiusKm}km。必要なら「おすすめを表示」を押して。`,
    showRecoButton: true
  });
}

// --------------------
// 全ピン削除
// --------------------
function clearAllPins() {
  const ok = confirm("全ピンを削除しますか？");
  if (!ok) return;

  for (const p of points) map.removeLayer(p.marker);
  points = [];
  clearCentroids();
}

// --------------------
// ボタン
// --------------------
document.getElementById("btn-calc").addEventListener("click", calculateCentroid);
document.getElementById("btn-clear").addEventListener("click", clearAllPins);
