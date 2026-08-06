// Вкладка «Симулятор» — тренировка на исторических данных Bybit (техдок 22, этап 1).
// Экран счёта (эпохи) + настройка сессии + последние сделки; рабочий экран — sim/work.js.
import { esc, fmtRu, fmtDT, notify, confirmToast, openModal, state } from "./util.js";
import { TIMEFRAMES, tfById, loadKlines, loadSymbols } from "./sim/data.js";
import * as sapi from "./sim/simapi.js";
import { mountWork, workAlive, workResize } from "./sim/work.js";
import { openGallery } from "./gallery.js";

let root;
let account = null;

const money = (v) => `${v < 0 ? "−" : ""}$${fmtRu(Math.abs(Number(v) || 0), 2)}`;
const SIDE_RU = { long: "Лонг", short: "Шорт" };
const REASON_RU = { manual: "вручную", tp: "тейк", sl: "стоп", liq: "ликвидация", end: "конец сессии" };

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
      <div class="titles"><h1>Симулятор</h1><span class="sub">тренировка на истории Bybit — виртуальный счёт</span></div>
    </header>
    <div id="sim-body"><div class="loading">Загружаю…</div></div>`;
  await renderHome();
}

async function renderHome() {
  const body = root.querySelector("#sim-body");
  try {
    account = await sapi.loadActiveAccount();
  } catch (e) {
    body.innerHTML = `<div class="warn">Не удалось загрузить счёт: ${esc(e.message)}</div>`;
    return;
  }
  if (!account) return renderNewAccount(body);

  const totals = await sapi.loadAccountTotals(account.id).catch(() => ({ sessions: 0, trades: 0 }));
  const diff = Number(account.balance) - Number(account.start_deposit);
  const diffPct = Number(account.start_deposit) ? (diff / Number(account.start_deposit)) * 100 : 0;
  const cls = diff > 0 ? "pos" : diff < 0 ? "neg" : "";

  body.innerHTML = `
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
      <h3>Новая сессия</h3>
      ${setupForm()}
    </div>
    <div class="block">
      <h3>Последние сделки</h3>
      <div id="sim-recent"><div class="loading">Загружаю…</div></div>
    </div>`;

  body.querySelector("#sim-reset").onclick = resetAccount;
  bindSetup(body.querySelector(".sim-setup"));
  renderRecent(body.querySelector("#sim-recent"));
}

// ---------- Создание / обнуление счёта ----------

function renderNewAccount(body) {
  body.innerHTML = `
    <div class="block sim-acc">
      <h3>Виртуальный счёт</h3>
      <p class="muted">Задайте стартовый депозит — он переходит между сессиями. Обнулить и начать заново можно в любой момент, история останется.</p>
      <div class="row sim-newacc">
        <label class="fld"><span>Стартовый депозит, $</span>
          <input id="sim-dep" type="number" min="1" step="any" value="1000" inputmode="decimal"></label>
        <button id="sim-create" class="btn primary">Создать счёт</button>
      </div>
    </div>`;
  body.querySelector("#sim-create").onclick = async () => {
    const v = Number(body.querySelector("#sim-dep").value);
    if (!(v > 0)) return notify("Введите сумму депозита", "error");
    try {
      account = await sapi.createAccount(v);
      notify("Счёт создан");
      renderHome();
    } catch (e) { notify("Ошибка: " + e.message, "error", 6000); }
  };
}

async function resetAccount() {
  const ok = await confirmToast("Обнулить депозит? Текущая эпоха закроется, история и статистика останутся.", "Обнулить");
  if (!ok) return;
  const m = openModal(`
    <h3>Новый депозит</h3>
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
      account = await sapi.createAccount(v);
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
  return `
    <div class="sim-form">
      <label class="fld"><span>Пара</span>
        <input id="ss-symbol" list="sim-symbols" value="${esc(s.symbol ?? "BTCUSDT")}" autocomplete="off" spellcheck="false">
        <datalist id="sim-symbols"></datalist></label>
      <div class="fld"><span>Таймфрейм</span>
        <div class="seg" id="ss-tf">${TIMEFRAMES.map((t) =>
          `<button class="btn ${t.id === tf ? "on" : ""}" data-tf="${t.id}">${t.label}</button>`).join("")}</div></div>
      <label class="fld"><span>С</span><input id="ss-from" type="date" value="${esc(from)}"></label>
      <label class="fld"><span>По</span><input id="ss-to" type="date" value="${esc(to)}"></label>
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

  el.querySelectorAll("#ss-tf .btn").forEach((b) => b.onclick = () => {
    el.querySelectorAll("#ss-tf .btn").forEach((x) => x.classList.toggle("on", x === b));
  });

  el.querySelector("#ss-start").onclick = () => startSession(el);
}

async function startSession(el) {
  const symbol = el.querySelector("#ss-symbol").value.trim().toUpperCase();
  const tfId = el.querySelector("#ss-tf .btn.on")?.dataset.tf ?? "5";
  const tf = tfById(tfId);
  const fromStr = el.querySelector("#ss-from").value;
  const toStr = el.querySelector("#ss-to").value;
  const fee = Number(el.querySelector("#ss-fee").value);
  const status = el.querySelector("#ss-status");
  const btn = el.querySelector("#ss-start");

  if (!symbol) return notify("Укажите пару", "error");
  if (!fromStr || !toStr) return notify("Укажите период", "error");
  const fromMs = new Date(fromStr + "T00:00:00Z").getTime();
  const toMs = new Date(toStr + "T23:59:59Z").getTime();
  if (!(fromMs < toMs)) return notify("Дата «с» должна быть раньше «по»", "error");
  if (!(fee >= 0)) return notify("Комиссия некорректна", "error");
  const expected = (toMs - fromMs) / tf.ms;
  if (expected > 60000) return notify("Период слишком большой для этого таймфрейма — сократите даты или укрупните ТФ", "error", 6000);

  localStorage.setItem(setupKey, JSON.stringify({ symbol, tf: tfId, from: fromStr, to: toStr, fee }));
  btn.disabled = true;
  status.textContent = "Загружаю свечи…";
  try {
    const candles = await loadKlines(symbol, tfId, fromMs, toMs,
      (n) => { status.textContent = `Загружаю свечи… ${n}`; });
    if (candles.length < 30) throw new Error("слишком мало свечей за период (нет данных по паре?)");
    const session = await sapi.createSession({
      account_id: account.id, symbol, timeframe: tfId,
      from_ts: new Date(fromMs).toISOString(), to_ts: new Date(toMs).toISOString(),
      random: false, fee_pct: fee, funding: false,
    });
    status.textContent = "";
    mountWork({
      root: root.querySelector("#sim-body"),
      account, session, candles, tf,
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

// ---------- Последние сделки ----------

async function renderRecent(el) {
  let rows;
  try { rows = await sapi.loadRecentTrades(account.id); }
  catch (e) { el.innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
  const closed = rows.filter((t) => t.exit_ts);
  if (!closed.length) { el.innerHTML = `<div class="empty">Сделок пока нет — начните сессию</div>`; return; }

  el.innerHTML = `<table class="tbl"><thead><tr>
      <th>Когда</th><th>Пара</th><th>Сторона</th><th>Маржа × плечо</th><th>Выход</th><th>Результат</th>
    </tr></thead><tbody>` +
    closed.map((t) => {
      const roi = Number(t.margin) ? (Number(t.pnl) / Number(t.margin)) * 100 : 0;
      const cls = t.pnl > 0 ? "pos" : t.pnl < 0 ? "neg" : "";
      return `<tr class="trow clickable" data-id="${t.id}">
        <td class="num">${fmtDT(t.entry_ts)}</td>
        <td>${esc(t.sim_sessions?.symbol ?? "")} · ${esc(tfById(t.sim_sessions?.timeframe).label)}</td>
        <td class="${t.side === "long" ? "pos" : "neg"}">${SIDE_RU[t.side] ?? t.side}</td>
        <td class="num">${money(t.margin)} × ${fmtRu(Number(t.leverage), 0)}</td>
        <td>${REASON_RU[t.exit_reason] ?? "—"}</td>
        <td class="num ${cls}">${money(t.pnl)} · ${roi >= 0 ? "+" : "−"}${fmtRu(Math.abs(roi), 1)}%</td>
      </tr>`;
    }).join("") + `</tbody></table>`;

  el.querySelectorAll("tr.trow").forEach((tr) => tr.onclick = () =>
    openTradeShots(closed.find((t) => String(t.id) === tr.dataset.id)));
}

// Карточка сделки этапа 1: детали + автоскрины входа/выхода (полная карточка — этап 2)
async function openTradeShots(t) {
  const m = openModal(`
    <h3>${SIDE_RU[t.side]} ${esc(t.sim_sessions?.symbol ?? "")} · ${money(t.pnl)}</h3>
    <div class="sim-tdetails">
      <div><span class="lbl">Вход</span><span class="num">${money(t.entry_price)} · ${fmtDT(t.entry_ts)}</span></div>
      <div><span class="lbl">Выход</span><span class="num">${money(t.exit_price)} · ${fmtDT(t.exit_ts)}</span></div>
      <div><span class="lbl">Маржа × плечо</span><span class="num">${money(t.margin)} × ${fmtRu(Number(t.leverage), 0)}</span></div>
      <div><span class="lbl">Комиссии</span><span class="num">${money(t.fees)}</span></div>
      <div><span class="lbl">Причина закрытия</span><span>${REASON_RU[t.exit_reason] ?? "—"}</span></div>
    </div>
    <div id="sim-shots" class="loading">Загружаю скрины…</div>`, { wide: true });

  const box = m.el.querySelector("#sim-shots");
  const [entry, exit] = await Promise.all([
    sapi.simShotUrl(t.id, "entry"), sapi.simShotUrl(t.id, "exit"),
  ]);
  const items = [
    entry && { url: entry, caption: "Вход", sub: fmtDT(t.entry_ts) },
    exit && { url: exit, caption: "Выход", sub: fmtDT(t.exit_ts) },
  ].filter(Boolean);
  if (!items.length) { box.innerHTML = `<div class="empty">Скринов нет</div>`; return; }
  box.classList.remove("loading");
  box.innerHTML = `<div class="gal">` + items.map((it, i) =>
    `<div class="gal-tile" data-i="${i}" style="background-image:url('${it.url.replace(/'/g, "%27")}')"><span class="gal-cap">${esc(it.caption)}</span></div>`).join("") + `</div>`;
  box.querySelectorAll(".gal-tile").forEach((tile) => tile.onclick = () =>
    openGallery(items, Number(tile.dataset.i)));
}
