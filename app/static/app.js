const state = {
  points: [],
  mode: "points",
  layers: [],
  map: null,
  canvasLayer: null,
  summary: null,
  requestId: 0,
  isProgrammaticMove: false,
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
  state.map = L.map("map", {
    bounceAtZoomLimits: false,
    inertia: true,
    inertiaDeceleration: 2500,
    inertiaMaxSpeed: 1600,
    preferCanvas: true,
    renderer: L.canvas({ padding: 0.35, tolerance: 8 }),
    worldCopyJump: true,
    wheelDebounceTime: 20,
    wheelPxPerZoomLevel: 140,
    zoomAnimation: true,
    zoomDelta: 0.5,
    zoomSnap: 0.25,
  }).setView([35.8617, 104.1954], 4);
  L.tileLayer(config.tile_url, {
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenIdle: false,
    updateWhenZooming: false,
    attribution: config.tile_attribution,
  }).addTo(state.map);

  state.canvasLayer = new CanvasPointsLayer();
  bindControls();
  await loadSummary();
}

async function loadSummary() {
  try {
    els.status.textContent = "正在读取 data/footprint.csv";
    const data = await fetchJson("/api/summary");
    state.summary = data;
    renderStats(data.stats);
    hydrateDateControls(data.stats.dates || []);

    state.map.invalidateSize();
    if (data.stats.bounds) {
      state.isProgrammaticMove = true;
      requestAnimationFrame(() => {
        state.map.invalidateSize();
        state.map.fitBounds(
          [
            [data.stats.bounds.south, data.stats.bounds.west],
            [data.stats.bounds.north, data.stats.bounds.east],
          ],
          { maxZoom: 14, padding: [20, 20] },
        );
        state.isProgrammaticMove = false;
        loadVisibleFootprints();
      });
    } else {
      await loadVisibleFootprints();
    }
  } catch (error) {
    renderStats();
    showEmpty(error.message || "读取 CSV 失败，请检查 data/footprint.csv。");
  }
}

function bindControls() {
  const debouncedLoad = debounce(loadVisibleFootprints, 450);
  const startInteraction = () => document.body.classList.add("is-map-interacting");
  const endInteraction = debounce(() => document.body.classList.remove("is-map-interacting"), 180);

  state.map.on("movestart zoomstart", startInteraction);
  state.map.on("moveend zoomend", endInteraction);
  state.map.on("moveend zoomend", () => {
    if (!state.isProgrammaticMove) debouncedLoad();
  });

  [els.startDate, els.endDate, els.daySelect].forEach((input) => {
    input.addEventListener("change", () => loadVisibleFootprints());
  });

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      els.modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      render();
      loadVisibleFootprints();
    });
  });
}

async function loadVisibleFootprints() {
  if (!state.map) return;
  const requestId = ++state.requestId;
  const bounds = state.map.getBounds().pad(0.15);
  const params = new URLSearchParams({
    west: bounds.getWest().toFixed(6),
    south: bounds.getSouth().toFixed(6),
    east: bounds.getEast().toFixed(6),
    north: bounds.getNorth().toFixed(6),
    limit: String(limitForMode()),
  });

  if (els.daySelect.value) params.set("day", els.daySelect.value);
  if (els.startDate.value) params.set("start", els.startDate.value);
  if (els.endDate.value) params.set("end", els.endDate.value);

  els.status.textContent = "正在加载当前地图范围";
  try {
    const data = await fetchJson(`/api/footprints?${params.toString()}`);
    if (requestId !== state.requestId) return;
    state.points = data.points || [];
    state.map.invalidateSize();
    render(data);
  } catch (error) {
    if (requestId !== state.requestId) return;
    showEmpty(error.message || "加载当前地图范围失败。");
  }
}

