const canvas = document.getElementById("universe");
const ctx = canvas.getContext("2d");
const epochCount = document.getElementById("epochCount");
const civilizationCount = document.getElementById("civilizationCount");
const yearCount = document.getElementById("yearCount");
const civilizationAge = document.getElementById("civilizationAge");
const civilizationRanking = document.getElementById("civilizationRanking");
const civilizationDeathNotice = document.getElementById("civilizationDeathNotice");
const climateState = document.getElementById("climateState");
const climateDetail = document.getElementById("climateDetail");
const civilizationBanner = document.getElementById("civilizationBanner");
const systemStatus = document.getElementById("systemStatus");
const speedButtons = Array.from(document.querySelectorAll("[data-speed]"));

const STAR_TRAIL_LENGTH = 150;
const PLANET_TRAIL_LENGTH = Math.max(220, STAR_TRAIL_LENGTH * 4);
const INTERPOLATION_DELAY_MS = 120;
const MAX_SNAPSHOT_BUFFER = 8;

const stars = [
  {
    name: "Alpha Centauri A",
    color: "#f7dd7a",
    rgb: "247, 221, 122",
    halo: "rgba(247, 221, 122, 0.28)",
    size: 22,
  },
  {
    name: "Alpha Centauri B",
    color: "#ffb06a",
    rgb: "255, 176, 106",
    halo: "rgba(255, 176, 106, 0.24)",
    size: 15.4,
  },
  {
    name: "Proxima Centauri",
    color: "#ff6a3d",
    rgb: "255, 106, 61",
    halo: "rgba(255, 106, 61, 0.24)",
    size: 5.5,
  },
];

const planetStyle = {
  color: "#8ff7ff",
  glow: "rgba(143, 247, 255, 0.28)",
  rgb: "143, 247, 255",
  size: 2.2,
};

const viewerState = {
  latestSnapshot: null,
  snapshotBuffer: [],
  trails: stars.map(() => []),
  planetTrail: [],
  eventSource: null,
  reconnectTimer: 0,
  lastEpoch: 0,
  serverTimeOffsetMs: null,
};

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function formatYears(years) {
  return Math.round(Math.max(0, years)).toLocaleString("ru-RU");
}

function clearTrails() {
  viewerState.trails.forEach((trail) => {
    trail.length = 0;
  });
  viewerState.planetTrail.length = 0;
}

function recordTrails(snapshot) {
  snapshot.positions.forEach((point, index) => {
    const trail = viewerState.trails[index];
    trail.push({ x: point.x, y: point.y });
    while (trail.length > STAR_TRAIL_LENGTH) {
      trail.shift();
    }
  });

  if (!snapshot.planet) {
    return;
  }

  viewerState.planetTrail.push({ x: snapshot.planet.x, y: snapshot.planet.y });
  while (viewerState.planetTrail.length > PLANET_TRAIL_LENGTH) {
    viewerState.planetTrail.shift();
  }
}

function updateSpeedUi(timeScale) {
  speedButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.speed) === timeScale);
  });
}

function renderCivilizationRanking(entries) {
  if (!entries.length) {
    civilizationRanking.innerHTML =
      '<li class="epoch-ranking-empty">Пока нет завершённых цивилизаций</li>';
    return;
  }

  civilizationRanking.innerHTML = entries
    .map(
      (entry) =>
        `<li><strong>${formatYears(entry.years)} лет</strong><p>${entry.reason}</p><span>эпоха ${entry.epoch}, цивилизация ${entry.civilization}</span></li>`
    )
    .join("");
}

function updateBanner(banner) {
  if (!banner) {
    civilizationBanner.hidden = true;
    civilizationBanner.className = "civilization-banner";
    civilizationBanner.textContent = "";
    return;
  }

  civilizationBanner.textContent = banner.text;
  civilizationBanner.hidden = false;
  civilizationBanner.className = `civilization-banner ${
    banner.variant ? `is-${banner.variant}` : ""
  }`.trim();
}

