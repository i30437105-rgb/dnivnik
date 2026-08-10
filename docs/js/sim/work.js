// Симулятор: рабочий экран сессии — график klinecharts, replay, торговая панель,
// открытая позиция, автоскрины входа/выхода. Живёт в модульном W: переключение
// вкладок терминала сессию не убивает (initSimulator проверяет workAlive()).
import { esc, fmtRu, notify, confirmToast } from "../util.js";
import * as eng from "./engine.js";
import * as sapi from "./simapi.js";
import { TIMEFRAMES, tfById, aggregateBars, loadKlines } from "./data.js";
import { createSimChart, pricePrecision, withAlpha, xvolInfo } from "./chart.js";

let W = null;

export const workAlive = () => !!W;
export const workResize = () => W?.chartApi?.resize();

const money = (v) => `${v < 0 ? "−" : ""}$${fmtRu(Math.abs(Number(v) || 0), 2)}`;
const px = (v, ref) => fmtRu(v, pricePrecision(ref ?? v));
const iso = (ms) => new Date(ms).toISOString();
const SPEED_MS = { 1: 1000, 5: 200, 20: 50, 100: 10 };
const REASON_RU = { manual: "вручную", tp: "тейк-профит", sl: "стоп-лосс", liq: "ликвидация", end: "конец сессии" };
const WARMUP = 60; // видимых баров на старте, если историю до старта загрузить не удалось
const PAST_BARS = 1000; // глубина догрузки истории старших ТФ (глобальный тренд, уровни)

// Память стиля инструмента: последний выбранный цвет/толщина/тип применяется к новым
const savedStyle = (name) => {
  try { return JSON.parse(localStorage.getItem(`sim-style-${name}`)) ?? null; } catch { return null; }
};
const saveStyle = (name, patch) => {
  try { localStorage.setItem(`sim-style-${name}`, JSON.stringify({ ...(savedStyle(name) ?? {}), ...patch })); }
  catch { /* квота localStorage не критична */ }
};
// Стиль комментария: цвет текста + заливка с прозрачностью (запоминается)
const noteStyles = () => {
  const s = savedStyle("simText") ?? {};
  return { text: {
    color: s.color ?? "#ffffff",
    backgroundColor: withAlpha(s.bg ?? "#8b5cf6", (s.alpha ?? 85) / 100),
  } };
};
const alphaOf = (rgba) => {
  const m = /rgba?\([^)]*?,\s*([\d.]+)\)/.exec(rgba ?? "");
  return m ? Math.round(Number(m[1]) * 100) : 85;
};

// Настройки индикатора экстремальных объёмов (XVOL)
const XVOL_DEF = { on: false, mode: "rel", days: 1, mult: 2, base: "avg", from: null, to: null, top: 10 };
const xvolSettings = () => {
  try { return { ...XVOL_DEF, ...(JSON.parse(localStorage.getItem("sim-xvol")) ?? {}) }; }
  catch { return { ...XVOL_DEF }; }
};
const saveXvol = (patch) => {
  const s = { ...xvolSettings(), ...patch };
  try { localStorage.setItem("sim-xvol", JSON.stringify(s)); } catch { /* квота */ }
  return s;
};

const stylesFromSaved = (name) => {
  const s = savedStyle(name);
  if (!s) return undefined;
  const line = {};
  if (s.color) line.color = s.color;
  if (s.size) line.size = s.size;
  if (s.ls) line.style = s.ls;
  const st = {};
  if (Object.keys(line).length) st.line = line;
  if (s.color) { st.text = { color: s.color }; st.point = { color: s.color, activeColor: s.color }; }
  return Object.keys(st).length ? st : undefined;
};

const svg = (paths, sw = 1.8) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
// pts — сколько кликов ставит инструмент (детект окончания рисования)
const TOOLS = [
  { name: "simSegment", pts: 2, title: "Трендовая линия (с Shift — горизонтальная)", icon: svg('<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>') },
  { name: "simRay", pts: 2, title: "Луч (с Shift — горизонтальный)", icon: svg('<path d="M5 19 17 7"/><path d="M13.5 5.5H18.5V10.5"/><circle cx="5" cy="19" r="1.6"/>') },
  { name: "horizontalStraightLine", pts: 1, title: "Горизонтальный уровень", icon: svg('<path d="M4 12h16"/><circle cx="12" cy="12" r="1.6"/>') },
  { name: "simRect", pts: 2, title: "Прямоугольник — выделить диапазон баров (виден на всех ТФ)", icon: svg('<rect x="4" y="7" width="16" height="10" rx="1"/>') },
  { name: "fibonacciLine", pts: 2, title: "Фибо-ретрейсмент", icon: svg('<path d="M4 6h16M4 12h16M4 18h16"/>') },
  { name: "wave5", pts: 6, title: "Пятиволновка: 6 кликов по вершинам — (0) 1 2 3 4 5", icon: '<span class="tld">1-5</span>' },
  { name: "waveABC", pts: 4, title: "Коррекция: 4 клика по вершинам — (0) A B C", icon: '<span class="tld">ABC</span>' },
  { name: "text", pts: 1, title: "Текст (свободная подпись)", icon: svg('<path d="M6 6h12M12 6v12"/>', 2) },
];

