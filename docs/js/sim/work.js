// Симулятор: рабочий экран сессии — график klinecharts, replay, торговая панель,
// открытая позиция, автоскрины входа/выхода. Живёт в модульном W: переключение
// вкладок терминала сессию не убивает (initSimulator проверяет workAlive()).
import { esc, fmtRu, fmtDT, notify, confirmToast, openModal } from "../util.js";
import * as eng from "./engine.js";
import * as sapi from "./simapi.js";
import { createSimChart, pricePrecision } from "./chart.js";

let W = null;

export const workAlive = () => !!W;
export const workResize = () => W?.chartApi?.resize();

const money = (v) => `${v < 0 ? "−" : ""}$${fmtRu(Math.abs(Number(v) || 0), 2)}`;
const px = (v, ref) => fmtRu(v, pricePrecision(ref ?? v));
const iso = (ms) => new Date(ms).toISOString();
const SPEED_MS = { 1: 1000, 5: 200, 20: 50, 100: 10 };
const REASON_RU = { manual: "вручную", liq: "ликвидация", end: "конец сессии" };
const WARMUP = 60; // видимых баров на старте — разгон перед торговлей

const svg = (paths, sw = 1.8) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TOOLS = [
  { name: "segment", title: "Трендовая линия", icon: svg('<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>') },
  { name: "rayLine", title: "Луч", icon: svg('<path d="M5 19 17 7"/><path d="M13.5 5.5H18.5V10.5"/><circle cx="5" cy="19" r="1.6"/>') },
  { name: "horizontalStraightLine", title: "Горизонтальный уровень", icon: svg('<path d="M4 12h16"/><circle cx="12" cy="12" r="1.6"/>') },
  { name: "fibonacciLine", title: "Фибо-ретрейсмент", icon: svg('<path d="M4 6h16M4 12h16M4 18h16"/>') },
  { name: "wave5", title: "Пятиволновка: 6 кликов по вершинам — (0) 1 2 3 4 5", icon: '<span class="tld">1-5</span>' },
  { name: "waveABC", title: "Коррекция: 4 клика по вершинам — (0) A B C", icon: '<span class="tld">ABC</span>' },
  { name: "text", title: "Текст (свободная подпись)", icon: svg('<path d="M6 6h12M12 6v12"/>', 2) },
];

export function mountWork(ctx) {
  const idx = Math.min(WARMUP, ctx.candles.length - 1);
  W = {
    ctx, idx,
    pos: null, closed: [],
    timer: null, speed: 5,
    balance: Number(ctx.account.balance),
    dataEnded: false,
    chartApi: null,
  };

  ctx.root.innerHTML = `
    <div class="sim-work">
      <div class="block sim-chartcol">
        <div class="sim-chartbar">
          <div class="seg" id="sw-type">
            <button class="btn on" data-ct="bars">Бары</button>
            <button class="btn" data-ct="candles">Свечи</button>
          </div>
          <div class="sim-tools">
            ${TOOLS.map((t) => `<button class="tool" data-draw="${t.name}" title="${t.title}">${t.icon}</button>`).join("")}
            <button class="tool" id="sw-clear" title="Стереть разметку">${svg('<path d="m14 5 5 5-9 9H5v-5Z"/><path d="M4 19h9"/>')}</button>
          </div>
          <span class="sim-sym num">${esc(ctx.session.symbol)}</span>
        </div>
        <div id="sim-chart"></div>
        <div class="sim-replay">
          <button id="sw-next" class="btn">След. бар ▸</button>
          <button id="sw-play" class="btn primary">▶ Плей</button>
          <div class="seg" id="sw-speed">
            ${[1, 5, 20, 100].map((s) => `<button class="btn ${s === W.speed ? "on" : ""}" data-s="${s}">×${s}</button>`).join("")}
          </div>
          <span id="sw-progress" class="num muted"></span>
          <span class="spacer"></span>
          <button id="sw-end" class="btn ghost">Завершить сессию</button>
        </div>
      </div>
      <aside class="sim-side">
        <div class="block" id="sw-panel"></div>
        <div class="block sim-sess" id="sw-sess"></div>
      </aside>
    </div>`;

  W.chartApi = createSimChart(ctx.root.querySelector("#sim-chart"));
  W.chartApi.setBars(ctx.candles.slice(0, W.idx));

  const $ = (s) => ctx.root.querySelector(s);
  $("#sw-next").onclick = () => { stopPlay(); next(); };
  $("#sw-play").onclick = togglePlay;
  $("#sw-end").onclick = endSession;
  ctx.root.querySelectorAll("#sw-speed .btn").forEach((b) => b.onclick = () => {
    W.speed = Number(b.dataset.s);
    ctx.root.querySelectorAll("#sw-speed .btn").forEach((x) => x.classList.toggle("on", x === b));
    if (W.timer) { stopPlay(); startPlay(); } // на лету меняем темп
  });
  ctx.root.querySelectorAll("#sw-type .btn").forEach((b) => b.onclick = () => {
    ctx.root.querySelectorAll("#sw-type .btn").forEach((x) => x.classList.toggle("on", x === b));
    W.chartApi.setType(b.dataset.ct);
  });
  ctx.root.querySelectorAll(".sim-tools .tool[data-draw]").forEach((b) => b.onclick = () => {
    if (b.dataset.draw === "text") return drawText();
    W.chartApi.draw(b.dataset.draw);
  });
  $("#sw-clear").onclick = async () => {
    if (await confirmToast("Стереть всю разметку на графике?", "Стереть")) W.chartApi.clearDrawings();
  };

  W.onResize = () => W.chartApi.resize();
  window.addEventListener("resize", W.onResize);
  W.onKey = (e) => {
    if (!W || e.target.closest("input, textarea, select")) return;
    if (e.code === "ArrowRight") { stopPlay(); next(); e.preventDefault(); }
    if (e.code === "Space") { togglePlay(); e.preventDefault(); }
  };
  document.addEventListener("keydown", W.onKey);

  renderPanel();
  renderSess();
  updateTicker();
}

