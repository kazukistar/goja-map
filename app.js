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
    iconSize: [32
