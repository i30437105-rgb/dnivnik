// Галерея скриншотов + лайтбокс (спека дизайнера 1b/1c, handoff-2026-08-03).
// renderGallery(el, items, opts) — сетка миниатюр 16:10; openGallery(items, index) — лайтбокс
// со счётчиком, точками, подписью, свайпами ←→/↓, даблтап-зумом.
// items: [{ url, caption?, sub? }]
import { esc } from "./util.js";

const MAX_TILES = 4; // больше — бейдж «+N» на последней видимой

// Сетка миниатюр. opts: { onRemove(i) — крестики удаления (режим заполнения), single — 1 в ряд }
export function renderGallery(el, items, opts = {}) {
  el.classList.add("gal");
  if (opts.single || items.length === 1) el.classList.add("one");
  const shown = opts.onRemove ? items : items.slice(0, MAX_TILES);
  const extra = items.length - shown.length;
  el.innerHTML = shown.map((it, i) => `
    <button type="button" class="gal-tile" data-i="${i}">
      <img src="${esc(it.url)}" alt="${esc(it.caption ?? "скриншот")}" loading="lazy"
        onerror="this.closest('.gal-tile').classList.add('err')">
      <span class="gal-err">⚠<br>не загрузилось</span>
      ${extra > 0 && i === shown.length - 1 ? `<span class="gal-more">+${extra}</span>` : ""}
      ${opts.onRemove ? `<span class="gal-rm" data-rm="${i}" title="Убрать">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></span>` : ""}
    </button>`).join("");
  el.querySelectorAll(".gal-tile").forEach((t) => t.onclick = (e) => {
    const rm = e.target.closest(".gal-rm");
    if (rm) { opts.onRemove?.(Number(rm.dataset.rm)); return; }
    const i = Number(t.dataset.i);
    opts.onOpen ? opts.onOpen(i) : openGallery(items, i); // onOpen — сквозная листалка по всем скринам окна
  });
}

// Полноэкранный лайтбокс
export function openGallery(items, index = 0) {
  let i = Math.min(Math.max(index, 0), items.length - 1);
  let zoomed = false;
  const box = document.createElement("div");
  box.className = "lightbox glb";
  document.body.appendChild(box);
  document.body.classList.add("lightbox-open"); // прячет таб-бар

  const close = () => { box.remove(); document.body.classList.remove("lightbox-open"); };

  const draw = () => {
    const it = items[i];
    box.innerHTML = `
      <div class="glb-top">
        ${items.length > 1 ? `<span class="glb-count num">${i + 1} / ${items.length}</span>` : "<span></span>"}
        <button class="glb-close" title="Закрыть">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
        </button>
      </div>
      <div class="glb-stage"><img src="${esc(it.url)}" alt="${esc(it.caption ?? "скриншот")}" draggable="false"></div>
      ${it.caption ? `<div class="glb-cap"><div class="t">${esc(it.caption)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ""}</div>` : ""}
      ${items.length > 1 ? `<div class="glb-dots">${items.map((_, k) =>
        `<span class="${k === i ? "on" : ""}"></span>`).join("")}</div>` : `<div style="height:26px"></div>`}`;
    box.querySelector(".glb-close").onclick = close;
    const img = box.querySelector(".glb-stage img");
    img.ondblclick = () => { zoomed = !zoomed; img.classList.toggle("zoomed", zoomed); };
    box.querySelector(".glb-stage").onclick = (e) => { if (e.target === e.currentTarget) close(); };
    attachSwipes(img);
  };

  // Свайпы: ←→ листают (порог 60px или скорость), ↓ >120px закрывает; в зуме не листаем
  const attachSwipes = (img) => {
    let sx = 0, sy = 0, st = 0, dx = 0, dy = 0, active = false;
    img.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || zoomed) return;
      active = true;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = performance.now();
      dx = dy = 0;
      img.style.transition = "none";
    }, { passive: true });
    img.addEventListener("touchmove", (e) => {
      if (!active) return;
      dx = e.touches[0].clientX - sx; dy = e.touches[0].clientY - sy;
      if (Math.abs(dy) > Math.abs(dx)) img.style.transform = `translateY(${Math.max(dy, 0)}px)`;
      else img.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    img.addEventListener("touchend", () => {
      if (!active) return;
      active = false;
      const dt = performance.now() - st;
      const speed = Math.abs(dx) / Math.max(dt, 1);
      img.style.transition = "transform .18s ease-out";
      if (dy > 120 && dy > Math.abs(dx)) { close(); return; }
      if ((Math.abs(dx) > 60 || speed > 0.3) && Math.abs(dx) > Math.abs(dy)) {
        const next = dx < 0 ? i + 1 : i - 1;
        if (next >= 0 && next < items.length) { i = next; zoomed = false; draw(); return; }
      }
      img.style.transform = ""; // пружина обратно
    }, { passive: true });
  };

  // клавиатура на десктопе
  const onKey = (e) => {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    if (e.key === "ArrowRight" && i < items.length - 1) { i++; draw(); }
    if (e.key === "ArrowLeft" && i > 0) { i--; draw(); }
  };
  document.addEventListener("keydown", onKey);

  draw();
}
