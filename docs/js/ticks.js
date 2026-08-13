// Тиковый график: живая лента сделок Bybit (linear) → бары по N сделок.
// Затравка — REST recent-trade (последние 1000 сделок), дальше WebSocket publicTrade.
// История у публичного API неглубокая, поэтому график «растёт» вживую с момента открытия.

import { loadSymbols } from "./sim/data.js";
import { esc } from "./util.js";

const REST = "https://api.bybit.com/v5/market/recent-trade";
const WS_URL = "wss://stream.bybit.com/v5/public/linear";
const SIZE_STEP = 100;        // настройка размера бара идёт с шагом 100 тиков
const SIZE_MIN = 100;
const SIZE_MAX = 10000;
const TRADES_CAP = 200000;    // буфер сделок в памяти (~несколько часов на BTC)
const PING_MS = 20000;        // Bybit просит пинговать публичный WS каждые ≤20с

let T = null; // единственный живой экземпляр вкладки

const lsGet = (k, def) => localStorage.getItem(k) ?? def;

function clampSize(v) {
  const n = Math.round(Number(v) / SIZE_STEP) * SIZE_STEP;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number.isFinite(n) ? n : SIZE_MIN));
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Сборка баров: каждый бар = ровно N подряд идущих сделок ----------
// timestamp обязан строго расти (ключ бара в klinecharts), а сделки могут идти
// в одну миллисекунду — поэтому время бара поднимается минимум на 1мс от прежнего.

function buildBars(trades, size) {
  const bars = [];
  let prevTs = 0;
  for (let i = 0; i < trades.length; i += size) {
    const chunk = trades.slice(i, i + size);
    const bar = barFromChunk(chunk, prevTs);
    prevTs = bar.timestamp;
    bars.push(bar);
  }
  return bars;
}

function barFromChunk(chunk, prevTs) {
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let turnover = 0;
  for (const tr of chunk) {
    if (tr.p > high) high = tr.p;
    if (tr.p < low) low = tr.p;
    volume += tr.v;
    turnover += tr.v * tr.p;
  }
  return {
    timestamp: Math.max(chunk[0].t, prevTs + 1),
    open: chunk[0].p, high, low, close: chunk[chunk.length - 1].p,
    volume, turnover,
  };
}

// ---------- Данные Bybit ----------

async function fetchSeed(symbol) {
  const res = await fetch(`${REST}?category=linear&symbol=${encodeURIComponent(symbol)}&limit=1000`);
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const j = await res.json();
  if (j.retCode !== 0) throw new Error(`Bybit: ${j.retMsg || "код " + j.retCode}`);
  // список приходит от новых к старым — разворачиваем в хронологию
  return (j.result?.list ?? [])
    .map((r) => ({ t: Number(r.time), p: Number(r.price), v: Number(r.size), id: r.execId }))
    .reverse();
}

// ---------- Вкладка ----------

export function initTicks(root) {
  destroy(); // повторное открытие вкладки пересоздаёт всё с нуля

  const symbol = (lsGet("tick-symbol", "BTCUSDT") || "BTCUSDT").toUpperCase();
  const size = clampSize(lsGet("tick-size", "100"));

  root.innerHTML = `
    <div class="block" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <b>Тиковый график</b>
      <input id="tk-sym" class="num" list="tk-symlist" value="${esc(symbol)}" spellcheck="false"
             style="width:130px" title="Пара Bybit (перпетуалы USDT). Enter — применить">
      <datalist id="tk-symlist"></datalist>
      <label class="muted" style="display:flex;gap:6px;align-items:center">Тиков в баре
        <input id="tk-size" class="num" type="number" min="${SIZE_MIN}" max="${SIZE_MAX}" step="${SIZE_STEP}"
               value="${size}" inputmode="numeric" style="width:86px"></label>
      <span class="seg" id="tk-presets">
        ${[100, 300, 500, 1000].map((s) => `<button class="btn ${s === size ? "on" : ""}" data-sz="${s}">${s}</button>`).join("")}
      </span>
      <span class="spacer" style="flex:1"></span>
      <span id="tk-status" class="muted">Загрузка…</span>
      <span id="tk-count" class="num muted" title="Сделок в буфере · заполнение текущего бара"></span>
    </div>
    <div class="block" style="padding:0;overflow:hidden">
      <div id="tk-chart" style="height:calc(100vh - 200px);min-height:420px"></div>
    </div>
    <div class="muted" style="margin-top:8px">
      Бар = заданное число сделок (тиков) с Bybit. Затравка — последние 1000 сделок,
      дальше лента идёт вживую: чем дольше открыта вкладка, тем больше истории.
    </div>`;

  const k = window.klinecharts;
  if (!k) {
    root.querySelector("#tk-status").textContent = "Библиотека графика не загрузилась";
    return;
  }
  try {
    k.registerLocale("ru-RU", {
      time: "Время: ", open: "Откр: ", high: "Макс: ", low: "Мин: ",
      close: "Закр: ", volume: "Объём: ", turnover: "Оборот: ", change: "Изм: ",
    });
  } catch { /* локаль не критична */ }
  const chartEl = root.querySelector("#tk-chart");
  const chart = k.init(chartEl, { locale: "ru-RU" });
  styleChart(chart);
  chart.createIndicator({ name: "VOL", calcParams: [] }, false, { id: "tk_vol", height: 84 });

  T = {
    root, chart, chartEl, symbol, size,
    trades: [], seedIds: new Set(),
    ws: null, pingTimer: null, reconnectTimer: null,
    alive: true, gen: 0, // gen отсекает колбэки устаревших подключений
  };

  bindControls();
  watchTabLeave(root);
  start();
}

