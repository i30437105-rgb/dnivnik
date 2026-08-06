// Вкладка «Симулятор» — тренировка на исторических данных Bybit (техдок 22).
// Несколько независимых счетов (под разные стратегии), эпохи, настройка сессии
// (даты или случайная точка), статистика — sim/stats.js, рабочий экран — sim/work.js.
import { esc, fmtRu, notify, confirmToast, openModal } from "./util.js";
import { TIMEFRAMES, tfById, loadKlines, loadSymbols } from "./sim/data.js";
import * as sapi from "./sim/simapi.js";
import { mountWork, workAlive, workResize } from "./sim/work.js";
import { renderStats } from "./sim/stats.js";

let root;
let accounts = [];
let account = null; // выбранный счёт

const money = (v) => `${v < 0 ? "−" : ""}$${fmtRu(Math.abs(Number(v) || 0), 2)}`;
const RANDOM_START = Date.UTC(2020, 0, 1); // глубина истории Bybit по BTCUSDT

const setupKey = "sim-setup";
const loadSetup = () => {
  try { return JSON.parse(localStorage.getItem(setupKey)) ?? {}; } catch { return {}; }
};

export async function initSimulator(container) {
  // Живая сессия переживает переключение вкладок — не перерисовываем поверх неё
  if (workAlive() && container.querySelector(".sim-work")) { workResize(); return; }
  root = container;
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Симулятор</h1><span class="sub">тренировка на истории Bybit — виртуальные счета</span></div>
    </header>
    <div id="sim-body"><div class="loading">Загружаю…</div></div>`;
  await renderHome();
}

async function renderHome() {
  const body = root.querySelector("#sim-body");
  try {
    accounts = await sapi.loadActiveAccounts();
  } catch (e) {
    body.innerHTML = `<div class="warn">Не удалось загрузить счета: ${esc(e.message)}</div>`;
    return;
  }
  if (!accounts.length) { account = null; return renderFirstAccount(body); }

  const savedId = Number(localStorage.getItem("sim-acc"));
  account = accounts.find((a) => a.id === savedId) ?? accounts[0];
  localStorage.setItem("sim-acc", String(account.id));

  const totals = await sapi.loadAccountTotals(account.id).catch(() => ({ sessions: 0, trades: 0 }));
  const diff = Number(account.balance) - Number(account.start_deposit);
  const diffPct = Number(account.start_deposit) ? (diff / Number(account.start_deposit)) * 100 : 0;
  const cls = diff > 0 ? "pos" : diff < 0 ? "neg" : "";

  body.innerHTML = `
    <div class="sim-accbar">
      ${accounts.map((a) => `<button class="chip acc ${a.id === account.id ? "on" : ""}" data-id="${a.id}">${esc(a.name)}</button>`).join("")}
      <button class="chip" id="sim-newacc">+ Новый счёт</button>
    </div>
    <div class="block sim-acc">
      <div class="sim-acc-grid">
        <div class="sa"><span class="lbl">Баланс</span><b class="num">${money(account.balance)}</b></div>
        <div class="sa"><span class="lbl">Старт эпохи</span><span class="num">${money(account.start_deposit)}</span></div>
        <div class="sa"><span class="lbl">Изменение</span>
          <span class="num ${cls}">${diff >= 0 ? "+" : "−"}${money(Math.abs(diff)).slice(diff < 0 ? 1 : 0)} · ${diffPct >= 0 ? "+" : "−"}${fmtRu(Math.abs(diffPct), 1)}%</span></div>
        <div class="sa"><span class="lbl">Сессий · сделок</span><span class="num">${totals.sessions} · ${totals.trades}</span></div>
      </div>
      <button id="sim-reset" class="btn ghost small">⟲ Обнулить депозит</button>
    </div>
    <div class="block sim-setup">
      <h3>Новая сессия <span class="muted">счёт «${esc(account.name)}»</span></h3>
      ${setupForm()}
    </div>
    <div class="block">
      <h3>Статистика</h3>
      <div id="sim-stats"></div>
    </div>`;

  body.querySelectorAll(".chip.acc").forEach((c) => c.onclick = () => {
    localStorage.setItem("sim-acc", c.dataset.id);
    renderHome();
  });
  body.querySelector("#sim-newacc").onclick = () => openAccountModal();
  body.querySelector("#sim-reset").onclick = resetAccount;
  bindSetup(body.querySelector(".sim-setup"));
  renderStats(body.querySelector("#sim-stats"), account);
}

// ---------- Создание / обнуление счетов ----------

function renderFirstAccount(body) {
  body.innerHTML = `
    <div class="block sim-acc">
      <h3>Виртуальный счёт</h3>
      <p class="muted">Создайте счёт — их может быть несколько, под разные стратегии.
        Депозит переходит между сессиями; обнуление закрывает эпоху, история остаётся.</p>
      <div class="row sim-newacc">
        <label class="fld"><span>Название</span>
          <input id="sim-name" maxlength="40" value="Счёт 1"></label>
        <label class="fld"><span>Стартовый депозит, $</span>
          <input id="sim-dep" type="number" min="1" step="any" value="1000" inputmode="decimal"></label>
        <button id="sim-create" class="btn primary">Создать счёт</button>
      </div>
    </div>`;
  body.querySelector("#sim-create").onclick = () =>
    createAccount(body.querySelector("#sim-name").value, body.querySelector("#sim-dep").value);
}

function openAccountModal() {
  const m = openModal(`
    <h3>Новый счёт</h3>
    <p class="muted">Отдельный симулятор со своим депозитом и статистикой — например, под другую стратегию.</p>
    <label class="fld"><span>Название</span>
      <input id="na-name" maxlength="40" value="Счёт ${accounts.length + 1}"></label>
    <label class="fld" style="margin-top:10px"><span>Стартовый депозит, $</span>
      <input id="na-dep" type="number" min="1" step="any" value="1000" inputmode="decimal"></label>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button id="na-ok" class="btn primary">Создать</button>
    </div>`);
  m.el.querySelector("#na-ok").onclick = async () => {
    const done = await createAccount(m.el.querySelector("#na-name").value, m.el.querySelector("#na-dep").value);
    if (done) m.close();
  };
}

async function createAccount(nameRaw, depRaw) {
  const name = String(nameRaw).trim();
  const dep = Number(depRaw);
  if (!name) { notify("Введите название счёта", "error"); return false; }
  if (!(dep > 0)) { notify("Введите сумму депозита", "error"); return false; }
  if (accounts.some((a) => a.name === name)) { notify("Счёт с таким названием уже есть", "error"); return false; }
  try {
    const acc = await sapi.createAccount(name, dep);
    localStorage.setItem("sim-acc", String(acc.id));
    notify("Счёт создан");
    renderHome();
    return true;
  } catch (e) {
    notify("Ошибка: " + e.message, "error", 6000);
    return false;
  }
}

async function resetAccount() {
  const ok = await confirmToast(`Обнулить депозит счёта «${account.name}»? Эпоха закроется, история и статистика останутся.`, "Обнулить");
  if (!ok) return;
  const m = openModal(`
    <h3>Новый депозит — «${esc(account.name)}»</h3>
    <label class="fld"><span>Стартовая сумма, $</span>
      <input id="sim-dep2" type="number" min="1" step="any" value="${esc(account.start_deposit)}" inputmode="decimal"></label>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button id="sim-dep-ok" class="btn primary">Начать новую эпоху</button>
    </div>`);
  m.el.querySelector("#sim-dep-ok").onclick = async () => {
    const v = Number(m.el.querySelector("#sim-dep2").value);
    if (!(v > 0)) return notify("Введите сумму", "error");
    try {
      await sapi.closeAccount(account.id);
      const acc = await sapi.createAccount(account.name, v);
      localStorage.setItem("sim-acc", String(acc.id));
      m.close();
      notify("Новая эпоха начата");
      renderHome();
    } catch (e) { notify("Ошибка: " + e.message, "error", 6000); }
  };
}

// ---------- Настройка сессии ----------

function setupForm() {
  const s = loadSetup();
  const today = new Date();
  const to = s.to ?? today.toISOString().slice(0, 10);
  const from = s.from ?? new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const tf = s.tf ?? "5";
  const mode = s.mode ?? "dates";
  return `
    <div class="sim-form">
      <label class="fld"><span>Пара</span>
        <input id="ss-symbol" list="sim-symbols" value="${esc(s.symbol ?? "BTCUSDT")}" autocomplete="off" spellcheck="false">
        <datalist id="sim-symbols"></datalist></label>
      <div class="fld"><span>Таймфрейм</span>
        <div class="seg" id="ss-tf">${TIMEFRAMES.map((t) =>
          `<button class="btn ${t.id === tf ? "on" : ""}" data-tf="${t.id}">${t.label}</button>`).join("")}</div></div>
      <div class="fld"><span>Период</span>
        <div class="seg" id="ss-mode">
          <button class="btn ${mode === "dates" ? "on" : ""}" data-m="dates">Даты</button>
          <button class="btn ${mode === "random" ? "on" : ""}" data-m="random">Случайная точка</button>
        </div></div>
      <label class="fld ss-dates" ${mode === "random" ? "hidden" : ""}><span>С</span><input id="ss-from" type="date" value="${esc(from)}"></label>
      <label class="fld ss-dates" ${mode === "random" ? "hidden" : ""}><span>По</span><input id="ss-to" type="date" value="${esc(to)}"></label>
      <label class="fld ss-rand" ${mode === "random" ? "" : "hidden"}><span>Дней истории</span>
        <input id="ss-days" type="number" min="2" max="120" step="1" value="${esc(s.days ?? 30)}" inputmode="numeric"></label>
      <label class="fld"><span>Комиссия, %</span>
        <input id="ss-fee" type="number" step="any" min="0" value="${esc(s.fee ?? 0.055)}" inputmode="decimal"></label>
      <button id="ss-start" class="btn primary">Начать сессию</button>
    </div>
    <div id="ss-status" class="muted"></div>`;
}

function bindSetup(el) {
  loadSymbols().then((syms) => {
    el.querySelector("#sim-symbols").innerHTML = syms.map((s) => `<option value="${esc(s)}">`).join("");
  }).catch(() => { /* поиск пар не критичен — можно ввести руками */ });

  for (const seg of ["#ss-tf", "#ss-mode"]) {
    el.querySelectorAll(`${seg} .btn`).forEach((b) => b.onclick = () => {
      el.querySelectorAll(`${seg} .btn`).forEach((x) => x.classList.toggle("on", x === b));
      if (seg === "#ss-mode") {
        const rand = b.dataset.m === "random";
        el.querySelectorAll(".ss-dates").forEach((x) => x.hidden = rand);
        el.querySelector(".ss-rand").hidden = !rand;
      }
    });
  }
  el.querySelector("#ss-start").onclick = () => startSession(el);
}

async function startSession(el) {
  const symbol = el.querySelector("#ss-symbol").value.trim().toUpperCase();
  const tfId = el.querySelector("#ss-tf .btn.on")?.dataset.tf ?? "5";
  const tf = tfById(tfId);
  const mode = el.querySelector("#ss-mode .btn.on")?.dataset.m ?? "dates";
  const fee = Number(el.querySelector("#ss-fee").value);
  const status = el.querySelector("#ss-status");
  const btn = el.querySelector("#ss-start");

  if (!symbol) return notify("Укажите пару", "error");
  if (!(fee >= 0)) return notify("Комиссия некорректна", "error");

  let fromMs, toMs;
  const days = Number(el.querySelector("#ss-days").value) || 30;
  if (mode === "dates") {
    const fromStr = el.querySelector("#ss-from").value;
    const toStr = el.querySelector("#ss-to").value;
    if (!fromStr || !toStr) return notify("Укажите период", "error");
    fromMs = new Date(fromStr + "T00:00:00Z").getTime();
    toMs = new Date(toStr + "T23:59:59Z").getTime();
    if (!(fromMs < toMs)) return notify("Дата «с» должна быть раньше «по»", "error");
    localStorage.setItem(setupKey, JSON.stringify({
      ...loadSetup(), symbol, tf: tfId, from: fromStr, to: toStr, fee, mode,
    }));
  } else {
    // случайная точка: дата скрыта до конца сессии
    const span = days * 864e5;
    const latest = Date.now() - span - 864e5;
    fromMs = RANDOM_START + Math.floor(Math.random() * (latest - RANDOM_START));
    toMs = fromMs + span;
    localStorage.setItem(setupKey, JSON.stringify({ ...loadSetup(), symbol, tf: tfId, fee, mode, days }));
  }
  const expected = (toMs - fromMs) / tf.ms;
  if (expected > 60000) return notify("Период слишком большой для этого таймфрейма — сократите даты или укрупните ТФ", "error", 6000);

  btn.disabled = true;
  try {
    let candles = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      status.textContent = "Загружаю свечи…";
      candles = await loadKlines(symbol, tfId, fromMs, toMs,
        (n) => { status.textContent = `Загружаю свечи… ${n}`; });
      if (candles.length >= 30 || mode === "dates") break;
      // случайная точка попала до листинга пары — пробуем другую
      fromMs = RANDOM_START + Math.floor(Math.random() * (Date.now() - days * 864e5 - 864e5 - RANDOM_START));
      toMs = fromMs + days * 864e5;
    }
    if (candles.length < 30) throw new Error("слишком мало свечей за период (нет данных по паре?)");
    status.textContent = "";
    // сессия НЕ пишется в базу здесь — запись появится при первой реальной сделке
    const spec = {
      account_id: account.id, symbol, timeframe: tfId,
      from_ts: new Date(fromMs).toISOString(), to_ts: new Date(toMs).toISOString(),
      random: mode === "random", fee_pct: fee, funding: false,
    };
    mountWork({
      root: root.querySelector("#sim-body"),
      account, spec, candles, tf,
      onBalance: (bal) => { account = { ...account, balance: bal }; },
      onExit: () => renderHome(),
    });
  } catch (e) {
    status.textContent = "";
    notify("Не получилось начать: " + e.message, "error", 7000);
  } finally {
    btn.disabled = false;
  }
}