function drawText() {
  const m = openModal(`
    <h3>Подпись на графике</h3>
    <label class="fld"><span>Текст (например, «3» или «C»)</span>
      <input id="dt-text" maxlength="24" autocomplete="off"></label>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button id="dt-ok" class="btn primary">Поставить — затем кликните точку на графике</button>
    </div>`);
  const inp = m.el.querySelector("#dt-text");
  inp.focus();
  m.el.querySelector("#dt-ok").onclick = () => {
    const t = inp.value.trim();
    if (!t) return;
    m.close();
    W.chartApi.draw("simpleAnnotation", t);
  };
}

// ---------- Replay ----------

const lastBar = () => W.ctx.candles[W.idx - 1];

function next() {
  if (!W) return false;
  if (W.idx >= W.ctx.candles.length) { endOfData(); return false; }
  const bar = W.ctx.candles[W.idx];
  W.idx += 1;
  W.chartApi.pushBar(bar);
  if (W.pos) {
    const liqPx = eng.checkLiquidation(W.pos, bar);
    if (liqPx != null) closeTrade("liq", liqPx, bar.timestamp);
  }
  updateTicker();
  return true;
}

function startPlay() {
  if (W.timer || W.idx >= W.ctx.candles.length) return;
  W.timer = setInterval(() => { if (!next()) stopPlay(); }, SPEED_MS[W.speed] ?? 200);
  const b = W.ctx.root.querySelector("#sw-play");
  if (b) b.textContent = "⏸ Пауза";
}

function stopPlay() {
  if (W?.timer) clearInterval(W.timer);
  if (W) W.timer = null;
  const b = W?.ctx.root.querySelector("#sw-play");
  if (b) b.textContent = "▶ Плей";
}

const togglePlay = () => (W.timer ? stopPlay() : startPlay());

function endOfData() {
  stopPlay();
  if (W.dataEnded) return;
  W.dataEnded = true;
  notify("История закончилась — завершите сессию", "info", 6000);
}

// ---------- Панели ----------

function renderPanel() {
  const el = W.ctx.root.querySelector("#sw-panel");
  if (!el) return;
  if (W.pos) return renderPosition(el);
  const lev = Number(localStorage.getItem("sim-lev")) || 10;
  const defMargin = Math.max(1, Math.round(W.balance * 0.1));
  el.innerHTML = `
    <h3>Торговля <span class="muted num">комиссия ${fmtRu(Number(W.ctx.session.fee_pct), 3)}%</span></h3>
    <div class="fld"><span>Плечо ×<b id="tp-levv" class="num">${lev}</b></span>
      <input id="tp-lev" type="range" min="1" max="100" step="1" value="${lev}">
      <div class="chips">${[1, 5, 10, 25, 50, 100].map((x) => `<button class="chip" data-lev="${x}">×${x}</button>`).join("")}</div>
    </div>
    <label class="fld"><span>Маржа, $ <span class="muted">(доступно ${money(W.balance)})</span></span>
      <input id="tp-margin" type="number" min="0" step="any" value="${defMargin}" inputmode="decimal"></label>
    <div class="chips">${[5, 10, 25, 50].map((p) => `<button class="chip" data-mpct="${p}">${p}%</button>`).join("")}</div>
    <div class="sim-preview num" id="tp-preview"></div>
    <div class="row sim-openrow">
      <button id="tp-long" class="btn buy">Открыть Лонг</button>
      <button id="tp-short" class="btn sell">Открыть Шорт</button>
    </div>`;

  const levInp = el.querySelector("#tp-lev");
  const mInp = el.querySelector("#tp-margin");
  const upd = () => {
    el.querySelector("#tp-levv").textContent = levInp.value;
    localStorage.setItem("sim-lev", levInp.value);
    updatePreview();
  };
  levInp.oninput = upd;
  mInp.oninput = updatePreview;
  el.querySelectorAll(".chip[data-lev]").forEach((c) => c.onclick = () => { levInp.value = c.dataset.lev; upd(); });
  el.querySelectorAll(".chip[data-mpct]").forEach((c) => c.onclick = () => {
    mInp.value = String(Math.floor(W.balance * Number(c.dataset.mpct)) / 100);
    updatePreview();
  });
  el.querySelector("#tp-long").onclick = () => openTrade("long");
  el.querySelector("#tp-short").onclick = () => openTrade("short");
  updatePreview();
}

