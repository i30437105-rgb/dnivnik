// Вкладка «Чек-лист» — конструктор чек-листов проверки правил стратегии перед входом в позицию.
// Дизайн: handoff/Чек-лист.dc.html (чипы, пары кнопок ✓/✕, риска порога, вердикт-баннер).
// Вес пункта: 1 (главный) = 3 балла, 2 (средний) = 2 балла, 3 (мелкий) = 1 балл.
// Процент = баллы пунктов с ✓ / баллы всех пунктов × 100 (✕ и «без ответа» в числитель не идут).
import { loadChecklists, createChecklist, updateChecklist, deleteChecklist, replaceChecklistItems } from "./api.js";
import { esc, fmtRu, notify, confirmToast, openModal } from "./util.js";
import { initClTrades } from "./cltrades.js";
import { openCalc } from "./calc.js";

let root;
let lists = [];

const PTS = { 1: 3, 2: 2, 3: 1 };
const WEIGHT_LABEL = { 1: "вес 1 · главный", 2: "вес 2 · средний", 3: "вес 3 · мелкий" };
const WEIGHT_TAG = { 1: "accent", 2: "warn", 3: "" };

const svg = (paths, sw = 2) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const IC = {
  yes: svg('<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>', 2.8),
  no: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 2.8),
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>', 2.2),
  reset: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19.7 4.6v4h-4"/>', 1.9),
  edit: svg('<path d="M16.4 4.6a1.9 1.9 0 0 1 2.7 2.7L8.5 17.9l-3.7 1 1-3.7Z"/>', 1.9),
  x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  up: svg('<path d="M12 19V5.5M6 11.5 12 5.5l6 6"/>', 2.1),
  down: svg('<path d="M12 5v13.5M6 12.5l6 6 6-6"/>', 2.1),
  vOk: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  vNo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M7 12h10"/></svg>`,
  calc: svg('<rect x="5.5" y="3.5" width="13" height="17" rx="2.2"/><path d="M8.6 7.4h6.8M8.6 12h.01M12 12h.01M15.4 12h.01M8.6 15.6h.01M12 15.6h.01M15.4 15.6h.01"/>', 1.9),
  vNeutral: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6.5h12M6 12h12M6 17.5h7"/></svg>`,
  empty: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5H7.2A2.2 2.2 0 0 0 5 6.7v11.6a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V6.7a2.2 2.2 0 0 0-2.2-2.2H15"/><path d="M9 3.6h6v2.6H9Z"/><path d="m8.6 12.2 2 2 4.4-4.4"/></svg>`,
};

// Склонения
const nOf = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "пункт" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "пункта" : "пунктов")}`;
const bOf = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "балл" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "балла" : "баллов")}`;

// Ответы текущего прохождения ('y' | 'n' | нет ответа) живут в браузере до «Сбросить» (истории нет)
const passKey = (id) => `clpass:${id}`;
const loadPass = (id) => {
  try { return JSON.parse(localStorage.getItem(passKey(id))) ?? {}; } catch { return {}; }
};
const savePass = (id, marks) => localStorage.setItem(passKey(id), JSON.stringify(marks));

// Активный чип (переживает перерисовку и перезаход)
const getActive = () => Number(localStorage.getItem("cl-active")) || null;
const setActive = (id) => localStorage.setItem("cl-active", String(id));

