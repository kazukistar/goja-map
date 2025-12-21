// ================================
// 地図の初期設定
// ================================
const map = L.map("map").setView([36.5, 138.0], 6);

// 白地図（OpenStreetMap）
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// ================================
// 登録された地点を保存
// ================================
let points = [];
let centroidMarkers = [];

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
  const p = points[index];
  if (!p) return;

  map.removeLayer(p.marker);
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
// 重みなし球面重心
// ================================
function calculateCentroidUnweighted(points) {
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

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI
  };
}

// ================================
// 重心計算（重みあり＋なし）
// ================================
function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が登録されていません");
    return;
  }

  clearCentroids();

  // ---- 重み付き ----
  let xw = 0, yw = 0, zw = 0;
  let total = 0;

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

  const lonW = Math.atan2(yw, xw);
  const hypW = Math.sqrt(xw * xw + yw * yw);
  const latW = Math.atan2(zw, hypW);

  const weighted = {
    lat: latW * 180 / Math.PI,
    lon: lonW * 180 / Math.PI
  };

  // ---- 重みなし ----
  const unweighted = calculateCentroidUnweighted(points);

  // ---- マーカー表示 ----
  const weightedMarker = L.marker(
    [weighted.lat, weighted.lon],
    {
      icon: L.icon({
        iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })
    }
  ).addTo(map).bindPopup("🔴 重み付き重心（人数考慮）");

  const unweightedMarker = L.marker(
    [unweighted.lat, unweighted.lon],
    {
      icon: L.icon({
        iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })
    }
  ).addTo(map).bindPopup("🟢 重みなし重心（地点のみ）");

  centroidMarkers.push(weightedMarker, unweightedMarker);

  map.setView([weighted.lat, weighted.lon], 7);

  // ---- 結果表示 ----
  document.getElementById("result").innerHTML = `
    <b>🔴 重み付き重心（人数考慮）</b><br>
    緯度：${weighted.lat.toFixed(5)}<br>
    経度：${weighted.lon.toFixed(5)}<br>
    <a href="https://www.google.com/maps?q=${weighted.lat},${weighted.lon}" target="_blank">
      Googleマップで開く
    </a><br><br>

    <b>🟢 重みなし重心（地点のみ）</b><br>
    緯度：${unweighted.lat.toFixed(5)}<br>
    経度：${unweighted.lon.toFixed(5)}<br>
    <a href="https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}" target="_blank">
      Googleマップで開く
    </a>
  `;
}
