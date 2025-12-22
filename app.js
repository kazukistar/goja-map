// ===== 地図初期化 =====
const map = L.map("map").setView([36, 138], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// ===== 登録地点 =====
const points = [];

// ===== クリックで地点登録 =====
map.on("click", (e) => {
  const people = prompt("この地点は何人？", "1");
  if (!people || isNaN(people)) return;

  const marker = L.marker(e.latlng).addTo(map);
  marker.bindPopup(`人数：${people}人`).openPopup();

  points.push({
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    people: Number(people)
  });
});

// ===== 重心計算 =====
function calculateCentroids() {
  if (points.length === 0) {
    alert("地点がありません");
    return;
  }

  // --- 重みあり ---
  let sumLatW = 0;
  let sumLngW = 0;
  let sumPeople = 0;

  points.forEach(p => {
    sumLatW += p.lat * p.people;
    sumLngW += p.lng * p.people;
    sumPeople += p.people;
  });

  const weightedLat = sumLatW / sumPeople;
  const weightedLng = sumLngW / sumPeople;

  // --- 重みなし ---
  let sumLat = 0;
  let sumLng = 0;

  points.forEach(p => {
    sumLat += p.lat;
    sumLng += p.lng;
  });

  const simpleLat = sumLat / points.length;
  const simpleLng = sumLng / points.length;

  // --- 表示 ---
  L.marker([weightedLat, weightedLng], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png",
      iconSize: [32, 32]
    })
  }).addTo(map).bindPopup("🔴 重みあり重心");

  L.marker([simpleLat, simpleLng], {
    icon: L.icon({
      iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png",
      iconSize: [32, 32]
    })
  }).addTo(map).bindPopup("🟢 重みなし重心");

  map.setView([weightedLat, weightedLng], 6);
}
