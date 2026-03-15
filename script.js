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

const TRAIL_SAMPLE_MS = 18;
const PLANET_GRAVITY = 5200;
const PLANET_SOFTENING = 18;
const PLANET_MAX_SPEED = 260;
const PLANET_INTEGRATION_STEP_SECONDS = 0.01;
const PLANET_MAX_INTEGRATION_STEPS = 24;
const PLANET_IMPACT_RESTART_MS = 1450;
const STAR_COLLISION_RESTART_MS = 2200;
const CIVILIZATION_REBIRTH_MS = 10000;
const CIVILIZATION_BANNER_MS = 2600;
const CIVILIZATION_DEATH_PULSE_MS = 1000;
const CIVILIZATION_REBIRTH_PULSE_MS = 1400;
const CIVILIZATION_REBIRTH_TEMPERATURE = 0.2;
const FREEZE_DEATH_PULSE_MS = 360;
const FREEZE_DEATH_PULSE_COUNT = 3;
const YEARS_PER_SIMULATION_SECOND = 3.5;
const ALPHA_CENTAURI_AB_ECCENTRICITY = 0.52;
const ALPHA_CENTAURI_AB_PERIASTRON_MARGIN = 1.45;
const ROCHE_MULTIPLIERS = [1.15, 1.2, 1.35];
const STAR_LUMINOSITIES = [3800, 1700, 460];
const SAFE_FLUX_MIN = 0.72;
const SAFE_FLUX_MAX = 1.28;
const CLIMATE_RECOVERY_RATE = 22;
const HEAT_PRESSURE_RATE = 58;
const COLD_PRESSURE_RATE = 40;
const CLIMATE_LIMIT = 100;
const PLANET_INTERACTION_RADIUS = 190;
const PLANET_ESCAPE_RADIUS = 760;
const PLANET_ESCAPE_YEARS = 800;
const PLANET_START_RADIUS = 24;
const PLANET_START_ELLIPSE = 0.98;
const PLANET_START_ANGLE = Math.PI * 0.32;
const PLANET_START_IMPULSE = 0;
const state = {
  epochs: 0,
  timeScale: 1,
  simulationTimeSeconds: 0,
  epochStartTimeSeconds: 0,
  trailLength: 150,
  civilizations: 0,
  civilizationStartTimeSeconds: 0,
  lastTrailSampleMs: 0,
  statusUntilMs: 0,
  lastFrameMs: 0,
  epoch: null,
  planet: null,
  event: null,
  previousEpochYears: 0,
  topCivilizations: [],
  climateBalance: 0,
  lastFlux: 1,
  civilizationAlive: false,
  civilizationLogged: false,
  previousCivilizationYears: 0,
  pendingRebirthAtMs: 0,
  pendingRebirthReason: null,
  deathPulseStartMs: 0,
  rebirthPulseStartMs: 0,
  rebirthPulseUntilMs: 0,
  bannerUntilMs: 0,
  epochCivilizations: [],
  lastPlanetInteractionTimeSeconds: 0,
};

const stars = [
  {
    name: "Alpha Centauri A",
    color: "#f7dd7a",
    rgb: "247, 221, 122",
    halo: "rgba(247, 221, 122, 0.28)",
    size: 22,
    mass: 110,
    orbit: 82,
    phase: 0,
  },
  {
    name: "Alpha Centauri B",
    color: "#ffb06a",
    rgb: "255, 176, 106",
    halo: "rgba(255, 176, 106, 0.24)",
    size: 15.4,
    mass: 90,
    orbit: 96,
    phase: (Math.PI * 2) / 3,
  },
  {
    name: "Proxima Centauri",
    color: "#ff6a3d",
    rgb: "255, 106, 61",
    halo: "rgba(255, 106, 61, 0.24)",
    size: 5.5,
    mass: 12,
    orbit: 340,
    phase: (Math.PI * 4) / 3,
  },
];
const trails = stars.map(() => []);
const planetTrail = [];
const planetStyle = {
  color: "#8ff7ff",
  glow: "rgba(143, 247, 255, 0.28)",
  rgb: "143, 247, 255",
  size: 2.2,
};

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function createEpochConfig() {
  return {
    innerPhase: randomRange(0, Math.PI * 2),
    outerPhase: randomRange(0, Math.PI * 2),
    innerSpeedScale: randomRange(0.98, 1.035),
    outerSpeedScale: randomRange(0.97, 1.035),
    innerVerticalScale: randomRange(0.88, 0.96),
    outerVerticalScale: randomRange(0.48, 0.58),
    binaryScale: randomRange(0.97, 1.03),
    outerScale: randomRange(0.98, 1.05),
  };
}

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  const tau = Math.PI * 2;
  let normalizedMeanAnomaly = meanAnomaly % tau;
  if (normalizedMeanAnomaly < 0) {
    normalizedMeanAnomaly += tau;
  }

  let eccentricAnomaly =
    eccentricity < 0.8 ? normalizedMeanAnomaly : Math.PI;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - normalizedMeanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
  }

  return eccentricAnomaly;
}