function updatePreview() {
  const el = W?.ctx.root.querySelector("#tp-preview");
  if (!el) return;
  const margin = Number(W.ctx.root.querySelector("#tp-margin")?.value);
  const lev = Number(W.ctx.root.querySelector("#tp-lev")?.value) || 1;
  const price = lastBar().close;
  if (!(margin > 0)) { el.innerHTML = `<span class="muted">Укажите маржу</span>`; return; }
  const qty = margin * lev / price;
  const liqL = price * (1 - 0.95 / lev);
  const liqS = price * (1 + 0.95 / lev);
  el.innerHTML = `
    <div><span class="lbl">Цена</span><span>${px(price)}</span></div>
    <div><span class="lbl">Стоимость</span><span>${money(margin * lev)}</span></div>
    <div><span class="lbl">Кол-во</span><span>${fmtRu(qty, qty >= 100 ? 1 : 4)}</span></div>
    <div><span class="lbl">Ликв. лонг / шорт</span><span>${px(liqL, price)} / ${px(liqS, price)}</span></div>`;
}

function renderPosition(el) {
  const p = W.pos;
  const price = lastBar().close;
  const liq = eng.liqPrice(p);
  const be = eng.breakevenPrice(p, Number(W.ctx.session.fee_pct));
  el.innerHTML = `
    <h3>Позиция <span class="${p.side === "long" ? "pos" : "neg"}">${p.side === "long" ? "Лонг" : "Шорт"} ×${fmtRu(p.leverage, 0)}</span></h3>
    <div class="sim-posgrid num">
      <div><span class="lbl">Цена входа</span><span>${px(p.entryPrice)}</span></div>
      <div><span class="lbl">Маркировка</span><span id="pp-mark">${px(price, p.entryPrice)}</span></div>
      <div><span class="lbl">Ликвидация</span><span class="warn-t">${px(liq, p.entryPrice)}</span></div>
      <div><span class="lbl">Безубыток</span><span>${px(be, p.entryPrice)}</span></div>
      <div><span class="lbl">Маржа</span><span>${money(p.margin)}</span></div>
      <div><span class="lbl">Кол-во</span><span>${fmtRu(p.qty, p.qty >= 100 ? 1 : 4)}</span></div>
      <div><span class="lbl">НМ PnL</span><span id="pp-upnl">—</span></div>
      <div><span class="lbl">ROI</span><span id="pp-roi">—</span></div>
    </div>
    <button id="pp-close" class="btn primary sim-closebtn">Закрыть по рынку</button>`;
  el.querySelector("#pp-close").onclick = () => {
    const b = lastBar();
    closeTrade("manual", b.close, b.timestamp);
  };
  updateTicker();
}

function renderSess() {
  const el = W.ctx.root.querySelector("#sw-sess");
  if (!el) return;
  const st = eng.sessionStats(W.closed);
  const cls = st.pnl > 0 ? "pos" : st.pnl < 0 ? "neg" : "";
  el.innerHTML = `
    <h3>Сессия</h3>
    <div class="sim-sessgrid num">
      <div><span class="lbl">Баланс</span><b>${money(W.balance)}</b></div>
      <div><span class="lbl">PnL сессии</span><span class="${cls}">${money(st.pnl)}</span></div>
      <div><span class="lbl">Сделок</span><span>${st.n}</span></div>
      <div><span class="lbl">Winrate</span><span>${st.winrate == null ? "—" : fmtRu(st.winrate, 0) + "%"}</span></div>
    </div>`;
}

