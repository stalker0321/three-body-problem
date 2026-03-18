const canvas = document.getElementById("universe");
const ctx = canvas.getContext("2d");
const epochCount = document.getElementById("epochCount");
const yearCount = document.getElementById("yearCount");
const planetBClimateState = document.getElementById("planetBClimateState");
const planetBClimateDetail = document.getElementById("planetBClimateDetail");
const planetBDistance = document.getElementById("planetBDistance");
const planetBStress = document.getElementById("planetBStress");
const planetCClimateState = document.getElementById("planetCClimateState");
const planetCClimateDetail = document.getElementById("planetCClimateDetail");
const planetCDistance = document.getElementById("planetCDistance");
const planetCStress = document.getElementById("planetCStress");
const systemStatus = document.getElementById("systemStatus");
const regimeLabel = document.getElementById("regimeLabel");
const speedButtons = Array.from(document.querySelectorAll("[data-speed]"));

const STAR_TRAIL_LENGTH = 150;
const PLANET_TRAIL_LENGTH = Math.max(220, STAR_TRAIL_LENGTH * 4);
const INTERPOLATION_DELAY_MS = 120;
const MAX_SNAPSHOT_BUFFER = 8;
const TRAIL_SAMPLE_MS = 1000 / 60;
const MIN_TRAIL_POINT_DISTANCE = 0.35;
const MAX_TRAIL_SEGMENT_LENGTH = 6;
const VIEW_SCALE = 0.8;

const sceneStars = [
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

const companionStyle = {
  color: "#d7ffb2",
  glow: "rgba(215, 255, 178, 0.24)",
  rgb: "215, 255, 178",
  size: 1.45,
};

const viewerState = {
  latestSnapshot: null,
  snapshotBuffer: [],
  trails: sceneStars.map(() => []),
  planetTrail: [],
  companionTrail: [],
  eventSource: null,
  reconnectTimer: 0,
  lastEpoch: 0,
  serverTimeOffsetMs: null,
  lastTrailSampleTimeMs: null,
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
  viewerState.companionTrail.length = 0;
  viewerState.lastTrailSampleTimeMs = null;
}

function updateSpeedUi(timeScale) {
  speedButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.speed) === timeScale);
  });
}

function formatSignedTemperature(temperatureCelsius) {
  if (temperatureCelsius === null || temperatureCelsius === undefined) {
    return "нет данных";
  }

  return `${temperatureCelsius >= 0 ? "+" : ""}${temperatureCelsius.toFixed(1)} °C`;
}