function getStarPositions(time, epoch = state.epoch) {
  const innerBaseRelativeSemiMajor = stars[0].orbit + stars[1].orbit;
  const minInnerPeriastron =
    (stars[0].size + stars[1].size) * ALPHA_CENTAURI_AB_PERIASTRON_MARGIN;
  const preferredOuterSeparation = Math.max(stars[2].orbit * epoch.outerScale, 180);
  const minOuterSeparation = Math.max(minInnerPeriastron * 3.6, 190);
  const outerSeparation = Math.max(preferredOuterSeparation, minOuterSeparation);

  const massAB = stars[0].mass + stars[1].mass;
  const totalMass = massAB + stars[2].mass;
  const safeInnerRelativeSemiMajor =
    minInnerPeriastron / (1 - ALPHA_CENTAURI_AB_ECCENTRICITY);
  const maxInnerRelativeSemiMajor = outerSeparation * 0.32;
  const innerRelativeSemiMajor = Math.max(
    safeInnerRelativeSemiMajor,
    Math.min(innerBaseRelativeSemiMajor, maxInnerRelativeSemiMajor)
  );
  const outerAngle = time * 0.07 * epoch.outerSpeedScale + epoch.outerPhase;
  const outerDirection = {
    x: Math.cos(outerAngle),
    y: Math.sin(outerAngle) * epoch.outerVerticalScale,
  };
  const pairCenter = {
    x: -outerDirection.x * outerSeparation * (stars[2].mass / totalMass),
    y: -outerDirection.y * outerSeparation * (stars[2].mass / totalMass),
  };
  const starC = {
    x: outerDirection.x * outerSeparation * (massAB / totalMass),
    y: outerDirection.y * outerSeparation * (massAB / totalMass),
  };

  const innerMeanAnomaly = time * 0.34 + epoch.innerPhase;
  const innerEccentricAnomaly = solveEccentricAnomaly(
    innerMeanAnomaly,
    ALPHA_CENTAURI_AB_ECCENTRICITY
  );
  const innerRelativePosition = {
    x: innerRelativeSemiMajor * (Math.cos(innerEccentricAnomaly) - ALPHA_CENTAURI_AB_ECCENTRICITY),
    y:
      innerRelativeSemiMajor *
      Math.sqrt(1 - ALPHA_CENTAURI_AB_ECCENTRICITY ** 2) *
      Math.sin(innerEccentricAnomaly),
  };
  const positions = [
    {
      x: pairCenter.x - innerRelativePosition.x * (stars[1].mass / massAB),
      y: pairCenter.y - innerRelativePosition.y * (stars[1].mass / massAB),
    },
    {
      x: pairCenter.x + innerRelativePosition.x * (stars[0].mass / massAB),
      y: pairCenter.y + innerRelativePosition.y * (stars[0].mass / massAB),
    },
    starC,
  ];

  const barycenter = positions.reduce(
    (sum, point, index) => {
      sum.x += point.x * stars[index].mass;
      sum.y += point.y * stars[index].mass;
      return sum;
    },
    { x: 0, y: 0 }
  );

  barycenter.x /= totalMass;
  barycenter.y /= totalMass;

  return positions.map((point) => ({
    x: point.x - barycenter.x,
    y: point.y - barycenter.y,
  }));
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

function recordTrails(positions) {
  positions.forEach((point, index) => {
    const trail = trails[index];
    trail.push({ x: point.x, y: point.y });
    while (trail.length > state.trailLength) {
      trail.shift();
    }
  });
}

function recordPlanetTrail() {
  if (!state.planet) {
    return;
  }

  planetTrail.push({ x: state.planet.x, y: state.planet.y });
  const maxLength = Math.max(220, state.trailLength * 4);
  while (planetTrail.length > maxLength) {
    planetTrail.shift();
  }
}

function clearTrails() {
  state.lastTrailSampleMs = 0;
  trails.forEach((trail) => {
    trail.length = 0;
  });
  planetTrail.length = 0;
}

function clonePositions(positions) {
  return positions.map((point) => ({ x: point.x, y: point.y }));
}

function updateStatus(text, holdMs = 0) {
  systemStatus.textContent = text;
  state.statusUntilMs = holdMs;
}

function getYearsElapsed(simulationTimeSeconds) {
  if (!state.epoch) {
    return 0;
  }

  return Math.max(0, simulationTimeSeconds * YEARS_PER_SIMULATION_SECOND);
}

function formatYears(years) {
  return Math.round(Math.max(0, years)).toLocaleString("ru-RU");
}

function getCivilizationYears() {
  if (!state.civilizationAlive) {
    return state.previousCivilizationYears;
  }

  return getYearsElapsed(state.simulationTimeSeconds - state.civilizationStartTimeSeconds);
}

function updateYearCount(simulationTimeSeconds) {
  yearCount.textContent = formatYears(getYearsElapsed(simulationTimeSeconds));
}

function updateCivilizationAge() {
  civilizationAge.textContent = formatYears(getCivilizationYears());
}

function showCivilizationBanner(text, variant, untilMs) {
  civilizationBanner.textContent = text;
  civilizationBanner.hidden = false;
  civilizationBanner.className = `civilization-banner ${variant ? `is-${variant}` : ""}`.trim();
  state.bannerUntilMs = untilMs;
}

function hideCivilizationBanner() {
  civilizationBanner.hidden = true;
  civilizationBanner.className = "civilization-banner";
  state.bannerUntilMs = 0;
}

function updateCivilizationStateUi() {
  civilizationDeathNotice.hidden = state.civilizationAlive || state.civilizations === 0;
}

function updateSpeedUi() {
  speedButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.speed) === state.timeScale);
  });
}

