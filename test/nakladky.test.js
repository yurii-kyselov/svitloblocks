// Перевірка «Накладок» без браузера: node test/nakladky.test.js
// Бере скрипт з nakladky/index.html, підміняє DOM, годинник і таймери заглушками.
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failures++;
};

// ---------- годинник і таймери ----------
let now = 0; const timers = []; let tid = 0;
global.performance = { now: () => now };
global.setTimeout = (f, ms) => { timers.push({ id: ++tid, at: now + ms, f }); return tid; };
global.setInterval = (f, ms) => { timers.push({ id: ++tid, at: now + ms, f, every: ms }); return tid; };
global.clearTimeout = global.clearInterval = (id) => {
  const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1);
};
function advance(ms) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    now = t.at;
    if (t.every) t.at += t.every; else timers.shift();
    t.f();
  }
  now = end;
}

// ---------- DOM-заглушка ----------
function mk(tag = 'div') {
  const L = {};
  const el = {
    tag, children: [], dataset: {}, style: { setProperty() {} }, textContent: '', innerHTML: '',
    className: '', clientWidth: 328, clientHeight: 480, L, parent: null,
    classList: {
      add(c) { const s = new Set(el.className.split(' ').filter(Boolean)); s.add(c); el.className = [...s].join(' '); },
      remove(c) { el.className = el.className.split(' ').filter((x) => x && x !== c).join(' '); },
      contains(c) { return el.className.split(' ').includes(c); },
      toggle(c, on) { if (on) el.classList.add(c); else el.classList.remove(c); },
    },
    setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k]; },
    addEventListener(t, f) { L[t] = f; },
    appendChild(c) { c.parent = el; el.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => el.appendChild(c)); },
    closest(sel) { return sel === '.cell' && el.classList.contains('cell') ? el : null; },
    click() { L.click && L.click(); },
  };
  let markup = '';
  Object.defineProperty(el, 'innerHTML', { get: () => markup, set: (v) => { markup = v; el.children = []; } });
  return el;
}
const els = {};
let store = {};
global.window = { addEventListener() {} };
global.navigator = { vibrate() {} };
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.document = {
  getElementById: (id) => (els[id] ||= mk()),
  createElement: (tag) => mk(tag),
  addEventListener() {},
};

const html = fs.readFileSync(path.join(__dirname, '..', 'nakladky', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const anchor = '  newGame();\n})();';
if (!script.includes(anchor)) throw new Error('не знайшов точку старту гри в nakladky/index.html');
// доступ до внутрішнього стану лише для тесту
eval(script.replace(anchor, `  newGame();
  window.__t = { open, chord, toggleFlag, newGame, neighbors,
    get cells() { return cells; }, get state() { return state; }, get rows() { return rows; },
    get cols() { return cols; }, get flags() { return flags; }, get cellSize() { return cellSize; } };
})();`));
const T = window.__t;
const board = els.board;
const banner = () => els.banner.className;
const bannerText = () => els.bannerMsg.children.map((c) => c.textContent).join(' / ');

// ---------- 1. інваріанти поля: 200 випадкових полів кожного рівня ----------
// Рахуємо сусідів незалежно від гри — через (рядок, стовпець) і явні межі,
// щоб помилка «сусід у стовпці 0 береться з кінця попереднього рядка» не сховалась
const LEVELS = { pai: [9, 9, 10], masyv: [16, 16, 40], kadastr: [30, 16, 99] }; // стовпці, рядки, накладки
const BOARDS = 200;
function around(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push([rr, cc]);
    }
  }
  return out;
}
for (const [lvl, [cols, rows, mines]] of Object.entries(LEVELS)) {
  const errors = { size: 0, mines: 0, numbers: 0, first: 0 };
  // кути й краї — окремо, решта — випадкові клітинки
  const special = [[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1], [0, 4], [rows - 1, 4], [5, 0], [5, cols - 1]];
  for (let k = 0; k < BOARDS; k++) {
    T.newGame(lvl);
    if (T.cols !== cols || T.rows !== rows || T.cells.length !== cols * rows) errors.size++;
    const [fr, fc] = k < special.length ? special[k]
      : [Math.floor(Math.random() * rows), Math.floor(Math.random() * cols)];
    T.open(fr * cols + fc);
    const at = (r, c) => T.cells[r * cols + c];
    if (T.cells.filter((c) => c.mine).length !== mines) errors.mines++;
    if (T.state === 'lost' || at(fr, fc).mine || around(fr, fc, rows, cols).some(([r, c]) => at(r, c).mine)) errors.first++;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (at(r, c).mine) continue;
        const n = around(r, c, rows, cols).filter(([rr, cc]) => at(rr, cc).mine).length;
        if (at(r, c).n !== n) errors.numbers++;
      }
    }
  }
  const ok = Object.values(errors).every((v) => !v);
  check(`${lvl}: ${cols}×${rows}, ${mines} накладок, цифри й перший хід на ${BOARDS} полях`, ok, ok ? '' : JSON.stringify(errors));
}

