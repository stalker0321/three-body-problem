const totalEpochs = document.getElementById("totalEpochs");
const totalCivilizations = document.getElementById("totalCivilizations");
const averageEpochYears = document.getElementById("averageEpochYears");
const averageCivilizationYears = document.getElementById("averageCivilizationYears");
const longestEpochYears = document.getElementById("longestEpochYears");
const longestEpochMeta = document.getElementById("longestEpochMeta");
const longestCivilizationYears = document.getElementById("longestCivilizationYears");
const longestCivilizationMeta = document.getElementById("longestCivilizationMeta");
const epochReasonList = document.getElementById("epochReasonList");
const civilizationReasonList = document.getElementById("civilizationReasonList");
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

function renderRecentEpochs(epochs) {
  if (!epochs.length) {
    recentEpochs.innerHTML =
      '<p class="stats-empty">Журнал эпох пока пуст. Дай симуляции дожить до первой катастрофы.</p>';
    return;
  }

  recentEpochs.innerHTML = epochs
    .map((epoch) => {
      const civilizations = epoch.civilizations || [];
      const civilizationMarkup = civilizations.length
        ? `
          <div class="epoch-civilizations">
            ${civilizations
              .map(
                (civilization) => `
                  <article class="epoch-civilization">
                    <strong>#${civilization.epochCivilization}</strong>
                    <span>${formatYears(civilization.years, 1)} лет</span>
                    <p>${civilization.reason}</p>
                  </article>
                `
              )
              .join("")}
          </div>
        `
        : '<p class="stats-empty">В этой эпохе не успело возникнуть ни одной завершённой цивилизации.</p>';

      return `
        <article class="epoch-record">
          <div class="epoch-record-head">
            <div>
              <p class="eyebrow">Эпоха ${epoch.epoch}</p>
              <strong>${formatYears(epoch.years, 1)} лет</strong>
            </div>
            <span class="epoch-badge">${epoch.civilizationCount || 0} цивилизаций</span>
          </div>
          <p class="epoch-record-reason">${epoch.endReason}</p>
          ${civilizationMarkup}
        </article>
      `;
    })
    .join("");
}

function renderStats(payload) {
  totalEpochs.textContent = formatYears(payload.totals.epochs);
  totalCivilizations.textContent = formatYears(payload.totals.civilizations);
  averageEpochYears.textContent = formatYears(payload.totals.averageEpochYears, 1);
  averageCivilizationYears.textContent = formatYears(
    payload.totals.averageCivilizationYears,
    1
  );

  if (payload.longestEpoch) {
    longestEpochYears.textContent = `${formatYears(payload.longestEpoch.years, 1)} лет`;
    longestEpochMeta.textContent = `Эпоха ${payload.longestEpoch.epoch} · ${payload.longestEpoch.endReason}`;
  } else {
    longestEpochYears.textContent = "Нет данных";
    longestEpochMeta.textContent = "";
  }

  if (payload.longestCivilization) {
    longestCivilizationYears.textContent = `${formatYears(
      payload.longestCivilization.years,
      1
    )} лет`;
    longestCivilizationMeta.textContent = `Эпоха ${payload.longestCivilization.epoch} · цивилизация ${payload.longestCivilization.globalCivilization} · ${payload.longestCivilization.reason}`;
  } else {
    longestCivilizationYears.textContent = "Нет данных";
    longestCivilizationMeta.textContent = "";
  }

  renderReasonList(
    epochReasonList,
    payload.epochEndReasons,
    "Пока нет завершённых эпох."
  );
  renderReasonList(
    civilizationReasonList,
    payload.civilizationEndReasons,
    "Пока нет завершённых цивилизаций."
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
