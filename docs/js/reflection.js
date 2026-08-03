// Вкладка «Рефлексия» — дневник выводов по дням.
// Календарь месяца: день с заметкой — зелёный, пустой — серый; клик открывает заметку дня.
// Заметка = нумерованные пункты, каждому можно присвоить категорию (настраиваются самим пользователем).
import {
  loadReflectionCats, addReflectionCat, updReflectionCat, delReflectionCat,
  loadReflectionDays, loadReflectionItems, replaceReflectionItems,
} from "./api.js";
import { esc, notify, confirmToast, openModal, todayLocal, addDays, fmtDay } from "./util.js";

let root;
let cats = [];
let anchor; // YYYY-MM показанного месяца

const COLOR_LABEL = { neg: "Красный", pos: "Зелёный", warn: "Жёлтый", accent: "Фиолетовый", muted: "Серый" };

const svg = (paths, sw = 2) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const IC = {
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>', 2.2),
  x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  up: svg('<path d="M12 19V5.5M6 11.5 12 5.5l6 6"/>', 2.1),
  down: svg('<path d="M12 5v13.5M6 12.5l6 6 6-6"/>', 2.1),
  cog: svg('<path d="M4 7.5h4M12.5 7.5H20M4 16.5h7.5M16 16.5h4"/><circle cx="10" cy="7.5" r="2.3"/><circle cx="14" cy="16.5" r="2.3"/>', 1.7),
};

const pOf = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "пункт" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "пункта" : "пунктов")}`;

export function initReflection(container) {
  root = container;
  anchor = anchor ?? todayLocal().slice(0, 7);
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Рефлексия</h1><span class="sub">выводы и наблюдения по дням</span></div>
      <div class="right"><button id="rf-cats" class="btn ghost">${IC.cog} Категории</button></div>
    </header>
    <section class="block">
      <div class="row spread" style="margin-bottom:14px">
        <h2 style="margin:0">Календарь заметок</h2>
        <div class="row">
          <button class="btn small" id="rf-prev">‹</button>
          <span id="rf-label" class="plabel"></span>
          <button class="btn small" id="rf-next">›</button>
        </div>
      </div>
      <div id="rf-cal"><div class="loading">Загружаю…</div></div>
      <div class="muted small" style="margin-top:10px">Зелёный день — заметка есть, серый — пока пусто. Кликни по любому дню, чтобы записать выводы.</div>
    </section>`;
  root.querySelector("#rf-cats").onclick = openCatsEditor;
  root.querySelector("#rf-prev").onclick = () => { shiftMonth(-1); renderCal(); };
  root.querySelector("#rf-next").onclick = () => { shiftMonth(1); renderCal(); };
  renderCal().catch((e) => root.querySelector("#rf-cal").innerHTML = `<div class="warn">Ошибка: ${esc(e.message)}</div>`);
}

function shiftMonth(dir) {
  const [y, m] = anchor.split("-").map(Number);
  anchor = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 7);
}

const mondayOf = (dayStr) => {
  const d = new Date(dayStr + "T12:00:00Z");
  return addDays(dayStr, -((d.getUTCDay() + 6) % 7));
};

async function renderCal() {
  const [y, m] = anchor.split("-").map(Number);
  const from = `${anchor}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = todayLocal();
  const [counts, loadedCats] = await Promise.all([loadReflectionDays(from, to), loadReflectionCats()]);
  cats = loadedCats;

  root.querySelector("#rf-label").textContent =
    new Date(from + "T12:00Z").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const start = mondayOf(from);
  const end = addDays(mondayOf(to), 6);
  let html = `<div class="cal-head">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<div>${d}</div>`).join("")}</div><div class="cal-grid">`;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    const n = counts[ds] || 0;
    const inMonth = ds.startsWith(anchor);
    html += `<div class="cal-cell rf ${n ? "has" : ""} ${ds === today ? "today" : ""} ${inMonth ? "" : "outside"}" data-day="${ds}">
      <div class="d">${Number(ds.slice(8))}</div>
      ${n ? `<div class="cnt">${pOf(n)}</div>` : ""}
    </div>`;
  }
  root.querySelector("#rf-cal").innerHTML = html + `</div>`;
  root.querySelectorAll("#rf-cal .cal-cell").forEach((c) => c.onclick = () => openDay(c.dataset.day));
}

