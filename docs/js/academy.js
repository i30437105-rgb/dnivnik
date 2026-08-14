// Вкладка «Академия»: закладки «Волны Эллиотта» (памятка из waves.js) и «Наставники»
// (редактируемый справочник: свои ссылки/заметки/карточки, хранение — user_settings.academy).

import { initWaves } from "./waves.js";
import { saveSettings } from "./api.js";
import { state, esc } from "./util.js";

// Затравка справочника: редактируемая копия появляется в БД при первом изменении.
// Дальше источник правды — user_settings.academy, эта константа больше не участвует.
const SEED = { v: 1, sections: [
  { id: "wyckoff", title: "Школа Вайкоффа и чтение ленты", people: [
    { id: "weis", name: "David Weis (Дэвид Вайс) † 2019",
      method: "Адаптация Вайкоффа, изобретатель Weis Wave",
      desc: "Волны накопленного объёма — то, что у нас в индикаторах. Чтение баров: спред, закрытие, объём → кто в контроле. Книга-ядро: «Trades About to Happen» (2013).",
      links: [
        { label: "Сайт-наследие weisonwyckoff.com", url: "https://weisonwyckoff.com/" },
        { label: "О нём — Wyckoff Analytics", url: "https://www.wyckoffanalytics.com/david-weis/" },
        { label: "Видео: Weis Wave + Wyckoff Tape Reading", url: "https://www.youtube.com/watch?v=Aljay14YGIo" },
      ],
      searches: ["David Weis Wyckoff webinar", "David Weis wave charts"], note: "" },
    { id: "bogomazov", name: "Roman Bogomazov / Wyckoff Analytics",
      method: "Самый системный живой преподаватель Вайкоффа",
      desc: "Профессор Golden Gate University. Накопление/распределение, спринги, апотрасты, разборы рынка в реальном времени. Сотни часов бесплатных сессий на канале.",
      links: [
        { label: "Канал YouTube «Wyckoff Trading Method»", url: "https://www.youtube.com/channel/UCzdnvMNNeBSRRh1KWuJ_BUQ" },
        { label: "Сайт wyckoffanalytics.com", url: "https://www.wyckoffanalytics.com/" },
        { label: "Видео: Tape Reading Techniques (Part 1)", url: "https://www.youtube.com/watch?v=uaF4liujhAw" },
        { label: "Видео: Practical Applications of the Wyckoff Method", url: "https://www.youtube.com/watch?v=E-xhARVRCWA" },
        { label: "Кейс: NVIDIA Distribution", url: "https://www.youtube.com/watch?v=SbvW2PsV3WA" },
      ],
      searches: ["Wyckoff Analytics", "Roman Bogomazov Wyckoff", "Wyckoff market discussion"], note: "" },
    { id: "dayton", name: "Dr. Gary Dayton (Гэри Дейтон)",
      method: "Вайкофф + чтение ленты + психология",
      desc: "Психолог по образованию, дружил с Вайсом (продаёт его официальный плагин Weis Wave). Спокойные академичные разборы спрингов и тестов. Книга «Trade Mindfully».",
      links: [
        { label: "Канал YouTube @drgarydayton", url: "https://www.youtube.com/@drgarydayton" },
        { label: "Сайт trademindfully.com", url: "https://trademindfully.com/" },
        { label: "Видео: The Ultimate Wyckoff Teaching", url: "https://www.youtube.com/watch?v=Abk5uh7w2-4" },
        { label: "Вебинар: Wyckoff Principles", url: "https://www.youtube.com/watch?v=oNv7hjlTPpM" },
      ],
      searches: ["Gary Dayton Wyckoff", "Gary Dayton tape reading", "Gary Dayton Weis Wave"], note: "" },
    { id: "reardon", name: "William Reardon / Feibel Trading",
      method: "Современное чтение ленты по Вайкоффу",
      desc: "Дисбаланс спроса/предложения, «Logical Price Action», интрадей. Выступает у Wyckoff Analytics (Tape Reading Lab).",
      links: [
        { label: "Канал YouTube", url: "https://www.youtube.com/c/williamreardon" },
        { label: "Профиль в Society of Technical Analysts", url: "https://www.technicalanalysts.com/meetings/speakers/william-reardon/" },
      ],
      searches: ["Feibel Trading", "William Reardon tape reading", "Wyckoff Analytics Reardon"], note: "" },
  ]},
  { id: "vsa", title: "VSA — Volume Spread Analysis", people: [
    { id: "williams", name: "Tom Williams (Том Уильямс) † 2020",
      method: "Создатель VSA",
      desc: "Бывший трейдер лондонского синдиката. Сила/слабость «умных денег» видна в связке объёма, спреда бара и закрытия. Прямой наследник Вайкоффа. Книга «Master the Markets» распространялась бесплатно.",
      links: [
        { label: "PDF «Master the Markets»", url: "https://pdfcoffee.com/master-the-markets-by-tom-williams-pdf-free.html" },
        { label: "Бесплатная библиотека TradeGuider", url: "https://www.volumespreadanalysis.com/library.asp" },
        { label: "Видеокурсы TradeGuider", url: "https://www.tradeguider.com/youtube/" },
      ],
      searches: ["Tom Williams VSA webinar", "TradeGuider Tom Williams", "VSA smart money"], note: "" },
    { id: "coulling", name: "Anna Coulling (Анна Коллинг)",
      method: "VPA — систематизация VSA",
      desc: "«A Complete Guide to Volume Price Analysis» — VSA самым доступным языком. Хороша как вторая книга после Williams.",
      links: [
        { label: "Сайт annacoulling.com", url: "https://www.annacoulling.com/" },
        { label: "Канал YouTube @acoull", url: "https://www.youtube.com/@acoull" },
      ],
      searches: ["Anna Coulling volume price analysis"], note: "" },
  ]},
  { id: "elliott", title: "Волны Эллиотта", people: [
    { id: "prechter", name: "Robert Prechter (Роберт Пректер)",
      method: "Главный носитель учения Эллиотта",
      desc: "Основатель Elliott Wave International (анализ рынков с 1979). «Elliott Wave Principle» (Frost & Prechter) — первоисточник современной волновой теории.",
      links: [
        { label: "Канал YouTube @ElliottWaveInternational", url: "https://www.youtube.com/@ElliottWaveInternational" },
        { label: "ElliottWaveTV — свежие разборы", url: "https://www.elliottwave.com/elliottwavetv/" },
      ],
      searches: ["Robert Prechter interview", "Elliott Wave International tutorial"], note: "" },
    { id: "neely", name: "Glenn Neely (Гленн Нили)",
      method: "NeoWave — формализованный Эллиотт",
      desc: "Жёсткие правила построения вместо субъективной разметки — под любовь к чётким правилам ложится лучше классики. Книга «Mastering Elliott Wave» (1-я глава бесплатно на сайте).",
      links: [
        { label: "Сайт neowave.com", url: "https://www.neowave.com/" },
        { label: "Видео: NEoWave Intro", url: "https://www.youtube.com/watch?v=EyjITpcizbM" },
        { label: "1-я глава «Mastering Elliott Wave»", url: "https://www.neowave.com/tradingblog/blog.asp?bid=181" },
      ],
      searches: ["Glenn Neely NeoWave interview", "NeoWave forecasting"], note: "" },
  ]},
  { id: "pa", title: "Чистый price action", people: [
    { id: "brooks", name: "Al Brooks (Эл Брукс)",
      method: "Чтение графика бар за баром",
      desc: "30+ лет торговли. Кто в ловушке, где стоят стопы, почему цена «обязана» дойти до магнита. Сухой как учебник — это комплимент. Трилогия «Trading Price Action».",
      links: [
        { label: "Канал YouTube @BrooksTradingCourse", url: "https://www.youtube.com/@BrooksTradingCourse" },
        { label: "Сайт brookstradingcourse.com", url: "https://www.brookstradingcourse.com/" },
        { label: "Видео: Mastering Price Action Trading", url: "https://www.youtube.com/watch?v=xhAle897TXo" },
      ],
      searches: ["Al Brooks price action", "Al Brooks bar by bar"], note: "" },
    { id: "raschke", name: "Linda Raschke (Линда Рашке)",
      method: "Классическая школа: структура дня, свинги",
      desc: "40 лет полной занятости в рынке, героиня «Новых магов рынка», ученица Спрандео. Книги: «Street Smarts», «Trading Sardines». На сайте — архив её видео и интервью.",
      links: [
        { label: "Сайт lindaraschke.net", url: "https://lindaraschke.net/" },
      ],
      searches: ["Linda Raschke lecture", "Linda Raschke market structure", "Linda Raschke swing trading"], note: "" },
    { id: "brandt", name: "Peter Brandt (Питер Брандт)",
      method: "Классический чартизм с 1975 года",
      desc: "50 лет торговли фигурами и прорывами. Концентрат здравого смысла про риск и реальное поведение цены. Книга «Diary of a Professional Commodity Trader».",
      links: [],
      searches: ["Peter Brandt interview", "Peter Brandt classical charting", "Factor Trading Peter Brandt"], note: "" },
  ]},
]};

