// Точка входа: авторизация и переключение вкладок
import { getSession, signIn, signOut } from "./supa.js";
import { loadSettings } from "./api.js";
import { initDiary } from "./diary.js";
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
      <h1>Торговый дневник</h1>
      <form id="lf">
        <input id="lf-email" type="email" placeholder="E-mail" required autocomplete="username">
        <input id="lf-pass" type="password" placeholder="Пароль" required autocomplete="current-password">
        <button class="btn primary" type="submit">Войти</button>
        <div id="lf-err" class="warn"></div>
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
  { id: "diary", label: "📓 Дневник", init: initDiary },
  { id: "analytics", label: "📊 Аналитика монет", init: initAnalytics },
  { id: "settings", label: "⚙️ Настройки", init: initSettings },
];
const inited = new Set();

function renderShell() {
  app.innerHTML = `
    <header class="top">
      <nav>${TABS.map((t) => `<button class="tab" data-t="${t.id}">${t.label}</button>`).join("")}</nav>
      <button id="logout" class="btn small">Выйти</button>
    </header>
    ${TABS.map((t) => `<main id="tab-${t.id}" class="tabpane" hidden></main>`).join("")}`;
  document.getElementById("logout").onclick = signOut;
  document.querySelectorAll(".tab").forEach((b) => b.onclick = () => showTab(b.dataset.t));
  showTab("diary");
}

function showTab(id) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("primary", b.dataset.t === id));
  for (const t of TABS) {
    const pane = document.getElementById("tab-" + t.id);
    pane.hidden = t.id !== id;
    if (t.id === id && !inited.has(id)) { inited.add(id); t.init(pane); }
  }
}

boot();