function updateClimateUi(flux, climateBalance) {
  let label = "Умеренно";
  let detail = "Поток в пределах жизни";

  if (climateBalance >= 65 || flux > SAFE_FLUX_MAX * 1.18) {
    label = "Жарко";
    detail = "Цивилизация перегревается";
  } else if (climateBalance <= -65 || flux < SAFE_FLUX_MIN * 0.8) {
    label = "Холодно";
    detail = "Цивилизация промерзает";
  } else if (flux > SAFE_FLUX_MAX) {
    label = "Теплеет";
    detail = "Поток выше нормы";
  } else if (flux < SAFE_FLUX_MIN) {
    label = "Остывает";
    detail = "Поток ниже нормы";
  }

  climateState.textContent = label;
  climateDetail.textContent = `${detail} · поток ${flux.toFixed(2)}`;
}

function renderCivilizationRanking() {
  if (state.topCivilizations.length === 0) {
    civilizationRanking.innerHTML =
      '<li class="epoch-ranking-empty">Пока нет завершённых цивилизаций</li>';
    return;
  }

  civilizationRanking.innerHTML = state.topCivilizations
    .map(
      (entry) =>
        `<li><strong>${formatYears(entry.years)} лет</strong><p>${entry.reason}</p><span>эпоха ${entry.epoch}, цивилизация ${entry.civilization}</span></li>`
    )
    .join("");
}

function recordCivilizationResult(reason) {
  if (state.civilizationLogged || state.civilizations === 0) {
    return;
  }

  const years = getCivilizationYears();
  state.epochCivilizations.push({
    globalCivilization: Math.max(1, state.civilizations),
    epochCivilization: state.epochCivilizations.length + 1,
    years,
    reason,
  });
  state.previousCivilizationYears = years;
  state.topCivilizations.push({
    years,
    epoch: Math.max(1, state.epochs),
    civilization: Math.max(1, state.civilizations),
    reason,
  });
  state.topCivilizations.sort((left, right) => right.years - left.years);
  state.topCivilizations = state.topCivilizations.slice(0, 10);
  state.civilizationLogged = true;
  renderCivilizationRanking();
}

