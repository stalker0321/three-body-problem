const totalEpochs = document.getElementById("totalEpochs");
const averageEpochYears = document.getElementById("averageEpochYears");
const averagePlanetBYears = document.getElementById("averagePlanetBYears");
const averagePlanetCYears = document.getElementById("averagePlanetCYears");
const longestEpochYears = document.getElementById("longestEpochYears");
const longestEpochMeta = document.getElementById("longestEpochMeta");
const longestPlanetBYears = document.getElementById("longestPlanetBYears");
const longestPlanetBMeta = document.getElementById("longestPlanetBMeta");
const longestPlanetCYears = document.getElementById("longestPlanetCYears");
const longestPlanetCMeta = document.getElementById("longestPlanetCMeta");
const epochReasonList = document.getElementById("epochReasonList");
const planetBReasonList = document.getElementById("planetBReasonList");
const planetCReasonList = document.getElementById("planetCReasonList");
const topEpochs = document.getElementById("topEpochs");
const recentEpochs = document.getElementById("recentEpochs");
const statsGeneratedAt = document.getElementById("statsGeneratedAt");
const refreshStats = document.getElementById("refreshStats");

function formatYears(years, digits = 0) {
  return Number(years || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDate(value) {
  if (!value) {
    return "Нет данных";
  }

  return new Date(value).toLocaleString("ru-RU");
}

function renderReasonList(target, entries, emptyText) {
  if (!entries.length) {
    target.innerHTML = `<p class="stats-empty">${emptyText}</p>`;
    return;
  }

  target.innerHTML = entries
    .map(
      (entry) => `
        <article class="reason-item">
          <div class="reason-item-head">
            <strong>${entry.reason}</strong>
            <span>${entry.count}</span>
          </div>
          <p>Средний итог: ${formatYears(entry.averageYears, 1)} лет</p>
          <p>Максимум: ${formatYears(entry.maxYears, 1)} лет</p>
        </article>
      `
    )
    .join("");
}

function buildReplayUrl(epoch) {
  const params = new URLSearchParams();
  params.set("runSeed", String(epoch.runSeed ?? ""));
  params.set("epochSeed", String(epoch.epochSeed ?? ""));
  params.set("epoch", String(epoch.epoch ?? 1));
  return `/replay?${params.toString()}`;
}

function renderEpochCollection(target, epochs, emptyText) {
  if (!epochs.length) {
    target.innerHTML = `<p class="stats-empty">${emptyText}</p>`;
    return;
  }

  target.innerHTML = epochs
    .map((epoch) => {
      const planetB = epoch.planets?.b || null;
      const planetC = epoch.planets?.c || null;

      return `
        <article class="epoch-record">
          <div class="epoch-record-head">
            <div>
              <p class="eyebrow">Эпоха ${epoch.epoch}</p>
              <strong>${formatYears(epoch.years, 1)} лет</strong>
            </div>
            <span class="epoch-badge">${epoch.regime || "без режима"}</span>
          </div>
          <p class="epoch-record-host">Дом: ${epoch.homeStar || "неизвестно"}</p>
          <p class="epoch-record-host">Run seed: ${epoch.runSeed ?? "нет данных"}</p>
          <p class="epoch-record-host">Seed эпохи: ${epoch.epochSeed ?? "нет данных"}</p>
          <p class="epoch-record-reason">${epoch.endReason}</p>
          <div class="epoch-record-actions">
            <a class="nav-link" href="${buildReplayUrl(epoch)}">Replay</a>
          </div>
          <div class="epoch-planets">
            <article class="epoch-planet">
              <strong>Proxima Centauri b</strong>
              <span>${planetB ? `${formatYears(planetB.years, 1)} лет` : "нет данных"}</span>
              <p>${planetB ? planetB.outcome : "Итог не записан"}</p>
            </article>
            <article class="epoch-planet">
              <strong>Proxima Centauri c</strong>
              <span>${planetC ? `${formatYears(planetC.years, 1)} лет` : "нет данных"}</span>
              <p>${planetC ? planetC.outcome : "Итог не записан"}</p>
            </article>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecentEpochs(epochs) {
  renderEpochCollection(
    recentEpochs,
    epochs,
    "Новый журнал пока пуст. Дай симуляции завершить первую эпоху."
  );
}

function renderStats(payload) {
  totalEpochs.textContent = formatYears(payload.totals.epochs);
  averageEpochYears.textContent = formatYears(payload.totals.averageEpochYears, 1);
  averagePlanetBYears.textContent = formatYears(payload.totals.averagePlanetBYears, 1);
  averagePlanetCYears.textContent = formatYears(payload.totals.averagePlanetCYears, 1);

  if (payload.longestEpoch) {
    longestEpochYears.textContent = `${formatYears(payload.longestEpoch.years, 1)} лет`;
    longestEpochMeta.textContent = `Эпоха ${payload.longestEpoch.epoch} · ${payload.longestEpoch.endReason}`;
  } else {
    longestEpochYears.textContent = "Нет данных";
    longestEpochMeta.textContent = "";
  }

  if (payload.longestPlanetB) {
    longestPlanetBYears.textContent = `${formatYears(payload.longestPlanetB.years, 1)} лет`;
    longestPlanetBMeta.textContent = `Эпоха ${payload.longestPlanetB.epoch} · ${payload.longestPlanetB.outcome}`;
  } else {
    longestPlanetBYears.textContent = "Нет данных";
    longestPlanetBMeta.textContent = "";
  }

  if (payload.longestPlanetC) {
    longestPlanetCYears.textContent = `${formatYears(payload.longestPlanetC.years, 1)} лет`;
    longestPlanetCMeta.textContent = `Эпоха ${payload.longestPlanetC.epoch} · ${payload.longestPlanetC.outcome}`;
  } else {
    longestPlanetCYears.textContent = "Нет данных";
    longestPlanetCMeta.textContent = "";
  }

  renderReasonList(epochReasonList, payload.epochEndReasons, "Пока нет завершённых эпох.");
  renderReasonList(planetBReasonList, payload.planetBOutcomes, "Пока нет записанных исходов Proxima b.");
  renderReasonList(planetCReasonList, payload.planetCOutcomes, "Пока нет записанных исходов Proxima c.");
  renderEpochCollection(
    topEpochs,
    payload.topEpochs || [],
    "Пока нет эпох для топа по длительности."
  );
  renderRecentEpochs(payload.recentEpochs);
  statsGeneratedAt.textContent = `Обновлено: ${formatDate(payload.generatedAt)}`;
}

async function loadStats() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderStats(payload);
  } catch (error) {
    statsGeneratedAt.textContent = "Не удалось загрузить статистику";
    recentEpochs.innerHTML =
      '<p class="stats-empty">Ошибка загрузки статистики. Проверь серверный лог.</p>';
  }
}

refreshStats.addEventListener("click", () => {
  loadStats();
});

loadStats();
window.setInterval(loadStats, 30000);
