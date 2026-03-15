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

const server = http.createServer((request, response) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || `${HOST}:${PORT}`}`
  );

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getSnapshot());
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
    serveStaticFile(response, url.pathname);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Simulation server running at http://${HOST}:${PORT}`);
  console.log(`Epoch stats file: ${LOG_FILE}`);
});
