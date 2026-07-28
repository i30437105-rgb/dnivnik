// История сделок по чек-листам: календарь, создание сделки (снимок заполнения + скриншоты),
// просмотр и результат. Сохранить сделку можно ТОЛЬКО при вердикте «вход разрешён» (решение Ивана).
// Скриншот у пункта с настройкой «обязателен» требуется при ответе «да».
import {
  loadChecklists, loadChecklistTrades, createChecklistTrade, loadChecklistTradeFull,
  uploadChecklistShot, saveChecklistTradeResult, deleteChecklistTrade,
} from "./api.js";
import { esc, usd, fmtRu, fmtDay, fmtDT, todayLocal, addDays, notify, confirmToast, openModal, openLightbox } from "./util.js";

let root;
let anchor; // YYYY-MM календаря сделок

const PTS = { 1: 3, 2: 2, 3: 1 };
const WEIGHT_TAG = { 1: "accent", 2: "warn", 3: "" };
const WEIGHT_LABEL = { 1: "вес 1 · главный", 2: "вес 2 · средний", 3: "вес 3 · мелкий" };

const svg = (paths, sw = 2) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const IC = {
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>', 2.2),
  yes: svg('<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>', 2.8),
  no: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 2.8),
  x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  clip: svg('<path d="M20 11.5 12.6 19a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l6.7-6.7"/>', 1.8),
};

