// Калькулятор позиции (вкладка «Чек-лист»).
// Ввод: депозит, плечо, целевые % убытка и прибыли ОТ ТЕЛА ДЕПОЗИТА.
// Вывод: объём входа (депозит × плечо) и требуемый ход цены в % до стопа и до цели.
// Считаем маржу равной всему депозиту; комиссии и фандинг не учитываются.
import { esc, fmtRu, openModal } from "./util.js";

const KEY = "clcalc";
const DEFAULTS = { depo: 100, lev: 10, loss: 3, profit: 6 };

const loadSaved = () => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; }
  catch { return { ...DEFAULTS }; }
};

const num = (el) => {
  const v = Number(String(el.value).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const money = (v) => `$${fmtRu(v, v >= 1000 ? 0 : 2)}`;

export function openCalc() {
  const st = loadSaved();
  const modal = openModal(`
    <h2>Калькулятор позиции</h2>
    <p class="muted small" style="margin:4px 0 0">Убыток и прибыль задаются в процентах от реального тела депозита.
    Вход считается всем депозитом с выбранным плечом.</p>
    <div class="calc">
      <div class="calc-in">
        <label>Депозит, $
          <input id="cc-depo" type="number" min="0" step="10" inputmode="decimal" value="${esc(st.depo)}"></label>
        <label>Плечо, ×
          <input id="cc-lev" type="number" min="1" max="200" step="1" inputmode="decimal" value="${esc(st.lev)}"></label>
        <label>Допустимый убыток, % от депозита
          <input id="cc-loss" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${esc(st.loss)}"></label>
        <label>Целевая прибыль, % от депозита
          <input id="cc-profit" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(st.profit)}"></label>
      </div>
      <div class="calc-out" id="cc-out"></div>
    </div>`, { wide: true });

  const out = modal.el.querySelector("#cc-out");
  const fields = ["depo", "lev", "loss", "profit"];

  const recalc = () => {
    const v = Object.fromEntries(fields.map((k) => [k, num(modal.el.querySelector(`#cc-${k}`))]));
    localStorage.setItem(KEY, JSON.stringify(v));

    if (!v.depo || !v.lev) {
      out.innerHTML = `<div class="muted" style="padding:8px 2px">Укажи депозит и плечо — посчитаю объём входа и ход цены.</div>`;
      return;
    }
    const pos = v.depo * v.lev;                 // объём позиции
    const lossUsd = v.depo * v.loss / 100;
    const profitUsd = v.depo * v.profit / 100;
    const stopMove = v.loss / v.lev;            // ход цены против, %
    const tpMove = v.profit / v.lev;            // ход цены к цели, %
    const liqMove = 100 / v.lev;                // ориентировочная ликвидация
    const rr = v.loss > 0 && v.profit > 0 ? v.profit / v.loss : null;

    out.innerHTML = `
      <div class="calc-main">
        <div class="lbl">Сумма входа (объём позиции)</div>
        <div class="big num">${money(pos)}</div>
        <div class="muted small num">маржа ${money(v.depo)} × плечо ${fmtRu(v.lev, v.lev % 1 ? 1 : 0)}×</div>
      </div>
      ${v.loss ? `
      <div class="calc-row neg">
        <div>
          <div class="t">Стоп-лосс</div>
          <div class="sub">ход цены против позиции</div>
        </div>
        <div class="nums">
          <div class="move num">−${fmtRu(stopMove, 2)}%</div>
          <div class="usd num">убыток −${money(lossUsd)}</div>
        </div>
      </div>` : ""}
      ${v.profit ? `
      <div class="calc-row pos">
        <div>
          <div class="t">Тейк-профит</div>
          <div class="sub">ход цены в сторону сделки</div>
        </div>
        <div class="nums">
          <div class="move num">+${fmtRu(tpMove, 2)}%</div>
          <div class="usd num">прибыль +${money(profitUsd)}</div>
        </div>
      </div>` : ""}
      <div class="calc-foot">
        ${rr ? `<span class="num">R:R ≈ 1 : ${fmtRu(rr, rr % 1 ? 1 : 0)}</span>` : ""}
        <span class="muted num">ликвидация ≈ при ходе −${fmtRu(liqMove, 2)}% (без учёта поддерживающей маржи)</span>
        <span class="muted">комиссии и фандинг не учтены</span>
      </div>`;
  };

  fields.forEach((k) => modal.el.querySelector(`#cc-${k}`).oninput = recalc);
  recalc();
}
