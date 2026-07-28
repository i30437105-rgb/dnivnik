// Калькулятор позиции (вкладка «Чек-лист»).
// Ввод: депозит, % депозита на одну сделку (маржа), плечо, целевые % убытка/прибыли
// ОТ ТЕЛА ДЕПОЗИТА, цена актива (необязательно), направление лонг/шорт.
// Вывод: сумма входа (маржа), объём позиции и кол-во актива, цены и ход до стопа/тейка,
// R:R, ориентировочная ликвидация. Комиссии и фандинг не учитываются.
import { esc, fmtRu, price, openModal } from "./util.js";

const KEY = "clcalc";
const DEFAULTS = { depo: 1000, use: 10, lev: 10, loss: 1, profit: 3, price: "", side: "long" };

const loadSaved = () => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; }
  catch { return { ...DEFAULTS }; }
};

const num = (el) => {
  const v = Number(String(el.value).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const money = (v) => `$${fmtRu(v, v >= 1000 ? 0 : 2)}`;

// Кол-во актива: BTC по $60 000 — 4 знака, дешёвые монеты — крупнее
const qtyFmt = (q) => fmtRu(q, q >= 100 ? 2 : q >= 1 ? 3 : 4);

export function openCalc() {
  const st = loadSaved();
  let side = st.side === "short" ? "short" : "long";

  const modal = openModal(`
    <h2>Калькулятор позиции</h2>
    <p class="muted small" style="margin:4px 0 0">Убыток и прибыль задаются в процентах от реального тела депозита.
    Цена актива нужна только для расчёта конкретных уровней стопа и тейка.</p>
    <div class="calc">
      <div class="calc-in">
        <div class="calc-side" id="cc-side">
          <button type="button" class="cs-btn long ${side === "long" ? "on" : ""}" data-s="long">Лонг ↑</button>
          <button type="button" class="cs-btn short ${side === "short" ? "on" : ""}" data-s="short">Шорт ↓</button>
        </div>
        <div class="calc-fields">
          <label>Депозит, $
            <input id="cc-depo" type="number" min="0" step="10" inputmode="decimal" value="${esc(st.depo)}"></label>
          <label>На одну сделку, % от депозита
            <input id="cc-use" type="number" min="0" max="100" step="1" inputmode="decimal" value="${esc(st.use)}"></label>
          <label>Плечо, ×
            <input id="cc-lev" type="number" min="1" max="200" step="1" inputmode="decimal" value="${esc(st.lev)}"></label>
          <label>Цена актива, $ <span class="opt">необязательно</span>
            <input id="cc-price" type="number" min="0" step="any" inputmode="decimal" placeholder="например 60 000" value="${esc(st.price)}"></label>
          <label>Допустимый убыток, % от депозита
            <input id="cc-loss" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${esc(st.loss)}"></label>
          <label>Целевая прибыль, % от депозита
            <input id="cc-profit" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(st.profit)}"></label>
        </div>
      </div>
      <div class="calc-out" id="cc-out"></div>
    </div>`, { wide: true });

  const out = modal.el.querySelector("#cc-out");
  const fields = ["depo", "use", "lev", "loss", "profit", "price"];

  const recalc = () => {
    const v = Object.fromEntries(fields.map((k) => [k, num(modal.el.querySelector(`#cc-${k}`))]));
    localStorage.setItem(KEY, JSON.stringify({ ...v, price: modal.el.querySelector("#cc-price").value, side }));

    if (!v.depo || !v.use || !v.lev) {
      out.innerHTML = `<div class="muted" style="padding:8px 2px">Укажи депозит, процент на сделку и плечо —
        посчитаю сумму входа, объём и уровни.</div>`;
      return;
    }
    const margin = v.depo * v.use / 100;        // сумма входа (маржа на сделку)
    const pos = margin * v.lev;                 // объём позиции
    const qty = v.price ? pos / v.price : null; // кол-во актива
    const lossUsd = v.depo * v.loss / 100;
    const profitUsd = v.depo * v.profit / 100;
    const stopMove = pos > 0 ? lossUsd / pos * 100 : 0;    // ход цены против, %
    const tpMove = pos > 0 ? profitUsd / pos * 100 : 0;    // ход цены к цели, %
    const liqMove = 100 / v.lev;                           // ориентировочная ликвидация, %
    const rr = v.loss > 0 && v.profit > 0 ? v.profit / v.loss : null;
    const dir = side === "long" ? -1 : 1;       // стоп для лонга ниже входа, для шорта выше
    const stopPrice = v.price ? v.price * (1 + dir * stopMove / 100) : null;
    const tpPrice = v.price ? v.price * (1 - dir * tpMove / 100) : null;
    const liqPrice = v.price ? v.price * (1 + dir * liqMove / 100) : null;
    const stopBeyondLiq = v.loss > 0 && stopMove >= liqMove;

    const sign = (m) => side === "long" ? { stop: `−${m.s}%`, tp: `+${m.t}%` } : { stop: `+${m.s}%`, tp: `−${m.t}%` };
    const s = sign({ s: fmtRu(stopMove, 2), t: fmtRu(tpMove, 2) });

    out.innerHTML = `
      <div class="calc-main">
        <div class="lbl">Сумма входа (маржа на сделку)</div>
        <div class="big num">${money(margin)}</div>
        <div class="muted small num">объём позиции ${money(pos)} = ${money(margin)} × плечо ${fmtRu(v.lev, v.lev % 1 ? 1 : 0)}×${
          qty ? ` · ≈ ${qtyFmt(qty)} актива` : ""}</div>
      </div>
      ${v.loss ? `
      <div class="calc-row neg">
        <div>
          <div class="t">Стоп-лосс</div>
          <div class="sub num">${stopPrice != null ? `цена ${price(stopPrice)} · ` : ""}убыток −${money(lossUsd)}</div>
        </div>
        <div class="nums"><div class="move num">${s.stop}</div><div class="usd">ход цены</div></div>
      </div>` : ""}
      ${v.profit ? `
      <div class="calc-row pos">
        <div>
          <div class="t">Тейк-профит</div>
          <div class="sub num">${tpPrice != null ? `цена ${price(tpPrice)} · ` : ""}прибыль +${money(profitUsd)}</div>
        </div>
        <div class="nums"><div class="move num">${s.tp}</div><div class="usd">ход цены</div></div>
      </div>` : ""}
      ${stopBeyondLiq ? `
      <div class="calc-warn">⚠ Стоп дальше ликвидации (≈${fmtRu(liqMove, 2)}% хода) — позицию ликвидирует раньше,
        чем сработает стоп. Уменьши плечо или допустимый убыток.</div>` : ""}
      <div class="calc-foot">
        ${rr ? `<span class="num">R:R ≈ 1 : ${fmtRu(rr, rr % 1 ? 1 : 0)}</span>` : ""}
        <span class="muted num">ликвидация ≈ ${liqPrice != null ? `${price(liqPrice)} — ` : ""}ход ${side === "long" ? "−" : "+"}${fmtRu(liqMove, 2)}% (изолированная маржа, без учёта поддерживающей)</span>
        <span class="muted">комиссии и фандинг не учтены</span>
      </div>`;
  };

  modal.el.querySelectorAll("#cc-side .cs-btn").forEach((b) => b.onclick = () => {
    side = b.dataset.s;
    modal.el.querySelectorAll("#cc-side .cs-btn").forEach((x) => x.classList.toggle("on", x === b));
    recalc();
  });
  fields.forEach((k) => modal.el.querySelector(`#cc-${k}`).oninput = recalc);
  recalc();
}
