// Симулятор: статистика счёта (§5.5) — сводка эпохи, эквити-кривая, сессии,
// сделки с фильтрами, прошлые эпохи; карточка сделки с автоскринами.
import { esc, fmtRu, fmtDT, fmtDur, openModal } from "../util.js";
import { tfById } from "./data.js";
import * as sapi from "./simapi.js";
import { openGallery } from "../gallery.js";

const money = (v) => `${v < 0 ? "−" : ""}$${fmtRu(Math.abs(Number(v) || 0), 2)}`;
const SIDE_RU = { long: "Лонг", short: "Шорт" };
const REASON_RU = { manual: "вручную", tp: "тейк", sl: "стоп", liq: "ликвидация", end: "конец сессии" };

export async function renderStats(el, account) {
  el.innerHTML = `<div class="loading">Считаю статистику…</div>`;
  let trades, sessions, epochs;
  try {
    [trades, sessions, epochs] = await Promise.all([
      sapi.loadAllTrades(account.id),
      sapi.loadSessions(account.id),
      sapi.loadEpochs(account.name),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="warn">Статистика: ${esc(e.message)}</div>`;
    return;
  }
  const closed = trades.filter((t) => t.exit_ts);

  el.innerHTML = `
    <div id="st-summary" class="sim-summary num"></div>
    <div id="st-equity" class="sim-equity"></div>
    <h3 style="margin-top:18px">Сделки</h3>
    <div id="st-filters" class="chips"></div>
    <div id="st-trades"></div>
    <h3 style="margin-top:18px">Сессии</h3>
    <div id="st-sessions"></div>
    ${epochs.length ? `<h3 style="margin-top:18px">Прошлые эпохи</h3><div id="st-epochs"></div>` : ""}`;

  renderSummary(el.querySelector("#st-summary"), account, closed);
  renderEquity(el.querySelector("#st-equity"), account, closed);
  renderTradeFilters(el, closed);
  renderSessions(el.querySelector("#st-sessions"), sessions, closed);
  if (epochs.length) renderEpochs(el.querySelector("#st-epochs"), epochs);
}

// ---------- Сводка эпохи ----------

function renderSummary(el, account, closed) {
  const pnl = closed.reduce((s, t) => s + Number(t.pnl), 0);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const sumW = wins.reduce((s, t) => s + Number(t.pnl), 0);
  const sumL = losses.reduce((s, t) => s + Number(t.pnl), 0);
  const pf = sumL ? sumW / Math.abs(sumL) : null;
  // просадка по кумулятивному PnL закрытых сделок от пика
  let peak = 0, dd = 0, cum = 0;
  for (const t of closed) { cum += Number(t.pnl); peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  const durs = closed.filter((t) => t.entry_ts && t.exit_ts)
    .map((t) => new Date(t.exit_ts) - new Date(t.entry_ts));

  const cell = (lbl, val, cls = "") =>
    `<div class="stc"><span class="lbl">${lbl}</span><span class="${cls}">${val}</span></div>`;
  el.innerHTML =
    cell("PnL эпохи", money(pnl), pnl > 0 ? "pos" : pnl < 0 ? "neg" : "") +
    cell("Сделок", String(closed.length)) +
    cell("Прибыльных", closed.length ? `${fmtRu(wins.length / closed.length * 100, 0)}% · ${wins.length}` : "—", "pos") +
    cell("Убыточных", closed.length ? `${fmtRu(losses.length / closed.length * 100, 0)}% · ${losses.length}` : "—", "neg") +
    cell("Profit factor", pf == null ? "—" : fmtRu(pf, 2)) +
    cell("Средняя прибыль", wins.length ? money(sumW / wins.length) : "—", "pos") +
    cell("Средний убыток", losses.length ? money(sumL / losses.length) : "—", "neg") +
    cell("Макс. просадка", money(-dd), dd > 0 ? "neg" : "") +
    cell("Средняя длительность", durs.length ? fmtDur(durs.reduce((a, b) => a + b, 0) / durs.length) : "—");
}

// ---------- Эквити-кривая ----------

function renderEquity(el, account, closed) {
  if (closed.length < 2) { el.innerHTML = ""; return; }
  const tk = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let cum = Number(account.start_deposit);
  const seen = new Set();
  const points = [];
  for (const t of closed) {
    cum += Number(t.pnl);
    let time = Math.floor(new Date(t.exit_ts).getTime() / 1000);
    while (seen.has(time)) time += 1; // lightweight-charts требует строго возрастающее время
    seen.add(time);
    points.push({ time, value: cum });
  }
  const chart = LightweightCharts.createChart(el, {
    height: 190,
    layout: { background: { color: "transparent" }, textColor: tk("--chart-axis-text") },
    grid: { vertLines: { color: tk("--chart-grid") }, horzLines: { color: tk("--chart-grid") } },
    crosshair: { vertLine: { color: tk("--chart-crosshair") }, horzLine: { color: tk("--chart-crosshair") } },
    timeScale: { timeVisible: true, borderColor: tk("--chart-grid") },
    rightPriceScale: { borderColor: tk("--chart-grid") },
    handleScroll: false, handleScale: false,
  });
  const series = chart.addAreaSeries({
    lineColor: tk("--chart-line"), lineWidth: 2,
    topColor: tk("--chart-area-top"), bottomColor: tk("--chart-area-bot"),
  });
  series.setData(points);
  series.createPriceLine({
    price: Number(account.start_deposit), color: tk("--chart-axis-text"),
    lineStyle: 2, title: "старт",
  });
  chart.timeScale().fitContent();
}

// ---------- Сделки с фильтрами ----------

function renderTradeFilters(root, closed) {
  const box = root.querySelector("#st-filters");
  const symbols = [...new Set(closed.map((t) => t.sim_sessions?.symbol).filter(Boolean))];
  const state = { symbol: null, side: null };
  const draw = () => {
    box.innerHTML =
      `<button class="chip ${!state.side ? "on" : ""}" data-side="">Все</button>` +
      `<button class="chip ${state.side === "long" ? "on" : ""}" data-side="long">Лонг</button>` +
      `<button class="chip ${state.side === "short" ? "on" : ""}" data-side="short">Шорт</button>` +
      (symbols.length > 1
        ? `<span class="ovdiv"></span>` + [null, ...symbols].map((s) =>
            `<button class="chip ${state.symbol === s ? "on" : ""}" data-sym="${s ?? ""}">${s ?? "Все пары"}</button>`).join("")
        : "");
    box.querySelectorAll(".chip[data-side]").forEach((c) => c.onclick = () => {
      state.side = c.dataset.side || null; draw();
    });
    box.querySelectorAll(".chip[data-sym]").forEach((c) => c.onclick = () => {
      state.symbol = c.dataset.sym || null; draw();
    });
    const rows = closed
      .filter((t) => (!state.side || t.side === state.side) && (!state.symbol || t.sim_sessions?.symbol === state.symbol))
      .slice().reverse();
    renderTradesTable(root.querySelector("#st-trades"), rows);
  };
  draw();
}

function renderTradesTable(el, rows) {
  if (!rows.length) { el.innerHTML = `<div class="empty">Сделок нет</div>`; return; }
  el.innerHTML = `<table class="tbl"><thead><tr>
      <th>Когда</th><th>Пара</th><th>Сторона</th><th>Маржа × плечо</th><th>Выход</th><th>Результат</th>
    </tr></thead><tbody>` +
    rows.map((t) => {
      const roi = Number(t.margin) ? (Number(t.pnl) / Number(t.margin)) * 100 : 0;
      const cls = t.pnl > 0 ? "pos" : t.pnl < 0 ? "neg" : "";
      const rowCls = t.pnl > 0 ? "tr-win" : t.pnl < 0 ? "tr-loss" : "";
      return `<tr class="trow clickable ${rowCls}" data-id="${t.id}">
        <td class="num">${fmtDT(t.entry_ts)}</td>
        <td>${esc(t.sim_sessions?.symbol ?? "")} · ${esc(tfById(t.sim_sessions?.timeframe).label)}</td>
        <td class="${t.side === "long" ? "pos" : "neg"}">${SIDE_RU[t.side] ?? t.side}</td>
        <td class="num">${money(t.margin)} × ${fmtRu(Number(t.leverage), 0)}</td>
        <td>${REASON_RU[t.exit_reason] ?? "—"}</td>
        <td class="num ${cls}">${money(t.pnl)} · ${roi >= 0 ? "+" : "−"}${fmtRu(Math.abs(roi), 1)}%</td>
      </tr>`;
    }).join("") + `</tbody></table>`;
  el.querySelectorAll("tr.trow").forEach((tr) => tr.onclick = () =>
    openTradeCard(rows.find((t) => String(t.id) === tr.dataset.id)));
}

// ---------- Карточка сделки: детали + автоскрины входа/выхода ----------

export async function openTradeCard(t) {
  const dur = t.entry_ts && t.exit_ts ? fmtDur(new Date(t.exit_ts) - new Date(t.entry_ts)) : "—";
  const m = openModal(`
    <h3>${SIDE_RU[t.side]} ${esc(t.sim_sessions?.symbol ?? "")} · ${money(t.pnl)}</h3>
    <div class="sim-tdetails">
      <div><span class="lbl">Вход</span><span class="num">${money(t.entry_price)} · ${fmtDT(t.entry_ts)}</span></div>
      <div><span class="lbl">Выход</span><span class="num">${money(t.exit_price)} · ${fmtDT(t.exit_ts)}</span></div>
      <div><span class="lbl">Маржа × плечо</span><span class="num">${money(t.margin)} × ${fmtRu(Number(t.leverage), 0)}</span></div>
      <div><span class="lbl">Длительность</span><span class="num">${dur}</span></div>
      <div><span class="lbl">TP / SL</span><span class="num">${t.tp_price ? money(t.tp_price) : "—"} / ${t.sl_price ? money(t.sl_price) : "—"}</span></div>
      <div><span class="lbl">Комиссии</span><span class="num">${money(t.fees)}</span></div>
      <div><span class="lbl">Причина закрытия</span><span>${REASON_RU[t.exit_reason] ?? "—"}</span></div>
      <div><span class="lbl">ROI</span><span class="num">${Number(t.margin) ? fmtRu(Number(t.pnl) / Number(t.margin) * 100, 1) + "%" : "—"}</span></div>
    </div>
    ${t.entry_note ? `<div class="sim-tnote"><span class="lbl">Обоснование входа</span>${esc(t.entry_note)}</div>` : ""}
    <div id="sim-shots" class="loading">Загружаю скрины…</div>`, { wide: true });

  const box = m.el.querySelector("#sim-shots");
  const [entry, exit] = await Promise.all([
    sapi.simShotUrl(t.id, "entry"), sapi.simShotUrl(t.id, "exit"),
  ]);
  const items = [
    entry && { url: entry, caption: "Вход", sub: fmtDT(t.entry_ts) },
    exit && { url: exit, caption: "Выход", sub: fmtDT(t.exit_ts) },
  ].filter(Boolean);
  if (!items.length) { box.classList.remove("loading"); box.innerHTML = `<div class="empty">Скринов нет</div>`; return; }
  box.classList.remove("loading");
  box.innerHTML = `<div class="gal">` + items.map((it, i) =>
    `<div class="gal-tile" data-i="${i}" style="background-image:url('${it.url.replace(/'/g, "%27")}')"><span class="gal-cap">${esc(it.caption)}</span></div>`).join("") + `</div>`;
  box.querySelectorAll(".gal-tile").forEach((tile) => tile.onclick = () =>
    openGallery(items, Number(tile.dataset.i)));
}

// ---------- Сессии ----------

function renderSessions(el, sessions, closed) {
  if (!sessions.length) { el.innerHTML = `<div class="empty">Сессий нет</div>`; return; }
  const byId = {};
  for (const t of closed) {
    (byId[t.session_id] ??= { n: 0, pnl: 0 });
    byId[t.session_id].n += 1;
    byId[t.session_id].pnl += Number(t.pnl);
  }
  el.innerHTML = `<table class="tbl"><thead><tr>
      <th>Когда</th><th>Пара · ТФ</th><th>Период</th><th>Сделок</th><th>Результат</th>
    </tr></thead><tbody>` +
    sessions.map((s) => {
      const agg = byId[s.id] ?? { n: 0, pnl: 0 };
      const cls = agg.pnl > 0 ? "pos" : agg.pnl < 0 ? "neg" : "";
      const period = s.random && !s.finished_at
        ? "случайная точка"
        : `${fmtDT(s.from_ts).split(",")[0]} — ${fmtDT(s.to_ts).split(",")[0]}${s.random ? " · случайная" : ""}`;
      return `<tr>
        <td class="num">${fmtDT(s.created_at)}</td>
        <td>${esc(s.symbol)} · ${esc(tfById(s.timeframe).label)}</td>
        <td class="num">${period}</td>
        <td class="num">${agg.n}</td>
        <td class="num ${cls}">${money(agg.pnl)}</td>
      </tr>`;
    }).join("") + `</tbody></table>`;
}

// ---------- Прошлые эпохи ----------

function renderEpochs(el, epochs) {
  el.innerHTML = epochs.map((a) => {
    const diff = Number(a.balance) - Number(a.start_deposit);
    const cls = diff > 0 ? "pos" : diff < 0 ? "neg" : "";
    return `<button class="ctrow" data-id="${a.id}">
      <span class="t num">${fmtDT(a.created_at).split(",")[0]} — ${fmtDT(a.closed_at).split(",")[0]}</span>
      <span class="num">${money(a.start_deposit)} → ${money(a.balance)}</span>
      <span class="num ${cls}">${diff >= 0 ? "+" : ""}${money(diff)}</span>
    </button>`;
  }).join("");
  el.querySelectorAll(".ctrow").forEach((b) => b.onclick = () => {
    const a = epochs.find((x) => String(x.id) === b.dataset.id);
    openEpoch(a);
  });
}

async function openEpoch(account) {
  const m = openModal(`
    <h3>Эпоха ${fmtDT(account.created_at).split(",")[0]} — ${fmtDT(account.closed_at).split(",")[0]}</h3>
    <div id="ep-body" class="loading">Загружаю…</div>`, { wide: true });
  const el = m.el.querySelector("#ep-body");
  el.classList.remove("loading");
  try {
    const trades = await sapi.loadAllTrades(account.id);
    const closed = trades.filter((t) => t.exit_ts);
    el.innerHTML = `<div class="sim-summary num" id="ep-sum"></div><div id="ep-trades" style="margin-top:14px"></div>`;
    renderSummary(el.querySelector("#ep-sum"), account, closed);
    renderTradesTable(el.querySelector("#ep-trades"), closed.slice().reverse());
  } catch (e) {
    el.innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  }
}