function styleChart(chart) {
  const up = css("--chart-candle-up") || "#4cc47a";
  const down = css("--chart-candle-down") || "#f0553f";
  const grid = css("--chart-grid") || "#26221c";
  const axis = css("--chart-axis-text") || "#6d655c";
  const border = css("--border") || "#322c25";
  chart.setStyles({
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      type: "ohlc", // как в симуляторе — Иван работает на барах
      bar: {
        upColor: up, downColor: down, noChangeColor: axis,
        upBorderColor: up, downBorderColor: down, noChangeBorderColor: axis,
        upWickColor: up, downWickColor: down, noChangeWickColor: axis,
      },
      priceMark: { high: { color: axis }, low: { color: axis },
        last: { upColor: up, downColor: down, noChangeColor: axis } },
      tooltip: { text: { color: css("--text-2") || "#c9c1b7" } },
    },
    indicator: {
      bars: [{ upColor: "rgba(76,196,122,.55)", downColor: "rgba(240,85,63,.5)", noChangeColor: axis }],
      tooltip: { text: { color: axis }, showName: false, showParams: false },
    },
    xAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: axis } },
    yAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: axis } },
    separator: { color: border },
    crosshair: {
      horizontal: { line: { color: css("--chart-crosshair") || "#8f877d" },
        text: { backgroundColor: css("--bg-3") || "#2a251f" } },
      vertical: { line: { color: css("--chart-crosshair") || "#8f877d" },
        text: { backgroundColor: css("--bg-3") || "#2a251f" } },
    },
  });
}

function bindControls() {
  const { root } = T;
  const symEl = root.querySelector("#tk-sym");
  const sizeEl = root.querySelector("#tk-size");

  loadSymbols().then((list) => {
    const dl = root.querySelector("#tk-symlist");
    if (dl) dl.innerHTML = list.map((s) => `<option value="${esc(s)}">`).join("");
  }).catch(() => { /* подсказки не критичны — пару можно ввести вручную */ });

  const applySymbol = () => {
    const v = symEl.value.trim().toUpperCase();
    if (!v || v === T.symbol) return;
    T.symbol = v;
    localStorage.setItem("tick-symbol", v);
    start(); // новая пара — новая лента с нуля
  };
  symEl.onchange = applySymbol;
  symEl.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applySymbol(); symEl.blur(); } };

  const applySize = (v) => {
    const n = clampSize(v);
    sizeEl.value = n;
    root.querySelectorAll("#tk-presets .btn").forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.sz) === n));
    if (n === T.size) return;
    T.size = n;
    localStorage.setItem("tick-size", String(n));
    redrawAll(); // бары пересобираются из уже накопленных сделок, лента не рвётся
  };
  sizeEl.onchange = () => applySize(sizeEl.value);
  root.querySelectorAll("#tk-presets .btn").forEach((b) => b.onclick = () => applySize(b.dataset.sz));
}

// уход со вкладки: пересоздания не будет, пока не вернёмся — глушим WS, чтобы
// сокет и таймеры не жили в фоне под другими вкладками
function watchTabLeave(root) {
  const pane = root.closest(".tabpane") ?? root;
  const mo = new MutationObserver(() => { if (pane.hidden) destroy(); });
  mo.observe(pane, { attributes: true, attributeFilter: ["hidden"] });
  T.mo = mo;
}

