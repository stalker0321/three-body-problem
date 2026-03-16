const PLANET_GRAVITY = 5200;
const PLANET_SOFTENING = 18;
const PLANET_MAX_SPEED = 260;
const PLANET_INTEGRATION_STEP_SECONDS = 0.01;
const PLANET_MAX_INTEGRATION_STEPS = 24;
const PLANET_IMPACT_RESTART_MS = 1450;
const STAR_COLLISION_RESTART_MS = 2200;
const CIVILIZATION_REBIRTH_YEARS = 30;
const CIVILIZATION_BANNER_MS = 2600;
const CIVILIZATION_DEATH_PULSE_MS = 1000;
const CIVILIZATION_REBIRTH_PULSE_MS = 1400;
const CIVILIZATION_REBIRTH_TEMPERATURE = 0.2;
const FREEZE_DEATH_PULSE_MS = 360;
const FREEZE_DEATH_PULSE_COUNT = 3;
const YEARS_PER_SIMULATION_SECOND = 3.5;
const TARGET_START_FLUX = 0.82;
const ALPHA_CENTAURI_AB_ECCENTRICITY = 0.52;
const ALPHA_CENTAURI_AB_PERIASTRON_MARGIN = 1.45;
const OUTER_ORBIT_ECCENTRICITY = 0.36;
const OUTER_ORBIT_PERIASTRON = 350;
const OUTER_ORBIT_ARGUMENT = -0.42;
const OUTER_ORBIT_MEAN_MOTION = 0.07;
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
const PLANET_START_HILL_RADIUS_FRACTION = 0.288;
const PLANET_START_ORBIT_ECCENTRICITY = 0.15;
const BINARY_HOST_START_HILL_RADIUS_FRACTION = 0.42;
const BINARY_HOST_MAX_DISTANCE_FRACTION = 0.32;
const BINARY_HOST_START_ORBIT_ECCENTRICITY = 0.08;

const ALLOWED_TIME_SCALES = [1, 2, 4, 8];

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

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clonePositions(positions) {
  return positions.map((point) => ({ x: point.x, y: point.y }));
}

function cloneFragments(fragments) {
  return fragments.map((fragment) => ({ ...fragment }));
}

function createEpochConfig() {
  return {
    innerPhase: randomRange(0, Math.PI * 2),
    outerPhase: randomRange(0, Math.PI * 2),
  };
}

function rotatePoint(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  const tau = Math.PI * 2;
  let normalizedMeanAnomaly = meanAnomaly % tau;
  if (normalizedMeanAnomaly < 0) {
    normalizedMeanAnomaly += tau;
  }

  let eccentricAnomaly = eccentricity < 0.8 ? normalizedMeanAnomaly : Math.PI;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - normalizedMeanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
  }

  return eccentricAnomaly;
}

function getClimateSummary(flux, climateBalance) {
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

  return {
    label,
    detail: `${detail} · поток ${flux.toFixed(2)}`,
    flux,
    balance: climateBalance,
  };
}

class SimulationEngine {
  constructor(options = {}) {
    this.onEpochFinalized = options.onEpochFinalized || (() => {});
    this.state = {
      epochs: 0,
      timeScale: 1,
      simulationTimeSeconds: 0,
      epochStartTimeSeconds: 0,
      civilizations: 0,
      civilizationStartTimeSeconds: 0,
      statusText: "Система стабильна",
      statusUntilMs: 0,
      nowMs: 0,
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
      pendingRebirthAtSimulationSeconds: 0,
      pendingRebirthReason: null,
      deathPulseStartMs: 0,
      rebirthPulseStartMs: 0,
      rebirthPulseUntilMs: 0,
      bannerText: null,
      bannerVariant: null,
      bannerUntilMs: 0,
      homeStarIndex: 2,
      epochCivilizations: [],
      lastPlanetInteractionTimeSeconds: 0,
      currentPositions: [],
    };

    this.startEpoch(0, {
      incrementEpochs: true,
      statusText: "Система стабильна",
    });
  }

  setTimeScale(timeScale) {
    if (!ALLOWED_TIME_SCALES.includes(timeScale)) {
      return false;
    }

    this.state.timeScale = timeScale;
    return true;
  }

