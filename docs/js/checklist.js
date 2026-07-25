// Вкладка «Чек-лист» — конструктор чек-листов проверки правил стратегии перед входом в позицию.
// Вес пункта: 1 (главный) = 3 балла, 2 (средний) = 2 балла, 3 (мелкий) = 1 балл.
// Процент = баллы отмеченных «да» / баллы всех пунктов × 100. Процент ≥ порога — вход разрешён.
import { loadChecklists, createChecklist, updateChecklist, deleteChecklist, replaceChecklistItems } from "./api.js";
import { esc, fmtRu, notify, confirmToast, openModal } from "./util.js";

let root;
let lists = [];

const PTS = { 1: 3, 2: 2, 3: 1 };
const WEIGHT_LABEL = { 1: "вес 1 · главный", 2: "вес 2 · средний", 3: "вес 3 · мелкий" };
const WEIGHT_TAG = { 1: "accent", 2: "yellow", 3: "" };

// Отметки текущего прохождения живут в браузере до кнопки «Сбросить» (истории нет — решение Ивана)
const passKey = (id) => `clpass:${id}`;
const loadPass = (id) => {
  try { return JSON.parse(localStorage.getItem(passKey(id))) ?? {}; } catch { return {}; }
};
const savePass = (id, marks) => localStorage.setItem(passKey(id), JSON.stringify(marks));

// Активная вкладочка-чек-лист (переживает перерисовку и перезаход)
const getActive = () => Number(localStorage.getItem("cl-active")) || null;
const setActive = (id) => localStorage.setItem("cl-active", String(id));