function persistEpochStats(payload) {
  if (!window.fetch || !window.location || window.location.protocol === "file:") {
    return;
  }

  fetch("/api/epoch-stats", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((error) => {
    console.warn("Failed to persist epoch stats", error);
  });
}

function finalizeEpoch(endReason) {
  if (!state.epoch) {
    return;
  }

  const years = getYearsElapsed(state.simulationTimeSeconds - state.epochStartTimeSeconds);
  state.previousEpochYears = years;
  persistEpochStats({
    epoch: Math.max(1, state.epochs),
    years,
    endReason,
    civilizationCount: state.epochCivilizations.length,
    civilizations: state.epochCivilizations.map((entry) => ({ ...entry })),
  });
}

function beginCivilization(timeMs, options = {}) {
  const { incrementCount = true, showBannerText = null } = options;
  state.civilizationAlive = true;
  state.civilizationLogged = false;
  state.civilizationStartTimeSeconds = state.simulationTimeSeconds;
  state.previousCivilizationYears = 0;
  state.pendingRebirthAtMs = 0;
  state.pendingRebirthReason = null;
  state.deathPulseStartMs = 0;
  state.climateBalance = 0;

  if (incrementCount) {
    state.civilizations += 1;
    civilizationCount.textContent = String(state.civilizations);
  }

  if (showBannerText) {
    state.rebirthPulseStartMs = timeMs;
    state.rebirthPulseUntilMs = timeMs + CIVILIZATION_REBIRTH_PULSE_MS;
    showCivilizationBanner(showBannerText, "rebirth", timeMs + CIVILIZATION_BANNER_MS);
  } else {
    state.rebirthPulseStartMs = 0;
    state.rebirthPulseUntilMs = 0;
  }

  updateCivilizationAge();
  updateCivilizationStateUi();
}

function queueCivilizationRebirth(timeMs, reasonVariant = null) {
  state.pendingRebirthAtMs = timeMs + CIVILIZATION_REBIRTH_MS;
  state.pendingRebirthReason = reasonVariant;
  state.deathPulseStartMs = timeMs;
}

function endCivilization(timeMs, reasonText, reasonVariant, historyReason = reasonText) {
  recordCivilizationResult(historyReason);
  state.previousCivilizationYears = getCivilizationYears();
  state.civilizationAlive = false;
  state.civilizationStartTimeSeconds = 0;
  queueCivilizationRebirth(timeMs, reasonVariant);
  updateCivilizationAge();
  updateCivilizationStateUi();
  showCivilizationBanner(reasonText, reasonVariant, timeMs + CIVILIZATION_BANNER_MS);
}

function computeStellarFlux(positions) {
  if (!state.planet) {
    return state.lastFlux;
  }

  return positions.reduce((sum, point, index) => {
    const dx = state.planet.x - point.x;
    const dy = state.planet.y - point.y;
    const distanceSquared = Math.max(dx * dx + dy * dy, 1);
    return sum + STAR_LUMINOSITIES[index] / distanceSquared;
  }, 0);
}

function updateClimate(deltaSeconds, positions) {
  const flux = computeStellarFlux(positions);
  state.lastFlux = flux;

  if (flux > SAFE_FLUX_MAX) {
    state.climateBalance = Math.min(
      CLIMATE_LIMIT,
      state.climateBalance + (flux - SAFE_FLUX_MAX) * HEAT_PRESSURE_RATE * deltaSeconds
    );
  } else if (flux < SAFE_FLUX_MIN) {
    state.climateBalance = Math.max(
      -CLIMATE_LIMIT,
      state.climateBalance - (SAFE_FLUX_MIN - flux) * COLD_PRESSURE_RATE * deltaSeconds
    );
  } else if (state.climateBalance > 0) {
    state.climateBalance = Math.max(0, state.climateBalance - CLIMATE_RECOVERY_RATE * deltaSeconds);
  } else if (state.climateBalance < 0) {
    state.climateBalance = Math.min(0, state.climateBalance + CLIMATE_RECOVERY_RATE * deltaSeconds);
  }

  updateClimateUi(flux, state.climateBalance);
  return flux;
}

function initializePlanet(epoch) {
  const positions = getStarPositions(0, epoch);
  const futurePositions = getStarPositions(0.03, epoch);
  const host = positions[2];
  const hostFuture = futurePositions[2];
  const hostVelocity = {
    x: (hostFuture.x - host.x) / 0.03,
    y: (hostFuture.y - host.y) / 0.03,
  };

  const angle = PLANET_START_ANGLE;
  const offset = {
    x: Math.cos(angle) * PLANET_START_RADIUS,
    y: Math.sin(angle) * PLANET_START_RADIUS * PLANET_START_ELLIPSE,
  };
  const distance = Math.max(Math.hypot(offset.x, offset.y), 1);
  const radial = {
    x: offset.x / distance,
    y: offset.y / distance,
  };
  const tangent = {
    x: -radial.y,
    y: radial.x,
  };
  const orbitalSpeed =
    Math.sqrt((PLANET_GRAVITY * stars[2].mass) / distance) * randomRange(0.98, 1.04);

  state.planet = {
    x: host.x + offset.x,
    y: host.y + offset.y,
    vx: hostVelocity.x + tangent.x * orbitalSpeed + radial.x * PLANET_START_IMPULSE,
    vy: hostVelocity.y + tangent.y * orbitalSpeed + radial.y * PLANET_START_IMPULSE,
  };
  state.lastPlanetInteractionTimeSeconds = state.simulationTimeSeconds;
}

function startEpoch(timeMs, options = {}) {
  const {
    collisionPair = null,
    incrementEpochs = state.epochs === 0,
    statusText = "Система стабильна",
    allowImmediateCivilizationRebirth = false,
  } = options;

  state.event = null;
  if (incrementEpochs) {
    state.epochs += 1;
    epochCount.textContent = String(state.epochs);
  }
  state.epoch = createEpochConfig();
  state.epochStartTimeSeconds = state.simulationTimeSeconds;
  state.epochCivilizations = [];
  state.climateBalance = 0;
  clearTrails();
  initializePlanet(state.epoch);
  state.lastFlux = computeStellarFlux(getStarPositions(0, state.epoch));
  updateClimateUi(state.lastFlux, 0);
  if (allowImmediateCivilizationRebirth) {
    state.pendingRebirthAtMs = timeMs;
    state.pendingRebirthReason = null;
    state.deathPulseStartMs = 0;
  }

  if (collisionPair) {
    updateStatus(`Коллапс ${stars[collisionPair[0]].name}-${stars[collisionPair[1]].name}. Новая эпоха`, timeMs + 2200);
    return;
  }

  updateStatus(statusText);
}

function integratePlanetStep(planet, positions, deltaSeconds) {
  let ax = 0;
  let ay = 0;

  positions.forEach((starPosition, index) => {
    const dx = starPosition.x - planet.x;
    const dy = starPosition.y - planet.y;
    const distanceSquared = dx * dx + dy * dy + PLANET_SOFTENING * PLANET_SOFTENING;
    const inverseDistance = 1 / Math.sqrt(distanceSquared);
    const inverseDistanceCubed = inverseDistance * inverseDistance * inverseDistance;
    const pull = PLANET_GRAVITY * stars[index].mass * inverseDistanceCubed;
    ax += dx * pull;
    ay += dy * pull;
  });

  planet.vx += ax * deltaSeconds;
  planet.vy += ay * deltaSeconds;

  const speed = Math.hypot(planet.vx, planet.vy);
  if (speed > PLANET_MAX_SPEED) {
    const scale = PLANET_MAX_SPEED / speed;
    planet.vx *= scale;
    planet.vy *= scale;
  }

  planet.x += planet.vx * deltaSeconds;
  planet.y += planet.vy * deltaSeconds;
}

function advancePlanet(positions, deltaSeconds) {
  if (!state.planet || deltaSeconds <= 0) {
    return;
  }

  const steps = Math.min(
    PLANET_MAX_INTEGRATION_STEPS,
    Math.max(1, Math.ceil(deltaSeconds / PLANET_INTEGRATION_STEP_SECONDS))
  );
  const stepSeconds = deltaSeconds / steps;

  for (let step = 0; step < steps; step += 1) {
    integratePlanetStep(state.planet, positions, stepSeconds);
  }
}

function getStarVelocities(time, epoch = state.epoch) {
  const sample = 0.02;
  const current = getStarPositions(time, epoch);
  const future = getStarPositions(time + sample, epoch);
  return current.map((point, index) => ({
    x: (future[index].x - point.x) / sample,
    y: (future[index].y - point.y) / sample,
  }));
}

function createFragments(origin, velocity, color, baseSize, count, spread) {
  const baseAngle = Math.atan2(velocity.y, velocity.x);
  const baseSpeed = Math.max(Math.hypot(velocity.x, velocity.y), 24);
  return Array.from({ length: count }, () => {
    const angle = baseAngle + randomRange(-spread, spread);
    const speed = baseSpeed * randomRange(0.74, 1.22) + randomRange(8, 34);
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      driftX: randomRange(-18, 18),
      driftY: randomRange(-18, 18),
      size: Math.max(1.1, baseSize * randomRange(0.16, 0.34)),
      color,
      alpha: randomRange(0.55, 0.92),
    };
  });
}

