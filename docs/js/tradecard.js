// Подробная карточка сделки (ТЗ 5.7): исполнения + редактируемые поля
import {
  loadExecutionsWindow, saveTradeNote, uploadAttachment, loadAttachments, deleteAttachment,
} from "./api.js";
import { esc, usd, price, fmtRu, fmtDT, sortableTable, notify, confirmToast } from "./util.js";

export async function renderTradeCard(holder, trade, strategies) {
  const note = trade.trade_notes ?? {};
  holder.innerHTML = `
    <div class="grid2">
      <div>
        <h3>Исполнения</h3>
        <div class="muted small">Частичные входы и выходы — отдельными строками. ID Bybit: ${esc(trade.id)}</div>
        <div class="execs tblwrap"><div class="muted">Загружаю…</div></div>
      </div>
      <div>
        <h3>Мои заметки</h3>
        <label>Комментарий<br><textarea class="n-comment" rows="3" placeholder="Почему вошёл, что увидел...">${esc(note.comment ?? "")}</textarea></label>
        <label>Состояние (теги через запятую)<br>
          <input class="n-tags" placeholder="спокойствие, FOMO, усталость" value="${esc((note.state_tags ?? []).join(", "))}"></label>
        <label>Стратегия<br><select class="n-strat">
          <option value="">—</option>
          ${strategies.filter((s) => !s.archived || s.id === note.strategy_id).map((s) =>
            `<option value="${s.id}" ${s.id === note.strategy_id ? "selected" : ""}>${esc(s.name)}${s.archived ? " (архив)" : ""}</option>`).join("")}
        </select></label>
        <button class="btn primary n-save">Сохранить заметки</button>
        <span class="n-saved muted small"></span>
        <h3>Скриншоты</h3>
        <div class="atts"></div>
        <label class="btn small">+ Добавить (PNG/JPG/WebP, до 10 МБ)
          <input type="file" class="n-file" accept="image/png,image/jpeg,image/webp" hidden multiple></label>
      </div>
    </div>`;

  // Исполнения: окно от входа до выхода с запасом
  try {
    const anchor = trade.closed_at ?? trade.opened_at ?? new Date().toISOString();
    const from = new Date(new Date(trade.opened_at ?? anchor).getTime() - 3600_000).toISOString();
    const to = new Date(new Date(anchor).getTime() + 3600_000).toISOString();
    const execs = await loadExecutionsWindow(trade.symbol, from, to);
    sortableTable(holder.querySelector(".execs"), [
      { key: "t", label: "Время", type: "str", get: (e) => e.exec_time, render: (e) => fmtDT(e.exec_time) },
      { key: "side", label: "Сторона", type: "str", get: (e) => e.side,
        render: (e) => `<span class="${e.side === "Buy" ? "green" : "red"}">${e.side === "Buy" ? "Покупка" : "Продажа"}</span>` },
      { key: "type", label: "Тип ордера", type: "str", get: (e) => e.order_type ?? "—" },
      { key: "price", label: "Цена", type: "num", get: (e) => e.price, render: (e) => price(e.price) },
      { key: "qty", label: "Кол-во", type: "num", get: (e) => e.qty, render: (e) => fmtRu(e.qty, 4) },
      { key: "fee", label: "Комиссия", type: "num", get: (e) => e.fee, render: (e) => e.fee != null ? usd(e.fee) : "—" },
      { key: "mk", label: "Maker/Taker", type: "str", get: (e) => e.is_maker,
        render: (e) => e.is_maker == null ? "—" : e.is_maker ? "maker" : "taker" },
    ], execs, { emptyText: "Исполнения не найдены (могли не загрузиться при синке)" });
  } catch (e) {
    holder.querySelector(".execs").innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  }

  // Сохранение заметок
  holder.querySelector(".n-save").onclick = async () => {
    try {
      await saveTradeNote(trade.id, {
        comment: holder.querySelector(".n-comment").value.trim() || null,
        state_tags: holder.querySelector(".n-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
        strategy_id: holder.querySelector(".n-strat").value ? Number(holder.querySelector(".n-strat").value) : null,
      });
      holder.querySelector(".n-saved").textContent = "✓ сохранено " + fmtDT(new Date().toISOString());
    } catch (e) { notify("Не сохранилось: " + e.message, "error", 6000); }
  };

  // Скриншоты
  const renderAtts = async () => {
    const box = holder.querySelector(".atts");
    const atts = await loadAttachments(trade.id);
    box.innerHTML = atts.length ? atts.map((a) => `
      <div class="att">
        <a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name ?? "скриншот")}"></a>
        <div class="row small"><a href="${esc(a.url)}" download>${esc(a.name ?? "файл")}</a>
        <button class="btn small att-del" data-id="${a.id}">Удалить</button></div>
      </div>`).join("") : `<div class="muted small">Нет скриншотов</div>`;
    box.querySelectorAll(".att-del").forEach((b) => b.onclick = async () => {
      if (!(await confirmToast("Удалить скриншот? Действие необратимо."))) return;
      await deleteAttachment(atts.find((a) => a.id === b.dataset.id));
      renderAtts();
    });
  };
  renderAtts();
  holder.querySelector(".n-file").onchange = async (e) => {
    for (const f of e.target.files) {
      try { await uploadAttachment(trade.id, f); } catch (err) { notify(`${f.name}: ${err.message}`, "error", 6000); }
    }
    e.target.value = "";
    renderAtts();
  };
}