// Сусіди за версією гри: на краях не «загортаються» в сусідній рядок
T.newGame('kadastr');
const C = T.cols, R = T.rows;
const asRC = (i) => [Math.floor(i / C), i % C];
const wrapErrors = [];
for (const [r, c] of [[0, 0], [5, 0], [5, C - 1], [R - 1, 0], [R - 1, C - 1], [0, C - 1]]) {
  const got = T.neighbors(r * C + c).map(asRC);
  const bad = got.filter(([rr, cc]) => Math.abs(rr - r) > 1 || Math.abs(cc - c) > 1);
  if (bad.length || got.length !== around(r, c, R, C).length) wrapErrors.push(`${r},${c}`);
}
check('сусіди на кутах і краях не беруться з іншого рядка', !wrapErrors.length, wrapErrors.join(' '));

// Підписи рівнів точно як поле: стовпці × рядки
const labels = els.levels.children.map((b) => b.innerHTML);
check('підписи рівнів збігаються з розмірами', labels[0].includes('9×9 · 10') && labels[1].includes('16×16 · 40') &&
  labels[2].includes('30×16 · 99'), labels.map((l) => l.replace(/<[^>]+>/g, ' ')).join(' | '));
check('перший хід — порожня зона розкривається сама', (() => {
  T.newGame('pai'); T.open(40); return T.cells.filter((c) => c.open).length > 1;
})());

// ---------- 2. програш ----------
T.newGame('pai'); T.open(40);
const wrongFlag = T.cells.findIndex((c) => !c.mine && !c.open);
T.toggleFlag(wrongFlag);
const mine = T.cells.findIndex((c) => c.mine);
T.open(mine);
check('програш: стан і банер', T.state === 'lost' && banner().includes('lose'));
check('програш: текст', bannerText().startsWith('Ви наклались на сусіда. Справа передана в суд'), bannerText());
check('програш: кнопка «Подати нову заяву»', els.againBtn.textContent === 'Подати нову заяву');
check('програш: програшна клітинка підсвічена', board.children[mine].className.includes('boom'));
check('програш: неправильний спір позначено', board.children[wrongFlag].className.includes('wrong'));
const otherMine = T.cells.findIndex((c, i) => c.mine && i !== mine);
check('програш: решту накладок показано', board.children[otherMine].className.includes('mine'));
const openedAfterLoss = T.cells.filter((c) => c.open).length;
T.open(T.cells.findIndex((c) => !c.open && !c.mine));
check('після програшу поле не відкривається', T.cells.filter((c) => c.open).length === openedAfterLoss && T.state === 'lost');

// ---------- 3. акорд ----------
let chordOk = false, chordBlocked = false;
for (let k = 0; k < 200 && !(chordOk && chordBlocked); k++) {
  T.newGame('masyv'); T.open(8 * 16 + 8);
  const num = T.cells.findIndex((c, i) => c.open && c.n > 0 &&
    T.neighbors(i).some((j) => !T.cells[j].open && !T.cells[j].mine));
  if (num < 0) continue;
  const around = T.neighbors(num);
  const closedSafe = around.filter((j) => !T.cells[j].open && !T.cells[j].mine);
  // прапорців менше, ніж цифра, — акорд нічого не робить
  if (T.cells[num].n > 1 && !chordBlocked) {
    T.toggleFlag(around.find((j) => T.cells[j].mine));
    const before = T.cells.filter((c) => c.open).length;
    T.chord(num);
    chordBlocked = T.cells.filter((c) => c.open).length === before;
    continue;
  }
  around.filter((j) => T.cells[j].mine).forEach((j) => T.toggleFlag(j));
  T.open(num);                                            // тап по цифрі
  chordOk = closedSafe.every((j) => T.cells[j].open);
}
check('акорд відкриває решту сусідів', chordOk);
check('акорд не спрацьовує, коли спорів менше за цифру', chordBlocked);