function startPlanetDeathEvent(timeMs, starIndex, positions, mode) {
  const eventReason =
    mode === "impact"
      ? `Планета упала на ${stars[starIndex].name}`
      : `Планета разорвана у ${stars[starIndex].name}`;
  if (state.civilizationAlive) {
    recordCivilizationResult(eventReason);
    state.civilizationAlive = false;
    state.civilizationStartTimeSeconds = 0;
    queueCivilizationRebirth(timeMs);
    updateCivilizationAge();
    updateCivilizationStateUi();
  }
  finalizeEpoch(eventReason);
  const starPosition = positions[starIndex];
  const planetPosition = { x: state.planet.x, y: state.planet.y };
  const impactAngle = Math.atan2(planetPosition.y - starPosition.y, planetPosition.x - starPosition.x);
  const fragments =
    mode === "disruption"
      ? createFragments(
          planetPosition,
          { x: state.planet.vx, y: state.planet.vy },
          planetStyle.rgb,
          planetStyle.size,
          12,
          0.85
        )
      : [];

  state.event = {
    type: mode === "impact" ? "planetImpact" : "planetDisruption",
    startMs: timeMs,
    restartAtMs: timeMs + PLANET_IMPACT_RESTART_MS,
    starIndex,
    positions: clonePositions(positions),
    impactAngle,
    planetPosition,
    fragments,
    startSimulationTimeSeconds: state.simulationTimeSeconds,
    incrementEpochs: true,
  };
  state.planet = null;
  updateStatus(
    eventReason,
    state.event.restartAtMs
  );
}

function startPlanetEscapeEvent(timeMs, positions) {
  const eventReason = "Планета выброшена из системы";
  if (state.civilizationAlive) {
    recordCivilizationResult(eventReason);
    state.civilizationAlive = false;
    state.civilizationStartTimeSeconds = 0;
    queueCivilizationRebirth(timeMs);
    updateCivilizationAge();
    updateCivilizationStateUi();
  }
  finalizeEpoch(eventReason);
  state.event = {
    type: "planetEscape",
    startMs: timeMs,
    restartAtMs: timeMs + PLANET_IMPACT_RESTART_MS,
    positions: clonePositions(positions),
    planetPosition: { x: state.planet.x, y: state.planet.y },
    startSimulationTimeSeconds: state.simulationTimeSeconds,
    incrementEpochs: true,
  };
  state.planet = null;
  updateStatus(eventReason, state.event.restartAtMs);
}

