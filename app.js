console.log("app.js loaded");

let map;
let mapInitialized = false;

function initMap() {
  if (mapInitialized) return;

  console.log("initMap called");

  map = L.map("map").setView([36, 138], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  mapInitialized = true;
}

function showMap() {
  const el = document.getElementById("map");
  el.style.display = "block";

  if (!mapInitialized) {
    initMap();
  }

  // これが無いとUI変更後に白くなる
  map.invalidateSize();
}

window.onload = () => {
  showMap();
};
