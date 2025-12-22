// ================================
// ごじゃ地図：重心＋おすすめ（result欄）
// ================================

const UI = {
  btnCalc: document.getElementById("btnCalc"),
  btnClear: document.getElementById("btnClear"),
  btnHardReload: document.getElementById("btnHardReload"),
  btnRecommend: document.getElementById("btnRecommend"),
  radiusSlider: document.getElementById("radiusSlider"),
  radiusValue: document.getElementById("radiusValue"),
  pinList: document.getElementById("pinList"),
  result: document.getElementById("result"),
};

let points = [];
let nextPointId = 1;

let centroid = {
  weighted: null,
  unweighted: null,
};

let centroidLayers = []; // Leaflet layers (markers/circles)

// Overpass
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const POI_LIMIT_EACH = 6;

// ================================
// 地図初期化
// ================================
const map = L.map("map", {
  zoomControl: true,
}).setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

// ================================
// UI初期化
// ================================
UI.radiusValue.textContent = String(UI.radiusSlider.value);

UI.radiusSlider.addEventListener("input", () => {
  UI.radiusValue.textContent = String(UI.radiusSlider.value);
});

UI.btnCalc.addEventListener("click", () => calculateCentroid());
UI.btnClear.addEventListener("click", () => clearAllPins());
UI.btnRecommend.addEventListener("click", () => showRecommendations());
UI.btnHardReload.addEventListener("click", () => hardReload());

// ================================
// 地図クリック → ピン追加
// ================================
map.on("click", (e) => {
  const input = prompt("この地点には何人いますか？（例：3）");
  if (input === null) return;
  if (input.trim() === "" || isNaN(input)) {
    alert("数字を入力してください");
    return;
  }
  const count = Math.max(1, parseInt(input, 10));
  addPoint(e.latlng.lat, e.latlng.lng, count);
});

function addPoint(lat, lon, count) {
  const id = nextPointId++;

  const marker = L.marker([lat, lon]).addTo(map);

  // ポップアップは小さめ＆削除導線だけ
  marker.bindPopup(`
    <div style="font-size:13px; line-height:1.4;">
      <b>人数：</b>${count}人<br/>
      <button style="margin-top:8px; padding:8px 10px; font-weight:800; cursor:pointer;"
        onclick="window.__gojaDeletePin(${id})">このピンを削除</button>
    </div>
  `);

  points.push({ id, lat, lon, count, marker });

  renderPinList();
  updateResultHint();
}

// グローバル（Leaflet popupボタンから呼ぶ）
window.__gojaDeletePin = function (id) {
  deletePoint(id);
};

function deletePoint(id) {
  const idx = points.findIndex((p) => p.id === id);
  if (idx === -1) return;

  map.removeLayer(points[idx].marker);
  points.splice(idx, 1);

  clearCentroidLayers();
  centroid.weighted = null;
  centroid.unweighted = null;

  renderPinList();
  updateResultHint();
}

function clearAllPins() {
  if (points.length === 0) return;

  for (const p of points) map.removeLayer(p.marker);
  points = [];

  clearCentroidLayers();
  centroid.weighted = null;
  centroid.unweighted = null;

  renderPinList();
  updateResultHint();
}

