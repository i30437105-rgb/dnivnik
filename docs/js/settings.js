// Вкладка «Настройки» (ТЗ §2, §12): пояс, цели, лимит, пороги фильтров, стратегии
import { saveSettings, loadStrategies, addStrategy, updateStrategy } from "./api.js";
import { state, esc } from "./util.js";

const TZ_LIST = [
  "Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Asia/Yekaterinburg",
  "Asia/Omsk", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk",
  "Asia/Vladivostok", "Asia/Dubai", "Asia/Bangkok", "UTC",
];

export function initSettings(container) {
  const s = state.settings;
  container.innerHTML = `
    <header class="pagehead"><div class="titles"><h1>Настройки</h1></div></header>
    <div style="max-width:760px">
    <section class="block"><h2>Дневник</h2>
      <div class="form">
        <label>Часовой пояс (границы торгового дня — 00:00 этого пояса)
          <select id="st-tz">${TZ_LIST.map((z) =>
            `<option ${z === s.timezone ? "selected" : ""}>${z}</option>`).join("")}</select>
          <span class="hint">снимок баланса в 00:00 делает сервер автоматически</span></label>
        <label>Цель дня, % от утреннего баланса
          <input id="st-goal" type="number" step="0.1" min="0" value="${s.daily_goal_pct}"></label>
        <label>Лимит дневного убытка
          <span class="row">
            <select id="st-lossmode">
              <option value="pct" ${s.loss_limit_mode === "pct" ? "selected" : ""}>процентом</option>
              <option value="usd" ${s.loss_limit_mode === "usd" ? "selected" : ""}>суммой в $</option>
            </select>
            <input id="st-losspct" type="number" step="0.1" min="0" value="${s.daily_loss_pct}" title="%">
            <input id="st-lossusd" type="number" step="1" min="0" value="${s.daily_loss_usd ?? ""}" placeholder="$" title="$">
          </span>
          <span class="hint">сервис показывает эквивалент в обоих форматах в сводке дня</span></label>
      </div>
    </section>
    <section class="block"><h2>Пороги аналитики</h2>
      <p class="muted">Пороги фильтров (листинги, волатильность, всплеск объёма) настраиваются прямо на вкладке
      «📊 Аналитика монет» — блок «⚙️ Пороги фильтров» над таблицами.</p>
    </section>
    <div class="toolbar"><button id="st-save" class="btn primary">Сохранить настройки</button><span id="st-msg" class="muted"></span></div>
    <section class="block"><h2>Справочник стратегий</h2>
      <div id="st-strats"></div>
      <div class="row"><input id="st-newstrat" placeholder="Название новой стратегии"><button id="st-addstrat" class="btn">Добавить</button></div>
    </section>
    <section class="block" style="background:var(--bg-inset)"><h2 style="font-size:14px;color:var(--text-2)">Подключения</h2>
      <p class="muted small" style="line-height:1.55">Ключ Bybit (только чтение) и ключи CoinGecko / перевода хранятся в секретах сервера
      и не попадают в браузер. Изменить их можно в панели Supabase → Edge Functions → Secrets.</p>
    </section>
    </div>`;

  container.querySelector("#st-save").onclick = async () => {
    const msg = container.querySelector("#st-msg");
    try {
      await saveSettings({
        timezone: container.querySelector("#st-tz").value,
        daily_goal_pct: Number(container.querySelector("#st-goal").value),
        loss_limit_mode: container.querySelector("#st-lossmode").value,
        daily_loss_pct: Number(container.querySelector("#st-losspct").value),
        daily_loss_usd: container.querySelector("#st-lossusd").value === "" ? null : Number(container.querySelector("#st-lossusd").value),
      });
      msg.textContent = "✓ Сохранено. Новые пороги применятся при следующем запуске анализа.";
    } catch (e) { msg.textContent = "Ошибка: " + e.message; }
  };

  const renderStrats = async () => {
    const box = container.querySelector("#st-strats");
    const strats = await loadStrategies(true);
    box.innerHTML = strats.map((st) => `
      <div class="row strat" data-id="${st.id}">
        <input class="s-name" value="${esc(st.name)}" ${st.archived ? "disabled" : ""}>
        <button class="btn small s-rename" ${st.archived ? "disabled" : ""}>Переименовать</button>
        <button class="btn small s-arch">${st.archived ? "Вернуть из архива" : "В архив"}</button>
      </div>`).join("");
    box.querySelectorAll(".strat").forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector(".s-rename").onclick = async () => {
        await updateStrategy(id, { name: row.querySelector(".s-name").value.trim() });
        renderStrats();
      };
      row.querySelector(".s-arch").onclick = async () => {
        const st = strats.find((x) => x.id === id);
        await updateStrategy(id, { archived: !st.archived });
        renderStrats();
      };
    });
  };
  renderStrats();
  container.querySelector("#st-addstrat").onclick = async () => {
    const name = container.querySelector("#st-newstrat").value.trim();
    if (!name) return;
    try { await addStrategy(name); container.querySelector("#st-newstrat").value = ""; renderStrats(); }
    catch (e) { alert(e.message); }
  };
}
