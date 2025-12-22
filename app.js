// =====================
// ごじゃ地図（ごじゃクラウド直前版）
// ・地点ピン（人数付き）
// ・重みあり/重みなし重心
// ・重心ポップアップに周辺スポットのGoogleマップ検索リンクを搭載
// =====================

const map = L.map("map").setView([36.5, 138.5], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// 登録地点：{ marker, lat, lng, people }
const points = [];
let centroidMarkers = []; // 重心マーカー（計算し直しで消す）

// Googleマップ検索リンク（位置バイアス付き）を作る
function gmapSearchUrl(keyword, lat, lng, zoom = 12) {
  // 例：https://www.google.com/maps/search/温泉/@35.0,135.0,12z
  const q = encodeURIComponent(keyword);
  return `https://www.google.com/maps/search/${q}/@${lat},${lng},${zoom}z`;
}

// 座標をGoogleマップで開く（ピンなし検索）
function gmapOpenCoordUrl(lat, lng, zoom = 13) {
  // 例：https://www.google.com/maps/@lat,lng,13z
  return `https://www.google.com/maps/@${lat},${lng},${zoom}z`;
}

// 重心ポップアップのHTMLを作る
function buildCentroidPopupHtml(title, lat, lng) {
  const lat5 = lat.toFixed(5);
  const lng5 = lng.toFixed(5);

  // あなたの要求カテゴリ + 勝手に足す枠
  const items = [
    { label: "♨️ 温泉", q: "温泉" },
    { label: "🏯 歴史的観光地", q: "史跡 観光" },
    { label: "🎡 レジャー施設", q: "レジャー施設" },
    { label: "⛷ スキー場", q: "スキー場" },
    { label: "❤️ 風俗街＋ホテル", q: "歓楽街 ホテル" },
    // 勝手に足す（ドライブで便利）
    { label: "🅿 駐車場", q: "駐車場" },
    { label: "⛽ ガソリン", q: "ガソリンスタンド" },
    { label: "🏪 コンビニ", q: "コンビニ" },
    { label: "🛣 道の駅", q: "道の駅" },
    { label: "🍜 ごはん", q: "飲食店" }
  ];

  const openCoord = gmapOpenCoordUrl(lat, lng, 14);

  const linksHtml = items.map(it => {
    const url = gmapSearchUrl(it.q, lat, lng, 12);
    return `<a href="${url}" target="_blank" rel="noopener">${it.label}</a>`;
  }).join("");

  return `
    <div class="popup-title">${title}</div>
    <div class="popup-coord">座標：${lat5}, ${lng5}</div>
    <div><a href="${openCoord}" target="_blank" rel="noopener">▶ Googleマップでこの地点を開く</a></div>
    <div class="popup-coord">周辺スポット検索（Googleマップ）</div>
    <div class="popup-links">${linksHtml}</div>
  `;
}

// ピンを追加
function addPoint(latlng, people) {
  const marker = L.marker(latlng).addTo(map);
  const p = { marker, lat: latlng.lat, lng: latlng.lng, people };

  marker.bindPopup(`人数：${people}人<br><small>クリックで削除</small>`);

  marker.on("click", () => {
    // 削除しにくい問題を避けるため、クリックで確認→削除
    const ok = confirm("このピンを削除しますか？");
    if (!ok) return;

    map.removeLayer(marker);
    const idx = points.indexOf(p);
    if (idx >= 0) points.splice(idx, 1);
  });

  points.push(p);
}

// 地図クリックで追加
map.on("click", (e) => {
  const v = prompt("この地点は何人？（数字）", "1");
  if (v === null) return;

  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    alert("人数は1以上の数字にして。");
    return;
  }

  addPoint(e.latlng, n);
});

// 重心計算（重みあり/なし）
function calcWeightedCentroid() {
  let sumLat = 0, sumLng = 0, sumW = 0;
  for (const p of points) {
    sumLat += p.lat * p.people;
    sumLng += p.lng * p.people;
    sumW += p.people;
  }
  return { lat: sumLat / sumW, lng: sumLng / sumW };
}

function calcUnweightedCentroid() {
  let sumLat = 0, sumLng = 0;
  for (const p of points) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

// 重心マーカーを消す
function clearCentroids() {
  for (const m of centroidMarkers) map.removeLayer(m);
  centroidMarkers = [];
}

// 重心を表示（ポップアップ自動表示）
function showCentroids() {
  if (points.length === 0) {
    alert("ピンがありません。地図をタップして追加して。");
    return;
  }

  clearCentroids();

  const w = calcWeightedCentroid();
  const u = calcUnweightedCentroid();

  // 🔴 重みあり
  const mW = L.circleMarker([w.lat, w.lng], {
    radius: 10,
    color: "red",
    fillColor: "red",
    fillOpacity: 0.6
  }).addTo(map);

  mW.bindPopup(buildCentroidPopupHtml("🔴 重みあり重心（各自バラバラ想定）", w.lat, w.lng));

  // 🟢 重みなし（乗り合い）
  const mU = L.circleMarker([u.lat, u.lng], {
    radius: 10,
    color: "green",
    fillColor: "green",
    fillOpacity: 0.6
  }).addTo(map);

  mU.bindPopup(buildCentroidPopupHtml("🟢 重みなし重心（乗り合い想定）", u.lat, u.lng));

  centroidMarkers.push(mW, mU);

  // 見やすいようにズームと中央寄せ（重みあり側を中心に）
  map.setView([w.lat, w.lng], 8);

  // 「重みあり重心」のポップアップを自動で開く（これが“あったやつ”）
  mW.openPopup();
}

// 全ピン削除
function clearAllPins() {
  const ok = confirm("全ピンを削除しますか？");
  if (!ok) return;

  for (const p of points) map.removeLayer(p.marker);
  points.length = 0;

  clearCentroids();
}

document.getElementById("btn-calc").addEventListener("click", showCentroids);
document.getElementById("btn-clear").addEventListener("click", clearAllPins);
