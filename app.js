// ================================
// ごじゃ地図 app.js
// 仕様（重要）
// - 「重心を計算」押下でおすすめ検索を内部で開始（プリフェッチ）
// - おすすめ表示は「重心付近の観光地を表示」を押した時だけ
// - 「計算中…」は result欄に出しつつ、スプラッシュ風の全画面オーバーレイでも表示（最低4秒）
// ※ UI(HTML/CSS)は一切変更しない：既存のID/ボタン/レイアウトに合わせる
// ================================

(function () {
  // ----------------
  // 画面診断表示（index.html側の diag があれば使う）
  // ----------------
  function diag(msg) {
    try {
      if (typeof window.__GOJA_DIAG__ === "function") return window.__GOJA_DIAG__(msg);
      const r = document.getElementById("result");
      if (r) r.innerHTML = `<div style="color:#ffb3b3;font-weight:900;line-height:1.6">⚠ ${msg}</div>`;
    } catch (_) {}
  }

  // Leafletが無いならここで終了（落ちない）
  if (typeof window.L === "undefined") {
    diag("Leaflet が読み込めてないため、地図を起動できない。回線 or CDN or PWAキャッシュ。");
    return;
  }

  // ================================
  // DOM 参照
  // ================================
  const elPinList = document.getElementById("pinList");
  const elResult = document.getElementById("result");

  const btnCalc = document.getElementById("btnCalc");
  const btnClear = document.getElementById("btnClear");
  const btnRecommend = document.getElementById("btnRecommend");

  const radiusSlider = document.getElementById("radiusSlider");
  const radiusValue = document.getElementById("radiusValue");

  const mapEl = document.getElementById("map");
  if (!mapEl) {
    diag("map要素(#map)が見つからない。index.htmlのIDが壊れている。");
    return;
  }

  // ================================
  // Leaflet 初期化
  // ================================
  const map = L.map("map", { zoomControl: true }).setView([36.5, 138.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // iPhone/PWAで地図が黒くなる対策
  function safeInvalidate() {
    try { map.invalidateSize(true); } catch (_) {}
  }
  setTimeout(safeInvalidate, 200);
  setTimeout(safeInvalidate, 1200);
  setTimeout(safeInvalidate, 3200);
  setTimeout(safeInvalidate, 4500);

  window.addEventListener("resize", () => setTimeout(safeInvalidate, 80));
  window.addEventListener("orientationchange", () => setTimeout(safeInvalidate, 200));
  window.addEventListener("pageshow", () => setTimeout(safeInvalidate, 200));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(safeInvalidate, 200);
  });

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
    weighted: null,
    promise: null,
    html: "",
    errorMsg: "",
    pendingDisplay: false,
  };

  const MIN_CALC_DISPLAY_MS = 4000;

  // ================================
  // 計算中オーバーレイ
  // ================================
  let calcOverlay = { el: null, hideTimer: null, isVisible: false };

  function ensureCalcOverlay() {
    if (calcOverlay.el) return calcOverlay.el;

    const overlay = document.createElement("div");
    overlay.id = "__calcOverlay";
    overlay.setAttribute("aria-label", "計算中");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "10000";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.backdropFilter = "blur(6px)";
    overlay.style.webkitBackdropFilter = "blur(6px)";
    overlay.style.transition = "opacity 260ms ease";
    overlay.style.opacity = "0";

    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.gap = "12px";
    box.style.padding = "18px 20px";
    box.style.borderRadius = "18px";
    box.style.background = "rgba(20,20,20,0.75)";
    box.style.border = "1px solid rgba(255,255,255,0.12)";
    box.style.boxShadow = "0 14px 40px rgba(0,0,0,0.35)";
    box.style.maxWidth = "86vw";

    const img = document.createElement("img");
    img.alt = "ごじゃ地図";
    img.src = "icons/icon-192.png";
    img.style.width = "92px";
    img.style.height = "92px";
    img.style.borderRadius = "22px";
    img.style.objectFit = "cover";
    img.style.boxShadow = "0 10px 26px rgba(0,0,0,0.35)";
    img.onerror = () => { img.style.display = "none"; };

    const title = document.createElement("div");
    title.textContent = "計算中…";
    title.style.fontSize = "18px";
    title.style.fontWeight = "800";
    title.style.letterSpacing = "0.02em";
    title.style.color = "#fff";
    title.style.textAlign = "center";

    const sub = document.createElement("div");
    sub.textContent = "おすすめを準備しています";
    sub.style.fontSize = "12.5px";
    sub.style.opacity = "0.8";
    sub.style.color = "#fff";
    sub.style.textAlign = "center";

    const spinner = document.createElement("div");
    spinner.style.width = "26px";
    spinner.style.height = "26px";
    spinner.style.borderRadius = "999px";
    spinner.style.border = "3px solid rgba(255,255,255,0.25)";
    spinner.style.borderTopColor = "rgba(255,255,255,0.95)";
    spinner.style.transform = "rotate(0deg)";

    let spinReq = null;
    let angle = 0;
    function startSpin() {
      if (spinReq) return;
      const tick = () => {
        angle = (angle + 10) % 360;
        spinner.style.transform = `rotate(${angle}deg)`;
        spinReq = requestAnimationFrame(tick);
      };
      spinReq = requestAnimationFrame(tick);
    }
    function stopSpin() {
      if (!spinReq) return;
      cancelAnimationFrame(spinReq);
      spinReq = null;
    }

    overlay.__startSpin = startSpin;
    overlay.__stopSpin = stopSpin;

    box.appendChild(img);
    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(spinner);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    calcOverlay.el = overlay;
    return overlay;
  }

  function showCalcOverlay(minMs = MIN_CALC_DISPLAY_MS) {
    const overlay = ensureCalcOverlay();
    calcOverlay.isVisible = true;

    overlay.style.display = "flex";
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });

    if (overlay.__startSpin) overlay.__startSpin();

    if (calcOverlay.hideTimer) clearTimeout(calcOverlay.hideTimer);
    calcOverlay.hideTimer = setTimeout(() => hideCalcOverlay(), Math.max(0, minMs));
  }

  function hideCalcOverlay() {
    const overlay = calcOverlay.el;
    if (!overlay || !calcOverlay.isVisible) return;

    calcOverlay.isVisible = false;
    overlay.style.opacity = "0";
    setTimeout(() => {
      if (!calcOverlay.isVisible) {
        overlay.style.display = "none";
        if (overlay.__stopSpin) overlay.__stopSpin();
        setTimeout(safeInvalidate, 60);
      }
    }, 280);
  }

  // ================================
  // Overpass（OSM）
  // ================================
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  const POI_LIMIT_EACH = 6;

  // ================================
  // 小道具：距離（Haversine km）
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
    let x = 0, y = 0, z = 0;
    const n = pts.length;

    pts.forEach((p) => {
      const lat = (p.lat * Math.PI) / 180;
      const lon = (p.lon * Math.PI) / 180;
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    });

    x /= n; y /= n; z /= n;

    const lon = Math.atan2(y, x);
    const hyp = Math.sqrt(x * x + y * y);
    const lat = Math.atan2(z, hyp);

    return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
  }

  // ================================
  // 球面重心（重み付き：人数）
  // ================================
  function centroidWeighted(pts) {
    let x = 0, y = 0, z = 0;
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

    x /= total; y /= total; z /= total;

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
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });
  }

  const ICON_RED = makeIcon("https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png");
  const ICON_GREEN = makeIcon("https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png");

  // ================================
  // ピン一覧 UI
  // ================================
  function renderPinList() {
    if (!elPinList) return;

    if (points.length === 0) {
      elPinList.innerHTML = `<div class="muted">地図をタップしてピンを追加</div>`;
      return;
    }

    const rows = points
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((p) => {
        const lat = p.lat.toFixed(5);
        const lon = p.lon.toFixed(5);
        return `
          <div class="pinRow">
            <div class="pinMeta">
              <div><b>#${p.id}</b>　${p.count}人</div>
              <div class="muted">${lat}, ${lon}</div>
            </div>
            <button class="btn small" data-del="${p.id}">削除</button>
          </div>
        `;
      })
      .join("");

    elPinList.innerHTML = rows;

    elPinList.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-del"), 10);
        deletePointById(id);
      });
    });
  }

  function deletePointById(id) {
    const idx = points.findIndex((p) => p.id === id);
    if (idx === -1) return;

    map.removeLayer(points[idx].marker);
    points.splice(idx, 1);

    renderPinList();

    clearCentroidMarkers();
    lastCentroids = null;

    resetRecommendationState(true);

    if (elResult) {
      elResult.innerHTML = `<div class="muted">まずはピンを置いて「重心を計算」</div>`;
    }
    if (btnRecommend) btnRecommend.disabled = true;

    setTimeout(safeInvalidate, 60);
  }

  function clearAllPoints() {
    points.forEach((p) => map.removeLayer(p.marker));
    points = [];
    nextPointId = 1;

    renderPinList();
    clearCentroidMarkers();
    lastCentroids = null;

    resetRecommendationState(true);

    if (elResult) {
      elResult.innerHTML = `<div class="muted">まずはピンを置いて「重心を計算」</div>`;
    }
    if (btnRecommend) btnRecommend.disabled = true;

    setTimeout(safeInvalidate, 60);
  }

  // ================================
  // 地図クリック → ピン追加
  // ================================
  map.on("click", (e) => {
    const input = prompt("この地点には何人いますか？");
    if (input === null) return;

    if (input.trim() === "" || isNaN(input)) {
      alert("数字を入力してください");
      return;
    }

    const count = parseInt(input, 10);
    if (!Number.isFinite(count) || count <= 0) {
      alert("1以上の人数を入力してください");
      return;
    }

    const id = nextPointId++;
    const marker = L.marker(e.latlng).addTo(map);

    const p = {
      id,
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      count,
      marker,
    };
    points.push(p);

    marker.bindPopup(`人数：${count}人<br>（ピン一覧から削除できます）`);

    renderPinList();

    clearCentroidMarkers();
    lastCentroids = null;
    resetRecommendationState(true);

    if (elResult) {
      elResult.innerHTML = `<div class="muted">ピンを追加しました。「重心を計算」を押してください</div>`;
    }
    if (btnRecommend) btnRecommend.disabled = true;

    setTimeout(safeInvalidate, 60);
  });

  // ================================
  // result欄の基本表示（おすすめは出さない）
  // ================================
  function renderCentroidBaseResult(weighted, unweighted) {
    const gW = `https://www.google.com/maps?q=${weighted.lat},${weighted.lon}`;
    const gU = `https://www.google.com/maps?q=${unweighted.lat},${unweighted.lon}`;

    const html = `
      <div>
        <b>🔴 重み付き重心（人数考慮）</b><br>
        緯度：${weighted.lat.toFixed(5)} / 経度：${weighted.lon.toFixed(5)}<br>
        <a href="${gW}" target="_blank" rel="noopener">Googleマップで開く</a>
      </div>
      <br>
      <div>
        <b>🟢 重みなし重心（乗り合い前提）</b><br>
        緯度：${unweighted.lat.toFixed(5)} / 経度：${unweighted.lon.toFixed(5)}<br>
        <a href="${gU}" target="_blank" rel="noopener">Googleマップで開く</a>
      </div>
      <br>
      <div id="recArea">
        <b>⭐ おすすめ</b><br>
        <div id="recStatus" class="muted">「重心付近の観光地を表示」を押すと表示します</div>
        <div id="recContent"></div>
      </div>
    `;

    if (elResult) elResult.innerHTML = html;
  }

  // ================================
  // おすすめ状態の初期化
  // ================================
  function resetRecommendationState(keepRadius) {
    rec.status = "idle";
    rec.weighted = null;
    rec.promise = null;
    rec.html = "";
    rec.errorMsg = "";
    rec.pendingDisplay = false;

    if (!keepRadius) rec.radiusKm = 30;

    const st = document.getElementById("recStatus");
    const cont = document.getElementById("recContent");
    if (st) st.textContent = `「重心付近の観光地を表示」を押すと表示します`;
    if (cont) cont.innerHTML = "";
  }

  // ================================
  // Overpass クエリ生成
  // ================================
  function buildOverpassQuery(lat, lon, radiusM) {
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
out tags center 250;
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
          body,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Overpass fetch failed");
  }

  function elementLatLon(el) {
    if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
    if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number")
      return { lat: el.center.lat, lon: el.center.lon };
    return null;
  }

  function categorizeOsm(tags = {}) {
    if (
      tags["amenity"] === "public_bath" ||
      tags["bath:type"] === "onsen" ||
      tags["bath:type"] === "hot_spring" ||
      tags["natural"] === "hot_spring"
    ) return "♨ 温泉";

    if (tags["landuse"] === "winter_sports" || tags["site"] === "piste" || tags["piste:type"])
      return "🎿 スキー場";

    if (tags["historic"] || tags["tourism"] === "attraction") return "🏯 歴史的観光地";

    if (
      tags["tourism"] === "theme_park" ||
      tags["leisure"] === "water_park" ||
      tags["leisure"] === "park" ||
      tags["leisure"] === "sports_centre"
    ) return "🎡 レジャー施設";

    return null;
  }

  async function buildRecommendationsHtml(lat, lon, radiusKm) {
    const radiusM = Math.max(0, Math.round(radiusKm * 1000));
    if (radiusM <= 0) {
      return `<div class="muted">検索半径が0 kmのため、おすすめは表示できません。</div>`;
    }

    const query = buildOverpassQuery(lat, lon, radiusM);
    const data = await overpassFetch(query);

    const seen = new Set();
    const items = [];

    for (const el of data.elements || []) {
      const key = `${el.type}/${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const ll = elementLatLon(el);
      if (!ll) continue;

      const cat = categorizeOsm(el.tags || {});
      if (!cat) continue;

      const name = el.tags && el.tags.name ? el.tags.name : "(名前なし)";
      const dist = haversineKm(lat, lon, ll.lat, ll.lon);

      items.push({ cat, name, lat: ll.lat, lon: ll.lon, distKm: dist });
    }

    const order = ["♨ 温泉", "🏯 歴史的観光地", "🎡 レジャー施設", "🎿 スキー場"];

    const byCat = new Map();
    for (const it of items) {
      if (!byCat.has(it.cat)) byCat.set(it.cat, []);
      byCat.get(it.cat).push(it);
    }
    for (const [k, arr] of byCat.entries()) {
      arr.sort((a, b) => a.distKm - b.distKm);
      byCat.set(k, arr.slice(0, POI_LIMIT_EACH));
    }

    let html = `<div><b>⭐ おすすめ（半径 ${radiusKm} km）</b></div>`;
    html += `<div style="font-size:13px; line-height:1.5;">`;

    let any = false;
    for (const cat of order) {
      const arr = byCat.get(cat) || [];
      html += `<b>${cat}</b><ul>`;
      if (arr.length === 0) {
        html += `<li class="muted">近くに見つからない（OSM未登録の可能性あり）</li>`;
      } else {
        any = true;
        for (const it of arr) {
          const g = `https://www.google.com/maps?q=${it.lat},${it.lon}`;
          html += `<li><a href="${g}" target="_blank" rel="noopener">${it.name}</a>（約${it.distKm.toFixed(1)} km）</li>`;
        }
      }
      html += `</ul>`;
    }

    if (!any) {
      html += `<div class="muted">おすすめが少ない場所です（OSM登録が少ない可能性）。</div>`;
    }
    html += `</div>`;
    return html;
  }

  // ================================
  // result欄の「計算中…」最低4秒
  // ================================
  function showCalcStatusForAtLeast4s() {
    const st = document.getElementById("recStatus");
    const cont = document.getElementById("recContent");
    if (cont) cont.innerHTML = "";
    if (st) st.textContent = "計算中…（おすすめを準備しています）";

    const startedAt = performance.now();
    setTimeout(() => {
      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_CALC_DISPLAY_MS) return;

      const st2 = document.getElementById("recStatus");
      if (!st2) return;

      if (rec.status === "ready") {
        st2.textContent = "準備完了。「重心付近の観光地を表示」を押してください";
      } else if (rec.status === "error") {
        st2.textContent = "取得に失敗しました。「重心付近の観光地を表示」を押して再試行できます";
      } else {
        st2.textContent = "まだ計算中です…（準備でき次第、表示ボタンで即表示できます）";
      }
    }, MIN_CALC_DISPLAY_MS);
  }

  // ================================
  // おすすめプリフェッチ開始
  // ================================
  function startPrefetchRecommendations(weighted, radiusKm) {
    rec.status = "fetching";
    rec.weighted = weighted;
    rec.radiusKm = radiusKm;
    rec.html = "";
    rec.errorMsg = "";

    if (btnRecommend) btnRecommend.disabled = false;

    const p = (async () => {
      try {
        const html = await buildRecommendationsHtml(weighted.lat, weighted.lon, radiusKm);
        rec.html = html;
        rec.status = "ready";
        return html;
      } catch (e) {
        rec.status = "error";
        rec.errorMsg = String(e && e.message ? e.message : e);
        throw e;
      }
    })();

    rec.promise = p;

    p.then(() => {
      if (rec.pendingDisplay) {
        rec.pendingDisplay = false;
        renderRecommendationsNow();
      }
    }).catch(() => {
      if (rec.pendingDisplay) {
        rec.pendingDisplay = false;
        renderRecommendationsNow();
      }
    });
  }

  // ================================
  // おすすめ表示
  // ================================
  function renderRecommendationsNow() {
    const st = document.getElementById("recStatus");
    const cont = document.getElementById("recContent");
    if (!st || !cont) return;

    if (!lastCentroids || !rec.weighted) {
      st.textContent = "先に「重心を計算」を押してください";
      cont.innerHTML = "";
      return;
    }

    if (rec.status === "ready") {
      st.textContent = "";
      cont.innerHTML = rec.html || "";
      return;
    }

    if (rec.status === "error") {
      st.textContent = "取得に失敗しました（回線/混雑の可能性）。もう一度「重心を計算」して再試行してください";
      cont.innerHTML = "";
      return;
    }

    // fetching中
    st.textContent = "準備中…（取得が終わり次第、自動で表示します）";
    cont.innerHTML = "";
    rec.pendingDisplay = true;
  }

  // ================================
  // 重心計算
  // ================================
  function calculateCentroids() {
    if (points.length === 0) {
      alert("地点が登録されていません");
      return;
    }

    showCalcOverlay(MIN_CALC_DISPLAY_MS);

    const weighted = centroidWeighted(points);
    const unweighted = centroidUnweighted(points);
    lastCentroids = { weighted, unweighted };

    clearCentroidMarkers();

    const mW = L.marker([weighted.lat, weighted.lon], { icon: ICON_RED }).addTo(map);
    const mU = L.marker([unweighted.lat, unweighted.lon], { icon: ICON_GREEN }).addTo(map);
    centroidMarkers.push(mW, mU);

    mW.bindPopup("🔴 重み付き重心（人数考慮）");
    mU.bindPopup("🟢 重みなし重心（乗り合い前提）");

    renderCentroidBaseResult(weighted, unweighted);

    const radiusKm = parseInt(radiusSlider ? radiusSlider.value : "30", 10);
    resetRecommendationState(true);
    rec.radiusKm = Number.isFinite(radiusKm) ? radiusKm : 30;

    showCalcStatusForAtLeast4s();
    startPrefetchRecommendations(weighted, rec.radiusKm);

    setTimeout(safeInvalidate, 60);
    setTimeout(safeInvalidate, 400);
  }

  // ================================
  // イベント配線
  // ================================
  if (btnCalc) btnCalc.addEventListener("click", calculateCentroids);
  if (btnClear) btnClear.addEventListener("click", clearAllPoints);
  if (btnRecommend) btnRecommend.addEventListener("click", renderRecommendationsNow);

  function syncRadiusLabel() {
    const v = parseInt(radiusSlider ? radiusSlider.value : "30", 10);
    const km = Number.isFinite(v) ? v : 30;
    if (radiusValue) radiusValue.textContent = String(km);
    rec.radiusKm = km;
  }

  if (radiusSlider) {
    syncRadiusLabel();
    radiusSlider.addEventListener("input", () => {
      syncRadiusLabel();
      if (lastCentroids && lastCentroids.weighted) {
        resetRecommendationState(true);
        startPrefetchRecommendations(lastCentroids.weighted, rec.radiusKm);
        showCalcStatusForAtLeast4s();
      }
    });
  }

  // 初期表示
  renderPinList();
  setTimeout(safeInvalidate, 200);
})();
