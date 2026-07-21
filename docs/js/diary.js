// Вкладка «Дневник трейдера» (ТЗ §5): сводка дня, календарь, график, статистика, сделки
import {
  runSync, loadDaysRange, loadSnapshots, loadLatestSnapshot,
  loadTrades, loadCashFlows, loadSyncStatus, loadStrategies,
} from "./api.js";
import {
  state, esc, usd, pct, fmtRu, fmtDT, fmtDay, fmtDur, todayLocal, addDays,
  sortableTable, busyButton, openModal, statusLine, price,
} from "./util.js";
import { renderTradeCard } from "./tradecard.js";

let root;
// Единый период: календарь, график, статистика и сделки живут синхронно (ТЗ 5.4)
const period = { mode: "month", anchor: null, from: null, to: null, chartUnits: "usd" };

export function initDiary(container) {
  root = container;
  const today = todayLocal();
  period.anchor = today.slice(0, 7);
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Дневник</h1><span class="sub">торговый терминал</span></div>
      <div class="right">
        <span id="dy-status" class="status"></span>
        <button id="dy-sync" class="btn">Обновить</button>
      </div>
    </header>
    <div id="dy-flow-warn"></div>
    <section style="margin-bottom:26px"><div id="dy-summary" class="cards"></div>
      <div id="dy-bars"></div></section>
    <section style="margin-bottom:26px">
      <div class="row spread" style="margin-bottom:14px">
        <h2 style="margin:0">Календарь результатов</h2>
        <div class="row" style="gap:14px">
          <div class="seg">
            <button class="btn pmode" data-m="month">Месяц</button>
            <button class="btn pmode" data-m="week">Неделя</button>
            <button class="btn pmode" data-m="weeks">Сводка недель</button>
          </div>
          <div class="row">
            <button class="btn small" id="dy-prev">‹</button>
            <span id="dy-period-label" class="plabel"></span>
            <button class="btn small" id="dy-next">›</button>
          </div>
        </div>
      </div>
      <div id="dy-calendar"></div>
    </section>
    <section class="block">
      <div class="row spread" style="margin-bottom:12px">
        <h2 style="margin:0">График результата за период</h2>
        <div class="seg">
          <button class="btn cunit" data-u="usd">USD</button>
          <button class="btn cunit" data-u="pct">%</button>
        </div>
      </div>
      <div id="dy-chart" style="height:260px"></div>
      <div class="muted small" style="margin-top:6px">В режиме «Неделя»/«Месяц» — баланс на конец каждого дня; в режиме одного дня — внутридневная линия с целью и лимитом.</div>
    </section>
    <section style="margin-bottom:26px"><h2>Статистика за период</h2><div id="dy-stats"></div></section>
    <section><h2>Сделки за период</h2><div id="dy-trades" class="tblwrap block" style="padding:0"></div></section>`;

  busyButton(root.querySelector("#dy-sync"), async () => { await runSync(); await render(); });
  root.querySelectorAll(".pmode").forEach((b) => b.onclick = () => {
    period.mode = b.dataset.m;
    const t = todayLocal();
    period.anchor = period.mode === "week" ? mondayOf(t) : t.slice(0, 7);
    render();
  });
  root.querySelector("#dy-prev").onclick = () => { shift(-1); render(); };
  root.querySelector("#dy-next").onclick = () => { shift(1); render(); };
  root.querySelectorAll(".cunit").forEach((b) => b.onclick = () => { period.chartUnits = b.dataset.u; render(); });

  render().catch((e) => root.querySelector("#dy-status").innerHTML = `<span class="warn">Ошибка: ${esc(e.message)}</span>`);
}

function mondayOf(dayStr) {
  const d = new Date(dayStr + "T12:00:00Z");
  const wd = (d.getUTCDay() + 6) % 7;
  return addDays(dayStr, -wd);
}

function shift(dir) {
  if (period.mode === "week") period.anchor = addDays(period.anchor, dir * 7);
  else {
    const [y, m] = period.anchor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    period.anchor = d.toISOString().slice(0, 7);
  }
}

function computeRange() {
  if (period.mode === "week") { period.from = period.anchor; period.to = addDays(period.anchor, 6); }
  else {
    const [y, m] = period.anchor.split("-").map(Number);
    period.from = `${period.anchor}-01`;
    period.to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
}

const dayGoalPct = (d) => d?.goal_pct ?? state.settings.daily_goal_pct;
const dayLossUsd = (d, B0) => {
  const s = state.settings;
  if (d?.loss_usd != null) return d.loss_usd;
  if (d?.loss_pct != null) return B0 * d.loss_pct / 100;
  return s.loss_limit_mode === "usd" && s.daily_loss_usd != null ? s.daily_loss_usd : B0 * s.daily_loss_pct / 100;
};
const dayResult = (d) => d.end_equity != null ? d.end_equity - d.start_balance - (d.net_flow || 0) : null;

async function render() {
  computeRange();
  const today = todayLocal();
  const [days, trades, flows, sync, strategies, lastSnap] = await Promise.all([
    loadDaysRange(period.from, period.to),
    loadTrades(period.from, period.to),
    loadCashFlows(period.from, period.to),
    loadSyncStatus(),
    loadStrategies(true),
    loadLatestSnapshot(),
  ]);
  const stratName = new Map(strategies.map((s) => [s.id, s.name]));

  // Кнопки-состояния
  root.querySelectorAll(".pmode").forEach((b) => b.classList.toggle("primary", b.dataset.m === period.mode));
  root.querySelectorAll(".cunit").forEach((b) => b.classList.toggle("primary", b.dataset.u === period.chartUnits));
  root.querySelector("#dy-period-label").textContent = period.mode === "week"
    ? `${fmtDay(period.from)} – ${fmtDay(period.to)}`
    : new Date(period.from + "T12:00Z").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const diary = sync.diary ?? {};
  statusLine(root.querySelector("#dy-status"), {
    lastOk: diary.last_ok, error: diary.last_error && (!diary.last_ok || new Date(diary.last_error_at) > new Date(diary.last_ok)) ? diary.last_error : null,
    errorAt: diary.last_error_at,
    stale: diary.last_ok && Date.now() - new Date(diary.last_ok).getTime() > 30 * 60_000,
  });

  // ---------- Сводка сегодняшнего дня ----------
  let todayRow = days.find((d) => d.day === today);
  if (!todayRow && (today < period.from || today > period.to)) {
    todayRow = (await loadDaysRange(today, today))[0];
  }
  renderSummary(todayRow, lastSnap, diary);

  renderCalendar(days, trades, today);
  await renderChart(days, today);
  renderStats(days, trades, stratName);
  renderTrades(trades, strategies);

  // Предупреждение о потоках (ТЗ 5.2)
  const todayFlows = flows.filter((f) => f.day === today);
  const unpriced = todayFlows.some((f) => f.amount_usd == null);
  root.querySelector("#dy-flow-warn").innerHTML = unpriced
    ? `<div class="warn">⚠ Сегодня было движение средств в монете, которую не удалось оценить в USD — дневной результат может быть искажён.</div>`
    : "";
}

function renderSummary(d, lastSnap, diary) {
  const el = root.querySelector("#dy-summary");
  const bars = root.querySelector("#dy-bars");
  if (!d) {
    el.innerHTML = `<div class="card"><div class="muted">Сегодняшний день ещё не начат — нет снимка баланса. Нажмите «Обновить» или дождитесь автосинка (каждые 10 минут).</div></div>`;
    bars.innerHTML = "";
    return;
  }
  const B0 = Number(d.start_balance);
  const Bt = lastSnap ? Number(lastSnap.equity) : Number(d.end_equity ?? B0);
  const res = Bt - B0 - (d.net_flow || 0);
  const resPct = B0 > 0 ? res / B0 * 100 : 0;
  const goalUsd = B0 * dayGoalPct(d) / 100;
  const left = Math.max(goalUsd - res, 0);
  const lossUsd = dayLossUsd(d, B0);
  const lossLeft = Math.max(lossUsd - Math.max(-res, 0), 0);
  const goalDone = res >= goalUsd;
  const stopHit = -res >= lossUsd;

  el.innerHTML = `
    ${d.start_accurate ? "" : `<div class="warn" style="grid-column:1/-1">⚠ Отсчёт этого дня начат не ровно с полуночи (снимок 00:00 отсутствовал) — цифры дня приблизительные.
      Со следующего дня сервер снимает баланс ровно в 00:00 автоматически, и всё будет точно.</div>`}
    <div class="card"><div class="k">Баланс на начало дня${d.start_accurate ? "" : ` <span class="tag yellow">≈ приблизительно</span>`}</div>
      <div class="v">${usd(B0)}</div><div class="muted small">${d.start_accurate ? `снимок в 00:00 (${esc(state.tz)})` : "восстановлен по первому снимку дня"}</div></div>
    <div class="card"><div class="k">Сейчас на счету</div><div class="v">${usd(Bt)}</div>
      <div class="muted small">${lastSnap ? "на " + fmtDT(lastSnap.ts) : ""}</div></div>
    <div class="card hero ${res > 0 ? "pos" : res < 0 ? "neg" : ""}"><div class="k">Результат дня</div>
      <div class="v ${res > 0 ? "green" : res < 0 ? "red" : ""}">${usd(res, { sign: true })} <span class="hint ${res > 0 ? "green" : res < 0 ? "red" : ""}">${pct(resPct)}</span></div>
      <div class="muted small">на сколько вырос счёт с начала дня: закрытые сделки + открытые позиции − комиссии${(d.net_flow || 0) !== 0 ? " (пополнения/выводы исключены)" : ""}</div></div>
    <div class="card"><div class="k">Закрыто сделками за день</div>
      <div class="v ${d.realized_pnl > 0 ? "green" : d.realized_pnl < 0 ? "red" : ""}">${usd(d.realized_pnl, { sign: true })}</div>
      <div class="muted small">чистая прибыль ${d.trades_count} закрытых сделок</div></div>
    <div class="card"><div class="k">Цель дня (${fmtRu(dayGoalPct(d), 0)}%)</div><div class="v">${usd(goalUsd)}</div>
      <div class="muted small">${goalDone ? "✅ цель выполнена" : `осталось ${usd(left)}`}</div></div>
    <div class="card"><div class="k">Лимит убытка</div><div class="v">−${usd(lossUsd)}</div>
      <div class="muted small">${stopHit ? "⛔ стоп дня достигнут — торговлю остановить" : `запас ${usd(lossLeft)}`}</div></div>`;

  const progress = goalUsd > 0 ? Math.max(res / goalUsd * 100, 0) : 0;
  const lossProg = lossUsd > 0 ? Math.min(Math.max(-res, 0) / lossUsd * 100, 100) : 0;
  bars.innerHTML = `
    <div class="barwrap"><div class="barlabel"><span>К цели дня</span><b class="green">${fmtRu(Math.round(progress), 0)}%</b></div>
      <div class="bar"><div class="fill green" style="width:${Math.min(progress, 100)}%"></div></div></div>
    ${res < 0 ? `<div class="barwrap"><div class="barlabel red"><span>К лимиту убытка</span><b>${fmtRu(Math.round(lossProg), 0)}%</b></div>
      <div class="bar"><div class="fill red" style="width:${lossProg}%"></div></div></div>` : ""}`;
}

// ---------- Календарь (месяц / неделя / сводка недель) ----------
function renderCalendar(days, trades, today) {
  const el = root.querySelector("#dy-calendar");
  const byDay = new Map(days.map((d) => [d.day, d]));
  const cell = (dayStr, { compact = false } = {}) => {
    const d = byDay.get(dayStr);
    const res = d ? dayResult(d) : null;
    const cls = res == null ? "nodata" : res > 0 ? "pos" : res < 0 ? "neg" : "zero";
    const inMonth = period.mode !== "month" || dayStr.startsWith(period.anchor);
    const count = d?.trades_count ? `<div class="cnt">${d.trades_count} сдел.</div>` : "";
    return `<div class="cal-cell ${cls} ${dayStr === today ? "today" : ""} ${inMonth ? "" : "outside"}" data-day="${dayStr}">
      <div class="d">${Number(dayStr.slice(8))}</div>
      ${res != null ? `<div class="r">${usd(res, { sign: true })}</div>
        <div class="rp">${pct(d.start_balance > 0 ? res / d.start_balance * 100 : 0)}</div>${compact ? "" : count}` : ""}
    </div>`;
  };

  if (period.mode === "weeks") {
    // сводка месяца по неделям
    let html = `<div class="weeksum">`;
    let cur = mondayOf(period.from);
    let w = 1;
    while (cur <= period.to) {
      const wDays = Array.from({ length: 7 }, (_, i) => addDays(cur, i))
        .map((ds) => byDay.get(ds)).filter(Boolean);
      const sum = wDays.reduce((s, d) => s + (dayResult(d) ?? 0), 0);
      const start = wDays[0]?.start_balance;
      html += `<div class="weekrow"><div class="wk">Неделя ${w} <span class="muted small">${fmtDay(cur)} – ${fmtDay(addDays(cur, 6))}</span></div>
        <div class="wv ${sum > 0 ? "green" : sum < 0 ? "red" : ""}">${usd(sum, { sign: true })}</div>
        <div class="muted">${start ? pct(sum / start * 100) : ""} · дней с данными: ${wDays.length}</div></div>`;
      cur = addDays(cur, 7);
      w++;
    }
    el.innerHTML = html + `</div>`;
    return;
  }

  const start = period.mode === "week" ? period.anchor : mondayOf(period.from);
  const end = period.mode === "week" ? period.to : addDays(mondayOf(addDays(period.to, 0)), 6);
  let html = `<div class="cal-head">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<div>${d}</div>`).join("")}</div><div class="cal-grid">`;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) html += cell(ds);
  el.innerHTML = html + `</div>`;
  el.querySelectorAll(".cal-cell:not(.nodata)").forEach((c) =>
    c.onclick = () => openDayModal(c.dataset.day, byDay.get(c.dataset.day), trades));
}