const tOf = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "сделка" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "сделки" : "сделок")}`;

const mondayOf = (dayStr) => {
  const d = new Date(dayStr + "T12:00:00Z");
  return addDays(dayStr, -((d.getUTCDay() + 6) % 7));
};

export function initClTrades(container) {
  root = container;
  anchor = anchor ?? todayLocal().slice(0, 7);
  root.innerHTML = `
    <section class="block" style="margin-top:22px">
      <div class="row spread" style="margin-bottom:14px">
        <h2 style="margin:0">Сделки по чек-листам</h2>
        <div class="row">
          <button class="btn small" id="ct-prev">‹</button>
          <span id="ct-label" class="plabel"></span>
          <button class="btn small" id="ct-next">›</button>
          <button class="btn primary" id="ct-new" style="margin-left:8px">${IC.plus} Добавить сделку</button>
        </div>
      </div>
      <div id="ct-cal"><div class="loading">Загружаю…</div></div>
      <div class="muted small" style="margin-top:10px">Каждая сделка хранит снимок заполнения чек-листа со скриншотами и результат. Кликни по дню со сделками.</div>
    </section>`;
  root.querySelector("#ct-new").onclick = openNewTrade;
  root.querySelector("#ct-prev").onclick = () => { shiftMonth(-1); renderCal(); };
  root.querySelector("#ct-next").onclick = () => { shiftMonth(1); renderCal(); };
  renderCal().catch((e) => root.querySelector("#ct-cal").innerHTML = `<div class="warn">Ошибка: ${esc(e.message)}</div>`);
}

function shiftMonth(dir) {
  const [y, m] = anchor.split("-").map(Number);
  anchor = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 7);
}

async function renderCal() {
  const [y, m] = anchor.split("-").map(Number);
  const from = `${anchor}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = todayLocal();
  const trades = await loadChecklistTrades(from, to);
  const byDay = {};
  for (const t of trades) (byDay[t.day] ??= []).push(t);

  root.querySelector("#ct-label").textContent =
    new Date(from + "T12:00Z").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const start = mondayOf(from);
  const end = addDays(mondayOf(to), 6);
  let html = `<div class="cal-head">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<div>${d}</div>`).join("")}</div><div class="cal-grid">`;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    const list = byDay[ds] ?? [];
    const withPnl = list.filter((t) => t.result_pnl != null);
    const sum = withPnl.reduce((s, t) => s + Number(t.result_pnl), 0);
    const cls = !list.length ? "" : withPnl.length ? (sum > 0 ? "pos" : sum < 0 ? "neg" : "zero") : "hasct";
    // разбивка по чек-листам: «Пятиволновка ×2»
    const names = {};
    for (const t of list) names[t.checklist_name] = (names[t.checklist_name] || 0) + 1;
    const brief = Object.entries(names).slice(0, 2)
      .map(([n, c]) => `${esc(n.length > 14 ? n.slice(0, 13) + "…" : n)}${c > 1 ? ` ×${c}` : ""}`).join("<br>");
    html += `<div class="cal-cell ct ${cls} ${ds === today ? "today" : ""} ${ds.startsWith(anchor) ? "" : "outside"}" data-day="${ds}">
      <div class="d">${Number(ds.slice(8))}</div>
      ${list.length ? `
        ${withPnl.length ? `<div class="r">${usd(sum, { sign: true })}</div>` : ""}
        <div class="cnt">${tOf(list.length)}</div>
        <div class="ctnames">${brief}</div>` : ""}
    </div>`;
  }
  root.querySelector("#ct-cal").innerHTML = html + `</div>`;
  root.querySelectorAll("#ct-cal .cal-cell").forEach((c) => {
    const list = byDay[c.dataset.day];
    if (list?.length) c.onclick = () => openDayTrades(c.dataset.day, list);
  });
}

// ---------- Список сделок дня ----------
function openDayTrades(dayStr, list) {
  const modal = openModal(`
    <h2>Сделки по чек-листам · ${fmtDay(dayStr)}</h2>
    <div class="ctlist">
      ${list.map((t) => {
        const pnl = t.result_pnl != null ? Number(t.result_pnl) : null;
        return `<button class="ctrow" data-id="${t.id}">
          <div style="flex:1;min-width:0;text-align:left">
            <div class="t">${esc(t.checklist_name)}</div>
            <div class="muted small">${fmtDT(t.created_at)} · заполнено на <span class="num">${fmtRu(Number(t.pct), 0)}%</span> (порог ${fmtRu(Number(t.threshold_pct), 0)}%)</div>
          </div>
          ${pnl != null
            ? `<b class="num ${pnl > 0 ? "green" : pnl < 0 ? "red" : ""}">${usd(pnl, { sign: true })}</b>`
            : `<span class="tag yellow">без результата</span>`}
        </button>`;
      }).join("")}
    </div>`);
  modal.el.querySelectorAll(".ctrow").forEach((b) => b.onclick = async () => {
    modal.close();
    openTradeView(Number(b.dataset.id));
  });
}

// ---------- Новая сделка ----------
async function openNewTrade() {
  let lists;
  try { lists = await loadChecklists(); } catch (e) { return notify("Ошибка: " + e.message, "error"); }
  lists = lists.filter((l) => l.items.length);
  if (!lists.length) return notify("Сначала создай чек-лист с пунктами", "error");
  if (lists.length === 1) return openTradeFill(lists[0]);
  const modal = openModal(`
    <h2>По какому чек-листу сделка?</h2>
    <div class="ctlist">
      ${lists.map((l) => `<button class="ctrow" data-id="${l.id}">
        <div style="flex:1;text-align:left"><div class="t">${esc(l.name)}</div>
        <div class="muted small">${l.items.length} пунктов · порог ${fmtRu(Number(l.threshold_pct), 0)}%</div></div>
      </button>`).join("")}
    </div>`);
  modal.el.querySelectorAll(".ctrow").forEach((b) => b.onclick = () => {
    modal.close();
    openTradeFill(lists.find((l) => l.id === Number(b.dataset.id)));
  });
}

function openTradeFill(list) {
  // ответы и файлы живут в памяти до «Сохранить сделку»
  let answers = list.items.map((it) => ({
    title: it.title, note: it.note ?? "", weight: it.weight,
    screenshot_mode: it.screenshot_mode ?? "none", answer: null, files: [],
  }));

  const modal = openModal(`
    <h2>Сделка · ${esc(list.name)}</h2>
    <div id="tf-rows"></div>
    <div class="clprogress" style="border:none;padding:14px 2px 4px"><div class="top">
      <div><div class="lbl">Выполнение</div>
        <div class="row" style="gap:10px;align-items:baseline"><span class="score num" id="tf-score"></span></div></div>
      <div class="pct num" id="tf-pct"></div></div>
      <div class="track"><div class="mark" style="left:${Math.min(Math.max(Number(list.threshold_pct), 0), 100)}%"></div>
        <div class="fill idle" id="tf-fill" style="width:0%"></div></div></div>
    <div class="clverdict" id="tf-verdict" style="margin:12px 0 0"></div>
    <div class="ce-footer">
      <span class="muted small" id="tf-hint"></span>
      <div class="row" style="gap:8px">
        <button class="btn ghost" id="tf-cancel" type="button">Отмена</button>
        <button class="btn primary" id="tf-save" type="button">Сохранить сделку</button>
      </div>
    </div>`, { wide: true });

  const rowsEl = modal.el.querySelector("#tf-rows");

  const missingShots = () => answers.filter((a) => a.screenshot_mode === "required" && a.answer === "y" && !a.files.length);

  const update = () => {
    const total = answers.reduce((s, a) => s + PTS[a.weight], 0);
    const got = answers.reduce((s, a) => s + (a.answer === "y" ? PTS[a.weight] : 0), 0);
    const pct = total ? Math.round(got / total * 100) : 0;
    const answered = answers.some((a) => a.answer);
    const allowed = pct >= Number(list.threshold_pct);
    const missing = missingShots();
    modal.el.querySelector("#tf-score").textContent = `${got} из ${total} баллов`;
    const pctEl = modal.el.querySelector("#tf-pct");
    pctEl.textContent = `${pct}%`;
    pctEl.className = `pct num ${!answered ? "" : allowed ? "green" : "red"}`;
    const fill = modal.el.querySelector("#tf-fill");
    fill.style.width = Math.min(pct, 100) + "%";
    fill.className = `fill ${!answered ? "idle" : allowed ? "green" : "red"}`;
    const v = modal.el.querySelector("#tf-verdict");
    v.className = `clverdict ${!answered ? "" : allowed ? "ok" : "no"}`;
    v.innerHTML = `<div style="flex:1;min-width:0">
        <div class="vtitle small">${!answered ? "Отметь выполненные условия" : allowed ? "✅ ВХОД РАЗРЕШЁН — можно сохранять" : "⛔ ВХОДА НЕТ — сделку сохранить нельзя"}</div>
      </div><div class="vmath num">${pct}% ${allowed ? "≥" : "<"} ${fmtRu(Number(list.threshold_pct), 0)}%</div>`;
    const save = modal.el.querySelector("#tf-save");
    save.disabled = !answered || !allowed || missing.length > 0;
    modal.el.querySelector("#tf-hint").textContent = missing.length
      ? `⚠ Приложи обязательные скриншоты: «${missing[0].title.slice(0, 40)}»${missing.length > 1 ? ` и ещё ${missing.length - 1}` : ""}`
      : (!allowed && answered ? "Процент ниже порога — по правилам в сделку не входим." : "");
  };

  const draw = () => {
    rowsEl.innerHTML = answers.map((a, i) => `
      <div class="clitem ${a.answer === "y" ? "y" : a.answer === "n" ? "n" : ""}" style="margin-bottom:6px">
        <div class="yn">
          <button class="ynb yes ${a.answer === "y" ? "on" : ""}" data-i="${i}" data-v="y" type="button">${IC.yes}</button>
          <button class="ynb no ${a.answer === "n" ? "on" : ""}" data-i="${i}" data-v="n" type="button">${IC.no}</button>
        </div>
        <div style="flex:1;min-width:0">
          <div class="t">${esc(a.title)}</div>
          ${a.note ? `<div class="hint">${esc(a.note)}</div>` : ""}
          ${a.screenshot_mode !== "none" ? `
            <div class="row" style="gap:8px;margin-top:8px">
              <button class="btn small ghost tf-attach" data-i="${i}" type="button">${IC.clip} Скриншот${a.screenshot_mode === "required" ? ' <span class="tag red">обязателен при «да»</span>' : ""}</button>
              ${a.files.map((f, k) => `<span class="tag green">📷 ${esc(f.name.length > 18 ? f.name.slice(0, 15) + "…" : f.name)}
                <a class="tf-rmfile" data-i="${i}" data-k="${k}" style="cursor:pointer;margin-left:4px">✕</a></span>`).join("")}
            </div>` : ""}
        </div>
        <span class="wtag ${WEIGHT_TAG[a.weight]}">${WEIGHT_LABEL[a.weight]}</span>
      </div>`).join("");

    rowsEl.querySelectorAll(".ynb").forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.i), v = b.dataset.v;
      answers = answers.map((a, k) => k === i ? { ...a, answer: a.answer === v ? null : v } : a);
      draw();
    });
    rowsEl.querySelectorAll(".tf-attach").forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.i);
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/png,image/jpeg,image/webp";
      inp.multiple = true;
      inp.onchange = () => {
        answers = answers.map((a, k) => k === i ? { ...a, files: [...a.files, ...inp.files] } : a);
        draw();
      };
      inp.click();
    });
    rowsEl.querySelectorAll(".tf-rmfile").forEach((el) => el.onclick = () => {
      const i = Number(el.dataset.i), k = Number(el.dataset.k);
      answers = answers.map((a, ai) => ai === i ? { ...a, files: a.files.filter((_, fk) => fk !== k) } : a);
      draw();
    });
    update();
  };
  draw();

  modal.el.querySelector("#tf-cancel").onclick = modal.close;
  modal.el.querySelector("#tf-save").onclick = async () => {
    const btn = modal.el.querySelector("#tf-save");
    btn.disabled = true;
    btn.textContent = "Сохраняю…";
    try {
      const total = answers.reduce((s, a) => s + PTS[a.weight], 0);
      const got = answers.reduce((s, a) => s + (a.answer === "y" ? PTS[a.weight] : 0), 0);
      const pct = total ? Math.round(got / total * 100) : 0;
      const { trade, answers: saved } = await createChecklistTrade({
        day: todayLocal(), checklist_id: list.id, checklist_name: list.name,
        threshold_pct: Number(list.threshold_pct), pct,
      }, answers);
      // скриншоты пунктов — после создания (нужны id ответов)
      for (let i = 0; i < answers.length; i++) {
        for (const f of answers[i].files) {
          await uploadChecklistShot(trade.id, saved[i]?.id ?? null, f);
        }
      }
      notify("✓ Сделка сохранена — результат можно добавить позже из календаря");
      modal.close();
      renderCal();
    } catch (e) {
      notify("Ошибка: " + e.message, "error", 6000);
      btn.disabled = false;
      btn.textContent = "Сохранить сделку";
    }
  };
}

// ---------- Просмотр сделки + результат ----------
async function openTradeView(id) {
  let data;
  try { data = await loadChecklistTradeFull(id); } catch (e) { return notify("Ошибка: " + e.message, "error"); }
  const { trade, answers, shots } = data;
  const byAnswer = {};
  const resultShots = [];
  for (const s of shots) (s.answer_id ? (byAnswer[s.answer_id] ??= []) : resultShots).push(s);
  let resultFiles = [];

  const modal = openModal(`
    <h2>${esc(trade.checklist_name)} · ${fmtDay(trade.day)}</h2>
    <div class="row" style="gap:8px;margin-bottom:14px">
      <span class="clbadge accent num">заполнено на ${fmtRu(Number(trade.pct), 0)}%</span>
      <span class="clbadge num">порог ${fmtRu(Number(trade.threshold_pct), 0)}%</span>
      <span class="clbadge">${fmtDT(trade.created_at)}</span>
      <span style="flex:1"></span>
      <button class="btn ghost danger" id="tv-del">${IC.x} Удалить сделку</button>
    </div>
    <div>
      ${answers.map((a) => `
        <div class="clitem ${a.answer === "y" ? "y" : a.answer === "n" ? "n" : ""}" style="margin-bottom:6px">
          <div class="yn"><span class="ynb ${a.answer === "y" ? "yes on" : a.answer === "n" ? "no on" : ""}" style="cursor:default">
            ${a.answer === "y" ? IC.yes : a.answer === "n" ? IC.no : "—"}</span></div>
          <div style="flex:1;min-width:0">
            <div class="t">${esc(a.title)}</div>
            ${(byAnswer[a.id] ?? []).length ? `<div class="row" style="gap:8px;margin-top:8px">
              ${byAnswer[a.id].map((s) => `<span class="att zoom" data-url="${esc(s.url ?? "")}"><img src="${esc(s.url ?? "")}" alt="скрин"></span>`).join("")}
            </div>` : ""}
          </div>
          <span class="wtag ${WEIGHT_TAG[a.weight]}">${WEIGHT_LABEL[a.weight]}</span>
        </div>`).join("")}
    </div>
    <h3 style="margin-top:18px">Результат сделки</h3>
    <div class="ce-form">
      <div class="row" style="gap:12px;align-items:flex-start">
        <label style="width:150px;flex:0 0 auto">Результат, $
          <input id="tv-pnl" type="number" step="0.01" value="${trade.result_pnl ?? ""}" placeholder="+0.00"></label>
        <label style="flex:1;min-width:200px">Вывод по сделке
          <textarea id="tv-text" rows="2" placeholder="Что получилось, что нарушил, что улучшить…">${esc(trade.result_text ?? "")}</textarea></label>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn small ghost" id="tv-attach" type="button">${IC.clip} Скриншот результата</button>
        <span id="tv-files" class="row" style="gap:8px"></span>
        ${resultShots.map((s) => `<span class="att zoom" data-url="${esc(s.url ?? "")}"><img src="${esc(s.url ?? "")}" alt="скрин"></span>`).join("")}
      </div>
      <div class="ce-footer"><span></span>
        <button class="btn primary" id="tv-save" type="button">Сохранить результат</button></div>
    </div>`, { wide: true });

  // клик по скриншоту — крупный просмотр поверх модалки
  modal.el.querySelectorAll(".att.zoom").forEach((el) => el.onclick = () => openLightbox(el.dataset.url));

  modal.el.querySelector("#tv-attach").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/png,image/jpeg,image/webp";
    inp.multiple = true;
    inp.onchange = () => {
      resultFiles = [...resultFiles, ...inp.files];
      modal.el.querySelector("#tv-files").innerHTML = resultFiles
        .map((f) => `<span class="tag green">📷 ${esc(f.name.length > 18 ? f.name.slice(0, 15) + "…" : f.name)}</span>`).join("");
    };
    inp.click();
  };
  modal.el.querySelector("#tv-save").onclick = async () => {
    const btn = modal.el.querySelector("#tv-save");
    btn.disabled = true;
    try {
      const raw = modal.el.querySelector("#tv-pnl").value.trim().replace(",", ".");
      await saveChecklistTradeResult(trade.id, {
        result_pnl: raw === "" ? null : Number(raw),
        result_text: modal.el.querySelector("#tv-text").value.trim() || null,
      });
      for (const f of resultFiles) await uploadChecklistShot(trade.id, null, f);
      notify("✓ Результат сохранён");
      modal.close();
      renderCal();
    } catch (e) {
      notify("Ошибка: " + e.message, "error", 6000);
      btn.disabled = false;
    }
  };
  modal.el.querySelector("#tv-del").onclick = async () => {
    if (!(await confirmToast("Удалить сделку вместе со скриншотами?"))) return;
    try {
      await deleteChecklistTrade(trade.id);
      notify("Сделка удалена");
      modal.close();
      renderCal();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };
}
