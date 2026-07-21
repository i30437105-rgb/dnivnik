// Вкладка «Кубышка»: неприкосновенный резерв — 50% прибыли каждого плюсового дня (вариант А)
import { loadVault, loadLatestSnapshot, loadDaysRange, saveSettings, runSync } from "./api.js";
import { state, esc, usd, pct, fmtRu, fmtDay, fmtDT, todayLocal, sortableTable, notify, busyButton } from "./util.js";

let root;

export function initVault(container) {
  root = container;
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Кубышка</h1><span class="sub">неприкосновенная часть прибыли</span></div>
      <div class="right">
        <span id="vl-status" class="status"></span>
        <button id="vl-refresh" class="btn">Обновить</button>
      </div>
    </header>
    <div id="vl-body"><div class="loading">Загружаю…</div></div>`;
  busyButton(root.querySelector("#vl-refresh"), async () => { await runSync(); await render(); });
  render().catch((e) => root.querySelector("#vl-body").innerHTML =
    `<div class="warn">Ошибка: ${esc(e.message)}</div>`);
}

const TYPE_LABEL = {
  accrual: "💰 Отложено с прибыли дня",
  withdrawal: "↗ Вывод средств",
  adjust: "✎ Корректировка",
};

async function render() {
  const s = state.settings;
  const startDay = s.vault_start_day ?? todayLocal();
  const today = todayLocal();
  const [ledger, lastSnap, days] = await Promise.all([
    loadVault(), loadLatestSnapshot(), loadDaysRange(startDay, today),
  ]);

  root.querySelector("#vl-status").innerHTML = lastSnap
    ? `<span class="ok num">Данные актуальны на ${fmtDT(lastSnap.ts)}</span>`
    : `<span class="muted">Данных ещё нет</span>`;

  const vault = ledger.reduce((sum, l) => sum + Number(l.amount), 0);
  const accrued = ledger.filter((l) => l.type === "accrual").reduce((sum, l) => sum + Number(l.amount), 0);
  const withdrawn = -ledger.filter((l) => l.type === "withdrawal").reduce((sum, l) => sum + Number(l.amount), 0);
  const equity = lastSnap ? Number(lastSnap.equity) : null;
  const working = equity != null ? Math.max(equity - vault, 0) : null;
  const base = Number(s.vault_base) || days[0]?.start_balance || 0;
  // заработано = сумма дневных результатов с точки отсчёта (потоки уже исключены)
  const earned = days.reduce((sum, d) => {
    const r = d.end_equity != null ? Number(d.end_equity) - Number(d.start_balance) - (Number(d.net_flow) || 0) : 0;
    return sum + r;
  }, 0);

  root.querySelector("#vl-body").innerHTML = `
    ${equity != null && vault > equity ? `<div class="warn">⚠ Кубышка ($${fmtRu(vault, 2)}) больше текущего баланса — рабочий капитал исчерпан, торговлю стоит остановить.</div>` : ""}
    <section style="margin-bottom:26px">
      <div class="cards">
        <div class="card hero pos"><div class="k">Кубышка — можно вывести</div>
          <div class="v green">${usd(vault)}</div>
          <div class="muted small">лежит на счету, но в торговле НЕ участвует</div></div>
        <div class="card"><div class="k">Баланс на счету</div>
          <div class="v">${equity != null ? usd(equity) : "—"}</div>
          <div class="muted small">${lastSnap ? "на " + fmtDT(lastSnap.ts) : ""}</div></div>
        <div class="card"><div class="k">Рабочий капитал</div>
          <div class="v">${working != null ? usd(working) : "—"}</div>
          <div class="muted small">баланс минус кубышка; от него считаются цель дня и лимит убытка</div></div>
        <div class="card"><div class="k">Заработано с ${fmtDay(startDay)}</div>
          <div class="v ${earned > 0 ? "green" : earned < 0 ? "red" : ""}">${usd(earned, { sign: true })} <span class="hint">${base > 0 ? pct(earned / base * 100) : ""}</span></div>
          <div class="muted small">торговый результат, пополнения и выводы не учитываются</div></div>
        <div class="card"><div class="k">Отложено за всё время</div>
          <div class="v">${usd(accrued)}</div>
          <div class="muted small">по ${fmtRu(Number(s.vault_pct), 0)}% с каждого прибыльного дня</div></div>
        <div class="card"><div class="k">Уже выведено</div>
          <div class="v">${usd(withdrawn)}</div>
          <div class="muted small">выводы с биржи списываются из кубышки автоматически</div></div>
      </div>
    </section>
    <section class="block">
      <div class="row spread">
        <h2 style="margin:0">Правило откладывания</h2>
        <div class="row">
          <span class="muted small">Откладывать</span>
          <input id="vl-pct" type="number" min="0" max="100" step="5" value="${Number(s.vault_pct)}" style="width:80px">
          <span class="muted small">% от прибыли каждого плюсового дня</span>
          <button id="vl-save" class="btn small">Сохранить</button>
        </div>
      </div>
      <p class="muted small" style="margin-top:8px">Фиксация происходит автоматически в полночь (${esc(state.tz)}):
      если день закрыт в плюс, ${fmtRu(Number(s.vault_pct), 0)}% результата уходит в кубышку.
      Убыточные дни кубышку не трогают — она неприкосновенная. ${ledger.length === 0 ? "Первая фиксация — сегодня в полночь, если день закроется в плюс." : ""}</p>
    </section>
    <section><h2>История</h2><div id="vl-history" class="tblwrap block" style="padding:0"></div></section>`;

  root.querySelector("#vl-save").onclick = async () => {
    try {
      await saveSettings({ vault_pct: Number(root.querySelector("#vl-pct").value) });
      notify("✓ Процент сохранён — применится со следующей полуночи");
      render();
    } catch (e) { notify("Ошибка: " + e.message, "error"); }
  };

  sortableTable(root.querySelector("#vl-history"), [
    { key: "day", label: "Дата", type: "str", get: (l) => l.day, render: (l) => fmtDay(l.day) },
    { key: "type", label: "Событие", type: "str", get: (l) => l.type,
      render: (l) => TYPE_LABEL[l.type] ?? esc(l.type) },
    { key: "amt", label: "Сумма", type: "num", get: (l) => Number(l.amount),
      render: (l) => `<b class="${l.amount > 0 ? "green" : "red"}">${usd(Number(l.amount), { sign: true })}</b>` },
    { key: "note", label: "Примечание", type: "str",
      get: (l) => l.note ?? "", render: (l) => `<span class="muted small">${esc(l.note?.startsWith("flow:") ? "автосписание по выводу с Bybit" : l.note ?? "")}</span>` },
  ], [...ledger].reverse(), { emptyText: "Пока пусто — кубышка начнёт наполняться с первого прибыльного дня" });
}