export function mountWork(ctx) {
  // preLen — бары истории до старта сессии: контекст для разметки, replay идёт после них
  const preLen = Math.min(ctx.preLen ?? 0, Math.max(ctx.candles.length - 1, 0));
  const idx = preLen > 0 ? preLen : Math.min(WARMUP, ctx.candles.length - 1);
  W = {
    ctx, idx, preLen,
    pos: null, closed: [],
    timer: null, speed: 5,
    balance: Number(ctx.account.balance),
    dataEnded: false,
    chartApi: null,
    viewTf: ctx.tf.id, // ТФ отображения; replay всегда шагает торговым ТФ
    pastBars: {},      // догруженная история старших ТФ до начала сессии
  };

  ctx.root.innerHTML = `
    <div class="sim-work">
      <div class="block sim-chartcol">
        <div class="sim-chartbar">
          <div class="seg" id="sw-type">
            <button class="btn on" data-ct="bars">Бары</button>
            <button class="btn" data-ct="candles">Свечи</button>
          </div>
          <div class="seg" id="sw-vtf" title="Таймфрейм отображения — старшие собираются из торгового без подглядывания в будущее">
            ${TIMEFRAMES.filter((t) => t.ms >= ctx.tf.ms).map((t) =>
              `<button class="btn ${t.id === ctx.tf.id ? "on" : ""}" data-vtf="${t.id}">${t.label}</button>`).join("")}
          </div>
          <div class="sim-tools">
            ${TOOLS.map((t) => `<button class="tool" data-draw="${t.name}" title="${t.title}">${t.icon}</button>`).join("")}
            <button class="tool" id="sw-xvol" title="Экстремальные объёмы — знак ⚡ над баром">⚡</button>
            <button class="tool" id="sw-wwvn" title="Объёмы волн цифрами у вершин (разворот по close ± ATR, вершины по вику)"><span class="tld">№</span></button>
            <button class="tool" id="sw-wavelvl" title="Уровень волновой разметки: 1 старший ((1)) → 2 (1) → 3 просто → 4 римские"><span class="tld">ур.${waveLevel()}</span></button>
            <button class="tool" id="sw-clear" title="Стереть разметку">${svg('<path d="m14 5 5 5-9 9H5v-5Z"/><path d="M4 19h9"/>')}</button>
          </div>
          <span class="sim-sym num">${esc(ctx.spec.symbol)}</span>
        </div>
        <div class="sim-chartwrap">
          <div id="sim-chart"></div>
          <div id="sw-xvolbox" class="sim-xvolbox" hidden>
            <label class="xv-row"><input type="checkbox" id="xv-on"> Экстремальные объёмы ⚡</label>
            <div class="seg" id="xv-mode">
              <button class="btn" data-m="rel">Кратность</button>
              <button class="btn" data-m="abs">Диапазон</button>
            </div>
            <label class="xv-row">Прошлый период, сут
              <input id="xv-days" type="number" min="1" max="30" step="1" inputmode="numeric"></label>
            <label class="xv-row xv-rel">Множитель ×
              <input id="xv-mult" type="number" min="1" step="0.5" inputmode="decimal"></label>
            <label class="xv-row xv-rel">База кратности
              <select id="xv-base">
                <option value="avg">Средний</option>
                <option value="peak">Ср. пиковый</option>
                <option value="low">Ср. минимальный</option>
              </select></label>
            <label class="xv-row xv-abs" hidden>Объём от
              <input id="xv-from" type="number" min="0" step="any" inputmode="decimal"></label>
            <label class="xv-row xv-abs" hidden>до
              <input id="xv-to" type="number" min="0" step="any" placeholder="без границы" inputmode="decimal"></label>
            <label class="xv-row">Выборка топ/низ, баров
              <input id="xv-top" type="number" min="1" max="100" step="1" inputmode="numeric"></label>
            <div class="muted num" id="xv-info"></div>
          </div>
          <div id="sw-wwvnbox" class="sim-xvolbox" hidden>
            <label class="xv-row"><input type="checkbox" id="wn-on"> Цифры объёмов волн №</label>
            <label class="xv-row">Разворот, ×ATR
              <input id="wn-sens" type="number" min="0.1" max="10" step="0.5" inputmode="decimal"></label>
            <div class="muted">1 — как обычно; 2–3 — мелкие колебания склеиваются в крупные волны</div>
          </div>
          <div id="sw-ovbar" class="sim-ovbar" hidden>
            ${["#b598fb", "#ece7df", "#9b9389", "#4cc47a", "#a3e635", "#2dd4bf",
               "#4db8ff", "#5c7cfa", "#f06292", "#f0553f", "#ff9040", "#e0a83a"].map((c) =>
              `<button class="swp" data-c="${c}" style="background:${c}" title="Цвет"></button>`).join("")}
            <span class="ovdiv lineonly"></span>
            <button class="ovb lineonly" data-w="1" title="Тонкая">1</button>
            <button class="ovb lineonly" data-w="2" title="Средняя">2</button>
            <button class="ovb lineonly" data-w="3" title="Толстая">3</button>
            <span class="ovdiv lineonly"></span>
            <button class="ovb lineonly" data-ls="solid" title="Сплошная">━</button>
            <button class="ovb lineonly" data-ls="dashed" title="Пунктир">╌</button>
            <span class="ovdiv noteonly"></span>
            <button class="ovb noteonly on" data-tt="color" title="Свотчи красят текст">Т</button>
            <button class="ovb noteonly" data-tt="bg" title="Свотчи красят заливку">Фон</button>
            <input type="range" class="ovrange noteonly" id="ov-alpha" min="0" max="100" step="5" title="Прозрачность заливки">
            <button class="ovb noteonly" id="ov-edit" title="Изменить текст (или двойной клик по подписи)">✎</button>
            <span class="ovdiv"></span>
            <button class="ovb ov-copy" title="Копировать элемент (например, для канала)">⧉</button>
            <button class="ovb ov-del" title="Удалить инструмент (Del)">${svg('<path d="M5 7h14M10 7V5h4v2m-7 0 1 13h8l1-13"/>')}</button>
          </div>
        </div>
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

  W.selectedOv = null;
  W.drawingActive = false; // идёт постановка точек инструмента
  W.textMode = false;      // следующий клик по графику ставит поле ввода текста
  W.chartApi = createSimChart(ctx.root.querySelector("#sim-chart"), {
    onTpSlDrag: (kind, price) => applyTpSl(kind, price, "drag"),
  }, { hideTime: !!ctx.spec.random });
  W.chartApi.setBars(ctx.candles.slice(0, W.idx), ctx.tf.ms);

  // клики по графику: во время рисования считаем поставленные точки; вне рисования —
  // свой hit-test решает, попал ли клик в нарисованный объект (панель настроек)
  const chartEl = ctx.root.querySelector("#sim-chart");
  // двойной клик по комментарию — редактирование текста на месте (как в TradingView)
  chartEl.addEventListener("dblclick", (e) => {
    if (!W || W.drawingActive || W.textMode) return;
    const r = chartEl.getBoundingClientRect();
    const hit = W.chartApi.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (hit?.name === "simText") editText(hit.id);
  });
  chartEl.addEventListener("click", (e) => {
    if (!W) return;
    if (W.textMode) {
      W.textMode = false;
      const r = chartEl.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      placeTextInput(x, y, "", (t) => W.chartApi.addTextAt(x, y, t, noteStyles()));
      return;
    }
    if (W.drawingActive) {
      W.drawingLeft -= 1;
      if (W.drawingLeft <= 0) {
        setTimeout(() => {
          if (!W) return;
          W.chartApi.finishDrawing(); // все точки поставлены — завершаем сами
          W.drawingActive = false;
        }, 120);
      }
      return;
    }
    const rect = chartEl.getBoundingClientRect();
    const hit = W.chartApi.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) showOvBar(hit.id, hit.name);
    else hideOvBar();
  });

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
  ctx.root.querySelectorAll("#sw-vtf .btn").forEach((b) => b.onclick = () => switchViewTf(b.dataset.vtf));
  ctx.root.querySelectorAll(".sim-tools .tool[data-draw]").forEach((b) => b.onclick = () => {
    if (b.dataset.draw === "text") { W.textMode = true; hideOvBar(); return; } // клик по графику — поле ввода
    const tool = TOOLS.find((t) => t.name === b.dataset.draw);
    W.drawingActive = true;
    W.drawingLeft = tool?.pts ?? 2;
    hideOvBar();
    const extend = (b.dataset.draw === "wave5" || b.dataset.draw === "waveABC") ? waveLevel() : undefined;
    W.chartApi.draw(b.dataset.draw, extend, stylesFromSaved(b.dataset.draw));
  });
  $("#sw-wavelvl").onclick = () => {
    const next = waveLevel() % 4 + 1;
    localStorage.setItem("sim-wave-level", String(next));
    $("#sw-wavelvl .tld").textContent = `ур.${next}`;
  };
  $("#sw-clear").onclick = async () => {
    if (await confirmToast("Стереть всю разметку на графике?", "Стереть")) W.chartApi.clearDrawings();
  };

  // Экстремальные объёмы: панель настроек + применение
  W.xvolSeen = new Set(); // по каким барам уже оповещали (ключ ТФ+время)
  const xvBox = $("#sw-xvolbox");
  const xvFill = () => {
    const s = xvolSettings();
    xvBox.querySelector("#xv-on").checked = s.on;
    xvBox.querySelectorAll("#xv-mode .btn").forEach((b) => b.classList.toggle("on", b.dataset.m === s.mode));
    xvBox.querySelector("#xv-days").value = String(s.days);
    xvBox.querySelector("#xv-mult").value = String(s.mult);
    xvBox.querySelector("#xv-base").value = s.base ?? "avg";
    xvBox.querySelector("#xv-from").value = s.from ?? "";
    xvBox.querySelector("#xv-to").value = s.to ?? "";
    xvBox.querySelector("#xv-top").value = String(s.top ?? 10);
    xvBox.querySelectorAll(".xv-rel").forEach((x) => x.hidden = s.mode !== "rel");
    xvBox.querySelectorAll(".xv-abs").forEach((x) => x.hidden = s.mode !== "abs");
    $("#sw-xvol").classList.toggle("on", s.on);
  };
  const xvApply = () => {
    const s = xvolSettings();
    W.chartApi.setXvol(s);
    xvUpdateInfo();
    $("#sw-xvol").classList.toggle("on", s.on);
  };
  const xvUpdateInfo = () => {
    const el = xvBox.querySelector("#xv-info");
    if (!el || xvBox.hidden) return;
    const s = xvolSettings();
    const inf = xvolInfo(viewBars(), s.days, s.top);
    const n = Math.max(1, Math.min(Number(s.top) || 10, inf.count));
    el.textContent = inf.avg == null
      ? "Нет данных за прошлый период (мало истории)"
      : `Ср. пиковый (топ-${n}): ${fmtRu(inf.avgPeak, 1)} · средний: ${fmtRu(inf.avg, 1)} · ср. минимальный: ${fmtRu(inf.avgLow, 1)} — за ${s.days} сут на текущем ТФ`;
  };
  $("#sw-xvol").onclick = () => {
    xvBox.hidden = !xvBox.hidden;
    $("#sw-wwvnbox").hidden = true;
    if (!xvBox.hidden) { xvFill(); xvUpdateInfo(); }
  };
  xvBox.querySelector("#xv-on").onchange = (e) => { saveXvol({ on: e.target.checked }); xvApply(); };
  xvBox.querySelectorAll("#xv-mode .btn").forEach((b) => b.onclick = () => {
    saveXvol({ mode: b.dataset.m });
    xvFill();
    xvApply();
  });
  for (const [id, key] of [["#xv-days", "days"], ["#xv-mult", "mult"], ["#xv-from", "from"], ["#xv-to", "to"], ["#xv-top", "top"]]) {
    xvBox.querySelector(id).onchange = (e) => {
      const v = e.target.value === "" ? null : Number(e.target.value);
      saveXvol({ [key]: v });
      xvApply();
    };
  }
  xvBox.querySelector("#xv-base").onchange = (e) => { saveXvol({ base: e.target.value }); xvApply(); };
  W.xvApply = xvApply;
  W.xvUpdateInfo = xvUpdateInfo;
  if (xvolSettings().on) xvApply();

  // Объёмы волн у вершин (WWVN) — панель: вкл/выкл + чувствительность разворота
  const wnBox = $("#sw-wwvnbox");
  const wwvnSens = () => {
    const v = Number(localStorage.getItem("sim-wwvn-sens"));
    return v > 0 ? v : 1;
  };
  const wwvnApply = () => {
    const on = localStorage.getItem("sim-wwvn") === "1";
    W.chartApi.setWwvn(on, wwvnSens());
    W.chartApi.setWwvSens(wwvnSens()); // гистограмма WWV режется теми же волнами
    $("#sw-wwvn").classList.toggle("on", on);
  };
  $("#sw-wwvn").onclick = () => {
    wnBox.hidden = !wnBox.hidden;
    xvBox.hidden = true;
    if (!wnBox.hidden) {
      wnBox.querySelector("#wn-on").checked = localStorage.getItem("sim-wwvn") === "1";
      wnBox.querySelector("#wn-sens").value = String(wwvnSens());
    }
  };
  wnBox.querySelector("#wn-on").onchange = (e) => {
    localStorage.setItem("sim-wwvn", e.target.checked ? "1" : "0");
    wwvnApply();
  };
  wnBox.querySelector("#wn-sens").onchange = (e) => {
    const v = Number(e.target.value);
    localStorage.setItem("sim-wwvn-sens", String(v > 0 ? v : 1));
    wwvnApply();
  };
  wwvnApply();

  // Панель настроек выделенного инструмента: цвет, толщина, тип линии, удаление
  const ovbar = $("#sw-ovbar");
  ovbar.querySelectorAll(".swp").forEach((b) => b.onclick = () => {
    if (!W.selectedOv) return;
    const c = b.dataset.c;
    if (W.selectedOv.name === "simText") {
      // у комментария свотчи красят текст или заливку — что выбрано кнопками Т/Фон
      if (W.noteTarget === "bg") {
        const alpha = Number(ovbar.querySelector("#ov-alpha").value) / 100;
        W.chartApi.restyleOverlay(W.selectedOv.id, { text: { backgroundColor: withAlpha(c, alpha) } });
        saveStyle("simText", { bg: c });
      } else {
        W.chartApi.restyleOverlay(W.selectedOv.id, { text: { color: c } });
        saveStyle("simText", { color: c });
      }
      return;
    }
    W.chartApi.restyleOverlay(W.selectedOv.id, {
      line: { color: c }, text: { color: c },
      point: { color: c, activeColor: c },
    });
    saveStyle(W.selectedOv.name, { color: c }); // новые элементы этого инструмента — в этом цвете
  });
  ovbar.querySelectorAll(".ovb[data-tt]").forEach((b) => b.onclick = () => {
    W.noteTarget = b.dataset.tt;
    ovbar.querySelectorAll(".ovb[data-tt]").forEach((x) => x.classList.toggle("on", x === b));
  });
  ovbar.querySelector("#ov-alpha").oninput = () => {
    if (W.selectedOv?.name !== "simText") return;
    const alpha = Number(ovbar.querySelector("#ov-alpha").value);
    const cur = W.chartApi.textData(W.selectedOv.id)?.styles?.text?.backgroundColor ?? "";
    const rgb = /rgba?\(([^)]*?)(?:,\s*[\d.]+)?\)/.exec(cur)?.[1] ?? "139,92,246";
    const parts = rgb.split(",").slice(0, 3).join(",");
    W.chartApi.restyleOverlay(W.selectedOv.id, { text: { backgroundColor: `rgba(${parts},${alpha / 100})` } });
    saveStyle("simText", { alpha });
  };
  ovbar.querySelector("#ov-edit").onclick = () => {
    if (W.selectedOv?.name === "simText") editText(W.selectedOv.id);
  };
  ovbar.querySelectorAll(".ovb[data-w]").forEach((b) => b.onclick = () => {
    if (!W.selectedOv) return;
    W.chartApi.restyleOverlay(W.selectedOv.id, { line: { size: Number(b.dataset.w) } });
    saveStyle(W.selectedOv.name, { size: Number(b.dataset.w) });
  });
  ovbar.querySelectorAll(".ovb[data-ls]").forEach((b) => b.onclick = () => {
    if (!W.selectedOv) return;
    W.chartApi.restyleOverlay(W.selectedOv.id, { line: { style: b.dataset.ls } });
    saveStyle(W.selectedOv.name, { ls: b.dataset.ls });
  });
  ovbar.querySelector(".ov-copy").onclick = () => {
    if (!W.selectedOv) return;
    const copy = W.chartApi.cloneDrawn(W.selectedOv.id);
    if (copy) showOvBar(copy.id, copy.name); // копия сразу выделена — тяни на место
  };
  ovbar.querySelector(".ov-del").onclick = () => {
    if (W.selectedOv) { W.chartApi.removeDrawn(W.selectedOv.id); hideOvBar(); }
  };

  W.onResize = () => W.chartApi.resize();
  window.addEventListener("resize", W.onResize);
  W.onKey = (e) => {
    if (!W || e.target.closest("input, textarea, select")) return;
    if (e.code === "ArrowRight") { stopPlay(); next(); e.preventDefault(); }
    if (e.code === "Space") { togglePlay(); e.preventDefault(); }
    if ((e.code === "Delete" || e.code === "Backspace") && W.selectedOv) {
      W.chartApi.removeDrawn(W.selectedOv.id);
      hideOvBar();
      e.preventDefault();
    }
  };
  document.addEventListener("keydown", W.onKey);

  renderPanel();
  renderSess();
  updateTicker();
}

const waveLevel = () =>
  Math.min(Math.max(Number(localStorage.getItem("sim-wave-level")) || 3, 1), 4);

function showOvBar(id, name) {
  if (!W || W.drawingActive) return;
  W.selectedOv = { id, name };
  const bar = W.ctx.root.querySelector("#sw-ovbar");
  if (!bar) return;
  // у волновых подписей настраивается только цвет; у комментария — текст/заливка/прозрачность
  bar.classList.toggle("textonly", ["wave5", "waveABC", "simpleAnnotation"].includes(name));
  bar.classList.toggle("textnote", name === "simText");
  if (name === "simText") {
    W.noteTarget = W.noteTarget ?? "color";
    const alphaInp = bar.querySelector("#ov-alpha");
    if (alphaInp) alphaInp.value = String(alphaOf(W.chartApi.textData(id)?.styles?.text?.backgroundColor));
  }
  bar.hidden = false;
}

function hideOvBar() {
  if (!W) return;
  W.selectedOv = null;
  const bar = W.ctx.root.querySelector("#sw-ovbar");
  if (bar) bar.hidden = true;
}

// Текст как в TradingView: поле ввода прямо на графике; Enter/клик мимо — сохранить,
// Esc — отмена. Без лимита символов. onCommit получает введённый текст.
function placeTextInput(x, y, initial, onCommit) {
  const wrap = W.ctx.root.querySelector(".sim-chartwrap");
  const chartEl = W.ctx.root.querySelector("#sim-chart");
  if (!wrap || !chartEl) return;
  const inp = document.createElement("input");
  inp.className = "sim-textinp";
  inp.placeholder = "Текст…";
  inp.value = initial ?? "";
  inp.style.left = `${chartEl.offsetLeft + x}px`;
  inp.style.top = `${chartEl.offsetTop + y}px`;
  wrap.appendChild(inp);
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const t = inp.value.trim();
    inp.remove();
    if (save && t && W) onCommit(t);
  };
  inp.onkeydown = (e) => {
    e.stopPropagation(); // Space/Delete не должны дёргать replay и удаление
    if (e.key === "Enter") commit(true);
    if (e.key === "Escape") commit(false);
  };
  inp.onblur = () => commit(true);
}

// Редактирование существующего комментария на месте
function editText(id) {
  const data = W.chartApi.textData(id);
  const px2 = W.chartApi.overlayPixel(id);
  if (!data || !px2) return;
  hideOvBar();
  placeTextInput(px2.x, px2.y, data.text, (t) => W.chartApi.updateText(id, t));
}

// ---------- Replay ----------

const lastBar = () => W.ctx.candles[W.idx - 1];

// ---------- Таймфрейм отображения ----------
// Старшие ТФ агрегируются из «прожитых» баров торгового ТФ (без будущего);
// история до старта сессии догружается с Bybit — это прошлое, подглядывания нет.

const viewTfMs = () => tfById(W.viewTf).ms;

async function switchViewTf(tfId) {
  if (!W || tfId === W.viewTf) return;
  W.viewTf = tfId;
  hideOvBar();
  W.ctx.root.querySelectorAll("#sw-vtf .btn").forEach((x) =>
    x.classList.toggle("on", x.dataset.vtf === tfId));
  await ensurePast(tfId);
  if (W?.viewTf === tfId) refreshView();
}

async function ensurePast(tfId) {
  if (tfId === W.ctx.tf.id || W.pastBars[tfId]) return;
  const vtf = tfById(tfId);
  const sessionStart = W.ctx.candles[0].timestamp;
  const firstBucket = Math.floor(sessionStart / vtf.ms) * vtf.ms;
  try {
    const past = await loadKlines(W.ctx.spec.symbol, tfId,
      firstBucket - PAST_BARS * vtf.ms, firstBucket - 1);
    // бар, в который попадает старт сессии, собираем агрегатом — иначе в нём будущее
    W.pastBars[tfId] = past.filter((b) => b.timestamp < firstBucket);
  } catch {
    W.pastBars[tfId] = []; // без истории тоже работает — только сессионные бары
  }
}

function viewBars() {
  const live = W.ctx.candles.slice(0, W.idx);
  if (W.viewTf === W.ctx.tf.id) return live;
  const vtf = tfById(W.viewTf);
  return [...(W.pastBars[W.viewTf] ?? []), ...aggregateBars(live, vtf.ms)];
}

function refreshView() {
  W.chartApi.setBars(viewBars(), viewTfMs());
  W.chartApi.reanchorDrawings(); // разметка пересаживается по времени — не «едет»
  redrawPosition();
  W.xvUpdateInfo?.(); // справка объёмов зависит от ТФ вида
  updateTicker();
}

// Линии позиции и TP/SL заново на текущем виде (метка входа — к бару своего bucket'а)
function redrawPosition() {
  if (!W.pos) return;
  const ts = Math.floor(W.pos.entryTs / viewTfMs()) * viewTfMs();
  W.chartApi.showPosition({
    side: W.pos.side, entryPrice: W.pos.entryPrice, entryTs: ts, liq: eng.liqPrice(W.pos),
  });
  W.chartApi.setTpSl({ tp: W.pos.tpPrice ?? null, sl: W.pos.slPrice ?? null });
}

// Сессия пишется в базу лениво — при первой реальной сделке (пустые сессии не плодим)
async function ensureSession() {
  if (W.sessionId) return W.sessionId;
  const s = await sapi.createSession(W.ctx.spec);
  W.sessionId = s.id;
  return s.id;
}

function next() {
  if (!W) return false;
  if (W.idx >= W.ctx.candles.length) { endOfData(); return false; }
  const bar = W.ctx.candles[W.idx];
  W.idx += 1;
  if (W.viewTf === W.ctx.tf.id) {
    W.chartApi.pushBar(bar);
  } else {
    // старший вид: дорисовываем текущий бар старшего ТФ из баров его bucket'а
    const vtf = tfById(W.viewTf);
    const start = Math.floor(bar.timestamp / vtf.ms) * vtf.ms;
    const acc = [];
    for (let i = W.idx - 1; i >= 0; i--) {
      const c = W.ctx.candles[i];
      if (Math.floor(c.timestamp / vtf.ms) * vtf.ms !== start) break;
      acc.push(c);
    }
    acc.reverse();
    const agg = aggregateBars(acc, vtf.ms)[0];
    if (agg) W.chartApi.pushBar(agg);
  }
  if (W.pos) {
    const exit = eng.checkExit(W.pos, bar); // SL/TP/ликвидация по high/low бара (§6.3)
    if (exit) closeTrade(exit.reason, exit.price, bar.timestamp);
  }
  maybeNotifyXvol();
  updateTicker();
  return true;
}

// Оповещение при появлении бара с экстремальным объёмом (один раз на бар вида)
function maybeNotifyXvol() {
  const s = xvolSettings();
  if (!s.on || !W) return;
  const bars = viewBars();
  const b = bars[bars.length - 1];
  if (!b) return;
  const v = b.volume ?? 0;
  let mark = false;
  let ratio = null;
  if (s.mode === "abs") {
    mark = Number(s.from) > 0 && v >= Number(s.from) && (!(Number(s.to) > 0) || v <= Number(s.to));
  } else {
    const inf = xvolInfo(bars, s.days, s.top);
    const base = s.base === "peak" ? inf.avgPeak : s.base === "low" ? inf.avgLow : inf.avg;
    if (base != null) { mark = v >= (Number(s.mult) || 2) * base; ratio = v / base; }
  }
  if (!mark) return;
  const key = `${W.viewTf}:${b.timestamp}`;
  if (W.xvolSeen.has(key)) return;
  W.xvolSeen.add(key);
  notify(`⚡ Экстремальный объём: ${fmtRu(v, 1)}${ratio ? ` — ${fmtRu(ratio, 1)}× среднего` : ""}`, "info", 4000);
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
    <h3>Торговля <span class="muted num">комиссия ${fmtRu(Number(W.ctx.spec.fee_pct), 3)}%</span></h3>
    <div class="fld"><span>Плечо ×<b id="tp-levv" class="num">${lev}</b></span>
      <input id="tp-lev" type="range" min="1" max="100" step="1" value="${lev}">
      <div class="chips">${[1, 5, 10, 25, 50, 100].map((x) => `<button class="chip" data-lev="${x}">×${x}</button>`).join("")}</div>
    </div>
    <label class="fld"><span>Маржа, $ <span class="muted">(доступно ${money(W.balance)})</span></span>
      <input id="tp-margin" type="number" min="0" step="any" value="${defMargin}" inputmode="decimal"></label>
    <div class="chips">${[5, 10, 25, 50].map((p) => `<button class="chip" data-mpct="${p}">${p}%</button>`).join("")}</div>
    <div class="sim-preview num" id="tp-preview"></div>
    <label class="sim-tpslchk"><input type="checkbox" id="tp-tpsl"> TP / SL</label>
    <div id="tp-tpslbox" class="sim-tpslbox num" hidden>
      <div class="tprow"><span class="lbl pos">TP</span>
        <input id="tp-tpp" type="number" step="any" min="0" placeholder="цена" inputmode="decimal">
        <input id="tp-tpr" type="number" step="any" min="0" placeholder="ROI %" inputmode="decimal"></div>
      <div class="tprow"><span class="lbl neg">SL</span>
        <input id="tp-slp" type="number" step="any" min="0" placeholder="цена" inputmode="decimal">
        <input id="tp-slr" type="number" step="any" min="0" placeholder="ROI %" inputmode="decimal"></div>
      <div class="muted tphint">% — ROI от маржи, как на Bybit. Цена уточняется по стороне при входе.</div>
    </div>
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

  // TP/SL до входа: цена ↔ ROI% (пересчёт от текущей цены; последний ввод — источник истины)
  W.tpslSrc = { tp: "roi", sl: "roi" };
  el.querySelector("#tp-tpsl").onchange = (e) => {
    el.querySelector("#tp-tpslbox").hidden = !e.target.checked;
  };
  const bindPair = (kind, sign) => {
    const p = el.querySelector(`#tp-${kind}p`);
    const r = el.querySelector(`#tp-${kind}r`);
    const lev = () => Number(el.querySelector("#tp-lev").value) || 1;
    p.oninput = () => {
      W.tpslSrc[kind] = "price";
      const v = Number(p.value);
      const entry = lastBar().close;
      r.value = v > 0 ? Math.abs((v / entry - 1) * lev() * 100).toFixed(1) : "";
    };
    r.oninput = () => {
      W.tpslSrc[kind] = "roi";
      const v = Number(r.value);
      const entry = lastBar().close;
      p.value = v > 0 ? String(+(entry * (1 + sign * v / (100 * lev()))).toFixed(2)) : "";
    };
  };
  bindPair("tp", 1);  // превью считается от лонга; при входе пересчёт по факту стороны
  bindPair("sl", -1);

  el.querySelector("#tp-long").onclick = () => openTrade("long");
  el.querySelector("#tp-short").onclick = () => openTrade("short");
  updatePreview();
}

