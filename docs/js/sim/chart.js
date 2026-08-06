// Симулятор: обёртка klinecharts v9 (UMD с CDN) — стили под токены терминала,
// бары/свечи, объём, инструменты рисования, линии позиции, скрин для автоснимков.
import { state } from "../util.js";

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Точность цены по её порядку (у Bybit тик у всех разный — берём разумное приближение)
export function pricePrecision(p) {
  if (p >= 10000) return 1;
  if (p >= 100) return 2;
  if (p >= 1) return 4;
  if (p >= 0.001) return 6;
  return 8;
}

// ---------- Расширения: индикатор WWV и разметка волн (регистрируются один раз) ----------

let extensionsReady = false;

function registerExtensions(k) {
  if (extensionsReady) return;
  extensionsReady = true;

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

  // Разметка волн: клики по вершинам — пунктир между точками + подписи (0) 1 2 3 4 5 / A B C
  const waveOverlay = (name, labels) => ({
    name,
    totalStep: labels.length + 1,
    needDefaultPointFigure: true,
    createPointFigures: ({ coordinates }) => {
      const figs = [];
      if (coordinates.length > 1) {
        figs.push({ type: "line", attrs: { coordinates }, styles: { style: "dashed" } });
      }
      coordinates.forEach((c, i) => {
        const prev = coordinates[i - 1];
        const above = prev ? c.y <= prev.y : true; // подпись со стороны вершины
        figs.push({
          type: "text", ignoreEvent: true,
          attrs: {
            x: c.x, y: above ? c.y - 8 : c.y + 8, text: labels[i] ?? "",
            align: "center", baseline: above ? "bottom" : "top",
          },
          styles: {
            color: css("--accent-text") || "#b598fb", size: 13, weight: 600,
            backgroundColor: "rgba(19,17,16,.72)",
            paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
            borderRadius: 4,
          },
        });
      });
      return figs;
    },
  });
  k.registerOverlay(waveOverlay("wave5", ["(0)", "1", "2", "3", "4", "5"]));
  k.registerOverlay(waveOverlay("waveABC", ["(0)", "A", "B", "C"]));
}

export function createSimChart(el) {
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
  // Объём без MA-линий — чистая гистограмма; под ним WWV ATR 14 (как на Bybit у Ивана)
  chart.createIndicator({ name: "VOL", calcParams: [] }, false, { id: "sim_vol", height: 72 });
  chart.createIndicator({ name: "WWV", calcParams: [14] }, false, { id: "sim_wwv", height: 72 });

  const drawn = new Set();  // пользовательская разметка
  const posIds = [];        // линии открытой позиции

  return {
    chart,
    setBars(list) {
      const last = list[list.length - 1];
      try { chart.setPriceVolumePrecision(pricePrecision(last?.close ?? 1), 3); } catch { /* старая сигнатура */ }
      chart.applyNewData(list.map((c) => ({ ...c })));
    },
    pushBar(bar) { chart.updateData({ ...bar }); },
    setType(t) { chart.setStyles({ candle: { type: t === "candles" ? "candle_solid" : "ohlc" } }); },

    // Рисование: юзер выбирает инструмент, точки ставит кликами по графику
    draw(name, extendData) {
      const id = chart.createOverlay(extendData != null ? { name, extendData } : name);
      for (const i of [].concat(id)) if (i) drawn.add(i);
    },
    clearDrawings() {
      for (const id of drawn) chart.removeOverlay({ id });
      drawn.clear();
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
