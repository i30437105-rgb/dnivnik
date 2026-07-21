// Вкладка «Аналитика монет»: три блока по ТЗ §4
import { runAnalyze, loadLatestRun, fetchMetaMissing, saveSettings } from "./api.js";
import { state, esc, usd, pct, price, fmtDT, sortableTable, busyButton, hoursMinutes } from "./util.js";
import { openCoinCard } from "./coincard.js";

let root;

export function initAnalytics(container) {
  root = container;
  const F = state.settings?.filters ?? {};
  root.innerHTML = `
    <div class="toolbar">
      <button id="an-run" class="btn primary">Запустить анализ</button>
      <span id="an-status" class="status"></span>
    </div>
    <details class="block" id="an-filters">
      <summary><b>⚙️ Пороги фильтров</b> <span class="hint">поменяй значения и нажми «Сохранить и запустить»</span></summary>
      <div class="form" style="margin-top:10px">
        <label>🆕 Листинги: не старше, часов
          <input id="f2-lh" type="number" min="1" value="${F.listing_hours ?? 168}">
          <span class="hint">168 часов = 7 суток</span></label>
        <label style="align-self:end"><input id="f2-rs" type="checkbox" ${F.require_spot !== false ? "checked" : ""}>
          Только монеты со спотовой парой <span class="hint">(выкл — покажет и токен-акции без спота)</span></label>
        <label>⚡ Волатильные: возраст монеты от, дней
          <input id="f2-age" type="number" min="0" value="${F.age_days ?? 365}"></label>
        <label>⚡ Волатильные: оборот спота 24ч от, $ млн
          <input id="f2-turn" type="number" min="0" step="0.1" value="${(F.min_spot_turnover ?? 1e6) / 1e6}"></label>
        <label>⚡ Волатильные: волатильность за 6ч от, %
          <input id="f2-vol" type="number" min="0" step="0.5" value="${F.vol6h_pct ?? 3}"></label>
        <label>📈 Всплеск: рост объёма от, раз (×)
          <input id="f2-ratio" type="number" min="1" step="0.5" value="${F.spike_ratio ?? 5}"></label>
        <label>📈 Всплеск: оборот спота 24ч от, $ млн
          <input id="f2-sturn" type="number" min="0" step="0.1" value="${(F.spike_min_turnover ?? 1e6) / 1e6}"></label>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <button id="an-saverun" class="btn primary">Сохранить пороги и запустить</button>
        <span id="an-fmsg" class="muted"></span>
      </div>
    </details>
    <div id="an-warn"></div>
    <section class="block">
      <h2>🆕 Новые листинги <span class="hint">фьючерс появился на Bybit не более 72 ч назад — высокий риск</span></h2>
      <div id="an-listings" class="tblwrap"></div>
    </section>
    <section class="block">
      <h2>⚡ Основная стратегия <span class="hint">прошли базовые фильтры возраста и ликвидности, диапазон ≥ порога за 6 ч. Риск не исключён</span></h2>
      <div id="an-volatile" class="tblwrap"></div>
    </section>
    <section class="block">
      <h2>📈 Аномальный рост спотового объёма <span class="hint">оборот за 24 ч кратно выше обычного уровня</span></h2>
      <div id="an-spike" class="tblwrap"></div>
    </section>`;

  const doRun = async () => {
    const res = await runAnalyze();
    await render();
    if (res.errors?.length) {
      root.querySelector("#an-warn").innerHTML =
        `<div class="warn">⚠ Анализ выполнен частично: ${esc(res.errors.join("; "))}. Старые данные не удалены.</div>`;
    }
    fetchMetaMissing().catch(() => { /* метаданные подтянутся в следующий раз */ });
  };
  busyButton(root.querySelector("#an-run"), doRun);
  busyButton(root.querySelector("#an-saverun"), async () => {
    await saveSettings({
      filters: {
        ...state.settings.filters,
        listing_hours: Number(root.querySelector("#f2-lh").value),
        require_spot: root.querySelector("#f2-rs").checked,
        age_days: Number(root.querySelector("#f2-age").value),
        min_spot_turnover: Number(root.querySelector("#f2-turn").value) * 1e6,
        vol6h_pct: Number(root.querySelector("#f2-vol").value),
        spike_ratio: Number(root.querySelector("#f2-ratio").value),
        spike_min_turnover: Number(root.querySelector("#f2-sturn").value) * 1e6,
      },
    });
    root.querySelector("#an-fmsg").textContent = "✓ пороги сохранены, ищу…";
    await doRun();
    root.querySelector("#an-fmsg").textContent = "✓ готово";
  });

  render().catch((e) => { root.querySelector("#an-status").textContent = "Ошибка: " + e.message; });
}