function updateUi(snapshot) {
  epochCount.textContent = String(snapshot.epochs);
  civilizationCount.textContent = String(snapshot.civilizations);
  yearCount.textContent = formatYears(snapshot.yearCountYears);
  civilizationAge.textContent = formatYears(snapshot.civilizationAgeYears);
  civilizationDeathNotice.hidden = !snapshot.civilizationDeathVisible;
  climateState.textContent = snapshot.climate.label;
  climateDetail.textContent = snapshot.climate.detail;
  systemStatus.textContent = snapshot.statusText;
  renderCivilizationRanking(snapshot.topCivilizations);
  updateBanner(snapshot.banner);
  updateSpeedUi(snapshot.timeScale);
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function lerpPoint(from, to, alpha) {
  return {
    x: lerp(from.x, to.x, alpha),
    y: lerp(from.y, to.y, alpha),
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function interpolateEvent(fromEvent, toEvent, alpha, renderServerTimeMs) {
  if (!fromEvent || !toEvent || fromEvent.type !== toEvent.type) {
    return cloneValue(toEvent || fromEvent);
  }

  const event = cloneValue(toEvent);
  event.positions = fromEvent.positions.map((point, index) =>
    lerpPoint(point, toEvent.positions[index], alpha)
  );
  if (fromEvent.planetPosition && toEvent.planetPosition) {
    event.planetPosition = lerpPoint(
      fromEvent.planetPosition,
      toEvent.planetPosition,
      alpha
    );
  }

  if (fromEvent.type === "planetImpact") {
    event.impactAngle = lerp(fromEvent.impactAngle, toEvent.impactAngle, alpha);
  }

  if (event.type === "planetDisruption" || event.type === "starCollision") {
    event.fragments = cloneValue(toEvent.fragments);
  }

  const durationMs = Math.max(event.restartAtMs - event.startMs, 1);
  event.elapsedMs = Math.max(0, renderServerTimeMs - event.startMs);
  event.progress = clamp01(event.elapsedMs / durationMs);
  return event;
}

function interpolateSnapshot(fromSnapshot, toSnapshot, alpha, renderServerTimeMs) {
  if (!fromSnapshot) {
    return cloneValue(toSnapshot);
  }
  if (!toSnapshot || fromSnapshot.epochs !== toSnapshot.epochs) {
    return cloneValue(fromSnapshot);
  }

  const snapshot = cloneValue(toSnapshot);
  snapshot.positions = fromSnapshot.positions.map((point, index) =>
    lerpPoint(point, toSnapshot.positions[index], alpha)
  );
  snapshot.yearCountYears = lerp(
    fromSnapshot.yearCountYears,
    toSnapshot.yearCountYears,
    alpha
  );
  snapshot.civilizationAgeYears = lerp(
    fromSnapshot.civilizationAgeYears,
    toSnapshot.civilizationAgeYears,
    alpha
  );
  snapshot.climate = {
    ...toSnapshot.climate,
    flux: lerp(fromSnapshot.climate.flux, toSnapshot.climate.flux, alpha),
    balance: lerp(fromSnapshot.climate.balance, toSnapshot.climate.balance, alpha),
  };

  if (fromSnapshot.planet && toSnapshot.planet) {
    snapshot.planet = {
      ...toSnapshot.planet,
      ...lerpPoint(fromSnapshot.planet, toSnapshot.planet, alpha),
      vx: lerp(fromSnapshot.planet.vx, toSnapshot.planet.vx, alpha),
      vy: lerp(fromSnapshot.planet.vy, toSnapshot.planet.vy, alpha),
    };
  } else if (!fromSnapshot.planet || !toSnapshot.planet) {
    snapshot.planet = toSnapshot.planet || fromSnapshot.planet;
  }

  if (fromSnapshot.deathPulse && toSnapshot.deathPulse) {
    snapshot.deathPulse = {
      mode: toSnapshot.deathPulse.mode,
      progress: lerp(
        fromSnapshot.deathPulse.progress,
        toSnapshot.deathPulse.progress,
        alpha
      ),
    };
  }

  if (
    fromSnapshot.rebirthPulseProgress !== null &&
    toSnapshot.rebirthPulseProgress !== null
  ) {
    snapshot.rebirthPulseProgress = lerp(
      fromSnapshot.rebirthPulseProgress,
      toSnapshot.rebirthPulseProgress,
      alpha
    );
  }

  snapshot.event = interpolateEvent(
    fromSnapshot.event,
    toSnapshot.event,
    alpha,
    renderServerTimeMs
  );

  return snapshot;
}

function getRenderSnapshot() {
  if (!viewerState.latestSnapshot) {
    return null;
  }

  const snapshots = viewerState.snapshotBuffer;
  if (snapshots.length === 0 || viewerState.serverTimeOffsetMs === null) {
    return viewerState.latestSnapshot;
  }

  const renderServerTimeMs =
    performance.now() - viewerState.serverTimeOffsetMs - INTERPOLATION_DELAY_MS;

  let nextIndex = snapshots.findIndex(
    (entry) => entry.snapshot.nowMs >= renderServerTimeMs
  );

  if (nextIndex === -1) {
    return snapshots[snapshots.length - 1].snapshot;
  }

  if (nextIndex === 0) {
    return snapshots[0].snapshot;
  }

  const previous = snapshots[nextIndex - 1].snapshot;
  const next = snapshots[nextIndex].snapshot;
  const durationMs = Math.max(next.nowMs - previous.nowMs, 1);
  const alpha = clamp01((renderServerTimeMs - previous.nowMs) / durationMs);
  return interpolateSnapshot(previous, next, alpha, renderServerTimeMs);
}

function drawBackground(width, height) {
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    0,
    width * 0.5,
    height * 0.5,
    width * 0.44
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.045)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function getTrailPoints(trail, maxPoints = 90) {
  if (trail.length < 2) {
    return [];
  }

  const stride = Math.max(1, Math.ceil(trail.length / maxPoints));
  const points = [];

  for (let index = 0; index < trail.length; index += stride) {
    points.push(trail[index]);
  }

  const lastPoint = trail[trail.length - 1];
  if (points[points.length - 1] !== lastPoint) {
    points.push(lastPoint);
  }

  return points;
}

function strokeTrailLayer(cx, cy, points, options) {
  const {
    startRatio,
    color,
    widthMin,
    widthMax,
    alphaMin,
    alphaMax,
  } = options;
  const startIndex = Math.max(0, Math.floor(points.length * startRatio) - 1);
  if (points.length - startIndex < 2) {
    return;
  }

  for (let index = startIndex + 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const progress = (index - startIndex) / (points.length - startIndex - 1 || 1);
    const eased = progress * progress;
    ctx.beginPath();
    ctx.moveTo(cx + previous.x, cy + previous.y);
    ctx.lineTo(cx + current.x, cy + current.y);
    ctx.strokeStyle = `rgba(${color}, ${alphaMin + (alphaMax - alphaMin) * eased})`;
    ctx.lineWidth = widthMin + (widthMax - widthMin) * eased;
    ctx.stroke();
  }
}

function drawTrail(cx, cy, trail, star) {
  const points = getTrailPoints(trail, 70);
  if (points.length < 2) {
    return;
  }

  const referenceSize = stars[2].size;
  const trailScale = Math.min(1.32, Math.sqrt(star.size / referenceSize));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeTrailLayer(cx, cy, points, {
    startRatio: 0,
    color: star.rgb,
    widthMin: 1.05 * trailScale,
    widthMax: 2.4 * trailScale,
    alphaMin: 0.018,
    alphaMax: 0.22,
  });
  strokeTrailLayer(cx, cy, points, {
    startRatio: 0.38,
    color: star.rgb,
    widthMin: 1.25 * trailScale,
    widthMax: 1.9 * trailScale,
    alphaMin: 0.08,
    alphaMax: 0.76,
  });
  ctx.restore();
}

function drawPlanetTrail(cx, cy) {
  const points = getTrailPoints(viewerState.planetTrail, 160);
  if (points.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(cx + points[0].x, cy + points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(cx + points[index].x, cy + points[index].y);
  }
  ctx.strokeStyle = `rgba(${planetStyle.rgb}, 0.18)`;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx + points[0].x, cy + points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(cx + points[index].x, cy + points[index].y);
  }
  ctx.strokeStyle = `rgba(${planetStyle.rgb}, 0.6)`;
  ctx.lineWidth = 0.45;
  ctx.stroke();
  ctx.restore();
}

function drawStar(x, y, star) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, star.size * 3.8);
  glow.addColorStop(0, star.halo);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, star.size * 3.8, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(
    x - star.size * 0.24,
    y - star.size * 0.26,
    star.size * 0.12,
    x,
    y,
    star.size
  );
  core.addColorStop(0, "#fffefb");
  core.addColorStop(0.45, star.color);
  core.addColorStop(1, "rgba(255,255,255,0.16)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, star.size, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlanet(x, y) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, planetStyle.size * 4.8);
  glow.addColorStop(0, planetStyle.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, planetStyle.size * 4.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = planetStyle.color;
  ctx.beginPath();
  ctx.arc(x, y, planetStyle.size, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(x - 1.1, y - 1.1, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlanetImpactFlash(x, y, star, angle, progress) {
  const pulse = Math.sin(Math.min(progress, 1) * Math.PI);
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const flashX = x + normalX * star.size * 0.9;
  const flashY = y + normalY * star.size * 0.9;

  ctx.save();
  ctx.translate(flashX, flashY);
  ctx.rotate(angle);

  const flare = ctx.createRadialGradient(0, 0, 0, 0, 0, star.size * (1.4 + pulse * 1.8));
  flare.addColorStop(0, `rgba(${star.rgb}, ${0.7 * pulse})`);
  flare.addColorStop(0.55, `rgba(${star.rgb}, ${0.22 * pulse})`);
  flare.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = flare;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    star.size * (1.1 + pulse * 2.2),
    star.size * (0.55 + pulse * 1.1),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255, ${0.45 * pulse})`;
  ctx.lineWidth = 1.2;
  for (let index = -1; index <= 1; index += 1) {
    ctx.beginPath();
    ctx.moveTo(star.size * 0.15, index * star.size * 0.18);
    ctx.lineTo(
      star.size * (0.9 + pulse * 1.6),
      index * star.size * (0.24 + pulse * 0.2)
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawClimatePulse(x, y, mode, progress) {
  const pulse = 0.35 + Math.sin(progress * Math.PI) * 0.65;
  const color =
    mode === "climateBurn"
      ? "255, 96, 72"
      : mode === "climateFreeze"
        ? "145, 209, 255"
        : "102, 236, 143";
  const radius = planetStyle.size * (mode === "rebirth" ? 5 + pulse * 7 : 6 + pulse * 8);

  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(
    0,
    `rgba(${color}, ${mode === "rebirth" ? 0.42 * pulse : 0.38 * pulse})`
  );
  glow.addColorStop(
    0.5,
    `rgba(${color}, ${mode === "rebirth" ? 0.2 * pulse : 0.16 * pulse})`
  );
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(${color}, ${0.8 * pulse})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, planetStyle.size * (1.8 + pulse * 1.7), 0, Math.PI * 2);
  ctx.stroke();

  if (mode === "rebirth") {
    ctx.strokeStyle = `rgba(${color}, ${0.45 * pulse})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, planetStyle.size * (3 + pulse * 3.4), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFragments(cx, cy, fragments, elapsedMs, progress) {
  const age = elapsedMs * 0.001;

  ctx.save();
  fragments.forEach((fragment) => {
    const x = fragment.x + fragment.vx * age + fragment.driftX * age * age;
    const y = fragment.y + fragment.vy * age + fragment.driftY * age * age;
    const alpha = fragment.alpha * (1 - progress);
    if (alpha <= 0.01) {
      return;
    }

    ctx.fillStyle = `rgba(${fragment.color}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(cx + x, cy + y, fragment.size * (1 - progress * 0.25), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawCommonScene(cx, cy) {
  viewerState.trails.forEach((trail, index) => {
    drawTrail(cx, cy, trail, stars[index]);
  });
  drawPlanetTrail(cx, cy);

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
}

function drawEventFrame(cx, cy, event) {
  const hiddenStars =
    event.type === "starCollision" ? new Set(event.collisionPair) : new Set();

  drawCommonScene(cx, cy);

  event.positions.forEach((point, index) => {
    if (!hiddenStars.has(index)) {
      drawStar(cx + point.x, cy + point.y, stars[index]);
    }
  });

  if (event.type === "planetImpact") {
    const starIndex = event.starIndex;
    drawPlanetImpactFlash(
      cx + event.positions[starIndex].x,
      cy + event.positions[starIndex].y,
      stars[starIndex],
      event.impactAngle,
      event.progress
    );
    return;
  }

  if (event.type === "planetDisruption" || event.type === "starCollision") {
    drawFragments(cx, cy, event.fragments, event.elapsedMs, event.progress);
    return;
  }

  if (event.type === "planetEscape" && event.planetPosition) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.18, 1 - event.progress);
    drawPlanet(cx + event.planetPosition.x, cy + event.planetPosition.y);
    ctx.restore();
  }
}

function render() {
  const snapshot = getRenderSnapshot();
  if (!snapshot) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);

  const cx = width / 2;
  const cy = height / 2;

  if (snapshot.event) {
    drawEventFrame(cx, cy, snapshot.event);
    return;
  }

  drawCommonScene(cx, cy);

  snapshot.positions.forEach((point, index) => {
    drawStar(cx + point.x, cy + point.y, stars[index]);
  });

  if (snapshot.planet) {
    drawPlanet(cx + snapshot.planet.x, cy + snapshot.planet.y);
    if (snapshot.deathPulse) {
      drawClimatePulse(
        cx + snapshot.planet.x,
        cy + snapshot.planet.y,
        snapshot.deathPulse.mode,
        snapshot.deathPulse.progress
      );
    } else if (snapshot.rebirthPulseProgress !== null) {
      drawClimatePulse(
        cx + snapshot.planet.x,
        cy + snapshot.planet.y,
        "rebirth",
        snapshot.rebirthPulseProgress
      );
    }
  }
}

function applySnapshot(snapshot) {
  const receivedAtMs = performance.now();
  const sampleOffsetMs = receivedAtMs - snapshot.nowMs;
  viewerState.serverTimeOffsetMs =
    viewerState.serverTimeOffsetMs === null
      ? sampleOffsetMs
      : lerp(viewerState.serverTimeOffsetMs, sampleOffsetMs, 0.2);

  if (viewerState.lastEpoch !== snapshot.epochs) {
    clearTrails();
    viewerState.snapshotBuffer.length = 0;
    viewerState.lastEpoch = snapshot.epochs;
  }

  if (!snapshot.event) {
    recordTrails(snapshot);
  }

  viewerState.latestSnapshot = snapshot;
  viewerState.snapshotBuffer.push({
    receivedAtMs,
    snapshot,
  });
  while (viewerState.snapshotBuffer.length > MAX_SNAPSHOT_BUFFER) {
    viewerState.snapshotBuffer.shift();
  }
  updateUi(snapshot);
}

async function sendTimeScaleUpdate(timeScale) {
  try {
    await fetch("/api/time-scale", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ timeScale }),
    });
  } catch (error) {
    console.warn("Failed to update server time scale", error);
  }
}

function scheduleReconnect() {
  if (viewerState.reconnectTimer) {
    return;
  }

  viewerState.reconnectTimer = window.setTimeout(() => {
    viewerState.reconnectTimer = 0;
    connectStream();
  }, 1000);
}

function connectStream() {
  if (viewerState.eventSource) {
    viewerState.eventSource.close();
  }

  const eventSource = new EventSource("/api/stream");
  viewerState.eventSource = eventSource;

  eventSource.onmessage = (event) => {
    const snapshot = JSON.parse(event.data);
    applySnapshot(snapshot);
  };

  eventSource.onerror = () => {
    eventSource.close();
    viewerState.eventSource = null;
    scheduleReconnect();
  };
}

window.addEventListener("resize", resizeCanvas);
speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sendTimeScaleUpdate(Number(button.dataset.speed));
  });
});

resizeCanvas();
connectStream();
requestAnimationFrame(function frame() {
  render();
  requestAnimationFrame(frame);
});