function startClimateEvent(timeMs, positions, mode) {
  climateState.textContent = mode === "burn" ? "Перегрев" : "Ледниковый режим";
  climateDetail.textContent =
    mode === "burn"
      ? `Поток ${state.lastFlux.toFixed(2)} превысил предел`
      : `Поток ${state.lastFlux.toFixed(2)} упал ниже нормы`;
  endCivilization(
    timeMs,
    mode === "burn" ? "Цивилизация погибла: планета сгорела" : "Цивилизация погибла: планета замёрзла",
    mode === "burn" ? "burn" : "freeze",
    mode === "burn" ? "Сгорела от жары" : "Замёрзла"
  );
  updateStatus(
    mode === "burn" ? "Цивилизация сгорела от жары" : "Цивилизация замёрзла",
    state.pendingRebirthAtMs
  );
}

function startStarCollisionEvent(timeMs, pair, positions) {
  const eventReason = `Столкновение ${stars[pair[0]].name} и ${stars[pair[1]].name}`;
  if (state.civilizationAlive) {
    recordCivilizationResult(eventReason);
    state.civilizationAlive = false;
    state.civilizationStartTimeSeconds = 0;
    queueCivilizationRebirth(timeMs);
    updateCivilizationAge();
    updateCivilizationStateUi();
  }
  finalizeEpoch(eventReason);
  const time = state.simulationTimeSeconds - state.epochStartTimeSeconds;
  const velocities = getStarVelocities(time);
  const fragments = pair.flatMap((index) =>
    createFragments(
      positions[index],
      velocities[index],
      stars[index].rgb,
      stars[index].size,
      index === 2 ? 10 : 14,
      0.68
    )
  );

  state.planet = null;
  state.event = {
    type: "starCollision",
    startMs: timeMs,
    restartAtMs: timeMs + STAR_COLLISION_RESTART_MS,
    collisionPair: pair,
    positions: clonePositions(positions),
    fragments,
    startSimulationTimeSeconds: state.simulationTimeSeconds,
    incrementEpochs: true,
  };
  updateStatus(
    `Столкновение ${stars[pair[0]].name} и ${stars[pair[1]].name}`,
    state.event.restartAtMs
  );
}

function getPlanetNearestStarDistance(positions) {
  if (!state.planet) {
    return Infinity;
  }

  return positions.reduce((minimumDistance, point) => {
    const dx = state.planet.x - point.x;
    const dy = state.planet.y - point.y;
    return Math.min(minimumDistance, Math.hypot(dx, dy));
  }, Infinity);
}

function updatePlanetInteractionState(positions) {
  if (!state.planet) {
    return;
  }

  if (getPlanetNearestStarDistance(positions) <= PLANET_INTERACTION_RADIUS) {
    state.lastPlanetInteractionTimeSeconds = state.simulationTimeSeconds;
  }
}

function hasPlanetEscaped(positions) {
  if (!state.planet) {
    return false;
  }

  const distanceFromCenter = Math.hypot(state.planet.x, state.planet.y);
  if (distanceFromCenter <= PLANET_ESCAPE_RADIUS) {
    return false;
  }

  if (getPlanetNearestStarDistance(positions) <= PLANET_INTERACTION_RADIUS) {
    return false;
  }

  const yearsSinceLastInteraction = getYearsElapsed(
    state.simulationTimeSeconds - state.lastPlanetInteractionTimeSeconds
  );
  return yearsSinceLastInteraction >= PLANET_ESCAPE_YEARS;
}

function willPlanetImpactSoon(currentTime) {
  if (!state.planet) {
    return false;
  }

  const simulatedPlanet = { ...state.planet };
  const stepSeconds = 0.025;
  const horizonSeconds = 1.8;

  for (let elapsed = 0; elapsed < horizonSeconds; elapsed += stepSeconds) {
    const futureTime = currentTime + elapsed + stepSeconds;
    const futurePositions = getStarPositions(futureTime);
    integratePlanetStep(simulatedPlanet, futurePositions, stepSeconds);

    for (let index = 0; index < futurePositions.length; index += 1) {
      const dx = simulatedPlanet.x - futurePositions[index].x;
      const dy = simulatedPlanet.y - futurePositions[index].y;
      if (dx * dx + dy * dy <= stars[index].size * stars[index].size) {
        return true;
      }
    }
  }

  return false;
}