// ---------- Заметка дня ----------
async function openDay(dayStr) {
  let items;
  try {
    items = (await loadReflectionItems(dayStr)).map((it) => ({ text: it.text, category_id: it.category_id }));
  } catch (e) { return notify("Ошибка: " + e.message, "error"); }
  if (!items.length) items = [{ text: "", category_id: null }];

  const modal = openModal(`
    <h2>Рефлексия · ${fmtDay(dayStr)}</h2>
    <div class="ce-form">
      <div id="rf-items"></div>
      <button class="btn dashed" id="rf-add" type="button">${IC.plus} Добавить пункт</button>
      <div class="ce-footer">
        <span class="muted small">Пиши выводы по пунктам — категории помогут потом найти опасные и хорошие паттерны.</span>
        <div class="row" style="gap:8px">
          <button class="btn ghost" id="rf-cancel" type="button">Отмена</button>
          <button class="btn primary" id="rf-save" type="button">Сохранить</button>
        </div>
      </div>
    </div>`);

  const itemsEl = modal.el.querySelector("#rf-items");
  const catOpts = (sel) => `<option value="">без категории</option>` +
    cats.map((c) => `<option value="${c.id}" ${sel === c.id ? "selected" : ""}>${esc(c.icon)} ${esc(c.name)}</option>`).join("");

  const drawItems = () => {
    itemsEl.innerHTML = items.map((it, i) => `
      <div class="ce-row rf-row" data-i="${i}">
        <div class="ce-main">
          <div class="row" style="gap:9px;flex-wrap:nowrap;align-items:flex-start">
            <span class="ce-num num" style="margin-top:10px">${i + 1}</span>
            <textarea class="rf-text" rows="2" placeholder="Что произошло, какой вывод сделал…">${esc(it.text)}</textarea>
          </div>
        </div>
        <select class="rf-cat only-desk" title="Категория">${catOpts(it.category_id)}</select>
        <div class="rf-chips only-mob">
          <button type="button" class="chip ${it.category_id == null ? "on" : ""}" data-c="">—</button>
          ${cats.map((c) => `<button type="button" class="chip ${it.category_id === c.id ? "on" : ""}" data-c="${c.id}" title="${esc(c.name)}">${esc(c.icon)}</button>`).join("")}
        </div>
        <div class="ce-btns">
          <button type="button" class="btn ghost icon rf-up" title="Выше" ${i === 0 ? "disabled" : ""}>${IC.up}</button>
          <button type="button" class="btn ghost icon rf-down" title="Ниже" ${i === items.length - 1 ? "disabled" : ""}>${IC.down}</button>
          <button type="button" class="btn ghost icon danger rf-rm" title="Удалить пункт">${IC.x}</button>
        </div>
      </div>`).join("");

    itemsEl.querySelectorAll(".ce-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".rf-text").oninput = (e) => { items = items.map((x, k) => k === i ? { ...x, text: e.target.value } : x); };
      row.querySelector(".rf-cat").onchange = (e) => { items = items.map((x, k) => k === i ? { ...x, category_id: e.target.value ? Number(e.target.value) : null } : x); };
      // мобила: ряд эмодзи-чипов вместо селекта (спека 2g)
      row.querySelectorAll(".rf-chips .chip").forEach((ch) => ch.onclick = () => {
        items = items.map((x, k) => k === i ? { ...x, category_id: ch.dataset.c ? Number(ch.dataset.c) : null } : x);
        drawItems();
      });
      row.querySelector(".rf-up").onclick = () => { items = swap(items, i, i - 1); drawItems(); };
      row.querySelector(".rf-down").onclick = () => { items = swap(items, i, i + 1); drawItems(); };
      row.querySelector(".rf-rm").onclick = () => { items = items.filter((_, k) => k !== i); drawItems(); };
    });
  };
  drawItems();

  modal.el.querySelector("#rf-add").onclick = () => { items = [...items, { text: "", category_id: null }]; drawItems(); };
  modal.el.querySelector("#rf-cancel").onclick = modal.close;
  modal.el.querySelector("#rf-save").onclick = async () => {
    const clean = items.map((it) => ({ ...it, text: it.text.trim() })).filter((it) => it.text);
    try {
      await replaceReflectionItems(dayStr, clean);
      notify("✓ Заметка сохранена");
      modal.close();
      renderCal();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}

// ---------- Настройка категорий ----------
function openCatsEditor() {
  // рабочая копия; изменения применяются по «Сохранить»
  let rows = cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }));
  const removed = [];

  const modal = openModal(`
    <h2>Категории пунктов</h2>
    <div class="ce-form">
      <p class="muted small" style="margin:0">Иконка — любой эмодзи (🔴 🟢 🟡 📌 ⚠️ 💡 🧠…), цвет — рамка бейджа.
      Удаление категории не удаляет пункты — они останутся «без категории».</p>
      <div id="rc-rows"></div>
      <button class="btn dashed" id="rc-add" type="button">${IC.plus} Добавить категорию</button>
      <div class="ce-footer">
        <span></span>
        <div class="row" style="gap:8px">
          <button class="btn ghost" id="rc-cancel" type="button">Отмена</button>
          <button class="btn primary" id="rc-save" type="button">Сохранить</button>
        </div>
      </div>
    </div>`);

  const rowsEl = modal.el.querySelector("#rc-rows");
  const draw = () => {
    rowsEl.innerHTML = rows.map((c, i) => `
      <div class="ce-row rc-row" data-i="${i}">
        <input type="text" class="rc-icon" maxlength="4" value="${esc(c.icon)}" title="Эмодзи" style="text-align:center">
        <input type="text" class="rc-name" placeholder="Название категории" value="${esc(c.name)}">
        <select class="rc-color">${Object.entries(COLOR_LABEL).map(([v, l]) =>
          `<option value="${v}" ${c.color === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <div class="ce-btns">
          <button type="button" class="btn ghost icon rc-up" title="Выше" ${i === 0 ? "disabled" : ""}>${IC.up}</button>
          <button type="button" class="btn ghost icon rc-down" title="Ниже" ${i === rows.length - 1 ? "disabled" : ""}>${IC.down}</button>
          <button type="button" class="btn ghost icon danger rc-rm" title="Удалить">${IC.x}</button>
        </div>
      </div>`).join("");
    rowsEl.querySelectorAll(".rc-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector(".rc-icon").oninput = (e) => { rows = rows.map((x, k) => k === i ? { ...x, icon: e.target.value } : x); };
      row.querySelector(".rc-name").oninput = (e) => { rows = rows.map((x, k) => k === i ? { ...x, name: e.target.value } : x); };
      row.querySelector(".rc-color").onchange = (e) => { rows = rows.map((x, k) => k === i ? { ...x, color: e.target.value } : x); };
      row.querySelector(".rc-up").onclick = () => { rows = swap(rows, i, i - 1); draw(); };
      row.querySelector(".rc-down").onclick = () => { rows = swap(rows, i, i + 1); draw(); };
      row.querySelector(".rc-rm").onclick = async () => {
        if (rows[i].id && !(await confirmToast(`Удалить категорию «${rows[i].name}»?`))) return;
        if (rows[i].id) removed.push(rows[i].id);
        rows = rows.filter((_, k) => k !== i);
        draw();
      };
    });
  };
  draw();

  modal.el.querySelector("#rc-add").onclick = () => { rows = [...rows, { id: null, name: "", icon: "💡", color: "muted" }]; draw(); };
  modal.el.querySelector("#rc-cancel").onclick = modal.close;
  modal.el.querySelector("#rc-save").onclick = async () => {
    const clean = rows.map((c) => ({ ...c, name: c.name.trim(), icon: c.icon.trim() || "📝" })).filter((c) => c.name);
    try {
      for (const id of removed) await delReflectionCat(id);
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (c.id) await updReflectionCat(c.id, { name: c.name, icon: c.icon, color: c.color, position: i });
        else await addReflectionCat({ name: c.name, icon: c.icon, color: c.color, position: i });
      }
      notify("✓ Категории сохранены");
      modal.close();
      renderCal();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}

const swap = (arr, a, b) => {
  if (b < 0 || b >= arr.length) return arr;
  const out = [...arr];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
};
