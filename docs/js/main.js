// Точка входа: авторизация и переключение вкладок
import { getSession, signIn, signOut } from "./supa.js";
import { loadSettings } from "./api.js";
import { initDiary } from "./diary.js";
import { initVault } from "./vault.js";
import { initAnalytics } from "./analytics.js";
import { initWaves } from "./waves.js";
import { initChecklist } from "./checklist.js";
import { initSettings } from "./settings.js";
import { esc } from "./util.js";

const app = document.getElementById("app");

async function boot() {
  const session = await getSession();
  if (!session) return renderLogin();
  try {
    await loadSettings();
  } catch (e) {
    app.innerHTML = `<div class="warn" style="margin:40px">Не удалось загрузить настройки: ${esc(e.message)}</div>`;
    return;
  }
  renderShell();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <div class="logo">Ж</div>
      <h1>Торговый дневник</h1>
      <form id="lf">
        <input id="lf-email" type="email" placeholder="E-mail" required autocomplete="username">
        <input id="lf-pass" type="password" placeholder="Пароль" required autocomplete="current-password">
        <button class="btn primary" type="submit">Войти</button>
        <div id="lf-err"></div>
      </form>
    </div>`;
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await signIn(document.getElementById("lf-email").value, document.getElementById("lf-pass").value);
      boot();
    } catch (err) {
      document.getElementById("lf-err").textContent = "Не получилось войти: " + err.message;
    }
  };
}

// Иконки сайдбара — линейные SVG-глифы из дизайн-системы (21×21, stroke 1.7, currentColor)
const ic = (paths) =>
  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  diary: ic('<path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11"/><path d="M6.5 3.5A2.5 2.5 0 0 0 4 6v12a2.5 2.5 0 0 0 2.5 2.5"/><path d="M9 8h7M9 12h7M9 16h4"/>'),
  vault: ic('<path d="M4 9.5C4 8 5.2 6.8 6.7 6.8h10.6C18.8 6.8 20 8 20 9.5v7.7c0 1.5-1.2 2.7-2.7 2.7H6.7C5.2 19.9 4 18.7 4 17.2Z"/><path d="M8 6.8 9.6 4h4.8L16 6.8"/><path d="M15.8 13.4h1.6"/>'),
  analytics: ic('<path d="M4 20V10M9.3 20V4M14.7 20v-7M20 20V7"/>'),
  waves: ic('<path d="M12 3.5c-2.2 0-4 1.7-4 3.9 0 1.4.7 2.4 1.4 3.2.6.7 1 1.3 1 2.2h3.2c0-.9.4-1.5 1-2.2.7-.8 1.4-1.8 1.4-3.2 0-2.2-1.8-3.9-4-3.9Z"/><path d="M10.4 16h3.2M11 19h2"/>'),
  checklist: ic('<path d="M9 4.5H7.2A2.2 2.2 0 0 0 5 6.7v11.6a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V6.7a2.2 2.2 0 0 0-2.2-2.2H15"/><path d="M9 3.6h6v2.6H9Z"/><path d="m8.6 12.2 2 2 4.4-4.4"/><path d="M9 17.4h6"/>'),
  settings: ic('<path d="M4 7.5h4M12.5 7.5H20M4 16.5h7.5M16 16.5h4"/><circle cx="10" cy="7.5" r="2.3"/><circle cx="14" cy="16.5" r="2.3"/>'),
  logout: ic('<path d="M12 3.5v8"/><path d="M6.6 6.3a7.5 7.5 0 1 0 10.8 0"/>'),
};

const TABS = [
  { id: "diary", label: "Дневник", icon: ICONS.diary, init: initDiary },
  { id: "vault", label: "Кубышка", icon: ICONS.vault, init: initVault },
  { id: "analytics", label: "Аналитика монет", icon: ICONS.analytics, init: initAnalytics },
  { id: "waves", label: "Волны — памятка", icon: ICONS.waves, init: initWaves },
  { id: "checklist", label: "Чек-лист", icon: ICONS.checklist, init: initChecklist },
  { id: "settings", label: "Настройки", icon: ICONS.settings, init: initSettings },
];
function renderShell() {
  app.innerHTML = `
    <div class="layout">
      <nav class="side">
        <div class="logo">Ж</div>
        ${TABS.map((t) => `<button class="tab" data-t="${t.id}" title="${t.label}">${t.icon}</button>`).join("")}
        <div class="spacer"></div>
        <button id="logout" class="side-btn" title="Выйти">${ICONS.logout}</button>
      </nav>
      <div class="content">
        ${TABS.map((t) => `<main id="tab-${t.id}" class="tabpane" hidden></main>`).join("")}
      </div>
    </div>`;
  document.getElementById("logout").onclick = signOut;
  document.querySelectorAll(".side .tab").forEach((b) => b.onclick = () => showTab(b.dataset.t));
  showTab("diary");
}

function showTab(id) {
  document.querySelectorAll(".side .tab").forEach((b) => b.classList.toggle("on", b.dataset.t === id));
  for (const t of TABS) {
    const pane = document.getElementById("tab-" + t.id);
    pane.hidden = t.id !== id;
    // перерисовываем при каждом открытии — цифры всех вкладок всегда из свежих данных
    if (t.id === id) t.init(pane);
  }
}

boot();
