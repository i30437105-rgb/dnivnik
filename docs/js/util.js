// Форматирование и общие помощники. Все даты показываются в поясе пользователя (state.tz).

export const state = {
  tz: "Europe/Moscow",
  settings: null,
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Числа ----------

// Большие суммы сокращаются ($5,2 млн), точное значение — в подсказке (ТЗ §3)
export function usd(v, { sign = false } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const s = n < 0 ? "−" : (sign && n > 0 ? "+" : "");
  let short;
  if (abs >= 1e9) short = `${s}$${fmtRu(abs / 1e9, 2)} млрд`;
  else if (abs >= 1e6) short = `${s}$${fmtRu(abs / 1e6, 2)} млн`;
  else if (abs >= 1e5) short = `${s}$${fmtRu(abs / 1e3, 0)} тыс.`;
  else short = `${s}$${fmtRu(abs, 2)}`;
  const exact = `${n < 0 ? "−" : ""}$${fmtRu(abs, abs < 1 ? 6 : 2)}`;
  return `<span title="${exact}">${short}</span>`;
}

export function pct(v, { digits = 2, sign = true } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const s = n < 0 ? "−" : (sign && n > 0 ? "+" : "");
  return `${s}${fmtRu(Math.abs(n), digits)}%`;
}

export function price(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : n >= 0.001 ? 6 : 8;
  return `$${fmtRu(n, digits)}`;
}

export function fmtRu(n, digits) {
  return Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

// ---------- Даты (в поясе пользователя) ----------

export function todayLocal(tz = state.tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function fmtDT(iso, tz = state.tz) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtTime(iso, tz = state.tz) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz, hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtDay(dayStr) {
  const [y, m, d] = String(dayStr).split("-");
  return `${d}.${m}.${y}`;
}

export function fmtDur(ms) {
  if (ms == null || ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} дн ${h % 24} ч`;
}

export function addDays(dayStr, n) {
  const d = new Date(dayStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function hoursMinutes(hoursFloat) {
  const h = Math.floor(hoursFloat);
  const m = Math.round((hoursFloat - h) * 60);
  return `${h} ч ${String(m).padStart(2, "0")} мин`;
}

// ---------- Сортируемая таблица (ТЗ §3) ----------
// columns: [{key, label, type: 'num'|'str', get(row), render(row), sortable=true}]
// opts: {expand(row) -> html, rowKey(row), emptyText}
export function sortableTable(container, columns, rows, opts = {}) {
  const stateSort = container._sort ?? { key: null, dir: 0 }; // dir: 1 asc, -1 desc, 0 none
  container._sort = stateSort;
  const expanded = container._expanded ?? new Set();
  container._expanded = expanded;

  const render = () => {
    let view = [...rows];
    if (stateSort.key && stateSort.dir !== 0) {
      const col = columns.find((c) => c.key === stateSort.key);
      view.sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = col.type === "num" ? va - vb : String(va).localeCompare(String(vb), "ru");
        return cmp * stateSort.dir;
      });
    }
    const arrow = (c) => stateSort.key === c.key
      ? (stateSort.dir === 1 ? " ▲" : stateSort.dir === -1 ? " ▼" : "") : "";
    let html = `<table class="tbl"><thead><tr>` + columns.map((c) =>
      `<th data-key="${c.key}" class="${c.sortable === false ? "" : "sortable"}">${esc(c.label)}${arrow(c)}</th>`
    ).join("") + `</tr></thead><tbody>`;
    if (!view.length) {
      html += `<tr><td colspan="${columns.length}" class="empty">${esc(opts.emptyText ?? "Нет данных")}</td></tr>`;
    }
    for (const row of view) {
      const key = opts.rowKey ? opts.rowKey(row) : "";
      html += `<tr class="row ${opts.expand ? "clickable" : ""}" data-rowkey="${esc(key)}">` +
        columns.map((c) => `<td>${c.render ? c.render(row) : esc(c.get(row))}</td>`).join("") + `</tr>`;
      if (opts.expand && expanded.has(key)) {
        html += `<tr class="expandrow" data-parent="${esc(key)}"><td colspan="${columns.length}">${opts.expand(row)}</td></tr>`;
      }
    }
    html += `</tbody></table>`;
    container.innerHTML = html;

    container.querySelectorAll("th.sortable").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.key;
        if (stateSort.key !== k) { stateSort.key = k; stateSort.dir = 1; }
        else if (stateSort.dir === 1) stateSort.dir = -1;
        else if (stateSort.dir === -1) { stateSort.key = null; stateSort.dir = 0; }
        render();
      };
    });
    if (opts.expand) {
      container.querySelectorAll("tr.row").forEach((tr) => {
        tr.onclick = (e) => {
          if (e.target.closest("a, button, input, textarea, select, label")) return;
          const k = tr.dataset.rowkey;
          expanded.has(k) ? expanded.delete(k) : expanded.add(k);
          render();
          opts.onExpand?.(k, expanded.has(k), container);
        };
      });
    }
    opts.afterRender?.(container);
  };
  render();
}

// ---------- Статусная строка вкладки ----------
export function statusLine(el, { lastOk, error, errorAt, stale }) {
  let html = "";
  if (lastOk) html += `<span class="ok">Данные актуальны на ${fmtDT(lastOk)}</span>`;
  else html += `<span class="muted">Данных ещё нет — нажмите «Обновить»</span>`;
  if (stale) html += ` <span class="warn">⚠ данные устарели</span>`;
  if (error) html += `<div class="warn">⚠ Часть источников не обновилась (${fmtDT(errorAt)}): ${esc(error)}. Показаны последние успешные данные.</div>`;
  el.innerHTML = html;
}

// ---------- Кнопка с блокировкой на время запроса (ТЗ §3) ----------
export function busyButton(btn, fn) {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Обновляю…";
    try { await fn(); } catch (e) { alert("Ошибка: " + e.message); }
    btn.disabled = false;
    btn.textContent = label;
  });
}

// ---------- Модальное окно ----------
export function openModal(html, { wide = false } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal ${wide ? "wide" : ""}">
    <button class="modal-close" title="Закрыть">✕</button>
    <div class="modal-body">${html}</div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector(".modal-close").onclick = close;
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  return { el: back.querySelector(".modal-body"), close };
}