export function initChecklist(container) {
  root = container;
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Чек-лист</h1><span class="sub">проверка правил стратегии перед входом</span></div>
      <div class="right">
        <button id="cl-calc" class="btn ghost">${IC.calc} Калькулятор</button>
        <button id="cl-new" class="btn primary">${IC.plus} Новый чек-лист</button>
      </div>
    </header>
    <div id="cl-body"><div class="loading">Загружаю…</div></div>
    <div id="cl-trades-sec"></div>`;
  root.querySelector("#cl-new").onclick = () => openEditor(null);
  root.querySelector("#cl-calc").onclick = openCalc;
  render().catch((e) => root.querySelector("#cl-body").innerHTML =
    `<div class="warn">Ошибка: ${esc(e.message)}</div>`);
  initClTrades(root.querySelector("#cl-trades-sec"));
}

async function render() {
  lists = await loadChecklists();
  draw();
}

// перерисовка без похода в базу (переключение чипов, отметки)
function draw() {
  const body = root.querySelector("#cl-body");
  if (!lists.length) {
    body.innerHTML = `
      <div class="clempty">
        <div class="icon">${IC.empty}</div>
        <h2>Чек-листов пока нет</h2>
        <p>Опиши правила своей стратегии пунктами и задай порог. Перед входом прощёлкай список —
        терминал сам посчитает баллы и вынесет вердикт.</p>
        <button class="btn primary" id="cl-new2">${IC.plus} Создать первый чек-лист</button>
      </div>`;
    body.querySelector("#cl-new2").onclick = () => openEditor(null);
    return;
  }
  // Чипы чек-листов: клик открывает быструю проверку МОДАЛЬНЫМ окном —
  // акцент страницы на календаре сделок ниже (решение Ивана)
  const activeId = getActive();
  body.innerHTML = `
    <div class="cltabs" style="margin-bottom:6px">
      ${lists.map((l) => `<button class="cltab ${l.id === activeId ? "on" : ""}" data-id="${l.id}">
        ${esc(l.name)}<span class="cnt num">${l.items.length}</span></button>`).join("")}
    </div>`;
  body.querySelectorAll(".cltab").forEach((b) => b.onclick = () => {
    const id = Number(b.dataset.id);
    setActive(id);
    body.querySelectorAll(".cltab").forEach((x) => x.classList.toggle("on", x === b));
    openListModal(lists.find((l) => l.id === id));
  });
}

// Быстрая проверка чек-листа во всплывающем окне
function openListModal(list) {
  const modal = openModal(`<div class="clcard inmodal" id="cl-${list.id}"></div>`, { wide: true });
  renderOne(list, modal);
}

function calc(list, marks) {
  const total = list.items.reduce((s, it) => s + PTS[it.weight], 0);
  const got = list.items.reduce((s, it) => s + (marks[it.id] === "y" ? PTS[it.weight] : 0), 0);
  const pct = total > 0 ? Math.round(got / total * 100) : 0;
  return { total, got, pct, allowed: pct >= Number(list.threshold_pct) };
}

function renderOne(list, modal) {
  const el = modal.el.querySelector(`#cl-${list.id}`);
  if (!el) return;
  const marks = loadPass(list.id);
  const { total, got, pct, allowed } = calc(list, marks);
  const nYes = list.items.filter((it) => marks[it.id] === "y").length;
  const nNo = list.items.filter((it) => marks[it.id] === "n").length;
  const noAns = list.items.length - nYes - nNo;
  const none = nYes + nNo === 0;
  const thr = fmtRu(Number(list.threshold_pct), 0);

  const verdict = none
    ? { cls: "", icon: IC.vNeutral, title: "Отметь выполненные условия", sub: "пройди пункты кнопками ✓ и ✕", math: "—", neutral: true }
    : allowed
      ? { cls: "ok", icon: IC.vOk, title: "ВХОД РАЗРЕШЁН", sub: "правила соблюдены — работай по плану", math: `${fmtRu(pct, 0)}% ≥ ${thr}%` }
      : { cls: "no", icon: IC.vNo, title: "ВХОДА НЕТ", sub: "условий недостаточно — пропускаем сделку", math: `${fmtRu(pct, 0)}% < ${thr}%` };

  el.innerHTML = `
    <div class="clhead">
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <h2>${esc(list.name)}</h2>
        <span class="clbadge">${nOf(list.items.length)}</span>
        <span class="clbadge accent num">порог ${thr}%</span>
      </div>
      <div class="row" style="gap:7px;flex:0 0 auto">
        <button class="btn ghost cl-reset">${IC.reset} Сбросить</button>
        <button class="btn ghost cl-edit">${IC.edit} Редактировать</button>
        <button class="btn ghost icon danger cl-del" title="Удалить чек-лист">${IC.x}</button>
      </div>
    </div>
    ${list.items.length ? `
    <div class="clrows">
      ${list.items.map((it) => {
        const v = marks[it.id];
        return `
        <div class="clitem ${v === "y" ? "y" : v === "n" ? "n" : ""}" data-i="${it.id}">
          <div class="yn">
            <button class="ynb yes ${v === "y" ? "on" : ""}" data-v="y" title="Выполнено">${IC.yes}</button>
            <button class="ynb no ${v === "n" ? "on" : ""}" data-v="n" title="Не выполнено">${IC.no}</button>
          </div>
          <div style="flex:1;min-width:0">
            <div class="t">${esc(it.title)}</div>
            ${it.note ? `<div class="hint">${esc(it.note)}</div>` : ""}
          </div>
          <span class="wtag ${WEIGHT_TAG[it.weight]}">${WEIGHT_LABEL[it.weight]}</span>
        </div>`;
      }).join("")}
    </div>
    <div class="clfoot">
    <div class="clprogress">
      <div class="top">
        <div>
          <div class="lbl">Выполнение</div>
          <div class="row" style="gap:10px;align-items:baseline">
            <span class="score num">${got} из ${bOf(total)}</span>
            <span class="ans num">${none ? "ни один пункт не отмечен"
              : `да ${nYes} · нет ${nNo}${noAns > 0 ? ` · без ответа ${noAns}` : " · все отмечены"}`}</span>
          </div>
        </div>
        <div class="pct num ${none ? "" : allowed ? "green" : "red"}">${fmtRu(pct, 0)}%</div>
      </div>
      <div class="track">
        <div class="mark" style="left:${Math.min(Math.max(Number(list.threshold_pct), 0), 100)}%"></div>
        <div class="fill ${none ? "idle" : allowed ? "green" : "red"}" style="width:${Math.min(pct, 100)}%"></div>
      </div>
    </div>
    <div class="clverdict-wrap">
      <div class="clverdict ${verdict.cls}">
        <div class="vicon">${verdict.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="vtitle ${verdict.neutral ? "small" : ""}">${verdict.title}</div>
          <div class="vsub">${verdict.sub}</div>
        </div>
        <div class="vmath num">${verdict.math}</div>
      </div>
    </div>
    </div>`
    : `<p class="muted" style="padding:14px 22px 18px">Пунктов пока нет — нажми «Редактировать» и добавь условия.</p>`}`;

  el.querySelectorAll(".clitem").forEach((row) => {
    const id = row.dataset.i;
    row.querySelectorAll(".ynb").forEach((b) => b.onclick = () => {
      const v = b.dataset.v;
      // повторный клик по той же кнопке снимает ответ
      const next = { ...marks };
      if (next[id] === v) delete next[id]; else next[id] = v;
      savePass(list.id, next);
      renderOne(list, modal);
    });
  });
  el.querySelector(".cl-reset").onclick = () => { savePass(list.id, {}); renderOne(list, modal); };
  el.querySelector(".cl-edit").onclick = () => { modal.close(); openEditor(list); };
  el.querySelector(".cl-del").onclick = async () => {
    if (!(await confirmToast(`Удалить чек-лист «${list.name}»?`))) return;
    try {
      await deleteChecklist(list.id);
      localStorage.removeItem(passKey(list.id));
      notify("Чек-лист удалён");
      modal.close();
      render();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}

// ---------- Модалка-конструктор ----------
const SHOT_LABEL = { none: "скрин не нужен", optional: "скрин — можно", required: "скрин обязателен" };

function openEditor(list) {
  // рабочая копия пунктов; сохраняется целиком по кнопке
  let items = (list?.items ?? []).map((it) => ({
    title: it.title, note: it.note ?? "", weight: it.weight, screenshot_mode: it.screenshot_mode ?? "none",
  }));
  if (!items.length) items = [
    { title: "", note: "", weight: 1, screenshot_mode: "none" },
    { title: "", note: "", weight: 2, screenshot_mode: "none" },
    { title: "", note: "", weight: 3, screenshot_mode: "none" },
  ];

  const modal = openModal(`
    <h2>${list ? "Редактировать чек-лист" : "Новый чек-лист"}</h2>
    <div class="ce-form">
      <div class="ce-top">
        <label>Название стратегии
          <input id="ce-name" type="text" placeholder="Например: Пятиволновка → лонг" value="${esc(list?.name ?? "")}"></label>
        <label>Порог входа, %
          <input id="ce-thr" type="number" min="1" max="100" step="5" value="${fmtRu(Number(list?.threshold_pct ?? 50), 0)}">
          <span class="muted small">набрал столько процентов или больше — вход разрешён</span></label>
      </div>
      <div class="row spread" style="margin-top:2px">
        <span class="ce-caption">Пункты проверки</span>
        <span class="ce-total num" id="ce-total"></span>
      </div>
      <div id="ce-items"></div>
      <button class="btn dashed" id="ce-add" type="button">${IC.plus} Добавить пункт</button>
      <div class="ce-footer">
        <span class="muted small">Отметки не сохраняются в историю — только вердикт здесь и сейчас.</span>
        <div class="row" style="gap:8px">
          <button class="btn ghost" id="ce-cancel" type="button">Отмена</button>
          <button class="btn primary" id="ce-save" type="button">Сохранить</button>
        </div>
      </div>
    </div>`);

  const itemsEl = modal.el.querySelector("#ce-items");
  const totalEl = modal.el.querySelector("#ce-total");
  const updTotal = () => totalEl.textContent = "всего " + bOf(items.reduce((s, it) => s + PTS[it.weight], 0));

  const drawItems = () => {
    updTotal();
    itemsEl.innerHTML = items.map((it, i) => `
      <div class="ce-row" data-i="${i}">
        <div class="ce-main">
          <div class="row" style="gap:9px;flex-wrap:nowrap">
            <span class="ce-num num">${i + 1}</span>
            <input type="text" class="ce-title" placeholder="RSI-дивергенция на лое 5-й волны" value="${esc(it.title)}">
          </div>
          <input type="text" class="ce-note" placeholder="Пояснение — что именно проверить (необязательно)" value="${esc(it.note)}">
        </div>
        <div class="ce-selects">
          <select class="ce-weight" title="Вес пункта">
            ${[1, 2, 3].map((w) => `<option value="${w}" ${it.weight === w ? "selected" : ""}>${WEIGHT_LABEL[w]} · ${PTS[w]} б.</option>`).join("")}
          </select>
          <select class="ce-shot" title="Скриншот при заполнении">
            ${Object.entries(SHOT_LABEL).map(([v, l]) => `<option value="${v}" ${it.screenshot_mode === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="ce-btns">
          <button type="button" class="btn ghost icon ce-up" title="Выше" ${i === 0 ? "disabled" : ""}>${IC.up}</button>
          <button type="button" class="btn ghost icon ce-down" title="Ниже" ${i === items.length - 1 ? "disabled" : ""}>${IC.down}</button>
          <button type="button" class="btn ghost icon danger ce-rm" title="Удалить пункт">${IC.x}</button>
        </div>
      </div>`).join("");

    itemsEl.querySelectorAll(".ce-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".ce-title").oninput = (e) => { items = items.map((x, k) => k === i ? { ...x, title: e.target.value } : x); };
      row.querySelector(".ce-note").oninput = (e) => { items = items.map((x, k) => k === i ? { ...x, note: e.target.value } : x); };
      row.querySelector(".ce-weight").onchange = (e) => { items = items.map((x, k) => k === i ? { ...x, weight: Number(e.target.value) } : x); updTotal(); };
      row.querySelector(".ce-shot").onchange = (e) => { items = items.map((x, k) => k === i ? { ...x, screenshot_mode: e.target.value } : x); };
      row.querySelector(".ce-up").onclick = () => { items = swap(items, i, i - 1); drawItems(); };
      row.querySelector(".ce-down").onclick = () => { items = swap(items, i, i + 1); drawItems(); };
      row.querySelector(".ce-rm").onclick = () => { items = items.filter((_, k) => k !== i); drawItems(); };
    });
  };
  drawItems();

  modal.el.querySelector("#ce-add").onclick = () => { items = [...items, { title: "", note: "", weight: 1, screenshot_mode: "none" }]; drawItems(); };
  modal.el.querySelector("#ce-cancel").onclick = modal.close;

  modal.el.querySelector("#ce-save").onclick = async () => {
    const name = modal.el.querySelector("#ce-name").value.trim();
    const thr = Math.min(100, Math.max(1, Number(String(modal.el.querySelector("#ce-thr").value).replace(",", ".")) || 50));
    const clean = items
      .map((it) => ({ ...it, title: it.title.trim(), note: it.note.trim() }))
      .filter((it) => it.title);
    if (!name) return notify("Укажи название стратегии", "error");
    if (!clean.length) return notify("Добавь хотя бы один пункт", "error");
    try {
      let id = list?.id;
      if (id) await updateChecklist(id, { name, threshold_pct: thr });
      else id = (await createChecklist(name, thr)).id;
      await replaceChecklistItems(id, clean);
      localStorage.removeItem(passKey(id)); // состав изменился — старое прохождение недействительно
      setActive(id); // новый/изменённый чек-лист сразу открывается своим чипом
      notify("✓ Чек-лист сохранён");
      modal.close();
      render();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}

const swap = (arr, a, b) => {
  if (b < 0 || b >= arr.length) return arr;
  const out = [...arr];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
};