function updateUi(snapshot) {
  epochCount.textContent = String(snapshot.epochs);
  yearCount.textContent = formatYears(snapshot.yearCountYears);
  systemStatus.textContent = snapshot.statusText;
  regimeLabel.textContent = `Режим эпохи: ${snapshot.regimeName}`;

  const planetB = snapshot.planetInfo;
  const planetC = snapshot.companionInfo;

  planetBClimateState.textContent = planetB.alive ? planetB.climate.label : "Утрачена";
  planetBClimateDetail.textContent = planetB.alive
    ? planetB.climate.detail
    : "Планета разрушена или выброшена из системы";
  planetBDistance.textContent = planetB.alive
    ? `Удаление от барицентра · ${planetB.distanceFromBarycenterAu.toFixed(1)} а.е.`
    : "Удаление от барицентра · нет данных";
  planetBStress.textContent = snapshot.tidalStressSourceName
    ? `Приливный стресс · ${Math.round(snapshot.tidalStressRatio * 100)}% · ${snapshot.tidalStressSourceName}`
    : `Приливный стресс · ${Math.round(snapshot.tidalStressRatio * 100)}%`;

  planetCClimateState.textContent = planetC.alive ? planetC.climate.label : "Утрачена";
  planetCClimateDetail.textContent = planetC.alive
    ? planetC.climate.detail
    : "Планета разрушена или выброшена из системы";
  planetCDistance.textContent = planetC.alive
    ? `Удаление от барицентра · ${planetC.distanceFromBarycenterAu.toFixed(1)} а.е.`
    : "Удаление от барицентра · нет данных";
  planetCStress.textContent = snapshot.companionTidalStressSourceName
    ? `Приливный стресс · ${Math.round(snapshot.companionTidalStressRatio * 100)}% · ${snapshot.companionTidalStressSourceName}`
    : `Приливный стресс · ${Math.round(snapshot.companionTidalStressRatio * 100)}%`;

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
  snapshot.tidalStress = lerp(fromSnapshot.tidalStress, toSnapshot.tidalStress, alpha);
  snapshot.tidalStressRatio = lerp(
    fromSnapshot.tidalStressRatio,
    toSnapshot.tidalStressRatio,
    alpha
  );
  snapshot.companionTidalStress = lerp(
    fromSnapshot.companionTidalStress,
    toSnapshot.companionTidalStress,
    alpha
  );
  snapshot.companionTidalStressRatio = lerp(
    fromSnapshot.companionTidalStressRatio,
    toSnapshot.companionTidalStressRatio,
    alpha
  );

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

  if (fromSnapshot.companion && toSnapshot.companion) {
    snapshot.companion = {
      ...toSnapshot.companion,
      ...lerpPoint(fromSnapshot.companion, toSnapshot.companion, alpha),
      vx: lerp(fromSnapshot.companion.vx, toSnapshot.companion.vx, alpha),
      vy: lerp(fromSnapshot.companion.vy, toSnapshot.companion.vy, alpha),
    };
  } else if (!fromSnapshot.companion || !toSnapshot.companion) {
    snapshot.companion = toSnapshot.companion || fromSnapshot.companion;
  }

  if (
    fromSnapshot.planetInfo?.climate &&
    toSnapshot.planetInfo?.climate &&
    fromSnapshot.planetInfo.alive &&
    toSnapshot.planetInfo.alive
  ) {
    snapshot.planetInfo = {
      ...toSnapshot.planetInfo,
      distanceFromBarycenterAu: lerp(
        fromSnapshot.planetInfo.distanceFromBarycenterAu,
        toSnapshot.planetInfo.distanceFromBarycenterAu,
        alpha
      ),
      climate: {
        ...toSnapshot.planetInfo.climate,
        flux: lerp(
          fromSnapshot.planetInfo.climate.flux,
          toSnapshot.planetInfo.climate.flux,
          alpha
        ),
        temperatureCelsius: lerp(
          fromSnapshot.planetInfo.climate.temperatureCelsius,
          toSnapshot.planetInfo.climate.temperatureCelsius,
          alpha
        ),
      },
    };
  }

  if (
    fromSnapshot.companionInfo?.climate &&
    toSnapshot.companionInfo?.climate &&
    fromSnapshot.companionInfo.alive &&
    toSnapshot.companionInfo.alive
  ) {
    snapshot.companionInfo = {
      ...toSnapshot.companionInfo,
      distanceFromBarycenterAu: lerp(
        fromSnapshot.companionInfo.distanceFromBarycenterAu,
        toSnapshot.companionInfo.distanceFromBarycenterAu,
        alpha
      ),
      climate: {
        ...toSnapshot.companionInfo.climate,
        flux: lerp(
          fromSnapshot.companionInfo.climate.flux,
          toSnapshot.companionInfo.climate.flux,
          alpha
        ),
        temperatureCelsius: lerp(
          fromSnapshot.companionInfo.climate.temperatureCelsius,
          toSnapshot.companionInfo.climate.temperatureCelsius,
          alpha
        ),
      },
    };
  }

  snapshot.event = interpolateEvent(
    fromSnapshot.event,
    toSnapshot.event,
    alpha,
    renderServerTimeMs
  );
  snapshot.effects = toSnapshot.effects;

  return snapshot;
}

