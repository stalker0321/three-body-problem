(function () {
  const replayForm = document.getElementById("replayForm");
  const replaySeedInput = document.getElementById("replaySeed");
  const replayRandomButton = document.getElementById("replayRandom");
  const replayCopyLinkButton = document.getElementById("replayCopyLink");
  const replayRunSeed = document.getElementById("replayRunSeed");
  const replayEpochSeed = document.getElementById("replayEpochSeed");
  const replayModeNote = document.getElementById("replayModeNote");
  const replayShareStatus = document.getElementById("replayShareStatus");

  const SIMULATION_TICK_MS = 1000 / 60;
  const SNAPSHOT_BROADCAST_MS = 1000 / 20;
  const MAX_SIMULATION_STEPS_PER_TICK = 8;

  if (!globalThis.SimulationCore?.SimulationEngine) {
    throw new Error("SimulationCore is not available in the browser");
  }

  const replayHub = {
    engine: null,
    clients: new Set(),
    simulationNowMs: 0,
    accumulatedStepMs: 0,
    lastStepAt: performance.now(),
    lastBroadcastAt: performance.now(),
    currentSeedInput: "",
    currentReplayRequest: null,
  };

  function buildRandomSeed() {
    if (globalThis.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buffer);
      return String(buffer[0]);
    }

    return String(Date.now() ^ Math.trunc(Math.random() * 0xffffffff));
  }

  function resolveReplayRequest(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
      return {
        runSeed: buildRandomSeed(),
        sourceLabel: "случайный seed",
      };
    }

    try {
      const parsedUrl = new URL(normalizedValue);
      const sharedRunSeed = parsedUrl.searchParams.get("runSeed");
      const sharedEpochSeed = parsedUrl.searchParams.get("epochSeed");
      const sharedEpochNumber = parsedUrl.searchParams.get("epoch");
      if (sharedRunSeed && sharedRunSeed.trim() && sharedEpochSeed && sharedEpochSeed.trim()) {
        return {
          runSeed: sharedRunSeed.trim(),
          epochSeed: sharedEpochSeed.trim(),
          epochNumber: sharedEpochNumber ? Number(sharedEpochNumber) : null,
          sourceLabel: normalizedValue,
        };
      }

      const sharedSeed = parsedUrl.searchParams.get("seed");
      if (sharedSeed && sharedSeed.trim()) {
        return {
          runSeed: sharedSeed.trim(),
          sourceLabel: normalizedValue,
        };
      }
    } catch (error) {
      // Treat non-URL input as a plain seed.
    }

    return {
      runSeed: normalizedValue,
      sourceLabel: normalizedValue,
    };
  }

  function updateReplayUrl(replayRequest) {
    const url = new URL(window.location.href);
    url.searchParams.delete("seed");
    url.searchParams.delete("runSeed");
    url.searchParams.delete("epochSeed");
    url.searchParams.delete("epoch");

    if (replayRequest.epochSeed) {
      url.searchParams.set("runSeed", replayRequest.runSeed);
      url.searchParams.set("epochSeed", replayRequest.epochSeed);
      if (replayRequest.epochNumber) {
        url.searchParams.set("epoch", String(replayRequest.epochNumber));
      }
    } else {
      url.searchParams.set("seed", replayRequest.runSeed);
    }
    window.history.replaceState({}, "", url);
  }

  function getReplayShareUrl() {
    return new URL(window.location.href).toString();
  }

  function getReplaySnapshot() {
    return replayHub.engine ? replayHub.engine.getSnapshot() : null;
  }

  function updateReplayMeta(snapshot) {
    if (!snapshot) {
      replayRunSeed.textContent = "0";
      replayEpochSeed.textContent = "0";
      replayModeNote.textContent = "Replay работает только в этом браузере.";
      return;
    }

    replayRunSeed.textContent = String(snapshot.runSeed);
    replayEpochSeed.textContent = String(snapshot.epochSeed);
    if (replayHub.currentReplayRequest?.epochSeed) {
      replayModeNote.textContent =
        `Replay эпохи ${snapshot.epochs} по runSeed ${snapshot.runSeed} и epochSeed ${snapshot.epochSeed}. ` +
        "Серверная симуляция продолжает жить отдельно.";
    } else {
      replayModeNote.textContent =
        `Локальный replay по input "${replayHub.currentSeedInput}". ` +
        "Серверная симуляция продолжает жить отдельно.";
    }
    replayShareStatus.textContent = `Ссылка для шаринга: ${getReplayShareUrl()}`;
  }

  function broadcastSnapshot() {
    const snapshot = getReplaySnapshot();
    if (!snapshot) {
      return;
    }

    updateReplayMeta(snapshot);
    replayHub.clients.forEach((client) => {
      client.emit(snapshot);
    });
  }

  function startReplay(replayValue) {
    const replayRequest =
      typeof replayValue === "object" && replayValue !== null && replayValue.runSeed
        ? replayValue
        : resolveReplayRequest(replayValue);

    replayHub.engine = new globalThis.SimulationCore.SimulationEngine({
      seed: replayRequest.runSeed,
    });
    if (replayRequest.epochSeed) {
      replayHub.engine.startReplayEpoch(
        replayRequest.epochSeed,
        replayRequest.epochNumber
      );
    }

    replayHub.currentSeedInput = replayRequest.sourceLabel || replayRequest.runSeed;
    replayHub.currentReplayRequest = replayRequest;
    replayHub.simulationNowMs = 0;
    replayHub.accumulatedStepMs = 0;
    replayHub.lastStepAt = performance.now();
    replayHub.lastBroadcastAt = replayHub.lastStepAt;
    replaySeedInput.value = replayRequest.runSeed;
    updateReplayUrl(replayRequest);
    window.dispatchEvent(new CustomEvent("replay:reset"));
    broadcastSnapshot();
  }

  class LocalReplayEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.onmessage = null;
      this.onerror = null;
      this._closed = false;

      if (url !== "/api/stream") {
        queueMicrotask(() => {
          if (typeof this.onerror === "function") {
            this.onerror(new Error(`Unsupported replay stream URL: ${url}`));
          }
        });
        return;
      }

      replayHub.clients.add(this);
      queueMicrotask(() => {
        const snapshot = getReplaySnapshot();
        if (snapshot) {
          this.emit(snapshot);
        }
      });
    }

    emit(snapshot) {
      if (this._closed || typeof this.onmessage !== "function") {
        return;
      }

      this.onmessage({
        data: JSON.stringify(snapshot),
      });
    }

    close() {
      this._closed = true;
      this.readyState = 2;
      replayHub.clients.delete(this);
    }
  }

  const nativeFetch = window.fetch || globalThis.fetch;
  const originalFetch = nativeFetch ? nativeFetch.bind(window) : null;
  window.EventSource = LocalReplayEventSource;
  globalThis.EventSource = LocalReplayEventSource;

  const replayFetch = async (input, init = {}) => {
    const requestUrl = typeof input === "string" ? input : input?.url;

    if (requestUrl === "/api/time-scale") {
      const body = init.body ? JSON.parse(init.body) : {};
      const desiredTimeScale = Number(body.timeScale);
      const engine = replayHub.engine;
      const succeeded = engine && engine.setTimeScale(desiredTimeScale);
      const snapshot = getReplaySnapshot();
      if (snapshot) {
        updateReplayMeta(snapshot);
        broadcastSnapshot();
      }

      return new Response(JSON.stringify(snapshot || { error: "Replay not ready" }), {
        status: succeeded ? 200 : 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    if (!originalFetch) {
      throw new Error("Fetch is not available in this environment");
    }

    return originalFetch(input, init);
  };
  window.fetch = replayFetch;
  globalThis.fetch = replayFetch;

  replayForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startReplay(replaySeedInput.value);
  });

  replayRandomButton.addEventListener("click", () => {
    startReplay({
      runSeed: buildRandomSeed(),
      sourceLabel: "случайный seed",
    });
  });

  replayCopyLinkButton.addEventListener("click", async () => {
    const shareUrl = getReplayShareUrl();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        replayShareStatus.textContent = `Ссылка скопирована: ${shareUrl}`;
        return;
      }
    } catch (error) {
      console.warn("Failed to copy replay link", error);
    }

    replayShareStatus.textContent = `Скопируй вручную: ${shareUrl}`;
  });

  function runReplayStep(nowMs) {
    if (!replayHub.engine) {
      replayHub.lastStepAt = nowMs;
      requestAnimationFrame(runReplayStep);
      return;
    }

    const deltaMs = nowMs - replayHub.lastStepAt;
    replayHub.lastStepAt = nowMs;
    replayHub.accumulatedStepMs += deltaMs;

    let steps = 0;
    while (
      replayHub.accumulatedStepMs >= SIMULATION_TICK_MS &&
      steps < MAX_SIMULATION_STEPS_PER_TICK
    ) {
      replayHub.simulationNowMs += SIMULATION_TICK_MS;
      replayHub.engine.step(SIMULATION_TICK_MS, replayHub.simulationNowMs);
      replayHub.accumulatedStepMs -= SIMULATION_TICK_MS;
      steps += 1;
    }

    if (
      steps === MAX_SIMULATION_STEPS_PER_TICK &&
      replayHub.accumulatedStepMs > SIMULATION_TICK_MS
    ) {
      replayHub.accumulatedStepMs = SIMULATION_TICK_MS;
    }

    if (nowMs - replayHub.lastBroadcastAt >= SNAPSHOT_BROADCAST_MS) {
      replayHub.lastBroadcastAt = nowMs;
      broadcastSnapshot();
    }

    requestAnimationFrame(runReplayStep);
  }

  const initialUrl = new URL(window.location.href);
  const initialRunSeed = initialUrl.searchParams.get("runSeed");
  const initialEpochSeed = initialUrl.searchParams.get("epochSeed");
  const initialEpochNumber = initialUrl.searchParams.get("epoch");

  if (initialRunSeed && initialEpochSeed) {
    startReplay({
      runSeed: initialRunSeed,
      epochSeed: initialEpochSeed,
      epochNumber: initialEpochNumber ? Number(initialEpochNumber) : null,
      sourceLabel: getReplayShareUrl(),
    });
  } else {
    startReplay(initialUrl.searchParams.get("seed") || buildRandomSeed());
  }
  requestAnimationFrame(runReplayStep);
})();