// ---------- Окно дня (ТЗ 5.4) ----------
async function openDayModal(dayStr, d, allTrades) {
  const res = dayResult(d);
  const dayTrades = allTrades.filter((t) => t.day === dayStr);
  const flows = (await loadCashFlows(dayStr, dayStr));
  const goalUsd = d.start_balance * dayGoalPct(d) / 100;
  const lossUsd = dayLossUsd(d, d.start_balance);
  const symbols = [...new Set(dayTrades.map((t) => t.symbol))];
  const modal = openModal(`
    <h2>${fmtDay(dayStr)}</h2>
    <div class="cards">
      <div class="card"><div class="k">Старт → конец</div><div class="v">${usd(d.start_balance)} → ${usd(d.end_equity)}</div></div>
      <div class="card"><div class="k">Результат</div><div class="v ${res > 0 ? "green" : res < 0 ? "red" : ""}">${usd(res, { sign: true })} (${pct(d.start_balance > 0 ? res / d.start_balance * 100 : 0)})</div></div>
      <div class="card"><div class="k">Цель / выполнение</div><div class="v">${usd(goalUsd)} · ${goalUsd > 0 ? Math.round(res / goalUsd * 100) : 0}%</div></div>
      <div class="card"><div class="k">Лимит убытка</div><div class="v">−${usd(lossUsd)}</div></div>
      <div class="card"><div class="k">Реализованный PnL</div><div class="v">${usd(d.realized_pnl, { sign: true })}</div>
        <div class="muted small">нереализованный + комиссии: ${usd(res - d.realized_pnl, { sign: true })}</div></div>
      <div class="card"><div class="k">Сделок / монеты</div><div class="v">${dayTrades.length}</div>
        <div class="muted small">${esc(symbols.join(", ") || "—")}</div></div>
    </div>
    ${flows.length ? `<h3>Движения средств</h3>` + flows.map((f) =>
      `<div>${{ deposit: "Пополнение", withdrawal: "Вывод", transfer_in: "Перевод на счёт", transfer_out: "Перевод со счёта" }[f.type]}:
       ${fmtRu(f.amount, 2)} ${esc(f.coin)} ${f.amount_usd != null ? `(${usd(f.amount_usd)})` : `<span class="warn">оценка в USD недоступна</span>`} · ${fmtDT(f.ts)}</div>`).join("") : ""}
    <h3>Сделки дня</h3><div id="dm-trades" class="tblwrap"></div>`, { wide: true });
  const strategies = await loadStrategies(true);
  renderTradesTable(modal.el.querySelector("#dm-trades"), dayTrades, strategies);
}

