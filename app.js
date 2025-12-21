// ================================
// 地図初期化
// ================================
const map = L.map("map").setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// ================================
// 登録地点 / マーカー管理
// ================================
let points = [];
let nextPointId = 1;

let centroidMarkers = [];
let lastRecommendationsHtml = "";

// ================================
// Overpass（OSMデータ）検索設定
// ================================
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const POI_RADIUS_M = 30000;     // 30km（車集合の現実ライン）
const POI_LIMIT_EACH = 5;       // カテゴリごとの最大表示数

// ================================
// 地図クリック → ピン追加
// ================================
map.on("click", function (e) {
  const input = prompt("この地点には何人いますか？");
  if (input === null) return;
  if (input === "" || isNaN(input)) {
    alert("数字を入力してください");
    return;
  }

  const count = parseInt(input, 10);
  const id = nextPointId++;

  const marker = L.marker(e.latlng).addTo(map);

  points.push({
    id,
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    count,
    marker
  });

  marker.bindPopup(`
    人数：${count}人<br>
    <button onclick="deleteMarker(${id})">このピンを削除</button>
  `).openPopup();
});

// ================================
// ピン削除（ID方式：削除後も壊れない）
// ================================
function deleteMarker(id) {
  const idx = points.findIndex(p => p.id === id);
  if (idx === -1) return;

  map.removeLayer(points[idx].marker);
  points.splice(idx, 1);

  clearCentroids();
}

// ================================
// 重心マーカー削除
// ================================
function clearCentroids() {
  centroidMarkers.forEach(m => map.removeLayer(m));
  centroidMarkers = [];
  lastRecommendationsHtml = "";
  document.getElementById("result").innerHTML = "";
}

// ================================
// 距離（km）: Haversine
// ================================
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