function setStatus(text, ok = false) {
  const el = T?.root.querySelector("#tk-status");
  if (el) {
    el.textContent = text;
    el.style.color = ok ? (css("--chart-candle-up") || "#4cc47a") : "";
  }
}

function updateCounter() {
  const el = T?.root.querySelector("#tk-count");
  if (!el) return;
  const inBar = T.trades.length % T.size || (T.trades.length ? T.size : 0);
  el.textContent = `${T.trades.length.toLocaleString("ru-RU")} сделок · бар ${inBar}/${T.size}`;
}

// ---------- Запуск ленты ----------

async function start() {
  const my = ++T.gen;
  stopNet();
  T.trades = [];
  T.seedIds = new Set();
  T.chart.applyNewData([]);
  setStatus("Загружаю ленту…");

  try {
    const seed = await fetchSeed(T.symbol);
    if (!T?.alive || T.gen !== my) return;
    T.trades = seed;
    for (const tr of seed) T.seedIds.add(tr.id);
    redrawAll();
  } catch (e) {
    if (!T?.alive || T.gen !== my) return;
    setStatus(`Ошибка загрузки: ${e.message}`);
    return;
  }
  connectWs(my);
}

function connectWs(my) {
  if (!T?.alive || T.gen !== my) return;
  setStatus("Подключаюсь…");
  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect(my);
    return;
  }
  T.ws = ws;

  ws.onopen = () => {
    if (T?.gen !== my) return;
    ws.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${T.symbol}`] }));
    setStatus("В эфире", true);
    T.pingTimer = setInterval(() => { try { ws.send('{"op":"ping"}'); } catch { /* закрыт */ } }, PING_MS);
  };

  ws.onmessage = (ev) => {
    if (T?.gen !== my) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg.topic?.startsWith("publicTrade.")) return;
    for (const d of msg.data ?? []) {
      if (T.seedIds.has(d.i)) continue; // стык REST-затравки и живой ленты
      pushTrade({ t: Number(d.T), p: Number(d.p), v: Number(d.v), id: d.i });
    }
    updateCounter();
  };

  // разрыв: Bybit мог прислать сделки, которые мы пропустили, поэтому
  // после паузы перезапускаем ленту целиком (затравка сошьёт дыру)
  ws.onclose = () => { if (T?.gen === my) scheduleReconnect(my); };
  ws.onerror = () => { try { ws.close(); } catch { /* уже закрыт */ } };
}

function scheduleReconnect(my) {
  stopNet();
  setStatus("Переподключаюсь…");
  T.reconnectTimer = setTimeout(() => { if (T?.alive && T.gen === my) start(); }, 2500);
}

function pushTrade(tr) {
  T.trades.push(tr);
  if (T.trades.length > TRADES_CAP) {
    // срезаем старину целыми барами, чтобы не перерисовывать всю историю
    T.trades.splice(0, T.size * 100);
    redrawAll();
    return;
  }
  // обновляем только последний (частичный) бар — дёшево на каждой сделке
  const lastStart = Math.floor((T.trades.length - 1) / T.size) * T.size;
  const chunk = T.trades.slice(lastStart);
  const prevTs = T.lastCompleteTs ?? 0;
  const bar = barFromChunk(chunk, prevTs);
  T.chart.updateData(bar);
  if (chunk.length === T.size) T.lastCompleteTs = bar.timestamp;
}

function redrawAll() {
  const bars = buildBars(T.trades, T.size);
  T.lastCompleteTs = T.trades.length % T.size === 0
    ? (bars[bars.length - 1]?.timestamp ?? 0)
    : (bars[bars.length - 2]?.timestamp ?? 0);
  T.chart.applyNewData(bars);
  updateCounter();
}

// ---------- Остановка ----------

function stopNet() {
  if (!T) return;
  clearInterval(T.pingTimer);
  clearTimeout(T.reconnectTimer);
  T.pingTimer = T.reconnectTimer = null;
  if (T.ws) {
    T.ws.onopen = T.ws.onmessage = T.ws.onclose = T.ws.onerror = null;
    try { T.ws.close(); } catch { /* уже закрыт */ }
    T.ws = null;
  }
}

function destroy() {
  if (!T) return;
  T.alive = false;
  T.gen++;
  stopNet();
  T.mo?.disconnect();
  try { window.klinecharts?.dispose(T.chartEl); } catch { /* контейнер уже удалён */ }
  T = null;
}
