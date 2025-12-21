// ================================
// 地図アプリ本体
// ================================

// 地図を初期化（日本の真ん中あたり）
const map = L.map("map").setView([36.5, 138.0], 6);

// 白地図（OpenStreetMap）
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

// 登録された地点を保存する配列
// { lat, lon, count, marker }
let points = [];

// 地図をクリックしたとき
map.on("click", function (e) {
  const input = prompt("この地点には何人いますか？");

  if (input === null) return;
  if (input === "" || isNaN(input) || Number(input) <= 0) {
    alert("人数は正の数字で入力してください");
    return;
  }

  const count = Number(input);

  // ピンを立てる
  const marker = L.marker(e.latlng)
    .addTo(map)
    .bindPopup(`人数：${count}人`)
    .openPopup();

  // データ保存
  points.push({
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    count: count,
    marker: marker
  });
});

// ================================
// 球面重心（歪み補正あり）
// ================================
function calculateCentroid() {
  if (points.length === 0) {
    alert("地点が1つも登録されていません");
    return;
  }

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

  x /= total;
  y /= total;
  z /= total;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  const latDeg = lat * 180 / Math.PI;
  const lonDeg = lon * 180 / Math.PI;

  // 重心ピン（赤）
  const centroidMarker = L.marker([latDeg, lonDeg], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })
  }).addTo(map)
    .bindPopup("集合地点（重心）")
    .openPopup();

  // 地図を重心に寄せる
  map.setView([latDeg, lonDeg], 7);

  // 結果表示
  const url = `https://www.google.com/maps?q=${latDeg},${lonDeg}`;
  document.getElementById("result").innerHTML = `
    📍 集合地点<br>
    緯度 ${latDeg.toFixed(5)}<br>
    経度 ${lonDeg.toFixed(5)}<br>
    <a href="${url}" target="_blank">Googleマップで開く</a>
  `;
}
