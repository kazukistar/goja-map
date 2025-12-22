console.log("app.js loaded");

let map;
let mapInitialized = false;

function initMap() {
  if (mapInitialized) return;

  console.log("initMap called");

  map = L.map("map").setView([36, 138], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  mapInitialized = true;
}

function showMap() {
  const el = document.getElementById("map");
  el.style.display = "block";

  if (!mapInitialized) {
    initMap();
  }

  // UI変更後に必須
  map.invalidateSize();
}

// ページ読み込み完了後に実行
window.addEventListener("load", () => {
  showMap();
});