let root;
let data;        // рабочая копия справочника
let editMode = false;

export function initAcademy(container) {
  root = container;
  data = structuredClone(state.settings?.academy ?? SEED);
  root.innerHTML = `
    <header class="pagehead">
      <div class="titles"><h1>Моя академия</h1><span class="sub">волны Эллиотта · наставники и школы цены</span></div>
    </header>
    <nav class="wnav" id="ac-tabs">
      <button class="chip" data-at="waves">Волны Эллиотта</button>
      <button class="chip" data-at="mentors">Наставники</button>
    </nav>
    <div id="ac-pane"></div>`;
  root.querySelectorAll("#ac-tabs .chip").forEach((b) => b.onclick = () => show(b.dataset.at));
  show(localStorage.getItem("academy-tab") || "waves");
}

function show(tab) {
  localStorage.setItem("academy-tab", tab);
  root.querySelectorAll("#ac-tabs .chip").forEach((b) => b.classList.toggle("on", b.dataset.at === tab));
  const pane = root.querySelector("#ac-pane");
  if (tab === "waves") {
    initWaves(pane);
    pane.querySelector(".pagehead")?.remove(); // у памятки свой заголовок — в академии он лишний
  } else {
    renderMentors(pane);
  }
}

// ---------- Наставники ----------

