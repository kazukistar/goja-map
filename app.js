// ================================
// ごじゃ地図：距離つき「おすすめ」ポップアップ（Overpass/OSM）版
// ================================

const map = L.map("map").setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

// --------------------
// ピン管理
// --------------------
let points = [];
let nextPointId = 1;

let centroidMarkers = []; // 重心マーカー（計算し直しで消す）
let lastRecommendationsHtml = "";

// --------------------
// Overpass設定
// --------------------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

const POI_RADIUS_M = 30000; // 30km
const POI_LIMIT_EACH = 5;   // カテゴリ毎の最大表示

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

  marker.bindPopup(`人数：${p.count}人<br><small>このピンをクリック→確認で削除</small>`);

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
  lastRecommendationsHtml = "";
  document.getElementById("result").innerHTML = "";
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
    { name: "🏯 歴史的観光地（Googleで探す）", query: "史跡 OR 城 OR 寺 OR 神社" },
    { name: "🎡 レジャー施設（Googleで探す）", query: "テーマパーク OR レジャー施設" },
    { name: "🎿 スキー場（Googleで探す）", query: "スキー場" },
    { name: "❤️ 風俗街＋ホテル（Googleで探す）", query: "歓楽街 OR 繁華街 ホテル" },
    { name: "🍽 飲食（Googleで探す）", query: "ご当地グルメ OR 名物 OR 郷土料理 OR 飲食店" },
    { name: "🅿 駐車場（Googleで探す）", query: "駐車場" }
  ];

  let html = `<div class="popup-section"><div class="popup-section-title">🔎 周辺検索（Googleマップ）</div><ul class="popup-list">`;
  for (const cat of categories) {
    const url =
      `https://www.google.com/maps/search/${encodeURIComponent(cat.query)}` +
      `/@${lat},${lon},${zoom}z`;
    html += `<li><a href="${url}" target="_blank" rel="noopener">${cat.name}</a></li>`;
  }
  html += "</ul></div>";
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
  // 温泉
  if (
    tags["amenity"] === "public_bath" ||
    tags["bath:type"] === "onsen" ||
    tags["bath:type"] === "hot_spring" ||
    tags["natural"] === "hot_spring"
  ) return "♨ 温泉";

  // スキー
  if (
    tags["landuse"] === "winter_sports" ||
    tags["site"] === "piste" ||
    tags["piste:type"]
  ) return "🎿 スキー場";

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

function elementLatLon(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function getRecommendationsHtml(lat, lon) {
  const query = buildOverpassQuery(lat, lon, POI_RADIUS_M);
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

  // カテゴリ別に距離順
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
    <div class="popup-title">⭐ おすすめ（重心から近い順）</div>
    <div class="popup-sub">半径 約${Math.round(POI_RADIUS_M/1000)}km / カテゴリ毎に最大${POI_LIMIT_EACH}件</div>
  `;

  let any = false;

  for (const cat of order) {
    const arr = byCat.get(cat) || [];
    html += `<div class="popup-section"><div class="popup-section-title">${cat}</div><ul class="popup-list">`;

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
    html += `<div class="popup-sub">おすすめが少ない場所かも。下の「Googleで探す」が確実。</div>`;
  }

  return html;
}

// --------------------
// 重心計算（メイン）
// --------------------
async function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が登録されていません。地図をタップして追加して。");
    return;
  }

  clearCentroids();

  const weighted = centroidWeighted(points);
  const unweighted = centroidUnweighted(points);

  // 重心マーカー（赤：重み付き / 緑：重みなし）
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

  // まずは「検索中」
  wMarker.bindPopup("⭐ おすすめスポットを検索中…").openPopup();
  uMarker.bindPopup("🟢 重みなし重心（乗り合い想定）<br><small>距離つきおすすめは🔴側に表示</small>");

  // おすすめ取得 → ポップアップ更新（ここが「前の出方」）
  try {
    lastRecommendationsHtml = await getRecommendationsHtml(weighted.lat, weighted.lon);
    const extra = generateGoogleSearchLinks(weighted.lat, weighted.lon);
    wMarker.setPopupContent(lastRecommendationsHtml + extra).openPopup();
  } catch (e) {
    const fallback = `
      <div class="popup-title">⭐ おすすめ</div>
      <div class="popup-sub">取得に失敗（回線/混雑の可能性）。下のGoogle検索を使って。</div>
    `;
    wMarker.setPopupContent(fallback + generateGoogleSearchLinks(weighted.lat, weighted.lon)).openPopup();
  }

  // 画面下の結果（おまけ）
  const gW = `https://www.google.com/maps?q=${weighted.lat},${weighted.lon}`;
  const gU = `https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}`;

  document.getElementById("result").innerHTML = `
    <b>🔴 重み付き重心（人数考慮）</b><br>
    緯度：${weighted.lat.toFixed(5)} / 経度：${weighted.lon.toFixed(5)}　
    <a href="${gW}" target="_blank" rel="noopener">Googleマップで開く</a><br><br>

    <b>🟢 重みなし重心（乗り合い想定）</b><br>
    緯度：${unweighted.lat.toFixed(5)} / 経度：${unweighted.lon.toFixed(5)}　
    <a href="${gU}" target="_blank" rel="noopener">Googleマップで開く</a>
  `;
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

// ボタン
document.getElementById("btn-calc").addEventListener("click", calculateCentroid);
document.getElementById("btn-clear").addEventListener("click", clearAllPins);