async function render() {
  const { run, results } = await loadLatestRun();
  const statusEl = root.querySelector("#an-status");
  if (!run) {
    statusEl.innerHTML = `<span class="muted">Анализ ещё не запускался</span>`;
    return;
  }
  statusEl.innerHTML = `Данные актуальны на ${fmtDT(run.ts)}` +
    (run.status === "partial" ? ` <span class="warn">⚠ выполнен частично</span>` : "");
  if (run.status === "partial" && run.errors) {
    root.querySelector("#an-warn").innerHTML =
      `<div class="warn">⚠ Не все источники обновились: ${esc((run.errors || []).join("; "))}</div>`;
  }

  const by = (b) => results.filter((r) => r.block === b);
  const open = (row) => openCoinCard(row.base, row.symbol);

  // --- Новые листинги ---
  sortableTable(root.querySelector("#an-listings"), [
    { key: "coin", label: "Монета", type: "str", get: (r) => r.base,
      render: (r) => `<b>${esc(r.base)}</b> <span class="muted">${esc(r.symbol)}</span> <span class="tag red">Новый листинг / высокий риск</span>` },
    { key: "age", label: "После листинга", type: "num", get: (r) => r.metrics.hours_since,
      render: (r) => hoursMinutes(r.metrics.hours_since) },
    { key: "turn", label: "Спотовый оборот 24 ч", type: "num", get: (r) => r.metrics.spot_turnover,
      render: (r) => usd(r.metrics.spot_turnover) },
    { key: "price", label: "Цена", type: "num", get: (r) => r.metrics.price, render: (r) => price(r.metrics.price) },
    { key: "ch24", label: "Изменение 24 ч", type: "num", get: (r) => r.metrics.change24h,
      render: (r) => colorPct(r.metrics.change24h) },
  ], by("listings"), { rowKey: (r) => r.symbol, emptyText: "Новых листингов за последние 72 часа нет",
    afterRender: (c) => clickRows(c, by("listings"), open) });

  // --- Волатильные (основная стратегия) ---
  sortableTable(root.querySelector("#an-volatile"), [
    { key: "coin", label: "Монета", type: "str", get: (r) => r.base, render: (r) => `<b>${esc(r.base)}</b> <span class="muted">${esc(r.symbol)}</span>` },
    { key: "price", label: "Цена", type: "num", get: (r) => r.metrics.price, render: (r) => price(r.metrics.price) },
    { key: "vol", label: "Волатильность 6 ч", type: "num", get: (r) => r.metrics.vol6h,
      render: (r) => `<b>${pct(r.metrics.vol6h, { sign: false })}</b>` },
    { key: "ch6", label: "Изменение 6 ч", type: "num", get: (r) => r.metrics.change6h, render: (r) => colorPct(r.metrics.change6h) },
    { key: "ch24", label: "Изменение 24 ч", type: "num", get: (r) => r.metrics.change24h, render: (r) => colorPct(r.metrics.change24h) },
    { key: "turn", label: "Спотовый оборот 24 ч", type: "num", get: (r) => r.metrics.spot_turnover, render: (r) => usd(r.metrics.spot_turnover) },
    { key: "agev", label: "Возраст", type: "num", get: (r) => r.metrics.age_days, render: (r) => ageText(r.metrics) },
  ], by("volatile"), { rowKey: (r) => r.symbol, emptyText: "Сейчас нет монет, прошедших фильтры",
    afterRender: (c) => clickRows(c, by("volatile"), open) });

  // --- Всплеск объёма ---
  sortableTable(root.querySelector("#an-spike"), [
    { key: "coin", label: "Монета", type: "str", get: (r) => r.base, render: (r) => `<b>${esc(r.base)}</b> <span class="muted">${esc(r.symbol)}</span>` },
    { key: "turn", label: "Спотовый оборот 24 ч", type: "num", get: (r) => r.metrics.turnover24h, render: (r) => usd(r.metrics.turnover24h) },
    { key: "base", label: "Обычный объём", type: "num", get: (r) => r.metrics.base_median, render: (r) => usd(r.metrics.base_median) },
    { key: "ratio", label: "Рост объёма", type: "num", get: (r) => r.metrics.ratio,
      render: (r) => `<b>×${r.metrics.ratio}</b> <span class="muted">(${pct((r.metrics.ratio - 1) * 100, { sign: true, digits: 0 })})</span><br>${spark(r.metrics.daily_turnovers)}` },
    { key: "price", label: "Цена", type: "num", get: (r) => r.metrics.price, render: (r) => price(r.metrics.price) },
    { key: "ch24", label: "Изменение 24 ч", type: "num", get: (r) => r.metrics.change24h, render: (r) => colorPct(r.metrics.change24h) },
  ], by("spike"), { rowKey: (r) => r.symbol, emptyText: "Аномальных всплесков объёма не найдено",
    afterRender: (c) => clickRows(c, by("spike"), open) });
}

function clickRows(container, rows, open) {
  container.querySelectorAll("tr.row").forEach((tr) => {
    tr.classList.add("clickable");
    tr.onclick = () => {
      const r = rows.find((x) => x.symbol === tr.dataset.rowkey);
      if (r) open(r);
    };
  });
}

function colorPct(v) {
  if (v == null) return "—";
  const cls = v > 0 ? "green" : v < 0 ? "red" : "";
  return `<span class="${cls}">${pct(v)}</span>`;
}

function ageText(m) {
  if (m.age_days == null) return "—";
  const yrs = m.age_days / 365;
  const txt = yrs >= 1 ? `${yrs.toFixed(1)} г.` : `${m.age_days} дн.`;
  const src = { coingecko: "дата запуска проекта", bybit_spot: "с листинга спота Bybit", bybit_linear: "с листинга фьючерса Bybit" }[m.age_source] ?? "";
  return `<span title="${src}">${txt}</span>`;
}

// Мини-график суточных оборотов (8 значений; последний — текущее окно)
function spark(vals) {
  if (!vals?.length) return "";
  const max = Math.max(...vals);
  return `<span class="spark" title="Суточный оборот за 8 последних суток">` + vals.map((v, i) =>
    `<i style="height:${Math.max(2, Math.round(v / max * 18))}px" class="${i === vals.length - 1 ? "hot" : ""}"></i>`
  ).join("") + `</span>`;
}