  getStarPositions(time, epoch = this.state.epoch) {
    const innerBaseRelativeSemiMajor = stars[0].orbit + stars[1].orbit;
    const minInnerPeriastron =
      (stars[0].size + stars[1].size) * ALPHA_CENTAURI_AB_PERIASTRON_MARGIN;
    const massAB = stars[0].mass + stars[1].mass;
    const totalMass = massAB + stars[2].mass;
    const outerRelativePeriastron = Math.max(
      OUTER_ORBIT_PERIASTRON,
      minInnerPeriastron * 3.9
    );
    const outerRelativeSemiMajor =
      outerRelativePeriastron / (1 - OUTER_ORBIT_ECCENTRICITY);
    const safeInnerRelativeSemiMajor =
      minInnerPeriastron / (1 - ALPHA_CENTAURI_AB_ECCENTRICITY);
    const maxInnerRelativeSemiMajor = outerRelativePeriastron * 0.28;
    const innerRelativeSemiMajor = Math.max(
      safeInnerRelativeSemiMajor,
      Math.min(innerBaseRelativeSemiMajor, maxInnerRelativeSemiMajor)
    );
    const outerMeanAnomaly = time * OUTER_ORBIT_MEAN_MOTION + epoch.outerPhase;
    const outerEccentricAnomaly = solveEccentricAnomaly(
      outerMeanAnomaly,
      OUTER_ORBIT_ECCENTRICITY
    );
    const outerRelativePosition = rotatePoint(
      {
        x:
          outerRelativeSemiMajor *
          (Math.cos(outerEccentricAnomaly) - OUTER_ORBIT_ECCENTRICITY),
        y:
          outerRelativeSemiMajor *
          Math.sqrt(1 - OUTER_ORBIT_ECCENTRICITY ** 2) *
          Math.sin(outerEccentricAnomaly),
      },
      OUTER_ORBIT_ARGUMENT
    );
    const pairCenter = {
      x: -outerRelativePosition.x * (stars[2].mass / totalMass),
      y: -outerRelativePosition.y * (stars[2].mass / totalMass),
    };
    const starC = {
      x: outerRelativePosition.x * (massAB / totalMass),
      y: outerRelativePosition.y * (massAB / totalMass),
    };

    const innerMeanAnomaly = time * 0.34 + epoch.innerPhase;
    const innerEccentricAnomaly = solveEccentricAnomaly(
      innerMeanAnomaly,
      ALPHA_CENTAURI_AB_ECCENTRICITY
    );
    const innerRelativePosition = {
      x:
        innerRelativeSemiMajor *
        (Math.cos(innerEccentricAnomaly) - ALPHA_CENTAURI_AB_ECCENTRICITY),
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

  getPairCenter(positions) {
    const massAB = stars[0].mass + stars[1].mass;
    return {
      x: (positions[0].x * stars[0].mass + positions[1].x * stars[1].mass) / massAB,
      y: (positions[0].y * stars[0].mass + positions[1].y * stars[1].mass) / massAB,
    };
  }

  updateStatus(text, holdMs = 0) {
    this.state.statusText = text;
    this.state.statusUntilMs = holdMs;
  }

  showBanner(text, variant, untilMs) {
    this.state.bannerText = text;
    this.state.bannerVariant = variant || null;
    this.state.bannerUntilMs = untilMs;
  }

  hideBanner() {
    this.state.bannerText = null;
    this.state.bannerVariant = null;
    this.state.bannerUntilMs = 0;
  }

  getYearsElapsed(simulationTimeSeconds) {
    if (!this.state.epoch) {
      return 0;
    }

    return Math.max(0, simulationTimeSeconds * YEARS_PER_SIMULATION_SECOND);
  }

  getCivilizationYears() {
    if (!this.state.civilizationAlive) {
      return this.state.previousCivilizationYears;
    }

    return this.getYearsElapsed(
      this.state.simulationTimeSeconds - this.state.civilizationStartTimeSeconds
    );
  }

  recordCivilizationResult(reason) {
    if (this.state.civilizationLogged || this.state.civilizations === 0) {
      return;
    }

    const years = this.getCivilizationYears();
    this.state.epochCivilizations.push({
      globalCivilization: Math.max(1, this.state.civilizations),
      epochCivilization: this.state.epochCivilizations.length + 1,
      years,
      reason,
    });
    this.state.previousCivilizationYears = years;
    this.state.topCivilizations.push({
      years,
      epoch: Math.max(1, this.state.epochs),
      civilization: Math.max(1, this.state.civilizations),
      reason,
    });
    this.state.topCivilizations.sort((left, right) => right.years - left.years);
    this.state.topCivilizations = this.state.topCivilizations.slice(0, 10);
    this.state.civilizationLogged = true;
  }

  finalizeEpoch(endReason) {
    if (!this.state.epoch) {
      return;
    }

    const years = this.getYearsElapsed(
      this.state.simulationTimeSeconds - this.state.epochStartTimeSeconds
    );
    this.state.previousEpochYears = years;
    this.onEpochFinalized({
      epoch: Math.max(1, this.state.epochs),
      years,
      endReason,
      homeStar: stars[this.state.homeStarIndex].name,
      civilizationCount: this.state.epochCivilizations.length,
      civilizations: this.state.epochCivilizations.map((entry) => ({ ...entry })),
    });
  }

  beginCivilization(timeMs, options = {}) {
    const { incrementCount = true, showBannerText = null } = options;
    this.state.civilizationAlive = true;
    this.state.civilizationLogged = false;
    this.state.civilizationStartTimeSeconds = this.state.simulationTimeSeconds;
    this.state.previousCivilizationYears = 0;
    this.state.pendingRebirthAtSimulationSeconds = 0;
    this.state.pendingRebirthReason = null;
    this.state.deathPulseStartMs = 0;
    this.state.climateBalance = 0;

    if (incrementCount) {
      this.state.civilizations += 1;
    }

    if (showBannerText) {
      this.state.rebirthPulseStartMs = timeMs;
      this.state.rebirthPulseUntilMs = timeMs + CIVILIZATION_REBIRTH_PULSE_MS;
      this.showBanner(showBannerText, "rebirth", timeMs + CIVILIZATION_BANNER_MS);
    } else {
      this.state.rebirthPulseStartMs = 0;
      this.state.rebirthPulseUntilMs = 0;
    }
  }

  queueCivilizationRebirth(timeMs, reasonVariant = null) {
    this.state.pendingRebirthAtSimulationSeconds =
      this.state.simulationTimeSeconds +
      CIVILIZATION_REBIRTH_YEARS / YEARS_PER_SIMULATION_SECOND;
    this.state.pendingRebirthReason = reasonVariant;
    this.state.deathPulseStartMs = timeMs;
  }

  endCivilization(timeMs, reasonText, reasonVariant, historyReason = reasonText) {
    this.recordCivilizationResult(historyReason);
    this.state.previousCivilizationYears = this.getCivilizationYears();
    this.state.civilizationAlive = false;
    this.state.civilizationStartTimeSeconds = 0;
    this.queueCivilizationRebirth(timeMs, reasonVariant);
    this.showBanner(reasonText, reasonVariant, timeMs + CIVILIZATION_BANNER_MS);
  }

  computeStellarFlux(positions) {
    if (!this.state.planet) {
      return this.state.lastFlux;
    }

    return positions.reduce((sum, point, index) => {
      const dx = this.state.planet.x - point.x;
      const dy = this.state.planet.y - point.y;
      const distanceSquared = Math.max(dx * dx + dy * dy, 1);
      return sum + STAR_LUMINOSITIES[index] / distanceSquared;
    }, 0);
  }

  updateClimate(deltaSeconds, positions) {
    const flux = this.computeStellarFlux(positions);
    this.state.lastFlux = flux;

    if (flux > SAFE_FLUX_MAX) {
      this.state.climateBalance = Math.min(
        CLIMATE_LIMIT,
        this.state.climateBalance + (flux - SAFE_FLUX_MAX) * HEAT_PRESSURE_RATE * deltaSeconds
      );
    } else if (flux < SAFE_FLUX_MIN) {
      this.state.climateBalance = Math.max(
        -CLIMATE_LIMIT,
        this.state.climateBalance - (SAFE_FLUX_MIN - flux) * COLD_PRESSURE_RATE * deltaSeconds
      );
    } else if (this.state.climateBalance > 0) {
      this.state.climateBalance = Math.max(
        0,
        this.state.climateBalance - CLIMATE_RECOVERY_RATE * deltaSeconds
      );
    } else if (this.state.climateBalance < 0) {
      this.state.climateBalance = Math.min(
        0,
        this.state.climateBalance + CLIMATE_RECOVERY_RATE * deltaSeconds
      );
    }

    return flux;
  }

  getBackgroundFluxAtPoint(positions, point, excludedStarIndex) {
    return positions.reduce((sum, starPoint, index) => {
      if (index === excludedStarIndex) {
        return sum;
      }

      const dx = point.x - starPoint.x;
      const dy = point.y - starPoint.y;
      const distanceSquared = Math.max(dx * dx + dy * dy, 1);
      return sum + STAR_LUMINOSITIES[index] / distanceSquared;
    }, 0);
  }

  chooseHomeStarIndex() {
    return Math.floor(Math.random() * stars.length);
  }

  initializePlanet(epoch) {
    const massAB = stars[0].mass + stars[1].mass;
    const positions = this.getStarPositions(0, epoch);
    const futurePositions = this.getStarPositions(0.03, epoch);
    const hostIndex = this.chooseHomeStarIndex();
    this.state.homeStarIndex = hostIndex;
    const host = positions[hostIndex];
    const hostFuture = futurePositions[hostIndex];
    const pairCenter = this.getPairCenter(positions);
    const pairCenterFuture = this.getPairCenter(futurePositions);
    const hostVelocity = {
      x: (hostFuture.x - host.x) / 0.03,
      y: (hostFuture.y - host.y) / 0.03,
    };
    let referencePosition;
    let referenceVelocity;
    let referenceMass;

    if (hostIndex === 2) {
      referencePosition = pairCenter;
      referenceVelocity = {
        x: (pairCenterFuture.x - pairCenter.x) / 0.03,
        y: (pairCenterFuture.y - pairCenter.y) / 0.03,
      };
      referenceMass = massAB;
    } else {
      const companionIndex = hostIndex === 0 ? 1 : 0;
      referencePosition = positions[companionIndex];
      referenceVelocity = {
        x: (futurePositions[companionIndex].x - positions[companionIndex].x) / 0.03,
        y: (futurePositions[companionIndex].y - positions[companionIndex].y) / 0.03,
      };
      referenceMass = stars[companionIndex].mass;
    }

    const hostRelativePosition = {
      x: host.x - referencePosition.x,
      y: host.y - referencePosition.y,
    };
    const hostRelativeVelocity = {
      x: hostVelocity.x - referenceVelocity.x,
      y: hostVelocity.y - referenceVelocity.y,
    };
    const distance = Math.max(Math.hypot(hostRelativePosition.x, hostRelativePosition.y), 1);
    const stableHillRadius =
      distance * Math.cbrt(stars[hostIndex].mass / (3 * referenceMass));
    const backgroundFluxAtHost = this.getBackgroundFluxAtPoint(
      positions,
      host,
      hostIndex
    );
    const targetHostFlux = Math.max(0.18, TARGET_START_FLUX - backgroundFluxAtHost);
    const habitableRadius = Math.sqrt(STAR_LUMINOSITIES[hostIndex] / targetHostFlux);
    const startRadius =
      hostIndex === 2
        ? Math.max(
            stableHillRadius * PLANET_START_HILL_RADIUS_FRACTION,
            habitableRadius
          )
        : Math.max(
            stars[hostIndex].size * 3.1,
            Math.min(
              habitableRadius,
              stableHillRadius * BINARY_HOST_START_HILL_RADIUS_FRACTION,
              distance * BINARY_HOST_MAX_DISTANCE_FRACTION
            )
          );
    const radial = {
      x: hostRelativePosition.x / distance,
      y: hostRelativePosition.y / distance,
    };
    const orbitDirection =
      hostRelativePosition.x * hostRelativeVelocity.y -
        hostRelativePosition.y * hostRelativeVelocity.x >=
      0
        ? 1
        : -1;
    const tangent = {
      x: -radial.y * orbitDirection,
      y: radial.x * orbitDirection,
    };
    const startOrbitEccentricity =
      hostIndex === 2
        ? PLANET_START_ORBIT_ECCENTRICITY
        : BINARY_HOST_START_ORBIT_ECCENTRICITY;
    const orbitalSpeed = Math.sqrt(
      (PLANET_GRAVITY * stars[hostIndex].mass * (1 - startOrbitEccentricity)) /
        startRadius
    );
    const offset = {
      x: radial.x * startRadius,
      y: radial.y * startRadius,
    };

    this.state.planet = {
      x: host.x + offset.x,
      y: host.y + offset.y,
      vx: hostVelocity.x + tangent.x * orbitalSpeed,
      vy: hostVelocity.y + tangent.y * orbitalSpeed,
    };
    this.state.lastPlanetInteractionTimeSeconds = this.state.simulationTimeSeconds;
  }

  startEpoch(timeMs, options = {}) {
    const {
      collisionPair = null,
      incrementEpochs = this.state.epochs === 0,
      statusText = "Система стабильна",
      allowImmediateCivilizationRebirth = false,
    } = options;

    this.state.event = null;
    if (incrementEpochs) {
      this.state.epochs += 1;
    }
    this.state.epoch = createEpochConfig();
    this.state.epochStartTimeSeconds = this.state.simulationTimeSeconds;
    this.state.epochCivilizations = [];
    this.state.climateBalance = 0;
    this.initializePlanet(this.state.epoch);
    this.state.currentPositions = this.getStarPositions(0, this.state.epoch);
    this.state.lastFlux = this.computeStellarFlux(this.state.currentPositions);

    if (allowImmediateCivilizationRebirth) {
      this.state.pendingRebirthAtSimulationSeconds = this.state.simulationTimeSeconds;
      this.state.pendingRebirthReason = null;
      this.state.deathPulseStartMs = 0;
    }

    if (collisionPair) {
      this.updateStatus(
        `Коллапс ${stars[collisionPair[0]].name}-${stars[collisionPair[1]].name}. Новая эпоха`,
        timeMs + 2200
      );
      return;
    }

    this.updateStatus(statusText);
  }

  integratePlanetStep(planet, positions, deltaSeconds) {
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

  advancePlanet(positions, deltaSeconds) {
    if (!this.state.planet || deltaSeconds <= 0) {
      return;
    }

    const steps = Math.min(
      PLANET_MAX_INTEGRATION_STEPS,
      Math.max(1, Math.ceil(deltaSeconds / PLANET_INTEGRATION_STEP_SECONDS))
    );
    const stepSeconds = deltaSeconds / steps;

    for (let step = 0; step < steps; step += 1) {
      this.integratePlanetStep(this.state.planet, positions, stepSeconds);
    }
  }

  getStarVelocities(time, epoch = this.state.epoch) {
    const sample = 0.02;
    const current = this.getStarPositions(time, epoch);
    const future = this.getStarPositions(time + sample, epoch);
    return current.map((point, index) => ({
      x: (future[index].x - point.x) / sample,
      y: (future[index].y - point.y) / sample,
    }));
  }

  createFragments(origin, velocity, color, baseSize, count, spread) {
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

  startPlanetDeathEvent(timeMs, starIndex, positions, mode) {
    const eventReason =
      mode === "impact"
        ? `Планета упала на ${stars[starIndex].name}`
        : `Планета разорвана у ${stars[starIndex].name}`;
    if (this.state.civilizationAlive) {
      this.recordCivilizationResult(eventReason);
      this.state.civilizationAlive = false;
      this.state.civilizationStartTimeSeconds = 0;
      this.queueCivilizationRebirth(timeMs);
    }
    this.finalizeEpoch(eventReason);
    const starPosition = positions[starIndex];
    const planetPosition = { x: this.state.planet.x, y: this.state.planet.y };
    const impactAngle = Math.atan2(
      planetPosition.y - starPosition.y,
      planetPosition.x - starPosition.x
    );
    const fragments =
      mode === "disruption"
        ? this.createFragments(
            planetPosition,
            { x: this.state.planet.vx, y: this.state.planet.vy },
            stars[starIndex].rgb,
            2.2,
            12,
            0.85
          )
        : [];

    this.state.event = {
      type: mode === "impact" ? "planetImpact" : "planetDisruption",
      startMs: timeMs,
      restartAtMs: timeMs + PLANET_IMPACT_RESTART_MS,
      starIndex,
      positions: clonePositions(positions),
      impactAngle,
      planetPosition,
      fragments,
      startSimulationTimeSeconds: this.state.simulationTimeSeconds,
      incrementEpochs: true,
    };
    this.state.planet = null;
    this.updateStatus(eventReason, this.state.event.restartAtMs);
  }

  startPlanetEscapeEvent(timeMs, positions) {
    const eventReason = "Планета выброшена из системы";
    if (this.state.civilizationAlive) {
      this.recordCivilizationResult(eventReason);
      this.state.civilizationAlive = false;
      this.state.civilizationStartTimeSeconds = 0;
      this.queueCivilizationRebirth(timeMs);
    }
    this.finalizeEpoch(eventReason);
    this.state.event = {
      type: "planetEscape",
      startMs: timeMs,
      restartAtMs: timeMs + PLANET_IMPACT_RESTART_MS,
      positions: clonePositions(positions),
      planetPosition: { x: this.state.planet.x, y: this.state.planet.y },
      startSimulationTimeSeconds: this.state.simulationTimeSeconds,
      incrementEpochs: true,
    };
    this.state.planet = null;
    this.updateStatus(eventReason, this.state.event.restartAtMs);
  }

  startClimateEvent(timeMs, mode) {
    this.endCivilization(
      timeMs,
      mode === "burn"
        ? "Цивилизация погибла: планета сгорела"
        : "Цивилизация погибла: планета замёрзла",
      mode === "burn" ? "burn" : "freeze",
      mode === "burn" ? "Сгорела от жары" : "Замёрзла"
    );
    this.updateStatus(
      mode === "burn" ? "Цивилизация сгорела от жары" : "Цивилизация замёрзла",
      0
    );
  }

  startStarCollisionEvent(timeMs, pair, positions) {
    const eventReason = `Столкновение ${stars[pair[0]].name} и ${stars[pair[1]].name}`;
    if (this.state.civilizationAlive) {
      this.recordCivilizationResult(eventReason);
      this.state.civilizationAlive = false;
      this.state.civilizationStartTimeSeconds = 0;
      this.queueCivilizationRebirth(timeMs);
    }
    this.finalizeEpoch(eventReason);
    const time = this.state.simulationTimeSeconds - this.state.epochStartTimeSeconds;
    const velocities = this.getStarVelocities(time);
    const fragments = pair.flatMap((index) =>
      this.createFragments(
        positions[index],
        velocities[index],
        stars[index].rgb,
        stars[index].size,
        index === 2 ? 10 : 14,
        0.68
      )
    );

    this.state.planet = null;
    this.state.event = {
      type: "starCollision",
      startMs: timeMs,
      restartAtMs: timeMs + STAR_COLLISION_RESTART_MS,
      collisionPair: pair,
      positions: clonePositions(positions),
      fragments,
      startSimulationTimeSeconds: this.state.simulationTimeSeconds,
      incrementEpochs: true,
    };
    this.updateStatus(eventReason, this.state.event.restartAtMs);
  }

  getPlanetNearestStarDistance(positions) {
    if (!this.state.planet) {
      return Infinity;
    }

    return positions.reduce((minimumDistance, point) => {
      const dx = this.state.planet.x - point.x;
      const dy = this.state.planet.y - point.y;
      return Math.min(minimumDistance, Math.hypot(dx, dy));
    }, Infinity);
  }

  updatePlanetInteractionState(positions) {
    if (!this.state.planet) {
      return;
    }

    if (this.getPlanetNearestStarDistance(positions) <= PLANET_INTERACTION_RADIUS) {
      this.state.lastPlanetInteractionTimeSeconds = this.state.simulationTimeSeconds;
    }
  }

  hasPlanetEscaped(positions) {
    if (!this.state.planet) {
      return false;
    }

    const distanceFromCenter = Math.hypot(this.state.planet.x, this.state.planet.y);
    if (distanceFromCenter <= PLANET_ESCAPE_RADIUS) {
      return false;
    }

    if (this.getPlanetNearestStarDistance(positions) <= PLANET_INTERACTION_RADIUS) {
      return false;
    }

    const yearsSinceLastInteraction = this.getYearsElapsed(
      this.state.simulationTimeSeconds - this.state.lastPlanetInteractionTimeSeconds
    );
    return yearsSinceLastInteraction >= PLANET_ESCAPE_YEARS;
  }

  willPlanetImpactSoon(currentTime) {
    if (!this.state.planet) {
      return false;
    }

    const simulatedPlanet = { ...this.state.planet };
    const stepSeconds = 0.025;
    const horizonSeconds = 1.8;

    for (let elapsed = 0; elapsed < horizonSeconds; elapsed += stepSeconds) {
      const futureTime = currentTime + elapsed + stepSeconds;
      const futurePositions = this.getStarPositions(futureTime);
      this.integratePlanetStep(simulatedPlanet, futurePositions, stepSeconds);

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

  detectPlanetDeath(positions, currentTime) {
    if (!this.state.planet) {
      return null;
    }

    for (let index = 0; index < positions.length; index += 1) {
      const dx = this.state.planet.x - positions[index].x;
      const dy = this.state.planet.y - positions[index].y;
      const distance = Math.hypot(dx, dy);
      const impactRadius = stars[index].size;
      const destructionRadius = impactRadius * ROCHE_MULTIPLIERS[index];
      if (distance <= impactRadius) {
        return { starIndex: index, mode: "impact" };
      }
      if (distance <= destructionRadius) {
        if (this.willPlanetImpactSoon(currentTime)) {
          return null;
        }
        return { starIndex: index, mode: "disruption" };
      }
    }

    return null;
  }

  getCollisionPair(positions) {
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

  canBeginCivilization() {
    if (this.state.civilizationAlive || this.state.lastFlux < CIVILIZATION_REBIRTH_TEMPERATURE) {
      return false;
    }

    if (this.state.civilizations === 0 && !this.state.pendingRebirthAtSimulationSeconds) {
      return true;
    }

    return Boolean(
      this.state.pendingRebirthAtSimulationSeconds &&
        this.state.simulationTimeSeconds >= this.state.pendingRebirthAtSimulationSeconds
    );
  }

  step(deltaMs, nowMs) {
    this.state.nowMs = nowMs;

    if (this.state.bannerUntilMs && nowMs >= this.state.bannerUntilMs) {
      this.hideBanner();
    }
    if (!this.state.event && this.state.statusUntilMs && nowMs >= this.state.statusUntilMs) {
      this.updateStatus("Система стабильна");
    }

    const deltaSeconds = Math.min(Math.max(deltaMs, 0) * 0.001, 0.033);

    if (this.state.event) {
      if (nowMs >= this.state.event.restartAtMs) {
        const restartEvent = this.state.event;
        this.startEpoch(nowMs, {
          incrementEpochs: restartEvent.incrementEpochs,
          allowImmediateCivilizationRebirth: true,
        });
      } else {
        this.state.currentPositions = clonePositions(this.state.event.positions);
        return;
      }
    }

    const simulationDeltaSeconds = deltaSeconds * this.state.timeScale;
    this.state.simulationTimeSeconds += simulationDeltaSeconds;
    const time = this.state.simulationTimeSeconds - this.state.epochStartTimeSeconds;
    const positions = this.getStarPositions(time);
    this.state.currentPositions = positions;

    const collisionPair = this.getCollisionPair(positions);
    if (collisionPair) {
      this.startStarCollisionEvent(nowMs, collisionPair, positions);
      this.state.currentPositions = clonePositions(this.state.event.positions);
      return;
    }

    this.advancePlanet(positions, simulationDeltaSeconds);
    this.updatePlanetInteractionState(positions);
    if (this.hasPlanetEscaped(positions)) {
      this.startPlanetEscapeEvent(nowMs, positions);
      this.state.currentPositions = clonePositions(this.state.event.positions);
      return;
    }

    this.updateClimate(simulationDeltaSeconds, positions);
    if (this.canBeginCivilization()) {
      this.beginCivilization(nowMs, {
        incrementCount: true,
        showBannerText:
          this.state.civilizations > 0 ? "Цивилизация вновь пустила свои корни" : null,
      });
    }
    if (this.state.civilizationAlive && this.state.climateBalance >= CLIMATE_LIMIT) {
      this.startClimateEvent(nowMs, "burn");
    }
    if (this.state.civilizationAlive && this.state.climateBalance <= -CLIMATE_LIMIT) {
      this.startClimateEvent(nowMs, "freeze");
    }

    const planetDeath = this.detectPlanetDeath(positions, time);
    if (planetDeath) {
      this.startPlanetDeathEvent(nowMs, planetDeath.starIndex, positions, planetDeath.mode);
      this.state.currentPositions = clonePositions(this.state.event.positions);
    }
  }

  getEventSnapshot() {
    if (!this.state.event) {
      return null;
    }

    const durationMs = Math.max(this.state.event.restartAtMs - this.state.event.startMs, 1);
    const elapsedMs = Math.max(0, this.state.nowMs - this.state.event.startMs);
    return {
      ...this.state.event,
      positions: clonePositions(this.state.event.positions),
      fragments: this.state.event.fragments ? cloneFragments(this.state.event.fragments) : [],
      progress: Math.min(1, elapsedMs / durationMs),
      elapsedMs,
      durationMs,
    };
  }

  getDeathPulseSnapshot() {
    if (this.state.civilizationAlive || !this.state.pendingRebirthReason) {
      return null;
    }

    const deathElapsedMs = this.state.nowMs - this.state.deathPulseStartMs;
    const progress =
      this.state.pendingRebirthReason === "freeze"
        ? deathElapsedMs < FREEZE_DEATH_PULSE_MS * FREEZE_DEATH_PULSE_COUNT
          ? (deathElapsedMs % FREEZE_DEATH_PULSE_MS) / FREEZE_DEATH_PULSE_MS
          : null
        : (deathElapsedMs % CIVILIZATION_DEATH_PULSE_MS) / CIVILIZATION_DEATH_PULSE_MS;

    if (progress === null) {
      return null;
    }

    return {
      mode:
        this.state.pendingRebirthReason === "burn" ? "climateBurn" : "climateFreeze",
      progress,
    };
  }

  getSnapshot() {
    const eventSnapshot = this.getEventSnapshot();
    const displayedPositions = eventSnapshot
      ? eventSnapshot.positions
      : clonePositions(this.state.currentPositions);
    const epochSimulationTime = eventSnapshot
      ? this.state.event.startSimulationTimeSeconds - this.state.epochStartTimeSeconds
      : this.state.simulationTimeSeconds - this.state.epochStartTimeSeconds;

    return {
      nowMs: this.state.nowMs,
      timeScale: this.state.timeScale,
      epochs: this.state.epochs,
      civilizations: this.state.civilizations,
      yearCountYears: this.getYearsElapsed(epochSimulationTime),
      civilizationAgeYears: this.getCivilizationYears(),
      civilizationAlive: this.state.civilizationAlive,
      civilizationDeathVisible:
        !this.state.civilizationAlive && this.state.civilizations > 0,
      topCivilizations: this.state.topCivilizations.map((entry) => ({ ...entry })),
      homeStarName: stars[this.state.homeStarIndex].name,
      climate: getClimateSummary(this.state.lastFlux, this.state.climateBalance),
      statusText: this.state.statusText,
      banner: this.state.bannerText
        ? {
            text: this.state.bannerText,
            variant: this.state.bannerVariant,
          }
        : null,
      positions: displayedPositions,
      planet: this.state.planet ? { ...this.state.planet } : null,
      event: eventSnapshot,
      deathPulse: this.getDeathPulseSnapshot(),
      rebirthPulseProgress:
        this.state.civilizationAlive && this.state.rebirthPulseUntilMs > this.state.nowMs
          ? Math.min(
              1,
              (this.state.nowMs - this.state.rebirthPulseStartMs) /
                CIVILIZATION_REBIRTH_PULSE_MS
            )
          : null,
    };
  }
}

module.exports = {
  ALLOWED_TIME_SCALES,
  SimulationEngine,
  stars,
};
