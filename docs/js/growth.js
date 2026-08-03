// Калькулятор прироста депозита со сложным процентом и кубышкой (вкладка модалки «Калькулятор»).
// Механика (утверждена Иваном): прирост месяца = тело × %/мес; из прироста заданный %
// уходит в кубышку; следующий месяц растёт от тела УЖЕ без отчислений; кубышка просто копится.
import { esc, fmtRu } from "./util.js";
import { num, money } from "./calc.js";

const KEY = "clgrowth";
const DEFAULTS = { start: 100, growth: 20, vault: 50, months: 12 };
const MAX_MONTHS = 120;

const loadSaved = () => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; }
  catch { return { ...DEFAULTS }; }
};

const mOf = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "месяц" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "месяца" : "месяцев")}`;

export function renderGrowth(root) {
  const st = loadSaved();
  root.innerHTML = `
    <p class="muted small" style="margin:8px 0 0">Каждый месяц тело растёт на заданный процент, часть прироста
    уходит в кубышку. Следующий месяц считается уже от тела без отчислений — кубышка копится отдельно.</p>
    <div class="calc">
      <div class="calc-in">
        <div class="calc-fields">
          <label>Начальное тело депозита, $
            <input id="cg-start" type="number" min="0" step="10" inputmode="decimal" value="${esc(st.start)}"></label>
          <label>Прирост в месяц, %
            <input id="cg-growth" type="number" min="0" step="1" inputmode="decimal" value="${esc(st.growth)}"></label>
          <label>В кубышку от прироста, %
            <input id="cg-vault" type="number" min="0" max="100" step="5" inputmode="decimal" value="${esc(st.vault)}"></label>
          <label>Период, месяцев
            <input id="cg-months" type="number" min="1" max="${MAX_MONTHS}" step="1" inputmode="numeric" value="${esc(st.months)}"></label>
        </div>
      </div>
      <div class="calc-out" id="cg-out"></div>
    </div>
    <div id="cg-table" class="tblwrap" style="margin-top:14px"></div>`;

  const out = root.querySelector("#cg-out");
  const tbl = root.querySelector("#cg-table");
  const fields = ["start", "growth", "vault", "months"];

  const recalc = () => {
    const v = Object.fromEntries(fields.map((k) => [k, num(root.querySelector(`#cg-${k}`))]));
    localStorage.setItem(KEY, JSON.stringify(v));
    const months = Math.min(Math.floor(v.months), MAX_MONTHS);
    if (!v.start || !v.growth || !months) {
      out.innerHTML = `<div class="muted" style="padding:8px 2px">Укажи тело депозита, процент прироста и период.</div>`;
      tbl.innerHTML = "";
      return;
    }
    const vaultPct = Math.min(v.vault, 100);
    let depo = v.start, vault = 0;
    const rows = [];
    for (let m = 1; m <= months; m++) {
      const startDepo = depo;
      const gain = depo * v.growth / 100;
      const toVault = gain * vaultPct / 100;
      depo += gain - toVault;
      vault += toVault;
      rows.push({ m, startDepo, gain, toVault, depo, vault });
    }
    const total = depo + vault;
    const growthX = total / v.start;

    out.innerHTML = `
      <div class="calc-main">
        <div class="lbl">Депозит через ${mOf(months)}</div>
        <div class="big num">${money(depo)}</div>
        <div class="muted small num">без учёта кубышки · старт ${money(v.start)}</div>
      </div>
      <div class="calc-row pos">
        <div>
          <div class="t">Кубышка за период</div>
          <div class="sub">${fmtRu(vaultPct, 0)}% от прироста каждого месяца</div>
        </div>
        <div class="nums"><div class="move num">${money(vault)}</div></div>
      </div>
      <div class="calc-foot">
        <span class="num">Всего (депозит + кубышка): <b>${money(total)}</b></span>
        <span class="muted num">рост капитала ×${fmtRu(growthX, growthX >= 100 ? 0 : 1)} за период · +${money(total - v.start)}</span>
        <span class="muted">результат идеализирован: ровный процент каждый месяц, без просадок</span>
      </div>`;

    tbl.innerHTML = `
      <table class="tbl mini cg-tbl">
        <thead><tr><th>Мес.</th><th>Тело на старте</th><th>Прирост</th><th>В кубышку</th><th>Тело на конец</th><th>Кубышка всего</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr><td class="num">${r.m}</td>
          <td class="num">${money(r.startDepo)}</td>
          <td class="num green">+${money(r.gain)}</td>
          <td class="num">${r.toVault > 0 ? money(r.toVault) : "—"}</td>
          <td class="num"><b>${money(r.depo)}</b></td>
          <td class="num">${money(r.vault)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  };

  fields.forEach((k) => root.querySelector(`#cg-${k}`).oninput = recalc);
  recalc();
}
