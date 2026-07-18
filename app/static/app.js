const state = {
  points: [],
  mode: "points",
  layers: [],
  map: null,
  canvasLayer: null,
  fitted: false,
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

  state.canvasLayer = new CanvasPointsLayer();
  bindControls();
  await loadFootprints();
}

async function loadFootprints() {
  try {
    els.status.textContent = "正在读取 data/footprint.csv";
    const data = await fetchJson("/api/footprints");
    state.points = data.points || [];
    renderStats(data.stats);
    hydrateDateControls(state.points);
    els.status.textContent = `已载入 ${state.points.length.toLocaleString()} 个足迹点`;
    render(true);
  } catch (error) {
    renderStats();
    showEmpty(error.message || "读取 CSV 失败，请检查 data/footprint.csv。");
  }
}

function bindControls() {
  [els.startDate, els.endDate, els.daySelect].forEach((input) => {
    input.addEventListener("change", () => render(true));
  });

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      els.modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      render(false);
    });
  });
}

function render(shouldFit) {
  clearLayers();
  const points = filteredPoints();

  if (!points.length) {
    showEmpty("当前筛选条件下没有足迹点。");
    return;
  }
  hideEmpty();

  if (state.mode === "heat") {
    state.canvasLayer.removeFrom(state.map);
    const heatData = points.map((point) => [point.latitude, point.longitude, 0.7]);
    addLayer(L.heatLayer(heatData, { radius: 22, blur: 18, maxZoom: 12 }));
    els.status.textContent = `热力图：${points.length.toLocaleString()} 个足迹点`;
  } else {
    state.canvasLayer.setPoints(points);
    state.canvasLayer.addTo(state.map);

    if (state.mode === "line") {
      const linePoints = samplePoints(points, 50000);
      addLayer(
        L.polyline(
          linePoints.map((point) => [point.latitude, point.longitude]),
          { color: "#2563eb", weight: 3, opacity: 0.72 },
        ),
      );
      els.status.textContent =
        linePoints.length === points.length
          ? `轨迹线：${points.length.toLocaleString()} 个足迹点`
          : `轨迹线已抽样显示 ${linePoints.length.toLocaleString()} / ${points.length.toLocaleString()} 个点，可选择单日查看完整轨迹`;
    } else {
      els.status.textContent = `点模式：${points.length.toLocaleString()} 个足迹点，点击附近点可查看详情`;
    }
  }

  if (shouldFit || !state.fitted) {
    fitToPoints(points);
    state.fitted = true;
  }
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

function fitToPoints(points) {
  const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
  state.map.fitBounds(bounds.pad(0.12), { maxZoom: 14 });
}

function samplePoints(points, maxCount) {
  if (points.length <= maxCount) return points;
  const step = Math.ceil(points.length / maxCount);
  const sampled = [];
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
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

const CanvasPointsLayer = L.Layer.extend({
  initialize() {
    this.points = [];
    this.canvas = L.DomUtil.create("canvas", "leaflet-canvas-points");
    this.ctx = this.canvas.getContext("2d");
    this.clickHandler = this.handleClick.bind(this);
  },

  setPoints(points) {
    this.points = points || [];
    this.redraw();
  },

  onAdd(map) {
    this.map = map;
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on("moveend zoomend resize", this.redraw, this);
    map.on("click", this.clickHandler);
    this.redraw();
  },

  onRemove(map) {
    L.DomUtil.remove(this.canvas);
    map.off("moveend zoomend resize", this.redraw, this);
    map.off("click", this.clickHandler);
  },

  redraw() {
    if (!this.map || !this.ctx) return;

    const size = this.map.getSize();
    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
    this.canvas.width = size.x;
    this.canvas.height = size.y;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.fillStyle = "rgba(20, 184, 166, 0.65)";
    ctx.strokeStyle = "rgba(15, 118, 110, 0.8)";
    ctx.lineWidth = 1;

    const radius = this.map.getZoom() >= 13 ? 3 : this.map.getZoom() >= 9 ? 2 : 1.4;
    const bounds = this.map.getBounds().pad(0.1);

    ctx.beginPath();
    for (const point of this.points) {
      if (!bounds.contains([point.latitude, point.longitude])) continue;
      const pixel = this.map.latLngToContainerPoint([point.latitude, point.longitude]);
      ctx.moveTo(pixel.x + radius, pixel.y);
      ctx.arc(pixel.x, pixel.y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  },

  handleClick(event) {
    if (!this.map || !this.points.length) return;

    const clickPoint = this.map.latLngToContainerPoint(event.latlng);
    const bounds = this.map.getBounds().pad(0.05);
    let nearest = null;
    let nearestDistance = Infinity;

    for (const point of this.points) {
      if (!bounds.contains([point.latitude, point.longitude])) continue;
      const pixel = this.map.latLngToContainerPoint([point.latitude, point.longitude]);
      const dx = pixel.x - clickPoint.x;
      const dy = pixel.y - clickPoint.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = point;
      }
    }

    if (nearest && nearestDistance <= 144) {
      L.popup()
        .setLatLng([nearest.latitude, nearest.longitude])
        .setContent(popupHtml(nearest))
        .openOn(this.map);
    }
  },
});