// ================================
// 重みなし球面重心（地点数だけ＝乗り合い前提）
// ================================
function centroidUnweighted(points) {
  let x = 0, y = 0, z = 0;
  const n = points.length;

  points.forEach(p => {
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

// ================================
// 重み付き球面重心（人数考慮＝各自が別々に来る想定）
// ================================
function centroidWeighted(points) {
  let x = 0, y = 0, z = 0;
  let total = 0;

  points.forEach(p => {
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

// ================================
// Googleマップ「周辺を探す」リンク（残す）
// ================================
function generateGoogleSearchLinks(lat, lon) {
  const zoom = 11;
  const categories = [
    { name: "♨ 温泉（Googleで探す）", query: "温泉" },
    { name: "🏯 歴史的観光地（Googleで探す）", query: "史跡 OR 城 OR 寺 OR 神社" },
    { name: "🎡 レジャー施設（Googleで探す）", query: "テーマパーク OR レジャー施設" },
    { name: "🎿 スキー場（Googleで探す）", query: "スキー場" },
    { name: "🍽 飲食（Googleで探す）", query: "ご当地グルメ OR 名物 OR 郷土料理 OR 飲食店" },
    { name: "🌃 繁華街（Googleで探す）", query: "繁華街 OR 飲み屋街" },
    { name: "🏨 宿（Googleで探す）", query: "ホテル OR 旅館" },
    { name: "🅿 駐車場（Googleで探す）", query: "駐車場" }
  ];

  let html = "<b>🔎 周辺検索（Googleマップ）</b><ul>";
  for (const cat of categories) {
    const url =
      `https://www.google.com/maps/search/${encodeURIComponent(cat.query)}` +
      `/@${lat},${lon},${zoom}z`;
    html += `<li><a href="${url}" target="_blank">${cat.name}</a></li>`;
  }
  html += "</ul>";
  return html;
}

// ================================
// Overpassクエリ生成（周辺のOSMデータ取得）
// ================================
function buildOverpassQuery(lat, lon, radiusM) {
  // out center で way/relation も中心座標が返る
  // 温泉: amenity=public_bath / bath:type=onsen / natural=hot_spring
  // 歴史: historic=* / tourism=attraction
  // レジャー: tourism=theme_park / leisure=water_park / leisure=park / leisure=sports_centre
  // スキー: landuse=winter_sports / site=piste / piste:type=*
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
out tags center 200;
`;
}

// ================================
// Overpassへ問い合わせ（エンドポイント切替）
// ================================
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
      // 次のエンドポイントへ
    }
  }
  throw lastErr || new Error("Overpass fetch failed");
}

// ================================
// Overpass結果をカテゴリ分け
// ================================
function categorizeOsm(tags = {}) {
  // 温泉
  if (tags["amenity"] === "public_bath" || tags["bath:type"] === "onsen" || tags["bath:type"] === "hot_spring" || tags["natural"] === "hot_spring") {
    return "♨ 温泉";
  }
  // スキー
  if (tags["landuse"] === "winter_sports" || tags["site"] === "piste" || tags["piste:type"]) {
    return "🎿 スキー場";
  }
  // 歴史
  if (tags["historic"] || tags["tourism"] === "attraction") {
    return "🏯 歴史的観光地";
  }
  // レジャー
  if (tags["tourism"] === "theme_park" || tags["leisure"] === "water_park" || tags["leisure"] === "park" || tags["leisure"] === "sports_centre") {
    return "🎡 レジャー施設";
  }
  return null;
}

function elementLatLon(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

// ================================
// おすすめ生成（距離順・カテゴリ別）
// ================================
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

    items.push({
      cat,
      name,
      lat: ll.lat,
      lon: ll.lon,
      distKm: dist
    });
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

  // HTML化（Googleマップで開ける）
  const order = ["♨ 温泉", "🏯 歴史的観光地", "🎡 レジャー施設", "🎿 スキー場"];

  let html = `<b>⭐ おすすめ（重心から近い順 / 半径約${Math.round(POI_RADIUS_M/1000)}km）</b><br>`;
  html += `<div style="font-size:13px; line-height:1.4;">`;

  let any = false;
  for (const cat of order) {
    const arr = byCat.get(cat) || [];
    html += `<b>${cat}</b><ul>`;
    if (arr.length === 0) {
      html += `<li>近くに見つからない（OSM未登録の可能性あり）</li>`;
    } else {
      any = true;
      for (const it of arr) {
        const g = `https://www.google.com/maps?q=${it.lat},${it.lon}`;
        html += `<li><a href="${g}" target="_blank">${it.name}</a>（約${it.distKm.toFixed(1)}km）</li>`;
      }
    }
    html += `</ul>`;
  }

  if (!any) {
    html += `おすすめが少ない場所です。下の「Googleで探す」を使うのが確実です。`;
  }

  html += `</div>`;
  return html;
}

// ================================
// 重心計算（メイン）
// ================================
async function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が登録されていません");
    return;
  }

  clearCentroids();

  const weighted = centroidWeighted(points);
  const unweighted = centroidUnweighted(points);

  // ---- 重心ピン（赤：重み付き / 緑：重みなし） ----
  const weightedMarker = L.marker([weighted.lat, weighted.lon], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })
  }).addTo(map).bindPopup("🔴 重み付き重心（人数考慮）");

  const unweightedMarker = L.marker([unweighted.lat, unweighted.lon], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png",
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })
  }).addTo(map).bindPopup("🟢 重みなし重心（乗り合い前提）");

  centroidMarkers.push(weightedMarker, unweightedMarker);

  map.setView([weighted.lat, weighted.lon], 7);

  // ---- まずは「検索中…」をポップアップ ----
  weightedMarker.setPopupContent("⭐ おすすめスポットを検索中…").openPopup();

  // ---- おすすめ取得（全国対応：OSMから周辺だけ取る） ----
  try {
    lastRecommendationsHtml = await getRecommendationsHtml(weighted.lat, weighted.lon);
    weightedMarker.setPopupContent(lastRecommendationsHtml).openPopup();
  } catch (e) {
    lastRecommendationsHtml = `<b>⭐ おすすめ</b><br>取得に失敗しました（回線/混雑の可能性）。<br>下の「Googleで探す」を使ってください。`;
    weightedMarker.setPopupContent(lastRecommendationsHtml).openPopup();
  }

  // ---- 結果表示（＋Google検索リンク） ----
  const gW = `https://www.google.com/maps?q=${weighted.lat},${weighted.lon}`;
  const gU = `https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}`;

  document.getElementById("result").innerHTML = `
    <b>🔴 重み付き重心（人数考慮）</b><br>
    緯度：${weighted.lat.toFixed(5)} / 経度：${weighted.lon.toFixed(5)}<br>
    <a href="${gW}" target="_blank">Googleマップで開く</a><br><br>

    <b>🟢 重みなし重心（乗り合い前提）</b><br>
    緯度：${unweighted.lat.toFixed(5)} / 経度：${unweighted.lon.toFixed(5)}<br>
    <a href="${gU}" target="_blank">Googleマップで開く</a><br><br>

    ${lastRecommendationsHtml}<br>
    ${generateGoogleSearchLinks(weighted.lat, weighted.lon)}
  `;
}
