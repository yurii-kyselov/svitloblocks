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
    },
    setAttribute(k, v) { el[k] = v; }, getAttribute(k) { return el[k]; },
    addEventListener(t, f) { L[t] = f; },
    appendChild(c) { c.parent = el; el.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => el.appendChild(c)); },
    closest(sel) { return sel === '.cell' && el.classList.contains('cell') ? el : null; },
    click() { L.click && L.click(); },
  };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
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
    get cols() { return cols; }, get flags() { return flags; } };
})();`));
const T = window.__t;
const board = els.board;
const banner = () => els.banner.className;
const bannerText = () => els.bannerMsg.children.map((c) => c.textContent).join(' / ');

// ---------- 1. перший хід безпечний ----------
let safe = true;
for (const lvl of ['pai', 'masyv', 'kadastr']) {
  for (let k = 0; k < 60; k++) {
    T.newGame(lvl);
    const first = Math.floor(Math.random() * T.cells.length);
    T.open(first);
    const zone = [first, ...T.neighbors(first)];
    if (zone.some((i) => T.cells[i].mine) || T.state === 'lost') safe = false;
    const total = T.cells.filter((c) => c.mine).length;
    if (total !== { pai: 10, masyv: 40, kadastr: 99 }[lvl]) safe = false;
  }
}
check('перший хід і його сусіди ніколи не накладки (180 партій)', safe);
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

// ---------- 7. Кадастр на вузькому екрані стоїть вертикально ----------
T.newGame('kadastr');
check('Кадастр на телефоні — 30 рядків × 16 стовпців', T.rows === 30 && T.cols === 16, `${T.rows}×${T.cols}`);

process.exit(failures ? 1 : 0);