// ---------- График (ТЗ 5.5) ----------
async function renderChart(days, today) {
  const el = root.querySelector("#dy-chart");
  el.innerHTML = "";
  const isPct = period.chartUnits === "pct";
  let points = [];
  let goalLine = null, lossLine = null;

  if (period.mode === "week" || period.mode === "month" || period.mode === "weeks") {
    points = days.filter((d) => d.end_equity != null)
      .map((d) => ({ time: d.day, value: Number(d.end_equity) }));
  }
  // внутридневная линия для сегодняшнего дня, если период содержит сегодня и данных ≤1 дня
  if (points.length <= 1) {
    const day = days.find((d) => d.day === today) ? today : days[days.length - 1]?.day;
    if (day) {
      const snaps = await loadSnapshots(day);
      points = snaps.map((s) => ({ time: Math.floor(new Date(s.ts).getTime() / 1000), value: Number(s.equity) }));
      const d = days.find((x) => x.day === day);
      if (d && !isPct) {
        goalLine = Number(d.start_balance) + d.start_balance * dayGoalPct(d) / 100;
        lossLine = Number(d.start_balance) - dayLossUsd(d, Number(d.start_balance));
      }
    }
  }
  if (!points.length) { el.innerHTML = `<div class="muted">Нет данных за период</div>`; return; }
  const base = points[0].value;
  if (isPct && base > 0) points = points.map((p) => ({ time: p.time, value: (p.value - base) / base * 100 }));

  const css = getComputedStyle(document.documentElement);
  const tk = (name) => css.getPropertyValue(name).trim();
  const chart = LightweightCharts.createChart(el, {
    height: 260, layout: { background: { color: "transparent" }, textColor: tk("--chart-axis-text") },
    grid: { vertLines: { color: tk("--chart-grid") }, horzLines: { color: tk("--chart-grid") } },
    crosshair: { vertLine: { color: tk("--chart-crosshair") }, horzLine: { color: tk("--chart-crosshair") } },
    timeScale: { timeVisible: typeof points[0].time === "number", borderColor: tk("--chart-grid") },
    rightPriceScale: { borderColor: tk("--chart-grid") },
  });
  const series = chart.addAreaSeries({
    lineColor: tk("--chart-line"), lineWidth: 2.2,
    topColor: tk("--chart-area-top"), bottomColor: tk("--chart-area-bot"),
  });
  series.setData(points);
  if (goalLine != null) series.createPriceLine({ price: goalLine, color: tk("--chart-goal"), lineStyle: 2, title: "цель" });
  if (lossLine != null) series.createPriceLine({ price: lossLine, color: tk("--chart-limit"), lineStyle: 2, title: "лимит" });
  chart.timeScale().fitContent();
}