// возвращает null при успехе, текст ошибки при сбое
async function persist() {
  try {
    await saveSettings({ academy: data });
    state.settings = { ...(state.settings ?? {}), academy: structuredClone(data) };
    return null;
  } catch (e) {
    return e.message || "неизвестная ошибка";
  }
}

// статус пишется ПОСЛЕ перерисовки — иначе перерисовка его затирает
function flash(pane, err) {
  const el = pane.querySelector("#ac-status");
  if (!el) return;
  el.textContent = err ? "Ошибка сохранения: " + err : "Сохранено";
  el.style.color = err ? "var(--warn)" : "var(--chart-candle-up)";
}

const ytSearch = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

function renderMentors(pane) {
  pane.innerHTML = `
    <div class="block" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span class="muted">Фундаментальные школы движения цены: кто выигрывает — покупатели или продавцы.
      Подсказки поиска кликабельны — открывают поиск на YouTube.</span>
      <span class="spacer" style="flex:1"></span>
      <span id="ac-status" class="small"></span>
      <button id="ac-edit" class="btn ${editMode ? "on" : ""}">${editMode ? "Готово" : "✎ Редактировать"}</button>
    </div>
    ${data.sections.map(sectionHtml).join("")}`;

  pane.querySelector("#ac-edit").onclick = () => { editMode = !editMode; renderMentors(pane); };

  // удаление ссылки
  pane.querySelectorAll("[data-dellink]").forEach((b) => b.onclick = async () => {
    const [pid, i] = b.dataset.dellink.split("|");
    const p = findPerson(pid);
    if (!p || !confirm("Удалить ссылку «" + (p.links[i]?.label ?? "") + "»?")) return;
    p.links.splice(Number(i), 1);
    const err = await persist();
    renderMentors(pane);
    flash(pane, err);
  });

  // добавление ссылки
  pane.querySelectorAll("[data-addlink]").forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const p = findPerson(f.dataset.addlink);
    const label = f.querySelector('[name="label"]').value.trim();
    let url = f.querySelector('[name="url"]').value.trim();
    if (!p || !label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    p.links.push({ label, url });
    const err = await persist();
    renderMentors(pane);
    flash(pane, err);
  });

  // заметка (сохранение по уходу из поля)
  pane.querySelectorAll("[data-note]").forEach((t) => t.onchange = async () => {
    const p = findPerson(t.dataset.note);
    if (!p) return;
    p.note = t.value.trim();
    flash(pane, await persist());
  });

  // удаление наставника
  pane.querySelectorAll("[data-delperson]").forEach((b) => b.onclick = async () => {
    const p = findPerson(b.dataset.delperson);
    if (!p || !confirm("Удалить карточку «" + p.name + "» целиком?")) return;
    for (const s of data.sections) s.people = s.people.filter((x) => x.id !== p.id);
    const err = await persist();
    renderMentors(pane);
    flash(pane, err);
  });

  // добавление наставника в раздел
  pane.querySelectorAll("[data-addperson]").forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const sec = data.sections.find((s) => s.id === f.dataset.addperson);
    const name = f.querySelector('[name="name"]').value.trim();
    if (!sec || !name) return;
    sec.people.push({
      id: "u" + Date.now().toString(36),
      name,
      method: f.querySelector('[name="method"]').value.trim(),
      desc: f.querySelector('[name="desc"]').value.trim(),
      links: [], searches: [], note: "",
    });
    const err = await persist();
    renderMentors(pane);
    flash(pane, err);
  });
}

