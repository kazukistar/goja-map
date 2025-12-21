// ================================
// 地図初期化
// ================================
const map = L.map("map").setView([36.5, 138.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

// ================================
// 登録地点
// ================================
let points = [];
let centroidMarkers = [];

// ================================
// 簡易POIデータ（例・拡張可）
// ================================
const POIS = [
  { name: "草津温泉", type: "♨ 温泉", lat: 36.6227, lon: 138.5966 },
  { name: "下呂温泉", type: "♨ 温泉", lat: 35.8050, lon: 137.2447 },
  { name: "善光寺", type: "🏯 歴史", lat: 36.6618, lon: 138.1880 },
  { name: "富士急ハイランド", type: "🎡 レジャー", lat: 35.4884, lon: 138.7783 },
  { name: "苗場スキー場", type: "🎿 スキー場", lat: 36.7896, lon: 138.7643 }
];

// ================================
// 地図クリック → ピン追加
// ================================
map.on("click", function (e) {
  const input = prompt("この地点には何人いますか？");
  if (input === null || input === "" || isNaN(input)) return;

  const count = parseInt(input);
  const marker = L.marker(e.latlng).addTo(map);

  points.push({
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    count: count,
    marker: marker
  });

  const index = points.length - 1;

  marker.bindPopup(`
    人数：${count}人<br>
    <button onclick="deleteMarker(${index})">
      このピンを削除
    </button>
  `).openPopup();
});

// ================================
// ピン削除
// ================================
function deleteMarker(index) {
  if (!points[index]) return;
  map.removeLayer(points[index].marker);
  points.splice(index, 1);
  clearCentroids();
}

// ================================
// 重心マーカー削除
// ================================
function clearCentroids() {
  centroidMarkers.forEach(m => map.removeLayer(m));
  centroidMarkers = [];
  document.getElementById("result").innerHTML = "";
}

// ================================
// 距離計算（km）
// ================================
function haversine(lat1, lon1, lat2, lon2) {
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
// 周辺POI抽出
// ================================
function getNearbyPOIs(lat, lon) {
  return POIS
    .map(p => ({
      ...p,
      dist: haversine(lat, lon, p.lat, p.lon)
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
}

// ================================
// 重心計算
// ================================
function calculateCentroid() {
  if (points.length === 0) {
    alert("地点がありません");
    return;
  }

  clearCentroids();

  // ---- 重み付き ----
  let xw = 0, yw = 0, zw = 0, total = 0;

  points.forEach(p => {
    const lat = p.lat * Math.PI / 180;
    const lon = p.lon * Math.PI / 180;
    const w = p.count;

    xw += w * Math.cos(lat) * Math.cos(lon);
    yw += w * Math.cos(lat) * Math.sin(lon);
    zw += w * Math.sin(lat);
    total += w;
  });

  xw /= total; yw /= total; zw /= total;
  const latW = Math.atan2(zw, Math.sqrt(xw * xw + yw * yw)) * 180 / Math.PI;
  const lonW = Math.atan2(yw, xw) * 180 / Math.PI;

  const weightedMarker = L.marker([latW, lonW], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })
  }).addTo(map);

  centroidMarkers.push(weightedMarker);

  // ---- POIおすすめ ----
  const nearby = getNearbyPOIs(latW, lonW);

  let popupHtml = "<b>📍 おすすめスポット</b><ul>";
  nearby.forEach(p => {
    popupHtml += `<li>${p.type} ${p.name}（約${p.dist.toFixed(1)}km）</li>`;
  });
  popupHtml += "</ul>";

  weightedMarker.bindPopup(popupHtml).openPopup();

  // ---- 結果表示 ----
  document.getElementById("result").innerHTML = `
    <b>🔴 重み付き重心</b><br>
    緯度：${latW.toFixed(5)}<br>
    経度：${lonW.toFixed(5)}<br>
    <a href="https://www.google.com/maps?q=${latW},${lonW}" target="_blank">
      Googleマップで開く
    </a>
  `;
}