// ---------- 4. перемога і рекорд ----------
store = {};
T.newGame('pai'); now = 1000; T.open(40);
now = 43000;
T.cells.forEach((c, i) => { if (!c.mine && !c.open) T.open(i); });
check('перемога: стан і текст', T.state === 'won' && bannerText().startsWith('Усі накладки виявлено. Витяг сформовано'), bannerText());
check('перемога: усі накладки під спором', T.cells.every((c) => !c.mine || c.flag) && els.left.textContent === 0);
check('рекорд записано окремо для рівня', store['nakladky.best.pai'] === '42' && !('nakladky.best.masyv' in store), JSON.stringify(store));
T.newGame('pai'); now = 0; T.open(40); now = 90000;
T.cells.forEach((c, i) => { if (!c.mine && !c.open) T.open(i); });
check('повільніша перемога рекорд не перебиває', store['nakladky.best.pai'] === '42');
check('рекорд підписано «Найшвидший витяг»', html.includes('<small>Найшвидший витяг</small>') && els.best.textContent === '0:42');

// ---------- 5. дотики ----------
T.newGame('pai');
const press = (i, hold, opts = {}) => {
  const target = board.children[i];
  board.L.pointerdown({ target, isPrimary: true, button: 0, pointerType: 'touch', clientX: 10, clientY: 10, ...opts });
  advance(hold);
  if (opts.moveTo) board.L.pointermove({ target, clientX: opts.moveTo, clientY: 10 });
  board.L.pointerup({ target });
};
press(5, 450);
check('довге натискання (400 мс) ставить спір', T.cells[5].flag && !T.cells[5].open && T.state === 'ready');
press(5, 450);
check('повторне довге натискання знімає спір', !T.cells[5].flag);
press(40, 120);
check('короткий тап відкриває клітинку', T.cells[40].open && T.state === 'playing');
const closed = T.cells.findIndex((c) => !c.open && !c.flag);
press(closed, 120, { moveTo: 60 });
check('палець поїхав (прокрутка) — нічого не відбувається', !T.cells[closed].open && !T.cells[closed].flag);
els.modeBtn.click();
press(closed, 120);
check('перемикач «спір»: тап ставить спір', T.cells[closed].flag && els.modeBtn['aria-pressed'] === 'true');
els.modeBtn.click();
board.L.pointerdown({ target: board.children[closed], isPrimary: true, button: 2, pointerType: 'mouse', clientX: 0, clientY: 0 });
check('права кнопка миші знімає спір', !T.cells[closed].flag);

// ---------- 6. зламане сховище ----------
global.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
let crashed = false;
try {
  T.newGame('pai'); T.open(40);
  T.cells.forEach((c, i) => { if (!c.mine && !c.open) T.open(i); });
} catch (e) { crashed = true; }
check('без localStorage гра доходить до перемоги', !crashed && T.state === 'won');

// ---------- 7. розмір поля не залежить від екрана ----------
for (const [w, h] of [[328, 480], [600, 300], [1200, 800]]) {
  els.wrap.clientWidth = w; els.wrap.clientHeight = h;
  T.newGame('kadastr');
  check(`Кадастр на екрані ${w}×${h} — 30 стовпців × 16 рядків`, T.cols === 30 && T.rows === 16, `${T.cols}×${T.rows}`);
}
// Мінімум клітинки: Масив — 18 px, решта — 22 px; що не влазить — гортається в рамці.
// Екран 360 px мінус поля сторінки 2 × 16 px = 328 px під поле
const MIN = { pai: 22, masyv: 18, kadastr: 22 };
const fits = (w) => T.cols * T.cellSize + (T.cols - 1) * 2 + 4 <= w;
for (const [w, label] of [[328, '360 px'], [280, '312 px']]) {
  els.wrap.clientWidth = w;
  for (const lvl of ['pai', 'masyv', 'kadastr']) {
    T.newGame(lvl);
    const hint = els.scrollHint.classList.contains('show');
    check(`${lvl} на ${label}: клітинка ${T.cellSize} px, прокрутка ${hint ? 'є' : 'нема'}`,
      T.cellSize >= MIN[lvl] && T.cellSize <= 40 && hint === !fits(w) && els.wrap.classList.contains('wide') === hint);
  }
}
// Головне: Масив на 360 px вміщується без прокрутки, інші рівні 22 px не порушують
els.wrap.clientWidth = 328;
T.newGame('masyv');
check('Масив на 360 px вміщається без прокрутки', fits(328) && !els.scrollHint.classList.contains('show'), `клітинка ${T.cellSize} px`);
T.newGame('kadastr');
check('Кадастр лишається з мінімумом 22 px', T.cellSize === 22);
els.wrap.clientWidth = 200;
T.newGame('masyv');
check('Масив на дуже вузькому екрані не дрібніший за 18 px', T.cellSize === 18 && els.scrollHint.classList.contains('show'));

process.exit(failures ? 1 : 0);