function findPerson(id) {
  for (const s of data.sections) {
    const p = s.people.find((x) => x.id === id);
    if (p) return p;
  }
  return null;
}

function sectionHtml(sec) {
  return `
  <section class="block">
    <h2>${esc(sec.title)}</h2>
    ${sec.people.map(personHtml).join("")}
    ${editMode ? `
      <form data-addperson="${sec.id}" class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
        <input name="name" placeholder="Имя наставника" required style="flex:1;min-width:160px">
        <input name="method" placeholder="Метод (коротко)" style="flex:1;min-width:160px">
        <input name="desc" placeholder="Описание" style="flex:2;min-width:200px">
        <button class="btn" type="submit">+ Наставник</button>
      </form>` : ""}
  </section>`;
}

function personHtml(p) {
  return `
  <div style="padding:14px 0;border-top:1px solid var(--border)">
    <div class="row" style="gap:10px;align-items:baseline;flex-wrap:wrap">
      <h3 style="margin:0;padding:0;border:none">${esc(p.name)}</h3>
      <span class="muted small">${esc(p.method)}</span>
      ${editMode ? `<span class="spacer" style="flex:1"></span>
        <button class="btn ghost small" data-delperson="${p.id}" title="Удалить карточку">✕</button>` : ""}
    </div>
    ${p.desc ? `<p class="small" style="line-height:1.55;color:var(--text-2);margin:7px 0 9px">${esc(p.desc)}</p>` : ""}
    ${p.links.length ? `<ul style="line-height:1.8;padding-left:20px;margin:0 0 8px">
      ${p.links.map((l, i) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
        ${editMode ? `<button class="btn ghost small" data-dellink="${p.id}|${i}" title="Удалить ссылку">✕</button>` : ""}</li>`).join("")}
    </ul>` : ""}
    ${p.searches?.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
      <span class="muted small">🔎 YouTube:</span>
      ${p.searches.map((q) => `<a class="chip" style="text-decoration:none" href="${esc(ytSearch(q))}"
        target="_blank" rel="noopener" title="Открыть поиск на YouTube">${esc(q)}</a>`).join("")}
    </div>` : ""}
    ${editMode ? `
      <form data-addlink="${p.id}" class="row" style="gap:8px;flex-wrap:wrap;margin-top:9px">
        <input name="label" placeholder="Название ссылки" required style="flex:1;min-width:150px">
        <input name="url" placeholder="https://…" required style="flex:2;min-width:200px">
        <button class="btn" type="submit">+ Ссылка</button>
      </form>
      <textarea data-note="${p.id}" placeholder="Моя заметка (что посмотреть, впечатления)…"
        style="width:100%;margin-top:9px;min-height:52px">${esc(p.note ?? "")}</textarea>`
    : (p.note ? `<div class="small" style="margin-top:8px;padding:8px 11px;background:var(--bg-inset);
        border-left:3px solid var(--accent);border-radius:6px;white-space:pre-wrap">${esc(p.note)}</div>` : "")}
  </div>`;
}