function renderPinList() {
  if (points.length === 0) {
    UI.pinList.innerHTML = `<div class="muted">地図をタップしてピンを追加</div>`;
    return;
  }

  UI.pinList.innerHTML = points
    .map((p, i) => {
      const lat = p.lat.toFixed(5);
      const lon = p.lon.toFixed(5);
      return `
        <div class="pinItem">
          <div class="pinMeta">
            <div class="big">#${i + 1}　${p.count}人</div>
            <div class="small">${lat}, ${lon}</div>
          </div>
          <div class="pinActions">
            <button class="iconBtn" title="地図で見る" onclick="window.__gojaFocusPin(${p.id})">👁</button>
            <button class="iconBtn" title="削除" onclick="window.__gojaDeletePin(${p.id})">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

window.__gojaFocusPin = function (id) {
  const p = points.find((x) => x.id === id);
  if (!p) return;
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), 10));
  p.marker.openPopup();
};

// ================================
// 重心計算（球面）
// ================================
function centroidUnweighted(ps) {
  let x = 0, y = 0, z = 0;
  const n = ps.length;

  for (const p of ps) {
    const lat = (p.lat * Math.PI) / 180;
    const lon = (p.lon * Math.PI) / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  x /= n; y /= n; z /= n;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

function centroidWeighted(ps) {
  let x = 0, y = 0, z = 0;
  let total = 0;

  for (const p of ps) {
    const lat = (p.lat * Math.PI) / 180;
    const lon = (p.lon * Math.PI) / 180;
    const w = p.count;

    x += w * Math.cos(lat) * Math.cos(lon);
    y += w * Math.cos(lat) * Math.sin(lon);
    z += w * Math.sin(lat);
    total += w;
  }

  x /= total; y /= total; z /= total;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が登録されていません");
    return;
  }

  clearCentroidLayers();

  centroid.weighted = centroidWeighted(points);
  centroid.unweighted = centroidUnweighted(points);

  // 表示（circleMarkerで軽く）
  const w = centroid.weighted;
  const u = centroid.unweighted;

  const wLayer = L.circleMarker([w.lat, w.lon], {
    radius: 10,
    color: "#ff4b4b",
    weight: 3,
    fillColor: "#ff4b4b",
    fillOpacity: 0.25,
  }).addTo(map);

  const uLayer = L.circleMarker([u.lat, u.lon], {
    radius: 10,
    color: "#5aff7b",
    weight: 3,
    fillColor: "#5aff7b",
    fillOpacity: 0.20,
  }).addTo(map);

  centroidLayers.push(wLayer, uLayer);

  map.setView([w.lat, w.lon], 7);

  UI.btnRecommend.disabled = false;

  renderCentroidResultOnly();
}

function clearCentroidLayers() {
  for (const layer of centroidLayers) map.removeLayer(layer);
  centroidLayers = [];
  UI.btnRecommend.disabled = true;
}

function updateResultHint() {
  if (points.length === 0) {
    UI.result.innerHTML = `<div class="muted">まずはピンを置いて「重心を計算」</div>`;
    UI.btnRecommend.disabled = true;
  } else {
    UI.result.innerHTML = `<div class="muted">ピンOK。次は「重心を計算」</div>`;
  }
}

function renderCentroidResultOnly() {
  const w = centroid.weighted;
  const u = centroid.unweighted;
  if (!w || !u) return;

  const gW = `https://www.google.com/maps?q=${w.lat},${w.lon}`;
  const gU = `https://www.google.com/maps?q=${u.lat},${u.lon}`;

  UI.result.innerHTML = `
    <div class="badgeRow">
      <span class="badge">🔴 重み付き重心</span>
      <span class="badge">🟢 重みなし重心</span>
      <span class="badge">おすすめ半径：${UI.radiusSlider.value}km</span>
    </div>

    <b>🔴 重み付き重心（人数考慮）</b><br/>
    緯度：${w.lat.toFixed(5)} / 経度：${w.lon.toFixed(5)}　
    <a href="${gW}" target="_blank">Googleマップで開く</a><br/><br/>

    <b>🟢 重みなし重心（乗り合い想定）</b><br/>
    緯度：${u.lat.toFixed(5)} / 経度：${u.lon.toFixed(5)}　
    <a href="${gU}" target="_blank">Googleマップで開く</a><br/><br/>

    <div class="muted">おすすめは「おすすめを表示」を押すと、下に一覧で出ます（ポップアップは使わない）。</div>
    <div style="margin-top:10px;">${generateGoogleSearchLinks(w.lat, w.lon)}</div>
  `;
}

// ================================
// Google検索リンク（維持）
// ================================
function generateGoogleSearchLinks(lat, lon) {
  const zoom = 11;

  const categories = [
    { name: "♨ 温泉（Googleで探す）", query: "温泉" },
    { name: "🏯 歴史（Googleで探す）", query: "史跡 OR 城 OR 寺 OR 神社" },
    { name: "🎡 レジャー（Googleで探す）", query: "テーマパーク OR レジャー施設" },
    { name: "🎿 スキー場（Googleで探す）", query: "スキー場" },
    { name: "🍽 飲食（Googleで探す）", query: "ご当地グルメ OR 名物 OR 郷土料理 OR 飲食店" },
    { name: "🌃 繁華街（Googleで探す）", query: "繁華街 OR 飲み屋街" },
    { name: "🏨 宿（Googleで探す）", query: "ホテル OR 旅館" },
    { name: "🅿 駐車場（Googleで探す）", query: "駐車場" },
    { name: "💗 風俗街＋ホテル（Googleで探す）", query: "風俗街 ホテル" },
  ];

  let html = `<b>🔎 周辺検索（Googleマップ）</b><div class="poiGrid">`;
  html += `<div class="poiBlock"><div class="poiTitle">リンク一覧</div><ul>`;

  for (const cat of categories) {
    const url =
      `https://www.google.com/maps/search/${encodeURIComponent(cat.query)}` +
      `/@${lat},${lon},${zoom}z`;
    html += `<li><a href="${url}" target="_blank">${cat.name}</a></li>`;
  }

  html += `</ul></div></div>`;
  return html;
}

// ================================
// おすすめ表示（result欄に表示）
// ================================
async function showRecommendations() {
  const w = centroid.weighted;
  if (!w) {
    alert("先に重心を計算してください");
    return;
  }

  const radiusKm = parseInt(UI.radiusSlider.value, 10);
  if (radiusKm <= 0) {
    // 半径0は「おすすめ無し」にする
    renderRecommendationsHtml("<div class='muted'>半径が0kmなので、おすすめ取得はしない。</div>");
    return;
  }

  UI.btnRecommend.disabled = true;

  // まず結果欄を「読み込み中」に
  const base = UI.result.innerHTML;
  renderRecommendationsHtml(`
    <div class="badgeRow">
      <span class="badge">⭐ おすすめ取得中…</span>
      <span class="badge">半径：${radiusKm}km</span>
    </div>
    <div class="muted">混雑してるとOverpassが遅いことがある。少し待って。</div>
  `, true);

  try {
    const html = await getRecommendationsHtml(w.lat, w.lon, radiusKm * 1000);
    renderRecommendationsHtml(html);
  } catch (e) {
    renderRecommendationsHtml(`
      <div class="badgeRow">
        <span class="badge">⚠ 取得失敗</span>
        <span class="badge">回線/混雑の可能性</span>
      </div>
      <div class="muted">
        おすすめ取得に失敗した。下の「Googleで探す」が確実。<br/>
        （Overpassが混雑していると失敗しやすい）
      </div>
    `);
  } finally {
    UI.btnRecommend.disabled = false;
  }
}

// result欄に「おすすめブロック」を追加/更新
function renderRecommendationsHtml(recoHtml, onlyReco = false) {
  // onlyReco=true のときは結果欄をおすすめだけにする（取得中表示など）
  if (onlyReco) {
    UI.result.innerHTML = recoHtml;
    return;
  }

  // 通常は「重心情報＋Googleリンク」は残しつつ、末尾におすすめを付ける
  const w = centroid.weighted;
  const u = centroid.unweighted;
  if (!w || !u) {
    UI.result.innerHTML = recoHtml;
    return;
  }

  const gW = `https://www.google.com/maps?q=${w.lat},${w.lon}`;
  const gU = `https://www.google.com/maps?q=${u.lat},${u.lon}`;

  UI.result.innerHTML = `
    <div class="badgeRow">
      <span class="badge">🔴 重み付き重心</span>
      <span class="badge">🟢 重みなし重心</span>
      <span class="badge">おすすめ半径：${UI.radiusSlider.value}km</span>
    </div>

    <b>🔴 重み付き重心（人数考慮）</b><br/>
    緯度：${w.lat.toFixed(5)} / 経度：${w.lon.toFixed(5)}　
    <a href="${gW}" target="_blank">Googleマップで開く</a><br/><br/>

    <b>🟢 重みなし重心（乗り合い想定）</b><br/>
    緯度：${u.lat.toFixed(5)} / 経度：${u.lon.toFixed(5)}　
    <a href="${gU}" target="_blank">Googleマップで開く</a><br/><br/>

    <div class="poiGrid">
      <div class="poiBlock">
        <div class="poiTitle">⭐ おすすめ（一覧表示）</div>
        ${recoHtml}
      </div>
    </div>

    <div style="margin-top:12px;">${generateGoogleSearchLinks(w.lat, w.lon)}</div>
  `;
}

// ================================
// Overpass（OSM）
// ================================
function buildOverpassQuery(lat, lon, radiusM) {
  // 温泉/歴史/レジャー/スキー + 夜遊び系（OSMにある範囲）
  return `
[out:json][timeout:25];
(
  // 温泉
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

  // 飲食・宿・繁華街(ざっくり)・夜遊び（OSMにある分だけ）
  nwr(around:${radiusM},${lat},${lon})["amenity"="restaurant"];
  nwr(around:${radiusM},${lat},${lon})["amenity"="cafe"];
  nwr(around:${radiusM},${lat},${lon})["amenity"="bar"];
  nwr(around:${radiusM},${lat},${lon})["tourism"="hotel"];
  nwr(around:${radiusM},${lat},${lon})["tourism"="guest_house"];

  // 風俗/夜遊び（OSMに登録されているもの）
  nwr(around:${radiusM},${lat},${lon})["amenity"="brothel"];
  nwr(around:${radiusM},${lat},${lon})["amenity"="stripclub"];
  nwr(around:${radiusM},${lat},${lon})["amenity"="nightclub"];
);
out tags center 400;
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

function categorizeOsm(tags = {}) {
  // 温泉
  if (
    tags["amenity"] === "public_bath" ||
    tags["bath:type"] === "onsen" ||
    tags["bath:type"] === "hot_spring" ||
    tags["natural"] === "hot_spring"
  ) return "♨ 温泉";

  // スキー
  if (tags["landuse"] === "winter_sports" || tags["site"] === "piste" || tags["piste:type"]) {
    return "🎿 スキー場";
  }

  // 歴史
  if (tags["historic"] || tags["tourism"] === "attraction") return "🏯 歴史的観光地";

  // レジャー
  if (
    tags["tourism"] === "theme_park" ||
    tags["leisure"] === "water_park" ||
    tags["leisure"] === "park" ||
    tags["leisure"] === "sports_centre"
  ) return "🎡 レジャー施設";

  // 飲食
  if (tags["amenity"] === "restaurant" || tags["amenity"] === "cafe") return "🍽 飲食";

  // 宿
  if (tags["tourism"] === "hotel" || tags["tourism"] === "guest_house") return "🏨 宿";

  // 夜遊び（風俗/クラブ等）
  if (tags["amenity"] === "brothel" || tags["amenity"] === "stripclub" || tags["amenity"] === "nightclub") {
    return "💗 風俗/夜遊び";
  }

  // bar は「繁華街/飲み屋」に寄せる（雑）
  if (tags["amenity"] === "bar") return "🌃 飲み屋";

  return null;
}

function elementLatLon(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function getRecommendationsHtml(lat, lon, radiusM) {
  const data = await overpassFetch(buildOverpassQuery(lat, lon, radiusM));

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

  // カテゴリ別に距離順・上限
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  for (const [k, arr] of byCat.entries()) {
    arr.sort((a, b) => a.distKm - b.distKm);
    byCat.set(k, arr.slice(0, POI_LIMIT_EACH));
  }

  const order = ["♨ 温泉", "🏯 歴史的観光地", "🎡 レジャー施設", "🎿 スキー場", "🍽 飲食", "🌃 飲み屋", "🏨 宿", "💗 風俗/夜遊び"];

  let html = `<div class="muted">重心（🔴）から近い順。リンクはGoogleマップで開く。</div>`;
  html += `<div class="poiGrid">`;

  let any = false;

  for (const cat of order) {
    const arr = byCat.get(cat) || [];
    html += `<div class="poiBlock"><div class="poiTitle">${cat}</div><ul>`;

    if (arr.length === 0) {
      html += `<li class="muted">近くに見つからない（OSM未登録の可能性）</li>`;
    } else {
      any = true;
      for (const it of arr) {
        const g = `https://www.google.com/maps?q=${it.lat},${it.lon}`;
        html += `<li><a href="${g}" target="_blank">${escapeHtml(it.name)}</a>（約${it.distKm.toFixed(1)}km）</li>`;
      }
    }

    html += `</ul></div>`;
  }

  if (!any) {
    html += `<div class="poiBlock"><div class="poiTitle">ヒント</div><div class="muted">この場所はOSM側の登録が少ないっぽい。下の「Googleで探す」が確実。</div></div>`;
  }

  html += `</div>`;
  return html;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ================================
// 強制更新（PWAキャッシュ対策）
// ================================
async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) {}

  // クエリを付けてキャッシュ回避
  const url = new URL(location.href);
  url.searchParams.set("v", String(Date.now()));
  location.href = url.toString();
}

// 初期表示
updateResultHint();