// TP/SL из полей панели по факту стороны: roi-ввод пересчитывается, цена берётся как есть
function tpSlFromPanel(pos) {
  const el = W.ctx.root;
  if (!el.querySelector("#tp-tpsl")?.checked) return { tpPrice: null, slPrice: null };
  const out = { tpPrice: null, slPrice: null };
  for (const [kind, roiSign] of [["tp", 1], ["sl", -1]]) {
    const pv = Number(el.querySelector(`#tp-${kind}p`)?.value);
    const rv = Number(el.querySelector(`#tp-${kind}r`)?.value);
    let price = null;
    if (W.tpslSrc[kind] === "price" && pv > 0) price = pv;
    else if (rv > 0) price = eng.priceFromRoi(pos, roiSign * rv);
    if (price == null) continue;
    const valid = kind === "tp"
      ? (pos.side === "long" ? price > pos.entryPrice : price < pos.entryPrice)
      : (pos.side === "long" ? price < pos.entryPrice : price > pos.entryPrice);
    if (!valid) { notify(`${kind.toUpperCase()} не на той стороне от входа — уровень не поставлен`, "error", 6000); continue; }
    out[kind === "tp" ? "tpPrice" : "slPrice"] = price;
  }
  return out;
}

// Применение нового уровня TP/SL к открытой позиции (поля позиции или перетаскивание линии)
async function applyTpSl(kind, price, source) {
  if (!W?.pos) return;
  const pos = W.pos;
  if (price != null) {
    const valid = kind === "tp"
      ? (pos.side === "long" ? price > pos.entryPrice : price < pos.entryPrice)
      : (pos.side === "long" ? price < pos.entryPrice : price > pos.entryPrice);
    if (!valid) {
      notify(`${kind.toUpperCase()} должен быть ${kind === "tp" ? "в прибыльной" : "в убыточной"} стороне от входа`, "error", 5000);
      W.chartApi.setTpSl({ tp: pos.tpPrice ?? null, sl: pos.slPrice ?? null }); // вернуть линию
      if (source !== "drag") renderPanel();
      return;
    }
  }
  W.pos = { ...pos, [kind === "tp" ? "tpPrice" : "slPrice"]: price };
  W.chartApi.setTpSl({ tp: W.pos.tpPrice ?? null, sl: W.pos.slPrice ?? null });
  renderPanel();
  try {
    await sapi.updateSimTrade(pos.tradeId, { [kind === "tp" ? "tp_price" : "sl_price"]: price });
  } catch (e) { notify("Уровень не сохранился: " + e.message, "error", 6000); }
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
  const be = eng.breakevenPrice(p, Number(W.ctx.spec.fee_pct));
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
    <div class="sim-tpslbox num">
      <div class="tprow"><span class="lbl pos">TP</span>
        <input id="ps-tpp" type="number" step="any" min="0" placeholder="цена" inputmode="decimal"
          value="${p.tpPrice != null ? +p.tpPrice.toFixed(2) : ""}">
        <input id="ps-tpr" type="number" step="any" min="0" placeholder="ROI %" inputmode="decimal"
          value="${p.tpPrice != null ? Math.abs(eng.roiFromPrice(p, p.tpPrice)).toFixed(1) : ""}">
        <button class="ovb" id="ps-tpx" title="Убрать TP">✕</button></div>
      <div class="tprow"><span class="lbl neg">SL</span>
        <input id="ps-slp" type="number" step="any" min="0" placeholder="цена" inputmode="decimal"
          value="${p.slPrice != null ? +p.slPrice.toFixed(2) : ""}">
        <input id="ps-slr" type="number" step="any" min="0" placeholder="ROI %" inputmode="decimal"
          value="${p.slPrice != null ? Math.abs(eng.roiFromPrice(p, p.slPrice)).toFixed(1) : ""}">
        <button class="ovb" id="ps-slx" title="Убрать SL">✕</button></div>
      <div class="muted tphint">уровни можно таскать прямо на графике</div>
    </div>
    <button id="pp-close" class="btn primary sim-closebtn">Закрыть по рынку</button>`;
  el.querySelector("#pp-close").onclick = () => {
    const b = lastBar();
    closeTrade("manual", b.close, b.timestamp);
  };
  // TP/SL позиции: цена ↔ ROI% с пересчётом, применение по завершении ввода
  for (const [kind, roiSign] of [["tp", 1], ["sl", -1]]) {
    const pInp = el.querySelector(`#ps-${kind}p`);
    const rInp = el.querySelector(`#ps-${kind}r`);
    pInp.oninput = () => {
      const v = Number(pInp.value);
      rInp.value = v > 0 ? Math.abs(eng.roiFromPrice(p, v)).toFixed(1) : "";
    };
    rInp.oninput = () => {
      const v = Number(rInp.value);
      pInp.value = v > 0 ? String(+eng.priceFromRoi(p, roiSign * v).toFixed(2)) : "";
    };
    pInp.onchange = () => {
      const v = Number(pInp.value);
      applyTpSl(kind, v > 0 ? v : null, "field");
    };
    rInp.onchange = () => {
      const v = Number(rInp.value);
      applyTpSl(kind, v > 0 ? eng.priceFromRoi(p, roiSign * v) : null, "field");
    };
    el.querySelector(`#ps-${kind}x`).onclick = () => applyTpSl(kind, null, "field");
  }
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
  if (prog) prog.textContent = `бар ${Math.max(0, W.idx - W.preLen)} из ${W.ctx.candles.length - W.preLen}`;
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
  // текущий результат виден прямо на графике — плашка у линии входа
  W.chartApi.setPnlTag({
    value: W.pos.entryPrice,
    text: `${money(u)} · ${roi >= 0 ? "+" : "−"}${fmtRu(Math.abs(roi), 1)}%`,
    positive: u >= 0,
  });
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
  const feePct = Number(W.ctx.spec.fee_pct);
  const base = eng.openPosition({ side, margin, leverage, price: bar.close, ts: bar.timestamp, feePct });
  const { tpPrice, slPrice } = tpSlFromPanel(base);
  const pos = { ...base, tpPrice, slPrice };

  W.chartApi.showPosition({
    side, entryPrice: pos.entryPrice,
    entryTs: Math.floor(pos.entryTs / viewTfMs()) * viewTfMs(), // бар входа на текущем виде
    liq: eng.liqPrice(pos),
  });
  W.chartApi.setTpSl({ tp: tpPrice, sl: slPrice });
  const shot = W.chartApi.screenshot(); // автоскрин входа — с разметкой и линиями (§5.4)
  let trade;
  try {
    const sessionId = await ensureSession();
    trade = await sapi.insertSimTrade({
      session_id: sessionId, side, margin, leverage, qty: pos.qty,
      entry_ts: iso(pos.entryTs), entry_price: pos.entryPrice, fees: pos.entryFee,
      tp_price: tpPrice, sl_price: slPrice,
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
  const raw = eng.closePosition(pos, { price, ts, feePct: Number(W.ctx.spec.fee_pct), reason });
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
  if (W.sessionId) {
    try { await sapi.finishSession(W.sessionId); }
    catch (e) { notify("Сессия не пометилась завершённой: " + e.message, "error", 6000); }
  }
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