function render(meta = {}) {
  clearLayers();

  if (!state.points.length) {
    state.canvasLayer.removeFrom(state.map);
    showEmpty("当前地图范围或筛选条件下没有足迹点。");
    return;
  }
  hideEmpty();

  if (state.mode === "heat") {
    state.canvasLayer.removeFrom(state.map);
    const heatData = state.points.map((point) => [point.latitude, point.longitude, 0.7]);
    addLayer(L.heatLayer(heatData, { radius: 22, blur: 18, maxZoom: 12 }));
  } else if (state.mode === "line") {
    state.canvasLayer.removeFrom(state.map);
    addLayer(
      L.polyline(
        state.points.map((point) => [point.latitude, point.longitude]),
        { color: "#2563eb", opacity: 0.72, smoothFactor: lineSmoothFactor(), weight: 3 },
      ),
    );
  } else {
    state.canvasLayer.setPoints(state.points);
    state.canvasLayer.addTo(state.map);
  }

  els.status.textContent = statusText(meta);
}

function statusText(meta) {
  const returned = meta.returned ?? state.points.length;
  const matched = meta.total_matched ?? returned;
  if (meta.sampled) {
    return `当前范围匹配 ${matched.toLocaleString()} 个点，已抽样显示 ${returned.toLocaleString()} 个`;
  }
  return `当前范围显示 ${returned.toLocaleString()} 个足迹点`;
}

function limitForMode() {
  const zoom = state.map?.getZoom() ?? 4;
  if (state.mode === "line") {
    if (els.daySelect.value) return zoom < 8 ? 16000 : 50000;
    if (zoom < 6) return 4000;
    if (zoom < 9) return 8000;
    return 14000;
  }
  if (state.mode === "heat") return zoom < 8 ? 12000 : 20000;
  if (zoom < 6) return 5000;
  if (zoom < 9) return 9000;
  return 14000;
}

function lineSmoothFactor() {
  const zoom = state.map?.getZoom() ?? 4;
  if (zoom < 6) return 5;
  if (zoom < 9) return 3;
  return 1.5;
}

function hydrateDateControls(dates) {
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

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

const CanvasPointsLayer = L.Layer.extend({
  initialize() {
    this.points = [];
    this.canvas = L.DomUtil.create("canvas", "leaflet-canvas-points");
    this.ctx = this.canvas.getContext("2d");
    this.clickHandler = this.handleClick.bind(this);
    this.redrawFrame = null;
  },

  setPoints(points) {
    this.points = points || [];
    this.redraw();
  },

  onAdd(map) {
    this.map = map;
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on("moveend zoomend resize", this.scheduleRedraw, this);
    map.on("click", this.clickHandler);
    this.redraw();
  },

  onRemove(map) {
    if (this.canvas.parentNode) L.DomUtil.remove(this.canvas);
    map.off("moveend zoomend resize", this.scheduleRedraw, this);
    map.off("click", this.clickHandler);
    if (this.redrawFrame) cancelAnimationFrame(this.redrawFrame);
    this.redrawFrame = null;
  },

  scheduleRedraw() {
    if (this.redrawFrame) return;
    this.redrawFrame = requestAnimationFrame(() => {
      this.redrawFrame = null;
      this.redraw();
    });
  },

  redraw() {
    if (!this.map || !this.ctx || !this.canvas.parentNode) return;

    const drawBounds = this.map.getBounds().pad(0.1);
    const topLeft = this.map.latLngToLayerPoint(drawBounds.getNorthWest());
    const bottomRight = this.map.latLngToLayerPoint(drawBounds.getSouthEast());
    const size = bottomRight.subtract(topLeft);

    L.DomUtil.setPosition(this.canvas, topLeft);
    this.canvas.width = Math.max(1, Math.ceil(size.x));
    this.canvas.height = Math.max(1, Math.ceil(size.y));

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "rgba(20, 184, 166, 0.68)";
    ctx.strokeStyle = "rgba(15, 118, 110, 0.8)";
    ctx.lineWidth = 1;

    const zoom = this.map.getZoom();
    const radius = zoom >= 13 ? 3 : zoom >= 9 ? 2 : 1.4;

    ctx.beginPath();
    for (const point of this.points) {
      if (!drawBounds.contains([point.latitude, point.longitude])) continue;
      const pixel = this.map.latLngToLayerPoint([point.latitude, point.longitude]).subtract(topLeft);
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
