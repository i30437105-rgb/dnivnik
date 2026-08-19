// Вкладка «Проп»: ручной журнал сделок проп-трейдинга.
// Календарь месяца → сделки дня. Без цен и PnL — точка входа, скрины, стратегия,
// состояние и комментарий с итогом словами (решение Ивана: итог — свободный текст).

import {
  loadPropTrades, createPropTrade, updatePropTrade, deletePropTrade,
  uploadPropShot, loadPropShots, deletePropShot, loadStrategies,
} from "./api.js";
import { loadSymbols } from "./sim/data.js";
import { openGallery } from "./gallery.js";
import { esc } from "./util.js";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

let root;
let cur;              // { y, m } — показанный месяц
let selDay;           // выбранный день YYYY-MM-DD
let byDay = new Map();// сделки месяца по дням
let strats = [];
let editingId = null; // id редактируемой сделки (null — новая)
let pendingFiles = [];// скрины, выбранные до сохранения новой сделки

const pad2 = (n) => String(n).padStart(2, "0");
const key = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayKey = () => { const t = new Date(); return key(t.getFullYear(), t.getMonth(), t.getDate()); };

export function initProp(container) {
  root = container;
  const t = new Date();
  cur = { y: t.getFullYear(), m: t.getMonth() };
  selDay = todayKey();
  editingId = null;
  pendingFiles = [];
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Проп-сделки</h1><span class="sub">ручной журнал: точки входа, скрины, итог — словами</span></div>
    </header>
    <div class="block">
      <div class="row" style="gap:10px;align-items:center">
        <button class="btn" id="pp-prev">‹</button>
        <b id="pp-title" style="min-width:150px;text-align:center"></b>
        <button class="btn" id="pp-next">›</button>
        <button class="btn ghost" id="pp-today">Сегодня</button>
      </div>
      <div class="prop-cal" id="pp-cal"></div>
    </div>
    <div id="pp-day"></div>`;
  root.querySelector("#pp-prev").onclick = () => shiftMonth(-1);
  root.querySelector("#pp-next").onclick = () => shiftMonth(1);
  root.querySelector("#pp-today").onclick = () => {
    const n = new Date();
    cur = { y: n.getFullYear(), m: n.getMonth() };
    selDay = todayKey();
    refresh();
  };
  loadStrategies().then((s) => { strats = s; }).catch(() => { strats = []; });
  refresh();
}

function shiftMonth(d) {
  const dt = new Date(cur.y, cur.m + d, 1);
  cur = { y: dt.getFullYear(), m: dt.getMonth() };
  refresh();
}

async function refresh() {
  const first = key(cur.y, cur.m, 1);
  const lastD = new Date(cur.y, cur.m + 1, 0).getDate();
  const last = key(cur.y, cur.m, lastD);
  root.querySelector("#pp-title").textContent = `${MONTHS[cur.m]} ${cur.y}`;
  let trades = [];
  try {
    trades = await loadPropTrades(first, last);
  } catch (e) {
    root.querySelector("#pp-day").innerHTML = `<div class="warn">Не удалось загрузить сделки: ${esc(e.message)}</div>`;
    return;
  }
  byDay = new Map();
  for (const t of trades) {
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day).push(t);
  }
  renderCal();
  renderDay();
}

function renderCal() {
  const el = root.querySelector("#pp-cal");
  const lastD = new Date(cur.y, cur.m + 1, 0).getDate();
  const shift = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7; // неделя с понедельника
  const tk = todayKey();
  let html = DOW.map((d) => `<div class="pc-h">${d}</div>`).join("");
  for (let i = 0; i < shift; i++) html += `<div></div>`;
  for (let d = 1; d <= lastD; d++) {
    const k = key(cur.y, cur.m, d);
    const n = byDay.get(k)?.length ?? 0;
    html += `<div class="pc-cell ${k === selDay ? "on" : ""} ${k === tk ? "today" : ""}" data-day="${k}">
      <span class="pc-d">${d}</span>${n ? `<span class="pc-cnt">${n}</span>` : ""}</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll(".pc-cell").forEach((c) => c.onclick = () => {
    selDay = c.dataset.day;
    editingId = null;
    renderCal();
    renderDay();
  });
}

// ---------- День ----------