// ---------- Статистика (ТЗ 5.6) ----------
function renderStats(days, trades, stratName) {
  const el = root.querySelector("#dy-stats");
  const withData = days.filter((d) => d.end_equity != null);
  const results = withData.map((d) => dayResult(d) ?? 0);
  const startBal = withData[0]?.start_balance;
  const endBal = withData[withData.length - 1]?.end_equity;
  const totalRes = results.reduce((a, b) => a + b, 0);
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const sumW = wins.reduce((s, t) => s + Number(t.pnl), 0);
  const sumL = losses.reduce((s, t) => s + Number(t.pnl), 0);
  const fees = trades.reduce((s, t) => s + (Number(t.open_fee) || 0) + (Number(t.close_fee) || 0), 0);
  const durs = trades.filter((t) => t.opened_at && t.closed_at)
    .map((t) => new Date(t.closed_at) - new Date(t.opened_at));
  const goalDays = withData.filter((d) => (dayResult(d) ?? 0) >= d.start_balance * dayGoalPct(d) / 100).length;
  let peak = 0, dd = 0, cum = 0;
  for (const r of results) { cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }

  const bySym = {};
  for (const t of trades) (bySym[t.symbol] ??= { n: 0, pnl: 0 }, bySym[t.symbol].n++, bySym[t.symbol].pnl += Number(t.pnl));
  const byStrat = {};
  for (const t of trades) {
    const name = stratName.get(t.trade_notes?.strategy_id) ?? "Без стратегии";
    (byStrat[name] ??= { n: 0, pnl: 0 }, byStrat[name].n++, byStrat[name].pnl += Number(t.pnl));
  }
  const byHour = {};
  for (const t of trades) {
    if (!t.closed_at) continue;
    const h = new Intl.DateTimeFormat("ru-RU", { timeZone: state.tz, hour: "2-digit" }).format(new Date(t.closed_at));
    (byHour[h] ??= { n: 0, pnl: 0 }, byHour[h].n++, byHour[h].pnl += Number(t.pnl));
  }
  const longs = trades.filter((t) => t.side === "Buy");
  const shorts = trades.filter((t) => t.side === "Sell");

  const li = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  el.innerHTML = `<div class="stats">
    ${li("Баланс за период", `${usd(startBal)} → ${usd(endBal)}`)}
    ${li("Результат", `${usd(totalRes, { sign: true })} ${startBal > 0 ? "(" + pct(totalRes / startBal * 100) + ")" : ""}`)}
    ${li("Сделок", `${trades.length} <span class="muted">(${wins.length} прибыльных / ${losses.length} убыточных)</span>`)}
    ${li("Win rate", trades.length ? pct(wins.length / trades.length * 100, { sign: false }) : "—")}
    ${li("Дней цель выполнена", `${goalDays} из ${withData.length}`)}
    ${li("Прибыльных / убыточных дней", `${results.filter((r) => r > 0).length} / ${results.filter((r) => r < 0).length}`)}
    ${li("Средняя прибыльная / убыточная", `${wins.length ? usd(sumW / wins.length) : "—"} / ${losses.length ? usd(sumL / losses.length) : "—"}`)}
    ${li("Лучшая / худшая сделка", `${trades.length ? usd(Math.max(...trades.map((t) => +t.pnl)), { sign: true }) + " / " + usd(Math.min(...trades.map((t) => +t.pnl)), { sign: true }) : "—"}`)}
    ${li("Profit factor", sumL !== 0 ? fmtRu(Math.abs(sumW / sumL), 2) : (sumW > 0 ? "∞" : "—"))}
    ${li("Макс. просадка (по дням)", usd(dd))}
    ${li("Комиссии", usd(fees))}
    ${li("Среднее время сделки", durs.length ? fmtDur(durs.reduce((a, b) => a + b, 0) / durs.length) : "—")}
    ${li("Long / Short", `${longs.length} (${usd(longs.reduce((s, t) => s + +t.pnl, 0), { sign: true })}) / ${shorts.length} (${usd(shorts.reduce((s, t) => s + +t.pnl, 0), { sign: true })})`)}
  </div>
  <div class="grid3">
    ${breakdown("По монетам", bySym)}
    ${breakdown("По стратегиям", byStrat)}
    ${breakdown("По часам закрытия", byHour, true)}
  </div>`;
}

