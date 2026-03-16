const fs = require("fs");
const http = require("http");
const path = require("path");
const { performance } = require("perf_hooks");

const {
  ALLOWED_TIME_SCALES,
  SimulationEngine,
} = require("./simulation-core");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT_DIR = __dirname;
const LOG_DIR = path.join(ROOT_DIR, "local");
const LOG_FILE = path.join(LOG_DIR, "epoch-stats.ndjson");
const SIMULATION_TICK_MS = 1000 / 60;
const SNAPSHOT_BROADCAST_MS = 1000 / 20;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function ensureLogFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "");
  }
}

function appendEpochRecord(payload) {
  const record = {
    loggedAt: new Date().toISOString(),
    ...payload,
  };
  fs.appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, (error) => {
    if (error) {
      console.error("Failed to append epoch stats", error);
    }
  });
}

function loadEpochRecords() {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }

  const raw = fs.readFileSync(LOG_FILE, "utf8").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function buildReasonStats(entries, getYears) {
  const stats = new Map();

  entries.forEach((entry) => {
    const reason = entry.reason;
    if (!stats.has(reason)) {
      stats.set(reason, {
        reason,
        count: 0,
        totalYears: 0,
        maxYears: 0,
      });
    }

    const current = stats.get(reason);
    const years = getYears(entry);
    current.count += 1;
    current.totalYears += years;
    current.maxYears = Math.max(current.maxYears, years);
  });

  return Array.from(stats.values())
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      averageYears: entry.count > 0 ? entry.totalYears / entry.count : 0,
      maxYears: entry.maxYears,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.maxYears - left.maxYears;
    });
}

function buildStatsPayload() {
  const epochs = loadEpochRecords();
  const civilizations = epochs.flatMap((epoch) =>
    (epoch.civilizations || []).map((civilization) => ({
      ...civilization,
      epoch: epoch.epoch,
      epochYears: epoch.years,
      epochEndReason: epoch.endReason,
    }))
  );

  const totalEpochYears = epochs.reduce((sum, epoch) => sum + (epoch.years || 0), 0);
  const totalCivilizationYears = civilizations.reduce(
    (sum, civilization) => sum + (civilization.years || 0),
    0
  );
  const longestEpoch = epochs.reduce(
    (best, epoch) => (!best || epoch.years > best.years ? epoch : best),
    null
  );
  const longestCivilization = civilizations.reduce(
    (best, civilization) =>
      !best || civilization.years > best.years ? civilization : best,
    null
  );

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      epochs: epochs.length,
      civilizations: civilizations.length,
      averageEpochYears: epochs.length > 0 ? totalEpochYears / epochs.length : 0,
      averageCivilizationYears:
        civilizations.length > 0 ? totalCivilizationYears / civilizations.length : 0,
    },
    longestEpoch:
      longestEpoch &&
      {
        epoch: longestEpoch.epoch,
        years: longestEpoch.years,
        endReason: longestEpoch.endReason,
        civilizationCount: longestEpoch.civilizationCount || 0,
      },
    longestCivilization:
      longestCivilization &&
      {
        epoch: longestCivilization.epoch,
        globalCivilization: longestCivilization.globalCivilization,
        epochCivilization: longestCivilization.epochCivilization,
        years: longestCivilization.years,
        reason: longestCivilization.reason,
      },
    epochEndReasons: buildReasonStats(
      epochs.map((epoch) => ({
        reason: epoch.endReason,
        years: epoch.years || 0,
      })),
      (entry) => entry.years
    ),
    civilizationEndReasons: buildReasonStats(civilizations, (entry) => entry.years || 0),
    recentEpochs: epochs
      .slice(-18)
      .reverse()
      .map((epoch) => ({
        ...epoch,
        civilizations: [...(epoch.civilizations || [])].sort(
          (left, right) => left.epochCivilization - right.epochCivilization
        ),
      })),
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function resolveStaticPath(pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolutePath = path.normalize(path.join(ROOT_DIR, requestedPath));
  const relativePath = path.relative(ROOT_DIR, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  if (
    relativePath === ".gitignore" ||
    relativePath.startsWith(".git") ||
    relativePath.startsWith("local/")
  ) {
    return null;
  }

  return absolutePath;
}

function serveStaticFile(response, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      sendJson(response, 500, { error: "Failed to read file" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeSseMessage(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

ensureLogFile();

const simulation = new SimulationEngine({
  onEpochFinalized: appendEpochRecord,
});

const streamClients = new Set();
const startMs = performance.now();
let lastStepAt = startMs;
let lastBroadcastAt = startMs;

function getSimulationNowMs() {
  return performance.now() - startMs;
}

function getSnapshot() {
  return simulation.getSnapshot();
}

function broadcastSnapshot() {
  if (streamClients.size === 0) {
    return;
  }

  const payload = getSnapshot();
  streamClients.forEach((response) => {
    writeSseMessage(response, payload);
  });
}

function runSimulationStep() {
  const currentPerformanceMs = performance.now();
  const deltaMs = currentPerformanceMs - lastStepAt;
  lastStepAt = currentPerformanceMs;

  simulation.step(deltaMs, getSimulationNowMs());

  if (currentPerformanceMs - lastBroadcastAt >= SNAPSHOT_BROADCAST_MS) {
    lastBroadcastAt = currentPerformanceMs;
    broadcastSnapshot();
  }
}

setInterval(runSimulationStep, SIMULATION_TICK_MS);

async function handleTimeScaleUpdate(request, response) {
  try {
    const rawBody = await collectRequestBody(request);
    const payload = JSON.parse(rawBody);
    const desiredTimeScale = Number(payload.timeScale);

    if (!ALLOWED_TIME_SCALES.includes(desiredTimeScale)) {
      sendJson(response, 400, {
        error: `timeScale must be one of ${ALLOWED_TIME_SCALES.join(", ")}`,
      });
      return;
    }

    simulation.setTimeScale(desiredTimeScale);
    const snapshot = getSnapshot();
    broadcastSnapshot();
    sendJson(response, 200, snapshot);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Invalid request" });
  }
}

function handleStateStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write("\n");

  streamClients.add(response);
  writeSseMessage(response, getSnapshot());

  request.on("close", () => {
    streamClients.delete(response);
  });
}

function handleStatsRequest(response) {
  sendJson(response, 200, buildStatsPayload());
}

const server = http.createServer((request, response) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || `${HOST}:${PORT}`}`
  );

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stats") {
    handleStatsRequest(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stream") {
    handleStateStream(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/time-scale") {
    handleTimeScaleUpdate(request, response);
    return;
  }

  if (request.method === "GET") {
    if (url.pathname === "/stats" || url.pathname === "/stats/") {
      serveStaticFile(response, "/stats.html");
      return;
    }
    serveStaticFile(response, url.pathname);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Simulation server running at http://${HOST}:${PORT}`);
  console.log(`Epoch stats file: ${LOG_FILE}`);
});
