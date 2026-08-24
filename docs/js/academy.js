// Вкладка «Академия»: закладки «Волны Эллиотта» (памятка из waves.js) и «Наставники»
// (редактируемый справочник: свои ссылки/заметки/карточки, хранение — user_settings.academy).

import { initWaves } from "./waves.js";
import { renderTape } from "./tape.js";
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
    <nav class="ac-tabs" id="ac-tabs">
      <button class="chip" data-at="waves">Волны Эллиотта</button>
      <button class="chip" data-at="mentors">Наставники</button>
      <button class="chip" data-at="schemes">Схемы</button>
      <button class="chip" data-at="tape">Чтение ленты</button>
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
  } else if (tab === "schemes") {
    renderSchemes(pane);
  } else if (tab === "tape") {
    renderTape(pane);
  } else {
    renderMentors(pane);
  }
}

// ---------- Схемы ----------

function renderSchemes(pane) {
  pane.innerHTML = `
  <section class="block">
    <h2>Схема Вайса: где искать сделки</h2>
    <p class="muted small" style="margin:4px 0 14px">Рисунок 1.1 из «Trades About to Happen» Дэвида Вайса.
    Торговый диапазон между двумя уровнями; сделки ищутся в отмеченных точках. Под русскими подписями — оригинальные термины для поиска видео.</p>
    <div style="overflow-x:auto">
    <svg viewBox="0 0 1050 820" role="img" style="display:block;max-width:960px;min-width:640px;height:auto;color:#ece7df;background:var(--bg-inset);border:1px solid var(--chart-grid);border-radius:10px"
         aria-label="Схема Дэвида Вайса: диапазон с сокращением импульса, апотрастом, спрингом, поглощением и пробоями">
      <line x1="40" y1="270" x2="905" y2="270" stroke="currentColor" stroke-width="3.5" stroke-dasharray="24 13"/>
      <line x1="28" y1="555" x2="920" y2="555" stroke="currentColor" stroke-width="3.5" stroke-dasharray="24 13"/>
      <line x1="352" y1="300" x2="586" y2="572" stroke="currentColor" stroke-width="1" opacity=".55"/>
      <line x1="410" y1="296" x2="640" y2="566" stroke="currentColor" stroke-width="1" opacity=".55"/>
      <line x1="562" y1="542" x2="806" y2="290" stroke="currentColor" stroke-width="1" opacity=".55"/>
      <line x1="612" y1="588" x2="850" y2="334" stroke="currentColor" stroke-width="1" opacity=".55"/>
      <line x1="352" y1="368" x2="424" y2="368" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="402" y1="412" x2="478" y2="412" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="455" y1="460" x2="540" y2="460" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="600" y1="500" x2="690" y2="500" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="630" y1="445" x2="726" y2="445" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="662" y1="385" x2="770" y2="385" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <line x1="695" y1="330" x2="845" y2="330" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 5"/>
      <polyline fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" points="30,450 42,515 52,468 65,538 78,470 95,420 105,455 120,380 130,415 145,340 155,300 165,345 178,308 190,352 202,318 215,370 230,430 240,395 252,470 262,420 275,350 285,378 298,310 308,340 320,285 330,315 342,258 352,300 362,262 372,330 385,368 398,340 412,392 425,362 440,420 452,388 468,448 480,415 495,470 508,440 520,500 532,468 545,530 558,555 568,592 578,540 588,565 600,535 612,558 625,528 638,480 650,505 662,455 674,482 688,428 700,455 712,400 724,428 738,372 748,330 758,355 768,313 778,342 788,298 798,325 808,282 818,312 828,215 838,260 848,225 858,285 868,272 875,268 890,180 897,210 910,120 918,150 928,80"/>
      <line x1="550" y1="536" x2="568" y2="592" stroke="currentColor" stroke-width="5"/>
      <line x1="818" y1="312" x2="829" y2="213" stroke="currentColor" stroke-width="5.5"/>
      <line x1="588" y1="592" x2="625" y2="712" stroke="currentColor" stroke-width="5.5" stroke-dasharray="17 11"/>
      <polyline fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="8 6" stroke-linejoin="round" points="625,712 645,640 660,735 683,620 697,668 712,600 730,700 750,610 765,660 785,585 800,630 820,570 835,610 850,562 862,600 875,558 895,650 905,700 915,748"/>
      <ellipse cx="180" cy="328" rx="46" ry="44" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <ellipse cx="330" cy="292" rx="50" ry="50" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <ellipse cx="572" cy="556" rx="62" ry="50" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <ellipse cx="786" cy="314" rx="56" ry="46" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <ellipse cx="872" cy="276" rx="31" ry="29" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <ellipse cx="862" cy="580" rx="41" ry="37" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <line x1="148" y1="252" x2="172" y2="296" stroke="currentColor" stroke-width="1.2"/>
      <line x1="330" y1="228" x2="330" y2="243" stroke="currentColor" stroke-width="1.2"/>
      <line x1="758" y1="206" x2="820" y2="248" stroke="currentColor" stroke-width="1.2"/>
      <line x1="893" y1="322" x2="877" y2="298" stroke="currentColor" stroke-width="1.2"/>
      <line x1="845" y1="376" x2="806" y2="342" stroke="currentColor" stroke-width="1.2"/>
      <line x1="548" y1="628" x2="558" y2="596" stroke="currentColor" stroke-width="1.2"/>
      <line x1="652" y1="592" x2="620" y2="562" stroke="currentColor" stroke-width="1.2"/>
      <line x1="548" y1="692" x2="596" y2="662" stroke="currentColor" stroke-width="1.2"/>
      <line x1="862" y1="516" x2="862" y2="542" stroke="currentColor" stroke-width="1.2"/>
      <g fill="currentColor">
        <g text-anchor="middle">
          <text x="118" y="230" font-size="16" font-weight="bold">Сокращение импульса</text>
          <text x="118" y="247" font-size="11.5" font-style="italic" opacity=".55">Shortening of Thrust</text>
          <text x="330" y="205" font-size="16" font-weight="bold">Апотраст</text>
          <text x="330" y="222" font-size="11.5" font-style="italic" opacity=".55">Upthrust</text>
          <text x="722" y="188" font-size="16" font-weight="bold">Пробой вверх</text>
          <text x="722" y="205" font-size="11.5" font-style="italic" opacity=".55">Breakout</text>
          <text x="540" y="648" font-size="16" font-weight="bold">Спринг</text>
          <text x="540" y="665" font-size="11.5" font-style="italic" opacity=".55">Spring</text>
          <text x="512" y="712" font-size="16" font-weight="bold">Пробой вниз</text>
          <text x="512" y="729" font-size="11.5" font-style="italic" opacity=".55">Breakdown</text>
          <text x="862" y="486" font-size="16" font-weight="bold">Тест пробоя вниз</text>
          <text x="862" y="503" font-size="11.5" font-style="italic" opacity=".55">Test of Breakdown</text>
        </g>
        <g text-anchor="start">
          <text x="898" y="340" font-size="16" font-weight="bold">Тест пробоя</text>
          <text x="898" y="357" font-size="11.5" font-style="italic" opacity=".55">Test of Breakout</text>
          <text x="850" y="392" font-size="16" font-weight="bold">Поглощение</text>
          <text x="850" y="409" font-size="11.5" font-style="italic" opacity=".55">Absorption</text>
          <text x="658" y="606" font-size="16" font-weight="bold">Тест спринга</text>
          <text x="658" y="623" font-size="11.5" font-style="italic" opacity=".55">Test of Spring</text>
        </g>
      </g>
    </svg>
    </div>
    <p class="muted small" style="margin-top:12px;line-height:1.6;max-width:860px">Логика схемы: в диапазоне сверху — сокращение импульса
    и апотраст (ложный пробой вверх), снизу — спринг (ложный пробой вниз) с тестом. Дальше два сценария:
    поглощение предложения под сопротивлением → пробой вверх → тест пробоя, либо (пунктир) пробой вниз →
    возврат к поддержке снизу → тест пробоя вниз. Сделки ищутся именно в этих точках.</p>
  </section>`;
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
