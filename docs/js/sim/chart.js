// Симулятор: обёртка klinecharts v9 (UMD с CDN) — стили под токены терминала,
// бары/свечи, объём, инструменты рисования, линии позиции, скрин для автоснимков.
import { state } from "../util.js";

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// hex -> rgba с заданной прозрачностью (для заливок)
export const withAlpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// Точность цены по её порядку (у Bybit тик у всех разный — берём разумное приближение)
export function pricePrecision(p) {
  if (p >= 10000) return 1;
  if (p >= 100) return 2;
  if (p >= 1) return 4;
  if (p >= 0.001) return 6;
  return 8;
}

// ---------- Экстремальные объёмы (XVOL) ----------
// База — средний объём бара ТЕКУЩЕГО ТФ за прошлые s.days суток (границы суток UTC,
// как у Bybit); база меняется только на границе суток — никаких скользящих окон.
// mode "rel": объём ≥ mult × средний;  mode "abs": объём в диапазоне [from, to].

const DAY_MS = 86400e3;

const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

// Базы дня: по объёмам прошлых days суток — общий средний, средний пиковый
// (topN самых объёмных баров) и средний минимальный (topN самых тихих)
const dayBases = (list, days, topN) => {
  const byDay = new Map(); // индекс суток -> массив объёмов
  for (const b of list) {
    const d = Math.floor(b.timestamp / DAY_MS);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(b.volume ?? 0);
  }
  const cache = new Map(); // индекс суток -> {avg, peak, low} | null
  return (day) => {
    if (cache.has(day)) return cache.get(day);
    const vols = [];
    for (let k = 1; k <= days; k++) {
      const a = byDay.get(day - k);
      if (a) vols.push(...a);
    }
    let res = null;
    if (vols.length) {
      vols.sort((a, b) => b - a);
      const n = Math.max(1, Math.min(topN, vols.length));
      res = { avg: mean(vols), peak: mean(vols.slice(0, n)), low: mean(vols.slice(-n)) };
    }
    cache.set(day, res);
    return res;
  };
};

export function xvolEval(list, s) {
  const days = Math.max(1, Number(s.days) || 1);
  const topN = Math.max(1, Number(s.top) || 10);
  const baseKey = s.base === "peak" || s.base === "low" ? s.base : "avg";
  const basesFor = dayBases(list, days, topN);
  return list.map((b) => {
    const v = b.volume ?? 0;
    const bases = basesFor(Math.floor(b.timestamp / DAY_MS));
    const base = bases?.[baseKey] ?? null;
    let mark = false;
    if (s.mode === "abs") {
      const from = Number(s.from);
      const to = Number(s.to);
      mark = from > 0 && v >= from && (!(to > 0) || v <= to);
    } else if (base != null) {
      mark = v >= (Number(s.mult) || 2) * base;
    }
    return { mark, base, ratio: base ? v / base : null, high: b.high };
  });
}

// Справка для последнего бара за прошлые days суток: три ориентира —
// средний пиковый (по topN самым объёмным барам), общий средний,
// средний минимальный (по topN самым тихим). Для настройки диапазона.
export function xvolInfo(list, days, topN = 10) {
  const empty = { avg: null, avgPeak: null, avgLow: null, count: 0 };
  if (!list.length) return empty;
  const d = Math.max(1, Number(days) || 1);
  const day = Math.floor(list[list.length - 1].timestamp / DAY_MS);
  const vols = [];
  for (const b of list) {
    const bd = Math.floor(b.timestamp / DAY_MS);
    if (bd >= day - d && bd < day) vols.push(b.volume ?? 0);
  }
  if (!vols.length) return empty;
  vols.sort((a, b) => b - a);
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const n = Math.max(1, Math.min(Number(topN) || 10, vols.length));
  return {
    avg: mean(vols),
    avgPeak: mean(vols.slice(0, n)),
    avgLow: mean(vols.slice(-n)),
    count: vols.length,
  };
}

// ---------- Расширения: индикатор WWV и разметка волн (регистрируются один раз) ----------

let extensionsReady = false;
let shiftDown = false; // Shift при рисовании = строго горизонтальная линия (как в TradingView)