function updateTicker() {
  if (!W) return;
  const prog = W.ctx.root.querySelector("#sw-progress");
  if (prog) prog.textContent = `бар ${W.idx} из ${W.ctx.candles.length}`;
  if (!W.pos) return;
  const price = lastBar().close;
  const u = eng.uPnL(W.pos, price);
  const roi = eng.roiPct(W.pos, price);
  const cls = u > 0 ? "pos" : u < 0 ? "neg" : "";
  const mark = W.ctx.root.querySelector("#pp-mark");
  const upnl = W.ctx.root.querySelector("#pp-upnl");
  const roiEl = W.ctx.root.querySelector("#pp-roi");
  if (mark) mark.textContent = px(price, W.pos.entryPrice);
  if (upnl) { upnl.textContent = money(u); upnl.className = cls; }
  if (roiEl) { roiEl.textContent = `${roi >= 0 ? "+" : "−"}${fmtRu(Math.abs(roi), 1)}%`; roiEl.className = cls; }
}

// ---------- Сделки ----------

async function openTrade(side) {
  if (W.pos) return;
  const margin = Number(W.ctx.root.querySelector("#tp-margin")?.value);
  const leverage = Number(W.ctx.root.querySelector("#tp-lev")?.value);
  if (!(margin > 0)) return notify("Укажите маржу", "error");
  if (margin > W.balance) return notify("Маржа больше доступного баланса", "error");
  if (!(leverage >= 1 && leverage <= 100)) return notify("Плечо от 1 до 100", "error");
  const bar = lastBar();
  const feePct = Number(W.ctx.session.fee_pct);
  const pos = eng.openPosition({ side, margin, leverage, price: bar.close, ts: bar.timestamp, feePct });

  W.chartApi.showPosition({ side, entryPrice: pos.entryPrice, entryTs: pos.entryTs, liq: eng.liqPrice(pos) });
  const shot = W.chartApi.screenshot(); // автоскрин входа — с разметкой и линиями (§5.4)
  let trade;
  try {
    trade = await sapi.insertSimTrade({
      session_id: W.ctx.session.id, side, margin, leverage, qty: pos.qty,
      entry_ts: iso(pos.entryTs), entry_price: pos.entryPrice, fees: pos.entryFee,
    });
  } catch (e) {
    W.chartApi.hidePosition();
    return notify("Не удалось открыть сделку: " + e.message, "error", 6000);
  }
  W.pos = { ...pos, tradeId: trade.id };
  if (shot) sapi.uploadSimShot(trade.id, "entry", shot)
    .catch((e) => notify("Скрин входа не сохранился: " + e.message, "error", 6000));
  renderPanel();
}

async function closeTrade(reason, price, ts) {
  if (!W?.pos) return;
  const pos = W.pos;
  W.pos = null; // сразу, чтобы автоплей не закрыл дважды
  const raw = eng.closePosition(pos, { price, ts, feePct: Number(W.ctx.session.fee_pct), reason });
  const closed = reason === "liq" ? { ...raw, pnl: -pos.margin } : raw; // ликвидация сжигает маржу

  const shot = W.chartApi.screenshot(); // автоскрин выхода — линии позиции ещё на графике
  W.chartApi.hidePosition();
  W.closed = [...W.closed, closed];
  W.balance = W.balance + closed.pnl;
  renderPanel();
  renderSess();
  notify(`Сделка закрыта (${REASON_RU[reason] ?? reason}): ${money(closed.pnl)}`,
    closed.pnl < 0 ? "error" : "info");

  try {
    await sapi.closeSimTrade(pos.tradeId, {
      exit_ts: iso(ts), exit_price: price, exit_reason: reason,
      pnl: closed.pnl, fees: closed.fees,
    });
    await sapi.updateAccountBalance(W.ctx.account.id, W.balance);
    W.ctx.onBalance(W.balance);
    if (shot) await sapi.uploadSimShot(pos.tradeId, "exit", shot);
  } catch (e) {
    notify("Сохранение сделки: " + e.message, "error", 7000);
  }
}

// ---------- Завершение ----------

async function endSession() {
  const q = W.pos
    ? "Открытая позиция закроется по последнему бару. Завершить сессию?"
    : "Завершить сессию?";
  if (!(await confirmToast(q, "Завершить"))) return;
  stopPlay();
  if (W.pos) {
    const b = lastBar();
    await closeTrade("end", b.close, b.timestamp);
  }
  try { await sapi.finishSession(W.ctx.session.id); }
  catch (e) { notify("Сессия не пометилась завершённой: " + e.message, "error", 6000); }
  cleanup();
}

function cleanup() {
  stopPlay();
  window.removeEventListener("resize", W.onResize);
  document.removeEventListener("keydown", W.onKey);
  try { W.chartApi.destroy(); } catch { /* график уже убран из DOM */ }
  const exit = W.ctx.onExit;
  W = null;
  exit();
}
