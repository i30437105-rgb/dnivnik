// Симулятор: механика торговли (формулы Bybit USDT-перп, техдок §6).
// Все функции чистые: принимают состояние, возвращают новое — ничего не мутируют.

// Вход: маржа M, объём Q = M × плечо / цена. Комиссия входа = Q × цена × fee%.
export function openPosition({ side, margin, leverage, price, ts, feePct }) {
  const qty = margin * leverage / price;
  const entryFee = qty * price * feePct / 100;
  return {
    side, margin, leverage, qty,
    entryTs: ts, entryPrice: price, entryFee,
  };
}

export const dirOf = (side) => (side === "long" ? 1 : -1);

// uPnL = Q × (цена − вход) × dir; ROI% = uPnL / M × 100 — как на Bybit
export const uPnL = (pos, price) => pos.qty * (price - pos.entryPrice) * dirOf(pos.side);
export const roiPct = (pos, price) => (uPnL(pos, price) / pos.margin) * 100;

// Ликвидация ≈ вход × (1 ∓ 0.95/плечо) (§6.4)
export const liqPrice = (pos) =>
  pos.entryPrice * (1 - dirOf(pos.side) * 0.95 / pos.leverage);

// Безубыток: цена, при которой uPnL покрывает обе комиссии (вход + выход по той же ставке)
export function breakevenPrice(pos, feePct) {
  const f = feePct / 100;
  const d = dirOf(pos.side);
  // Q×(p−e)×d = Q×e×f + Q×p×f  →  p = e×(1 + d·f) / (1 − d·f)... решаем линейно:
  return pos.entryPrice * (1 + d * f) / (1 - d * f);
}

// Закрытие: PnL нетто = Q × (выход − вход) × dir − комиссии (§6.6)
export function closePosition(pos, { price, ts, feePct, reason }) {
  const exitFee = pos.qty * price * feePct / 100;
  const gross = uPnL(pos, price);
  const fees = pos.entryFee + exitFee;
  return {
    ...pos,
    exitTs: ts, exitPrice: price, exitReason: reason,
    fees, pnl: gross - fees,
  };
}

// Проверка бара на ликвидацию открытой позиции: пересёк ли экстремум цену ликвидации.
// Возвращает цену исполнения или null. Гэп через уровень — по открытию бара (§6.3).
export function checkLiquidation(pos, bar) {
  const lp = liqPrice(pos);
  if (pos.side === "long") {
    if (bar.open <= lp) return bar.open;
    if (bar.low <= lp) return lp;
  } else {
    if (bar.open >= lp) return bar.open;
    if (bar.high >= lp) return lp;
  }
  return null;
}

// ---------- Сводка по закрытым сделкам сессии ----------

export function sessionStats(closedTrades) {
  const n = closedTrades.length;
  const pnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = closedTrades.filter((t) => t.pnl > 0).length;
  return { n, pnl, wins, winrate: n ? (wins / n) * 100 : null };
}