function getRenderFrame() {
  if (!viewerState.latestSnapshot) {
    return null;
  }

  const snapshots = viewerState.snapshotBuffer;
  if (snapshots.length === 0 || viewerState.serverTimeOffsetMs === null) {
    return {
      snapshot: viewerState.latestSnapshot,
      renderServerTimeMs: viewerState.latestSnapshot.nowMs,
    };
  }

  const renderServerTimeMs =
    performance.now() - viewerState.serverTimeOffsetMs - INTERPOLATION_DELAY_MS;

  let nextIndex = snapshots.findIndex(
    (entry) => entry.snapshot.nowMs >= renderServerTimeMs
  );

  if (nextIndex === -1) {
    const snapshot = snapshots[snapshots.length - 1].snapshot;
    return {
      snapshot,
      renderServerTimeMs: snapshot.nowMs,
    };
  }

  if (nextIndex === 0) {
    const snapshot = snapshots[0].snapshot;
    return {
      snapshot,
      renderServerTimeMs: snapshot.nowMs,
    };
  }

  const previous = snapshots[nextIndex - 1].snapshot;
  const next = snapshots[nextIndex].snapshot;
  const durationMs = Math.max(next.nowMs - previous.nowMs, 1);
  const alpha = clamp01((renderServerTimeMs - previous.nowMs) / durationMs);
  return {
    snapshot: interpolateSnapshot(previous, next, alpha, renderServerTimeMs),
    renderServerTimeMs,
  };
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

function buildRenderTrailPoints(trail, renderServerTimeMs, currentPoint, maxPoints) {
  const visiblePoints = trail.filter((point) => point.nowMs <= renderServerTimeMs);
  if (currentPoint) {
    const lastPoint = visiblePoints[visiblePoints.length - 1];
    if (
      !lastPoint ||
      lastPoint.x !== currentPoint.x ||
      lastPoint.y !== currentPoint.y
    ) {
      visiblePoints.push(currentPoint);
    }
  }
  return getTrailPoints(visiblePoints, maxPoints);
}

function appendTrailSample(trail, point, nowMs, maxLength) {
  const lastPoint = trail[trail.length - 1];
  if (lastPoint) {
    if (nowMs <= lastPoint.nowMs) {
      return;
    }

    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    if (
      distance < MIN_TRAIL_POINT_DISTANCE &&
      nowMs - lastPoint.nowMs < TRAIL_SAMPLE_MS * 1.5
    ) {
      return;
    }

    const segments = Math.max(1, Math.ceil(distance / MAX_TRAIL_SEGMENT_LENGTH));
    for (let index = 1; index <= segments; index += 1) {
      const alpha = index / segments;
      trail.push({
        x: lerp(lastPoint.x, point.x, alpha),
        y: lerp(lastPoint.y, point.y, alpha),
        nowMs: lerp(lastPoint.nowMs, nowMs, alpha),
      });
    }
    while (trail.length > maxLength) {
      trail.shift();
    }
    return;
  }

  trail.push({ x: point.x, y: point.y, nowMs });
  while (trail.length > maxLength) {
    trail.shift();
  }
}

function updateRenderTrails(snapshot, renderServerTimeMs) {
  if (snapshot.event) {
    return;
  }

  if (
    viewerState.lastTrailSampleTimeMs !== null &&
    renderServerTimeMs - viewerState.lastTrailSampleTimeMs < TRAIL_SAMPLE_MS
  ) {
    return;
  }

  snapshot.positions.forEach((point, index) => {
    appendTrailSample(
      viewerState.trails[index],
      point,
      renderServerTimeMs,
      STAR_TRAIL_LENGTH
    );
  });
  if (snapshot.planet) {
    appendTrailSample(
      viewerState.planetTrail,
      snapshot.planet,
      renderServerTimeMs,
      PLANET_TRAIL_LENGTH
    );
  }
  if (snapshot.companion) {
    appendTrailSample(
      viewerState.companionTrail,
      snapshot.companion,
      renderServerTimeMs,
      PLANET_TRAIL_LENGTH
    );
  }
  viewerState.lastTrailSampleTimeMs = renderServerTimeMs;
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

function drawTrail(cx, cy, trail, star, renderServerTimeMs, currentPoint) {
  const points = buildRenderTrailPoints(
    trail,
    renderServerTimeMs,
    currentPoint,
    70
  );
  if (points.length < 2) {
    return;
  }

  const referenceSize = sceneStars[2].size;
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

function drawOrbitalTrail(cx, cy, trail, style, renderServerTimeMs, currentPoint) {
  const points = buildRenderTrailPoints(
    trail,
    renderServerTimeMs,
    currentPoint,
    160
  );
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
  ctx.strokeStyle = `rgba(${style.rgb}, 0.18)`;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx + points[0].x, cy + points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(cx + points[index].x, cy + points[index].y);
  }
  ctx.strokeStyle = `rgba(${style.rgb}, 0.6)`;
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

function drawOrbitalBody(x, y, style) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, style.size * 4.8);
  glow.addColorStop(0, style.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, style.size * 4.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.arc(x, y, style.size, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(x - style.size * 0.5, y - style.size * 0.5, style.size * 0.54, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlanet(x, y) {
  drawOrbitalBody(x, y, planetStyle);
}

function drawCompanion(x, y) {
  drawOrbitalBody(x, y, companionStyle);
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

function drawCommonScene(cx, cy, positions, planet, companion, renderServerTimeMs) {
  viewerState.trails.forEach((trail, index) => {
    drawTrail(cx, cy, trail, sceneStars[index], renderServerTimeMs, positions[index]);
  });
  drawOrbitalTrail(cx, cy, viewerState.planetTrail, planetStyle, renderServerTimeMs, planet);
  drawOrbitalTrail(
    cx,
    cy,
    viewerState.companionTrail,
    companionStyle,
    renderServerTimeMs,
    companion
  );

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
}

function drawEventFrame(cx, cy, snapshot, renderServerTimeMs) {
  const event = snapshot.event;
  const hiddenStars =
    event.type === "starCollision" ? new Set(event.collisionPair) : new Set();

  drawCommonScene(
    cx,
    cy,
    event.positions,
    event.planetPosition || snapshot.planet,
    null,
    renderServerTimeMs
  );

  event.positions.forEach((point, index) => {
    if (!hiddenStars.has(index)) {
      drawStar(cx + point.x, cy + point.y, sceneStars[index]);
    }
  });

  if (event.type === "planetImpact") {
    const starIndex = event.starIndex;
    drawPlanetImpactFlash(
      cx + event.positions[starIndex].x,
      cy + event.positions[starIndex].y,
      sceneStars[starIndex],
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

function drawBodyEffects(cx, cy, effects) {
  effects.forEach((effect) => {
    if (effect.type === "planetImpact") {
      drawPlanetImpactFlash(
        cx + effect.positions[effect.starIndex].x,
        cy + effect.positions[effect.starIndex].y,
        sceneStars[effect.starIndex],
        effect.impactAngle,
        effect.progress
      );
      return;
    }

    if (effect.type === "planetDisruption") {
      drawFragments(cx, cy, effect.fragments, effect.elapsedMs, effect.progress);
      return;
    }

    if (effect.type === "planetEscape" && effect.planetPosition) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.18, 1 - effect.progress);
      const drawBody =
        effect.bodyName === "Proxima Centauri c" ? drawCompanion : drawPlanet;
      drawBody(cx + effect.planetPosition.x, cy + effect.planetPosition.y);
      ctx.restore();
    }
  });
}

function render() {
  const frame = getRenderFrame();
  if (!frame) {
    return;
  }
  const { snapshot, renderServerTimeMs } = frame;
  updateRenderTrails(snapshot, renderServerTimeMs);

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);

  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(VIEW_SCALE, VIEW_SCALE);

  if (snapshot.event) {
    drawEventFrame(0, 0, snapshot, renderServerTimeMs);
    drawBodyEffects(0, 0, snapshot.effects || []);
    ctx.restore();
    return;
  }

  drawCommonScene(
    0,
    0,
    snapshot.positions,
    snapshot.planet,
    snapshot.companion,
    renderServerTimeMs
  );

  snapshot.positions.forEach((point, index) => {
    drawStar(point.x, point.y, sceneStars[index]);
  });

  if (snapshot.planet) {
    drawPlanet(snapshot.planet.x, snapshot.planet.y);
  }
  if (snapshot.companion) {
    drawCompanion(snapshot.companion.x, snapshot.companion.y);
  }
  drawBodyEffects(0, 0, snapshot.effects || []);
  ctx.restore();
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

  if (viewerState.latestSnapshot?.companion && !snapshot.companion) {
    viewerState.companionTrail.length = 0;
  }
  if (viewerState.latestSnapshot?.planet && !snapshot.planet) {
    viewerState.planetTrail.length = 0;
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
window.addEventListener("replay:reset", () => {
  clearTrails();
  viewerState.latestSnapshot = null;
  viewerState.snapshotBuffer.length = 0;
  viewerState.lastEpoch = 0;
  viewerState.serverTimeOffsetMs = null;
  viewerState.lastTrailSampleTimeMs = null;
});
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