export function initChecklist(container) {
  root = container;
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Чек-лист</h1><span class="sub">проверка правил стратегии перед входом</span></div>
      <div class="right"><button id="cl-new" class="btn primary">+ Новый чек-лист</button></div>
    </header>
    <div id="cl-body"><div class="loading">Загружаю…</div></div>`;
  root.querySelector("#cl-new").onclick = () => openEditor(null);
  render().catch((e) => root.querySelector("#cl-body").innerHTML =
    `<div class="warn">Ошибка: ${esc(e.message)}</div>`);
}

async function render() {
  lists = await loadChecklists();
  draw();
}

// перерисовка без похода в базу (переключение вкладочек)
function draw() {
  const body = root.querySelector("#cl-body");
  if (!lists.length) {
    body.innerHTML = `<div class="block" style="text-align:center;padding:46px 20px">
      <div style="font-size:34px;margin-bottom:10px">✅</div>
      <h2 style="margin-bottom:8px">Чек-листов пока нет</h2>
      <p class="muted" style="max-width:520px;margin:0 auto 18px;line-height:1.55">Создай чек-лист под свою стратегию:
      добавь условия входа, задай каждому вес — и перед сделкой проходи проверку.
      Наберёшь нужный процент — система даст разрешение на вход.</p>
      <button class="btn primary" id="cl-new2">+ Создать первый чек-лист</button></div>`;
    body.querySelector("#cl-new2").onclick = () => openEditor(null);
    return;
  }
  // Вкладочки: по одной на чек-лист, на странице виден только активный
  let activeId = getActive();
  if (!lists.some((l) => l.id === activeId)) activeId = lists[0].id;
  setActive(activeId);
  const active = lists.find((l) => l.id === activeId);
  body.innerHTML = `
    <div class="cltabs">
      ${lists.map((l) => `<button class="cltab ${l.id === activeId ? "on" : ""}" data-id="${l.id}">${esc(l.name)}</button>`).join("")}
    </div>
    <section class="block" id="cl-${active.id}"></section>`;
  body.querySelectorAll(".cltab").forEach((b) => b.onclick = () => {
    setActive(Number(b.dataset.id));
    draw();
  });
  renderOne(active);
}

function calc(list, marks) {
  const total = list.items.reduce((s, it) => s + PTS[it.weight], 0);
  const got = list.items.reduce((s, it) => s + (marks[it.id] ? PTS[it.weight] : 0), 0);
  const pct = total > 0 ? got / total * 100 : 0;
  return { total, got, pct, allowed: pct >= Number(list.threshold_pct) };
}

function renderOne(list) {
  const el = root.querySelector(`#cl-${list.id}`);
  if (!el) return;
  const marks = loadPass(list.id);
  const { total, got, pct, allowed } = calc(list, marks);
  const touched = list.items.some((it) => marks[it.id]);

  el.innerHTML = `
    <div class="row spread" style="margin-bottom:4px">
      <div class="row" style="gap:10px">
        <h2 style="margin:0">${esc(list.name)}</h2>
        <span class="tag">${list.items.length} пунктов</span>
        <span class="tag">порог ${fmtRu(Number(list.threshold_pct), 0)}%</span>
      </div>
      <div class="row">
        <button class="btn small cl-reset">Сбросить</button>
        <button class="btn small cl-edit">Редактировать</button>
        <button class="btn small cl-del" title="Удалить">✕</button>
      </div>
    </div>
    ${list.items.length ? `
    <div class="clist">
      ${list.items.map((it) => `
        <div class="clitem ${marks[it.id] ? "on" : ""}" data-i="${it.id}">
          <div class="box">${marks[it.id] ? "✓" : ""}</div>
          <div style="flex:1;min-width:0">
            <div class="t">${esc(it.title)}</div>
            ${it.note ? `<div class="n">${esc(it.note)}</div>` : ""}
          </div>
          <span class="tag ${WEIGHT_TAG[it.weight]}" style="flex:0 0 auto">${WEIGHT_LABEL[it.weight]}</span>
        </div>`).join("")}
    </div>
    <div class="barwrap" style="margin-top:14px"><div class="barlabel">
        <span>Выполнение · <span class="num">${got}</span> из <span class="num">${total}</span> баллов</span>
        <b class="${allowed ? "green" : "red"} num">${fmtRu(pct, 0)}%</b></div>
      <div class="bar"><div class="fill ${allowed ? "green" : "red"}" style="width:${Math.min(pct, 100)}%"></div></div></div>
    <div class="verdict ${!touched ? "" : allowed ? "ok" : "no"}">
      <span class="big">${!touched ? "Отметь выполненные условия" : allowed ? "✅ ВХОД РАЗРЕШЁН" : "⛔ ВХОДА НЕТ"}</span>
      <span class="num">${fmtRu(pct, 0)}% ${allowed ? "≥" : "<"} ${fmtRu(Number(list.threshold_pct), 0)}%</span>
    </div>`
    : `<p class="muted" style="margin:8px 0 4px">Пунктов пока нет — нажми «Редактировать» и добавь условия.</p>`}`;

  el.querySelectorAll(".clitem").forEach((row) => row.onclick = () => {
    const id = row.dataset.i;
    const next = { ...marks, [id]: !marks[id] };
    savePass(list.id, next);
    renderOne(list);
  });
  el.querySelector(".cl-reset").onclick = () => { savePass(list.id, {}); renderOne(list); };
  el.querySelector(".cl-edit").onclick = () => openEditor(list);
  el.querySelector(".cl-del").onclick = async () => {
    if (!(await confirmToast(`Удалить чек-лист «${list.name}»?`))) return;
    try {
      await deleteChecklist(list.id);
      localStorage.removeItem(passKey(list.id));
      notify("Чек-лист удалён");
      render();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}

// ---------- Редактор (конструктор) ----------
function openEditor(list) {
  // рабочая копия пунктов; сохраняем целиком по кнопке
  let items = (list?.items ?? []).map((it) => ({ title: it.title, note: it.note ?? "", weight: it.weight }));
  if (!items.length) items = [{ title: "", note: "", weight: 2 }];

  const modal = openModal(`
    <h2>${list ? "Редактировать чек-лист" : "Новый чек-лист"}</h2>
    <div class="ce-form">
      <label>Название стратегии
        <input id="ce-name" type="text" placeholder="Например: Пятиволновка → лонг" value="${esc(list?.name ?? "")}"></label>
      <label>Порог разрешения входа, %
        <input id="ce-thr" type="number" min="0" max="100" step="5" value="${fmtRu(Number(list?.threshold_pct ?? 50), 0)}">
        <span class="muted small">набрал столько процентов или больше — вход разрешён</span></label>
      <h3 style="margin-top:6px">Пункты проверки</h3>
      <div id="ce-items"></div>
      <button class="btn" id="ce-add" type="button">+ Добавить пункт</button>
      <div class="row" style="justify-content:flex-end;margin-top:10px">
        <button class="btn primary" id="ce-save" type="button">Сохранить</button>
      </div>
    </div>`, { wide: true });

  const itemsEl = modal.el.querySelector("#ce-items");

  const drawItems = () => {
    itemsEl.innerHTML = items.map((it, i) => `
      <div class="ce-row" data-i="${i}">
        <div class="row" style="gap:8px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <input type="text" class="ce-title" placeholder="Формулировка условия (например: RSI-дивергенция на лое 5-й волны)" value="${esc(it.title)}">
            <input type="text" class="ce-note" placeholder="Пояснение — что именно проверить (необязательно)" value="${esc(it.note)}" style="margin-top:6px">
          </div>
          <select class="ce-weight" title="Вес пункта">
            ${[1, 2, 3].map((w) => `<option value="${w}" ${it.weight === w ? "selected" : ""}>${WEIGHT_LABEL[w]} · ${PTS[w]} б.</option>`).join("")}
          </select>
          <div class="seg" style="flex:0 0 auto">
            <button type="button" class="btn ce-up" title="Выше" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="btn ce-down" title="Ниже" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="btn ce-rm" title="Удалить пункт">✕</button>
          </div>
        </div>
      </div>`).join("");

    itemsEl.querySelectorAll(".ce-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".ce-title").oninput = (e) => { items = items.map((x, k) => k === i ? { ...x, title: e.target.value } : x); };
      row.querySelector(".ce-note").oninput = (e) => { items = items.map((x, k) => k === i ? { ...x, note: e.target.value } : x); };
      row.querySelector(".ce-weight").onchange = (e) => { items = items.map((x, k) => k === i ? { ...x, weight: Number(e.target.value) } : x); };
      row.querySelector(".ce-up").onclick = () => { items = swap(items, i, i - 1); drawItems(); };
      row.querySelector(".ce-down").onclick = () => { items = swap(items, i, i + 1); drawItems(); };
      row.querySelector(".ce-rm").onclick = () => { items = items.filter((_, k) => k !== i); drawItems(); };
    });
  };
  drawItems();

  modal.el.querySelector("#ce-add").onclick = () => { items = [...items, { title: "", note: "", weight: 2 }]; drawItems(); };

  modal.el.querySelector("#ce-save").onclick = async () => {
    const name = modal.el.querySelector("#ce-name").value.trim();
    const thr = Number(String(modal.el.querySelector("#ce-thr").value).replace(",", "."));
    const clean = items
      .map((it) => ({ ...it, title: it.title.trim(), note: it.note.trim() }))
      .filter((it) => it.title);
    if (!name) return notify("Укажи название стратегии", "error");
    if (!(thr >= 0 && thr <= 100)) return notify("Порог должен быть от 0 до 100%", "error");
    if (!clean.length) return notify("Добавь хотя бы один пункт с формулировкой", "error");
    try {
      let id = list?.id;
      if (id) await updateChecklist(id, { name, threshold_pct: thr });
      else id = (await createChecklist(name, thr)).id;
      await replaceChecklistItems(id, clean);
      localStorage.removeItem(passKey(id)); // состав изменился — старое прохождение недействительно
      setActive(id); // новый/изменённый чек-лист сразу открывается своей вкладочкой
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
