const state = {
  points: [],
  mode: "points",
  layers: [],
  map: null,
};

const els = {
  stats: document.querySelector("#stats"),
  status: document.querySelector("#statusText"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  daySelect: document.querySelector("#daySelect"),
  empty: document.querySelector("#emptyState"),
  modeButtons: document.querySelectorAll("[data-mode]"),
};

init();

async function init() {
  const config = await fetchJson("/api/config");
  state.map = L.map("map", { preferCanvas: true }).setView([35.8617, 104.1954], 4);
  L.tileLayer(config.tile_url, {
    maxZoom: 19,
    attribution: config.tile_attribution,
  }).addTo(state.map);

  bindControls();
  await loadFootprints();
}

async function loadFootprints() {
  try {
    const data = await fetchJson("/api/footprints");
    state.points = data.points || [];
    renderStats(data.stats);
    hydrateDateControls(state.points);
    els.status.textContent = `已载入 ${state.points.length.toLocaleString()} 个足迹点`;
    render();
  } catch (error) {
    renderStats();
    showEmpty(error.message || "读取 CSV 失败，请检查 data/footprint.csv。");
  }
}

function bindControls() {
  [els.startDate, els.endDate, els.daySelect].forEach((input) => {
    input.addEventListener("change", render);
  });

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      els.modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });
}

function render() {
  clearLayers();
  const points = filteredPoints();

  if (!points.length) {
    showEmpty("当前筛选条件下没有足迹点。");
    return;
  }
  hideEmpty();

  if (state.mode === "heat") {
    const heatData = points.map((point) => [point.latitude, point.longitude, 0.7]);
    addLayer(L.heatLayer(heatData, { radius: 22, blur: 18, maxZoom: 12 }));
  } else {
    const latLngs = points.map((point) => [point.latitude, point.longitude]);

    if (state.mode === "line") {
      addLayer(L.polyline(latLngs, { color: "#2563eb", weight: 3, opacity: 0.75 }));
    }

    points.forEach((point) => {
      addLayer(
        L.circleMarker([point.latitude, point.longitude], {
          radius: state.mode === "line" ? 4 : 5,
          color: "#0f766e",
          weight: 1,
          fillColor: "#14b8a6",
          fillOpacity: 0.75,
        }).bindPopup(popupHtml(point)),
      );
    });
  }

  const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
  state.map.fitBounds(bounds.pad(0.12), { maxZoom: 14 });
}

function filteredPoints() {
  const start = els.startDate.value;
  const end = els.endDate.value;
  const day = els.daySelect.value;

  return state.points.filter((point) => {
    if (day && point.date !== day) return false;
    if (start && point.date && point.date < start) return false;
    if (end && point.date && point.date > end) return false;
    return true;
  });
}

function hydrateDateControls(points) {
  const dates = [...new Set(points.map((point) => point.date).filter(Boolean))].sort();
  els.daySelect.innerHTML = '<option value="">全部日期</option>';

  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    els.daySelect.appendChild(option);
  });

  if (dates.length) {
    els.startDate.value = dates[0];
    els.endDate.value = dates[dates.length - 1];
  }
}

function renderStats(stats = {}) {
  const items = [
    ["总点数", stats.total_points ?? 0],
    ["城市数", stats.city_count ?? 0],
    ["国家/地区", stats.country_count ?? 0],
    ["最早记录", stats.earliest_time || "-"],
    ["最新记录", stats.latest_time || "-"],
  ];

  els.stats.innerHTML = items
    .map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");
}

function popupHtml(point) {
  const location = [point.address, point.city, point.province, point.country].filter(Boolean).join(" / ");
  const rows = [
    ["时间", point.display_time || point.time || "-"],
    ["位置", location || "-"],
    ["经纬度", `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`],
    ["海拔", point.altitude ?? ""],
    ["速度", point.speed ?? ""],
  ].filter(([, value]) => value !== "");

  const extras = Object.entries(point.extra || {}).slice(0, 20);
  return [...rows, ...extras]
    .map(([key, value]) => `<div class="popup-row"><b>${escapeHtml(key)}</b><span>${escapeHtml(String(value))}</span></div>`)
    .join("");
}

function addLayer(layer) {
  layer.addTo(state.map);
  state.layers.push(layer);
}

function clearLayers() {
  state.layers.forEach((layer) => layer.remove());
  state.layers = [];
}

function showEmpty(message) {
  els.empty.textContent = message;
  els.empty.classList.remove("hidden");
  els.status.textContent = message;
}

function hideEmpty() {
  els.empty.classList.add("hidden");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `请求失败：${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}