function detectPlanetDeath(positions, currentTime) {
  if (!state.planet) {
    return null;
  }

  for (let index = 0; index < positions.length; index += 1) {
    const dx = state.planet.x - positions[index].x;
    const dy = state.planet.y - positions[index].y;
    const distance = Math.hypot(dx, dy);
    const impactRadius = stars[index].size;
    const destructionRadius = impactRadius * ROCHE_MULTIPLIERS[index];
    if (distance <= impactRadius) {
      return { starIndex: index, mode: "impact" };
    }
    if (distance <= destructionRadius) {
      if (willPlanetImpactSoon(currentTime)) {
        return null;
      }
      return { starIndex: index, mode: "disruption" };
    }
  }

  return null;
}

function getCollisionPair(positions) {
  for (let first = 0; first < positions.length - 1; first += 1) {
    for (let second = first + 1; second < positions.length; second += 1) {
      const dx = positions[first].x - positions[second].x;
      const dy = positions[first].y - positions[second].y;
      const distanceSquared = dx * dx + dy * dy;
      const minDistance = (stars[first].size + stars[second].size) * 0.82;
      if (distanceSquared <= minDistance * minDistance) {
        return [first, second];
      }
    }
  }

  return null;
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
  const points = getTrailPoints(planetTrail, 160);
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
  ctx.ellipse(0, 0, star.size * (1.1 + pulse * 2.2), star.size * (0.55 + pulse * 1.1), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255, ${0.45 * pulse})`;
  ctx.lineWidth = 1.2;
  for (let index = -1; index <= 1; index += 1) {
    ctx.beginPath();
    ctx.moveTo(star.size * 0.15, index * star.size * 0.18);
    ctx.lineTo(star.size * (0.9 + pulse * 1.6), index * star.size * (0.24 + pulse * 0.2));
    ctx.stroke();
  }
  ctx.restore();
}

function drawClimatePulse(x, y, mode, progress) {
  const pulse = 0.35 + Math.sin(progress * Math.PI) * 0.65;
  const color =
    mode === "climateBurn" ? "255, 96, 72" : mode === "climateFreeze" ? "145, 209, 255" : "102, 236, 143";
  const radius = planetStyle.size * (mode === "rebirth" ? 5 + pulse * 7 : 6 + pulse * 8);

  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, `rgba(${color}, ${mode === "rebirth" ? 0.42 * pulse : 0.38 * pulse})`);
  glow.addColorStop(0.5, `rgba(${color}, ${mode === "rebirth" ? 0.2 * pulse : 0.16 * pulse})`);
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

function drawFragments(cx, cy, fragments, timeMs, startMs, restartAtMs) {
  const progress = Math.min(1, (timeMs - startMs) / Math.max(restartAtMs - startMs, 1));
  const age = (timeMs - startMs) * 0.001;

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

function drawEventFrame(cx, cy, timeMs) {
  const event = state.event;
  const progress = Math.min(1, (timeMs - event.startMs) / Math.max(event.restartAtMs - event.startMs, 1));
  const hiddenStars = event.type === "starCollision" ? new Set(event.collisionPair) : new Set();

  trails.forEach((trail, index) => {
    drawTrail(cx, cy, trail, stars[index]);
  });
  drawPlanetTrail(cx, cy);

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

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
      progress
    );
    return;
  }

  if (event.type === "planetDisruption") {
    drawFragments(cx, cy, event.fragments, timeMs, event.startMs, event.restartAtMs);
    return;
  }

  if (event.type === "planetEscape") {
    if (event.planetPosition) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.18, 1 - progress);
      drawPlanet(cx + event.planetPosition.x, cy + event.planetPosition.y);
      ctx.restore();
    }
    return;
  }

  if (event.type === "climateBurn" || event.type === "climateFreeze") {
    if (event.planetPosition) {
      drawPlanet(cx + event.planetPosition.x, cy + event.planetPosition.y);
      drawClimatePulse(cx + event.planetPosition.x, cy + event.planetPosition.y, event.type, progress);
    }
    return;
  }

  if (event.type === "starCollision") {
    drawFragments(cx, cy, event.fragments, timeMs, event.startMs, event.restartAtMs);
  }
}

function isPlanetVisible() {
  return Boolean(state.planet);
}

function canBeginCivilization(timeMs) {
  if (state.civilizationAlive || state.lastFlux < CIVILIZATION_REBIRTH_TEMPERATURE) {
    return false;
  }

  if (state.civilizations === 0 && !state.pendingRebirthAtMs) {
    return true;
  }

  return Boolean(state.pendingRebirthAtMs && timeMs >= state.pendingRebirthAtMs);
}

function render(timeMs) {
  if (!state.epoch) {
    startEpoch(timeMs);
  }
  if (state.bannerUntilMs && timeMs >= state.bannerUntilMs) {
    hideCivilizationBanner();
  }
  if (!state.event && state.statusUntilMs && timeMs >= state.statusUntilMs) {
    updateStatus("Система стабильна");
  }
  const deltaSeconds = state.lastFrameMs ? Math.min((timeMs - state.lastFrameMs) * 0.001, 0.033) : 0;
  state.lastFrameMs = timeMs;
  const simulationDeltaSeconds = deltaSeconds * state.timeScale;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);

  const cx = width / 2;
  const cy = height / 2;

  if (state.event) {
    if (timeMs >= state.event.restartAtMs) {
      const restartEvent = state.event;
      startEpoch(timeMs, {
        incrementEpochs: restartEvent.incrementEpochs,
        allowImmediateCivilizationRebirth: true,
      });
    } else {
      updateYearCount(state.event.startSimulationTimeSeconds - state.epochStartTimeSeconds);
      drawEventFrame(cx, cy, timeMs);
      requestAnimationFrame(render);
      return;
    }
  }

  state.simulationTimeSeconds += simulationDeltaSeconds;
  const time = state.simulationTimeSeconds - state.epochStartTimeSeconds;
  updateYearCount(time);
  updateCivilizationAge();
  let positions = getStarPositions(time);
  const collisionPair = getCollisionPair(positions);
  if (collisionPair) {
    startStarCollisionEvent(timeMs, collisionPair, positions);
    drawEventFrame(cx, cy, timeMs);
    requestAnimationFrame(render);
    return;
  } else {
    advancePlanet(positions, simulationDeltaSeconds);
    updatePlanetInteractionState(positions);
    if (hasPlanetEscaped(positions)) {
      startPlanetEscapeEvent(timeMs, positions);
      drawEventFrame(cx, cy, timeMs);
      requestAnimationFrame(render);
      return;
    }
  }

  updateClimate(simulationDeltaSeconds, positions);
  if (canBeginCivilization(timeMs)) {
    beginCivilization(timeMs, {
      incrementCount: true,
      showBannerText: state.civilizations > 0 ? "Цивилизация вновь пустила свои корни" : null,
    });
  }
  if (state.civilizationAlive && state.climateBalance >= CLIMATE_LIMIT) {
    startClimateEvent(timeMs, positions, "burn");
  }
  if (state.civilizationAlive && state.climateBalance <= -CLIMATE_LIMIT) {
    startClimateEvent(timeMs, positions, "freeze");
  }

  const planetDeath = detectPlanetDeath(positions, time);
  if (planetDeath) {
    startPlanetDeathEvent(timeMs, planetDeath.starIndex, positions, planetDeath.mode);
    drawEventFrame(cx, cy, timeMs);
    requestAnimationFrame(render);
    return;
  }

  if (!state.lastTrailSampleMs || timeMs - state.lastTrailSampleMs >= TRAIL_SAMPLE_MS) {
    recordTrails(positions);
    recordPlanetTrail();
    state.lastTrailSampleMs = timeMs;
  }

  trails.forEach((trail, index) => {
    drawTrail(cx, cy, trail, stars[index]);
  });

  drawPlanetTrail(cx, cy);

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

  positions.forEach((point, index) => {
    drawStar(cx + point.x, cy + point.y, stars[index]);
  });

  if (isPlanetVisible()) {
    drawPlanet(cx + state.planet.x, cy + state.planet.y);
    if (!state.civilizationAlive && state.pendingRebirthReason) {
      const deathElapsedMs = timeMs - state.deathPulseStartMs;
      const deathProgress =
        state.pendingRebirthReason === "freeze"
          ? deathElapsedMs < FREEZE_DEATH_PULSE_MS * FREEZE_DEATH_PULSE_COUNT
            ? (deathElapsedMs % FREEZE_DEATH_PULSE_MS) / FREEZE_DEATH_PULSE_MS
            : null
          : (deathElapsedMs % CIVILIZATION_DEATH_PULSE_MS) / CIVILIZATION_DEATH_PULSE_MS;
      if (deathProgress !== null) {
        drawClimatePulse(
          cx + state.planet.x,
          cy + state.planet.y,
          state.pendingRebirthReason === "burn" ? "climateBurn" : "climateFreeze",
          deathProgress
        );
      }
    } else if (state.civilizationAlive && state.rebirthPulseUntilMs > timeMs) {
      drawClimatePulse(
        cx + state.planet.x,
        cy + state.planet.y,
        "rebirth",
        Math.min(1, (timeMs - state.rebirthPulseStartMs) / CIVILIZATION_REBIRTH_PULSE_MS)
      );
    }
  }

  requestAnimationFrame(render);
}

window.addEventListener("resize", resizeCanvas);
speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.timeScale = Number(button.dataset.speed);
    updateSpeedUi();
  });
});

resizeCanvas();
renderCivilizationRanking();
epochCount.textContent = "0";
updateClimateUi(1, 0);
updateCivilizationStateUi();
updateSpeedUi();
requestAnimationFrame(render);
