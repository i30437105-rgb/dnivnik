// Точка входа: авторизация и переключение вкладок
import { getSession, signIn, signOut } from "./supa.js";
import { loadSettings } from "./api.js";
import { initDiary } from "./diary.js";
import { initVault } from "./vault.js";
import { initAnalytics } from "./analytics.js";
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

const TABS = [
  { id: "diary", label: "Дневник", icon: "📓", init: initDiary },
  { id: "vault", label: "Кубышка", icon: "💰", init: initVault },
  { id: "analytics", label: "Аналитика монет", icon: "📊", init: initAnalytics },
  { id: "settings", label: "Настройки", icon: "⚙️", init: initSettings },
];
function renderShell() {
  app.innerHTML = `
    <div class="layout">
      <nav class="side">
        <div class="logo">Ж</div>
        ${TABS.map((t) => `<button class="tab" data-t="${t.id}" title="${t.label}">${t.icon}</button>`).join("")}
        <div class="spacer"></div>
        <button id="logout" class="side-btn" title="Выйти">⏻</button>
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