function registerExtensions(k) {
  if (extensionsReady) return;
  extensionsReady = true;

  window.addEventListener("keydown", (e) => { if (e.key === "Shift") shiftDown = true; });
  window.addEventListener("keyup", (e) => { if (e.key === "Shift") shiftDown = false; });
  window.addEventListener("blur", () => { shiftDown = false; });

  // при зажатом Shift текущая точка прилипает по цене к другой точке линии
  const shiftSnap = ({ points, performPointIndex, performPoint }) => {
    const anchor = points[performPointIndex === 0 ? 1 : 0];
    if (shiftDown && anchor?.value != null) performPoint.value = anchor.value;
  };

  // продолжение луча от точки a через b до края области графика
  const extendToEdge = (a, b, bounding) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return b;
    const ts = [];
    if (dx > 0) ts.push((bounding.width - a.x) / dx);
    if (dx < 0) ts.push(-a.x / dx);
    if (dy > 0) ts.push((bounding.height - a.y) / dy);
    if (dy < 0) ts.push(-a.y / dy);
    const t = Math.min(...ts.filter((v) => v > 0));
    return Number.isFinite(t) ? { x: a.x + dx * t, y: a.y + dy * t } : b;
  };

  // Трендовая и луч с поддержкой Shift (встроенные segment/rayLine хука снапа не дают)
  k.registerOverlay({
    name: "simSegment",
    totalStep: 3,
    needDefaultPointFigure: true,
    performEventMoveForDrawing: shiftSnap,
    performEventPressedMove: shiftSnap,
    createPointFigures: ({ coordinates }) =>
      coordinates.length > 1 ? [{ type: "line", attrs: { coordinates } }] : [],
  });
  k.registerOverlay({
    name: "simRay",
    totalStep: 3,
    needDefaultPointFigure: true,
    performEventMoveForDrawing: shiftSnap,
    performEventPressedMove: shiftSnap,
    createPointFigures: ({ coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      return [{ type: "line", attrs: { coordinates: [a, extendToEdge(a, b, bounding)] } }];
    },
  });

  // Свободный комментарий (как в TradingView): перетаскивается, редактируется
  // по двойному клику, настраиваются цвет текста, заливка и её прозрачность
  k.registerOverlay({
    name: "simText",
    totalStep: 2,
    needDefaultPointFigure: true,
    createPointFigures: ({ overlay, coordinates }) => {
      const c = coordinates[0];
      if (!c) return [];
      const st = overlay.styles?.text ?? {};
      return [{
        type: "text",
        attrs: { x: c.x, y: c.y - 4, text: String(overlay.extendData ?? ""), align: "center", baseline: "bottom" },
        styles: {
          color: st.color || "#ffffff",
          size: st.size || 13,
          weight: 500,
          backgroundColor: st.backgroundColor ?? "rgba(139,92,246,.85)",
          paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5,
        },
      }];
    },
  });

  // Прямоугольник: выделение диапазона баров/цен; привязан ко времени —
  // на любом таймфрейме накрывает тот же период (как в TradingView)
  k.registerOverlay({
    name: "simRect",
    totalStep: 3,
    needDefaultPointFigure: true,
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const st = overlay.styles?.line ?? {};
      const color = st.color || "#b598fb";
      return [{
        type: "polygon",
        attrs: { coordinates: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }] },
        styles: {
          style: "stroke_fill",
          color: withAlpha(color, 0.12),
          borderColor: color, borderSize: st.size || 1, borderStyle: st.style || "solid",
        },
      }];
    },
  });

  // Знаки ⚡ над барами с экстремальным объёмом — рисуются на свечной панели
  k.registerIndicator({
    name: "XVOL",
    shortName: "⚡Объём",
    calcParams: ["{}"],
    figures: [],
    calc: (list, { calcParams }) => {
      let s = {};
      try { s = JSON.parse(calcParams[0]) ?? {}; } catch { /* дефолты */ }
      return xvolEval(list, s);
    },
    draw: ({ ctx, visibleRange, indicator, xAxis, yAxis }) => {
      const res = indicator.result ?? [];
      const from = Math.max(0, Math.floor(visibleRange?.from ?? 0));
      const to = Math.min(res.length, Math.ceil(visibleRange?.to ?? res.length));
      ctx.save();
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "#e0a83a";
      for (let i = from; i < to; i++) {
        if (!res[i]?.mark) continue;
        ctx.fillText("⚡", xAxis.convertToPixel(i), yAxis.convertToPixel(res[i].high) - 4);
      }
      ctx.restore();
      return true; // фигуры по умолчанию не рисуем
    },
  });

  // Плашка uPnL/ROI у линии входа (как на Bybit) — обновляется каждый бар
  k.registerOverlay({
    name: "pnlTag",
    totalStep: 2,
    lock: true,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const c = coordinates[0];
      const d = overlay.extendData;
      if (!c || !d?.text) return [];
      return [{
        type: "text",
        ignoreEvent: true,
        attrs: { x: bounding.width - 8, y: c.y - 6, text: d.text, align: "right", baseline: "bottom" },
        styles: {
          color: "#fff", backgroundColor: d.bg, size: 12, weight: 600,
          paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4,
        },
      }];
    },
  });

  // WWV ATR 14 Close (Weis Wave Volume) — объём, накопленный по волнам движения цены;
  // волна разворачивается, когда close откатывает от экстремума волны больше ATR(14).
  k.registerIndicator({
    name: "WWV",
    shortName: "WWV ATR 14",
    calcParams: [14],
    figures: [{
      key: "wave", title: "Волна: ", type: "bar", baseValue: 0,
      styles: ({ current }) => ({
        color: (current?.dir ?? 1) > 0 ? "rgba(76,196,122,.55)" : "rgba(240,85,63,.5)",
      }),
    }],
    calc: (list, { calcParams }) => {
      const period = calcParams[0] ?? 14;
      let atr = 0;
      let dir = 0;
      let extreme = null;
      let vol = 0;
      return list.map((b, i) => {
        const prevClose = i ? list[i - 1].close : b.close;
        const tr = Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
        atr = i === 0 ? tr : (atr * (period - 1) + tr) / period; // RMA Уайлдера
        if (dir === 0) { dir = b.close >= prevClose ? 1 : -1; extreme = b.close; }
        if (dir > 0) {
          if (b.close > extreme) extreme = b.close;
          if (atr > 0 && extreme - b.close >= atr) { dir = -1; extreme = b.close; vol = 0; }
        } else {
          if (b.close < extreme) extreme = b.close;
          if (atr > 0 && b.close - extreme >= atr) { dir = 1; extreme = b.close; vol = 0; }
        }
        vol += b.volume ?? 0;
        return { wave: vol, dir };
      });
    },
  });

  // Разметка волн: только подписи у вершин/низов, без линий (по требованию Ивана).
  // 4 уровня нотации Эллиотта: ((1)) старший → (1) → 1 → i младший; extendData = уровень.
  const WAVE_SETS = {
    wave5: [
      ["((0))", "((1))", "((2))", "((3))", "((4))", "((5))"],
      ["(0)", "(1)", "(2)", "(3)", "(4)", "(5)"],
      ["0", "1", "2", "3", "4", "5"],
      ["0", "i", "ii", "iii", "iv", "v"],
    ],
    waveABC: [
      ["((0))", "((A))", "((B))", "((C))"],
      ["(0)", "(A)", "(B)", "(C)"],
      ["0", "A", "B", "C"],
      ["0", "a", "b", "c"],
    ],
  };
  const WAVE_SIZES = [15, 14, 13, 12];
  const waveOverlay = (name) => ({
    name,
    totalStep: WAVE_SETS[name][0].length + 1,
    needDefaultPointFigure: true,
    createPointFigures: ({ overlay, coordinates }) => {
      const level = Math.min(Math.max(Number(overlay.extendData) || 3, 1), 4);
      const labels = WAVE_SETS[name][level - 1];
      const color = overlay.styles?.text?.color || css("--accent-text") || "#b598fb";
      return coordinates.map((c, i) => {
        // подпись над вершиной и под низом: сравниваем с соседними точками разметки
        const ys = [coordinates[i - 1]?.y, coordinates[i + 1]?.y].filter((v) => v != null);
        const above = ys.length ? c.y <= Math.min(...ys) : true;
        // клики по подписи ловятся — так волну можно выделить, перекрасить, удалить
        return {
          type: "text",
          attrs: {
            x: c.x, y: above ? c.y - 8 : c.y + 8, text: labels[i] ?? "",
            align: "center", baseline: above ? "bottom" : "top",
          },
          styles: {
            color, size: WAVE_SIZES[level - 1], weight: 600,
            backgroundColor: "rgba(19,17,16,.72)",
            paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
            borderRadius: 4,
          },
        };
      });
    },
  });
  k.registerOverlay(waveOverlay("wave5"));
  k.registerOverlay(waveOverlay("waveABC"));
}