function fmtDayTitle(k) {
  const [y, m, d] = k.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].toLowerCase().replace(/ь$/, "я").replace(/т$/, "та").replace(/й$/, "я")} ${y}`;
}

function renderDay() {
  const pane = root.querySelector("#pp-day");
  const list = (byDay.get(selDay) ?? []).slice().sort((a, b) => (a.at_time ?? "") < (b.at_time ?? "") ? -1 : 1);
  pane.innerHTML = `
    <div class="block">
      <div class="row" style="gap:12px;align-items:center">
        <h2 style="margin:0">${esc(fmtDayTitle(selDay))}</h2>
        <span class="muted">${list.length ? list.length + " сдел." : "сделок нет"}</span>
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary" id="pp-add">+ Сделка</button>
      </div>
      <div id="pp-form"></div>
      <div id="pp-list"></div>
    </div>`;
  pane.querySelector("#pp-add").onclick = () => showForm(null);
  const listEl = pane.querySelector("#pp-list");
  listEl.innerHTML = list.map(cardHtml).join("");
  for (const t of list) bindCard(listEl, t);
}

const sideChip = (side) => side === "Buy"
  ? `<span class="chip" style="background:rgba(76,196,122,.15);border-color:rgba(76,196,122,.4);color:#4cc47a">Лонг</span>`
  : `<span class="chip" style="background:rgba(240,85,63,.15);border-color:rgba(240,85,63,.4);color:#f0553f">Шорт</span>`;

function cardHtml(t) {
  const strat = strats.find((s) => s.id === t.strategy_id)?.name;
  return `
  <div class="prop-trade" data-id="${t.id}" style="padding:14px 0;border-top:1px solid var(--border)">
    <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
      ${t.at_time ? `<span class="num muted">${esc(t.at_time.slice(0, 5))}</span>` : ""}
      <b>${esc(t.symbol || "—")}</b>
      ${sideChip(t.side)}
      ${strat ? `<span class="muted small">${esc(strat)}</span>` : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn ghost small" data-edit title="Изменить">✎</button>
      <button class="btn ghost small" data-del title="Удалить">✕</button>
    </div>
    ${t.state_tags?.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
      ${t.state_tags.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
    ${t.comment ? `<div class="small" style="margin-top:9px;line-height:1.55;color:var(--text-2);white-space:pre-wrap">${esc(t.comment)}</div>` : ""}
    <div class="row prop-shots" style="gap:8px;flex-wrap:wrap;margin-top:10px"></div>
  </div>`;
}

function bindCard(listEl, t) {
  const el = listEl.querySelector(`.prop-trade[data-id="${t.id}"]`);
  el.querySelector("[data-edit]").onclick = () => showForm(t);
  el.querySelector("[data-del]").onclick = async () => {
    if (!confirm(`Удалить сделку ${t.symbol || ""} вместе со скринами?`)) return;
    try {
      await deletePropTrade(t.id);
      refresh();
    } catch (e) { alert("Не удалось удалить: " + e.message); }
  };
  loadPropShots(t.id).then((shots) => {
    const row = el.querySelector(".prop-shots");
    if (!row || !shots.length) return;
    row.innerHTML = shots.map((s) => `<img class="prop-shot" src="${esc(s.url ?? "")}" alt="скрин">`).join("");
    const items = shots.map((s) => ({
      url: s.url,
      caption: `${t.symbol || "Сделка"} · ${t.side === "Buy" ? "Лонг" : "Шорт"}`,
      sub: `${fmtDayTitle(t.day)}${t.at_time ? " · " + t.at_time.slice(0, 5) : ""}`,
    }));
    [...row.querySelectorAll("img")].forEach((img, i) => img.onclick = () => openGallery(items, i));
  }).catch(() => { /* скрины не критичны для списка */ });
}

// ---------- Форма добавления / редактирования ----------

function showForm(t) {
  editingId = t?.id ?? null;
  pendingFiles = [];
  const holder = root.querySelector("#pp-form");
  holder.innerHTML = `
  <form id="ppf" style="margin:14px 0 6px;padding:14px;border:1px solid var(--border);border-radius:10px;display:flex;flex-direction:column;gap:11px">
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="muted small" style="display:flex;flex-direction:column;gap:4px">Время
        <input name="time" type="time" value="${esc(t?.at_time?.slice(0, 5) ?? "")}"></label>
      <label class="muted small" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:150px">Монета
        <input name="symbol" class="num" list="ppf-syms" placeholder="SOLUSDT" value="${esc(t?.symbol ?? "")}" spellcheck="false"></label>
      <datalist id="ppf-syms"></datalist>
      <div class="muted small" style="display:flex;flex-direction:column;gap:4px">Направление
        <span class="seg">
          <button type="button" class="btn ${(t?.side ?? "Buy") === "Buy" ? "on" : ""}" data-side="Buy">Лонг</button>
          <button type="button" class="btn ${t?.side === "Sell" ? "on" : ""}" data-side="Sell">Шорт</button>
        </span></div>
      <label class="muted small" style="display:flex;flex-direction:column;gap:4px;min-width:170px">Стратегия
        <select name="strategy">
          <option value="">Без стратегии</option>
          ${strats.map((s) => `<option value="${s.id}" ${t?.strategy_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select></label>
    </div>
    <label class="muted small" style="display:flex;flex-direction:column;gap:4px">Состояние (через запятую)
      <input name="tags" placeholder="спокойствие, FOMO, усталость" value="${esc((t?.state_tags ?? []).join(", "))}"></label>
    <label class="muted small" style="display:flex;flex-direction:column;gap:4px">Как выбирал вход и какой итог
      <textarea name="comment" style="min-height:76px" placeholder="Сетап, почему вошёл, чем закончилось…">${esc(t?.comment ?? "")}</textarea></label>
    <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
      <label class="btn" style="cursor:pointer">Скрины…
        <input name="files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label>
      <span class="muted small">или Ctrl+V — вставить из буфера</span>
      <span class="muted small num" id="ppf-cnt"></span>
    </div>
    <div class="row" id="ppf-old" style="gap:8px;flex-wrap:wrap"></div>
    <div class="row" style="gap:10px">
      <button class="btn primary" type="submit">${editingId ? "Сохранить" : "Добавить"}</button>
      <button class="btn ghost" type="button" id="ppf-cancel">Отмена</button>
      <span class="muted small" id="ppf-st"></span>
    </div>
  </form>`;

  loadSymbols().then((list) => {
    const dl = holder.querySelector("#ppf-syms");
    if (dl) dl.innerHTML = list.map((s) => `<option value="${esc(s)}">`).join("");
  }).catch(() => { /* подсказки не критичны */ });

  const f = holder.querySelector("#ppf");
  f.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => {
    f.querySelectorAll("[data-side]").forEach((x) => x.classList.toggle("on", x === b));
  });
  holder.querySelector("#ppf-cancel").onclick = () => { holder.innerHTML = ""; editingId = null; pendingFiles = []; };

  const cnt = () => { holder.querySelector("#ppf-cnt").textContent = pendingFiles.length ? `к загрузке: ${pendingFiles.length}` : ""; };
  f.querySelector('[name="files"]').onchange = (e) => {
    pendingFiles = [...pendingFiles, ...e.target.files];
    cnt();
  };
  f.onpaste = (e) => {
    const imgs = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
    if (imgs.length) { pendingFiles = [...pendingFiles, ...imgs]; cnt(); e.preventDefault(); }
  };

  // существующие скрины при редактировании — с удалением
  if (editingId) {
    loadPropShots(editingId).then((shots) => {
      const row = holder.querySelector("#ppf-old");
      if (!row) return;
      row.innerHTML = shots.map((s, i) => `<span style="position:relative">
        <img class="prop-shot" src="${esc(s.url ?? "")}" alt="скрин">
        <button type="button" class="btn ghost small" data-delshot="${i}" style="position:absolute;top:2px;right:2px">✕</button></span>`).join("");
      row.querySelectorAll("[data-delshot]").forEach((b) => b.onclick = async () => {
        await deletePropShot(shots[Number(b.dataset.delshot)]);
        b.parentElement.remove();
      });
    }).catch(() => { /* не критично */ });
  }

  f.onsubmit = async (e) => {
    e.preventDefault();
    const st = holder.querySelector("#ppf-st");
    st.textContent = "Сохраняю…";
    const timeV = f.querySelector('[name="time"]').value;
    const row = {
      day: selDay,
      at_time: timeV ? timeV + ":00" : null,
      symbol: f.querySelector('[name="symbol"]').value.trim().toUpperCase(),
      side: f.querySelector('[data-side].on')?.dataset.side ?? "Buy",
      strategy_id: f.querySelector('[name="strategy"]').value ? Number(f.querySelector('[name="strategy"]').value) : null,
      state_tags: f.querySelector('[name="tags"]').value.split(",").map((s) => s.trim()).filter(Boolean),
      comment: f.querySelector('[name="comment"]').value.trim(),
    };
    try {
      let id = editingId;
      if (id) {
        await updatePropTrade(id, row);
      } else {
        id = (await createPropTrade(row)).id;
      }
      for (let i = 0; i < pendingFiles.length; i++) {
        st.textContent = `Скрин ${i + 1}/${pendingFiles.length}…`;
        await uploadPropShot(id, pendingFiles[i]);
      }
      holder.innerHTML = "";
      editingId = null;
      pendingFiles = [];
      refresh();
    } catch (err) {
      st.textContent = "Ошибка: " + err.message;
    }
  };
}