function breakdown(title, map, sortKey = false) {
  const rows = Object.entries(map).sort((a, b) => sortKey ? a[0].localeCompare(b[0]) : b[1].pnl - a[1].pnl);
  if (!rows.length) return `<div><h3>${title}</h3><div class="muted">Нет данных</div></div>`;
  return `<div><h3>${title}</h3><table class="tbl mini">` + rows.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v.n}</td><td class="${v.pnl > 0 ? "green" : v.pnl < 0 ? "red" : ""}">${usd(v.pnl, { sign: true })}</td></tr>`).join("") + `</table></div>`;
}

// ---------- Таблица сделок (ТЗ 5.7) ----------
function renderTrades(trades, strategies) {
  renderTradesTable(root.querySelector("#dy-trades"), trades, strategies);
}

function renderTradesTable(container, trades, strategies) {
  const stratName = new Map(strategies.map((s) => [s.id, s.name]));
  const short = (iso) => iso ? new Intl.DateTimeFormat("ru-RU", {
    timeZone: state.tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso)) : "—";
  sortableTable(container, [
    { key: "sym", label: "Монета", type: "str", get: (t) => t.symbol,
      render: (t) => `<b>${esc(t.symbol)}</b><span class="sub"><span class="${t.side === "Buy" ? "green" : "red"}">${t.side === "Buy" ? "Long" : "Short"}</span>${t.leverage ? " · " + esc(t.leverage) + "x" : ""}</span>` },
    { key: "close", label: "Время", type: "str", get: (t) => t.closed_at,
      render: (t) => `${short(t.opened_at)} → ${short(t.closed_at)}<span class="sub">${t.opened_at && t.closed_at ? fmtDur(new Date(t.closed_at) - new Date(t.opened_at)) : ""}</span>` },
    { key: "entry", label: "Цена входа → выхода", type: "num", get: (t) => t.entry_price,
      render: (t) => `${price(t.entry_price)} → ${price(t.exit_price)}` },
    { key: "qty", label: "Размер", type: "num", get: (t) => t.qty * t.entry_price,
      render: (t) => `${usd(t.qty * t.entry_price)}<span class="sub">${fmtRu(t.qty, 4)} шт.</span>` },
    { key: "pnl", label: "Результат", type: "num", get: (t) => t.pnl,
      render: (t) => `<b class="${t.pnl > 0 ? "green" : t.pnl < 0 ? "red" : ""}">${usd(t.pnl, { sign: true })}</b><span class="sub">${t.entry_price * t.qty > 0 ? pct(t.pnl / (t.entry_price * t.qty) * 100) : ""}</span>` },
    { key: "fee", label: "Комиссии", type: "num",
      get: (t) => (Number(t.open_fee) || 0) + (Number(t.close_fee) || 0),
      render: (t) => t.open_fee != null || t.close_fee != null ? usd((+t.open_fee || 0) + (+t.close_fee || 0)) : "—" },
    { key: "strat", label: "Стратегия", type: "str",
      get: (t) => stratName.get(t.trade_notes?.strategy_id) ?? "",
      render: (t) => esc(stratName.get(t.trade_notes?.strategy_id) ?? "—") },
    { key: "notes", label: "📝", type: "str", sortable: false,
      get: () => "", render: (t) =>
        `${t.trade_notes?.comment ? "💬" : ""}${t.trade_notes?.state_tags?.length ? " 🏷" : ""}${t.attachments?.length ? " 📎" + t.attachments.length : ""}` },
  ], trades, {
    rowKey: (t) => t.id,
    emptyText: "Сделок за период нет",
    expand: (t) => `<div class="tradecard" data-tid="${esc(t.id)}"><div class="muted">Загружаю карточку…</div></div>`,
    onExpand: (key, isOpen, cont) => {
      if (!isOpen) return;
      const t = trades.find((x) => x.id === key);
      const holder = cont.querySelector(`.tradecard[data-tid="${CSS.escape(key)}"]`);
      if (t && holder) renderTradeCard(holder, t, strategies);
    },
  });
}