// hooks: onOverlaySelect(id, name) / onOverlayDeselect() — панель настроек инструмента;
// onTpSlDrag(kind, price) — перетаскивание уровня TP/SL за линию.
// opts.hideTime — режим «случайная точка»: ось времени и время в тултипе скрыты.
export function createSimChart(el, hooks = {}, opts = {}) {
  const k = window.klinecharts;
  if (!k) throw new Error("Библиотека графика не загрузилась — проверьте интернет");
  registerExtensions(k);
  try {
    k.registerLocale("ru-RU", {
      time: "Время: ", open: "Откр: ", high: "Макс: ", low: "Мин: ",
      close: "Закр: ", volume: "Объём: ", turnover: "Оборот: ", change: "Изм: ",
    });
  } catch { /* локаль не критична */ }
  const chart = k.init(el, { locale: "ru-RU" });

  const up = css("--chart-candle-up") || "#4cc47a";
  const down = css("--chart-candle-down") || "#f0553f";
  const grid = css("--chart-grid") || "#26221c";
  const axis = css("--chart-axis-text") || "#6d655c";
  const border = css("--border") || "#322c25";
  const cross = css("--chart-crosshair") || "#8f877d";

  chart.setStyles({
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      type: "ohlc", // Иван работает на барах — дефолт бары
      bar: {
        upColor: up, downColor: down, noChangeColor: axis,
        upBorderColor: up, downBorderColor: down, noChangeBorderColor: axis,
        upWickColor: up, downWickColor: down, noChangeWickColor: axis,
      },
      priceMark: {
        high: { color: axis }, low: { color: axis },
        last: { upColor: up, downColor: down, noChangeColor: axis },
      },
      tooltip: { text: { color: css("--text-2") || "#c9c1b7" } },
    },
    indicator: {
      bars: [{ upColor: "rgba(76,196,122,.55)", downColor: "rgba(240,85,63,.5)", noChangeColor: axis }],
      lines: [{ color: css("--accent-text") }, { color: css("--warn") }, { color: up }],
      tooltip: { text: { color: axis } },
    },
    xAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: axis } },
    yAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: { color: axis } },
    separator: { color: border },
    crosshair: {
      horizontal: { line: { color: cross }, text: { backgroundColor: css("--bg-3") || "#2a251f" } },
      vertical: { line: { color: cross }, text: { backgroundColor: css("--bg-3") || "#2a251f" } },
    },
    overlay: {
      line: { color: css("--accent-text") || "#b598fb" },
      point: {
        color: css("--accent") || "#8b5cf6", borderColor: "rgba(139,92,246,.35)",
        activeColor: css("--accent-hover") || "#9d78f8", activeBorderColor: "rgba(139,92,246,.35)",
      },
      text: { color: "#fff", backgroundColor: css("--accent") || "#8b5cf6" },
    },
  });
  try { chart.setTimezone(state.tz); } catch { /* не критично */ }
  if (opts.hideTime) {
    // случайная точка: дата скрыта до конца сессии — без оси времени и «Время» в тултипе
    chart.setStyles({
      xAxis: { tickText: { show: false } },
      crosshair: { vertical: { text: { show: false } } },
      candle: { tooltip: { custom: [
        { title: "Откр: ", value: "{open}" }, { title: "Макс: ", value: "{high}" },
        { title: "Мин: ", value: "{low}" }, { title: "Закр: ", value: "{close}" },
        { title: "Объём: ", value: "{volume}" },
      ] } },
    });
  }
  // Объём без MA-линий — чистая гистограмма; под ним WWV ATR 14 (как на Bybit у Ивана)
  chart.createIndicator({ name: "VOL", calcParams: [] }, false, { id: "sim_vol", height: 72 });
  chart.createIndicator({ name: "WWV", calcParams: [14] }, false, { id: "sim_wwv", height: 72 });

  const drawn = new Set();  // пользовательская разметка
  let lastDrawn = null;     // оверлей, который сейчас рисуется (для finishDrawing)
  const posIds = [];        // линии открытой позиции
  const tpsl = { tp: null, sl: null }; // перетаскиваемые уровни
  let pnlId = null;         // плашка uPnL у линии входа

  // Канон разметки — свой реестр: точки хранятся как (timestamp, value).
  // klinecharts привязывает оверлеи к индексу бара ТЕКУЩЕГО вида, поэтому при
  // смене таймфрейма их нужно пересоздавать по времени — иначе разметка «едет».
  const registry = new Map(); // id -> { name, points:[{timestamp,value}], styles, extendData }
  let curBars = [];  // бары текущего вида
  let curTfMs = 0;   // шаг текущего вида (для экстраполяции за края данных)

  // timestamp -> индекс бара вида; за краями — линейная экстраполяция по шагу ТФ
  const tsToIndex = (ts) => {
    const n = curBars.length;
    if (!n || ts == null) return 0;
    const first = curBars[0].timestamp;
    const last = curBars[n - 1].timestamp;
    const step = curTfMs || (n > 1 ? (last - first) / (n - 1) : 1);
    if (ts <= first) return Math.round((ts - first) / step); // отрицательный — слева за данными
    if (ts >= last) return n - 1 + Math.round((ts - last) / step);
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (curBars[mid].timestamp <= ts) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const pointTs = (p) => {
    if (p.timestamp != null) return p.timestamp;
    const i = p.dataIndex ?? 0;
    if (curBars[i]) return curBars[i].timestamp;
    const n = curBars.length;
    if (!n) return null;
    const step = curTfMs || 1;
    return i < 0 ? curBars[0].timestamp + i * step
                 : curBars[n - 1].timestamp + (i - (n - 1)) * step;
  };

  // после рисования/перетаскивания фиксируем актуальные точки в реестре
  const syncEntry = (id) => {
    const e = registry.get(id);
    const ov = chart.getOverlayById?.(id);
    if (e && ov?.points?.length) {
      e.points = ov.points.map((p) => ({ timestamp: pointTs(p), value: p.value }));
    }
  };

  const mergeStyles = (base = {}, patch = {}) => {
    const out = { ...base };
    for (const key of Object.keys(patch)) out[key] = { ...(base[key] ?? {}), ...patch[key] };
    return out;
  };

  // создать оверлей из записи реестра (готовым — все точки сразу)
  const createFromEntry = (e) => {
    const raw = chart.createOverlay({
      name: e.name,
      points: e.points.map((p) => ({ dataIndex: tsToIndex(p.timestamp), value: p.value })),
      ...(e.styles ? { styles: e.styles } : {}),
      ...(e.extendData != null ? { extendData: e.extendData } : {}),
      onPressedMoveEnd: (ev) => syncEntry(ev.overlay.id),
    });
    const id = [].concat(raw)[0];
    if (id) { drawn.add(id); registry.set(id, e); }
    return id ?? null;
  };

  const tpslLine = (kind, value) => chart.createOverlay({
    name: "priceLine", points: [{ value }],
    styles: {
      line: { color: kind === "tp" ? up : down, style: "dashed" },
      text: { backgroundColor: kind === "tp" ? up : down, color: "#fff" },
    },
    onPressedMoveEnd: (e) => {
      const v = e.overlay.points?.[0]?.value;
      if (v != null) hooks.onTpSlDrag?.(kind, v);
    },
  });

  return {
    chart,
    setBars(list, tfMs) {
      curBars = list.slice();
      if (tfMs) curTfMs = tfMs;
      const last = list[list.length - 1];
      try { chart.setPriceVolumePrecision(pricePrecision(last?.close ?? 1), 3); } catch { /* старая сигнатура */ }
      chart.applyNewData(list.map((c) => ({ ...c })));
    },
    pushBar(bar) {
      const last = curBars[curBars.length - 1];
      if (last && last.timestamp === bar.timestamp) curBars[curBars.length - 1] = { ...bar };
      else curBars.push({ ...bar });
      chart.updateData({ ...bar });
    },
    setType(t) { chart.setStyles({ candle: { type: t === "candles" ? "candle_solid" : "ohlc" } }); },

    // Рисование: юзер выбирает инструмент, точки ставит кликами по графику.
    // styles — запомненный стиль инструмента (последний выбранный цвет/толщина/тип)
    draw(name, extendData, styles) {
      const id = chart.createOverlay({
        name,
        ...(styles ? { styles } : {}),
        ...(extendData != null ? { extendData } : {}),
        onDrawEnd: (e) => { if (lastDrawn === e.overlay.id) lastDrawn = null; syncEntry(e.overlay.id); },
        onPressedMoveEnd: (e) => syncEntry(e.overlay.id),
      });
      for (const i of [].concat(id)) if (i) {
        drawn.add(i);
        lastDrawn = i;
        registry.set(i, { name, extendData, styles, points: [] });
      }
    },

    // Принудительное завершение рисования: klinecharts сам завершает оверлей только
    // лишним кликом — когда все точки поставлены, помечаем завершённым напрямую
    finishDrawing() {
      const id = lastDrawn;
      lastDrawn = null;
      if (!id) return;
      const ov = chart.getOverlayById?.(id);
      if (!ov?.points?.length) return;
      // гасим «прогресс рисования» klinecharts, иначе следующие клики шагают призрака
      ov.forceComplete?.();
      try { chart.getChartStore?.().getOverlayStore?.().progressInstanceComplete?.(); }
      catch { /* приватный путь может смениться в будущих версиях — не критично */ }
      syncEntry(id);
    },

    // Пересоздание всей разметки по (timestamp, value) — вызывается при смене
    // таймфрейма отображения, чтобы элементы остались на своих местах
    reanchorDrawings() {
      const entries = [...registry.entries()];
      registry.clear();
      for (const [id] of entries) { chart.removeOverlay({ id }); drawn.delete(id); }
      for (const [, e] of entries) if (e.points.length) createFromEntry(e);
    },

    // Копия элемента со сдвигом по цене (для построения каналов); возвращает {id, name}
    cloneDrawn(id) {
      const e = registry.get(id);
      if (!e?.points?.length) return null;
      const vis = curBars.slice(-250);
      const span = vis.length
        ? Math.max(...vis.map((b) => b.high)) - Math.min(...vis.map((b) => b.low)) : 0;
      const off = span ? span * 0.05 : Math.abs(e.points[0].value || 1) * 0.002;
      const copy = {
        name: e.name,
        extendData: e.extendData,
        styles: e.styles ? JSON.parse(JSON.stringify(e.styles)) : undefined,
        points: e.points.map((p) => ({ ...p, value: p.value + off })),
      };
      const nid = createFromEntry(copy);
      return nid ? { id: nid, name: copy.name } : null;
    },

    // Текст по клику в точку графика (как в TradingView), без лимита символов
    addTextAt(x, y, text, styles) {
      const p = [].concat(chart.convertFromPixel([{ x, y }], { paneId: "candle_pane" }))[0];
      if (!p || p.value == null) return null;
      const e = {
        name: "simText",
        extendData: text,
        styles: styles ? JSON.parse(JSON.stringify(styles)) : undefined,
        points: [{ timestamp: pointTs(p), value: p.value }],
      };
      const id = createFromEntry(e);
      return id ? { id, name: "simText" } : null;
    },

    // Данные комментария для редактирования (текст + стили из реестра)
    textData(id) {
      const e = registry.get(id);
      return e ? { text: String(e.extendData ?? ""), styles: e.styles ?? {} } : null;
    },
    updateText(id, text) {
      chart.overrideOverlay({ id, extendData: text });
      const e = registry.get(id);
      if (e) e.extendData = text;
    },
    // Экранная позиция первой точки оверлея (для поля редактирования)
    overlayPixel(id) {
      const ov = chart.getOverlayById?.(id);
      if (!ov?.points?.length) return null;
      const c = [].concat(chart.convertToPixel(
        [{ timestamp: ov.points[0].timestamp, dataIndex: ov.points[0].dataIndex, value: ov.points[0].value }],
        { paneId: "candle_pane" }))[0];
      return c && Number.isFinite(c.x) ? { x: c.x, y: c.y } : null;
    },

    // Свой hit-test по клику: события кликов по фигурам в klinecharts ненадёжны,
    // поэтому попадание в нарисованный объект ищем сами по расстоянию до его
    // точек и отрезков между ними. Возвращает { id, name } или null.
    hitTest(x, y) {
      const d2seg = (px0, py0, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px0 - a.x) * dx + (py0 - a.y) * dy) / len2)) : 0;
        return Math.hypot(px0 - (a.x + dx * t), py0 - (a.y + dy * t));
      };
      let best = null;
      let bestD = Infinity;
      for (const id of drawn) {
        const ov = chart.getOverlayById?.(id);
        if (!ov?.points?.length) continue;
        const tol = ["wave5", "waveABC", "simText", "simpleAnnotation"].includes(ov.name) ? 28 : 14;
        const cs = [].concat(chart.convertToPixel(
          ov.points.map((p) => ({ timestamp: p.timestamp, dataIndex: p.dataIndex, value: p.value })),
          { paneId: "candle_pane" },
        )).filter((c) => c && Number.isFinite(c.x));
        // прямоугольник: попадание — весь его контур и внутренность
        if (ov.name === "simRect" && cs.length > 1) {
          const x0 = Math.min(cs[0].x, cs[1].x), x1 = Math.max(cs[0].x, cs[1].x);
          const y0 = Math.min(cs[0].y, cs[1].y), y1 = Math.max(cs[0].y, cs[1].y);
          if (x >= x0 - 6 && x <= x1 + 6 && y >= y0 - 6 && y <= y1 + 6) {
            const d = 10; // внутри, но с меньшим приоритетом, чем точное попадание в линию
            if (d < bestD) { bestD = d; best = { id, name: ov.name }; }
          }
          continue;
        }
        for (let i = 0; i < cs.length; i++) {
          let d = Math.hypot(x - cs[i].x, y - cs[i].y);
          // у горизонтали и луча зона — вся линия, не только точки
          if (ov.name === "horizontalStraightLine") d = Math.min(d, Math.abs(y - cs[i].y));
          if (i > 0 && ov.name !== "wave5" && ov.name !== "waveABC") {
            d = Math.min(d, d2seg(x, y, cs[i - 1], cs[i]));
          }
          if (i > 0 && ov.name === "simRay") {
            // продолжение луча за вторую точку
            const a = cs[0], b = cs[1];
            const far = { x: b.x + (b.x - a.x) * 100, y: b.y + (b.y - a.y) * 100 };
            d = Math.min(d, d2seg(x, y, b, far));
          }
          if (d < tol && d < bestD) { bestD = d; best = { id, name: ov.name }; }
        }
      }
      return best;
    },
    // Настройки выделенного инструмента: цвет/толщина/тип линии
    restyleOverlay(id, styles) {
      chart.overrideOverlay({ id, styles });
      const e = registry.get(id);
      if (e) e.styles = mergeStyles(e.styles, styles);
    },
    removeDrawn(id) {
      chart.removeOverlay({ id });
      drawn.delete(id);
      registry.delete(id);
      hooks.onOverlayDeselect?.();
    },
    clearDrawings() {
      for (const id of drawn) chart.removeOverlay({ id });
      drawn.clear();
      registry.clear();
      hooks.onOverlayDeselect?.();
    },

    // Линии позиции: вход (сплошная), ликвидация (пунктир), метка B/S на баре входа
    showPosition({ side, entryPrice, entryTs, liq }) {
      this.hidePosition();
      const col = side === "long" ? up : down;
      posIds.push(chart.createOverlay({
        name: "priceLine", lock: true, points: [{ value: entryPrice }],
        styles: { line: { color: col }, text: { backgroundColor: col, color: "#fff" } },
      }));
      posIds.push(chart.createOverlay({
        name: "priceLine", lock: true, points: [{ value: liq }],
        styles: { line: { color: css("--warn") || "#e0a83a", style: "dashed" },
                  text: { backgroundColor: css("--warn") || "#e0a83a", color: "#1a1714" } },
      }));
      posIds.push(chart.createOverlay({
        name: "simpleAnnotation", lock: true, extendData: side === "long" ? "B" : "S",
        points: [{ timestamp: entryTs, value: entryPrice }],
        styles: { text: { color: "#fff", backgroundColor: col } },
      }));
    },
    hidePosition() {
      for (const id of posIds.splice(0)) if (id) chart.removeOverlay({ id });
      this.setTpSl({ tp: null, sl: null });
      this.setPnlTag(null);
    },

    // Индикатор экстремальных объёмов: s = настройки или {on:false} — убрать
    setXvol(s) {
      const norm = (got) => (got instanceof Map ? got.get("XVOL") : Array.isArray(got) ? got[0] : got);
      const has = !!norm(chart.getIndicatorByPaneId?.("candle_pane", "XVOL"));
      if (!s?.on) {
        if (has) chart.removeIndicator("candle_pane", "XVOL");
        return;
      }
      const param = JSON.stringify(s);
      if (has) chart.overrideIndicator({ name: "XVOL", calcParams: [param] }, "candle_pane");
      else chart.createIndicator({
        name: "XVOL", calcParams: [param],
        styles: { tooltip: { showRule: "none" } }, // сырые настройки в легенде не показываем
      }, true, { id: "candle_pane" });
    },
    xvolCount() {
      const got = chart.getIndicatorByPaneId?.("candle_pane", "XVOL");
      const ind = got instanceof Map ? got.get("XVOL") : Array.isArray(got) ? got[0] : got;
      return (ind?.result ?? []).filter((r) => r?.mark).length;
    },

    // Плашка uPnL/ROI у линии входа: tag = {value, text, positive} или null
    setPnlTag(tag) {
      if (!tag) {
        if (pnlId) { chart.removeOverlay({ id: pnlId }); pnlId = null; }
        return;
      }
      const data = { text: tag.text, bg: tag.positive ? "rgba(31,122,68,.92)" : "rgba(178,45,30,.92)" };
      if (pnlId && chart.getOverlayById?.(pnlId)) {
        chart.overrideOverlay({ id: pnlId, points: [{ value: tag.value }], extendData: data });
      } else {
        pnlId = chart.createOverlay({
          name: "pnlTag", lock: true, points: [{ value: tag.value }], extendData: data,
        });
      }
    },

    // Линии TP/SL: создать/подвинуть/убрать; таскаются мышью (onTpSlDrag)
    setTpSl({ tp, sl }) {
      for (const [kind, value] of [["tp", tp], ["sl", sl]]) {
        if (value == null && tpsl[kind]) {
          chart.removeOverlay({ id: tpsl[kind] });
          tpsl[kind] = null;
        } else if (value != null && !tpsl[kind]) {
          tpsl[kind] = tpslLine(kind, value);
        } else if (value != null && tpsl[kind]) {
          chart.overrideOverlay({ id: tpsl[kind], points: [{ value }] });
        }
      }
    },

    // Автоскрин: график с разметкой и линиями позиции (техдок §5.4)
    screenshot() {
      try { return chart.getConvertPictureUrl(true, "png", css("--bg-0") || "#131110"); }
      catch { return null; }
    },
    resize() { chart.resize(); },
    destroy() { window.klinecharts.dispose(el); },
  };
}
