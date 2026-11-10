// Перевірка керування без браузера: node test/controls.test.js
// Бере скрипт з index.html, підміняє DOM, годинник і таймери заглушками
// й емулює дотики та кнопки. Залежностей немає.
const fs = require('fs');
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failures++; };

// ---------- годинник і таймери ----------
let now = 0; const timers = []; let tid = 0;
global.performance = { now: () => now };
global.setTimeout = (f, ms) => { timers.push({ id: ++tid, at: now + ms, f }); return tid; };
global.setInterval = (f, ms) => { timers.push({ id: ++tid, at: now + ms, f, every: ms }); return tid; };
global.clearTimeout = global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
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
const ctxStub = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
const els = {};
function mk(id, extra = {}) {
  const L = {};
  return Object.assign({
    id, textContent: '', style: {}, dataset: {}, width: 300, height: 150, clientWidth: 360, clientHeight: 500,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, v) { v ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    addEventListener: (t, f, o) => { L[t] = f; L[t + ':opts'] = o; }, L, getContext: () => ctxStub, appendChild() {},
    closest: () => null,
  }, extra);
}
const el = (id) => (els[id] ||= mk(id));
const buttons = ['left', 'rotate', 'right', 'down', 'drop'].map((a) => mk('btn-' + a, { dataset: { act: a } }));
const docL = {};
global.window = { addEventListener() {}, devicePixelRatio: 1 };
global.localStorage = { getItem: () => null, setItem() {} };
global.requestAnimationFrame = () => {};
global.document = {
  getElementById: el, querySelectorAll: (q) => (q === '.controls button' ? buttons : []), hidden: false,
  addEventListener: (t, f) => (docL[t] = f), createElement: () => ({ addEventListener() {}, set className(v) {}, textContent: '' }),
};
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const anchor = '  reset();\n  resize();';
if (!script.includes(anchor)) throw new Error('не знайшов точку старту гри в index.html');
// доступ до внутрішнього стану лише для тесту
eval(script.replace(anchor,
  'window.__t={get piece(){return piece},get serial(){return pieceSerial},collides,lock};\n' + anchor));
const T = window.__t, board = els.board;

// ---------- дотики ----------
let prevented = 0;
const ev = (x, y, id = 1) => ({ changedTouches: [{ identifier: id, clientX: x, clientY: y }], target: board, preventDefault() { prevented++; } });
const start = (x, y, id) => board.L.touchstart(ev(x, y, id));
const moveTo = (x, y, id) => board.L.touchmove(ev(x, y, id));
const end = (x, y, id) => board.L.touchend(ev(x, y, id));
// різкий змах униз: 4 touchmove за ~100 мс
function flick(x = 150, y0 = 100) {
  start(x, y0); now += 25; moveTo(x, y0 + 30); now += 25; moveTo(x, y0 + 90); now += 25; moveTo(x, y0 + 160);
  now += 25; moveTo(x, y0 + 240); now += 10; end(x, y0 + 240);
}
const fresh = () => { els.restartBtn.L.click(); now += 1000; };

// 1. Один змах униз — падає рівно одна фігура
fresh();
let s0 = T.serial; prevented = 0;
flick();
check('один змах = одна фігура', T.serial - s0 === 1, `впало ${T.serial - s0}`);
check('touch-слухачі не passive', board.L['touchstart:opts'].passive === false && board.L['touchmove:opts'].passive === false);
check('preventDefault на кожну touch-подію', prevented === 6, `викликів ${prevented} з 6`);

// 2. Палець лишається на екрані й далі смикається вниз — повторного падіння немає
fresh(); s0 = T.serial;
start(150, 100); now += 30; moveTo(150, 140); now += 30; moveTo(150, 260);
const afterFirst = T.serial;
for (let i = 0; i < 20; i++) { now += 40; moveTo(150, 260 + i * 30); }
now += 400; moveTo(150, 900); end(150, 900);
check('touchmove після падіння нічого не роняє', afterFirst - s0 === 1 && T.serial === afterFirst, `впало ${T.serial - s0}`);

// 3. Два швидкі змахи поспіль: другий у межах паузи ігнорується
fresh();
flick(); now += 20;
const sBefore = T.serial; start(150, 100); now += 20; moveTo(150, 200); now += 10; end(150, 200);  // через ~65 мс після падіння
check('другий змах у межах 150 мс не роняє фігуру', T.serial === sBefore, `впало ${T.serial - sBefore}`);
now += 200; flick();
check('після паузи змах знову працює', T.serial === sBefore + 1);

// 4. Повільний свайп униз довший за поле: спуск до дна, без фіксації й без наступної фігури
fresh(); s0 = T.serial;
start(150, 0);
for (let y = 10; y <= 1200; y += 10) { now += 40; moveTo(150, y); }
end(150, 1200);
const p = T.piece;
check('повільний свайп не перескакує на наступну фігуру', T.serial === s0, `serial +${T.serial - s0}`);
check('...і фігура лежить на дні', T.collides(p.m, p.x, p.y + 1));

// 5. Тап — поворот; свайп убік — рух по стовпцях
fresh();
const m0 = JSON.stringify(T.piece.m); start(150, 300); now += 80; end(152, 301);
check('тап повертає фігуру', JSON.stringify(T.piece.m) !== m0 || T.piece.key === 'O', T.piece.key);
const x0 = T.piece.x; start(150, 300); for (let i = 1; i <= 6; i++) { now += 30; moveTo(150 - i * 12, 302); } end(78, 302);
check('свайп уліво рухає фігуру', T.piece.x < x0, `x ${x0} → ${T.piece.x}`);

// 6. Утримання «вниз»: плавний спуск і жодної другої фігури
fresh(); s0 = T.serial;
const down = buttons[3]; let bp = 0;
const pe = () => ({ preventDefault() { bp++; } });
const y0 = T.piece.y;
down.L.pointerdown(pe());
advance(170 + 45 * 3);
const y1 = T.piece.y;
check('утримання «вниз» спускає поступово', y1 - y0 >= 3 && y1 - y0 <= 6, `за 305 мс на ${y1 - y0} рядків`);
advance(3000);
check('утримання «вниз» доводить до дна без фіксації', T.serial === s0 && T.collides(T.piece.m, T.piece.x, T.piece.y + 1));
T.lock();                       // фігура лягла (як від гравітації) — з'явилась нова
const s1 = T.serial, yNew = T.piece.y;
advance(1000);
check('автоповтор не підхоплює нову фігуру', T.serial === s1 && T.piece.y === yNew, `y ${yNew} → ${T.piece.y}`);
down.L.pointerup(); 
check('pointerdown кнопки гасить емуляцію миші', bp === 1);

// 7. Кнопка «скинути»: подвійне натискання за 150 мс — одна фігура
fresh(); s0 = T.serial;
buttons[4].L.pointerdown(pe()); buttons[4].L.pointerup(); now += 60;
buttons[4].L.pointerdown(pe()); buttons[4].L.pointerup();
check('подвійне «скинути» за 60 мс = одна фігура', T.serial - s0 === 1);

process.exit(failures ? 1 : 0);
