/*!
 * PixelBG 1.0 — процедурные пиксельные фоны для браузерной игры.
 *
 * Подключение:
 *   <div id="bg" style="position:fixed; inset:0"></div>
 *   <script src="engine.js"></script>
 *   <script src="scenes/desert.js"></script>   // и другие локации
 *   <script>
 *     const bg = PixelBG.mount('#bg', { location: 'desert' });   // день или ночь выберется по часам игрока
 *     bg.setLocation('forest');                                  // смена локации, плавный переход
 *     bg.setHour(21.5);                                          // если в игре своё время: 0..24
 *     bg.setTime('day');                                         // 'auto' | 'day' | 'night'
 *   </script>
 *
 * Как устроен фон:
 *  - рисуется в маленьком «логическом» холсте высотой около 192 пикселей, ширина любая;
 *  - холст увеличивается в целое число раз, поэтому пиксели везде квадратные;
 *  - анимация идёт ступенями по 10 кадров в секунду.
 *
 * Как писать сцену (scenes/<имя>.js):
 *   PixelBG.register('имя', function (env) {
 *     // env.W, env.H   — размер логического холста в пикселях
 *     // env.Y(y)       — y в «проектных» координатах (кадр 192 строки), привязка к НИЗУ экрана (земля, горизонт)
 *     // env.Ys(y)      — y, растущий вместе с высотой экрана (небо, облака, звёзды)
 *     // env.U(u)       — x от ЦЕНТРА экрана: u = 0 — середина, отрицательные влево
 *     // env.limit      — на сколько пикселей от центра надо рисовать декор, чтобы закрыть широкий экран
 *     // env.variant    — 'night' | 'day';   env.night / env.day — то же булевыми
 *     // env.px         — все помощники (см. PX ниже)
 *     // здесь строим статичные слои (Layer -> canvas) и считаем списки частиц
 *     return { draw(ctx, f) { ... } };   // f — номер кадра (целое, 10 в секунду), рисуем весь кадр
 *   });
 */
(function (root) {
'use strict';

const FPS = 10;
const DESIGN_H = 192;

/* ===================================================================== утилиты */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const _cc = new Map();
/** '#rrggbb' | '#rgb' | [r,g,b] -> [r,g,b] */
function C(c) {
  if (typeof c !== 'string') return c;
  let v = _cc.get(c);
  if (!v) {
    let h = c.charAt(0) === '#' ? c.slice(1) : c;
    if (h.length === 3) h = h.replace(/./g, m => m + m);
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    _cc.set(c, v);
  }
  return v;
}
const _css = new Map();
/** цвет -> строка для ctx.fillStyle (с кэшем) */
function css(c) {
  c = C(c);
  const k = (c[0] << 16) | (c[1] << 8) | c[2];
  let s = _css.get(k);
  if (!s) { s = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; _css.set(k, s); }
  return s;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const randint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
/** затемнить (k<1) или осветлить (k>1) цвет */
const dim = (c, k) => C(c).map(v => clamp(Math.round(v * k), 0, 255));
/** смесь двух цветов, t от 0 до 1 */
const mix = (a, b, t) => { a = C(a); b = C(b); return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)); };
const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** порог матрицы Байера для пикселя (x, y): число от 0 до 1 */
const bay = (x, y) => B4[y & 3][x & 3] / 16 + 1 / 32;
/** треугольная волна 0..1..0 с периодом per кадров и фазой ph */
const tri = (f, per, ph) => Math.abs(2 * ((((f + (ph || 0)) % per) + per) % per / per) - 1);

/* ===================================================================== растровый слой */
class Layer {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); this._cv = null; this._cx = null; }
  clear() { this.d.fill(0); return this; }
  px(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (typeof c === 'string') c = C(c);
    const i = (y * this.w + x) << 2, d = this.d;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[((y * this.w + x) << 2) + 3] > 0; }
  erase(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[((y * this.w + x) << 2) + 3] = 0; }
  /** прямоугольник, границы включительно */
  rect(x0, y0, x1, y1, c) {
    c = C(c); x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.px(x, y, c);
  }
  hline(x0, x1, y, c) { this.rect(x0, y, x1, y, c); }
  vline(x, y0, y1, c) { this.rect(x, y0, x, y1, c); }
  /** эллипс в рамке (x0,y0)-(x1,y1), границы включительно, как в PIL */
  ellipseBox(x0, y0, x1, y1, c) {
    c = C(c);
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
  }
  /** круг с центром в пикселе (cx, cy) и радиусом r */
  disc(cx, cy, r, c) {
    c = C(c); const r2 = (r + .5) * (r + .5);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      const rem = r2 - (y - cy) * (y - cy); if (rem < 0) continue;
      const hw = Math.sqrt(rem);
      for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) this.px(x, y, c);
    }
  }
  eraseDisc(cx, cy, r) {
    const r2 = (r + .5) * (r + .5);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      const rem = r2 - (y - cy) * (y - cy); if (rem < 0) continue;
      const hw = Math.sqrt(rem);
      for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) this.erase(x, y);
    }
  }
  /** многоугольник: pts = [[x,y],...] */
  poly(pts, c) {
    c = C(c);
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const yc = y + .5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - .5); x <= Math.ceil(xs[k + 1] - .5) - 1; x++) this.px(x, y, c);
    }
  }
  /** линия в 1 пиксель (Брезенхэм) */
  line(x0, y0, x1, y1, c) {
    c = C(c);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** новый холст-снимок слоя (для статичных слоёв, строится один раз) */
  canvas() {
    const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.d), this.w, this.h), 0, 0);
    return cv;
  }
  /** нарисовать слой на ctx; для динамических спрайтов: clear(), рисуем, draw() */
  draw(ctx, dx, dy) {
    if (!this._cv) { this._cv = document.createElement('canvas'); this._cv.width = this.w; this._cv.height = this.h; this._cx = this._cv.getContext('2d'); }
    this._cx.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    ctx.drawImage(this._cv, dx || 0, dy || 0);
  }
}

/* ===================================================================== небо, свет */
/** вертикальный градиент полосами с дизерингом Байера; stops — цвета сверху вниз */
function gradient(L, stops, y0, y1) {
  const s = stops.map(C), n = s.length;
  for (let y = 0; y < L.h; y++) {
    const v = clamp((y - y0) / (y1 - y0), 0, 1) * (n - 1), base = Math.min(Math.floor(v), n - 2), fr = v - base;
    for (let x = 0; x < L.w; x++) L.px(x, y, s[base + (fr > bay(x, y) ? 1 : 0)]);
  }
}
/** свечение с дизерингом поверх непрозрачного слоя; levels — число ступеней яркости */
function addGlow(L, cx, cy, rin, rout, col, strength, levels, power) {
  col = C(col); levels = levels || 4; power = power || 1.5;
  const x0 = Math.max(0, Math.floor(cx - rout)), x1 = Math.min(L.w - 1, Math.ceil(cx + rout));
  const y0 = Math.max(0, Math.floor(cy - rout)), y1 = Math.min(L.h - 1, Math.ceil(cy + rout)), d = L.d;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const a = Math.pow(clamp((rout - Math.hypot(x - cx, y - cy)) / (rout - rin), 0, 1), power) * strength;
    if (a <= 0) continue;
    const q = clamp(Math.floor(a * levels + bay(x, y)) / levels, 0, 1);
    if (q <= 0) continue;
    const i = (y * L.w + x) << 2;
    d[i] = Math.round(d[i] * (1 - q) + col[0] * q); d[i + 1] = Math.round(d[i + 1] * (1 - q) + col[1] * q); d[i + 2] = Math.round(d[i + 2] * (1 - q) + col[2] * q);
  }
}
/** диск из колец: rings = [[радиус, цвет], ...] от большого к малому (солнце, луна) */
function sunDisc(L, cx, cy, rings) { for (const [r, c] of rings) L.disc(cx, cy, r, c); }

/* ===================================================================== рельеф */
/** волнистый хребет: возвращает функцию x -> y; amps = [[длина волны px, амплитуда], ...], отсчёт от центра экрана */
function makeRidge(xc, baseY, amps, seed) {
  const r = mulberry32(seed), ph = amps.map(() => r() * Math.PI * 2);
  return x => baseY + amps.reduce((s, [lam, a], i) => s + a * Math.sin(2 * Math.PI * (x - xc) / lam + ph[i]), 0);
}
/** острые вершины: peaks = [[u, высота, полуширина], ...] (u от центра); возвращает функцию x -> y */
function peakRidge(xc, baseY, peaks, seed, rough) {
  const r = mulberry32(seed), ph = [0, 1, 2].map(() => r() * 6.28), lam = [18, 10, 5.6];
  rough = rough == null ? 1.5 : rough;
  return x => {
    let top = 0;
    for (const [u, ph_, hw] of peaks) top = Math.max(top, ph_ * clamp(1 - Math.abs(x - (xc + u)) / hw, 0, 1));
    let n = 0; for (let k = 0; k < 3; k++) n += Math.sin(2 * Math.PI * (x - xc) / lam[k] + ph[k]);
    return baseY - top - (top > 0 ? n * rough * .5 : 0);
  };
}
/**
 * Холмы, дюны, горы: двухтоновая тень по склону, подсвеченная кромка, глубина дизерингом.
 * o: lit, shade, deep, rim — цвета; lightX — x источника света (-1e9 = справа/слева выключено); k — контраст склона;
 *    lean — наклон тени с глубиной; depth — на сколько строк темнеет к deep; sh — шаг для склона;
 *    snow: [светлый, тёмный] + snowDepth(x, topY) -> строк снега от вершины.
 */
function hill(L, hf, o) {
  o = Object.assign({ lean: .3, k: .8, depth: 20, sh: 3, lightX: -1e9 }, o);
  const lit = C(o.lit), shade = C(o.shade), deep = C(o.deep), rim = o.rim ? C(o.rim) : null;
  const snow = o.snow ? [C(o.snow[0]), C(o.snow[1])] : null;
  const M = 160, w = L.w, hh = L.h, Hs = new Int32Array(w + 2 * M);
  for (let i = 0; i < Hs.length; i++) Hs[i] = Math.round(hf(i - M));
  const sh = o.sh;
  for (let x = 0; x < w; x++) {
    const top = Hs[x + M], sd = snow && o.snowDepth ? o.snowDepth(x, top) : 0;
    for (let y = Math.max(0, top); y < hh; y++) {
      const d = y - top; if (d < 0) continue;
      const xs = x + Math.floor(d * o.lean), ix = clamp(xs + M, sh, Hs.length - 1 - sh);
      const hs = Hs[ix + sh] - Hs[ix - sh], side = xs < o.lightX ? 1 : -1;
      const la = clamp(.5 + side * hs * o.k, 0, 1), b = bay(x, y);
      let c = la > b ? lit : shade;
      if (clamp((d - 3) / o.depth, 0, 1) > b) c = deep;
      if (snow && d < sd) c = la > b ? snow[0] : snow[1];
      if (rim && d === 0 && la > .5) c = rim;
      L.px(x, y, c);
    }
  }
}
/** однотонный силуэт под линией hf, с необязательной светлой кромкой сверху */
function sil(L, hf, col, rim) {
  col = C(col); rim = rim ? C(rim) : null;
  for (let x = 0; x < L.w; x++) {
    const top = Math.round(hf(x));
    for (let y = Math.max(0, top); y < L.h; y++) L.px(x, y, rim && y === top ? rim : col);
  }
}
/** светлая кромка на стороне источника света: пиксели рядом с пустотой слева/справа от lightX */
function edgeLight(L, lightX, col) {
  col = C(col); const w = L.w, h = L.h, d = L.d, hit = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!d[((y * w + x) << 2) + 3]) continue;
    const eR = x + 1 >= w || !d[((y * w + x + 1) << 2) + 3], eL = x - 1 < 0 || !d[((y * w + x - 1) << 2) + 3];
    if (x < lightX ? eR : eL) hit.push((y * w + x) << 2);
  }
  for (const i of hit) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; }
}
/** светлая кромка по верхнему краю фигур */
function edgeTop(L, col) {
  col = C(col); const w = L.w, h = L.h, d = L.d, hit = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (d[((y * w + x) << 2) + 3] && (y === 0 || !d[(((y - 1) * w + x) << 2) + 3])) hit.push((y * w + x) << 2);
  for (const i of hit) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; }
}
/** позиции декора по одну сторону за пределами центра: startU — откуда, dir = -1|1, limit — до куда, шаг gmin..gmax */
function outward(startU, dir, limit, gmin, gmax, r) {
  const out = []; let u = startU;
  for (;;) { u += dir * (gmin + r() * (gmax - gmin)); if (Math.abs(u) > limit) break; out.push(u); }
  return out;
}

/* ===================================================================== облака, светила, звёзды */
/** облако (canvas): плоское дно, нижняя кромка color lit, верхняя top, тело body */
function makeCloud(w, h, seed, body, lit, top) {
  body = C(body); lit = C(lit); top = C(top);
  const r = mulberry32(seed), m = new Uint8Array(w * h), base = Math.floor(h * .72), n = Math.max(3, Math.floor(w / 12));
  const fillE = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry; if (dx * dx + dy * dy <= 1) m[y * w + x] = 1;
    }
  };
  for (let i = 0; i < n; i++) {
    const cx = randint(r, Math.floor(w * .16), Math.floor(w * .84));
    const rx = randint(r, Math.max(4, Math.floor(w / 10)), Math.max(6, Math.floor(w / 4)));
    let ry = randint(r, Math.max(2, Math.floor(h / 4)), Math.max(3, Math.floor(h * .6)));
    ry = Math.floor(ry * (1 - .5 * Math.abs(cx - w / 2) / (w / 2))) + 2;
    fillE(cx + .5, base + .5, rx, ry);
  }
  for (let y = base - 2; y <= base; y++) for (let x = Math.floor(w * .1); x <= Math.floor(w * .9); x++) if (y >= 0) m[y * w + x] = 1;
  for (let y = base + 1; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = 0;
  const L = new Layer(w, h);
  for (let x = 0; x < w; x++) {
    let below = 0, above = 0;
    for (let y = h - 1; y >= 0; y--) if (m[y * w + x]) below++;
    let b = below;
    for (let y = 0; y < h; y++) {
      if (!m[y * w + x]) continue;
      above++;
      let c = body;
      if (b <= 2 || (b === 3 && bay(x, y) > .5)) c = lit;
      if (above === 1) c = top;
      L.px(x, y, c); b--;
    }
  }
  return L.canvas();
}
/**
 * Ряд плывущих облаков. o: sizes [[w,h],...], seed, cols [body, lit, top], y, v (пикселей за кадр, можно дробно),
 * gap (расстояние между облаками), off (сдвиг). Рисовать: drawCloudRows(ctx, rows, f, W).
 */
function cloudRow(o) {
  const r = mulberry32((o.seed | 0) + 977);
  return {
    sprs: o.sizes.map(([w, h], i) => makeCloud(w, h, o.seed + i * 7, o.cols[0], o.cols[1], o.cols[2])),
    margin: Math.max.apply(null, o.sizes.map(s => s[0])) + 2,
    y: o.y, v: o.v, gap: o.gap, off: o.off || 0,
    pick: Array.from({ length: 16 }, () => Math.floor(r() * o.sizes.length)),
    jit: Array.from({ length: 16 }, () => Math.round((r() - .5) * o.gap * .5)),
  };
}
function drawCloudRows(ctx, rows, f, W) {
  for (const row of rows) {
    const n = Math.ceil((W + row.margin) / row.gap), P = n * row.gap;
    for (let i = 0; i < n; i++) {
      const x = (((i * row.gap + row.jit[i % 16] + row.off + row.v * f) % P) + P) % P - row.margin;
      ctx.drawImage(row.sprs[row.pick[i % 16]], Math.round(x), row.y);
    }
  }
}
/** луна (canvas); crescent=true — месяц. cols = [край, тело, блик, (кратеры)] */
function moonSprite(r, cols, crescent) {
  cols = cols.map(C);
  const s = 2 * r + 6, c = s >> 1, o = Math.max(1, Math.floor(r / 6)), L = new Layer(s, s);
  L.ellipseBox(c - r, c - r, c + r, c + r, cols[0]);
  L.ellipseBox(c - r, c - r, c + r - o, c + r - o, cols[1]);
  L.ellipseBox(c - r + 1, c - r + 1, c + r - 2 * o, c + r - 2 * o, cols[2]);
  if (crescent !== false) {
    const cutX = c + r * .75 + .5, cutY = c - r * .2 + .5;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++)
      if (Math.hypot(x + .5 - cutX, y + .5 - cutY) <= r + .5) L.erase(x, y);
  } else {
    for (const [dx, dy, rr] of [[-.35, -.25, .22], [.25, .2, .17], [-.2, .45, .12], [.45, -.4, .12]])
      L.ellipseBox(Math.round(c + dx * r - Math.max(1, Math.floor(r * rr))), Math.round(c + dy * r - Math.max(1, Math.floor(r * rr))),
        Math.round(c + dx * r + Math.max(1, Math.floor(r * rr))), Math.round(c + dy * r + Math.max(1, Math.floor(r * rr))), cols[3] || cols[1]);
  }
  return L.canvas();
}
const STAR_PAL = [null, '#6f69b0', '#bfb8f0', '#ffffff'];
/** звёзды: [x, y, фаза, период]; o.ymin, o.avoid(x,y)->true чтобы пропустить */
function makeStars(r, n, W, ymax, o) {
  o = o || {}; const ymin = o.ymin || 0, out = []; let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const x = Math.floor(r() * W), y = ymin + Math.floor(r() * (ymax - ymin));
    if (o.avoid && o.avoid(x, y)) continue;
    out.push([x, y, Math.floor(r() * 128), [16, 32, 32, 64, 128][Math.floor(r() * 5)]]);
  }
  return out;
}
function drawStars(ctx, stars, f, pal) {
  pal = pal || STAR_PAL;
  for (const [x, y, ph, per] of stars) {
    const lv = tri(f, per, ph), k = lv < .2 ? 0 : lv < .5 ? 1 : lv < .8 ? 2 : 3;
    if (k) { ctx.fillStyle = css(pal[k]); ctx.fillRect(x, y, 1, 1); }
  }
}
/** крупные мерцающие «крестики»: [x, y, фаза, период] */
function makeSparkles(r, n, W, ymin, ymax) {
  return Array.from({ length: n }, () => [Math.floor(8 + r() * (W - 16)), ymin + Math.floor(r() * (ymax - ymin)), Math.floor(r() * 128), [32, 64][Math.floor(r() * 2)]]);
}
function drawSparkles(ctx, sp, f, col) {
  ctx.fillStyle = css(col || '#ffffff');
  for (const [x, y, ph, per] of sp) if (tri(f, per, ph) > .55) { ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x, y - 2, 1, 5); }
}

/* ===================================================================== частицы */
/**
 * Светлячки, искры, пылинки. o: x0,x1 (по умолчанию 0..W), y0,y1, colors, rise (пикселей за кадр вверх, 0 = парят),
 * amp: [мин, макс] качание по x, big — доля «крестиков».
 */
function makeMotes(r, n, W, o) {
  const x0 = o.x0 || 0, x1 = o.x1 == null ? W : o.x1;
  return Array.from({ length: n }, () => ({
    x: x0 + r() * (x1 - x0), y: o.y0 + r() * (o.y1 - o.y0), y0: o.y0, y1: o.y1, rise: o.rise || 0,
    amp: randint(r, (o.amp || [2, 5])[0], (o.amp || [2, 5])[1]), per: pick(r, [60, 120]), ph: r(), tp: pick(r, [20, 24, 30, 40, 60]),
    tph: Math.floor(r() * 128), col: C(pick(r, o.colors)), big: r() < (o.big == null ? .2 : o.big) }));
}
function drawMotes(ctx, motes, f) {
  for (const m of motes) {
    const x = Math.round(m.x + m.amp * Math.sin(2 * Math.PI * (f / m.per + m.ph)));
    const span = m.y1 - m.y0;
    const y = Math.round(m.rise ? m.y0 + ((((m.y - m.y0 - m.rise * f) % span) + span) % span) : m.y + m.amp * .5 * Math.cos(2 * Math.PI * (f / m.per + m.ph)));
    const lv = tri(f, m.tp, m.tph);
    if (lv < .25) continue;
    const c = lv > .55 ? m.col : dim(m.col, .55);
    ctx.fillStyle = css(c); ctx.fillRect(x, y, 1, 1);
    if (m.big && lv > .55) {
      ctx.fillStyle = css(dim(m.col, .6));
      ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
    }
  }
}
/** птица-«галочка»; flap — взмах вверх/вниз (булево) */
function drawBird(ctx, x, y, flap, col) {
  ctx.fillStyle = css(col || '#2a1c48');
  const pts = flap ? [[-2, -1], [-1, 0], [0, 1], [1, 0], [2, -1]] : [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1]];
  for (const [dx, dy] of pts) ctx.fillRect(x + dx, y + dy, 1, 1);
}
/** закрашенный круг пикселями прямо на ctx (центр в пикселе cx, cy) */
function fillDisc(ctx, cx, cy, r, col) {
  ctx.fillStyle = css(col); const r2 = (r + .5) * (r + .5);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const rem = r2 - (y - cy) * (y - cy); if (rem < 0) continue;
    const hw = Math.sqrt(rem), x0 = Math.ceil(cx - hw), x1 = Math.floor(cx + hw);
    if (x1 >= x0) ctx.fillRect(x0, y, x1 - x0 + 1, 1);
  }
}
/**
 * Столб дыма из кругов, цвет зависит от возраста. o: n, rise, cols[], per (кадров на жизнь), sway, r0, r1, wind.
 */
function smokeColumn(ctx, x, y, f, o) {
  const n = o.n || 5, per = o.per || 120, cols = o.cols || ['#8a7a90', '#6a5a70', '#4a3c56'];
  for (let i = 0; i < n; i++) {
    const age = (((f + i * per / n) % per) + per) % per / per;
    const px = x + (o.sway == null ? 3 : o.sway) * Math.sin(2 * Math.PI * (age * 1.3 + i * .37)) * (.3 + age) + (o.wind || 0) * age;
    const py = y - (o.rise || 34) * age, r = (o.r0 == null ? 1 : o.r0) + ((o.r1 == null ? 4 : o.r1) - (o.r0 == null ? 1 : o.r0)) * age;
    fillDisc(ctx, Math.round(px), Math.round(py), Math.round(r * 2) / 2, cols[Math.min(cols.length - 1, Math.floor(age * cols.length))]);
  }
}

/* ===================================================================== наложения с прозрачностью (без чтения с холста) */
class Overlay {
  constructor(w, h) {
    this.w = w; this.h = h; this.img = new ImageData(w, h); this.d = this.img.data;
    this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h; this.cx = this.cv.getContext('2d');
  }
  clear() { this.d.fill(0); }
  /** заменить пиксель; a от 0 до 1 */
  set(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    c = C(c); const i = (y * this.w + x) << 2, d = this.d;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a * 255;
  }
  /** положить поверх уже нарисованного (обычное «source-over») */
  over(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    c = C(c); const i = (y * this.w + x) << 2, d = this.d, A = d[i + 3] / 255;
    if (A === 0) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a * 255; return; }
    const oa = a + A * (1 - a), k = A * (1 - a);
    d[i] = (c[0] * a + d[i] * k) / oa; d[i + 1] = (c[1] * a + d[i + 1] * k) / oa; d[i + 2] = (c[2] * a + d[i + 2] * k) / oa; d[i + 3] = oa * 255;
  }
  /** вывести на ctx (можно только прямоугольник x0..x1, y0..y1) и очистить его */
  flush(ctx, x0, y0, x1, y1) {
    x0 = x0 || 0; y0 = y0 || 0; x1 = x1 == null ? this.w : x1; y1 = y1 == null ? this.h : y1;
    if (x1 <= x0 || y1 <= y0) return;
    this.cx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(this.cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    for (let y = y0; y < y1; y++) this.d.fill(0, ((y * this.w + x0) << 2), ((y * this.w + x1) << 2));
  }
}
/**
 * Плывущий туман в полосе. o: y0, y1, color, strength (0..1), lam [длины волн px], speed (px за кадр),
 * levels, power, fade 'down'|'up'|'mid', x0, x1.
 */
function fog(ov, f, o) {
  const y0 = o.y0, y1 = Math.min(o.y1, ov.h), lam = o.lam || [64, 43], speed = o.speed == null ? 1 : o.speed;
  const levels = o.levels || 3, power = o.power == null ? 1.2 : o.power, str = o.strength == null ? .5 : o.strength, fade = o.fade || 'down';
  const col = C(o.color), x0 = o.x0 || 0, x1 = o.x1 == null ? ov.w : o.x1, TP = 2 * Math.PI;
  for (let y = y0; y < y1; y++) {
    const u = clamp((y - y0) / Math.max(1, y1 - y0), 0, 1);
    const env = Math.pow(fade === 'down' ? u : fade === 'up' ? 1 - u : 1 - Math.abs(2 * u - 1), power);
    if (env <= 0) continue;
    for (let x = x0; x < x1; x++) {
      const sx = x - speed * f;
      const v = (.5 + .5 * Math.cos(TP * (sx / lam[0] + y * .02))) * .6 + (.5 + .5 * Math.cos(TP * (sx / lam[1] - y * .03 + .7))) * .4;
      const a = clamp(Math.floor(str * v * env * levels + bay(x, y)) / levels, 0, 1);
      if (a > 0) ov.set(x, y, col, a);
    }
  }
}
/** пульсирующее круглое свечение. o: per, ph, strength, lo */
function glowPulse(ov, cx, cy, r, color, f, o) {
  o = o || {}; const per = o.per || 60, lo = o.lo == null ? .6 : o.lo, st = o.strength == null ? .75 : o.strength;
  const pulse = lo + (1 - lo) * (.5 + .5 * Math.sin(2 * Math.PI * (f + (o.ph || 0)) / per));
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(ov.h, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(ov.w, Math.ceil(cx + r)); x++) {
      const a = Math.pow(clamp((r - Math.hypot(x - cx, y - cy)) / Math.max(1, r - 2), 0, 1), 1.6) * st * pulse;
      const q = clamp(Math.floor(a * 4 + bay(x, y)) / 4, 0, 1);
      if (q > 0) ov.over(x, y, color, q);
    }
}
/**
 * Волны: гребни рядами, ближе к зрителю реже и крупнее. o: y0, y1, hi (цвет гребня), lo (цвет тени под гребнем),
 * lam0 (длина волны у горизонта, px), lam1 (у зрителя), gap0, dgap, thr, aHi, aLo, speed (px за кадр, база).
 */
function waves(ov, f, o) {
  const y0 = o.y0, y1 = Math.min(o.y1, ov.h), lam0 = o.lam0 || 4.6, lam1 = o.lam1 || 25, gap0 = o.gap0 || 3, dgap = o.dgap == null ? .35 : o.dgap;
  const thr = (o.thr == null ? .35 : o.thr) * 1.6, aHi = o.aHi == null ? .6 : o.aHi, aLo = o.aLo == null ? .4 : o.aLo, spd = o.speed == null ? 1.07 : o.speed;
  const hi = C(o.hi), lo = o.lo ? C(o.lo) : null, TP = 2 * Math.PI, W = ov.w, on = new Uint8Array(W);
  let y = y0, i = 0;
  while (y < y1) {
    const yi = Math.round(y), fr = (yi - y0) / Math.max(1, y1 - y0);
    const lam = lam0 + (lam1 - lam0) * fr, lam2 = lam * 2, k = 1 + (i % 2), ph = i * .37;
    for (let x = 0; x < W; x++) {
      const v = Math.sin(TP * ((x - k * spd * f) / lam + ph)) + .6 * Math.sin(TP * ((x - spd * f) / lam2 + ph * 1.7));
      on[x] = v > thr ? 1 : 0;
      if (on[x] && yi < y1) ov.over(x, yi, hi, aHi);
    }
    if (lo && yi + 1 < y1 && fr > .2) for (let x = 1; x < W; x++) if (on[x - 1]) ov.over(x, yi + 1, lo, aLo);
    y += gap0 + dgap * i; i++;
  }
}
/** блики лунной/солнечной дорожки на воде. cx — центр дорожки, w0/w1 — полуширина у горизонта/у зрителя */
function glitter(ov, f, cx, y0, y1, w0, w1, color, o) {
  o = o || {}; const thr = o.thr == null ? 1.25 : o.thr, al = o.alpha == null ? .9 : o.alpha, TP = 2 * Math.PI;
  y1 = Math.min(y1, ov.h);
  for (let y = y0; y < y1; y++) {
    const hw = w0 + (w1 - w0) * clamp((y - y0) / Math.max(1, y1 - y0), 0, 1);
    for (let x = Math.max(0, Math.floor(cx - hw)); x < Math.min(ov.w, Math.ceil(cx + hw)); x++) {
      const v = Math.sin(x * 2.1 + y * 1.37 + TP * 3 * f / 120) + Math.sin(x * .8 - y * 2.9 - TP * 2 * f / 120);
      if (v > thr) ov.over(x, y, color, al);
    }
  }
}
/**
 * Северное сияние. o: ribbons [{yc, amp, kx, sk, wid, strength, color, ph}], h (высота области), xc (центр).
 * kx — число изгибов на 128 px, sk — целая скорость (оборотов за 12 с).
 */
function aurora(ov, f, o) {
  const W = ov.w, xc = o.xc == null ? W / 2 : o.xc, hmax = Math.min(o.h, ov.h), TP = 2 * Math.PI;
  for (const rb of o.ribbons) {
    const col = C(rb.color);
    for (let x = 0; x < W; x++) {
      const xr = (x - xc) / 128, th = TP * (rb.kx * xr + rb.sk * f / 120) + rb.ph;
      const cy = rb.yc + rb.amp * Math.sin(th) + .45 * rb.amp * Math.sin(2 * th + 1.3);
      const en = .35 + .65 * (.5 + .5 * Math.sin(TP * (2 * xr + rb.sk * f / 120) + rb.ph * 1.7));
      const rays = .8 + .2 * Math.sin(TP * (20 * xr + rb.sk * f / 120));
      for (let y = 0; y < hmax; y++) {
        const u = (cy - y) / rb.wid;
        if (u < -.8 || u > 3) continue;
        const a = rb.strength * (u >= 0 ? Math.exp(-u * 1.3) : Math.exp(-(u * 3.5) * (u * 3.5))) * en * rays;
        if (a < .03) continue;
        const q = clamp(Math.floor(a * 4 + bay(x, y)) / 4, 0, 1);
        if (q > 0) ov.over(x, y, col, q);
      }
    }
  }
}
/** марево: строки полосы y0..y1 сдвигаются волной. tmp — вспомогательный canvas шириной W (создать один раз) */
function shimmer(ctx, tmp, f, y0, y1, o) {
  o = o || {}; const W = ctx.canvas.width, bh = y1 - y0, amp = o.amp == null ? 1.2 : o.amp, per = o.per || 4, spd = o.spd || 24;
  if (tmp.height < bh) tmp.height = bh;
  const tc = tmp.getContext('2d'); tc.clearRect(0, 0, W, tmp.height); tc.drawImage(ctx.canvas, 0, y0, W, bh, 0, 0, W, bh);
  for (let i = 0; i < bh; i++) {
    const sh = Math.round(amp * Math.sin(2 * Math.PI * ((y0 + i - (o.dy || 0)) / per - f / spd)));
    if (!sh) continue;
    ctx.drawImage(tmp, 0, i, W, 1, sh, y0 + i, W, 1);
    ctx.drawImage(tmp, 0, i, W, 1, sh > 0 ? sh - W : sh + W, y0 + i, W, 1);
  }
}

/* ===================================================================== деревья и предметы */
/** силуэт ёлки: x — центр, base — земля, h — высота */
function pine(L, x, base, h, col, rim, w, tiers) {
  w = w || Math.max(7, Math.floor(h / 2)); tiers = tiers || Math.max(3, Math.floor(h / 8));
  L.rect(x - 1, base - 3, x, base, col);
  const step = (h - 3) / tiers;
  for (let i = 0; i < tiers; i++) {
    const yt = base - h + i * step, yb = yt + step * 1.7, wi = Math.max(2, w * (i + 1) / tiers);
    L.poly([[x - wi / 2, yb], [x + wi / 2, yb], [x, yt]], col);
    if (rim) L.line(x, yt, x - wi / 2, yb, rim);
  }
}
/** пальма: ствол с изгибом lean, крона из 6 листьев длиной flen */
function palm(L, x, y, h, col, lean, flen) {
  let tx = 0, ty = 0;
  for (let i = 0; i < h; i++) { tx = x + lean * Math.pow(i / h, 2); ty = y - i; L.rect(Math.round(tx), Math.round(ty), Math.round(tx) + 1, Math.round(ty), col); }
  for (const ang of [195, 225, 255, 285, 315, 345]) {
    const a = ang * Math.PI / 180;
    for (let i = 1; i < flen; i++) {
      const fx = tx + Math.cos(a) * i, fy = ty + Math.sin(a) * i * .55 + (i * i) / 38;
      L.px(Math.round(fx), Math.round(fy), col); L.px(Math.round(fx), Math.round(fy) + 1, col);
    }
  }
}
/** ромб-кристалл, нижняя вершина в (ax, ay); три цвета: свет, середина, тень */
function crystalGem(L, ax, ay, hi, mid, dk, h, w) {
  h = h || 6; w = w || 2;
  L.poly([[ax, ay - h], [ax + w, ay - h / 2], [ax, ay], [ax - w, ay - h / 2]], mid);
  L.poly([[ax, ay - h], [ax + w, ay - h / 2], [ax, ay - h / 2]], hi);
  L.poly([[ax, ay], [ax + w, ay - h / 2], [ax, ay - h / 2]], dk);
}
/** шестерня на RGBA-слое (дырки прозрачные). Поворот на кратное 2π/teeth даёт бесшовный круг. o: spokes, toothH, ring, hi, hub */
function gear(L, cx, cy, r, teeth, ang, col, o) {
  o = o || {}; const n = teeth * 4, pts = [], toothH = o.toothH == null ? 2 : o.toothH, ring = o.ring == null ? 3 : o.ring;
  for (let i = 0; i < n; i++) {
    const a = ang + 2 * Math.PI * i / n, rr = r + ((i % 4 === 1 || i % 4 === 2) ? toothH : 0);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  L.poly(pts, col);
  L.eraseDisc(Math.round(cx), Math.round(cy), Math.max(1, r - ring));
  const spokes = o.spokes == null ? 6 : o.spokes;
  for (let k = 0; k < spokes; k++) {
    const a = ang + 2 * Math.PI * k / spokes;
    L.line(cx, cy, cx + (r - ring + 1) * Math.cos(a), cy + (r - ring + 1) * Math.sin(a), col);
  }
  L.disc(Math.round(cx), Math.round(cy), Math.max(1, Math.floor(r / 4)), o.hub || col);
  if (o.hi) for (let d = 190; d <= 270; d += 6) L.px(Math.round(cx + (r + 1) * Math.cos(d * Math.PI / 180)), Math.round(cy + (r + 1) * Math.sin(d * Math.PI / 180)), o.hi);
}

/* ===================================================================== реестр сцен и запуск */
const registry = Object.create(null);
function register(name, builder) { registry[name] = builder; }
function scenes() { return Object.keys(registry); }
/** день или ночь по часу 0..24; по умолчанию день с 7:00 до 19:00 */
function pickVariant(hour, o) {
  o = o || {}; const ds = o.dayStart == null ? 7 : o.dayStart, ns = o.nightStart == null ? 19 : o.nightStart;
  return hour >= ds && hour < ns ? 'day' : 'night';
}
function localHour(d) { d = d || new Date(); return d.getHours() + d.getMinutes() / 60; }

const PX = { mulberry32, C, css, clamp, lerp, randint, pick, dim, mix, bay, tri, Layer, Overlay,
  gradient, addGlow, sunDisc, makeRidge, peakRidge, hill, sil, edgeLight, edgeTop, outward,
  makeCloud, cloudRow, drawCloudRows, moonSprite, STAR_PAL, makeStars, drawStars, makeSparkles, drawSparkles,
  makeMotes, drawMotes, drawBird, fillDisc, smokeColumn, fog, glowPulse, waves, glitter, aurora, shimmer,
  pine, palm, crystalGem, gear };

function makeEnv(W, H, S, variant) {
  const dy = H - DESIGN_H, sc = H / DESIGN_H, xc = W / 2;
  return { W, H, S, dy, sc, xc, variant, night: variant === 'night', day: variant === 'day',
    Y: y => Math.round(y + dy), Ys: y => Math.round(y * sc), U: u => Math.round(xc + u), limit: xc + 70, px: PX };
}

/**
 * Запуск фона в контейнере (position:relative/absolute/fixed и свой размер).
 * Опции: location, time ('auto'|'day'|'night'), getHour (функция внутриигровых часов 0..24), dayStart (7), nightStart (19),
 *        fps (10), fade (мс перехода, 1200; 0 = без), followClock (true: фон сам перейдёт день→ночь, если время суток сменилось,
 *        пока игрок в локации; false: вариант выбирается только при входе), reducedMotion ('respect'|'ignore'),
 *        frame (число: заморозить кадр, для отладки), onChange({location, variant}).
 */
function mount(container, opts) {
  if (typeof container === 'string') container = document.querySelector(container);
  const o = Object.assign({ location: null, time: 'auto', getHour: null, dayStart: 7, nightStart: 19, fps: FPS, fade: 1200,
    followClock: true, reducedMotion: 'respect', frame: null, onChange: null }, opts || {});
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.style.overflow = 'hidden';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;bottom:0;left:0;display:block;image-rendering:pixelated;image-rendering:crisp-edges;';
  container.appendChild(cv);
  let ctx = null, scene = null, W = 0, H = 0, S = 1, loc = o.location, timeMode = o.time, manualHour = null, variant = 'night';
  let lastF = -1, msAvg = 0, raf = 0, paused = false, timer = 0, broken = false, dead = false;
  let lastKey = '';
  const reduce = () => o.reducedMotion === 'respect' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hour = () => manualHour != null ? manualHour : (o.getHour ? o.getHour() : localHour());
  const wantVariant = () => timeMode === 'auto' ? pickVariant(hour(), o) : timeMode;

  function fadeFromSnapshot() {
    if (!o.fade || !ctx || !W) return;
    const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
    snap.getContext('2d').drawImage(cv, 0, 0);
    snap.style.cssText = cv.style.cssText + 'pointer-events:none;opacity:1;transition:opacity ' + o.fade + 'ms linear;';
    snap.style.width = cv.style.width; snap.style.height = cv.style.height; snap.style.left = cv.style.left;
    container.appendChild(snap);
    requestAnimationFrame(() => requestAnimationFrame(() => { snap.style.opacity = '0'; }));
    setTimeout(() => snap.remove(), o.fade + 100);
  }
  function build(withFade) {
    if (!W || !loc) return;
    const builder = registry[loc];
    if (!builder) { console.error('PixelBG: сцена «' + loc + '» не зарегистрирована (подключите scenes/' + loc + '.js)'); return; }
    if (withFade) fadeFromSnapshot();
    variant = wantVariant();
    try { scene = builder(makeEnv(W, H, S, variant)); broken = false; }
    catch (e) { console.error('PixelBG: ошибка сборки сцены «' + loc + '» (' + variant + ')', e); scene = null; }
    lastF = -1; msAvg = 0;
    if (o.onChange) o.onChange({ location: loc, variant });
  }
  function layout() {
    const r = container.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const devW = Math.round(r.width * dpr), devH = Math.round(r.height * dpr);
    if (devW < 8 || devH < 8) return;
    const key = devW + 'x' + devH;
    if (key === lastKey && scene) return;   // ResizeObserver срабатывает сразу после запуска: не собираем сцену второй раз зря
    lastKey = key;
    S = Math.max(1, Math.round(devH / DESIGN_H)); W = Math.ceil(devW / S); H = Math.ceil(devH / S);
    cv.width = W; cv.height = H;
    cv.style.width = (W * S / dpr) + 'px'; cv.style.height = (H * S / dpr) + 'px';
    cv.style.left = (Math.round((devW - W * S) / 2) / dpr) + 'px';
    ctx = cv.getContext('2d', { alpha: false }); ctx.imageSmoothingEnabled = false;
    build(false);
  }
  function drawFrame(f) {
    const t0 = performance.now();
    scene.draw(ctx, f);
    msAvg = msAvg ? msAvg * .9 + (performance.now() - t0) * .1 : performance.now() - t0;
  }
  function tick(now) {
    if (dead) return;
    raf = requestAnimationFrame(tick);
    if (paused || !scene || broken) return;
    const f = o.frame != null ? o.frame : Math.floor(now / (1000 / o.fps));
    if (f === lastF) return;
    lastF = f;
    try { drawFrame(reduce() ? 0 : f); } catch (e) { broken = true; console.error('PixelBG: ошибка кадра в «' + loc + '»', e); }
  }
  let rz = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layout); }) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', layout);
  // followClock: если игрок остался в локации, когда день сменился вечером, фон плавно перейдёт сам; false = выбор только при входе
  timer = setInterval(() => { if (o.followClock && timeMode === 'auto' && wantVariant() !== variant) build(true); }, 15000);
  layout();
  raf = requestAnimationFrame(tick);

  return {
    setLocation(name, opt) { if (name === loc) return; loc = name; build(!opt || opt.fade !== false); },
    setTime(mode) { timeMode = mode; if (wantVariant() !== variant) build(true); },
    setHour(h) { manualHour = h; if (timeMode === 'auto' && wantVariant() !== variant) build(true); },
    resize: layout,
    pause() { paused = true; }, resume() { paused = false; },
    destroy() { dead = true; cancelAnimationFrame(raf); clearInterval(timer); if (ro) ro.disconnect(); cv.remove(); },
    get variant() { return variant; }, get location() { return loc; },
    get info() { return { W, H, S, variant, location: loc, ms: msAvg }; },
    /** среднее время отрисовки кадра в мс по n кадрам (для проверки скорости) */
    bench(n) { n = n || 30; if (!scene) return NaN; const t0 = performance.now(); for (let i = 0; i < n; i++) scene.draw(ctx, 1000 + i); return (performance.now() - t0) / n; },
    /** нарисовать конкретный кадр сейчас */
    drawAt(f) { if (scene) { scene.draw(ctx, f); } },
    canvas: cv,
  };
}

root.PixelBG = { version: '1.0', FPS, DESIGN_H, register, mount, scenes, pickVariant, localHour, px: PX };
})(typeof window !== 'undefined' ? window : globalThis);

;/* ===== локация: desert ===== */
/* Пустыня: ночь = закат с луной и звёздами, день = яркое небо и высокое солнце.
 * Эталонная сцена: по ней видно, как устроены обе версии и привязка к экрану. */
PixelBG.register('desert', function (env) {
  const { W, H, dy, Y, Ys, U, limit, night, px } = env;
  const { C, css, Layer, mulberry32, randint, gradient, addGlow, sunDisc, makeRidge, hill, edgeLight, outward,
    cloudRow, drawCloudRows, moonSprite, makeStars, drawStars, shimmer, drawBird, palm } = px;
  const r = mulberry32(7);

  /* ---------- палитры двух вариантов ---------- */
  const P = night ? {
    sky: ['#150f3a', '#241553', '#3d1c68', '#66247a', '#9a3a82', '#cf5a76', '#f0825f', '#ffb067', '#ffd88a'],
    butte: '#8d3b80', butteRim: '#d0607a',
    far: { lit: '#a64880', shade: '#7a3578', deep: '#5a2a6a', rim: '#ffa070' },
    mid: { lit: '#d4684f', shade: '#6e2d62', deep: '#3e1d4e', rim: '#ffc27a' },
    ground: { lit: '#4a2350', shade: '#2a1340', deep: '#1a0c2e', rim: '#8a4268' },
    palm: '#4a2064', cactus: '#170a2a', cactusRim: '#d0607a', rock: '#170a2a',
    sand: ['#ffd9a0', '#ffd9a0', '#ffb878'],
  } : {
    sky: ['#2c74d6', '#3d86e2', '#5499ea', '#71b0f0', '#94c8f4', '#b6dcf4', '#d9ecf0', '#f6f0d4'],
    butte: '#c47a50', butteRim: '#f2ae7e',
    far: { lit: '#f0c070', shade: '#c98d58', deep: '#a8704e', rim: '#fbe0a0' },
    mid: { lit: '#f7d488', shade: '#d6a05c', deep: '#b9834c', rim: '#ffeab0' },
    ground: { lit: '#e6b86c', shade: '#c08a54', deep: '#a26f48', rim: '#ffe0a0' },
    palm: '#2a7a3a', cactus: '#3c8a43', cactusHi: '#9ad86c', cactusDk: '#235f30', rock: '#a8765a', rockHi: '#e0b088',
    sand: ['#fff0c0', '#ffe6a8', '#fffadc'],
  };

  /* ---------- мелкие рисовалки пустыни ---------- */
  function saguaro(L, x, y, h, col, arms, tw = 2) {
    L.rect(x - tw, y - h + 3, x + tw, y, col);
    L.ellipseBox(x - tw, y - h, x + tw, y - h + 6, col);
    for (const [side, ay, ln, ah] of arms) {
      const yy = y - Math.floor(h * ay), xe = x + side * (tw + ln), xa = Math.min(x + side * tw, xe), xb = Math.max(x + side * tw, xe);
      L.rect(xa, yy, xb, yy + 2, col);
      L.rect(xe - 1, yy - ah, xe + 1, yy + 2, col);
      L.ellipseBox(xe - 1, yy - ah - 1, xe + 1, yy - ah + 2, col);
    }
  }
  function butte(L, cx, base, w, h, col, rim) {
    const l = cx - (w >> 1), rr = cx + (w >> 1);
    L.poly([[l - 3, base + 24], [l + 1, base - Math.floor(h * .55)], [l + 4, base - Math.floor(h * .55)], [l + 6, base - h],
      [rr - 6, base - h], [rr - 4, base - Math.floor(h * .6)], [rr + 1, base - Math.floor(h * .5)], [rr + 4, base + 24]], col);
    L.line(rr + 1, base - Math.floor(h * .5), rr - 4, base - Math.floor(h * .6), rim);
    L.line(rr - 4, base - Math.floor(h * .6), rr - 6, base - h, rim);
  }
  function edgeShade(L, lightX, col) {        // тёмная кромка на стороне, противоположной свету
    col = C(col); const d = L.d, w = L.w, hit = [];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < w; x++) {
      if (!d[((y * w + x) << 2) + 3]) continue;
      const eR = x + 1 >= w || !d[((y * w + x + 1) << 2) + 3], eL = x - 1 < 0 || !d[((y * w + x - 1) << 2) + 3];
      if (x < lightX ? eL : eR) hit.push((y * w + x) << 2);
    }
    for (const i of hit) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; }
  }

  /* ---------- небо и солнце ---------- */
  const sunX = U(22), sunY = night ? Y(134) : Ys(46);
  const sky = new Layer(W, H);
  gradient(sky, P.sky, 0, Y(142));
  if (night) {
    addGlow(sky, sunX, sunY, 14, 70, '#ff9a5c', .95, 5, 1.5);
    addGlow(sky, sunX, sunY, 14, 130, '#ff6f7a', .45, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[17, '#ffd88a'], [15, '#ffe7a3'], [11, '#fff3c8']]);
  } else {
    addGlow(sky, sunX, sunY, 10, 78, '#fff6c8', .9, 5, 1.6);
    addGlow(sky, sunX, sunY, 10, 150, '#ffffff', .22, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[12, '#ffe27a'], [10, '#fff0a0'], [8, '#fffbe0']]);
  }
  const skyC = sky.canvas();

  /* ---------- луна и звёзды (ночь) ---------- */
  const moon = night ? moonSprite(8, ['#c8b8e8', '#efe6ff', '#ffffff'], true) : null;
  const moonX = U(-34), moonY = Ys(34);
  const stars = night ? makeStars(r, Math.round(46 * W / 128), W, Ys(84), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 12 }) : [];

  /* ---------- облака ---------- */
  const rows = night ? (() => {
    const hi = ['#4b2470', '#c8607e', '#8a3f92'], lo = ['#7a3584', '#ffa070', '#c45a8c'];
    return [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 1, cols: hi, y: Ys(16), v: .53, gap: 104, off: 6 }),
      cloudRow({ sizes: [[36, 9], [48, 10], [30, 8]], seed: 12, cols: hi, y: Ys(52), v: .53, gap: 96, off: 52 }),
      cloudRow({ sizes: [[40, 10], [30, 8], [48, 9]], seed: 23, cols: lo, y: Ys(86), v: 1.07, gap: 132, off: 14 }),
      cloudRow({ sizes: [[30, 8], [42, 10], [36, 9]], seed: 34, cols: lo, y: Ys(108), v: 1.07, gap: 120, off: 76 }),
    ];
  })() : (() => {
    const wh = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    return [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 5, cols: wh, y: Ys(14), v: .35, gap: 112, off: 20 }),
      cloudRow({ sizes: [[36, 9], [48, 10], [30, 8]], seed: 16, cols: wh, y: Ys(48), v: .6, gap: 104, off: 66 }),
      cloudRow({ sizes: [[40, 10], [30, 8], [48, 9]], seed: 27, cols: wh, y: Ys(84), v: .9, gap: 128, off: 10 }),
    ];
  })();

  /* ---------- дальний план: мезы, дюны, пальмы ---------- */
  const far = new Layer(W, H), rb = mulberry32(11);
  const buttes = [{ u: -44, w: 26, h: 14 }, { u: 0, w: 16, h: 8 }, { u: 42, w: 30, h: 20 }];
  for (const [s0, d] of [[-44, -1], [42, 1]]) for (const u of outward(s0, d, limit, 54, 96, rb)) buttes.push({ u, w: randint(rb, 18, 34), h: randint(rb, 8, 24) });
  for (const b of buttes) butte(far, U(b.u), Y(146), b.w, b.h, P.butte, P.butteRim);
  const hFar = makeRidge(W / 2, Y(146), [[128, 4], [64, 3], [43, 1.5], [256, 3]], 11);
  hill(far, hFar, Object.assign({ lightX: sunX, k: .8, lean: .3, depth: 20 }, P.far));
  for (const [u, ph, lean] of [[-12, 22, -5], [-6, 17, 4], [-18, 14, -3], [-176, 17, 4], [-170, 13, -3], [188, 17, -4], [194, 13, 3]]) {
    const x = U(u); if (Math.abs(u) < limit + 20) palm(far, x, Math.round(hFar(x)) + 2, ph, P.palm, lean, 9);
  }
  const farC = far.canvas();

  /* ---------- средний план ---------- */
  const mid = new Layer(W, H);
  hill(mid, makeRidge(W / 2, Y(162), [[128, 5], [64, 3], [43, 1.5], [256, 4]], 5), Object.assign({ lightX: sunX, k: .5, lean: .3, depth: 20 }, P.mid));
  const midC = mid.canvas();

  /* ---------- передний план: земля, кактусы, камни ---------- */
  const hGr = makeRidge(W / 2, Y(179), [[128, 3], [64, 2], [43, 1], [256, 2]], 9);
  const ground = new Layer(W, H);
  hill(ground, hGr, Object.assign({ lightX: sunX, k: .8, lean: .6, depth: 12 }, P.ground));
  const groundC = ground.canvas();
  const cact = new Layer(W, H), rc = mulberry32(21);
  const armSets = [[[1, .5, 6, 14], [-1, .36, 5, 9]], [[-1, .45, 5, 10]], [[1, .4, 5, 8]], [[1, .55, 6, 12], [-1, .45, 5, 7]]];
  const cacti = [{ u: -38, h: 42, arms: armSets[0] }, { u: 40, h: 32, arms: armSets[1] }, { u: 2, h: 15, arms: [[1, .4, 4, 5]] }];
  for (const [s0, d] of [[-38, -1], [40, 1]]) for (const u of outward(s0, d, limit, 46, 84, rc)) cacti.push({ u, h: randint(rc, 18, 44), arms: armSets[randint(rc, 0, 3)] });
  const rocks = [{ u: -24, w: 10, h: 5 }, { u: -14, w: 6, h: 3 }, { u: 28, w: 11, h: 5 }];
  for (const [s0, d] of [[-24, -1], [28, 1]]) for (const u of outward(s0, d, limit, 36, 70, rc)) rocks.push({ u, w: randint(rc, 6, 12), h: randint(rc, 3, 6) });
  for (const c of cacti) { const x = U(c.u); saguaro(cact, x, Math.round(hGr(x)) + (c.h < 20 ? 5 : 6), c.h, P.cactus, c.arms); }
  for (const k of rocks) { const x = U(k.u), b = Math.round(hGr(x)) + 3; cact.poly([[x, b], [x + 2, b - k.h], [x + k.w - 2, b - k.h + 1], [x + k.w, b]], P.rock); }
  if (night) edgeLight(cact, sunX, P.cactusRim);
  else { edgeShade(cact, sunX, P.cactusDk); edgeLight(cact, sunX, P.cactusHi); }
  const cactC = cact.canvas();

  /* ---------- песчинки, птицы, марево ---------- */
  const parts = [], nParts = Math.round((night ? 24 : 16) * W / 128);
  for (let i = 0; i < nParts; i++) parts.push({ x: r() * W, y: Y(112) + Math.floor(r() * 76), v: [1, 2][Math.floor(r() * 2)] * 1.0667,
    per: [40, 60, 120][Math.floor(r() * 3)], ph: r(), ln: 2 + Math.floor(r() * 2), c: css(P.sand[Math.floor(r() * 3)]) });
  const birds = night ? [] : [0, 1, 2].map(i => ({ x0: r() * (W + 60), y: Ys(30 + i * 13), v: .45 + i * .12, ph: r() * 6 }));
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 40;

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      if (night) {
        drawStars(ctx, stars, f);
        ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      }
      drawCloudRows(ctx, rows, f, W);
      for (const b of birds) {
        const x = Math.floor(((b.x0 + b.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
        drawBird(ctx, x, b.y + Math.round(2 * Math.sin(2 * Math.PI * f / 60 + b.ph)), ((f >> 1) & 1) === 1, '#3b2b3a');
      }
      ctx.drawImage(farC, 0, 0);
      shimmer(ctx, tmp, f, Y(124), Y(146), { amp: night ? 1.2 : 1.6, dy });
      ctx.drawImage(midC, 0, 0);
      for (const p of parts) {
        const x = Math.floor((p.x + p.v * f) % W), y = p.y + Math.round(2 * Math.sin(2 * Math.PI * (f / p.per + p.ph)));
        ctx.fillStyle = p.c; ctx.fillRect(x - p.ln, y, p.ln + 1, 1);
      }
      ctx.drawImage(cactC, 0, 0);
      ctx.drawImage(groundC, 0, 0);
    },
  };
});

;/* ===== локация: forest ===== */
/* Лес (ночь): лунная хвойная чаща. Огромная бледно-зелёная луна с гало и столбом света,
 * тёмные ели по краям, силуэты подлеска, туман у земли, светящиеся грибы, светлячки.
 * Два варианта: buildNight (ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, px } = env;
  const { C, css, clamp, Layer, Overlay, mulberry32, randint, pick, bay, gradient, addGlow, makeRidge, hill, outward,
    makeStars, drawStars, makeMotes, drawMotes, fog, glowPulse } = px;
  const r = mulberry32(31);

  /* ---------- палитра ---------- */
  const P = {
    sky: ['#050a1c', '#08142c', '#0d2240', '#12304e', '#1c4a62'],
    f1: { body: '#1a4660', rim: '#3f8296', deep: '#12354e' },      // дальняя светлая полоса «шпилей»
    f2: { body: '#0e2c42', rim: '#2a6478', deep: '#0a2236' },      // средний подлесок
    t2: { body: '#071a2a', body2: '#0a2236', rim: '#2a6478' },     // дальние высокие ели (для широких экранов)
    f3: { body: '#06141f', rim: '#1c4a62', deep: '#04101a' },      // близкий подлесок
    t1: { body: '#04101a', body2: '#071a24', rim: '#3a8a86' },     // крупные ели по краям
    ground: { lit: '#0f2c34', shade: '#071a22', deep: '#04101a', rim: '#1e5a56' },
    fly: ['#ffee90', '#f2f070', '#b4f06a', '#ffd070', '#fff5a0'],
    mush: [
      { c: '#4de8c8', hi: '#e8fff4', dk: '#1f9a88', stem: '#2a8a80', glow: '#2fd8b8' },
      { c: '#5df0ff', hi: '#f0ffff', dk: '#2aa6c0', stem: '#2a8a9a', glow: '#36d0ec' },
    ],
  };

  /* ---------- ключевые точки ---------- */
  const R = 10, mx = U(10), my = Ys(34);                 // луна: u = +10 (эталон x=74, y=34)
  const lim = W / 2 + 14;                                // докуда по x рисовать полосы подлеска

  /* ---------- рисовалки ---------- */
  /* ель-«пила»: ярусы свисающих лап; side = +1 свет справа, -1 слева; светлая кромка идёт по верхней стороне яруса */
  function fir(L, cx, base, h, w, o) {
    const top = base - h, tl = o.tl || 7, side = o.side || 1, col = C(o.body), rim = o.rim ? C(o.rim) : null;
    const col2 = o.body2 ? C(o.body2) : null, lean = o.lean || 0, ph0 = o.ph || 0;
    let pe = null;
    for (let i = 0; i <= h; i++) {
      const t = i / h, loc = ((i + ph0) % tl) / tl;
      const hwMax = w / 2 * Math.pow(t, .9) + .5, rise = Math.min(1, loc / .7), hw = hwMax * (.45 + .55 * rise);
      const c = cx + lean * (1 - t), xl = Math.round(c - hw), xr = Math.round(c + hw), y = top + i;
      L.rect(xl, y, xr, y, col);
      const xe = side > 0 ? xr : xl;
      if (col2) for (let k = 1; k <= 3; k++) { const x = xe - side * k; if (x >= xl && x <= xr && bay(x, y) < .55 - k * .13) L.px(x, y, col2); }
      if (rim) {
        let a = xe, b = xe;
        if (pe !== null) { if (side > 0) a = Math.min(xe, pe + 1); else b = Math.max(xe, pe - 1); }
        L.rect(a, y, b, y, rim);
      }
      pe = xe;
    }
  }
  /* плавное затемнение пикселей слоя вниз дизерингом (только уже нарисованное) */
  function fadeDown(L, y0, y1, deep, k) {
    deep = C(deep); const d = L.d, w = L.w;
    for (let y = Math.max(0, y0); y < Math.min(L.h, y1); y++) {
      const p = clamp((y - y0) / (y1 - y0), 0, 1) * k;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        if (d[i + 3] && bay(x, y) < p) { d[i] = deep[0]; d[i + 1] = deep[1]; d[i + 2] = deep[2]; }
      }
    }
  }
  /* полоса елей по всей ширине от центра наружу; o: base, hmin/hmax, wmin/wmax, gmin/gmax, body, rim, lean, tl */
  function band(L, rng, o) {
    const us = [0].concat(outward(0, -1, lim, o.gmin, o.gmax, rng), outward(0, 1, lim, o.gmin, o.gmax, rng));
    for (const u of us) {
      const x = U(u), h = randint(rng, o.hmin, o.hmax), w = randint(rng, o.wmin, o.wmax);
      fir(L, x, o.base, h, w, { body: o.body, body2: o.body2, rim: o.rim, side: x < mx ? 1 : -1, tl: o.tl || 6,
        lean: Math.round((rng() - .5) * (o.lean || 0)), ph: randint(rng, 0, 6) });
    }
  }
  /* высокие ели по краям: tip — проектный y вершины (чем выше экран, тем выше дерево) */
  function bigTree(L, u, tip, w, base, o) {
    const x = U(u), top = Math.min(Y(tip), Ys(tip));
    fir(L, x, base, base - top, w, Object.assign({ side: x < mx ? 1 : -1, tl: 7, ph: randint(r, 0, 6) }, o));
  }
  function merge(cs) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); for (const c of cs) cx.drawImage(c, 0, 0);
    return cv;
  }

  /* ---------- небо и гало ---------- */
  const sky = new Layer(W, H);
  gradient(sky, P.sky, 0, Ys(128));
  addGlow(sky, mx, Y(122), 8, 58, '#1c4a62', .6, 4, 1.4);               // просвет за дальним лесом
  addGlow(sky, mx, my, 8, 112, '#1c4a62', .55, 4, 1.7);
  addGlow(sky, mx, my, 10, 66, '#2e6e74', .72, 5, 1.4);
  addGlow(sky, mx, my, 10, 30, '#5aa8a0', .78, 5, 1.2);
  const skyC = sky.canvas();

  /* ---------- луна ---------- */
  const moonC = (function () {
    const s = 2 * R + 7, c = s >> 1, L = new Layer(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - c, y - c); if (d > R + .5 && d <= R + 1.7 && bay(x, y) < .5) L.px(x, y, '#9fc8b8');
    }
    L.disc(c, c, R, '#d4ecd0'); L.disc(c - 1, c - 1, R - 1, '#f2f8e0');
    L.disc(c - 4, c - 3, 2, '#c0dcc8');
    for (const [dx, dy] of [[4, -4], [2, 2], [-2, 4]]) { L.px(c + dx, c + dy, '#c0dcc8'); L.px(c + dx - 1, c + dy, '#c0dcc8'); L.px(c + dx + 1, c + dy, '#c0dcc8'); L.px(c + dx, c + dy - 1, '#c0dcc8'); L.px(c + dx, c + dy + 1, '#c0dcc8'); }
    return L.canvas();
  })();
  const moonH = moonC.width >> 1;
  const stars = makeStars(r, Math.round(26 * W / 128), W, Ys(104), { avoid: (x, y) => Math.hypot(x - mx, y - my) < R + 5 });

  /* ---------- плоские тёмные облака над лесом ---------- */
  function slab(w, seed) {
    const rr = mulberry32(seed), L = new Layer(w, 6);
    const row = (y, k, c) => { const m = Math.round(w * (1 - k) / 2); L.rect(m + Math.round(rr() * 3), y, w - 1 - m - Math.round(rr() * 3), y, c); };
    row(0, .45, '#0a1a30'); row(1, .75, '#0a1a30'); row(2, .94, '#0b1d34'); row(3, 1, '#0d2240');
    for (let x = 0; x < w; x++) { if (bay(x, 4) < .7) L.px(x, 4, '#2a5a70'); if (bay(x, 5) < .3) L.px(x, 5, '#1c4a62'); }
    return L.canvas();
  }
  const slabSpr = [slab(30, 3), slab(24, 8), slab(34, 12)];
  const slabP = W + 90, nSlab = Math.max(2, Math.round(W / 60));
  const slabs = Array.from({ length: nSlab }, (_, i) => ({ s: slabSpr[i % 3], x0: i * slabP / nSlab + r() * 12, y: Ys(58 + ((i * 5) % 11)), v: .07 + (i % 3) * .03 }));

  /* ---------- дальний лес: светлые «шпили» (f1) и тёмный подлесок (f2) ---------- */
  const f1 = new Layer(W, H), rf = mulberry32(11);
  band(f1, rf, { base: Y(150), hmin: 40, hmax: 60, wmin: 7, wmax: 11, gmin: 4, gmax: 8, body: P.f1.body, rim: P.f1.rim, lean: 4, tl: 6 });
  fadeDown(f1, Y(100), Y(150), P.f1.deep, .9);
  f1.rect(0, Y(150) + 1, W, H, P.f1.deep);
  const f2 = new Layer(W, H);
  band(f2, rf, { base: Y(166), hmin: 28, hmax: 46, wmin: 9, wmax: 15, gmin: 5, gmax: 10, body: P.f2.body, rim: P.f2.rim, lean: 3, tl: 6 });
  fadeDown(f2, Y(124), Y(166), P.f2.deep, .9);
  f2.rect(0, Y(166) + 1, W, H, P.f2.deep);
  const backC = merge([f1.canvas(), f2.canvas()]);

  /* ---------- передний план: дальние ели, близкий подлесок, крупные ели, земля ---------- */
  const rt = mulberry32(23), front = [];
  const t2 = new Layer(W, H);
  const t2us = [];
  for (const d of [-1, 1]) for (const u of outward(34 * d, d, lim + 30, 24, 40, rt)) t2us.push(u);
  t2us.sort((a, b) => Math.abs(b) - Math.abs(a));
  for (const u of t2us) bigTree(t2, u, randint(rt, 64, 108), randint(rt, 26, 40), Y(188), { body: P.t2.body, body2: P.t2.body2, rim: P.t2.rim, tl: 6, lean: randint(rt, -2, 2) });
  fadeDown(t2, Y(120), Y(178), '#04101a', .95);
  front.push(t2.canvas());

  const f3 = new Layer(W, H);
  band(f3, rt, { base: Y(184), hmin: 12, hmax: 28, wmin: 8, wmax: 13, gmin: 6, gmax: 12, body: P.f3.body, rim: P.f3.rim, lean: 3, tl: 5 });
  for (const d of [-1, 1]) for (const u of outward(0, d, lim, 14, 30, rt)) f3.ellipseBox(U(u) - randint(rt, 4, 8), Y(172) + randint(rt, 0, 4), U(u) + randint(rt, 4, 8), Y(196), P.f3.body);
  fadeDown(f3, Y(150), Y(190), P.f3.deep, .8);
  front.push(f3.canvas());

  const t1 = new Layer(W, H);
  const big = [{ u: -52, tip: 32, w: 54 }, { u: 55, tip: 56, w: 54 }];
  for (const d of [-1, 1]) for (const u of outward(d * 55, d, lim + 40, 36, 58, rt)) big.push({ u, tip: randint(rt, 20, 84), w: randint(rt, 40, 54) });
  big.sort((a, b) => Math.abs(b.u) - Math.abs(a.u));
  for (const b of big) bigTree(t1, b.u, b.tip, b.w, Y(192), { body: P.t1.body, body2: P.t1.body2, rim: P.t1.rim, tl: 7, lean: randint(rt, -2, 2) });
  front.push(t1.canvas());

  const hGrBase = makeRidge(W / 2, Y(177), [[120, 1.6], [48, 1], [260, 1.6]], 9);
  const hGr = x => hGrBase(x) - 4 * Math.exp(-Math.pow((x - U(2)) / 15, 2));   // небольшой холмик в центре
  const ground = new Layer(W, H);
  hill(ground, hGr, Object.assign({ lightX: mx, k: .8, lean: .3, depth: 6 }, P.ground));
  front.push(ground.canvas());
  const frontC = merge(front);

  /* ---------- светящиеся грибы ---------- */
  const mush = new Layer(W, H), glows = [], rm = mulberry32(41);
  function mushroom(x, y, w, k) {
    const m = P.mush[k], h = w > 5 ? 4 : 3, rows = h === 4 ? [w - 4, w - 2, w, w - 2] : [w - 2, w, w - 2];
    for (let i = 0; i < h; i++) { const hw = (rows[i] - 1) >> 1; mush.rect(x - hw, y - h + 1 + i, x + hw, y - h + 1 + i, i === h - 1 ? m.dk : m.c); }
    mush.px(x - 1, y - h + 1, m.hi); if (h === 4) mush.px(x - 2, y - h + 2, m.hi);
    mush.rect(x, y + 1, x, y + (h === 4 ? 3 : 2), m.stem);
    glows.push({ x, y: y - 1, r: h === 4 ? 12 : 9, col: m.glow, ph: Math.floor(rm() * 90), per: pick(rm, [70, 90, 110]) });
  }
  const clusters = [[-33, 177, 0, 7, -25, 183, 5, 0], [36, 180, 1, 7, 44, 186, 5, 0]];
  for (const d of [-1, 1]) for (const u of outward(d * 40, d, lim - 6, 46, 90, rm))
    clusters.push([u, randint(rm, 177, 184), randint(rm, 0, 1), randint(rm, 0, 1) ? 7 : 5, u + d * 8, randint(rm, 183, 188), 5, randint(rm, 0, 1)]);
  for (const [u1, y1, k1, w1, u2, y2, w2, k2] of clusters) { mushroom(U(u1), Y(y1), w1, k1); mushroom(U(u2), Y(y2), w2, k2); }
  const mushC = mush.canvas();

  /* ---------- динамика: гало, столб света, туман, трава, светлячки, пыль ---------- */
  const ov = new Overlay(W, H);
  const hx0 = Math.max(0, mx - 42), hx1 = Math.min(W, mx + 43), hy0 = Math.max(0, my - 42), hy1 = Math.min(H, my + 43);
  const sy0 = my + R, sy1 = Math.min(H, Y(150)), sx0 = Math.max(0, mx - 32), sx1 = Math.min(W, mx + 33);
  const fogY0 = Math.max(0, Y(104)), fogY1 = Math.min(H, Y(178));
  const glY0 = Math.max(0, Y(164));
  function shaft(f) {
    const col = '#7fcab8', span = sy1 - sy0;
    for (let y = sy0; y < sy1; y++) {
      const t = (y - sy0) / span, hw = 6 + 20 * Math.pow(t, .75), env = .08 + .5 * Math.pow(1 - t, 1.5);
      for (let x = Math.max(sx0, Math.floor(mx - hw)); x < Math.min(sx1, Math.ceil(mx + hw)); x++) {
        const prof = Math.pow(1 - Math.abs(x + .5 - mx) / hw, 1.3);
        const rays = .65 + .35 * Math.cos(6.2832 * ((x - mx) / 8 + y * .012 + f / 170));
        const a = env * prof * rays * (.88 + .12 * Math.sin(6.2832 * f / 220));
        const q = Math.floor(a * 3 + bay(x, y)) / 3;
        if (q > 0) ov.set(x, y, col, q);
      }
    }
  }

  const flies = makeMotes(r, Math.round(24 * W / 128), W, { y0: Y(72), y1: Y(186), colors: P.fly, amp: [2, 6], big: .22 });
  const dust = Array.from({ length: 16 }, () => ({ x: mx + (r() - .5) * 34, y: sy0 + 10 + r() * (sy1 - sy0 - 40), sp: 22 + Math.floor(r() * 16), v: .12 + r() * .1, off: r() * 400, ph: r() }));

  const blades = [], nb = Math.round(W / 2.6);
  for (let i = 0; i < nb; i++) {
    const x = Math.floor(r() * W), h = randint(r, 3, 7);
    blades.push({ x, y: Math.round(hGr(x)) + randint(r, 1, 3), h, per: pick(r, [50, 70, 90]), ph: r(), amp: h > 5 ? 1.6 : 1, tip: r() < .3 });
  }
  const bladeC = css('#050f16'), tipC = css('#1e5a56');

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      /* дыхание гало вокруг луны */
      glowPulse(ov, mx, my, 40, '#8fd8c4', f, { per: 150, lo: .35, strength: .3 });
      ov.flush(ctx, hx0, hy0, hx1, hy1);
      ctx.drawImage(moonC, mx - moonH, my - moonH);
      /* плоские облака */
      for (const s of slabs) {
        const x = (((s.x0 + s.v * f) % slabP) + slabP) % slabP - 45;
        ctx.drawImage(s.s, Math.round(x), s.y);
      }
      ctx.drawImage(backC, 0, 0);
      /* столб лунного света */
      shaft(f);
      ov.flush(ctx, sx0, sy0, sx1, sy1);
      /* пылинки в луче */
      for (const d of dust) {
        const age = (((d.off + d.v * f) % d.sp) / d.sp), k = Math.sin(Math.PI * age);
        if (k < .3) continue;
        ctx.fillStyle = css(k > .75 ? '#bfe8d8' : '#6fa8a0');
        ctx.fillRect(Math.round(d.x + 1.6 * Math.sin(6.2832 * (age + d.ph))), Math.round(d.y - age * d.sp), 1, 1);
      }
      /* туман: два слоя плывут в разные стороны */
      fog(ov, f, { y0: Y(104), y1: Y(140), color: '#2a5a70', strength: .3, lam: [90, 57], speed: -.1, levels: 3, power: 1, fade: 'mid' });
      fog(ov, f, { y0: Y(128), y1: Y(178), color: '#2e6a78', strength: .6, lam: [70, 46], speed: .2, levels: 3, power: 1.1, fade: 'down' });
      ov.flush(ctx, 0, fogY0, W, fogY1);
      ctx.drawImage(frontC, 0, 0);
      /* трава у земли чуть качается */
      for (const b of blades) {
        const s = Math.round(b.amp * Math.sin(6.2832 * (f / b.per + b.ph))), h1 = b.h >> 1;
        ctx.fillStyle = bladeC;
        ctx.fillRect(b.x, b.y - h1, 1, h1 + 1);
        ctx.fillRect(b.x + s, b.y - b.h, 1, b.h - h1);
        if (b.tip) { ctx.fillStyle = tipC; ctx.fillRect(b.x + s, b.y - b.h, 1, 1); }
      }
      /* свечение грибов */
      for (const g of glows) glowPulse(ov, g.x, g.y, g.r, g.col, f, { per: g.per, ph: g.ph, strength: .6, lo: .55 });
      ov.flush(ctx, 0, glY0, W, H);
      ctx.drawImage(mushC, 0, 0);
      drawMotes(ctx, flies, f);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, px } = env;
    const { C, css, clamp, Layer, Overlay, mulberry32, randint, pick, bay, gradient, addGlow, makeRidge, hill, outward,
      makeStars, makeMotes, drawMotes, fog, glowPulse, cloudRow, drawCloudRows, drawBird } = px;
    const r = mulberry32(31), TP = 2 * Math.PI;

    /* ---------- палитра светлого утреннего леса ---------- */
    const P = {
      sky: ['#3a8ee6', '#5aa6ec', '#80bff0', '#a4d6f2', '#c4e6ee'],
      f1: { body: '#5aa890', rim: '#b4f0b0', deep: '#46907c' },
      f2: { body: '#2e8a5c', rim: '#7ad078', deep: '#247050' },
      t2: { body: '#237a4c', body2: '#2a8a56', rim: '#6ac870' },
      f3: { body: '#1a6a40', rim: '#58b860', deep: '#145a38' },
      t1: { body: '#14553a', body2: '#1a6642', rim: '#7ed272' },
      ground: { lit: '#5ab050', shade: '#3a8a40', deep: '#286a34', rim: '#a0e070' },
      pollen: ['#fff6b8', '#ffffff', '#f4e890', '#ffe8a0'],
      mush: [
        { c: '#d83a30', hi: '#fff0e0', dk: '#a02820', stem: '#f0e4d0' },
        { c: '#b0703c', hi: '#e0b080', dk: '#7a4a28', stem: '#e8dcc8' },
      ],
    };

    const R = 10, mx = U(10), my = Ys(34);
    const lim = W / 2 + 14;

    function fir(L, cx, base, h, w, o) {
      const top = base - h, tl = o.tl || 7, side = o.side || 1, col = C(o.body), rim = o.rim ? C(o.rim) : null;
      const col2 = o.body2 ? C(o.body2) : null, lean = o.lean || 0, ph0 = o.ph || 0;
      let pe = null;
      for (let i = 0; i <= h; i++) {
        const t = i / h, loc = ((i + ph0) % tl) / tl;
        const hwMax = w / 2 * Math.pow(t, .9) + .5, rise = Math.min(1, loc / .7), hw = hwMax * (.45 + .55 * rise);
        const c = cx + lean * (1 - t), xl = Math.round(c - hw), xr = Math.round(c + hw), y = top + i;
        L.rect(xl, y, xr, y, col);
        const xe = side > 0 ? xr : xl;
        if (col2) for (let k = 1; k <= 3; k++) { const x = xe - side * k; if (x >= xl && x <= xr && bay(x, y) < .55 - k * .13) L.px(x, y, col2); }
        if (rim) {
          let a = xe, b = xe;
          if (pe !== null) { if (side > 0) a = Math.min(xe, pe + 1); else b = Math.max(xe, pe - 1); }
          L.rect(a, y, b, y, rim);
        }
        pe = xe;
      }
    }
    function fadeDown(L, y0, y1, deep, k) {
      deep = C(deep); const d = L.d, w = L.w;
      for (let y = Math.max(0, y0); y < Math.min(L.h, y1); y++) {
        const p = clamp((y - y0) / (y1 - y0), 0, 1) * k;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) << 2;
          if (d[i + 3] && bay(x, y) < p) { d[i] = deep[0]; d[i + 1] = deep[1]; d[i + 2] = deep[2]; }
        }
      }
    }
    function band(L, rng, o) {
      const us = [0].concat(outward(0, -1, lim, o.gmin, o.gmax, rng), outward(0, 1, lim, o.gmin, o.gmax, rng));
      for (const u of us) {
        const x = U(u), h = randint(rng, o.hmin, o.hmax), w = randint(rng, o.wmin, o.wmax);
        fir(L, x, o.base, h, w, { body: o.body, body2: o.body2, rim: o.rim, side: x < mx ? 1 : -1, tl: o.tl || 6,
          lean: Math.round((rng() - .5) * (o.lean || 0)), ph: randint(rng, 0, 6) });
      }
    }
    function bigTree(L, u, tip, w, base, o) {
      const x = U(u), top = Math.min(Y(tip), Ys(tip));
      fir(L, x, base, base - top, w, Object.assign({ side: x < mx ? 1 : -1, tl: 7, ph: randint(r, 0, 6) }, o));
    }
    function merge(cs) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'); for (const c of cs) cx.drawImage(c, 0, 0);
      return cv;
    }

    /* ---------- небо, солнце, облака ---------- */
    const sky = new Layer(W, H);
    gradient(sky, P.sky, 0, Ys(128));
    addGlow(sky, mx, Y(122), 8, 58, '#e8fadc', .5, 4, 1.4);
    addGlow(sky, mx, my, 8, 112, '#fff4c0', .5, 4, 1.7);
    addGlow(sky, mx, my, 10, 66, '#fff4c0', .7, 5, 1.4);
    const skyC = sky.canvas();
    const sunC = (function () {
      const s = 2 * R + 7, c = s >> 1, L = new Layer(s, s);
      L.disc(c, c, R - 1, '#ffe27a'); L.disc(c, c, R - 3, '#fff2a8'); L.disc(c, c, R - 5, '#ffffff');
      return L.canvas();
    })();
    const sunH = sunC.width >> 1;
    makeStars(r, Math.round(26 * W / 128), W, Ys(104), {});          // тот же ряд случайных чисел, что и ночью
    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[44, 10], [34, 9], [50, 11]], seed: 4, cols: cc, y: Ys(16), v: .2, gap: 124, off: 20 }),
      cloudRow({ sizes: [[36, 9], [44, 10]], seed: 15, cols: cc, y: Ys(64), v: .28, gap: 112, off: 70 }),
    ];
    const slabP = W + 90, nSlab = Math.max(2, Math.round(W / 60));
    for (let i = 0; i < nSlab; i++) r();                              // ряд чисел как у ночных облаков
    const birds = [[.34, Ys(46), 0], [.26, Ys(70), 3], [.42, Ys(26), 6]].map(([v, y, i]) => ({ v, y, i, x0: r() * (W + 60) }));

    /* ---------- лес ---------- */
    const f1 = new Layer(W, H), rf = mulberry32(11);
    band(f1, rf, { base: Y(150), hmin: 40, hmax: 60, wmin: 7, wmax: 11, gmin: 4, gmax: 8, body: P.f1.body, rim: P.f1.rim, lean: 4, tl: 6 });
    fadeDown(f1, Y(100), Y(150), P.f1.deep, .9);
    f1.rect(0, Y(150) + 1, W, H, P.f1.deep);
    const f2 = new Layer(W, H);
    band(f2, rf, { base: Y(166), hmin: 28, hmax: 46, wmin: 9, wmax: 15, gmin: 5, gmax: 10, body: P.f2.body, rim: P.f2.rim, lean: 3, tl: 6 });
    fadeDown(f2, Y(124), Y(166), P.f2.deep, .9);
    f2.rect(0, Y(166) + 1, W, H, P.f2.deep);
    const backC = merge([f1.canvas(), f2.canvas()]);

    const rt = mulberry32(23), front = [];
    const t2 = new Layer(W, H), t2us = [];
    for (const d of [-1, 1]) for (const u of outward(34 * d, d, lim + 30, 24, 40, rt)) t2us.push(u);
    t2us.sort((a, b) => Math.abs(b) - Math.abs(a));
    for (const u of t2us) bigTree(t2, u, randint(rt, 64, 108), randint(rt, 26, 40), Y(188), { body: P.t2.body, body2: P.t2.body2, rim: P.t2.rim, tl: 6, lean: randint(rt, -2, 2) });
    fadeDown(t2, Y(120), Y(178), '#145a38', .9);
    front.push(t2.canvas());

    const f3 = new Layer(W, H);
    band(f3, rt, { base: Y(184), hmin: 12, hmax: 28, wmin: 8, wmax: 13, gmin: 6, gmax: 12, body: P.f3.body, rim: P.f3.rim, lean: 3, tl: 5 });
    for (const d of [-1, 1]) for (const u of outward(0, d, lim, 14, 30, rt)) f3.ellipseBox(U(u) - randint(rt, 4, 8), Y(172) + randint(rt, 0, 4), U(u) + randint(rt, 4, 8), Y(196), P.f3.body);
    fadeDown(f3, Y(150), Y(190), P.f3.deep, .8);
    front.push(f3.canvas());

    const t1 = new Layer(W, H);
    const big = [{ u: -52, tip: 32, w: 54 }, { u: 55, tip: 56, w: 54 }];
    for (const d of [-1, 1]) for (const u of outward(d * 55, d, lim + 40, 36, 58, rt)) big.push({ u, tip: randint(rt, 20, 84), w: randint(rt, 40, 54) });
    big.sort((a, b) => Math.abs(b.u) - Math.abs(a.u));
    for (const b of big) bigTree(t1, b.u, b.tip, b.w, Y(192), { body: P.t1.body, body2: P.t1.body2, rim: P.t1.rim, tl: 7, lean: randint(rt, -2, 2) });
    front.push(t1.canvas());

    const hGrBase = makeRidge(W / 2, Y(177), [[120, 1.6], [48, 1], [260, 1.6]], 9);
    const hGr = x => hGrBase(x) - 4 * Math.exp(-Math.pow((x - U(2)) / 15, 2));
    const ground = new Layer(W, H);
    hill(ground, hGr, Object.assign({ lightX: mx, k: .8, lean: .3, depth: 6 }, P.ground));
    front.push(ground.canvas());
    const frontC = merge(front);

    /* ---------- обычные грибы и папоротники ---------- */
    const mush = new Layer(W, H), rm = mulberry32(41);
    function mushroom(x, y, w, k) {
      const m = P.mush[k], h = w > 5 ? 4 : 3, rows2 = h === 4 ? [w - 4, w - 2, w, w - 2] : [w - 2, w, w - 2];
      for (let i = 0; i < h; i++) { const hw = (rows2[i] - 1) >> 1; mush.rect(x - hw, y - h + 1 + i, x + hw, y - h + 1 + i, i === h - 1 ? m.dk : m.c); }
      mush.px(x - 1, y - h + 1, m.hi); if (h === 4) { mush.px(x - 2, y - h + 2, m.hi); mush.px(x + 1, y - h + 2, m.hi); }
      mush.rect(x, y + 1, x, y + (h === 4 ? 3 : 2), m.stem);
      pick(rm, [70, 90, 110]); rm();
    }
    const clusters = [[-33, 177, 0, 7, -25, 183, 5, 0], [36, 180, 1, 7, 44, 186, 5, 0]];
    for (const d of [-1, 1]) for (const u of outward(d * 40, d, lim - 6, 46, 90, rm))
      clusters.push([u, randint(rm, 177, 184), randint(rm, 0, 1), randint(rm, 0, 1) ? 7 : 5, u + d * 8, randint(rm, 183, 188), 5, randint(rm, 0, 1)]);
    for (const [u1, y1, k1, w1, u2, y2, w2, k2] of clusters) { mushroom(U(u1), Y(y1), w1, k1); mushroom(U(u2), Y(y2), w2, k2); }
    const ferns = new Layer(W, H), rfn = mulberry32(77);
    function fern(x, y, n, len) {
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (k - (n - 1) / 2) * .5, ex = Math.round(x + Math.cos(a) * len), ey = Math.round(y + Math.sin(a) * len * .8);
        ferns.line(Math.round(x), Math.round(y), ex, ey, '#2e8a3c');
        for (let t = .3; t <= 1; t += .22) { const px_ = Math.round(x + (ex - x) * t), py_ = Math.round(y + (ey - y) * t); ferns.px(px_ - 1, py_, '#4cb054'); ferns.px(px_ + 1, py_, '#4cb054'); }
        ferns.px(ex, ey, '#8ad468');
      }
    }
    for (const u of [-46, -16, 22, 52]) fern(U(u), Y(184 + (u & 3)), 5, 11);
    for (const d of [-1, 1]) for (const u of outward(d * 58, d, lim, 20, 44, rfn)) fern(U(u), Y(randint(rfn, 182, 190)), 5, randint(rfn, 8, 12));
    const mushC = mush.canvas(), fernC = ferns.canvas();

    /* ---------- динамика: гало, солнечный столб, дымка, пыльца, бабочки ---------- */
    const ov = new Overlay(W, H);
    const hx0 = Math.max(0, mx - 42), hx1 = Math.min(W, mx + 43), hy0 = Math.max(0, my - 42), hy1 = Math.min(H, my + 43);
    const sy0 = my + R, sy1 = Math.min(H, Y(150)), sx0 = Math.max(0, mx - 32), sx1 = Math.min(W, mx + 33);
    const fogY0 = Math.max(0, Y(104)), fogY1 = Math.min(H, Y(178));
    function shaft(f) {
      const col = '#fff2b8', span = sy1 - sy0;
      for (let y = sy0; y < sy1; y++) {
        const t = (y - sy0) / span, hw = 6 + 20 * Math.pow(t, .75), env = .08 + .62 * Math.pow(1 - t, 1.5);
        for (let x = Math.max(sx0, Math.floor(mx - hw)); x < Math.min(sx1, Math.ceil(mx + hw)); x++) {
          const prof = Math.pow(1 - Math.abs(x + .5 - mx) / hw, 1.3);
          const rays = .65 + .35 * Math.cos(TP * ((x - mx) / 8 + y * .012 + f / 170));
          const a = env * prof * rays * (.88 + .12 * Math.sin(TP * f / 220));
          const q = Math.floor(a * 3 + bay(x, y)) / 3;
          if (q > 0) ov.set(x, y, col, q);
        }
      }
    }
    const pollen = makeMotes(r, Math.round(26 * W / 128), W, { y0: Y(72), y1: Y(186), colors: P.pollen, amp: [2, 6], rise: .06, big: .12 });
    const dust = Array.from({ length: 16 }, () => ({ x: mx + (r() - .5) * 34, y: sy0 + 10 + r() * (sy1 - sy0 - 40), sp: 22 + Math.floor(r() * 16), v: .12 + r() * .1, off: r() * 400, ph: r() }));
    const flies = [[-30, 150, '#ff9a30', 0], [14, 168, '#4aa0ff', .3], [40, 142, '#ffe040', .6], [-8, 176, '#ff70c0', .85], [58, 170, '#ffffff', .15]]
      .map(([u, y, c, ph]) => ({ cx: U(u), cy: Y(y), c, ph }));
    const blades = [], nb = Math.round(W / 2.6);
    for (let i = 0; i < nb; i++) {
      const x = Math.floor(r() * W), h = randint(r, 3, 7);
      blades.push({ x, y: Math.round(hGr(x)) + randint(r, 1, 3), h, per: pick(r, [50, 70, 90]), ph: r(), amp: h > 5 ? 1.6 : 1, tip: r() < .3 });
    }
    const bladeC = css('#2a7a34'), tipC = css('#9ae060');

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        glowPulse(ov, mx, my, 40, '#fff6c8', f, { per: 150, lo: .35, strength: .3 });
        ov.flush(ctx, hx0, hy0, hx1, hy1);
        ctx.drawImage(sunC, mx - sunH, my - sunH);
        drawCloudRows(ctx, rows, f, W);
        for (const b of birds) { const x = Math.floor(((b.x0 + b.v * f) % (W + 60) + W + 60) % (W + 60)) - 30; drawBird(ctx, x, b.y + Math.round(1.5 * Math.sin(f / 22 + b.i)), (((f >> 2) + b.i) & 1) === 1, '#2a4a48'); }
        ctx.drawImage(backC, 0, 0);
        shaft(f);
        ov.flush(ctx, sx0, sy0, sx1, sy1);
        for (const d of dust) {
          const age = (((d.off + d.v * f) % d.sp) / d.sp), k = Math.sin(Math.PI * age);
          if (k < .3) continue;
          ctx.fillStyle = css(k > .75 ? '#ffffff' : '#fff0a8');
          ctx.fillRect(Math.round(d.x + 1.6 * Math.sin(TP * (age + d.ph))), Math.round(d.y - age * d.sp), 1, 1);
        }
        fog(ov, f, { y0: Y(104), y1: Y(140), color: '#e8fff0', strength: .26, lam: [90, 57], speed: -.1, levels: 3, power: 1, fade: 'mid' });
        fog(ov, f, { y0: Y(128), y1: Y(178), color: '#e0f8e8', strength: .38, lam: [70, 46], speed: .2, levels: 3, power: 1.1, fade: 'down' });
        ov.flush(ctx, 0, fogY0, W, fogY1);
        ctx.drawImage(frontC, 0, 0);
        for (const b of blades) {
          const s = Math.round(b.amp * Math.sin(TP * (f / b.per + b.ph))), h1 = b.h >> 1;
          ctx.fillStyle = bladeC;
          ctx.fillRect(b.x, b.y - h1, 1, h1 + 1);
          ctx.fillRect(b.x + s, b.y - b.h, 1, b.h - h1);
          if (b.tip) { ctx.fillStyle = tipC; ctx.fillRect(b.x + s, b.y - b.h, 1, 1); }
        }
        ctx.drawImage(fernC, 0, 0);
        ctx.drawImage(mushC, 0, 0);
        drawMotes(ctx, pollen, f);
        for (const b of flies) {
          const x = Math.round(b.cx + 14 * Math.sin(TP * (f / 140 + b.ph))), y = Math.round(b.cy + 6 * Math.sin(TP * (f / 90 + b.ph * 2))), up = (f >> 1) & 1;
          ctx.fillStyle = b.c; ctx.fillRect(x - 1, y - (up ? 1 : 0), 1, 2); ctx.fillRect(x + 1, y - (up ? 1 : 0), 1, 2);
          ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x, y, 1, 1);
        }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('forest', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: sea ===== */
/* Море: закат с лунным месяцем, маяк на скале с вращающимся лучом, золотая дорожка, парусник.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, css, Layer, Overlay, mulberry32, randint, clamp, bay, tri, gradient, addGlow, hill, edgeLight, edgeTop, outward,
    cloudRow, drawCloudRows, moonSprite, makeStars, drawStars, glowPulse, waves, glitter, drawBird } = px;
  const r = mulberry32(31), hy = Y(96), xc = W / 2;

  /* ---------- небо и вода ---------- */
  const sky = new Layer(W, H), water = new Layer(W, H);
  gradient(sky, ['#0a0a2c', '#14123e', '#1f1a56', '#30236c', '#4a2a82', '#6c3294', '#9a3e9c', '#c8509a', '#ee6c92', '#ff8f8c', '#ffaa8e', '#ffbc98'], 0, hy);
  gradient(water, ['#e8789e', '#c85ea2', '#a050a4', '#7a429e', '#56368e', '#3a2a78', '#2a2266', '#1e1a56'], hy, H);
  sky.d.set(water.d.subarray(hy * W * 4), hy * W * 4);
  const moonX = U(30), moonY = Ys(24);
  addGlow(sky, moonX, moonY, 6, 28, '#9a80e0', .38, 4, 1.6);
  addGlow(sky, U(-15), hy + 2, 4, 48, '#ffb096', .5, 4, 1.4);
  addGlow(sky, U(-15), hy + 38, 8, 50, '#b068b8', .26, 4, 1.6);
  const skyC = sky.canvas();
  const moon = moonSprite(8, ['#c8b8f0', '#f2ecff', '#ffffff'], true);
  const stars = makeStars(r, Math.round(54 * W / 128), W, Math.min(hy - 14, Ys(84)), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 13 });

  /* ---------- облака ---------- */
  const rows = [
    cloudRow({ sizes: [[40, 9], [32, 8], [50, 10]], seed: 3, cols: ['#6a3a8c', '#e0607e', '#9a4a98'], y: Ys(32), v: .32, gap: 124, off: 10 }),
    cloudRow({ sizes: [[26, 6], [34, 7]], seed: 9, cols: ['#8a46a0', '#d86a90', '#b05aa0'], y: Ys(52), v: .2, gap: 150, off: 70 }),
    cloudRow({ sizes: [[30, 6], [24, 5], [38, 7]], seed: 15, cols: ['#f07a9a', '#ffa890', '#ffa488'], y: Ys(68), v: .55, gap: 118, off: 40 }),
  ];

  /* ---------- горизонт: берег, островки, парусники ---------- */
  const far = new Layer(W, H), rf = mulberry32(5);
  const coastH = u => { const a = Math.abs(u); if (a < 78) return 0; const k = clamp((a - 78) / 46, 0, 1);
    return k * (1.8 + 1.5 * (Math.sin(u * .12 + 1) + Math.sin(u * .33 + 2) * .6 + 1.6)); };
  for (let x = 0; x < W; x++) {
    const h = Math.round(coastH(x - xc));
    if (h > 0) { far.rect(x, hy - h, x, hy - 1, '#a45a9a'); far.px(x, hy - h, '#d8709c'); }
  }
  for (const d of [-1, 1]) for (const u of outward(46 * d, d, limit, 38, 90, rf)) {
    const w = randint(rf, 6, 13), h = randint(rf, 1, 3), x = Math.round(xc + u);
    far.ellipseBox(x - (w >> 1), hy - h, x + (w >> 1), hy + h - 1, '#a45a9a');
    for (let i = -(w >> 1); i <= (w >> 1); i++) far.px(x + i, hy - h, '#d8709c');
  }
  function boat(L, cx, s) {
    const hull = s > 1 ? '#2a2058' : '#4a2e78';
    L.poly([[cx - 6 * s, hy - 2], [cx + 6 * s, hy - 2], [cx + 4 * s, hy + 1], [cx - 4 * s, hy + 1]], hull);
    L.poly([[cx - 6 * s, hy - 3], [cx, hy - 3], [cx, hy - 3 - 13 * s]], '#ffcade');
    L.poly([[cx, hy - 3], [cx + 5 * s, hy - 3], [cx, hy - 3 - 13 * s]], '#e898bc');
    L.px(cx, hy - 4 - 13 * s, '#ff8aa0');
    for (let y = hy + 1; y <= hy + 2; y++) for (let x = cx - 4 * s; x <= cx + 4 * s; x++) if (bay(x, y) > (y === hy + 1 ? .35 : .65)) L.px(x, y, '#50347c');
  }
  boat(far, U(-30), 1.0);
  boat(far, U(-70), .5);
  const farC = far.canvas();

  /* ---------- скала и маяк ---------- */
  const interp = (pts, u) => {
    if (u < pts[0][0] || u > pts[pts.length - 1][0]) return Infinity;
    for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); }
    return Infinity;
  };
  const mainPts = [[-4, 193], [-3, 188], [-1, 183], [1, 178], [3, 172], [6, 166], [9, 160], [12, 156], [16, 152.5], [20, 151], [24, 150], [62, 150],
    [75, 152], [95, 158], [120, 168], [140, 178], [160, 187], [178, 194]];
  const bumps = [{ u: -9, w: 10, h: 8 }], rb = mulberry32(17);
  for (const u of outward(-9, -1, limit, 44, 80, rb)) bumps.push({ u, w: randint(rb, 8, 16), h: randint(rb, 3, 8) });
  for (const u of outward(150, 1, limit, 30, 62, rb)) bumps.push({ u, w: randint(rb, 10, 18), h: randint(rb, 3, 9) });
  const rockTop = x => {
    const u = x - xc;
    let yd = interp(mainPts, u);
    if (yd < Infinity) yd += (.7 * Math.sin(u * .3 + 1) + .5 * Math.sin(u * .85 + .4)) * clamp((u + 2) / 10, 0, 1);
    for (const b of bumps) { const t = (u - b.u) / b.w; if (Math.abs(t) < 1) yd = Math.min(yd, 192 - b.h * Math.pow(1 - t * t, .55)); }
    return yd === Infinity ? H + 99 : Y(yd);
  };
  const rock = new Layer(W, H);
  hill(rock, rockTop, { lit: '#2a2060', shade: '#221a52', deep: '#171040', lean: 0, k: .9, depth: 50, sh: 2 });
  const rt = mulberry32(41);                                                      // трещины и блики на камне
  for (let i = 0, n = Math.round(W * .5); i < n; i++) {
    let x = Math.floor(rt() * W), y = Y(150) + Math.floor(rt() * (H - Y(150))); const len = 3 + Math.floor(rt() * 5), dx = rt() < .5 ? 1 : -1;
    for (let k = 0; k < len; k++, x += dx, y += (k & 1)) if (rock.has(x, y)) rock.px(x, y, '#140e34');
  }
  for (let i = 0, n = Math.round(W * .6); i < n; i++) {
    const x = Math.floor(rt() * W), y = Y(148) + Math.floor(rt() * 30);
    if (rock.has(x, y) && rock.has(x, y - 2)) rock.px(x, y, '#3a2e78');
  }
  edgeTop(rock, '#5446a8');
  edgeLight(rock, -1e9, '#8f7ce6');

  const lcx = U(28), by = Y(151), yt = by - 30;           // центр, основание и верх башни
  function lighthouse(L) {
    for (let y = yt; y <= by; y++) {
      const band = Math.floor((y - yt) / 5), white = band % 2 === 0;
      for (let dx = -4; dx <= 4; dx++) {
        const lit = dx <= -3, sh = dx >= 2;
        const c = white ? (lit ? '#fff0f8' : sh ? '#b8a0cc' : '#ecd8ec') : (lit ? '#ee7090' : sh ? '#a84468' : '#d65a7c');
        L.px(lcx + dx, y, c);
      }
    }
    L.rect(lcx - 5, by - 1, lcx + 5, by, '#3a2c58');
    L.rect(lcx, yt + 8, lcx, yt + 9, '#3a2058');                                // окошко
    L.rect(lcx - 5, yt - 3, lcx + 5, yt - 1, '#2c2358'); L.hline(lcx - 5, lcx - 2, yt - 3, '#4a3c80');   // галерея
    L.rect(lcx - 3, yt - 9, lcx + 3, yt - 4, '#ffeaa8');                        // фонарь
    L.rect(lcx - 2, yt - 8, lcx + 2, yt - 5, '#fff6cc'); L.hline(lcx - 3, lcx + 3, yt - 4, '#e8c878');
    L.vline(lcx - 1, yt - 8, yt - 5, '#e0b868'); L.vline(lcx + 1, yt - 8, yt - 5, '#e0b868');
    L.rect(lcx - 5, yt - 10, lcx + 5, yt - 10, '#3a2c58');
    L.poly([[lcx - 5, yt - 9], [lcx, yt - 9], [lcx, yt - 17]], '#b8a888');      // крыша: свет слева, тень справа
    L.poly([[lcx, yt - 9], [lcx + 6, yt - 9], [lcx, yt - 17]], '#6a5a58');
    L.vline(lcx, yt - 21, yt - 17, '#3a2c50'); L.px(lcx, yt - 22, '#ffd080');
  }
  lighthouse(rock);
  const rockC = rock.canvas();
  const lx = lcx, ly = yt - 6;

  /* ---------- пена и блики на скале ---------- */
  const foam = [], sparks = [], rr = mulberry32(23);
  for (let y = Y(153); y < H; y++) for (let x = 1; x < W; x++) {
    if (!rock.has(x, y) || rock.has(x - 1, y)) continue;
    if (rr() < .45) foam.push({ x, y, ph: rr(), per: [30, 40, 60][Math.floor(rr() * 3)], ln: 1 + Math.floor(rr() * 3) });
    if (rr() < .09) sparks.push({ x, y, ph: Math.floor(rr() * 64), per: [24, 32, 48][Math.floor(rr() * 3)] });
  }

  /* ---------- чайки и слои эффектов ---------- */
  const gulls = [0, 1, 2].map(i => ({ x0: r() * (W + 60), y: Ys([37, 55, 62][i]), v: [.3, .42, .24][i], ph: r() * 6, fl: Math.floor(r() * 4) }));
  const ovW = new Overlay(W, H), ovB = new Overlay(W, H);
  const LMAX = 62;
  function beam(ov, e, str) {
    const n = Math.floor(Math.abs(e)), s = e < 0 ? -1 : 1;
    for (let i = 3; i <= n; i++) {
      const hw = Math.min(9, 1.5 + i * .14), fade = Math.max(0, 1 - i / (LMAX * 1.05)), x = lx + s * i;
      for (let dy = -Math.ceil(hw); dy <= Math.ceil(hw); dy++) {
        const a = str * fade * Math.pow(Math.max(0, 1 - Math.abs(dy) / (hw + .5)), .8);
        const q = clamp(Math.floor(a * 3 + bay(x, ly + dy)) / 3, 0, 1);
        if (q > 0) ov.over(x, ly + dy, '#ffe6a0', q);
      }
    }
  }

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      drawCloudRows(ctx, rows, f, W);
      for (const g of gulls) {
        const x = Math.floor(((g.x0 + g.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
        drawBird(ctx, x, g.y + Math.round(2 * Math.sin(2 * Math.PI * f / 80 + g.ph)), (((f >> 2) + g.fl) & 1) === 1, '#2c1f58');
      }
      ctx.drawImage(farC, 0, 0);
      waves(ovW, f, { y0: hy + 3, y1: H, hi: '#ecb4d2', lo: '#2a2064', lam0: 4.6, lam1: 25, gap0: 3, dgap: .35, thr: .35, aHi: .55, aLo: .3 });
      glitter(ovW, f, U(-15) + Math.round(1.5 * Math.sin(f / 45)), hy + 2, H, 3, 28, '#ffe8b0', { thr: 1.1, alpha: .95 });
      ovW.flush(ctx, 0, hy + 1, W, H);
      ctx.drawImage(rockC, 0, 0);
      for (const m of foam) {
        const ox = Math.round(1.5 * Math.sin(2 * Math.PI * (f / m.per + m.ph))), lv = tri(f, m.per, m.ph * m.per);
        if (lv < .3) continue;
        ctx.fillStyle = lv > .65 ? '#e8e0ff' : '#9a88d8';
        ctx.fillRect(m.x - 1 - m.ln + ox, m.y, m.ln, 1);
      }
      for (const s of sparks) if (tri(f, s.per, s.ph) > .75) { ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, s.y, 1, 1); }
      // луч маяка: два противоположных луча вращаются, видна проекция на горизонталь
      const th = 2 * Math.PI * f / 180, c = Math.cos(th), sn = Math.sin(th);
      beam(ovB, c * LMAX, clamp(.72 + .28 * sn, .3, 1));
      beam(ovB, -c * LMAX, clamp(.72 - .28 * sn, .3, 1));
      glowPulse(ovB, lx, ly, 9 + Math.round(4 * Math.pow(Math.max(0, sn), 3)), '#ffd890', f, { per: 90, strength: .6, lo: .7 });
      ovB.flush(ctx, Math.max(0, lx - LMAX - 4), Math.max(0, ly - 16), Math.min(W, lx + LMAX + 4), Math.min(H, ly + 16));
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { css, Layer, Overlay, mulberry32, randint, clamp, bay, tri, gradient, addGlow, sunDisc, hill, edgeLight, edgeTop, outward,
      cloudRow, drawCloudRows, waves, glitter, drawBird } = px;
    const r = mulberry32(31), hy = Y(96), xc = W / 2;

    /* ---------- небо, вода, солнце ---------- */
    const sky = new Layer(W, H), water = new Layer(W, H);
    gradient(sky, ['#2c82e0', '#4a9aea', '#6cb2f0', '#8ecaf4', '#b0e0f6', '#d0f0f8', '#e8f8fa'], 0, hy);
    gradient(water, ['#5ab4e8', '#3ea4de', '#2c94d2', '#2aa4d0', '#30b8d2', '#44ccd4', '#60dcd8', '#78e8de'], hy, H);
    sky.d.set(water.d.subarray(hy * W * 4), hy * W * 4);
    const sunX = U(-15), sunY = Ys(30);
    addGlow(sky, sunX, sunY, 8, 66, '#fff4c0', .75, 5, 1.5);
    addGlow(sky, sunX, sunY, 8, 120, '#fffbe0', .3, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[10, '#ffe27a'], [8, '#fff0a0'], [6, '#fff8d0'], [4, '#ffffff']]);
    addGlow(sky, sunX, hy + 2, 4, 40, '#e8fcff', .45, 4, 1.4);
    const skyC = sky.canvas();
    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 3, cols: cc, y: Ys(26), v: .32, gap: 124, off: 10 }),
      cloudRow({ sizes: [[30, 8], [40, 9]], seed: 9, cols: cc, y: Ys(52), v: .2, gap: 150, off: 70 }),
      cloudRow({ sizes: [[34, 8], [26, 6], [42, 8]], seed: 15, cols: cc, y: Ys(70), v: .5, gap: 118, off: 40 }),
    ];

    /* ---------- горизонт: берег, островки, парусники ---------- */
    const far = new Layer(W, H), rf = mulberry32(5);
    const coastH = u => { const a = Math.abs(u); if (a < 78) return 0; const k = clamp((a - 78) / 46, 0, 1);
      return k * (1.8 + 1.5 * (Math.sin(u * .12 + 1) + Math.sin(u * .33 + 2) * .6 + 1.6)); };
    for (let x = 0; x < W; x++) {
      const h = Math.round(coastH(x - xc));
      if (h > 0) { far.rect(x, hy - h, x, hy - 1, '#5a9a8c'); far.px(x, hy - h, '#a0d8b8'); }
    }
    for (const d of [-1, 1]) for (const u of outward(46 * d, d, limit, 38, 90, rf)) {
      const w = randint(rf, 6, 13), h = randint(rf, 1, 3), x = Math.round(xc + u);
      far.ellipseBox(x - (w >> 1), hy - h, x + (w >> 1), hy + h - 1, '#5a9a8c');
      for (let i = -(w >> 1); i <= (w >> 1); i++) far.px(x + i, hy - h, '#a0d8b8');
    }
    function boat(L, cx, s) {
      const hull = s > 1 ? '#5a3a2c' : '#7a5a48';
      L.poly([[cx - 6 * s, hy - 2], [cx + 6 * s, hy - 2], [cx + 4 * s, hy + 1], [cx - 4 * s, hy + 1]], hull);
      L.poly([[cx - 6 * s, hy - 3], [cx, hy - 3], [cx, hy - 3 - 13 * s]], '#ffffff');
      L.poly([[cx, hy - 3], [cx + 5 * s, hy - 3], [cx, hy - 3 - 13 * s]], '#c4d8f0');
      L.px(cx, hy - 4 - 13 * s, '#e84848');
      for (let y = hy + 1; y <= hy + 2; y++) for (let x = cx - 4 * s; x <= cx + 4 * s; x++) if (bay(x, y) > (y === hy + 1 ? .35 : .65)) L.px(x, y, '#e8fcff');
    }
    boat(far, U(-30), 1.0);
    boat(far, U(-70), .5);
    const farC = far.canvas();

    /* ---------- скала и маяк ---------- */
    const interp = (pts, u) => {
      if (u < pts[0][0] || u > pts[pts.length - 1][0]) return Infinity;
      for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); }
      return Infinity;
    };
    const mainPts = [[-4, 193], [-3, 188], [-1, 183], [1, 178], [3, 172], [6, 166], [9, 160], [12, 156], [16, 152.5], [20, 151], [24, 150], [62, 150],
      [75, 152], [95, 158], [120, 168], [140, 178], [160, 187], [178, 194]];
    const bumps = [{ u: -9, w: 10, h: 8 }], rb = mulberry32(17);
    for (const u of outward(-9, -1, limit, 44, 80, rb)) bumps.push({ u, w: randint(rb, 8, 16), h: randint(rb, 3, 8) });
    for (const u of outward(150, 1, limit, 30, 62, rb)) bumps.push({ u, w: randint(rb, 10, 18), h: randint(rb, 3, 9) });
    const rockTop = x => {
      const u = x - xc;
      let yd = interp(mainPts, u);
      if (yd < Infinity) yd += (.7 * Math.sin(u * .3 + 1) + .5 * Math.sin(u * .85 + .4)) * clamp((u + 2) / 10, 0, 1);
      for (const b of bumps) { const t = (u - b.u) / b.w; if (Math.abs(t) < 1) yd = Math.min(yd, 192 - b.h * Math.pow(1 - t * t, .55)); }
      return yd === Infinity ? H + 99 : Y(yd);
    };
    const rock = new Layer(W, H);
    hill(rock, rockTop, { lit: '#b0a090', shade: '#867a72', deep: '#5a5252', lean: 0, k: .9, depth: 50, sh: 2 });
    const rt = mulberry32(41);
    for (let i = 0, n = Math.round(W * .5); i < n; i++) {
      let x = Math.floor(rt() * W), y = Y(150) + Math.floor(rt() * (H - Y(150))); const len = 3 + Math.floor(rt() * 5), dx = rt() < .5 ? 1 : -1;
      for (let k = 0; k < len; k++, x += dx, y += (k & 1)) if (rock.has(x, y)) rock.px(x, y, '#4a4242');
    }
    for (let i = 0, n = Math.round(W * .6); i < n; i++) {
      const x = Math.floor(rt() * W), y = Y(148) + Math.floor(rt() * 30);
      if (rock.has(x, y) && rock.has(x, y - 2)) rock.px(x, y, '#cabfaf');
    }
    edgeTop(rock, '#e0d6c4');
    edgeLight(rock, -1e9, '#f4ecdc');

    const lcx = U(28), by = Y(151), yt = by - 30;
    function lighthouse(L) {
      for (let y = yt; y <= by; y++) {
        const band = Math.floor((y - yt) / 5), white = band % 2 === 0;
        for (let dx = -4; dx <= 4; dx++) {
          const lit = dx <= -3, sh = dx >= 2;
          const c = white ? (lit ? '#ffffff' : sh ? '#b4bccc' : '#f0f0ec') : (lit ? '#f87068' : sh ? '#a82c34' : '#dc4444');
          L.px(lcx + dx, y, c);
        }
      }
      L.rect(lcx - 5, by - 1, lcx + 5, by, '#5a4a4a');
      L.rect(lcx, yt + 8, lcx, yt + 9, '#2a3a5a');
      L.rect(lcx - 5, yt - 3, lcx + 5, yt - 1, '#4a4a62'); L.hline(lcx - 5, lcx - 2, yt - 3, '#9a9ab4');
      L.rect(lcx - 3, yt - 9, lcx + 3, yt - 4, '#c8ecff');
      L.rect(lcx - 2, yt - 8, lcx + 2, yt - 5, '#e8f8ff'); L.hline(lcx - 3, lcx + 3, yt - 4, '#8ac0e0');
      L.vline(lcx - 1, yt - 8, yt - 5, '#7ab0d0'); L.vline(lcx + 1, yt - 8, yt - 5, '#7ab0d0');
      L.rect(lcx - 5, yt - 10, lcx + 5, yt - 10, '#4a4a62');
      L.poly([[lcx - 5, yt - 9], [lcx, yt - 9], [lcx, yt - 17]], '#f06860');
      L.poly([[lcx, yt - 9], [lcx + 6, yt - 9], [lcx, yt - 17]], '#b03038');
      L.vline(lcx, yt - 21, yt - 17, '#3a3a50'); L.px(lcx, yt - 22, '#ffe27a');
    }
    lighthouse(rock);
    const rockC = rock.canvas();
    const lx = lcx, ly = yt - 6;

    /* ---------- пена и блики на скале ---------- */
    const foam = [], sparks = [], rr = mulberry32(23);
    for (let y = Y(153); y < H; y++) for (let x = 1; x < W; x++) {
      if (!rock.has(x, y) || rock.has(x - 1, y)) continue;
      if (rr() < .45) foam.push({ x, y, ph: rr(), per: [30, 40, 60][Math.floor(rr() * 3)], ln: 1 + Math.floor(rr() * 3) });
      if (rr() < .09) sparks.push({ x, y, ph: Math.floor(rr() * 64), per: [24, 32, 48][Math.floor(rr() * 3)] });
    }

    /* ---------- чайки, эффекты ---------- */
    const gulls = [0, 1, 2, 3, 4].map(i => ({ x0: r() * (W + 60), y: Ys([37, 55, 62, 44, 70][i]), v: [.3, .42, .24, .36, .28][i], ph: r() * 6, fl: Math.floor(r() * 4) }));
    const ovW = new Overlay(W, H);

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        for (const g of gulls) {
          const x = Math.floor(((g.x0 + g.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
          drawBird(ctx, x, g.y + Math.round(2 * Math.sin(2 * Math.PI * f / 80 + g.ph)), (((f >> 2) + g.fl) & 1) === 1, '#ffffff');
        }
        ctx.drawImage(farC, 0, 0);
        waves(ovW, f, { y0: hy + 3, y1: H, hi: '#ffffff', lo: '#1c6aaa', lam0: 4.6, lam1: 25, gap0: 3, dgap: .35, thr: .35, aHi: .7, aLo: .3 });
        glitter(ovW, f, sunX + Math.round(1.5 * Math.sin(f / 45)), hy + 2, H, 3, 28, '#ffffff', { thr: 1.1, alpha: .95 });
        ovW.flush(ctx, 0, hy + 1, W, H);
        ctx.drawImage(rockC, 0, 0);
        for (const m of foam) {
          const ox = Math.round(1.5 * Math.sin(2 * Math.PI * (f / m.per + m.ph))), lv = tri(f, m.per, m.ph * m.per);
          if (lv < .3) continue;
          ctx.fillStyle = lv > .65 ? '#ffffff' : '#b8e4f8';
          ctx.fillRect(m.x - 1 - m.ln + ox, m.y, m.ln, 1);
        }
        for (const s of sparks) if (tri(f, s.per, s.ph) > .75) { ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, s.y, 1, 1); }
        // блик на стекле фонаря (луча днём нет)
        if (tri(f, 90, 0) > .78) { ctx.fillStyle = '#ffffff'; ctx.fillRect(lx - 2, ly - 3, 5, 1); ctx.fillRect(lx, ly - 5, 1, 5); }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('sea', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: ocean ===== */
/* Океан: глубокая ночь, полная луна на горизонте с лунной дорожкой, далёкая гроза слева,
 * кит с фонтаном, Млечный Путь, светящийся планктон, огонёк корабля.
 * Два варианта: buildNight (ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, dy, Y, Ys, U, limit, px } = env;
  const { C, css, Layer, Overlay, mulberry32, randint, bay, clamp, gradient, addGlow, edgeLight, outward,
    cloudRow, drawCloudRows, makeStars, drawStars, drawSparkles, makeMotes, drawMotes, waves, glitter } = px;
  const r = mulberry32(2024);
  const sstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = n => { let x = Math.imul(n + 1, 0x9E3779B1); x ^= x >>> 15; x = Math.imul(x, 0x85EBCA6B); x ^= x >>> 13; return (x >>> 0) / 4294967296; };
  const lighten = (L, x, y, col, t) => {          // подмешать цвет к готовому пикселю слоя
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return;
    const i = (y * L.w + x) << 2, d = L.d; col = C(col);
    d[i] += (col[0] - d[i]) * t; d[i + 1] += (col[1] - d[i + 1]) * t; d[i + 2] += (col[2] - d[i + 2]) * t;
  };

  /* ---------- палитра ---------- */
  const P = {
    sky: ['#03051a', '#060a2a', '#0c1340', '#142058', '#1f2d80', '#2f3f9e', '#4658bc', '#6478d2'],
    sea: ['#4a5cc0', '#3342a4', '#27358c', '#1c2874', '#141e5c', '#0e1648', '#0a1038'],
    starPal: [null, '#4a56a8', '#9aa6ec', '#ffffff'],
    storm: '#0a1032', stormRim: '#1f2e78', stormEdge: '#33449e',
    whale: '#0a1135', whaleMid: '#1a2872', whaleRim: '#4660c0', foam: '#a8b8f8',
  };

  const seaY = Y(88), hs = H - seaY;               // горизонт и высота моря
  const mx = U(0), my = Y(74), MR = 20;            // луна: центр и радиус
  const xc = W / 2;

  /* ---------- небо, Млечный Путь, луна ---------- */
  const sky = new Layer(W, H);
  gradient(sky, P.sky, 0, seaY - 1);
  const P0x = xc - 80, P0y = Ys(70), ddx = 150, ddy = -70 * (H / 192), dl = Math.hypot(ddx, ddy), bw = 13 * (H / 192);
  const bandA = (x, y) => {                        // плотность полосы Млечного Пути 0..1
    const d = Math.abs((x - P0x) * ddy - (y - P0y) * ddx) / dl, e = Math.exp(-(d / bw) * (d / bw));
    return e * (.55 + .45 * Math.sin(x * .27 + y * .11) * Math.sin(x * .09 - y * .23 + 1.3));
  };
  for (let y = 0; y < seaY; y++) for (let x = 0; x < W; x++) {
    const a = bandA(x, y), q = Math.floor(a * 1.7 + bay(x, y)) / 3;
    if (q > 0) lighten(sky, x, y, '#7684de', q * .85);
  }
  const bandSpeck = ['#6f7cd8', '#98a4ee', '#4c58b0'];
  for (let i = 0, n = Math.round(300 * W / 128), g = 0; i < n && g++ < 9000;) {
    const x = Math.floor(r() * W), y = Math.floor(r() * (seaY - 3));
    if (r() < bandA(x, y)) { sky.px(x, y, bandSpeck[Math.floor(r() * 3)]); i++; }
  }
  addGlow(sky, mx, my, MR, 58, '#7f8ef0', .9, 5, 1.4);
  addGlow(sky, mx, my, MR, 118, '#4c5cc8', .5, 4, 1.6);
  // луна: лимб, тело, кратеры
  sky.disc(mx, my, MR, '#9eacec');
  sky.disc(mx - 1, my, MR - 1, '#cdd5fa');
  sky.disc(mx - 2, my - 1, MR - 2, '#f2f4ff');
  for (const [cx, cy, cr] of [[-8, -4, 4], [7, -8, 3], [4, 4, 4], [-5, 9, 3]]) sky.disc(mx + cx - 2, my + cy - 1, cr, '#c3cbf2');
  // огонёк корабля на горизонте
  const shipX = U(36);
  sky.rect(shipX - 3, seaY - 1, shipX + 3, seaY - 1, '#0a1236');
  sky.px(shipX - 1, seaY - 2, '#0a1236'); sky.px(shipX + 1, seaY - 2, '#0a1236');
  const skyC = sky.canvas();

  /* ---------- звёзды ---------- */
  const avoid = (x, y) => Math.hypot(x - mx, y - my) < MR + 6 || (y > Y(56) && x < U(-12));
  const stars = makeStars(r, Math.round(70 * W / 128 * H / 192), W, seaY - 3, { avoid });
  for (let nb = Math.round(80 * W / 128 * H / 192), g = 0; nb > 0 && g++ < 5000;) {
    const x = Math.floor(r() * W), y = Math.floor(r() * (seaY - 3));
    if (avoid(x, y)) continue;
    if (r() < bandA(x, y) * .9) { stars.push([x, y, Math.floor(r() * 128), [16, 32, 32, 64, 128][Math.floor(r() * 5)]]); nb--; }
  }
  const sparks = [];
  for (let g = 0; sparks.length < 5 && g < 200; g++) {
    const x = Math.floor(8 + r() * (W - 16)), y = Ys(6 + Math.floor(r() * 54));
    if (!avoid(x, y) && y < Y(56)) sparks.push([x, y, Math.floor(r() * 128), [32, 64][Math.floor(r() * 2)]]);
  }

  /* ---------- тонкие облака ---------- */
  const cl = ['#2a3a8c', '#3c50a8', '#4a5cc0'];
  const rows = [
    cloudRow({ sizes: [[44, 5], [56, 6], [38, 5]], seed: 4, cols: cl, y: Ys(24), v: .13, gap: 96, off: 10 }),
    cloudRow({ sizes: [[36, 5], [48, 5], [30, 4]], seed: 9, cols: ['#27378a', '#384ca4', '#4658bc'], y: Ys(47), v: .09, gap: 104, off: 50 }),
  ];

  /* ---------- далёкая гроза слева ---------- */
  const sbase = Y(79), mw = W, mh = sbase + 2, mask = new Uint8Array(mw * mh);
  const mEll = (cx, cy, rx, ry) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(sbase, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(mw - 1, Math.ceil(cx + rx)); x++) {
        const a = (x + .5 - cx) / rx, b = (y + .5 - cy) / ry; if (a * a + b * b <= 1) mask[y * mw + x] = 1;
      }
  };
  const rs = mulberry32(31);
  for (let u = -21; u > -limit - 14;) {
    const t = clamp((-u - 50) / (limit - 30), 0, 1), ry = (15 - 9 * t * t) * (.8 + .35 * rs()), rx = 7 + rs() * 5;
    mEll(U(u), sbase + 1, rx, ry);
    mEll(U(u + (rs() - .5) * rx), sbase - ry * .8, rx * .6, ry * .38);
    u -= rx * (.9 + rs() * .7);
  }
  for (let y = sbase - 3; y <= sbase; y++) for (let x = 0; x <= U(-24); x++) mask[y * mw + x] = 1;
  const stormL = new Layer(W, H), top = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y <= sbase; y++) if (mask[y * mw + x]) { top[x] = y; break; }
  for (let x = 0; x < W; x++) {
    if (top[x] < 0) continue;
    for (let y = top[x]; y <= sbase + 1; y++) {
      const d = y - top[x], b = bay(x, y); let c = P.storm;
      if (y === sbase + 1) { if (b > .55 && mask[sbase * mw + x]) stormL.px(x, y, '#070b24'); continue; }
      if (d === 0) c = P.stormRim; else if (d <= 2 && b < .5) c = '#121c52';
      if (sbase - y <= 2 && b > .4) c = '#070b24';
      stormL.px(x, y, c);
    }
  }
  edgeLight(stormL, mx, P.stormEdge);
  const stormC = stormL.canvas();
  // вспышка: подсвеченные копии облака (полная и растровая)
  const litFull = new Layer(W, H), litHalf = new Layer(W, H), litPal = ['#2a3a9a', '#4658c0', '#7c8cf0', '#c8d2ff'];
  for (let y = 0; y <= sbase + 1; y++) for (let x = 0; x < W; x++) {
    if (!stormL.has(x, y)) continue;
    const dist = Math.hypot((x - U(-32)) / 1.5, y - Y(71)), lv = clamp(1 - dist / 52, 0, 1) * 3.4 + (bay(x, y) - .5) * .9;
    const c = litPal[clamp(Math.floor(lv + .35), 0, 3)];
    litFull.px(x, y, c); if (bay(x, y) < .45) litHalf.px(x, y, c);
  }
  const litFullC = litFull.canvas(), litHalfC = litHalf.canvas();
  // дождевые полосы под облаком
  const rain = [];
  for (let x = 2; x <= U(-26); x += 3 + Math.floor(rs() * 4)) if (top[x] >= 0) rain.push({ x, ph: Math.floor(rs() * 5), ln: 5 + Math.floor(rs() * 4) });

  /* ---------- далёкие низкие облачка справа (для широких экранов) ---------- */
  const bank = new Layer(W, H), rb = mulberry32(57);
  for (const u of outward(46, 1, limit + 24, 22, 42, rb)) {
    const rx = randint(rb, 9, 18), ry = randint(rb, 2, 4), by = Y(84 - randint(rb, 0, 3)), cx = U(u);
    for (let y = by - ry; y <= by; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const a = (x + .5 - cx) / rx, b = (y + .5 - by) / ry;
      if (a * a + b * b <= 1) bank.px(x, y, y === by - ry || (a < -.5 && b < -.3) ? '#2a3a8e' : '#121a52');
    }
  }
  const bankC = bank.canvas();

  /* ---------- море ---------- */
  const sea = new Layer(W, hs);
  gradient(sea, P.sea, 0, hs - 1);
  for (let y = 0; y < hs; y++) {
    const fr = y / (hs - 1), hw = 5 + y * .42;
    for (let x = 0; x < W; x++) {
      const dx = (x - mx) / hw;
      let a = Math.exp(-dx * dx * 1.6) * (1 - fr * .55) * .9;
      if (y < 8) a = Math.max(a, (1 - y / 8) * .55 * Math.exp(-Math.pow((x - mx) / 70, 2)));
      if (a < .05) continue;
      const q = Math.floor(a * 3 + bay(x, y)) / 3;
      if (q > 0) lighten(sea, x, y, '#7a8cf0', q * .55);
    }
  }
  const seaC = sea.canvas();

  /* ---------- светящийся планктон ---------- */
  const bio = makeMotes(r, Math.round(26 * W / 128), W, { y0: seaY + 10, y1: H - 3, colors: ['#40e8e0', '#80fff0', '#20c0c8'], amp: [1, 2], big: .22 });

  /* ---------- молния ---------- */
  const flashLev = f => {                          // уровень вспышки 0..1 и номер события
    const n = Math.floor(f / 40);
    if (hash(n * 3 + 1) > .55) return 0;
    const rel = f - n * 40 - (4 + Math.floor(hash(n * 5 + 2) * 18));
    return rel >= 0 && rel < 5 ? [1, .5, 0, .9, .35][rel] : 0;
  };
  const boltCache = new Map();
  const bolt = n => {
    let b = boltCache.get(n); if (b) return b;
    const rr = mulberry32(n * 7919 + 17); let x = U(-22 - Math.floor(rr() * 20)), y = Y(66);
    b = { main: [], br: [] };
    const seg = (pts, x0, y0, x1, y1) => {
      for (let yy = y0; yy <= y1; yy++) {
        const xx = Math.round(x0 + (x1 - x0) * (yy - y0) / Math.max(1, y1 - y0)); pts.push([xx, yy]);
      }
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      for (let xx = lo; xx <= hi; xx++) pts.push([xx, y1]);
    };
    let k = 0;
    while (y < seaY - 1) {
      const nx = x + randint(rr, -2, 2), ny = Math.min(seaY - 1, y + 2);
      seg(b.main, x, y, nx, ny);
      if (k === 3) { let bx = nx, by = y + 2; const dir = rr() < .5 ? -1 : 1; for (let j = 0; j < 3; j++) { const nbx = bx + dir * randint(rr, 1, 2); seg(b.br, bx, by, nbx, by + 2); bx = nbx; by += 2; } }
      x = nx; y = ny; k++;
    }
    boltCache.set(n, b); return b;
  };

  /* ---------- кит ---------- */
  const WLEN = 28, finH = { 18: 1, 19: 2, 20: 3, 21: 4, 22: 2, 23: 0 };
  const whaleWL = Y(139);
  function whale(ctx, f) {
    const n = Math.floor(f / 300), tt = f - n * 300;
    if (tt < 48 || tt > 184) return;
    const wl = whaleWL, wx0 = Math.round(U(-34) + (hash(n * 7 + 5) - .5) * 8 - (tt - 60) * .07);
    const rise = sstep(50, 74, tt) * (1 - sstep(120, 146, tt)), sink = (1 - rise) * 8.5;
    const visAt = lx => Math.round(6.5 * Math.pow(Math.sin(Math.PI * (lx + 1.5) / (WLEN + 4)), .8) + (finH[lx] || 0) - sink);
    let minX = 1e9, maxX = -1e9;
    for (let lx = 0; lx < WLEN; lx++) {
      const vis = visAt(lx); if (vis <= 0) continue;
      const x = wx0 + lx, t0 = wl - vis;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      ctx.fillStyle = css(P.whaleRim); ctx.fillRect(x, t0, 1, 1);
      if (vis > 1) { ctx.fillStyle = css(P.whaleMid); ctx.fillRect(x, t0 + 1, 1, 1); }
      if (vis > 2) { ctx.fillStyle = css(P.whale); ctx.fillRect(x, t0 + 2, 1, vis - 2); }
    }
    if (maxX >= minX) {                            // пена и круги на воде
      ctx.fillStyle = css(P.foam); ctx.fillRect(minX - 2, wl, 2, 1); ctx.fillRect(maxX + 1, wl, 2, 1);
      ctx.fillStyle = css('#5a6cd0');
      for (let x = minX - 4; x <= maxX + 4; x += 2) ctx.fillRect(x, wl + 1, 1, 1);
      ctx.fillStyle = css('#3a4cb0');
      for (let x = minX - 8; x <= maxX + 8; x += 4) ctx.fillRect(x, wl + 3, 2, 1);
      // фонтан: две порции
      for (const t1 of [64, 100]) for (let i = 0; i < 16; i++) {
        const p = (tt - t1 - i * 1.1) / 15; if (p < 0 || p > 1.9) continue;
        const hgt = (t1 === 64 ? 20 : 13) * (1 - (p - 1) * (p - 1)), k = ((i * 5) % 7) - 3;
        const sx = wx0 + 6 + Math.round(k * .8 * p + p * 1.5), sy = wl - visAt(6) - Math.round(hgt);
        ctx.fillStyle = css(p < .9 ? '#ffffff' : p < 1.4 ? '#c6d2ff' : '#7f90dc');
        ctx.fillRect(sx, sy, 1, 1);
        if (p < 1.1 && i % 2 === 0) ctx.fillRect(sx + 1, sy, 1, 1);
      }
    }
    // хвост при нырке
    const ph = clamp((tt - 128) / 52, 0, 1), fh = Math.round(Math.sin(Math.PI * ph) * 9);
    if (fh > 1) {
      const tx = wx0 + WLEN, y = wl - fh;
      ctx.fillStyle = css(P.whaleRim); ctx.fillRect(tx - 7, y - 1, 1, 1); ctx.fillRect(tx + 7, y - 1, 1, 1);
      ctx.fillRect(tx - 6, y, 5, 1); ctx.fillRect(tx + 2, y, 5, 1);
      ctx.fillStyle = css(P.whaleMid); ctx.fillRect(tx - 5, y + 1, 11, 1);
      ctx.fillStyle = css(P.whale); if (y + 2 < wl) ctx.fillRect(tx - 2, y + 2, 5, 1);
      if (y + 3 < wl) ctx.fillRect(tx - 1, y + 3, 3, wl - y - 3);
      ctx.fillStyle = css(P.foam); ctx.fillRect(tx - 3, wl, 7, 1);
    }
  }

  /* ---------- кадр ---------- */
  const ov = new Overlay(W, H);
  const HR0 = MR + 1, HR1 = 48;
  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f, P.starPal);
      drawSparkles(ctx, sparks, f, '#ffffff');
      drawCloudRows(ctx, rows, f, W);
      ctx.drawImage(bankC, 0, 0);
      ctx.drawImage(stormC, 0, 0);
      const fl = flashLev(f), fn = Math.floor(f / 40);
      if (fl > 0) {
        ctx.drawImage(fl > .7 ? litFullC : litHalfC, 0, 0);
        const b = bolt(fn);
        ctx.fillStyle = css('#9fb0ff');
        for (const [x, y] of b.main) { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); }
        ctx.fillStyle = css(fl > .7 ? '#ffffff' : '#b8c4ff');
        for (const [x, y] of b.main) ctx.fillRect(x, y, 1, 1);
        ctx.fillStyle = css('#cdd6ff');
        for (const [x, y] of b.br) ctx.fillRect(x, y, 1, 1);
      }
      ctx.drawImage(seaC, 0, seaY);
      // корабль: красный огонёк, моргает
      const sl = (f % 36) < 28;
      ctx.fillStyle = css(sl ? '#ff4658' : '#8a2a48'); ctx.fillRect(shipX, seaY - 3, 1, 1);
      if (sl) { ctx.fillStyle = css('#7a2c58'); ctx.fillRect(shipX, seaY + 1, 1, 1); }

      /* полупрозрачные слои: ореол луны, волны, дорожка, дождь, вспышка */
      const pulse = .75 + .25 * Math.sin(f / 19);
      for (let y = Math.max(0, my - HR1); y < Math.min(H, my + HR1); y++) for (let x = Math.max(0, mx - HR1); x < Math.min(W, mx + HR1); x++) {
        const d = Math.hypot(x - mx, y - my); if (d < HR0) continue;
        if (y < mh && mask[y * mw + x]) continue;
        const a = Math.pow(clamp((HR1 - d) / (HR1 - HR0), 0, 1), 1.7) * .3 * pulse;
        const q = clamp(Math.floor(a * 4 + bay(x, y)) / 4, 0, 1);
        if (q > 0) ov.over(x, y, '#8c9cf6', q);
      }
      waves(ov, f, { y0: seaY + 4, y1: H, hi: '#5062c8', lam0: 6, lam1: 30, gap0: 4, dgap: .5, thr: .4, aHi: .6, speed: .45 });
      glitter(ov, f, mx, seaY + 1, H, 3, 34, '#8a9cf0', { thr: .55, alpha: .55 });
      glitter(ov, f, mx, seaY + 1, H, 2, 33, '#ffffff', { thr: 1.0, alpha: .95 });
      for (const q of rain) {
        for (let y = sbase + 2, j = 0; y < seaY && j < q.ln; y++, j++) if (((y + f * 2 + q.ph) % 5) < 2) ov.over(q.x + (j >> 2), y, '#2c3a8c', .5);
      }
      if (fl > 0) {
        const bc = U(-32), cy = Y(72), RX = 50, RY = 30;
        for (let y = Math.max(0, cy - RY); y < Math.min(H, cy + RY); y++) for (let x = Math.max(0, bc - RX); x < Math.min(W, bc + RX); x++) {
          const d = Math.hypot((x - bc) / RX, (y - cy) / RY); if (d >= 1) continue;
          const a = Math.pow(1 - d, 1.6) * .42 * fl, q = clamp(Math.floor(a * 4 + bay(x, y)) / 4, 0, 1);
          if (q > 0) ov.over(x, y, '#8a9cff', q);
        }
        for (let y = seaY; y < seaY + 6; y++) for (let x = bc - 24; x <= bc + 24; x++) {
          const a = (1 - (y - seaY) / 6) * (1 - Math.abs(x - bc) / 26) * .5 * fl;
          if (a > 0 && Math.floor(a * 3 + bay(x, y)) >= 1) ov.over(x, y, '#7c8cf0', .55);
        }
      }
      ov.flush(ctx);

      whale(ctx, f);
      drawMotes(ctx, bio, f);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { C, css, Layer, Overlay, mulberry32, randint, bay, clamp, gradient, addGlow, sunDisc, edgeLight, outward,
      cloudRow, drawCloudRows, makeMotes, drawMotes, waves, glitter, drawBird, smokeColumn } = px;
    const r = mulberry32(2024);
    const sstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const hash = n => { let x = Math.imul(n + 1, 0x9E3779B1); x ^= x >>> 15; x = Math.imul(x, 0x85EBCA6B); x ^= x >>> 13; return (x >>> 0) / 4294967296; };
    const lighten = (L, x, y, col, t) => {
      if (x < 0 || y < 0 || x >= L.w || y >= L.h) return;
      const i = (y * L.w + x) << 2, d = L.d; col = C(col);
      d[i] += (col[0] - d[i]) * t; d[i + 1] += (col[1] - d[i + 1]) * t; d[i + 2] += (col[2] - d[i + 2]) * t;
    };

    const P = {
      sky: ['#1a62d0', '#2878dc', '#3e90e6', '#5aa8ee', '#7cc0f2', '#a0d6f6', '#c4e8f8', '#e0f4fa'],
      sea: ['#2a86d4', '#2070c4', '#1a5eb4', '#164ea4', '#124094', '#0e3484', '#0a2874'],
      whale: '#1a3466', whaleMid: '#3a68a8', whaleRim: '#9cc4f0', foam: '#ffffff',
    };

    const seaY = Y(88), hs = H - seaY;
    const mx = U(0), my = Ys(36), MR = 12;
    const xc = W / 2;

    /* ---------- небо и высокое солнце ---------- */
    const sky = new Layer(W, H);
    gradient(sky, P.sky, 0, seaY - 1);
    addGlow(sky, mx, my, MR, 62, '#fff4c0', .8, 5, 1.4);
    addGlow(sky, mx, my, MR, 120, '#fffbe0', .3, 4, 1.6);
    sunDisc(sky, mx, my, [[MR, '#ffe27a'], [MR - 2, '#fff0a0'], [MR - 4, '#fff8d0'], [MR - 6, '#ffffff']]);
    const shipX = U(36);
    sky.rect(shipX - 3, seaY - 1, shipX + 3, seaY - 1, '#26304e');
    sky.px(shipX - 1, seaY - 2, '#f4f8ff'); sky.px(shipX + 1, seaY - 2, '#f4f8ff'); sky.px(shipX + 2, seaY - 3, '#26304e');
    const skyC = sky.canvas();

    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 4, cols: cc, y: Ys(22), v: .2, gap: 120, off: 10 }),
      cloudRow({ sizes: [[34, 9], [44, 10]], seed: 9, cols: cc, y: Ys(56), v: .14, gap: 112, off: 50 }),
    ];

    /* ---------- далёкие кучевые башни слева (вместо грозы) ---------- */
    const sbase = Y(79), mw = W, mh = sbase + 2, mask = new Uint8Array(mw * mh);
    const mEll = (cx, cy, rx, ry) => {
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(sbase, Math.ceil(cy + ry)); y++)
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(mw - 1, Math.ceil(cx + rx)); x++) {
          const a = (x + .5 - cx) / rx, b = (y + .5 - cy) / ry; if (a * a + b * b <= 1) mask[y * mw + x] = 1;
        }
    };
    const rs = mulberry32(31);
    for (let u = -21; u > -limit - 14;) {
      const t = clamp((-u - 50) / (limit - 30), 0, 1), ry = (15 - 9 * t * t) * (.8 + .35 * rs()), rx = 7 + rs() * 5;
      mEll(U(u), sbase + 1, rx, ry);
      mEll(U(u + (rs() - .5) * rx), sbase - ry * .8, rx * .6, ry * .38);
      u -= rx * (.9 + rs() * .7);
    }
    for (let y = sbase - 3; y <= sbase; y++) for (let x = 0; x <= U(-24); x++) mask[y * mw + x] = 1;
    const stormL = new Layer(W, H), top = new Int16Array(W).fill(-1);
    for (let x = 0; x < W; x++) for (let y = 0; y <= sbase; y++) if (mask[y * mw + x]) { top[x] = y; break; }
    for (let x = 0; x < W; x++) {
      if (top[x] < 0) continue;
      for (let y = top[x]; y <= sbase + 1; y++) {
        const d = y - top[x], b = bay(x, y), depth = (y - top[x]) / Math.max(1, sbase - top[x]); let c = '#f4f8ff';
        if (y === sbase + 1) { if (b > .55 && mask[sbase * mw + x]) stormL.px(x, y, '#a8c0e0'); continue; }
        if (d === 0) c = '#ffffff'; else if (d <= 2 && b < .5) c = '#ffffff';
        else if (depth > .45 && b < (depth - .35) * 1.4) c = '#c4d4ec';
        if (sbase - y <= 2 && b > .4) c = '#a0b8dc';
        stormL.px(x, y, c);
      }
    }
    edgeLight(stormL, mx, '#ffffff');
    const stormC = stormL.canvas();

    /* ---------- низкие облачка справа ---------- */
    const bank = new Layer(W, H), rb = mulberry32(57);
    for (const u of outward(46, 1, limit + 24, 22, 42, rb)) {
      const rx = randint(rb, 9, 18), ry = randint(rb, 2, 4), by = Y(84 - randint(rb, 0, 3)), cx = U(u);
      for (let y = by - ry; y <= by; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        const a = (x + .5 - cx) / rx, b = (y + .5 - by) / ry;
        if (a * a + b * b <= 1) bank.px(x, y, y === by - ry || (a < -.5 && b < -.3) ? '#ffffff' : '#d0e0f4');
      }
    }
    const bankC = bank.canvas();

    /* ---------- море ---------- */
    const sea = new Layer(W, hs);
    gradient(sea, P.sea, 0, hs - 1);
    for (let y = 0; y < hs; y++) {
      const fr = y / (hs - 1), hw = 5 + y * .42;
      for (let x = 0; x < W; x++) {
        const dx = (x - mx) / hw;
        let a = Math.exp(-dx * dx * 1.6) * (1 - fr * .55) * .9;
        if (y < 8) a = Math.max(a, (1 - y / 8) * .55 * Math.exp(-Math.pow((x - mx) / 70, 2)));
        if (a < .05) continue;
        const q = Math.floor(a * 3 + bay(x, y)) / 3;
        if (q > 0) lighten(sea, x, y, '#a8dcff', q * .5);
      }
    }
    const seaC = sea.canvas();

    const sparkle = makeMotes(r, Math.round(26 * W / 128), W, { y0: seaY + 10, y1: H - 3, colors: ['#ffffff', '#d8f0ff', '#a8d8ff'], amp: [1, 2], big: .25 });
    const gulls = [0, 1, 2, 3].map(i => ({ x0: r() * (W + 60), y: Ys([60, 74, 48, 84][i]), v: [.34, .26, .42, .22][i], ph: r() * 6, fl: Math.floor(r() * 4) }));

    /* ---------- кит ---------- */
    const WLEN = 28, finH = { 18: 1, 19: 2, 20: 3, 21: 4, 22: 2, 23: 0 };
    const whaleWL = Y(139);
    function whale(ctx, f) {
      const n = Math.floor(f / 300), tt = f - n * 300;
      if (tt < 48 || tt > 184) return;
      const wl = whaleWL, wx0 = Math.round(U(-34) + (hash(n * 7 + 5) - .5) * 8 - (tt - 60) * .07);
      const rise = sstep(50, 74, tt) * (1 - sstep(120, 146, tt)), sink = (1 - rise) * 8.5;
      const visAt = lx => Math.round(6.5 * Math.pow(Math.sin(Math.PI * (lx + 1.5) / (WLEN + 4)), .8) + (finH[lx] || 0) - sink);
      let minX = 1e9, maxX = -1e9;
      for (let lx = 0; lx < WLEN; lx++) {
        const vis = visAt(lx); if (vis <= 0) continue;
        const x = wx0 + lx, t0 = wl - vis;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        ctx.fillStyle = css(P.whaleRim); ctx.fillRect(x, t0, 1, 1);
        if (vis > 1) { ctx.fillStyle = css(P.whaleMid); ctx.fillRect(x, t0 + 1, 1, 1); }
        if (vis > 2) { ctx.fillStyle = css(P.whale); ctx.fillRect(x, t0 + 2, 1, vis - 2); }
      }
      if (maxX >= minX) {
        ctx.fillStyle = css(P.foam); ctx.fillRect(minX - 2, wl, 2, 1); ctx.fillRect(maxX + 1, wl, 2, 1);
        ctx.fillStyle = css('#8cc8f4');
        for (let x = minX - 4; x <= maxX + 4; x += 2) ctx.fillRect(x, wl + 1, 1, 1);
        ctx.fillStyle = css('#58a0e0');
        for (let x = minX - 8; x <= maxX + 8; x += 4) ctx.fillRect(x, wl + 3, 2, 1);
        for (const t1 of [64, 100]) for (let i = 0; i < 16; i++) {
          const p = (tt - t1 - i * 1.1) / 15; if (p < 0 || p > 1.9) continue;
          const hgt = (t1 === 64 ? 20 : 13) * (1 - (p - 1) * (p - 1)), k = ((i * 5) % 7) - 3;
          const sx = wx0 + 6 + Math.round(k * .8 * p + p * 1.5), sy = wl - visAt(6) - Math.round(hgt);
          ctx.fillStyle = css(p < .9 ? '#ffffff' : p < 1.4 ? '#d8ecff' : '#a0c8f0');
          ctx.fillRect(sx, sy, 1, 1);
          if (p < 1.1 && i % 2 === 0) ctx.fillRect(sx + 1, sy, 1, 1);
        }
      }
      const ph = clamp((tt - 128) / 52, 0, 1), fh = Math.round(Math.sin(Math.PI * ph) * 9);
      if (fh > 1) {
        const tx = wx0 + WLEN, y = wl - fh;
        ctx.fillStyle = css(P.whaleRim); ctx.fillRect(tx - 7, y - 1, 1, 1); ctx.fillRect(tx + 7, y - 1, 1, 1);
        ctx.fillRect(tx - 6, y, 5, 1); ctx.fillRect(tx + 2, y, 5, 1);
        ctx.fillStyle = css(P.whaleMid); ctx.fillRect(tx - 5, y + 1, 11, 1);
        ctx.fillStyle = css(P.whale); if (y + 2 < wl) ctx.fillRect(tx - 2, y + 2, 5, 1);
        if (y + 3 < wl) ctx.fillRect(tx - 1, y + 3, 3, wl - y - 3);
        ctx.fillStyle = css(P.foam); ctx.fillRect(tx - 3, wl, 7, 1);
      }
    }

    const ov = new Overlay(W, H);
    const HR0 = MR + 1, HR1 = 52;
    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        ctx.drawImage(bankC, 0, 0);
        ctx.drawImage(stormC, 0, 0);
        for (const g of gulls) {
          const x = Math.floor(((g.x0 + g.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
          drawBird(ctx, x, g.y + Math.round(2 * Math.sin(2 * Math.PI * f / 80 + g.ph)), (((f >> 2) + g.fl) & 1) === 1, '#ffffff');
        }
        ctx.drawImage(seaC, 0, seaY);
        smokeColumn(ctx, shipX + 2, seaY - 4, f, { n: 3, rise: 9, per: 90, sway: .8, r0: .5, r1: 1.5, wind: 3, cols: ['#f0f4fc', '#cdd8ec', '#a8b8d4'] });

        const pulse = .8 + .2 * Math.sin(f / 19);
        for (let y = Math.max(0, my - HR1); y < Math.min(H, my + HR1); y++) for (let x = Math.max(0, mx - HR1); x < Math.min(W, mx + HR1); x++) {
          const d = Math.hypot(x - mx, y - my); if (d < HR0) continue;
          if (y < mh && mask[y * mw + x]) continue;
          const a = Math.pow(clamp((HR1 - d) / (HR1 - HR0), 0, 1), 1.7) * .26 * pulse;
          const q = clamp(Math.floor(a * 4 + bay(x, y)) / 4, 0, 1);
          if (q > 0) ov.over(x, y, '#fff6c8', q);
        }
        waves(ov, f, { y0: seaY + 4, y1: H, hi: '#ffffff', lo: '#0e3a88', lam0: 6, lam1: 30, gap0: 4, dgap: .5, thr: .4, aHi: .65, aLo: .3, speed: .45 });
        glitter(ov, f, mx, seaY + 1, H, 3, 34, '#d8f0ff', { thr: .55, alpha: .55 });
        glitter(ov, f, mx, seaY + 1, H, 2, 33, '#ffffff', { thr: 1.0, alpha: .95 });
        ov.flush(ctx);

        whale(ctx, f);
        drawMotes(ctx, sparkle, f);
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('ocean', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: beach ===== */
/* Пляж: закат, полуушедшее солнце, золотая дорожка, прибой, силуэты пальм, костёр с искрами.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, clamp, bay, tri, gradient, addGlow, sunDisc, outward,
    cloudRow, drawCloudRows, makeStars, drawStars, makeMotes, drawMotes, glowPulse, waves, glitter, drawBird } = px;
  const r = mulberry32(61), hy = Y(93), xc = W / 2;
  const sunX = U(0), sunY = hy - 7;
  const fx = U(24), fy = Y(171);                        // костёр

  /* ---------- небо, солнце, море в одном холсте ---------- */
  const base = new Layer(W, H), sea = new Layer(W, H);
  gradient(base, ['#1c1450', '#2a1a62', '#3e2274', '#5a2c84', '#7c3790', '#a64590', '#d25a88', '#f27888', '#ff9a86', '#ffb68c', '#ffcc9c'], 0, hy);
  addGlow(base, sunX, sunY, 14, 74, '#ff9a6c', .8, 5, 1.5);
  sunDisc(base, sunX, sunY, [[15, '#ffcc7e'], [13, '#ffe0a0'], [9, '#fff0c0']]);
  gradient(sea, ['#ffb490', '#f4909c', '#d2749e', '#a85aa6', '#7a4aa8', '#4e3c9a', '#36338a', '#3a3590', '#5a4ca6', '#7a64bc'], hy, Y(141));
  base.d.set(sea.d.subarray(hy * W * 4), hy * W * 4);
  addGlow(base, sunX, hy + 2, 4, 44, '#ffb890', .5, 4, 1.4);
  const baseC = base.canvas();
  const stars = makeStars(r, Math.round(56 * W / 128), W, Math.min(hy - 26, Ys(72)));

  /* ---------- облака ---------- */
  const rows = [
    cloudRow({ sizes: [[44, 6], [36, 5], [52, 6]], seed: 3, cols: ['#6a3a8c', '#e0607e', '#9a4a98'], y: Ys(24), v: .3, gap: 120, off: 10 }),
    cloudRow({ sizes: [[30, 5], [40, 6], [34, 5]], seed: 9, cols: ['#8a46a0', '#ee7a90', '#b05aa0'], y: Ys(52), v: .45, gap: 108, off: 60 }),
    cloudRow({ sizes: [[30, 5], [22, 4], [38, 5]], seed: 15, cols: ['#c85a8e', '#ffa088', '#ee7a8a'], y: Ys(74), v: .6, gap: 132, off: 30 }),
  ];
  const gulls = [0, 1, 2].map(i => ({ x0: r() * (W + 60), y: Ys([30, 40, 56][i]), v: [.34, .26, .42][i], ph: r() * 6, fl: Math.floor(r() * 4) }));

  /* ---------- горизонт: острова ---------- */
  const far = new Layer(W, H), rf = mulberry32(5);
  function island(cx, w, h) {
    for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
      const t = (x - cx) / (w / 2), hh = Math.round(h * Math.pow(Math.max(0, 1 - t * t), .6) * (.85 + .15 * Math.sin(x * .9)));
      if (hh > 0) { far.rect(x, hy - hh, x, hy - 1, '#7a4a9c'); far.px(x, hy - hh, '#b070b4'); }
    }
  }
  island(U(52), 40, 7); island(U(34), 10, 3);
  for (const d of [-1, 1]) for (const u of outward(d > 0 ? 84 : -50, d, limit, 40, 92, rf)) island(U(u), randint(rf, 8, 22), randint(rf, 2, 4));
  const farC = far.canvas();

  /* ---------- берег и песок ---------- */
  const shore = new Int32Array(W);
  let shoreMax = 0;
  for (let x = 0; x < W; x++) {
    const u = x - xc;
    shore[x] = Y(139.5 + 3.5 * Math.sin(2 * Math.PI * u / 150 + .4) + 1.5 * Math.sin(2 * Math.PI * u / 57 + 1) - .04 * u);
    if (shore[x] > shoreMax) shoreMax = shore[x];
  }
  const sand = new Layer(W, H), tmp = new Layer(W, H);
  gradient(tmp, ['#a9647e', '#9b5c84', '#8a528a', '#70478a', '#56407c', '#41346a'], Y(139), H);
  for (let x = 0; x < W; x++) for (let y = shore[x]; y < H; y++) { const i = (y * W + x) << 2; sand.px(x, y, [tmp.d[i], tmp.d[i + 1], tmp.d[i + 2]]); }
  for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++) if (bay(x, shore[x] + k) < [.95, .65, .4, .18][k]) sand.px(x, shore[x] + k, '#6a508e');
  addGlow(sand, fx, fy - 6, 6, 46, '#ff8a3a', .55, 4, 1.4);        // отсвет костра на песке
  const rs = mulberry32(77);
  for (let i = 0, n = Math.round(W * 2.4); i < n; i++) {           // песчинки
    const x = Math.floor(rs() * W), y = shore[x] + 4 + Math.floor(rs() * (H - shore[x]));
    if (sand.has(x, y)) sand.px(x, y, rs() < .5 ? '#b8788a' : '#4a3a76');
  }
  function starfish(cx, cy) {
    const m = ['..X..', '.XXX.', 'XXXXX', '.X.X.', 'X...X'];
    m.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') sand.px(cx - 2 + i, cy - 2 + j, '#ff9a4e'); }));
    sand.px(cx, cy, '#ffd080');
  }
  starfish(U(-24), Y(168)); starfish(U(-40), Y(182));
  sand.rect(U(-56), Y(187), U(-36), Y(187), '#8a5a82');
  const sandC = sand.canvas();

  /* ---------- пальмы ---------- */
  const DARK = '#1a0f36', HL = '#34205a';
  function trunk(L, bx, by, tx, ty, w0, w1, pw) {
    for (let y = by; y >= ty; y--) {
      const t = (by - y) / (by - ty), x = bx + (tx - bx) * Math.pow(t, pw), w = w0 + (w1 - w0) * t;
      L.rect(Math.round(x - w / 2), y, Math.round(x + w / 2), y, DARK);
      L.px(Math.round(x - w / 2), y, HL);
    }
  }
  function crown(L, cx, cy, spec, f, sway, sc) {
    for (const fr of spec) {
      const a = (fr.a + sway * Math.sin(2 * Math.PI * (f / 90 + fr.ph))) * Math.PI / 180, n = Math.round(fr.len * sc);
      for (let s = 1; s <= n; s++) {
        const k = s / n, x = Math.round(cx + Math.cos(a) * s), y = Math.round(cy - Math.sin(a) * s * .55 + fr.droop * k * k * n * .45);
        L.px(x, y, DARK); L.px(x, y + 1, DARK);
        if (s % 2 === 0 && k > .15 && k < .95) L.px(x, y + 2 + (s % 4 === 0 ? 1 : 0), DARK);
      }
    }
    L.disc(cx, cy, 2, DARK);
  }
  const rp = mulberry32(88), specA = [];
  for (const [a, len, droop] of [[172, 22, 1], [150, 18, .8], [124, 12, .5], [90, 9, .35], [56, 12, .5], [30, 18, .8], [8, 22, 1], [-14, 12, .6], [194, 12, .6]])
    specA.push({ a, len, droop, ph: rp() });
  const palms = new Layer(W, H);
  for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 56, 100, rp)) {      // дальние пальмы для широких экранов
    const hgt = randint(rp, 44, 76), by = Y(randint(rp, 150, 186)), bx = U(u), lean = d * randint(rp, 4, 10);
    trunk(palms, bx, by, bx + lean, by - hgt, 3, 2, 1.5);
    crown(palms, bx + lean, by - hgt, specA, 0, 0, .62 + rp() * .2);
  }
  const rkc = mulberry32(99);                                        // камни на песке
  for (const d of [-1, 1]) for (const u of outward(d * 40, d, limit, 34, 70, rkc)) {
    const x = U(u), y = Y(randint(rkc, 156, 188)), w = randint(rkc, 4, 9);
    palms.ellipseBox(x - (w >> 1), y - 2, x + (w >> 1), y + 1, '#2a1a48'); palms.hline(x - (w >> 1) + 1, x + (w >> 1) - 1, y - 2, '#4a3a78');
  }
  const L1 = { bx: U(-50), by: Y(197), cx: U(-34), cy: Y(97) }, R1 = { bx: U(53), by: Y(197), cx: U(44), cy: Y(130) };
  trunk(palms, L1.bx, L1.by, L1.cx, L1.cy, 5, 2, 1.7);
  trunk(palms, R1.bx, R1.by, R1.cx, R1.cy, 4, 2, 1.5);
  // дрова костра
  palms.line(fx - 8, fy + 1, fx + 6, fy - 2, '#4a2c1c'); palms.line(fx - 8, fy + 2, fx + 6, fy - 1, '#3a2218');
  palms.line(fx + 8, fy + 1, fx - 6, fy - 2, '#4a2c1c'); palms.line(fx + 8, fy + 2, fx - 6, fy - 1, '#3a2218');
  palms.px(fx - 8, fy + 1, '#ff8a30'); palms.px(fx + 8, fy + 1, '#ff8a30'); palms.px(fx, fy - 1, '#ff8a30');
  const palmsC = palms.canvas();
  const crL = new Layer(90, 56), crR = new Layer(70, 46);
  const specB = specA.map(s => Object.assign({}, s, { len: s.len * .72 }));

  /* ---------- пламя, искры, эффекты ---------- */
  const fl = new Layer(26, 30), ovW = new Overlay(W, H), ovF = new Overlay(W, H);
  function flame(f, cx, h0, hw0, ph) {
    const h = Math.round(h0 + 2 * Math.sin(f * 1.3 + ph) + 1.5 * Math.sin(f * 2.1 + 1 + ph));
    for (let k = 0; k <= h; k++) {
      const t = k / h, hw = hw0 * Math.pow(1 - t, .75), c = cx + Math.sin(f * .8 + k * .45 + ph) * 1.4 * t;
      for (let x = Math.ceil(c - hw); x <= Math.floor(c + hw); x++) {
        const d = Math.abs(x - c) / Math.max(.5, hw);
        fl.px(x, 28 - k, d > .7 ? '#ff6a24' : d > .38 ? '#ffa838' : '#ffe27a');
      }
    }
  }
  const sparks = makeMotes(r, 14, W, { x0: fx - 5, x1: fx + 5, y0: fy - 52, y1: fy - 8, colors: ['#ffb040', '#ffd070', '#ff8a30'], rise: .7, amp: [1, 3], big: 0 });

  return {
    draw(ctx, f) {
      ctx.drawImage(baseC, 0, 0);
      drawStars(ctx, stars, f);
      drawCloudRows(ctx, rows, f, W);
      for (const g of gulls) {
        const x = Math.floor(((g.x0 + g.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
        drawBird(ctx, x, g.y + Math.round(2 * Math.sin(2 * Math.PI * f / 80 + g.ph)), (((f >> 2) + g.fl) & 1) === 1, '#2c1f58');
      }
      ctx.drawImage(farC, 0, 0);
      waves(ovW, f, { y0: hy + 3, y1: shoreMax + 2, hi: '#e8b4d4', lo: '#2a2070', lam0: 4.6, lam1: 24, gap0: 3, dgap: .35, thr: .35, aHi: .55, aLo: .3 });
      glitter(ovW, f, sunX + Math.round(1.5 * Math.sin(f / 45)), hy + 2, Y(131), 3, 22, '#ffe8b0', { thr: 1.12, alpha: .95 });
      ovW.flush(ctx, 0, hy + 1, W, shoreMax + 3);
      ctx.drawImage(sandC, 0, 0);
      for (let x = 0; x < W; x++) {                                   // накат пены
        const o = Math.round(1.5 + 1.5 * Math.sin(2 * Math.PI * (f / 80 - x / 70))), y = shore[x] - 1 + o;
        ctx.fillStyle = '#fff4f8'; ctx.fillRect(x, y, 1, 1);
        if (bay(x, y + 1) < .75) { ctx.fillStyle = '#c4b0e8'; ctx.fillRect(x, y + 1, 1, 1); }
      }
      ctx.drawImage(palmsC, 0, 0);
      crL.clear(); crown(crL, 45, 28, specA, f, 4, 1); crL.draw(ctx, L1.cx - 45, L1.cy - 28);
      crR.clear(); crown(crR, 35, 23, specB, f, 4, 1); crR.draw(ctx, R1.cx - 35, R1.cy - 23);
      fl.clear(); flame(f, 13, 15, 5.8, 0); flame(f, 8, 9, 3.4, 2); flame(f, 18, 9, 3.4, 4); fl.draw(ctx, fx - 13, fy - 28);
      glowPulse(ovF, fx, fy - 8, 30, '#ff8a3a', f, { per: 9, strength: .5, lo: .55 });
      glowPulse(ovF, fx, fy - 6, 18, '#ffc060', f, { per: 6, ph: 3, strength: .4, lo: .5 });
      ovF.flush(ctx, Math.max(0, fx - 31), Math.max(0, fy - 40), Math.min(W, fx + 31), Math.min(H, fy + 24));
      drawMotes(ctx, sparks, f);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, clamp, bay, gradient, addGlow, sunDisc, outward,
      cloudRow, drawCloudRows, makeMotes, drawMotes, waves, glitter, drawBird } = px;
    const r = mulberry32(61), hy = Y(93), xc = W / 2;
    const sunX = U(-12), sunY = Ys(30);
    const fx = U(24), fy = Y(171);                       // зонт на месте костра

    /* ---------- небо, солнце, лагуна ---------- */
    const base = new Layer(W, H), sea = new Layer(W, H);
    gradient(base, ['#2c82e0', '#4a9aea', '#6cb2f0', '#8ecaf4', '#b0e0f6', '#d0f0f8', '#e4f8fa'], 0, hy);
    addGlow(base, sunX, sunY, 10, 66, '#fff4c0', .75, 5, 1.5);
    addGlow(base, sunX, sunY, 10, 120, '#fffbe0', .3, 4, 1.8);
    sunDisc(base, sunX, sunY, [[11, '#ffe27a'], [9, '#fff0a0'], [7, '#fff8d0'], [5, '#ffffff']]);
    gradient(sea, ['#52b4ea', '#40b0e4', '#30b4dc', '#28b8d4', '#38ccd0', '#58dcc8', '#7ae8c8', '#9cf0d0', '#b8f4d8', '#c8f6dc'], hy, Y(141));
    base.d.set(sea.d.subarray(hy * W * 4), hy * W * 4);
    addGlow(base, sunX, hy + 2, 4, 44, '#e8fcff', .45, 4, 1.4);
    const baseC = base.canvas();
    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 3, cols: cc, y: Ys(20), v: .26, gap: 120, off: 10 }),
      cloudRow({ sizes: [[32, 8], [42, 9], [36, 8]], seed: 9, cols: cc, y: Ys(50), v: .38, gap: 108, off: 60 }),
      cloudRow({ sizes: [[32, 7], [24, 6], [40, 7]], seed: 15, cols: cc, y: Ys(72), v: .5, gap: 132, off: 30 }),
    ];
    const gulls = [0, 1, 2, 3].map(i => ({ x0: r() * (W + 60), y: Ys([34, 44, 58, 66][i]), v: [.34, .26, .42, .3][i], ph: r() * 6, fl: Math.floor(r() * 4) }));

    /* ---------- горизонт: острова ---------- */
    const far = new Layer(W, H), rf = mulberry32(5);
    function island(cx, w, h) {
      for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
        const t = (x - cx) / (w / 2), hh = Math.round(h * Math.pow(Math.max(0, 1 - t * t), .6) * (.85 + .15 * Math.sin(x * .9)));
        if (hh > 0) { far.rect(x, hy - hh, x, hy - 1, '#4a9a7a'); far.px(x, hy - hh, '#8ad4a8'); }
      }
    }
    island(U(52), 40, 7); island(U(34), 10, 3);
    for (const d of [-1, 1]) for (const u of outward(d > 0 ? 84 : -50, d, limit, 40, 92, rf)) island(U(u), randint(rf, 8, 22), randint(rf, 2, 4));
    const farC = far.canvas();

    /* ---------- берег и песок ---------- */
    const shore = new Int32Array(W);
    let shoreMax = 0;
    for (let x = 0; x < W; x++) {
      const u = x - xc;
      shore[x] = Y(139.5 + 3.5 * Math.sin(2 * Math.PI * u / 150 + .4) + 1.5 * Math.sin(2 * Math.PI * u / 57 + 1) - .04 * u);
      if (shore[x] > shoreMax) shoreMax = shore[x];
    }
    const sand = new Layer(W, H), tmp = new Layer(W, H);
    gradient(tmp, ['#f6e8c0', '#f2dfae', '#eed69e', '#e6ca8c', '#debe7c', '#d4b26c'], Y(139), H);
    for (let x = 0; x < W; x++) for (let y = shore[x]; y < H; y++) { const i = (y * W + x) << 2; sand.px(x, y, [tmp.d[i], tmp.d[i + 1], tmp.d[i + 2]]); }
    for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++) if (bay(x, shore[x] + k) < [.95, .65, .4, .18][k]) sand.px(x, shore[x] + k, '#c4a468');
    const rs = mulberry32(77);
    for (let i = 0, n = Math.round(W * 2.4); i < n; i++) {
      const x = Math.floor(rs() * W), y = shore[x] + 4 + Math.floor(rs() * (H - shore[x]));
      if (sand.has(x, y)) sand.px(x, y, rs() < .5 ? '#fff4d0' : '#c8a460');
    }
    function starfish(cx, cy) {
      const m = ['..X..', '.XXX.', 'XXXXX', '.X.X.', 'X...X'];
      m.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') sand.px(cx - 2 + i, cy - 2 + j, '#ff8a4a'); }));
      sand.px(cx, cy, '#ffd080');
    }
    starfish(U(-24), Y(168)); starfish(U(-40), Y(182));
    sand.rect(U(-56), Y(187), U(-36), Y(187), '#c8a468');
    // тень зонта и полотенце
    for (let y = fy - 1; y <= fy + 7; y++) for (let x = fx - 16; x <= fx + 18; x++) {
      const a = 1 - Math.hypot((x - (fx + 4)) / 17, (y - (fy + 3)) / 4.5); if (a > 0 && a * 1.6 > bay(x, y) && sand.has(x, y)) sand.px(x, y, '#c8a864');
    }
    const tw0 = fx - 14, tw1 = fx - 2, ty0 = fy + 4;
    for (let y = ty0; y < ty0 + 6; y++) for (let x = tw0; x <= tw1; x++) sand.px(x, y, ((x - tw0) >> 1) % 2 ? '#ffffff' : '#3a8ad8');
    sand.hline(tw0, tw1, ty0, '#8ac4f4'); sand.hline(tw0, tw1, ty0 + 5, '#2a68b8');
    const sandC = sand.canvas();

    /* ---------- пальмы ---------- */
    const TRK = '#7a5230', TRH = '#b08050', G1 = '#2c8a40', G2 = '#5ac85a';
    function trunk(L, bx, by, tx, ty, w0, w1, pw) {
      for (let y = by; y >= ty; y--) {
        const t = (by - y) / (by - ty), x = bx + (tx - bx) * Math.pow(t, pw), w = w0 + (w1 - w0) * t;
        L.rect(Math.round(x - w / 2), y, Math.round(x + w / 2), y, TRK);
        L.px(Math.round(x - w / 2), y, TRH);
        if (y % 5 === 0) L.px(Math.round(x + w / 2), y, '#5a3a22');
      }
    }
    function crown(L, cx, cy, spec, f, sway, sc) {
      for (const fr of spec) {
        const a = (fr.a + sway * Math.sin(2 * Math.PI * (f / 90 + fr.ph))) * Math.PI / 180, n = Math.round(fr.len * sc);
        for (let s = 1; s <= n; s++) {
          const k = s / n, x = Math.round(cx + Math.cos(a) * s), y = Math.round(cy - Math.sin(a) * s * .55 + fr.droop * k * k * n * .45);
          L.px(x, y, G2); L.px(x, y + 1, G1);
          if (s % 2 === 0 && k > .15 && k < .95) L.px(x, y + 2 + (s % 4 === 0 ? 1 : 0), G1);
        }
      }
      L.disc(cx, cy, 2, '#1c6a30'); L.px(cx - 1, cy + 2, '#5a3a20'); L.px(cx + 1, cy + 2, '#5a3a20');
    }
    const rp = mulberry32(88), specA = [];
    for (const [a, len, droop] of [[172, 22, 1], [150, 18, .8], [124, 12, .5], [90, 9, .35], [56, 12, .5], [30, 18, .8], [8, 22, 1], [-14, 12, .6], [194, 12, .6]])
      specA.push({ a, len, droop, ph: rp() });
    const palms = new Layer(W, H);
    for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 56, 100, rp)) {
      const hgt = randint(rp, 44, 76), by = Y(randint(rp, 150, 186)), bx = U(u), lean = d * randint(rp, 4, 10);
      trunk(palms, bx, by, bx + lean, by - hgt, 3, 2, 1.5);
      crown(palms, bx + lean, by - hgt, specA, 0, 0, .62 + rp() * .2);
    }
    const rkc = mulberry32(99);
    for (const d of [-1, 1]) for (const u of outward(d * 40, d, limit, 34, 70, rkc)) {
      const x = U(u), y = Y(randint(rkc, 156, 188)), w = randint(rkc, 4, 9);
      palms.ellipseBox(x - (w >> 1), y - 2, x + (w >> 1), y + 1, '#8a7a68'); palms.hline(x - (w >> 1) + 1, x + (w >> 1) - 1, y - 2, '#d0c0a8');
    }
    const L1 = { bx: U(-50), by: Y(197), cx: U(-34), cy: Y(97) }, R1 = { bx: U(53), by: Y(197), cx: U(44), cy: Y(130) };
    trunk(palms, L1.bx, L1.by, L1.cx, L1.cy, 5, 2, 1.7);
    trunk(palms, R1.bx, R1.by, R1.cx, R1.cy, 4, 2, 1.5);
    // зонт: ножка, полосатый купол, бахрома
    const ptop = fy - 24;
    palms.rect(fx, ptop, fx, fy + 3, '#f0e8e0'); palms.px(fx + 1, fy + 3, '#c8c0b8');
    for (let x = -13; x <= 13; x++) {
      const hgt = Math.round(9 * Math.sqrt(Math.max(0, 1 - (x / 13.5) * (x / 13.5)))), red = ((x + 13) >> 2) % 2 === 0;
      for (let y = ptop - hgt; y <= ptop; y++) palms.px(fx + x, y, red ? (y === ptop - hgt ? '#ff8a8a' : '#e84040') : (y === ptop - hgt ? '#ffffff' : '#f6f2ee'));
      if (((x + 13) >> 1) % 2 === 0) palms.px(fx + x, ptop + 1, red ? '#c02828' : '#d8d0c8');
    }
    palms.px(fx, ptop - 10, '#f0c050'); palms.px(fx, ptop - 11, '#f0c050');
    const palmsC = palms.canvas();
    const crL = new Layer(90, 56), crR = new Layer(70, 46);
    const specB = specA.map(s => Object.assign({}, s, { len: s.len * .72 }));
    const glints = makeMotes(r, Math.round(28 * W / 128), W, { y0: Y(146), y1: H - 2, colors: ['#ffffff', '#fff6c8', '#ffffff'], rise: 0, amp: [0, 1], big: .35 });
    const seaSp = makeMotes(r, Math.round(16 * W / 128), W, { y0: hy + 6, y1: Y(138), colors: ['#ffffff', '#e8fcff'], rise: 0, amp: [0, 1], big: .25 });
    const ovW = new Overlay(W, H);

    return {
      draw(ctx, f) {
        ctx.drawImage(baseC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        for (const g of gulls) {
          const x = Math.floor(((g.x0 + g.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
          drawBird(ctx, x, g.y + Math.round(2 * Math.sin(2 * Math.PI * f / 80 + g.ph)), (((f >> 2) + g.fl) & 1) === 1, '#ffffff');
        }
        ctx.drawImage(farC, 0, 0);
        waves(ovW, f, { y0: hy + 3, y1: shoreMax + 2, hi: '#ffffff', lo: '#1a8ab8', lam0: 4.6, lam1: 24, gap0: 3, dgap: .35, thr: .35, aHi: .7, aLo: .3 });
        glitter(ovW, f, sunX + Math.round(1.5 * Math.sin(f / 45)), hy + 2, Y(131), 3, 22, '#ffffff', { thr: 1.12, alpha: .95 });
        ovW.flush(ctx, 0, hy + 1, W, shoreMax + 3);
        drawMotes(ctx, seaSp, f);
        ctx.drawImage(sandC, 0, 0);
        for (let x = 0; x < W; x++) {
          const o = Math.round(1.5 + 1.5 * Math.sin(2 * Math.PI * (f / 80 - x / 70))), y = shore[x] - 1 + o;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
          if (bay(x, y + 1) < .75) { ctx.fillStyle = '#bfeee8'; ctx.fillRect(x, y + 1, 1, 1); }
        }
        drawMotes(ctx, glints, f);
        ctx.drawImage(palmsC, 0, 0);
        crL.clear(); crown(crL, 45, 28, specA, f, 4, 1); crL.draw(ctx, L1.cx - 45, L1.cy - 28);
        crR.clear(); crown(crR, 35, 23, specB, f, 4, 1); crR.draw(ctx, R1.cx - 35, R1.cy - 23);
        // флажок на зонте
        for (let i = 0; i < 5; i++) { ctx.fillStyle = '#f0c050'; ctx.fillRect(fx + 1 + i, ptop - 11 + Math.round(1.2 * Math.sin(2 * Math.PI * (f / 20 - i / 5))), 1, 2 - (i > 2 ? 1 : 0)); }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('beach', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: savanna ===== */
/* Саванна: огромное закатное солнце, плоские акации, жирафы, колышущаяся трава, стая птиц.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { Layer, Overlay, mulberry32, randint, gradient, addGlow, sunDisc, makeRidge, hill, outward,
    cloudRow, drawCloudRows, makeStars, drawStars, makeMotes, drawMotes, fog, shimmer, drawBird } = px;
  const r = mulberry32(53), xc = W / 2, sunX = U(0), sunY = Y(122);

  /* ---------- небо и солнце ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#18123e', '#241a58', '#3a2268', '#5e2a78', '#8a3a80', '#b84870', '#e0566a', '#f66e5c', '#ff8c5a', '#ffa860', '#ffc070'], 0, Y(138));
  addGlow(sky, sunX, sunY, 18, 92, '#ffa050', .85, 5, 1.5);
  addGlow(sky, sunX, sunY, 18, 150, '#ff7060', .4, 4, 1.8);
  sunDisc(sky, sunX, sunY, [[22, '#ffb858'], [20, '#ffcc70'], [16, '#ffe08c'], [11, '#fff0b4']]);
  const skyC = sky.canvas();
  const stars = makeStars(r, Math.round(48 * W / 128), W, Ys(78));
  const rows = [
    cloudRow({ sizes: [[40, 8], [34, 7], [46, 8]], seed: 4, cols: ['#5a2a78', '#c8507a', '#8a3a88'], y: Ys(12), v: .3, gap: 128, off: 10 }),
    cloudRow({ sizes: [[42, 7], [30, 6]], seed: 11, cols: ['#8a3a7a', '#ff9a6a', '#d0587a'], y: Ys(54), v: .42, gap: 120, off: 66 }),
    cloudRow({ sizes: [[34, 6], [26, 5], [40, 6]], seed: 17, cols: ['#c84a6e', '#ffa464', '#f0705e'], y: Ys(84), v: .6, gap: 136, off: 30 }),
  ];
  const flock = [[0, 0], [-6, -3], [-6, 3], [-12, -6], [-12, 6], [-18, -1]], flockX = r() * (W + 90), flockY = Ys(40);

  /* ---------- равнины: три слоя холмов с косой тенью ---------- */
  const far = new Layer(W, H), mid = new Layer(W, H), near = new Layer(W, H);
  hill(far, makeRidge(xc, Y(136), [[140, 2], [60, 1.2]], 5), { lit: '#a24a78', shade: '#7a3a6e', deep: '#5a2c64', rim: '#ffb070', lightX: sunX, k: .8, lean: .5, depth: 26 });
  hill(mid, makeRidge(xc, Y(150), [[110, 4], [55, 2]], 8), { lit: '#74366e', shade: '#5a2a62', deep: '#3e1d52', rim: '#e0805e', lightX: sunX, k: .8, lean: .6, depth: 26 });
  hill(near, makeRidge(xc, Y(168), [[90, 5], [40, 2]], 12), { lit: '#4a2460', shade: '#3a1c52', deep: '#281442', rim: '#a05070', lightX: sunX, k: .8, lean: .6, depth: 18 });
  near.rect(0, Y(184), W, H, '#1a0c30');

  /* ---------- акации и жирафы ---------- */
  function acacia(L, cx, by, cw, ch, th, col) {
    const top = by - th, hw = cw / 2;
    L.rect(cx - 1, top, cx, by, col);
    L.line(cx, top + Math.round(th * .25), cx - Math.round(cw * .3), top - 1, col);
    L.line(cx - 1, top + Math.round(th * .12), cx + Math.round(cw * .34), top - 1, col);
    L.poly([[cx - hw, top + 1], [cx - hw * .85, top - ch * .55], [cx - hw * .45, top - ch * .95], [cx, top - ch], [cx + hw * .45, top - ch * .95],
      [cx + hw * .85, top - ch * .55], [cx + hw, top + 1]], col);
    for (let x = Math.round(cx - hw * .8); x <= cx + hw * .8; x += 3) L.px(x, top + 2, col);
  }
  function giraffe(L, gx, gy, s, col) {
    const S = v => Math.round(v * s);
    L.ellipseBox(gx - S(9), gy - S(18), gx + S(8), gy - S(8), col);
    for (const dx of [-7, -4, 4, 7]) L.rect(gx + S(dx), gy - S(9), gx + S(dx), gy, col);
    L.poly([[gx + S(5), gy - S(16)], [gx + S(9), gy - S(17)], [gx + S(12), gy - S(36)], [gx + S(9), gy - S(37)]], col);
    L.poly([[gx + S(8), gy - S(38)], [gx + S(16), gy - S(39)], [gx + S(16), gy - S(36)], [gx + S(10), gy - S(35)]], col);
    L.rect(gx + S(10), gy - S(42), gx + S(10), gy - S(40), col); L.rect(gx + S(13), gy - S(42), gx + S(13), gy - S(40), col);
    L.line(gx - S(9), gy - S(16), gx - S(11), gy - S(8), col);
  }
  const beasts = new Layer(W, H), trees = new Layer(W, H), rt = mulberry32(31);
  for (const d of [-1, 1]) for (const u of outward(d * 30, d, limit, 44, 90, rt)) {     // дальние акации и жирафы по краям
    const x = U(u), by = Y(randint(rt, 146, 154));
    if (rt() < .35) giraffe(beasts, x, by, .8 + rt() * .2, '#4a2a66');
    else acacia(beasts, x, by, randint(rt, 14, 26), randint(rt, 4, 7), randint(rt, 8, 14), '#3a1f55');
  }
  acacia(beasts, U(46), Y(150), 16, 5, 11, '#3a1f55');                                     // дальняя акация за правой
  giraffe(beasts, U(31), Y(153), .85, '#4a2a66');                                         // второй жираф, дальше
  giraffe(beasts, U(21), Y(151), 1, '#2a1648');                                           // главный жираф
  acacia(trees, U(-42), Y(172), 52, 15, 36, '#1a0e2e');                                   // большая акация слева
  acacia(trees, U(48), Y(168), 34, 10, 30, '#1a0e2e');                                    // меньшая справа
  for (const d of [-1, 1]) for (const u of outward(d * 66, d, limit, 56, 110, rt)) {
    const s = .5 + rt() * .6;
    acacia(trees, U(u), Y(randint(rt, 164, 178)), Math.round(randint(rt, 30, 54) * s), Math.round(randint(rt, 9, 14) * s), Math.round(randint(rt, 26, 40) * s), '#1a0e2e');
  }

  /* ---------- трава переднего плана ---------- */
  const blades = [], rg = mulberry32(19);
  for (let x = 0; x < W; x += 1 + (rg() < .5 ? 1 : 0)) blades.push({ x, h: randint(rg, 5, 15), ph: rg(), tip: rg() < .12 });
  const motes = makeMotes(r, Math.round(26 * W / 128), W, { y0: Y(128), y1: Y(190), colors: ['#ffd870', '#ffb860', '#ffe8a0'], rise: .15, amp: [2, 5], big: .15 });
  const ov = new Overlay(W, H), tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 40;
  const gb = Y(193);
  const farC = far.canvas(), midC = mid.canvas(), nearC = near.canvas(), beastsC = beasts.canvas(), treesC = trees.canvas();

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      drawCloudRows(ctx, rows, f, W);
      const fxp = Math.floor(((flockX + .33 * f) % (W + 90) + W + 90) % (W + 90)) - 45;
      flock.forEach(([dx, dy], i) => drawBird(ctx, fxp + dx, flockY + dy + Math.round(Math.sin(2 * Math.PI * f / 70 + i)), (((f >> 2) + i) & 1) === 1, '#2a1448'));
      shimmer(ctx, tmp, f, Y(122), Y(138), { amp: 1.2, dy: env.dy });
      ctx.drawImage(farC, 0, 0);
      ctx.drawImage(midC, 0, 0);
      ctx.drawImage(beastsC, 0, 0);
      fog(ov, f, { y0: Y(128), y1: Y(166), color: '#ff9a68', strength: .2, speed: .5, fade: 'mid', levels: 3 });
      ov.flush(ctx, 0, Y(128), W, Y(166));
      ctx.drawImage(nearC, 0, 0);
      ctx.drawImage(treesC, 0, 0);
      drawMotes(ctx, motes, f);
      for (const b of blades) {
        const off = Math.round(Math.sin(2 * Math.PI * (f / 70 + b.ph)) * Math.min(1.2, b.h / 9)), top = gb - b.h;
        ctx.fillStyle = '#150a2a'; ctx.fillRect(b.x, top + (b.h >> 1), 1, H - top);
        ctx.fillStyle = b.tip ? '#9a3a70' : '#4a2058'; ctx.fillRect(b.x + off, top, 1, (b.h >> 1) + 1);
      }
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, gradient, addGlow, sunDisc, makeRidge, hill, outward, edgeTop,
      cloudRow, drawCloudRows, makeMotes, drawMotes, fog, shimmer, drawBird } = px;
    const r = mulberry32(53), xc = W / 2, sunX = U(2), sunY = Ys(34);

    /* ---------- небо и высокое солнце ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#2f7ee0', '#4a95e8', '#6aaaee', '#8cc0f2', '#aed4f6', '#cce6f8', '#e6f2f0', '#f6f4d8'], 0, Y(140));
    addGlow(sky, sunX, sunY, 10, 70, '#fff4c0', .75, 5, 1.5);
    addGlow(sky, sunX, sunY, 10, 120, '#fffbe0', .3, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[11, '#ffe27a'], [9, '#ffee9a'], [7, '#fff8d0'], [5, '#ffffff']]);
    const skyC = sky.canvas();
    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 4, cols: cc, y: Ys(12), v: .22, gap: 128, off: 10 }),
      cloudRow({ sizes: [[42, 9], [32, 8]], seed: 11, cols: cc, y: Ys(58), v: .3, gap: 120, off: 66 }),
      cloudRow({ sizes: [[36, 8], [28, 7], [42, 8]], seed: 17, cols: cc, y: Ys(88), v: .4, gap: 136, off: 30 }),
    ];
    const flock = [[0, 0], [-6, -3], [-6, 3], [-12, -6], [-12, 6], [-18, -1]], flockX = r() * (W + 90), flockY = Ys(44);

    /* ---------- равнины ---------- */
    const far = new Layer(W, H), mid = new Layer(W, H), near = new Layer(W, H);
    hill(far, makeRidge(xc, Y(136), [[140, 2], [60, 1.2]], 5), { lit: '#d6c878', shade: '#b8b468', deep: '#a8ae6c', rim: '#fff0a8', lightX: sunX, k: .8, lean: .5, depth: 26 });
    hill(mid, makeRidge(xc, Y(150), [[110, 4], [55, 2]], 8), { lit: '#c8b858', shade: '#a2a64a', deep: '#869a44', rim: '#f4e080', lightX: sunX, k: .8, lean: .6, depth: 26 });
    hill(near, makeRidge(xc, Y(168), [[90, 5], [40, 2]], 12), { lit: '#aab040', shade: '#80963a', deep: '#5e8030', rim: '#d8d868', lightX: sunX, k: .8, lean: .6, depth: 18 });
    near.rect(0, Y(184), W, H, '#4a6c26');

    /* ---------- акации и жирафы ---------- */
    function acacia(L, cx, by, cw, ch, th, col, trunk) {
      const top = by - th, hw = cw / 2;
      L.rect(cx - 1, top, cx, by, trunk);
      L.line(cx, top + Math.round(th * .25), cx - Math.round(cw * .3), top - 1, trunk);
      L.line(cx - 1, top + Math.round(th * .12), cx + Math.round(cw * .34), top - 1, trunk);
      L.poly([[cx - hw, top + 1], [cx - hw * .85, top - ch * .55], [cx - hw * .45, top - ch * .95], [cx, top - ch], [cx + hw * .45, top - ch * .95],
        [cx + hw * .85, top - ch * .55], [cx + hw, top + 1]], col);
      for (let x = Math.round(cx - hw * .8); x <= cx + hw * .8; x += 3) L.px(x, top + 2, col);
    }
    function giraffe(L, gx, gy, s, col, spot) {
      const T = new Layer(W, H), S = v => Math.round(v * s);
      T.ellipseBox(gx - S(9), gy - S(18), gx + S(8), gy - S(8), col);
      for (const dx of [-7, -4, 4, 7]) T.rect(gx + S(dx), gy - S(9), gx + S(dx), gy, col);
      T.poly([[gx + S(5), gy - S(16)], [gx + S(9), gy - S(17)], [gx + S(12), gy - S(36)], [gx + S(9), gy - S(37)]], col);
      T.poly([[gx + S(8), gy - S(38)], [gx + S(16), gy - S(39)], [gx + S(16), gy - S(36)], [gx + S(10), gy - S(35)]], col);
      T.rect(gx + S(10), gy - S(42), gx + S(10), gy - S(40), col); T.rect(gx + S(13), gy - S(42), gx + S(13), gy - S(40), col);
      T.line(gx - S(9), gy - S(16), gx - S(11), gy - S(8), col);
      for (let y = gy - S(44); y <= gy; y++) for (let x = gx - S(13); x <= gx + S(18); x++) if (T.has(x, y)) {
        const sp = ((x * 7 + y * 13) % 11 === 0) || ((x + y * 3) % 9 === 0 && (x >> 1) % 2 === 0);
        L.px(x, y, sp ? spot : col);
      }
    }
    const beasts = new Layer(W, H), trees = new Layer(W, H), rt = mulberry32(31);
    const GOL = '#d49a3c', GSP = '#8a5a26', GOL2 = '#b88a46', GSP2 = '#7a5a30';
    const farTree = '#6a9a48', farTrunk = '#6a5a3a', nearTree = '#2e7a30', nearTrunk = '#6a4a2a';
    for (const d of [-1, 1]) for (const u of outward(d * 30, d, limit, 44, 90, rt)) {
      const x = U(u), by = Y(randint(rt, 146, 154));
      if (rt() < .35) giraffe(beasts, x, by, .8 + rt() * .2, GOL2, GSP2);
      else acacia(beasts, x, by, randint(rt, 14, 26), randint(rt, 4, 7), randint(rt, 8, 14), farTree, farTrunk);
    }
    acacia(beasts, U(46), Y(150), 16, 5, 11, farTree, farTrunk);
    giraffe(beasts, U(31), Y(153), .85, GOL2, GSP2);
    giraffe(beasts, U(21), Y(151), 1, GOL, GSP);
    acacia(trees, U(-42), Y(172), 52, 15, 36, nearTree, nearTrunk);
    acacia(trees, U(48), Y(168), 34, 10, 30, nearTree, nearTrunk);
    for (const d of [-1, 1]) for (const u of outward(d * 66, d, limit, 56, 110, rt)) {
      const s = .5 + rt() * .6;
      acacia(trees, U(u), Y(randint(rt, 164, 178)), Math.round(randint(rt, 30, 54) * s), Math.round(randint(rt, 9, 14) * s), Math.round(randint(rt, 26, 40) * s), nearTree, nearTrunk);
    }
    // солнечная кромка на кронах
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (trees.has(x, y) && !trees.has(x, y - 1) && trees.d[((y * W + x) << 2)] < 100) trees.px(x, y, '#7ac04a');

    /* ---------- трава, пыльца ---------- */
    const blades = [], rg = mulberry32(19);
    for (let x = 0; x < W; x += 1 + (rg() < .5 ? 1 : 0)) blades.push({ x, h: randint(rg, 5, 15), ph: rg(), tip: rg() < .12 });
    const motes = makeMotes(r, Math.round(22 * W / 128), W, { y0: Y(120), y1: Y(190), colors: ['#fff6b8', '#ffffff', '#f4e890'], rise: .12, amp: [2, 5], big: .1 });
    const ov = new Overlay(W, H), tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 40;
    const gb = Y(193);
    const farC = far.canvas(), midC = mid.canvas(), nearC = near.canvas(), beastsC = beasts.canvas(), treesC = trees.canvas();

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        const fxp = Math.floor(((flockX + .33 * f) % (W + 90) + W + 90) % (W + 90)) - 45;
        flock.forEach(([dx, dy], i) => drawBird(ctx, fxp + dx, flockY + dy + Math.round(Math.sin(2 * Math.PI * f / 70 + i)), (((f >> 2) + i) & 1) === 1, '#26385a'));
        ctx.drawImage(farC, 0, 0);
        shimmer(ctx, tmp, f, Y(132), Y(146), { amp: 1, dy: env.dy });
        ctx.drawImage(midC, 0, 0);
        ctx.drawImage(beastsC, 0, 0);
        fog(ov, f, { y0: Y(128), y1: Y(166), color: '#fff2b0', strength: .16, speed: .5, fade: 'mid', levels: 3 });
        ov.flush(ctx, 0, Y(128), W, Y(166));
        ctx.drawImage(nearC, 0, 0);
        ctx.drawImage(treesC, 0, 0);
        drawMotes(ctx, motes, f);
        for (const b of blades) {
          const off = Math.round(Math.sin(2 * Math.PI * (f / 70 + b.ph)) * Math.min(1.2, b.h / 9)), top = gb - b.h;
          ctx.fillStyle = '#3e5c1c'; ctx.fillRect(b.x, top + (b.h >> 1), 1, H - top);
          ctx.fillStyle = b.tip ? '#f0e08a' : '#9aa83c'; ctx.fillRect(b.x + off, top, 1, (b.h >> 1) + 1);
        }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('savanna', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: taiga ===== */
/* Тайга: полярное сияние, лунный месяц, заснеженный лес, хижина с тёплым окном и дымом, сугробы, снегопад.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, gradient, addGlow, makeRidge, peakRidge, hill, outward,
    moonSprite, makeStars, drawStars, makeMotes, drawMotes, glowPulse, aurora, smokeColumn } = px;
  const r = mulberry32(47), xc = W / 2;
  const moonX = U(-42), moonY = Ys(28);

  /* ---------- небо, луна, звёзды ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#060a22', '#0a1234', '#0e1a48', '#12225a', '#16296a', '#1b3074', '#203878'], 0, Y(116));
  addGlow(sky, moonX, moonY, 6, 34, '#7a8ee0', .34, 4, 1.6);
  const skyC = sky.canvas();
  const moon = moonSprite(9, ['#c8d8f8', '#eef4ff', '#ffffff'], true);
  const stars = makeStars(r, Math.round(80 * W / 128), W, Y(112), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 14 });
  // kx — изгибов на 128 px, ke — «занавесей» на 128 px (дробные, чтобы на широком экране узор не повторялся)
  const ribbons = [
    { yc: Ys(50), amp: Ys(9), kx: .7, ke: .5, sk: .6, wid: Ys(24), strength: .85, color: '#38ecc0', ph: .4 },
    { yc: Ys(28), amp: Ys(10), kx: 1.1, ke: .7, sk: -.5, wid: Ys(20), strength: .62, color: '#a074ff', ph: 2.1 },
    { yc: Ys(60), amp: Ys(7), kx: .45, ke: .4, sk: .4, wid: Ys(18), strength: .5, color: '#40c8e8', ph: 4.0 },
  ];
  const ovA = new Overlay(W, H), aurH = Ys(88), TP = 2 * Math.PI;
  const LUT = new Float32Array(257);                      // профиль занавеси: u от -.8 до 3
  for (let i = 0; i <= 256; i++) { const u = -.8 + 3.8 * i / 256; LUT[i] = u >= 0 ? Math.exp(-u * 1.3) : Math.exp(-(u * 3.5) * (u * 3.5)); }
  const ribCols = ribbons.map(rb => C(rb.color));
  function auroraDraw(f) {
    ribbons.forEach((rb, k) => {
      const col = ribCols[k];
      for (let x = 0; x < W; x++) {
        const xr = (x - xc) / 128, th = TP * (rb.kx * xr + rb.sk * f / 120) + rb.ph;
        const cy = rb.yc + rb.amp * Math.sin(th) + .45 * rb.amp * Math.sin(2 * th + 1.3);
        const en = .4 + .6 * (.5 + .5 * Math.sin(TP * (rb.ke * xr + rb.sk * f / 120) + rb.ph * 1.7));
        const rays = .8 + .2 * Math.sin(TP * (20 * xr + rb.sk * f / 120)), k0 = rb.strength * en * rays;
        for (let y = Math.max(0, Math.floor(cy - 3 * rb.wid)); y < Math.min(aurH, Math.ceil(cy + .8 * rb.wid)); y++) {
          const u = (cy - y) / rb.wid;
          const a = k0 * LUT[((u + .8) * 256 / 3.8) | 0];
          if (a < .03) continue;
          const q = Math.floor(a * 4 + px.bay(x, y)) / 4;
          if (q > 0) ovA.over(x, y, col, q > 1 ? 1 : q);
        }
      }
    });
  }

  /* ---------- дальние горы и лес ---------- */
  const mount = new Layer(W, H), rm = mulberry32(9);
  const peaks = [[-6, 9, 22], [16, 6, 16]];
  for (const d of [-1, 1]) for (const u of outward(d * 30, d, limit, 34, 70, rm)) peaks.push([u, randint(rm, 6, 14), randint(rm, 14, 26)]);
  hill(mount, peakRidge(xc, Y(121), peaks, 3, 1.2), { lit: '#4a68a8', shade: '#243e7c', deep: '#1a2e68', rim: '#8aa8e0', lightX: -1e9, k: 1, lean: 0, depth: 14 });
  function fir(L, x, base, h, w, body, snow, lit, nt) {
    const tiers = nt || Math.max(3, Math.round(h / 5)), step = h / tiers;
    for (let i = tiers - 1; i >= 0; i--) {
      const yt = base - h + i * step, yb = yt + step * 1.7, wi = w * (i + 1) / tiers;
      L.poly([[x - wi / 2, yb], [x + wi / 2, yb], [x, yt]], body);
      if (snow) { const sy = yt + step * .75, sw = wi * ((sy - yt) / (yb - yt)); L.poly([[x - sw / 2, sy], [x + sw / 2, sy], [x, yt]], snow); }
      if (lit) L.line(x, yt, x - wi / 2, yb, lit);
    }
    L.rect(x - 1, base - 2, x, base, body);
  }
  const forest = new Layer(W, H), rf = mulberry32(14);
  [[126, '#3c5a9c', '#a8c0f0'], [131, '#4466a6', '#b4ccf4'], [136, '#4c70b0', '#c4d8fa'], [141, '#5478b8', '#d0e0ff'], [146, '#5c80c0', '#dce8ff']].forEach(([b, body, snow], k) => {
    for (let x = -6 - (k * 3) % 8; x < W + 10; x += randint(rf, 7, 10)) fir(forest, x, Y(b), randint(rf, 12, 17), randint(rf, 9, 11), body, snow, null);
  });
  const ground = new Layer(W, H);                                   // тёмная полоса земли под лесом
  gradient(ground, ['#12244a', '#0e1c3c', '#0a1634'], Y(147), Y(172));
  for (let y = 0; y < Y(147); y++) for (let x = 0; x < W; x++) ground.erase(x, y);

  /* ---------- хижина ---------- */
  const cx = U(31), cb = Y(153), wx = cx - 5, wy = cb - 9;
  const cab = new Layer(W, H);
  cab.rect(cx - 9, cb - 11, cx + 9, cb, '#6a4630');
  for (let y = cb - 9; y <= cb; y += 3) cab.hline(cx - 9, cx + 9, y, '#54362a');
  cab.vline(cx - 9, cb - 11, cb, '#8a6244'); cab.vline(cx + 9, cb - 11, cb, '#46301f');
  cab.rect(cx + 3, cb - 8, cx + 6, cb, '#3a2418');                            // дверь
  cab.rect(cx + 5, cb - 24, cx + 8, cb - 14, '#4a3228'); cab.rect(cx + 4, cb - 25, cx + 9, cb - 24, '#dce8ff');   // труба со снежной шапкой
  cab.poly([[cx - 12, cb - 10], [cx + 12, cb - 10], [cx, cb - 24]], '#dce8ff');
  cab.hline(cx - 12, cx + 12, cb - 10, '#a8c0f0'); cab.hline(cx - 10, cx + 10, cb - 9, '#7a94d0');
  cab.rect(wx, wy, wx + 3, wy + 5, '#2a1a10'); cab.rect(wx + 1, wy + 1, wx + 2, wy + 4, '#ffc060'); cab.vline(wx + 1, wy + 1, wy + 4, '#ffe090');
  addGlow(cab, wx + 1, wy + 2, 3, 15, '#ff9a40', .5, 4, 1.4);
  const smokeX = cx + 6, smokeY = cb - 26;

  /* ---------- сугробы и ёлки переднего плана ---------- */
  const snow = new Layer(W, H);
  hill(snow, makeRidge(xc, Y(172), [[120, 5], [50, 2.5]], 21), { lit: '#d8e4ff', shade: '#7a94d0', deep: '#4a5ea0', rim: '#ffffff', lightX: -1e9, k: 1.1, lean: .5, depth: 20 });
  hill(snow, makeRidge(xc, Y(182), [[70, 3], [36, 1.5]], 31), { lit: '#c0d0f4', shade: '#6a82c4', deep: '#3e5294', rim: '#e8f0ff', lightX: -1e9, k: 1.1, lean: .5, depth: 14 });
  const front = new Layer(W, H), rt = mulberry32(61);
  const dark = '#0a1432', rimF = '#3a5aa0';
  fir(front, U(-52), Y(200), 88, 36, dark, null, rimF, 9);
  fir(front, U(58), Y(198), 56, 28, dark, null, rimF, 7);
  for (const d of [-1, 1]) for (const u of outward(d * 66, d, limit, 44, 90, rt)) {
    const h = randint(rt, 40, 96); fir(front, U(u), Y(randint(rt, 190, 204)), h, Math.round(h * .4), dark, null, rimF, Math.max(5, Math.round(h / 10)));
  }
  const mountC = mount.canvas(), forestC = forest.canvas(), groundC = ground.canvas(), cabC = cab.canvas(), snowC = snow.canvas(), frontC = front.canvas();

  /* ---------- снег, блики, свечение окна ---------- */
  const flakes = [], rs = mulberry32(5), nF = Math.round(70 * W / 128);
  for (let i = 0; i < nF; i++) flakes.push({ x: rs() * W, y: rs() * H, vy: [.6, .9, 1.2][Math.floor(rs() * 3)], vx: .3, ph: rs() * 6, big: rs() < .15, c: rs() < .4 ? '#ffffff' : '#c8d8ff' });
  const glints = makeMotes(r, Math.round(12 * W / 128), W, { y0: Y(160), y1: Y(190), colors: ['#ffffff', '#c8e0ff'], rise: 0, amp: [0, 1], big: .3 });
  const ovW = new Overlay(W, H);

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      auroraDraw(f);
      ovA.flush(ctx, 0, 0, W, aurH);
      ctx.drawImage(mountC, 0, 0);
      ctx.drawImage(forestC, 0, 0);
      ctx.drawImage(groundC, 0, 0);
      ctx.drawImage(cabC, 0, 0);
      glowPulse(ovW, wx + 1, wy + 2, 14, '#ff9a40', f, { per: 40, strength: .45, lo: .65 });
      ovW.flush(ctx, Math.max(0, wx - 15), wy - 12, Math.min(W, wx + 17), Math.min(H, wy + 16));
      smokeColumn(ctx, smokeX, smokeY, f, { n: 5, rise: 34, per: 120, sway: 2, r0: 1, r1: 3.5, wind: 4, cols: ['#8a9cc8', '#6a7cb0', '#4a5c98'] });
      ctx.drawImage(snowC, 0, 0);
      drawMotes(ctx, glints, f);
      ctx.drawImage(frontC, 0, 0);
      for (const s of flakes) {
        const x = Math.floor(((s.x + s.vx * f + 1.5 * Math.sin(f / 18 + s.ph)) % W + W) % W), y = Math.floor(((s.y + s.vy * f) % H + H) % H);
        ctx.fillStyle = s.c; ctx.fillRect(x, y, 1, 1);
        if (s.big) { ctx.fillStyle = '#a8bce8'; ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
      }
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, gradient, addGlow, sunDisc, makeRidge, peakRidge, hill, outward,
      makeMotes, drawMotes, glowPulse, smokeColumn, fog, cloudRow, drawCloudRows, drawBird } = px;
    const r = mulberry32(47), xc = W / 2;
    const sunX = U(-30), sunY = Ys(54);

    /* ---------- небо и низкое белое солнце ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#3f84dc', '#5a9ae6', '#7cb4ee', '#9ccaf4', '#bcdcf8', '#d6ecfc', '#eaf6ff'], 0, Y(116));
    addGlow(sky, sunX, sunY, 6, 52, '#fff2c8', .75, 5, 1.5);
    addGlow(sky, sunX, sunY, 6, 90, '#fff8e0', .35, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[7, '#ffe9a0'], [6, '#fff4c8'], [4, '#ffffff']]);
    const skyC = sky.canvas();
    const rows = [
      cloudRow({ sizes: [[44, 10], [34, 9], [50, 11]], seed: 3, cols: ['#f6f9fe', '#b4c8e6', '#ffffff'], y: Ys(18), v: .16, gap: 120, off: 14 }),
      cloudRow({ sizes: [[36, 9], [46, 10]], seed: 12, cols: ['#f6f9fe', '#b4c8e6', '#ffffff'], y: Ys(78), v: .24, gap: 110, off: 70 }),
    ];
    const crows = [[.36, Ys(40), 0], [.26, Ys(62), 3]].map(([v, y, i]) => ({ v, y, x0: r() * (W + 60), i }));

    /* ---------- дальние горы и заснеженный лес ---------- */
    const mount = new Layer(W, H), rm = mulberry32(9);
    const peaks = [[-6, 9, 22], [16, 6, 16]];
    for (const d of [-1, 1]) for (const u of outward(d * 30, d, limit, 34, 70, rm)) peaks.push([u, randint(rm, 6, 14), randint(rm, 14, 26)]);
    hill(mount, peakRidge(xc, Y(121), peaks, 3, 1.2), { lit: '#e6f0fc', shade: '#9ab6e0', deep: '#86a4d6', rim: '#ffffff', lightX: -1e9, k: 1, lean: 0, depth: 14 });
    function fir(L, x, base, h, w, body, snow, lit, nt) {
      const tiers = nt || Math.max(3, Math.round(h / 5)), step = h / tiers;
      for (let i = tiers - 1; i >= 0; i--) {
        const yt = base - h + i * step, yb = yt + step * 1.7, wi = w * (i + 1) / tiers;
        L.poly([[x - wi / 2, yb], [x + wi / 2, yb], [x, yt]], body);
        if (snow) { const sy = yt + step * .75, sw = wi * ((sy - yt) / (yb - yt)); L.poly([[x - sw / 2, sy], [x + sw / 2, sy], [x, yt]], snow); }
        if (lit) L.line(x, yt, x - wi / 2, yb, lit);
      }
      L.rect(x - 1, base - 2, x, base, body);
    }
    const forest = new Layer(W, H), rf = mulberry32(14);
    [[126, '#86b0c4', '#f4f9ff'], [131, '#6a9ca8', '#f4f9ff'], [136, '#4c8890', '#f0f6ff'], [141, '#3a7680', '#eef5ff'], [146, '#2c6470', '#e8f1fd']].forEach(([b, body, snow], k) => {
      for (let x = -6 - (k * 3) % 8; x < W + 10; x += randint(rf, 7, 10)) fir(forest, x, Y(b), randint(rf, 12, 17), randint(rf, 9, 11), body, snow, null);
    });
    const ground = new Layer(W, H);                                   // тень снега под лесом
    gradient(ground, ['#a6bfe2', '#b4caea', '#c4d6f0'], Y(147), Y(172));
    for (let y = 0; y < Y(147); y++) for (let x = 0; x < W; x++) ground.erase(x, y);

    /* ---------- хижина ---------- */
    const cx = U(31), cb = Y(153), wx = cx - 5, wy = cb - 9;
    const cab = new Layer(W, H);
    cab.rect(cx - 9, cb - 11, cx + 9, cb, '#9a6a44');
    for (let y = cb - 9; y <= cb; y += 3) cab.hline(cx - 9, cx + 9, y, '#7a4e32');
    cab.vline(cx - 9, cb - 11, cb, '#c08a5a'); cab.vline(cx + 9, cb - 11, cb, '#62402a');
    cab.rect(cx + 3, cb - 8, cx + 6, cb, '#52341f');
    cab.rect(cx + 5, cb - 24, cx + 8, cb - 14, '#7a5238'); cab.rect(cx + 4, cb - 25, cx + 9, cb - 24, '#ffffff');
    cab.poly([[cx - 12, cb - 10], [cx + 12, cb - 10], [cx, cb - 24]], '#ffffff');
    cab.hline(cx - 12, cx + 12, cb - 10, '#c4d6f4'); cab.hline(cx - 10, cx + 10, cb - 9, '#9ab4e0');
    cab.rect(wx, wy, wx + 3, wy + 5, '#3a2416'); cab.rect(wx + 1, wy + 1, wx + 2, wy + 4, '#e8b868'); cab.vline(wx + 1, wy + 1, wy + 4, '#f8d890');
    const smokeX = cx + 6, smokeY = cb - 26;

    /* ---------- сугробы, ёлки переднего плана ---------- */
    const snow = new Layer(W, H);
    hill(snow, makeRidge(xc, Y(172), [[120, 5], [50, 2.5]], 21), { lit: '#ffffff', shade: '#b0c8f0', deep: '#8aa6d8', rim: '#ffffff', lightX: -1e9, k: 1.1, lean: .5, depth: 20 });
    hill(snow, makeRidge(xc, Y(182), [[70, 3], [36, 1.5]], 31), { lit: '#f2f8ff', shade: '#a4bfec', deep: '#7c98d0', rim: '#ffffff', lightX: -1e9, k: 1.1, lean: .5, depth: 14 });
    const front = new Layer(W, H), rt = mulberry32(61);
    const dark = '#22504e', snowF = '#f2f8ff', litF = '#5a9a8a';
    fir(front, U(-52), Y(200), 88, 36, dark, snowF, litF, 9);
    fir(front, U(58), Y(198), 56, 28, dark, snowF, litF, 7);
    for (const d of [-1, 1]) for (const u of outward(d * 66, d, limit, 44, 90, rt)) {
      const h = randint(rt, 40, 96); fir(front, U(u), Y(randint(rt, 190, 204)), h, Math.round(h * .4), dark, snowF, litF, Math.max(5, Math.round(h / 10)));
    }
    const mountC = mount.canvas(), forestC = forest.canvas(), groundC = ground.canvas(), cabC = cab.canvas(), snowC = snow.canvas(), frontC = front.canvas();

    /* ---------- снег, блики, окно ---------- */
    const flakes = [], rs = mulberry32(5), nF = Math.round(44 * W / 128);
    for (let i = 0; i < nF; i++) flakes.push({ x: rs() * W, y: rs() * H, vy: [.4, .6, .8][Math.floor(rs() * 3)], vx: .2, ph: rs() * 6, big: rs() < .12, c: rs() < .5 ? '#ffffff' : '#e4eeff' });
    const glints = makeMotes(r, Math.round(26 * W / 128), W, { y0: Y(150), y1: Y(194), colors: ['#ffffff', '#ffffff', '#cfeaff', '#fff4c0'], rise: 0, amp: [0, 1], big: .45 });
    const ovW = new Overlay(W, H);

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        for (const b of crows) { const x = Math.floor(((b.x0 + b.v * f) % (W + 60) + W + 60) % (W + 60)) - 30; drawBird(ctx, x, b.y + Math.round(1.5 * Math.sin(f / 22 + b.i)), (((f >> 2) + b.i) & 1) === 1, '#2a3858'); }
        ctx.drawImage(mountC, 0, 0);
        ctx.drawImage(forestC, 0, 0);
        ctx.drawImage(groundC, 0, 0);
        ctx.drawImage(cabC, 0, 0);
        glowPulse(ovW, wx + 1, wy + 2, 6, '#ffc060', f, { per: 60, strength: .35, lo: .6 });
        ovW.flush(ctx, Math.max(0, wx - 7), wy - 5, Math.min(W, wx + 9), Math.min(H, wy + 10));
        smokeColumn(ctx, smokeX, smokeY, f, { n: 5, rise: 34, per: 120, sway: 2, r0: 1, r1: 3.5, wind: 4, cols: ['#f4f6fa', '#d0d8e6', '#aab6cc'] });
        fog(ovW, f, { y0: Y(148), y1: Y(176), color: '#ffffff', strength: .34, speed: .4, fade: 'down', levels: 3 });
        ovW.flush(ctx, 0, Y(148), W, Y(176));
        ctx.drawImage(snowC, 0, 0);
        drawMotes(ctx, glints, f);
        ctx.drawImage(frontC, 0, 0);
        for (const s of flakes) {
          const x = Math.floor(((s.x + s.vx * f + 1.5 * Math.sin(f / 18 + s.ph)) % W + W) % W), y = Math.floor(((s.y + s.vy * f) % H + H) % H);
          ctx.fillStyle = s.c; ctx.fillRect(x, y, 1, 1);
          if (s.big) { ctx.fillStyle = '#c4d6f4'; ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
        }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('taiga', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: jungle ===== */
/* Джунгли: полная луна, руины с бирюзовым огнём, водопад с брызгами, лианы, светлячки, светящиеся цветы.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, gradient, addGlow, moonSprite, makeStars, drawStars, makeMotes, drawMotes,
    fog, glowPulse, fillDisc, outward, bay, clamp } = px;
  const r = mulberry32(61), xc = W / 2, TP = 2 * Math.PI;
  const moonX = U(28), moonY = Ys(26), fx = Math.round(U(16)), fy0 = Y(106), fy1 = Y(149);
  const sc = clamp(W / 128, .62, 1);                         // масштаб листьев переднего плана на узких экранах

  /* ---------- небо, луна, звёзды ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#040c18', '#071626', '#0a2236', '#0d2e40', '#10384a', '#124252'], 0, Y(138));
  addGlow(sky, moonX, moonY, 9, 62, '#40d8b8', .5, 5, 1.5);
  addGlow(sky, moonX, moonY, 9, 30, '#80ffe0', .35, 4, 1.8);
  const skyC = sky.canvas();
  const moon = moonSprite(9, ['#8fe8d0', '#d4fff0', '#f2fffa', '#9ae6d2'], false);
  const stars = makeStars(r, Math.round(46 * W / 128), W, Y(104), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 14 });
  const STAR_PAL = [null, '#3a5a80', '#8aa8d8', '#e8f4ff'];

  /* ---------- руины с огнём на вершине ---------- */
  const tx = Math.round(U(-28)), tower = new Layer(W, H);
  tower.rect(tx - 7, Y(90), tx + 7, Y(104), '#1c4c60'); tower.rect(tx - 5, Y(80), tx + 5, Y(90), '#1a4558');
  tower.rect(tx - 6, Y(79), tx + 6, Y(80), '#2a6478'); tower.rect(tx - 8, Y(89), tx + 8, Y(90), '#245a6c');
  tower.rect(tx - 1, Y(82), tx + 1, Y(87), '#071a26'); tower.vline(tx - 7, Y(90), Y(104), '#2c6e84'); tower.vline(tx + 7, Y(90), Y(104), '#143646');
  for (let y = Y(92); y < Y(104); y += 4) tower.hline(tx - 6, tx + 6, y, '#15394a');
  tower.rect(tx - 2, Y(77), tx + 2, Y(79), '#2a6478'); tower.disc(tx, Y(74), 2, '#7af0ff'); tower.disc(tx, Y(74), 1, '#e8ffff');
  addGlow(tower, tx, Y(74), 3, 16, '#40e0ff', .6, 4, 1.4);
  const towerC = tower.canvas();

  /* ---------- кроны трёх планов ---------- */
  function canopy(base, hmin, hmax, col, rim, deep, seed, dens) {
    const L = new Layer(W, H), rng = mulberry32(seed);
    for (let x = -8; x < W + 8; x += randint(rng, dens[0], dens[1])) {
      const w = randint(rng, 11, 18), h = randint(rng, hmin, hmax), top = base - h;
      L.ellipseBox(Math.round(x - w / 2), top, Math.round(x + w / 2), base + 6, col);
      if (rng() < .5) L.poly([[x - w * .3, top + h * .35], [x + (rng() - .5) * 3, top - 4], [x + w * .3, top + h * .35]], col);
    }
    L.rect(0, base + 3, W, H, col);
    for (let y = base - hmax - 6; y < H; y++) for (let x = 0; x < W; x++) {
      if (!L.has(x, y)) continue;
      const d = y - (base - hmax);                               // темнее к низу слоя
      if (clamp((y - base - 2) / 26, 0, 1) > bay(x, y)) L.px(x, y, deep);
      else if (!L.has(x, y - 1)) L.px(x, y, rim);
      else if (!L.has(x, y - 2) && bay(x, y) < .45) L.px(x, y, rim);
    }
    return L.canvas();
  }
  const farC = canopy(Y(112), 10, 20, '#12404f', '#2a8a96', '#0c3040', 5, [5, 8]);
  const midC = canopy(Y(128), 10, 22, '#0d3140', '#1c6c7a', '#082432', 12, [5, 9]);
  const nearC = canopy(Y(146), 8, 18, '#08222e', '#124c58', '#051822', 23, [6, 10]);

  /* ---------- утёс и водопад ---------- */
  const cliff = new Layer(W, H);
  cliff.rect(fx - 14, fy0 - 5, fx + 14, fy1 + 4, '#0b2a38');
  for (let y = fy0 - 5; y <= fy1 + 4; y++) {                       // неровный левый край и тень справа
    const bulge = Math.round(2 * Math.sin((y - fy0) / 9));
    for (let x = fx - 14; x <= fx - 11 + bulge; x++) cliff.erase(x, y);
    cliff.px(fx - 11 + bulge + 1, y, '#2a7e8c'); cliff.px(fx - 11 + bulge + 2, y, bay(0, y) > .5 ? '#1a5868' : '#0f3a4a');
    for (let x = fx + 7; x <= fx + 14; x++) if ((x + y) % 3 !== 0) cliff.px(x, y, '#071c28');
  }
  for (let y = fy0 + 4; y < fy1; y += 6) for (let x = fx - 10; x < fx + 14; x += 2) if (cliff.has(x, y)) cliff.px(x, y + (x & 2 ? 1 : 0), '#09222e');
  cliff.rect(fx - 12, fy0 - 5, fx + 11, fy0 - 3, '#16485a'); cliff.hline(fx - 12, fx + 11, fy0 - 5, '#3a9aa8');   // плита сверху
  cliff.rect(fx - 4, fy0 - 3, fx + 3, fy0, '#0a2230');
  for (let x = fx - 15; x < fx + 16; x += 3) { cliff.px(x, fy1 + 5, '#0a2c36'); cliff.px(x + 1, fy1 + 4, '#0c3440'); }
  const cliffC = cliff.canvas();
  const FALL = ['#e8ffff', '#8af0ff', '#40c8e8', '#2090b8'];
  const spl = Array.from({ length: 10 }, (_, i) => ({ dir: i & 1 ? 1 : -1, ph: r(), per: 14 + (i % 3) * 3, sp: 5 + r() * 5, hgt: 4 + r() * 4 }));

  /* ---------- земля ---------- */
  const ground = new Layer(W, H), gtop = x => Y(152) + 2 * Math.sin(x / 7) + 1.5 * Math.sin(x / 3.1 + 1);
  const rg = mulberry32(3);
  for (let x = 0; x < W; x++) {
    const t = Math.round(gtop(x));
    for (let y = t; y < H; y++) {
      const u = clamp((y - t) / (H - t), 0, 1), b = bay(x, y);
      ground.px(x, y, u * 1.6 > b + .35 ? '#03101a' : u > b * .6 ? '#06202c' : '#0a2e3a');
    }
    if (rg() < .3) ground.px(x, t, '#1c6a74');
  }
  const groundC = ground.canvas();

  /* ---------- листья переднего плана ---------- */
  function leaf(L, bx, by, len, ang, wid, body, vein) {
    const ca = Math.cos(ang), sa = Math.sin(ang), N = 12, pts = [], back = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, ww = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), .75) * (1 - .2 * t);
      pts.push([bx + ca * len * t - sa * ww, by + sa * len * t + ca * ww]);
      back.unshift([bx + ca * len * t + sa * ww, by + sa * len * t - ca * ww]);
    }
    L.poly(pts.concat(back), body);
    L.line(Math.round(bx), Math.round(by), Math.round(bx + ca * len * .95), Math.round(by + sa * len * .95), vein);
    for (let t = .22; t < .85; t += .16) {
      const cx = bx + ca * len * t, cy = by + sa * len * t, ww = wid * Math.sin(Math.PI * t) * .75;
      for (const sg of [-1, 1]) L.line(Math.round(cx), Math.round(cy), Math.round(cx + ca * ww * .5 - sg * sa * ww * .85), Math.round(cy + sa * ww * .5 + sg * ca * ww * .85), vein);
    }
  }
  const lv = new Layer(W, H), rl = mulberry32(88);
  const lcol = ['#0b4a3a', '#0e5440', '#093c30'], vcol = ['#2c9a76', '#34a880', '#237a62'];
  const L1 = n => Math.round(n * sc * 1.3);
  const bot = Y(192) + 0;
  // нижние углы
  leaf(lv, -2, bot - L1(6), L1(40), -.55, L1(11), lcol[0], vcol[0]);
  leaf(lv, -2, bot + 2, L1(36), -1.05, L1(10), lcol[1], vcol[1]);
  leaf(lv, L1(6), bot + 6, L1(34), -.2, L1(9), lcol[2], vcol[2]);
  leaf(lv, W + 2, bot - L1(4), L1(38), Math.PI + .5, L1(11), lcol[1], vcol[1]);
  leaf(lv, W + 2, bot + 4, L1(34), Math.PI + 1.0, L1(10), lcol[0], vcol[0]);
  leaf(lv, W - L1(6), bot + 6, L1(30), Math.PI + .15, L1(9), lcol[2], vcol[2]);
  // верхние углы
  leaf(lv, -3, Ys(-3), L1(34), .75, L1(11), lcol[0], vcol[0]);
  leaf(lv, -3, Ys(-2), L1(28), 1.25, L1(9), lcol[2], vcol[2]);
  leaf(lv, W + 3, Ys(-3), L1(34), Math.PI - .75, L1(11), lcol[1], vcol[1]);
  leaf(lv, W + 3, Ys(0), L1(26), Math.PI - 1.3, L1(9), lcol[0], vcol[0]);
  // на широких экранах: листья вдоль нижнего края
  for (const d of [-1, 1]) for (const u of outward(d * 54, d, limit, 34, 60, rl)) {
    const ang = -Math.PI / 2 + (rl() - .5) * 1.4;
    leaf(lv, U(u), bot + 6, L1(randint(rl, 26, 40)), ang, L1(randint(rl, 8, 11)), lcol[randint(rl, 0, 2)], vcol[randint(rl, 0, 2)]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)              // кромка света сверху
    if (lv.has(x, y) && !lv.has(x, y - 1) && bay(x, y) < .5) lv.px(x, y, '#1c7a5c');
  const lvC = lv.canvas();

  /* ---------- лианы, цветы, светлячки ---------- */
  const vines = [[-20, 52, 1.5, .1], [-4, 36, 1.2, .5], [41, 62, 1.8, .8], [56, 44, 1.4, .3]].map(([u, len, amp, ph]) => ({ x: Math.round(U(u)), len: Math.round(len * (H / 192 > 1 ? 1 : 1)), amp, ph }));
  for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 18, 40, rl)) vines.push({ x: Math.round(U(u)), len: randint(rl, 26, 64), amp: 1 + rl() * 1.2, ph: rl() });
  const flowers = [[-12, 184, '#ff5cb0', '#ffb0e0', 60, 0], [6, 188, '#30e0ff', '#c0ffff', 48, 20], [22, 177, '#30e0ff', '#c0ffff', 56, 40]];
  for (const d of [-1, 1]) for (const u of outward(d * 38, d, limit, 18, 34, rl)) flowers.push([u, randint(rl, 178, 190), rl() < .5 ? '#ff5cb0' : '#30e0ff', rl() < .5 ? '#ffb0e0' : '#c0ffff', randint(rl, 40, 70), randint(rl, 0, 60)]);
  const flw = new Layer(W, H);
  for (const [u, y, c1, c2] of flowers) {
    const x = Math.round(U(u)), yy = Y(y);
    flw.vline(x, yy + 2, yy + 14, '#0c4a3a'); flw.px(x - 1, yy + 6, '#0c4a3a'); flw.px(x + 1, yy + 8, '#0c4a3a');
    flw.disc(x, yy, 2, c1); flw.px(x, yy, c2); flw.px(x - 2, yy + 1, c1); flw.px(x + 2, yy + 1, c1);
  }
  const flwC = flw.canvas();
  const flies = makeMotes(r, Math.round(34 * W / 128), W, { y0: Y(96), y1: Y(186), colors: ['#d8ff60', '#a0ff90', '#60e8ff', '#ffd060'], rise: 0, amp: [2, 6], big: .3 });
  const drops = makeMotes(r, 10, W, { x0: fx - 10, x1: fx + 10, y0: Y(138), y1: Y(152), colors: ['#e8ffff', '#8af0ff'], rise: .35, amp: [1, 3], big: 0 });
  const ov = new Overlay(W, H), dust = new Overlay(W, H);
  const gpx0 = Math.max(0, tx - 18), gpx1 = Math.min(W, tx + 18);

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f, STAR_PAL);
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      // лианы качаются слегка
      for (const v of vines) {
        let ex = v.x;
        for (let k = 0; k < v.len; k++) {
          const sw = Math.round(v.amp * Math.pow(k / v.len, 1.6) * Math.sin(TP * (f / 90 + v.ph)));
          ctx.fillStyle = k & 1 ? '#1e6a46' : '#164e38'; ctx.fillRect(v.x + sw, Ys(-1) + k, 1, 1);
          if (k % 7 === 3) { ctx.fillStyle = '#2c8a5c'; ctx.fillRect(v.x + sw + 1, Ys(-1) + k, 1, 1); }
          ex = v.x + sw;
        }
        fillDisc(ctx, ex, Ys(-1) + v.len + 2, 2, '#134a30'); ctx.fillStyle = '#2c9a60'; ctx.fillRect(ex - 1, Ys(-1) + v.len + 1, 1, 1);
      }
      ctx.drawImage(towerC, 0, 0);
      glowPulse(ov, tx, Y(74), 13, '#40e0ff', f, { per: 50, strength: .8, lo: .45 });
      ov.flush(ctx, gpx0, Y(60), gpx1, Y(90));
      ctx.drawImage(farC, 0, 0);
      fog(ov, f, { y0: Y(108), y1: Y(130), color: '#3aa8a0', strength: .22, speed: .35, fade: 'mid', levels: 3 });
      ov.flush(ctx, 0, Y(108), W, Y(130));
      ctx.drawImage(midC, 0, 0);
      ctx.drawImage(nearC, 0, 0);
      ctx.drawImage(cliffC, 0, 0);
      // водопад: бегущие вниз штрихи
      const sh = Math.floor(f * 1.4);
      for (let x = fx - 4; x < fx + 4; x++) {
        const edge = x === fx - 4 || x === fx + 3;
        for (let y = fy0; y < fy1; y++) {
          const v = (((y + ((x * 5) % 7) - sh) % 7) + 7) % 7;
          ctx.fillStyle = FALL[edge ? (v < 3 ? 2 : 3) : v < 2 ? 0 : v < 4 ? 1 : v < 6 ? 2 : 1];
          ctx.fillRect(x, y, 1, 1);
        }
      }
      // брызги у подножия
      for (const s of spl) {
        const p = (((f / s.per + s.ph) % 1) + 1) % 1, x = Math.round(fx + s.dir * (2 + s.sp * p)), y = Math.round(fy1 - s.hgt * Math.sin(Math.PI * p) + 3 * p * p);
        ctx.fillStyle = p < .7 ? '#d8ffff' : '#6ad0e8'; ctx.fillRect(x, y, 1, 1);
      }
      drawMotes(ctx, drops, f);
      glowPulse(ov, fx, fy1 + 1, 13, '#50e8ff', f, { per: 70, strength: .5, lo: .55 });
      fog(ov, f, { y0: fy1 - 8, y1: fy1 + 8, x0: fx - 22, x1: fx + 22, color: '#8af0e8', strength: .34, speed: .25, fade: 'mid', levels: 3, lam: [30, 21] });
      ov.flush(ctx, Math.max(0, fx - 24), fy1 - 14, Math.min(W, fx + 24), fy1 + 14);
      ctx.drawImage(groundC, 0, 0);
      drawMotes(ctx, flies, f);
      ctx.drawImage(flwC, 0, 0);
      for (let i = 0; i < flowers.length; i++) {
        const fl = flowers[i], x = Math.round(U(fl[0])), y = Y(fl[1]);
        glowPulse(dust, x, y, 8, fl[2], f, { per: fl[4], ph: fl[5], strength: .75, lo: .45 });
      }
      dust.flush(ctx, 0, Y(160), W, H);
      ctx.drawImage(lvC, 0, 0);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { C, Layer, Overlay, mulberry32, randint, gradient, addGlow, sunDisc, cloudRow, drawCloudRows, makeMotes, drawMotes,
      fog, glowPulse, fillDisc, outward, bay, clamp } = px;
    const r = mulberry32(61), xc = W / 2, TP = 2 * Math.PI;
    const sunX = U(28), sunY = Ys(26), fx = Math.round(U(16)), fy0 = Y(106), fy1 = Y(149);
    const sc = clamp(W / 128, .62, 1);

    /* ---------- небо, солнце, облака ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#2a8ee0', '#48a8e8', '#6cc0ee', '#92d6f0', '#b8e6ec', '#d8f2e0'], 0, Y(138));
    addGlow(sky, sunX, sunY, 10, 60, '#fff4b8', .7, 5, 1.5);
    sunDisc(sky, sunX, sunY, [[9, '#ffe27a'], [7, '#fff2a8'], [5, '#ffffff']]);
    const skyC = sky.canvas();
    const rows = [cloudRow({ sizes: [[44, 10], [34, 9], [50, 11]], seed: 7, cols: ['#f6f9fe', '#b4c8e6', '#ffffff'], y: Ys(58), v: .2, gap: 120, off: 30 })];

    /* ---------- руины на солнце ---------- */
    const tx = Math.round(U(-28)), tower = new Layer(W, H);
    tower.rect(tx - 7, Y(90), tx + 7, Y(104), '#84a496'); tower.rect(tx - 5, Y(80), tx + 5, Y(90), '#7a9a8a');
    tower.rect(tx - 6, Y(79), tx + 6, Y(80), '#b0ccb8'); tower.rect(tx - 8, Y(89), tx + 8, Y(90), '#a0bcaa');
    tower.rect(tx - 1, Y(82), tx + 1, Y(87), '#22403a'); tower.vline(tx - 7, Y(90), Y(104), '#c4dcc0'); tower.vline(tx + 7, Y(90), Y(104), '#506e60');
    for (let y = Y(92); y < Y(104); y += 4) tower.hline(tx - 6, tx + 6, y, '#6a8a7a');
    tower.rect(tx - 2, Y(77), tx + 2, Y(79), '#a0bcaa');
    for (const [dx, dy] of [[-4, 78], [-3, 77], [0, 76], [2, 77], [3, 78], [-6, 80], [5, 80], [-7, 90], [6, 89]]) tower.px(tx + dx, Y(dy), '#3aa040');
    tower.rect(tx - 1, Y(75), tx + 1, Y(76), '#2c8a38'); tower.px(tx, Y(74), '#5ac850');
    const towerC = tower.canvas();

    /* ---------- кроны ---------- */
    function canopy(base, hmin, hmax, col, rim, deep, seed, dens) {
      const L = new Layer(W, H), rng = mulberry32(seed);
      for (let x = -8; x < W + 8; x += randint(rng, dens[0], dens[1])) {
        const w = randint(rng, 11, 18), h = randint(rng, hmin, hmax), top = base - h;
        L.ellipseBox(Math.round(x - w / 2), top, Math.round(x + w / 2), base + 6, col);
        if (rng() < .5) L.poly([[x - w * .3, top + h * .35], [x + (rng() - .5) * 3, top - 4], [x + w * .3, top + h * .35]], col);
      }
      L.rect(0, base + 3, W, H, col);
      for (let y = base - hmax - 6; y < H; y++) for (let x = 0; x < W; x++) {
        if (!L.has(x, y)) continue;
        if (clamp((y - base - 2) / 26, 0, 1) > bay(x, y)) L.px(x, y, deep);
        else if (!L.has(x, y - 1)) L.px(x, y, rim);
        else if (!L.has(x, y - 2) && bay(x, y) < .45) L.px(x, y, rim);
      }
      return L.canvas();
    }
    const farC = canopy(Y(112), 10, 20, '#52b872', '#a6ec88', '#3a9a62', 5, [5, 8]);
    const midC = canopy(Y(128), 10, 22, '#2c9a54', '#74da62', '#1e7a46', 12, [5, 9]);
    const nearC = canopy(Y(146), 8, 18, '#1c7440', '#52bc50', '#145a34', 23, [6, 10]);

    /* ---------- утёс и водопад ---------- */
    const cliff = new Layer(W, H);
    cliff.rect(fx - 14, fy0 - 5, fx + 14, fy1 + 4, '#5a7e6c');
    for (let y = fy0 - 5; y <= fy1 + 4; y++) {
      const bulge = Math.round(2 * Math.sin((y - fy0) / 9));
      for (let x = fx - 14; x <= fx - 11 + bulge; x++) cliff.erase(x, y);
      cliff.px(fx - 11 + bulge + 1, y, '#c4e0c0'); cliff.px(fx - 11 + bulge + 2, y, bay(0, y) > .5 ? '#94b8a0' : '#7ca08c');
      for (let x = fx + 7; x <= fx + 14; x++) if ((x + y) % 3 !== 0) cliff.px(x, y, '#38584a');
    }
    for (let y = fy0 + 4; y < fy1; y += 6) for (let x = fx - 10; x < fx + 14; x += 2) if (cliff.has(x, y)) cliff.px(x, y + (x & 2 ? 1 : 0), '#46685a');
    cliff.rect(fx - 12, fy0 - 5, fx + 11, fy0 - 3, '#7ea490'); cliff.hline(fx - 12, fx + 11, fy0 - 5, '#d4ecd0');
    for (let x = fx - 12; x < fx + 12; x += 3) cliff.px(x, fy0 - 6, '#3aa040');
    cliff.rect(fx - 4, fy0 - 3, fx + 3, fy0, '#4a6e5e');
    for (let x = fx - 15; x < fx + 16; x += 3) { cliff.px(x, fy1 + 5, '#2c7a44'); cliff.px(x + 1, fy1 + 4, '#38904e'); }
    const cliffC = cliff.canvas();
    const FALL = ['#ffffff', '#c8f4ff', '#7ad8f0', '#46b4e0'];
    const spl = Array.from({ length: 10 }, (_, i) => ({ dir: i & 1 ? 1 : -1, ph: r(), per: 14 + (i % 3) * 3, sp: 5 + r() * 5, hgt: 4 + r() * 4 }));

    /* ---------- земля ---------- */
    const ground = new Layer(W, H), gtop = x => Y(152) + 2 * Math.sin(x / 7) + 1.5 * Math.sin(x / 3.1 + 1);
    const rg = mulberry32(3);
    for (let x = 0; x < W; x++) {
      const t = Math.round(gtop(x));
      for (let y = t; y < H; y++) {
        const u = clamp((y - t) / (H - t), 0, 1), b = bay(x, y);
        ground.px(x, y, u * 1.6 > b + .35 ? '#124a2c' : u > b * .6 ? '#1e6a3a' : '#2e8a48');
      }
      if (rg() < .3) ground.px(x, t, '#7ad868');
    }
    const groundC = ground.canvas();

    /* ---------- листья переднего плана ---------- */
    function leaf(L, bx, by, len, ang, wid, body, vein) {
      const ca = Math.cos(ang), sa = Math.sin(ang), N = 12, pts = [], back = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, ww = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), .75) * (1 - .2 * t);
        pts.push([bx + ca * len * t - sa * ww, by + sa * len * t + ca * ww]);
        back.unshift([bx + ca * len * t + sa * ww, by + sa * len * t - ca * ww]);
      }
      L.poly(pts.concat(back), body);
      L.line(Math.round(bx), Math.round(by), Math.round(bx + ca * len * .95), Math.round(by + sa * len * .95), vein);
      for (let t = .22; t < .85; t += .16) {
        const cx = bx + ca * len * t, cy = by + sa * len * t, ww = wid * Math.sin(Math.PI * t) * .75;
        for (const sg of [-1, 1]) L.line(Math.round(cx), Math.round(cy), Math.round(cx + ca * ww * .5 - sg * sa * ww * .85), Math.round(cy + sa * ww * .5 + sg * ca * ww * .85), vein);
      }
    }
    const lv = new Layer(W, H), rl = mulberry32(88);
    const lcol = ['#1f8a4a', '#26a058', '#187a40'], vcol = ['#8af0a0', '#9af8b0', '#6ad88a'];
    const L1 = n => Math.round(n * sc * 1.3);
    const bot = Y(192);
    leaf(lv, -2, bot - L1(6), L1(40), -.55, L1(11), lcol[0], vcol[0]);
    leaf(lv, -2, bot + 2, L1(36), -1.05, L1(10), lcol[1], vcol[1]);
    leaf(lv, L1(6), bot + 6, L1(34), -.2, L1(9), lcol[2], vcol[2]);
    leaf(lv, W + 2, bot - L1(4), L1(38), Math.PI + .5, L1(11), lcol[1], vcol[1]);
    leaf(lv, W + 2, bot + 4, L1(34), Math.PI + 1.0, L1(10), lcol[0], vcol[0]);
    leaf(lv, W - L1(6), bot + 6, L1(30), Math.PI + .15, L1(9), lcol[2], vcol[2]);
    leaf(lv, -3, Ys(-3), L1(34), .75, L1(11), lcol[0], vcol[0]);
    leaf(lv, -3, Ys(-2), L1(28), 1.25, L1(9), lcol[2], vcol[2]);
    leaf(lv, W + 3, Ys(-3), L1(34), Math.PI - .75, L1(11), lcol[1], vcol[1]);
    leaf(lv, W + 3, Ys(0), L1(26), Math.PI - 1.3, L1(9), lcol[0], vcol[0]);
    for (const d of [-1, 1]) for (const u of outward(d * 54, d, limit, 34, 60, rl)) {
      const ang = -Math.PI / 2 + (rl() - .5) * 1.4;
      leaf(lv, U(u), bot + 6, L1(randint(rl, 26, 40)), ang, L1(randint(rl, 8, 11)), lcol[randint(rl, 0, 2)], vcol[randint(rl, 0, 2)]);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lv.has(x, y) && !lv.has(x, y - 1) && bay(x, y) < .5) lv.px(x, y, '#c4f8a0');
    const lvC = lv.canvas();

    /* ---------- лианы, цветы, бабочки, попугаи ---------- */
    const FRUIT = ['#f0b030', '#e86a30', '#b060e0'];
    const vines = [[-20, 52, 1.5, .1], [-4, 36, 1.2, .5], [41, 62, 1.8, .8], [56, 44, 1.4, .3]].map(([u, len, amp, ph], i) => ({ x: Math.round(U(u)), len, amp, ph, fr: FRUIT[i % 3] }));
    for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 18, 40, rl)) vines.push({ x: Math.round(U(u)), len: randint(rl, 26, 64), amp: 1 + rl() * 1.2, ph: rl(), fr: FRUIT[randint(rl, 0, 2)] });
    const FL = [['#ff5cb0', '#ffe0f0'], ['#ff9a30', '#fff0a0'], ['#a060f0', '#ecd8ff'], ['#ffd830', '#fff8c0'], ['#ff4848', '#ffd0c0']];
    const flowers = [[-12, 184, 0], [6, 188, 1], [22, 177, 2]];
    for (const d of [-1, 1]) for (const u of outward(d * 38, d, limit, 18, 34, rl)) flowers.push([u, randint(rl, 178, 190), randint(rl, 0, 4)]);
    const flw = new Layer(W, H);
    for (const [u, y, k] of flowers) {
      const x = Math.round(U(u)), yy = Y(y), [c1, c2] = FL[k];
      flw.vline(x, yy + 2, yy + 14, '#1c7a40'); flw.px(x - 1, yy + 6, '#1c7a40'); flw.px(x + 1, yy + 8, '#1c7a40');
      flw.disc(x, yy, 2, c1); flw.px(x, yy, c2); flw.px(x - 2, yy + 1, c1); flw.px(x + 2, yy + 1, c1); flw.px(x, yy - 2, c1);
    }
    const flwC = flw.canvas();
    const pollen = makeMotes(r, Math.round(26 * W / 128), W, { y0: Y(96), y1: Y(186), colors: ['#fff8b0', '#ffffff', '#f4ec90'], rise: .08, amp: [2, 6], big: .12 });
    const drops = makeMotes(r, 12, W, { x0: fx - 10, x1: fx + 10, y0: Y(136), y1: Y(152), colors: ['#ffffff', '#c8f4ff'], rise: .35, amp: [1, 3], big: 0 });
    const flies = [[-30, 150, '#ff9a30', 0], [18, 168, '#4aa0ff', .3], [44, 140, '#ffe040', .6], [-6, 176, '#ff70c0', .85]].map(([u, y, c, ph]) => ({ cx: U(u), cy: Y(y), c, ph }));
    const parrots = [[.55, Ys(34), '#e83030', 0], [.42, Ys(58), '#ffd020', 90]].map(([v, y, c, ph], i) => ({ v, y, c, x0: r() * (W + 80), ph, i }));
    // световые лучи сквозь листву
    const shafts = [[-30, .35, 12], [4, .4, 9], [38, .3, 13], [60, .38, 10]].map(([u, sl, w], i) => ({ x0: U(u), sl, w, ph: i * 1.7 }));
    const ov = new Overlay(W, H), mist = new Overlay(W, H);
    const sy0 = Ys(0), sy1 = Y(158);
    function raysDraw(f) {
      for (const s of shafts) {
        const cxs = s.x0 + 4 * Math.sin(TP * (f / 240 + s.ph));
        const amp = .55 + .45 * Math.sin(TP * (f / 180 + s.ph * 2));
        for (let y = sy0; y < sy1; y++) {
          const t = (y - sy0) / (sy1 - sy0), cc = cxs + s.sl * (y - sy0), w = s.w * (.6 + .6 * t);
          for (let x = Math.floor(cc - w); x <= Math.ceil(cc + w); x++) {
            const a = Math.pow(Math.max(0, 1 - Math.abs(x - cc) / w), 1.4) * .34 * amp * (1 - .55 * t);
            const q = Math.floor(a * 4 + bay(x, y)) / 4;
            if (q > 0) ov.over(x, y, '#fff6b0', q > 1 ? 1 : q);
          }
        }
      }
    }
    const bflap = (x, y, c, up) => { ctx_.fillStyle = c; ctx_.fillRect(x - 1, y - (up ? 1 : 0), 1, 2); ctx_.fillRect(x + 1, y - (up ? 1 : 0), 1, 2); ctx_.fillStyle = '#3a2a1a'; ctx_.fillRect(x, y, 1, 1); };
    let ctx_ = null;

    return {
      draw(ctx, f) {
        ctx_ = ctx;
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        for (const p of parrots) {
          const P = W + 80, x = Math.floor(((p.x0 + p.v * f) % P + P) % P) - 40, y = p.y + Math.round(2 * Math.sin(TP * (f / 90 + p.ph / 90))), up = (((f >> 1) + p.i) & 1) === 1;
          ctx.fillStyle = p.c; ctx.fillRect(x, y, 3, 2); ctx.fillStyle = '#2860e0'; ctx.fillRect(x - 1, y + (up ? -1 : 1), 2, 1); ctx.fillRect(x + 1, y + (up ? -1 : 1), 2, 1);
          ctx.fillStyle = '#ffd020'; ctx.fillRect(x - 3, y + 1, 2, 1); ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y, 1, 1);
        }
        for (const v of vines) {
          let ex = v.x;
          for (let k = 0; k < v.len; k++) {
            const sw = Math.round(v.amp * Math.pow(k / v.len, 1.6) * Math.sin(TP * (f / 90 + v.ph)));
            ctx.fillStyle = k & 1 ? '#3aa850' : '#2a8a40'; ctx.fillRect(v.x + sw, Ys(-1) + k, 1, 1);
            if (k % 7 === 3) { ctx.fillStyle = '#7ae080'; ctx.fillRect(v.x + sw + 1, Ys(-1) + k, 1, 1); }
            ex = v.x + sw;
          }
          fillDisc(ctx, ex, Ys(-1) + v.len + 2, 2, v.fr); ctx.fillStyle = '#fff4c0'; ctx.fillRect(ex - 1, Ys(-1) + v.len + 1, 1, 1);
        }
        ctx.drawImage(towerC, 0, 0);
        ctx.drawImage(farC, 0, 0);
        fog(mist, f, { y0: Y(108), y1: Y(130), color: '#e8fff0', strength: .2, speed: .35, fade: 'mid', levels: 3 });
        mist.flush(ctx, 0, Y(108), W, Y(130));
        ctx.drawImage(midC, 0, 0);
        ctx.drawImage(nearC, 0, 0);
        ctx.drawImage(cliffC, 0, 0);
        const sh = Math.floor(f * 1.4);
        for (let x = fx - 4; x < fx + 4; x++) {
          const edge = x === fx - 4 || x === fx + 3;
          for (let y = fy0; y < fy1; y++) {
            const v = (((y + ((x * 5) % 7) - sh) % 7) + 7) % 7;
            ctx.fillStyle = FALL[edge ? (v < 3 ? 2 : 3) : v < 2 ? 0 : v < 4 ? 1 : v < 6 ? 2 : 1];
            ctx.fillRect(x, y, 1, 1);
          }
        }
        for (const s of spl) {
          const p = (((f / s.per + s.ph) % 1) + 1) % 1, x = Math.round(fx + s.dir * (2 + s.sp * p)), y = Math.round(fy1 - s.hgt * Math.sin(Math.PI * p) + 3 * p * p);
          ctx.fillStyle = p < .7 ? '#ffffff' : '#a8e8f8'; ctx.fillRect(x, y, 1, 1);
        }
        drawMotes(ctx, drops, f);
        glowPulse(mist, fx, fy1 + 1, 12, '#ffffff', f, { per: 70, strength: .4, lo: .55 });
        fog(mist, f, { y0: fy1 - 8, y1: fy1 + 8, x0: fx - 22, x1: fx + 22, color: '#ffffff', strength: .4, speed: .25, fade: 'mid', levels: 3, lam: [30, 21] });
        mist.flush(ctx, Math.max(0, fx - 24), fy1 - 14, Math.min(W, fx + 24), fy1 + 14);
        ctx.drawImage(groundC, 0, 0);
        raysDraw(f); ov.flush(ctx, 0, sy0, W, sy1);
        drawMotes(ctx, pollen, f);
        ctx.drawImage(flwC, 0, 0);
        for (const b of flies) {
          const x = Math.round(b.cx + 14 * Math.sin(TP * (f / 140 + b.ph))), y = Math.round(b.cy + 6 * Math.sin(TP * (f / 90 + b.ph * 2)));
          bflap(x, y, b.c, (f >> 1) & 1);
        }
        ctx.drawImage(lvC, 0, 0);
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('jungle', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: mountains ===== */
/* Горы: закатное небо, розово-лавандовые пики, тёмный бор, озеро с отражением, высокие ёлки по краям.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, mulberry32, randint, gradient, peakRidge, hill, outward, moonSprite, makeStars, drawStars,
    cloudRow, drawCloudRows, makeMotes, drawMotes, drawBird, fog, Overlay, pine, bay, clamp, mix, shimmer } = px;
  const TP2 = 2 * Math.PI;
  const r = mulberry32(71), xc = W / 2;
  const sc = clamp(W / 128, .7, 1);
  const moonX = U(35), moonY = Ys(22), shore = Y(157);

  /* ---------- небо ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#0a0a38', '#141254', '#241e6c', '#3a2a80', '#5c3a90', '#8a4a98', '#c0608e', '#ee8494', '#ffa49c', '#ffb8a4'], 0, Y(140));
  const skyC = sky.canvas();
  const moon = moonSprite(7, ['#cfc8f4', '#f2eeff', '#ffffff'], true);
  const stars = makeStars(r, Math.round(78 * W / 128), W, Y(112), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 12 });
  const rows = [
    cloudRow({ sizes: [[34, 4], [26, 3], [40, 4]], seed: 8, cols: ['#4a3484', '#e87c9c', '#7a4a98'], y: Ys(58), v: .22, gap: 130, off: 20 }),
    cloudRow({ sizes: [[28, 3], [36, 4]], seed: 15, cols: ['#8a4a9a', '#ffa0a8', '#c0608e'], y: Ys(80), v: .3, gap: 110, off: 70 }),
  ];
  const birds = [[.30, Ys(40), 0], [.22, Ys(66), 40], [.38, Ys(30), 90]].map(([v, y, ph], i) => ({ v, y, x0: r() * (W + 60), ph, i }));

  /* ---------- пики: три ряда с розовой освещённой и лавандовой теневой гранью ---------- */
  const rm = mulberry32(19);
  const mk = (base, peaks, seed, o, ext) => {
    const L = new Layer(W, H);
    if (ext) for (const d of [-1, 1]) for (const u of outward(d * ext[0], d, limit, ext[1], ext[2], rm)) peaks.push([u, randint(rm, ext[3], ext[4]), randint(rm, ext[5], ext[6])]);
    hill(L, peakRidge(xc, base, peaks, seed, .2), o);
    return L.canvas();
  };
  const farC = mk(Y(142), [[-56, 46, 22], [-47, 52, 18], [-6, 62, 28], [16, 68, 34], [38, 42, 14], [54, 54, 22]], 3,
    { lit: '#ffd0e8', shade: '#a490d6', deep: '#6a4aa4', rim: '#fff0f8', lightX: -1e9, k: 2.6, lean: 0, depth: 110, sh: 2 }, [64, 24, 40, 34, 58, 16, 26]);
  const midC = mk(Y(146), [[-34, 40, 26], [-12, 30, 16], [14, 38, 18], [47, 50, 26], [60, 30, 14]], 7,
    { lit: '#f8aed6', shade: '#8a6cc0', deep: '#4a3290', rim: '#ffd0e8', lightX: -1e9, k: 2.6, lean: 0, depth: 90, sh: 2 }, [66, 26, 42, 26, 46, 16, 24]);
  const nearC = mk(Y(150), [[-10, 24, 30], [30, 20, 26], [-46, 18, 20]], 11,
    { lit: '#5a3e98', shade: '#3a2a7c', deep: '#281c5e', rim: '#8a6cc0', lightX: -1e9, k: 1.2, lean: 0, depth: 22, sh: 2 }, [60, 24, 40, 14, 26, 18, 28]);

  /* ---------- бор ---------- */
  const forest = new Layer(W, H), rf = mulberry32(23);
  [[Y(146), 9, 15, '#2a1e6c', '#5a4a9c', 4, 6], [Y(151), 11, 19, '#1e1660', '#40308a', 3, 6], [Y(157), 12, 22, '#150f4a', '#2e2270', 3, 5]].forEach(([base, h0, h1, col, rim, s0, s1]) => {
    for (let x = -4; x < W + 6; x += randint(rf, s0, s1)) pine(forest, x, base, randint(rf, h0, h1), col, rim, randint(rf, 6, 9), randint(rf, 3, 4));
  });
  forest.rect(0, Y(156), W, shore, '#150f4a');
  const forestC = forest.canvas();

  /* ---------- озеро с отражением ---------- */
  const scene = new Layer(W, H);
  const blit = src => { for (let i = 0; i < src.d.length; i += 4) if (src.d[i + 3]) { scene.d[i] = src.d[i]; scene.d[i + 1] = src.d[i + 1]; scene.d[i + 2] = src.d[i + 2]; scene.d[i + 3] = 255; } };
  blit(sky);
  [farC, midC, nearC, forestC].forEach(cv => { const L = new Layer(W, H); L.d.set(cv.getContext('2d').getImageData(0, 0, W, H).data); blit(L); });
  const lake = new Layer(W, H), LK = ['#34287a', '#2a2068', '#201858', '#181048'], LKm = LK.map(C);
  for (let y = shore; y < H; y++) {
    const t = clamp((y - shore) / Math.max(1, H - shore), 0, 1), k = Math.min(2, Math.floor(t * 3 + .0)), srcY = shore - 1 - Math.round((y - shore) * 1.5);
    for (let x = 0; x < W; x++) {
      const base = LKm[(t * 3 > bay(x, y) + k) ? Math.min(3, k + 1) : k];
      let c = base;
      if (srcY >= 0 && bay(x, y) < .72 - .35 * t) {
        const i = (srcY * W + x) << 2;
        if (scene.d[i + 3]) c = mix(base, [scene.d[i], scene.d[i + 1], scene.d[i + 2]], .55);
      }
      lake.px(x, y, c);
    }
  }
  const lakeC = lake.canvas();
  const rip = [];                                                           // полосы ряби на воде
  const rr = mulberry32(31);
  for (let k = 0; k < 8; k++) {
    const y = shore + 4 + k * Math.max(3, Math.round((H - shore - 6) / 8)), n = 4 + (k >> 1);
    for (let j = 0; j < n; j++) rip.push({ y, x: rr() * W, len: randint(rr, 3, 7), v: (k % 2 ? 1 : -1) * (.08 + .05 * (k % 3)), c: j & 1 ? '#6a58b0' : '#4a3c94' });
  }
  const glints = makeMotes(r, Math.round(16 * W / 128), W, { y0: shore + 3, y1: H - 2, colors: ['#ffc8e8', '#d0c0ff', '#ffe0f0'], rise: 0, amp: [0, 1], big: .25 });
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 40;

  /* ---------- передний план: тёмные склоны и ёлки ---------- */
  const fg = new Layer(W, H), rt = mulberry32(51);
  const dark = '#07042a', rimF = '#4a3aa0', S1 = n => Math.round(n * sc);
  fg.poly([[-2, Y(150)], [S1(14), Y(160)], [S1(46), H + 2], [-2, H + 2]], dark);
  fg.poly([[W + 2, Y(166)], [W - S1(20), Y(177)], [W - S1(34), H + 2], [W + 2, H + 2]], dark);
  fg.rect(0, H - 3, W, H, dark);
  pine(fg, Math.round(U(-42)), Y(204), 84, dark, rimF, 32, 10);
  pine(fg, Math.round(U(-27)), Y(204), 48, dark, rimF, 22, 6);
  pine(fg, Math.round(U(46)), Y(204), 66, dark, rimF, 26, 8);
  for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 16, 34, rt)) {
    const h = randint(rt, 40, 92);
    fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], dark);
    pine(fg, Math.round(U(u)), Y(randint(rt, 198, 206)), h, dark, rimF, Math.round(h * .38), Math.max(5, Math.round(h / 9)));
  }
  const fgC = fg.canvas();
  const ov = new Overlay(W, H);

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      drawCloudRows(ctx, rows, f, W);
      for (const b of birds) {
        const x = Math.floor(((b.x0 + b.v * f) % (W + 60) + W + 60) % (W + 60)) - 30;
        drawBird(ctx, x, b.y + Math.round(2 * Math.sin(TP2 * (f / 80 + b.ph / 90))), (((f >> 2) + b.i) & 1) === 1, '#1c1048');
      }
      ctx.drawImage(farC, 0, 0);
      ctx.drawImage(midC, 0, 0);
      ctx.drawImage(nearC, 0, 0);
      fog(ov, f, { y0: Y(122), y1: Y(152), color: '#c898d8', strength: .26, speed: .3, fade: 'mid', levels: 3 });
      ov.flush(ctx, 0, Y(122), W, Y(152));
      ctx.drawImage(forestC, 0, 0);
      ctx.drawImage(lakeC, 0, 0);
      shimmer(ctx, tmp, f, shore + 1, H, { amp: 1, per: 5, spd: 30, dy: env.dy });
      for (const p of rip) {
        const x = Math.floor(((p.x + p.v * f) % W + W) % W);
        ctx.fillStyle = p.c; ctx.fillRect(x, p.y, p.len, 1);
      }
      drawMotes(ctx, glints, f);
      ctx.drawImage(fgC, 0, 0);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, mulberry32, randint, gradient, addGlow, sunDisc, peakRidge, hill, outward, cloudRow, drawCloudRows,
      makeMotes, drawMotes, fog, Overlay, pine, bay, clamp, mix, shimmer, C } = px;
    const TP2 = 2 * Math.PI;
    const r = mulberry32(71), xc = W / 2;
    const sc = clamp(W / 128, .7, 1);
    const sunX = U(-34), sunY = Ys(26), shore = Y(157);

    /* ---------- небо, солнце, облака ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#2a7ce0', '#4a96e8', '#6ab0ee', '#8cc8f2', '#b0def6', '#d0eefa', '#eaf8fc'], 0, Y(140));
    addGlow(sky, sunX, sunY, 8, 64, '#fff4c0', .7, 5, 1.5);
    sunDisc(sky, sunX, sunY, [[9, '#ffe27a'], [7, '#fff2a8'], [5, '#ffffff']]);
    const skyC = sky.canvas();
    const cc = ['#f6f9fe', '#b4c8e6', '#ffffff'];
    const rows = [
      cloudRow({ sizes: [[46, 10], [36, 9], [54, 11]], seed: 8, cols: cc, y: Ys(26), v: .22, gap: 130, off: 20 }),
      cloudRow({ sizes: [[36, 9], [48, 10]], seed: 15, cols: cc, y: Ys(64), v: .3, gap: 112, off: 70 }),
    ];
    const rowsMid = [cloudRow({ sizes: [[40, 9], [30, 8], [46, 10]], seed: 31, cols: cc, y: Y(112), v: .36, gap: 120, off: 40 })];
    const eagles = [[.5, Ys(40), 34, 0], [.8, Ys(62), 24, .5]].map(([ph, y, rx, o]) => ({ ph, y, rx, o }));

    /* ---------- пики: снежные шапки и голубые тени ---------- */
    const rm = mulberry32(19);
    const mk = (base, peaks, seed, o, ext) => {
      const L = new Layer(W, H);
      if (ext) for (const d of [-1, 1]) for (const u of outward(d * ext[0], d, limit, ext[1], ext[2], rm)) peaks.push([u, randint(rm, ext[3], ext[4]), randint(rm, ext[5], ext[6])]);
      hill(L, peakRidge(xc, base, peaks, seed, .2), o);
      return L.canvas();
    };
    const snowDepth = (x, top) => 22 + Math.round(5 * Math.sin(x * .45));
    const farC = mk(Y(142), [[-56, 46, 22], [-47, 52, 18], [-6, 62, 28], [16, 68, 34], [38, 42, 14], [54, 54, 22]], 3,
      { lit: '#a0b4d4', shade: '#6a84b4', deep: '#5c7ab0', rim: '#ffffff', lightX: -1e9, k: 2.6, lean: 0, depth: 110, sh: 2, snow: ['#ffffff', '#b4ccf0'], snowDepth }, [64, 24, 40, 34, 58, 16, 26]);
    const midC = mk(Y(146), [[-34, 40, 26], [-12, 30, 16], [14, 38, 18], [47, 50, 26], [60, 30, 14]], 7,
      { lit: '#8ea8c0', shade: '#5a7a9c', deep: '#486a90', rim: '#f4faff', lightX: -1e9, k: 2.6, lean: 0, depth: 90, sh: 2, snow: ['#f4f9ff', '#a8c4ea'], snowDepth: (x, t) => 14 + Math.round(4 * Math.sin(x * .5)) }, [66, 26, 42, 26, 46, 16, 24]);
    const nearC = mk(Y(150), [[-10, 24, 30], [30, 20, 26], [-46, 18, 20]], 11,
      { lit: '#5ea850', shade: '#3c8040', deep: '#2a6434', rim: '#b0e878', lightX: -1e9, k: 1.2, lean: 0, depth: 22, sh: 2 }, [60, 24, 40, 14, 26, 18, 28]);

    /* ---------- бор ---------- */
    const forest = new Layer(W, H), rf = mulberry32(23);
    [[Y(146), 9, 15, '#2e8048', '#66c468', 4, 6], [Y(151), 11, 19, '#1f6c3e', '#4cae5c', 3, 6], [Y(157), 12, 22, '#155a34', '#388e4e', 3, 5]].forEach(([base, h0, h1, col, rim, s0, s1]) => {
      for (let x = -4; x < W + 6; x += randint(rf, s0, s1)) pine(forest, x, base, randint(rf, h0, h1), col, rim, randint(rf, 6, 9), randint(rf, 3, 4));
    });
    forest.rect(0, Y(156), W, shore, '#155a34');
    const forestC = forest.canvas();

    /* ---------- озеро с отражением неба и гор ---------- */
    const scene = new Layer(W, H);
    const blit = src => { for (let i = 0; i < src.d.length; i += 4) if (src.d[i + 3]) { scene.d[i] = src.d[i]; scene.d[i + 1] = src.d[i + 1]; scene.d[i + 2] = src.d[i + 2]; scene.d[i + 3] = 255; } };
    blit(sky);
    [farC, midC, nearC, forestC].forEach(cv => { const L = new Layer(W, H); L.d.set(cv.getContext('2d').getImageData(0, 0, W, H).data); blit(L); });
    const lake = new Layer(W, H), LKm = ['#52a8dc', '#4296d0', '#3282c2', '#2870b0'].map(C);
    for (let y = shore; y < H; y++) {
      const t = clamp((y - shore) / Math.max(1, H - shore), 0, 1), k = Math.min(2, Math.floor(t * 3)), srcY = shore - 1 - Math.round((y - shore) * 1.5);
      for (let x = 0; x < W; x++) {
        const base = LKm[(t * 3 > bay(x, y) + k) ? Math.min(3, k + 1) : k];
        let c = base;
        if (srcY >= 0 && bay(x, y) < .78 - .3 * t) {
          const i = (srcY * W + x) << 2;
          if (scene.d[i + 3]) c = mix(base, [scene.d[i], scene.d[i + 1], scene.d[i + 2]], .62);
        }
        lake.px(x, y, c);
      }
    }
    const lakeC = lake.canvas();
    const rip = [], rr = mulberry32(31);
    for (let k = 0; k < 8; k++) {
      const y = shore + 4 + k * Math.max(3, Math.round((H - shore - 6) / 8)), n = 4 + (k >> 1);
      for (let j = 0; j < n; j++) rip.push({ y, x: rr() * W, len: randint(rr, 3, 7), v: (k % 2 ? 1 : -1) * (.08 + .05 * (k % 3)), c: j & 1 ? '#d4eeff' : '#8ccaf2' });
    }
    const glints = makeMotes(r, Math.round(20 * W / 128), W, { y0: shore + 3, y1: H - 2, colors: ['#ffffff', '#e8f6ff', '#fff6c8'], rise: 0, amp: [0, 1], big: .3 });
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 40;

    /* ---------- передний план ---------- */
    const fg = new Layer(W, H), rt = mulberry32(51);
    const dark = '#143e2a', rimF = '#4ca262', S1 = n => Math.round(n * sc);
    fg.poly([[-2, Y(150)], [S1(14), Y(160)], [S1(46), H + 2], [-2, H + 2]], '#1c4a30');
    fg.poly([[W + 2, Y(166)], [W - S1(20), Y(177)], [W - S1(34), H + 2], [W + 2, H + 2]], '#1c4a30');
    fg.rect(0, H - 3, W, H, '#1c4a30');
    pine(fg, Math.round(U(-42)), Y(204), 84, dark, rimF, 32, 10);
    pine(fg, Math.round(U(-27)), Y(204), 48, dark, rimF, 22, 6);
    pine(fg, Math.round(U(46)), Y(204), 66, dark, rimF, 26, 8);
    for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 16, 34, rt)) {
      const h = randint(rt, 40, 92);
      fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], '#1c4a30');
      pine(fg, Math.round(U(u)), Y(randint(rt, 198, 206)), h, dark, rimF, Math.round(h * .38), Math.max(5, Math.round(h / 9)));
    }
    const fgC = fg.canvas();
    const ov = new Overlay(W, H);

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rows, f, W);
        for (const e of eagles) {
          const a = TP2 * (f / 420 + e.ph), x = Math.round(xc + e.rx * 2 * Math.cos(a)), y = Math.round(e.y + 6 * Math.sin(2 * a)), up = Math.sin(a * 6) > .6;
          ctx.fillStyle = '#2a2030';
          for (const [dx, dy] of [[-4, up ? 0 : 1], [-3, 0], [-2, up ? -1 : 0], [-1, 0], [0, 0], [1, 0], [2, up ? -1 : 0], [3, 0], [4, up ? 0 : 1]]) ctx.fillRect(x + dx, y + dy, 1, 1);
          ctx.fillRect(x, y + 1, 1, 1);
        }
        ctx.drawImage(farC, 0, 0);
        drawCloudRows(ctx, rowsMid, f, W);
        ctx.drawImage(midC, 0, 0);
        ctx.drawImage(nearC, 0, 0);
        fog(ov, f, { y0: Y(122), y1: Y(152), color: '#eaf6ff', strength: .3, speed: .3, fade: 'mid', levels: 3 });
        ov.flush(ctx, 0, Y(122), W, Y(152));
        ctx.drawImage(forestC, 0, 0);
        ctx.drawImage(lakeC, 0, 0);
        shimmer(ctx, tmp, f, shore + 1, H, { amp: 1, per: 5, spd: 30, dy: env.dy });
        for (const p of rip) {
          const x = Math.floor(((p.x + p.v * f) % W + W) % W);
          ctx.fillStyle = p.c; ctx.fillRect(x, p.y, p.len, 1);
        }
        drawMotes(ctx, glints, f);
        ctx.drawImage(fgC, 0, 0);
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('mountains', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: city_magic ===== */
/* Магический город: полная луна, сияние, парящие острова с башнями, шпили с кристаллами, светящиеся окна, крупные кристаллы.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, moonSprite, makeStars, drawStars, makeSparkles, drawSparkles,
    makeMotes, drawMotes, cloudRow, drawCloudRows, glowPulse, fog, crystalGem, pine, outward, bay, clamp, tri } = px;
  const r = mulberry32(83), xc = W / 2, TP = 2 * Math.PI;
  const sc = clamp(W / 128, .7, 1), S1 = n => Math.round(n * sc);
  const moonX = U(-36), moonY = Ys(26);

  /* ---------- небо, луна, звёзды, сияние ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#0c0a30', '#150f46', '#20135a', '#2c1a6c', '#3a2480', '#47298e', '#522e96'], 0, Y(150));
  addGlow(sky, moonX, moonY, 10, 46, '#a08ae8', .5, 5, 1.6);
  const skyC = sky.canvas();
  const moon = moonSprite(10, ['#c8b8f0', '#f0e8ff', '#ffffff', '#b8a4e8'], false);
  const stars = makeStars(r, Math.round(70 * W / 128), W, Y(120), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 15 });
  const spark = makeSparkles(r, Math.round(5 * W / 128) + 1, W, Ys(4), Ys(60));
  const ribbons = [
    { yc: Ys(46), amp: Ys(8), kx: .7, ke: .5, sk: .5, wid: Ys(20), strength: .62, color: '#38e0b0', ph: .8 },
    { yc: Ys(34), amp: Ys(8), kx: 1.1, ke: .7, sk: -.5, wid: Ys(18), strength: .5, color: '#a070ff', ph: 2.4 },
    { yc: Ys(64), amp: Ys(6), kx: .5, ke: .4, sk: .4, wid: Ys(16), strength: .42, color: '#d060e0', ph: 4.1 },
  ];
  const aurH = Ys(84), ovA = new Overlay(W, H);
  const LUT = new Float32Array(257);
  for (let i = 0; i <= 256; i++) { const u = -.8 + 3.8 * i / 256; LUT[i] = u >= 0 ? Math.exp(-u * 1.3) : Math.exp(-(u * 3.5) * (u * 3.5)); }
  const ribCols = ribbons.map(rb => C(rb.color));
  function auroraDraw(f) {
    ribbons.forEach((rb, k) => {
      const col = ribCols[k];
      for (let x = 0; x < W; x++) {
        const xr = (x - xc) / 128, th = TP * (rb.kx * xr + rb.sk * f / 120) + rb.ph;
        const cy = rb.yc + rb.amp * Math.sin(th) + .45 * rb.amp * Math.sin(2 * th + 1.3);
        const en = .35 + .65 * (.5 + .5 * Math.sin(TP * (rb.ke * xr + rb.sk * f / 120) + rb.ph * 1.7));
        const rays = .8 + .2 * Math.sin(TP * (18 * xr + rb.sk * f / 120)), k0 = rb.strength * en * rays;
        for (let y = Math.max(0, Math.floor(cy - 3 * rb.wid)); y < Math.min(aurH, Math.ceil(cy + .8 * rb.wid)); y++) {
          const a = k0 * LUT[(((cy - y) / rb.wid + .8) * 256 / 3.8) | 0];
          if (a < .03) continue;
          const q = Math.floor(a * 4 + bay(x, y)) / 4;
          if (q > 0) ovA.over(x, y, col, q > 1 ? 1 : q);
        }
      }
    });
  }

  /* ---------- розовые полосы облаков ---------- */
  const strips = [
    cloudRow({ sizes: [[64, 3], [48, 3], [56, 3]], seed: 6, cols: ['#8a48a8', '#e070c8', '#b058b8'], y: Y(104), v: .12, gap: 140, off: 20 }),
    cloudRow({ sizes: [[52, 3], [40, 3]], seed: 13, cols: ['#703a9c', '#c85cb8', '#9a4cb0'], y: Y(128), v: .18, gap: 120, off: 60 }),
  ];

  /* ---------- острова ---------- */
  const wins = [];                                                           // окна: [x, y, цвет, период, фаза]
  const WC = ['#ffd070', '#ffe090', '#60f0ff'];
  function island(L, cx, y, w, depth, tH, trees) {
    const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
    L.poly([[x0, y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#4a3a96');
    L.poly([[Math.round(cx), y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#2e2068');
    L.line(x0, y + 4, Math.round(cx) + 2, y + 4 + depth, '#7a68d0');
    for (let k = 0; k < 4; k++) L.px(Math.round(cx) + 3 + k * 3, y + 6 + k * 2, '#1c1450');
    L.rect(x0, y, x1, y + 3, '#2aa884'); L.hline(x0, x1, y, '#58e0b0'); L.hline(x0, x1, y + 3, '#1a7a68');
    for (const t of trees) pine(L, Math.round(cx + t[0]), y, t[1], '#1a8a6a', '#3ad0a0', 7, 3);
    if (tH) {
      const bx = Math.round(cx + 4);
      L.rect(bx - 3, y - tH, bx + 3, y, '#463496'); L.vline(bx - 3, y - tH, y, '#6a58c0'); L.vline(bx + 3, y - tH, y, '#32246e');
      L.poly([[bx - 5, y - tH], [bx + 5, y - tH], [bx, y - tH - 10]], '#5a3aa8'); L.poly([[bx - 5, y - tH], [bx, y - tH], [bx, y - tH - 10]], '#6c4cbc');
      crystalGem(L, bx, y - tH - 10, '#c0f8ff', '#40d8f0', '#2090c0', 6, 3);
      L.rect(bx - 1, y - tH + 6, bx, y - tH + 8, '#ffd070'); L.px(bx + 1, y - tH + 11, '#60f0ff');
      wins.push([bx - 1, y - tH + 6, 0, 90, 5]);
    }
  }
  const isl = new Layer(W, H), ri = mulberry32(17);
  const ix = Math.round(U(33)), iy = Y(64), il = Math.round(U(-36)), iyl = Y(122);
  island(isl, ix, iy, S1(46) + 4, 26, 26, [[-16, 12], [-10, 8], [16, 10]]);
  island(isl, il, iyl, S1(30) + 4, 14, 18, [[-10, 8], [8, 7]]);
  for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 44, 80, ri)) island(isl, Math.round(U(u)), Y(randint(ri, 62, 130)), randint(ri, 16, 26), randint(ri, 8, 14), ri() < .5 ? randint(ri, 10, 18) : 0, [[-4, randint(ri, 6, 9)]]);
  const islC = isl.canvas();
  const drips = [[ix + 8, 0, 22, 4], [ix + 11, 9, 28, 14], [ix + 14, 18, 20, 2]].map(([x, ph, per, y0]) => ({ x, ph, per, y0: iy + 10 + y0 }));
  // правый остров: каждые 22–28 кадров капля падает на 14 px

  /* ---------- силуэты города ---------- */
  function spireRow(base, hmin, hmax, step, body, roof, edge, seed, withWin) {
    const L = new Layer(W, H), rg = mulberry32(seed);
    for (let x = -8; x < W + 10; x += randint(rg, step[0], step[1])) {
      const w = randint(rg, 8, 15), h = randint(rg, hmin, hmax), top = base - h, xx = Math.round(x);
      L.rect(xx - (w >> 1), top, xx + (w >> 1), base + 20, body);
      if (rg() < .75) L.poly([[xx - (w >> 1) - 1, top], [xx + (w >> 1) + 1, top], [xx + Math.round((rg() - .5) * 2), top - randint(rg, 9, 22)]], roof);
      else L.rect(xx - (w >> 1) - 1, top - 2, xx + (w >> 1) + 1, top, roof);
      L.vline(xx - (w >> 1), top, base, edge);
      if (withWin) for (let k = 0; k < Math.floor(h / 9); k++) if (rg() < .55) wins.push([xx - 1 + (rg() < .5 ? -2 : 2), top + 6 + k * 8, randint(rg, 0, 2), pick(rg, [60, 90, 120, 180]), randint(rg, 0, 120)]);
    }
    return L.canvas();
  }
  const farC = spireRow(Y(176), 22, 52, [8, 14], '#32227a', '#3e2c8a', '#4e3ca0', 4, false);
  const midC = spireRow(Y(190), 26, 60, [9, 16], '#271a68', '#30227c', '#42338e', 9, true);

  /* ---------- главные шпили ---------- */
  const towers = new Layer(W, H);
  function spire(cx, tipY, shY, botY, wB, wS, baseTop, baseW) {
    cx = Math.round(cx);
    towers.poly([[cx - (wS >> 1), shY], [cx + (wS >> 1), shY], [cx, tipY]], '#3e2c92'); towers.poly([[cx - (wS >> 1), shY], [cx, shY], [cx, tipY]], '#4e3ca8');
    towers.line(cx - (wS >> 1), shY, cx, tipY, '#6a58c8');
    towers.rect(cx - (wB >> 1), shY, cx + (wB >> 1), botY, '#2a1e72'); towers.vline(cx - (wB >> 1), shY, botY, '#5a48b8'); towers.vline(cx + (wB >> 1), shY, botY, '#1c1458');
    for (let y = shY + 22; y < baseTop; y += 24) towers.hline(cx - (wB >> 1) - 1, cx + (wB >> 1) + 1, y, '#4a3aa0');
    towers.rect(cx - (baseW >> 1), baseTop, cx + (baseW >> 1), botY, '#24196a'); towers.vline(cx - (baseW >> 1), baseTop, botY, '#4a3aa0');
    towers.hline(cx - (baseW >> 1) - 1, cx + (baseW >> 1) + 1, baseTop, '#5a48b8');
    crystalGem(towers, cx, tipY, '#c0f8ff', '#40d8f0', '#2090c0', 8, 3);
    for (let k = 0; k < 6; k++) wins.push([cx - 1 + (k & 1) * 2 - (k & 1 ? 0 : 0), shY + 6 + (k >> 1) * 12, 0, pick(r, [90, 120, 180]), randint(r, 0, 100)]);
    for (let y = baseTop + 6; y < botY - 4; y += 9) { wins.push([cx - 3, y, randint(r, 0, 1), pick(r, [60, 90, 120]), randint(r, 0, 100)]); wins.push([cx + 2, y, randint(r, 0, 2), pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
  }
  const sx = U(-2), sx2 = U(30);
  spire(sx, Y(63), Y(96), Y(205), 8, 14, Y(152), 16);
  spire(sx2, Y(98), Y(120), Y(205), 7, 11, Y(160), 13);
  const towersC = towers.canvas();
  const bead = [];                                                          // бусы между шпилями
  for (let k = 0; k < 14; k++) { const t = k / 13; bead.push([Math.round(sx + 6 + t * (sx2 - sx - 12)), Math.round(Y(116) + 5 * Math.sin(Math.PI * t) + 2 * t)]); }

  /* ---------- парящие кристаллы ---------- */
  const gemSpr = {
    pink: (() => { const L = new Layer(9, 13); crystalGem(L, 4, 12, '#ffd0f4', '#ff70d0', '#b83098', 11, 3); return L.canvas(); })(),
    cyan: (() => { const L = new Layer(9, 13); crystalGem(L, 4, 12, '#d8ffff', '#50e0ff', '#2090c8', 11, 3); return L.canvas(); })(),
  };
  const floaters = [[-36, 128, 'pink', 0], [-27, 133, 'pink', .35], [23, 128, 'cyan', .6], [43, 121, 'pink', .1], [-52, 140, 'cyan', .8]]
    .map(([u, y, c, ph]) => ({ x: Math.round(U(u)), y: Y(y), c, ph }));
  for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 20, 44, ri)) floaters.push({ x: Math.round(U(u)), y: Y(randint(ri, 100, 150)), c: ri() < .5 ? 'pink' : 'cyan', ph: ri() });

  /* ---------- передний план: скалы и крупные кристаллы ---------- */
  const fg = new Layer(W, H), dark = '#0a0624';
  fg.poly([[-2, H + 2], [-2, Y(168)], [S1(18), Y(176)], [S1(36), H + 2]], dark);
  fg.poly([[W + 2, H + 2], [W + 2, Y(162)], [W - S1(16), Y(172)], [W - S1(32), H + 2]], dark);
  const CY = ['#8aecff', '#30b0e0', '#1a68b0'], PK = ['#ffa8e4', '#e050c0', '#9c2890'];
  function big(x, base, h, w, c) {
    x = Math.round(x); base = Math.round(base);
    fg.poly([[x - (w >> 1), base], [x - (w >> 1), base - h * .78], [x, base - h], [x, base]], c[1]);
    fg.poly([[x, base], [x, base - h], [x + (w >> 1), base - h * .78], [x + (w >> 1), base]], c[2]);
    fg.vline(x - (w >> 1) + 1, base - h * .7, base - 3, c[0]); fg.line(x - (w >> 1), Math.round(base - h * .78), x, Math.round(base - h), c[0]);
  }
  const gl = [], rgl = mulberry32(44);
  const bx = S1(14), bxr = W - S1(14), bb = H + 2;
  big(bx + 6, bb, S1(38), S1(9), CY); big(bx + 17, bb, S1(14), S1(7), CY); big(bx - 8, bb, S1(18), S1(7), PK);
  big(bxr - 6, bb, S1(40), S1(10), PK); big(bxr - 18, bb, S1(16), S1(7), CY); big(bxr + 5, bb, S1(16), S1(7), PK);
  gl.push([bx + 6, bb - S1(22), 24, '#40d0ff', 70, 0], [bxr - 6, bb - S1(24), 24, '#ff60d8', 80, 25]);
  for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 26, 56, rgl)) {
    const c = rgl() < .5 ? CY : PK, h = randint(rgl, 14, 34);
    fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], dark);
    big(U(u), Y(randint(rgl, 198, 204)), h, Math.round(h * .28) + 3, c); gl.push([U(u), Y(190) - h * .4, 16, c === CY ? '#40d0ff' : '#ff60d8', randint(rgl, 60, 90), randint(rgl, 0, 60)]);
  }
  const fgC = fg.canvas();
  const motes = makeMotes(r, Math.round(46 * W / 128), W, { y0: Y(70), y1: Y(190), colors: ['#60f0ff', '#ff80e0', '#ffd070', '#c0a8ff'], rise: .18, amp: [2, 5], big: .2 });
  const ov = new Overlay(W, H);

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      drawSparkles(ctx, spark, f, '#ffffff');
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      auroraDraw(f); ovA.flush(ctx, 0, 0, W, aurH);
      ctx.drawImage(islC, 0, 0);
      for (const d of drips) {
        const p = (((f + d.ph) % d.per) + d.per) % d.per, y = d.y0 + p, a = p < d.per * .8;
        if (a) { ctx.fillStyle = '#60e8ff'; ctx.fillRect(d.x, y, 1, 2); }
      }
      drawCloudRows(ctx, strips, f, W);
      ctx.drawImage(farC, 0, 0);
      ctx.drawImage(midC, 0, 0);
      ctx.drawImage(towersC, 0, 0);
      for (const [x, y, c, per, ph] of wins) if (tri(f, per, ph) > .16) { ctx.fillStyle = WC[c]; ctx.fillRect(x, y, 1, 2); }
      // бусы: бегущий блик
      bead.forEach(([x, y], k) => {
        const lv = tri(f, 56, k * 4);
        ctx.fillStyle = lv > .6 ? '#c8ffff' : lv > .25 ? '#50d8f0' : '#2a7aa8'; ctx.fillRect(x, y, 1, 1);
      });
      for (const g of floaters) {
        const o = Math.round(1.4 * Math.sin(TP * (f / 70 + g.ph)));
        ctx.drawImage(gemSpr[g.c], g.x - 4, g.y - 12 + o);
        if (tri(f, 40, g.ph * 80) > .8) { ctx.fillStyle = '#ffffff'; ctx.fillRect(g.x, g.y - 12 + o, 1, 1); ctx.fillRect(g.x - 1, g.y - 9 + o, 3, 1); ctx.fillRect(g.x, g.y - 10 + o, 1, 3); }
      }
      // кристаллы на шпилях и острове мерцают
      for (const [gx, gy] of [[sx, Y(63) - 5], [sx2, Y(98) - 5]]) if (tri(f, 36, gx) > .7) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(gx) - 2, gy, 5, 1); ctx.fillRect(Math.round(gx), gy - 2, 1, 5); }
      fog(ov, f, { y0: Y(150), y1: H, color: '#9a6ae0', strength: .26, speed: .3, fade: 'mid', levels: 3 });
      ov.flush(ctx, 0, Y(150), W, H);
      ctx.drawImage(fgC, 0, 0);
      for (const [x, y, rad, col, per, ph] of gl) glowPulse(ov, x, y, rad, col, f, { per, ph, strength: .5, lo: .55 });
      ov.flush(ctx, 0, Y(120), W, H);
      drawMotes(ctx, motes, f);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, sunDisc, makeSparkles, drawSparkles,
      makeMotes, drawMotes, cloudRow, drawCloudRows, glowPulse, fog, crystalGem, pine, outward, drawBird, bay, clamp, tri } = px;
    const r = mulberry32(83), xc = W / 2, TP = 2 * Math.PI;
    const sc = clamp(W / 128, .7, 1), S1 = n => Math.round(n * sc);
    const sunX = U(-36), sunY = Ys(26);

    /* ---------- небо и солнце ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#58a4ee', '#78bcf4', '#9ad0f8', '#bce0fa', '#dcecfc', '#f2eefc', '#fce8f4'], 0, Y(150));
    addGlow(sky, sunX, sunY, 8, 56, '#fff2c0', .7, 5, 1.5);
    sunDisc(sky, sunX, sunY, [[10, '#ffe27a'], [8, '#fff2a8'], [6, '#ffffff']]);
    const skyC = sky.canvas();
    const white = ['#f6f9fe', '#b4c8e6', '#ffffff'], candy = ['#fff0fa', '#e8b8e0', '#ffffff'];
    const rowsHi = [cloudRow({ sizes: [[44, 10], [34, 9], [50, 11]], seed: 9, cols: white, y: Ys(14), v: .22, gap: 118, off: 30 }),
      cloudRow({ sizes: [[36, 9], [46, 10]], seed: 19, cols: white, y: Ys(56), v: .3, gap: 108, off: 70 })];
    const strips = [
      cloudRow({ sizes: [[64, 7], [48, 6], [56, 7]], seed: 6, cols: candy, y: Y(104), v: .12, gap: 140, off: 20 }),
      cloudRow({ sizes: [[52, 6], [40, 6]], seed: 13, cols: candy, y: Y(128), v: .18, gap: 120, off: 60 }),
    ];
    const spark = makeSparkles(r, Math.round(4 * W / 128) + 1, W, Ys(6), Ys(70));
    const flock = [[0, 0], [-6, -2], [-6, 3], [-12, -4], [-12, 5]], flockX = r() * (W + 90), flockY = Ys(62);

    /* ---------- острова ---------- */
    const wins = [];
    const WC = ['#7a9ad8', '#8aaae0', '#6a88c8'];
    function island(L, cx, y, w, depth, tH, trees) {
      const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
      L.poly([[x0, y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#d0c0ee');
      L.poly([[Math.round(cx), y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#a898d0');
      L.line(x0, y + 4, Math.round(cx) + 2, y + 4 + depth, '#f4ecff');
      for (let k = 0; k < 4; k++) L.px(Math.round(cx) + 3 + k * 3, y + 6 + k * 2, '#8878b8');
      L.rect(x0, y, x1, y + 3, '#5ad070'); L.hline(x0, x1, y, '#a8f488'); L.hline(x0, x1, y + 3, '#3aa858');
      for (const t of trees) pine(L, Math.round(cx + t[0]), y, t[1], '#2c9a4c', '#7ae070', 7, 3);
      if (tH) {
        const bx = Math.round(cx + 4);
        L.rect(bx - 3, y - tH, bx + 3, y, '#f4ecff'); L.vline(bx - 3, y - tH, y, '#ffffff'); L.vline(bx + 3, y - tH, y, '#c0b0e0');
        L.poly([[bx - 5, y - tH], [bx + 5, y - tH], [bx, y - tH - 10]], '#f0c850'); L.poly([[bx - 5, y - tH], [bx, y - tH], [bx, y - tH - 10]], '#ffe488');
        crystalGem(L, bx, y - tH - 10, '#e0ffff', '#50e0ff', '#2090c8', 6, 3);
        L.rect(bx - 1, y - tH + 6, bx, y - tH + 8, '#8ab0e8'); L.px(bx + 1, y - tH + 11, '#8ab0e8');
      }
    }
    const isl = new Layer(W, H), ri = mulberry32(17);
    const ix = Math.round(U(33)), iy = Y(64), il = Math.round(U(-36)), iyl = Y(122);
    island(isl, ix, iy, S1(46) + 4, 26, 26, [[-16, 12], [-10, 8], [16, 10]]);
    island(isl, il, iyl, S1(30) + 4, 14, 18, [[-10, 8], [8, 7]]);
    for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 44, 80, ri)) island(isl, Math.round(U(u)), Y(randint(ri, 62, 130)), randint(ri, 16, 26), randint(ri, 8, 14), ri() < .5 ? randint(ri, 10, 18) : 0, [[-4, randint(ri, 6, 9)]]);
    const islC = isl.canvas();
    const drips = [[ix + 8, 0, 22, 4], [ix + 11, 9, 28, 14], [ix + 14, 18, 20, 2]].map(([x, ph, per, y0]) => ({ x, ph, per, y0: iy + 10 + y0 }));

    /* ---------- силуэты города ---------- */
    function spireRow(base, hmin, hmax, step, body, roof, roof2, edge, seed, withWin) {
      const L = new Layer(W, H), rg = mulberry32(seed); let n = 0;
      for (let x = -8; x < W + 10; x += randint(rg, step[0], step[1])) {
        const w = randint(rg, 8, 15), h = randint(rg, hmin, hmax), top = base - h, xx = Math.round(x), rc = (n++ & 1) ? roof : roof2;
        L.rect(xx - (w >> 1), top, xx + (w >> 1), base + 20, body);
        if (rg() < .75) L.poly([[xx - (w >> 1) - 1, top], [xx + (w >> 1) + 1, top], [xx + Math.round((rg() - .5) * 2), top - randint(rg, 9, 22)]], rc);
        else L.rect(xx - (w >> 1) - 1, top - 2, xx + (w >> 1) + 1, top, rc);
        L.vline(xx - (w >> 1), top, base, edge);
        if (withWin) for (let k = 0; k < Math.floor(h / 9); k++) if (rg() < .55) wins.push([xx - 1 + (rg() < .5 ? -2 : 2), top + 6 + k * 8, randint(rg, 0, 2), pick(rg, [60, 90, 120, 180]), randint(rg, 0, 120)]);
      }
      return L.canvas();
    }
    const farC = spireRow(Y(176), 22, 52, [8, 14], '#d6ccf2', '#e8dcff', '#f6dca0', '#f4eeff', 4, false);
    const midC = spireRow(Y(190), 26, 60, [9, 16], '#bcb0e6', '#d4c4f6', '#f0cc60', '#e8e0fc', 9, true);

    /* ---------- главные шпили ---------- */
    const towers = new Layer(W, H);
    function spire(cx, tipY, shY, botY, wB, wS, baseTop, baseW) {
      cx = Math.round(cx);
      towers.poly([[cx - (wS >> 1), shY], [cx + (wS >> 1), shY], [cx, tipY]], '#f0c850'); towers.poly([[cx - (wS >> 1), shY], [cx, shY], [cx, tipY]], '#ffe488');
      towers.line(cx - (wS >> 1), shY, cx, tipY, '#fff4c0');
      towers.rect(cx - (wB >> 1), shY, cx + (wB >> 1), botY, '#c8bcee'); towers.vline(cx - (wB >> 1), shY, botY, '#f6f0ff'); towers.vline(cx + (wB >> 1), shY, botY, '#9a8cc8');
      for (let y = shY + 22; y < baseTop; y += 24) towers.hline(cx - (wB >> 1) - 1, cx + (wB >> 1) + 1, y, '#f4d070');
      towers.rect(cx - (baseW >> 1), baseTop, cx + (baseW >> 1), botY, '#b8aae4'); towers.vline(cx - (baseW >> 1), baseTop, botY, '#f0e8ff');
      towers.hline(cx - (baseW >> 1) - 1, cx + (baseW >> 1) + 1, baseTop, '#f4d070');
      crystalGem(towers, cx, tipY, '#e8ffff', '#50e0ff', '#2090c8', 8, 3);
      for (let k = 0; k < 6; k++) wins.push([cx - 1 + (k & 1) * 2, shY + 6 + (k >> 1) * 12, 0, pick(r, [90, 120, 180]), randint(r, 0, 100)]);
      for (let y = baseTop + 6; y < botY - 4; y += 9) { wins.push([cx - 3, y, randint(r, 0, 1), pick(r, [60, 90, 120]), randint(r, 0, 100)]); wins.push([cx + 2, y, randint(r, 0, 2), pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
    }
    const sx = U(-2), sx2 = U(30);
    spire(sx, Y(63), Y(96), Y(205), 8, 14, Y(152), 16);
    spire(sx2, Y(98), Y(120), Y(205), 7, 11, Y(160), 13);
    const towersC = towers.canvas();
    const bead = [];
    for (let k = 0; k < 14; k++) { const t = k / 13; bead.push([Math.round(sx + 6 + t * (sx2 - sx - 12)), Math.round(Y(116) + 5 * Math.sin(Math.PI * t) + 2 * t)]); }
    const banners = [[Math.round(sx) + 5, Y(100), 9, '#ff7ab8', 0], [Math.round(sx) - 5, Y(108), -8, '#f0c850', 1.3], [Math.round(sx2) + 4, Y(126), 8, '#ff7ab8', .6], [ix + 3, iy - 18, 8, '#f0c850', 2.1]];

    /* ---------- парящие кристаллы ---------- */
    const gemSpr = {
      pink: (() => { const L = new Layer(9, 13); crystalGem(L, 4, 12, '#ffe0f8', '#ff80d8', '#c040a0', 11, 3); return L.canvas(); })(),
      cyan: (() => { const L = new Layer(9, 13); crystalGem(L, 4, 12, '#e8ffff', '#60e8ff', '#2898d0', 11, 3); return L.canvas(); })(),
    };
    const floaters = [[-36, 128, 'pink', 0], [-27, 133, 'pink', .35], [23, 128, 'cyan', .6], [43, 121, 'pink', .1], [-52, 140, 'cyan', .8]]
      .map(([u, y, c, ph]) => ({ x: Math.round(U(u)), y: Y(y), c, ph }));
    for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 20, 44, ri)) floaters.push({ x: Math.round(U(u)), y: Y(randint(ri, 100, 150)), c: ri() < .5 ? 'pink' : 'cyan', ph: ri() });

    /* ---------- передний план ---------- */
    const fg = new Layer(W, H), dark = '#6a5a9c';
    fg.poly([[-2, H + 2], [-2, Y(168)], [S1(18), Y(176)], [S1(36), H + 2]], dark);
    fg.poly([[W + 2, H + 2], [W + 2, Y(162)], [W - S1(16), Y(172)], [W - S1(32), H + 2]], dark);
    const CY = ['#c8fcff', '#40c4f0', '#2078c0'], PK = ['#ffd0f0', '#f060c8', '#b030a0'];
    function big(x, base, h, w, c) {
      x = Math.round(x); base = Math.round(base);
      fg.poly([[x - (w >> 1), base], [x - (w >> 1), base - h * .78], [x, base - h], [x, base]], c[1]);
      fg.poly([[x, base], [x, base - h], [x + (w >> 1), base - h * .78], [x + (w >> 1), base]], c[2]);
      fg.vline(x - (w >> 1) + 1, base - h * .7, base - 3, c[0]); fg.line(x - (w >> 1), Math.round(base - h * .78), x, Math.round(base - h), c[0]);
    }
    const gl = [], rgl = mulberry32(44);
    const bx = S1(14), bxr = W - S1(14), bb = H + 2;
    big(bx + 6, bb, S1(38), S1(9), CY); big(bx + 17, bb, S1(14), S1(7), CY); big(bx - 8, bb, S1(18), S1(7), PK);
    big(bxr - 6, bb, S1(40), S1(10), PK); big(bxr - 18, bb, S1(16), S1(7), CY); big(bxr + 5, bb, S1(16), S1(7), PK);
    gl.push([bx + 6, bb - S1(22), 18, '#80f0ff', 70, 0], [bxr - 6, bb - S1(24), 18, '#ffa0e8', 80, 25]);
    for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 26, 56, rgl)) {
      const c = rgl() < .5 ? CY : PK, h = randint(rgl, 14, 34);
      fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], dark);
      big(U(u), Y(randint(rgl, 198, 204)), h, Math.round(h * .28) + 3, c); gl.push([U(u), Y(190) - h * .4, 12, c === CY ? '#80f0ff' : '#ffa0e8', randint(rgl, 60, 90), randint(rgl, 0, 60)]);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fg.has(x, y) && !fg.has(x, y - 1) && fg.d[((y * W + x) << 2)] === 106 && bay(x, y) < .6) fg.px(x, y, '#a898d8');
    const fgC = fg.canvas();
    const motes = makeMotes(r, Math.round(42 * W / 128), W, { y0: Y(70), y1: Y(190), colors: ['#ffe880', '#ffb8e8', '#a8e8ff', '#ffffff'], rise: .16, amp: [2, 5], big: .25 });
    const ov = new Overlay(W, H);
    const pennant = (ctx, x, y, len, col, f, ph) => {
      const d = len < 0 ? -1 : 1, n = Math.abs(len);
      for (let i = 0; i < n; i++) { const wy = Math.round(1.3 * Math.sin(TP * (f / 22 - i / 5) + ph)); ctx.fillStyle = col; ctx.fillRect(x + d * i, y + wy, 1, 3 - (i * 3 / n | 0)); }
      ctx.fillStyle = '#c8a040'; ctx.fillRect(x - d, y - 1, 1, 6);
    };

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rowsHi, f, W);
        drawSparkles(ctx, spark, f, '#ffffff');
        const fxp = Math.floor(((flockX + .28 * f) % (W + 90) + W + 90) % (W + 90)) - 45;
        flock.forEach(([dx, dy], i) => drawBird(ctx, fxp + dx, flockY + dy + Math.round(Math.sin(TP * f / 70 + i)), (((f >> 2) + i) & 1) === 1, '#7a6aa8'));
        ctx.drawImage(islC, 0, 0);
        for (const d of drips) {
          const p = (((f + d.ph) % d.per) + d.per) % d.per;
          if (p < d.per * .8) { ctx.fillStyle = '#a8f0ff'; ctx.fillRect(d.x, d.y0 + p, 1, 2); }
        }
        drawCloudRows(ctx, strips, f, W);
        ctx.drawImage(farC, 0, 0);
        ctx.drawImage(midC, 0, 0);
        ctx.drawImage(towersC, 0, 0);
        for (const [x, y, c, per, ph] of wins) if (tri(f, per, ph) > .16) { ctx.fillStyle = WC[c]; ctx.fillRect(x, y, 1, 2); }
        for (const [bx_, by, len, col, ph] of banners) pennant(ctx, bx_, by, len, col, f, ph);
        bead.forEach(([x, y], k) => {
          const lv = tri(f, 56, k * 4);
          ctx.fillStyle = lv > .6 ? '#ffffff' : lv > .25 ? '#ffe8a0' : '#d8b860'; ctx.fillRect(x, y, 1, 1);
        });
        for (const g of floaters) {
          const o = Math.round(1.4 * Math.sin(TP * (f / 70 + g.ph)));
          ctx.drawImage(gemSpr[g.c], g.x - 4, g.y - 12 + o);
          if (tri(f, 40, g.ph * 80) > .8) { ctx.fillStyle = '#ffffff'; ctx.fillRect(g.x, g.y - 12 + o, 1, 1); ctx.fillRect(g.x - 1, g.y - 9 + o, 3, 1); ctx.fillRect(g.x, g.y - 10 + o, 1, 3); }
        }
        for (const [gx, gy] of [[sx, Y(63) - 5], [sx2, Y(98) - 5]]) if (tri(f, 36, gx) > .7) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(gx) - 2, gy, 5, 1); ctx.fillRect(Math.round(gx), gy - 2, 1, 5); }
        fog(ov, f, { y0: Y(150), y1: H, color: '#fff0fa', strength: .3, speed: .3, fade: 'mid', levels: 3 });
        ov.flush(ctx, 0, Y(150), W, H);
        ctx.drawImage(fgC, 0, 0);
        for (const [x, y, rad, col, per, ph] of gl) glowPulse(ov, x, y, rad, col, f, { per, ph, strength: .3, lo: .5 });
        ov.flush(ctx, 0, Y(120), W, H);
        drawMotes(ctx, motes, f);
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('city_magic', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: city_steampunk ===== */
/* Стимпанк-город: закатное небо, дирижабли, часовая башня с шестернями, дымящие трубы, пар, фонарь, латунный парапет.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, sunDisc, makeStars, drawStars, cloudRow, drawCloudRows,
    glowPulse, smokeColumn, gear, outward, bay, clamp, tri } = px;
  const r = mulberry32(97), xc = W / 2, TP = 2 * Math.PI;
  const sc = clamp(W / 128, .7, 1);
  const sunX = U(29), sunY = Y(124);

  /* ---------- небо и солнце за домами ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#100c2c', '#1a1240', '#2a1a4c', '#40244e', '#5c2e50', '#86443e', '#c8683a', '#f09440', '#ffb858'], 0, Y(130));
  addGlow(sky, sunX, sunY, 8, 46, '#ffa840', .65, 5, 1.5);
  sunDisc(sky, sunX, sunY, [[9, '#ffc060'], [7, '#ffd880']]);
  const skyC = sky.canvas();
  const stars = makeStars(r, Math.round(46 * W / 128), W, Y(68));
  const strips = [cloudRow({ sizes: [[34, 4], [32, 4], [36, 4]], seed: 5, cols: ['#b8704a', '#f0b068', '#7a4a58'], y: Ys(20), v: .14, gap: 88, off: 12 })];

  /* ---------- дирижабли ---------- */
  function airship(w, h, body, lit, shade, stripe, gond, win) {
    const L = new Layer(w + 16, h + 10), x0 = 12, x1 = x0 + w;
    L.ellipseBox(x0, 0, x1, h, body);
    for (let y = 0; y <= h; y++) for (let x = x0; x <= x1; x++) if (L.has(x, y)) { if (y < h * .28) L.px(x, y, lit); else if (y > h * .76) L.px(x, y, shade); }
    L.hline(x0 + 3, x1 - 3, Math.round(h * .56), stripe);
    L.poly([[0, Math.round(h * .08)], [x0 + 3, Math.round(h * .3)], [x0 + 3, Math.round(h * .72)], [Math.round(h * .3), Math.round(h * 1.0)]], shade);
    L.poly([[2, Math.round(h * .1)], [x0 + 3, Math.round(h * .32)], [x0 + 3, Math.round(h * .5)]], lit);
    const gx = x0 + Math.round(w * .42), gw = Math.max(6, Math.round(w * .24));
    L.rect(gx, h + 1, gx + gw, h + 4, gond); for (let k = 0; k < 3; k++) L.px(gx + 1 + k * 2, h + 2, win);
    return L.canvas();
  }
  const shipBig = airship(46, 17, '#b8643c', '#d88a50', '#8a4a38', '#f0b068', '#2a1828', '#f8c060');
  const shipFar = airship(28, 9, '#6a3c4c', '#7a4a58', '#4a2a44', '#8a5460', '#2a1828', '#a07050');
  const ships = [
    { c: shipBig, y: Ys(34), v: .42, x0: r() * (W + 120), m: 70 },
    { c: shipFar, y: Ys(78), v: .2, x0: r() * (W + 100), m: 50 },
    { c: shipFar, y: Ys(52), v: .14, x0: r() * (W + 100), m: 50 },
  ];

  /* ---------- дома, трубы, окна ---------- */
  const wins = [], chim = [];
  const WC = ['#f8b038', '#ffd060', '#e87828'];
  function building(L, x, w, top, base, body, edge, bright, rg) {
    L.rect(x, top, x + w, base, body); L.vline(x, top, base, edge); L.hline(x, x + w, top, edge);
    const cols = Math.max(1, Math.floor((w - 3) / 5)), rows = Math.floor((base - top - 8) / 8);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const wx = x + 3 + i * 5, wy = top + 5 + j * 8, c = pick(rg, WC), q = rg();
      if (!bright) { if (q < .3) L.rect(wx, wy, wx + 1, wy + 1, '#6a3c48'); continue; }
      if (q < .5) L.rect(wx, wy, wx + 2, wy + 2, c);
      else if (q < .66) wins.push([wx, wy, 3, 3, c, pick(rg, [60, 90, 150]), randint(rg, 0, 150)]);
    }
    if (bright) {
      L.vline(x + w - 2, top, base, '#a87a38'); for (let y = top + 6; y < base; y += 10) L.px(x + w - 2, y, '#e0b058');
      if (rg() < .55) { const hh = randint(rg, 9, 20); L.rect(x + 3, top - hh, x + 5, top, body); L.hline(x + 2, x + 6, top - hh, edge); chim.push([x + 4, top - hh, rg()]); }
    }
  }
  const city = new Layer(W, H), rg = mulberry32(12);
  for (let x = -6; x < W + 6;) {                                              // дальний рваный горизонт
    const w = randint(rg, 4, 10), h = randint(rg, 8, 26);
    city.rect(x, Y(150) - h, x + w, Y(160), '#5a3050'); if (rg() < .4) city.rect(x + 1, Y(150) - h - 6, x + 1, Y(150) - h, '#5a3050');
    x += w + randint(rg, 0, 2);
  }
  const back = new Layer(W, H);
  for (let x = -10; x < W + 6;) { const w = randint(rg, 12, 22), top = Y(randint(rg, 128, 146)); building(back, x, w, top, Y(190), '#3a2040', '#583650', false, rg); x += w + randint(rg, 0, 3); }
  const front = new Layer(W, H);
  const towerX = Math.round(U(-22)), gx1 = Math.round(U(30)), gx2 = Math.round(U(43)), lampX = Math.round(U(-42)), steamX = Math.round(U(6));
  for (let x = -8; x < W + 6;) {
    const w = randint(rg, 14, 24), top = Y(randint(rg, 112, 142));
    building(front, x, w, top, Y(190), '#241428', '#3e2438', true, rg); x += w + randint(rg, 0, 3);
  }
  // башня с часами рисуется поверх домов
  const tw = new Layer(W, H), cy = Y(92);
  tw.rect(towerX - 13, Y(76), towerX + 13, Y(188), '#2e1a34'); tw.vline(towerX - 13, Y(76), Y(188), '#52324a'); tw.vline(towerX + 13, Y(76), Y(188), '#1c1020');
  tw.poly([[towerX - 15, Y(76)], [towerX + 15, Y(76)], [towerX, Y(54)]], '#3a2038'); tw.poly([[towerX - 15, Y(76)], [towerX, Y(76)], [towerX, Y(54)]], '#4c2c48');
  tw.line(towerX - 15, Y(76), towerX, Y(54), '#7a4a58'); tw.vline(towerX, Y(54) - 7, Y(54), '#c08a40');
  for (const yy of [Y(110), Y(138), Y(166)]) { tw.rect(towerX - 14, yy, towerX + 14, yy + 2, '#e0a040'); tw.hline(towerX - 14, towerX + 14, yy, '#ffd070'); }
  tw.disc(towerX, cy, 10, '#e0a040'); tw.disc(towerX, cy, 8, '#f0e4c0'); tw.disc(towerX, cy, 7, '#e8d8b0');
  for (let k = 0; k < 12; k++) { const a = TP * k / 12; tw.px(Math.round(towerX + 6 * Math.sin(a)), Math.round(cy - 6 * Math.cos(a)), '#2a1828'); }
  tw.disc(towerX, cy, 1, '#2a1828');
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) if (r() < .7) {
    const wx = towerX - 10 + i * 6, wy = Y(142) + j * 8; if (wy > Y(164)) continue;
    const c = pick(r, WC); if (r() < .75) tw.rect(wx, wy, wx + 2, wy + 3, c); else wins.push([wx, wy, 3, 4, c, 90, randint(r, 0, 90)]);
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) if (r() < .65) { const wx = towerX - 10 + i * 6, wy = Y(170) + j * 6; if (wy < Y(186)) tw.rect(wx, wy, wx + 2, wy + 2, pick(r, WC)); }
  const cityC = city.canvas(), backC = back.canvas(), frontC = front.canvas(), twC = tw.canvas();

  /* ---------- шестерни, манометр, фонарь, парапет ---------- */
  const gears = [
    { x: towerX, y: Y(126), r: 9, t: 10, dir: 1, col: '#b07a30', hi: '#e0a848' },
    { x: towerX + 6, y: Y(141), r: 6, t: 8, dir: -1, col: '#a06a28', hi: '#d09838' },
    { x: gx1, y: Y(148), r: 12, t: 12, dir: 1, col: '#b07a30', hi: '#e0a848' },
    { x: gx2, y: Y(136), r: 8, t: 9, dir: -1, col: '#a06a28', hi: '#d09838' },
  ];
  const rx = mulberry32(29);
  for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 36, 64, rx)) { const rr = randint(rx, 6, 10); gears.push({ x: Math.round(U(u)), y: Y(randint(rx, 132, 160)), r: rr, t: rr + 2, dir: rx() < .5 ? 1 : -1, col: '#a06a28', hi: '#d09838' }); }
  gears.forEach(g => { g.c = g.r + 5; g.spr = new Layer(2 * g.c + 1, 2 * g.c + 1); g.sp = TP / (g.t * 36); });
  const gaugeX = gx1, gaugeY = Y(172);
  const gauge = new Layer(17, 17);
  gauge.disc(8, 8, 7, '#c08a40'); gauge.disc(8, 8, 6, '#f0e4c0'); for (let k = 0; k < 8; k++) { const a = TP * k / 8; gauge.px(Math.round(8 + 4.5 * Math.sin(a)), Math.round(8 - 4.5 * Math.cos(a)), '#7a4a38'); }
  const gaugeBase = gauge.canvas(), needle = new Layer(17, 17);
  const handL = new Layer(23, 23), hx = towerX, hy = cy;
  const fgL = new Layer(W, H);
  fgL.rect(0, Y(184), W, H, '#1c1020'); fgL.rect(0, Y(184), W, Y(186), '#e0a040'); fgL.hline(0, W, Y(184), '#ffd070'); fgL.hline(0, W, Y(186) + 1, '#8a5a28');
  for (let x = 6; x < W; x += 22) { fgL.rect(x, Y(182), x + 3, Y(197), '#c88a30'); fgL.vline(x, Y(182), Y(197), '#f0b858'); fgL.rect(x - 1, Y(182), x + 4, Y(183), '#e0a040'); }
  fgL.rect(lampX, Y(133), lampX + 1, Y(184), '#1c1020'); fgL.rect(lampX - 3, Y(124), lampX + 4, Y(133), '#1c1020');
  fgL.rect(lampX - 2, Y(125), lampX + 3, Y(132), '#ffe0a0'); fgL.rect(lampX - 2, Y(125), lampX - 2, Y(132), '#ffc060'); fgL.poly([[lampX - 4, Y(124)], [lampX + 5, Y(124)], [lampX, Y(119)]], '#1c1020');
  const fgC = fgL.canvas();
  const ov = new Overlay(W, H);
  const smokes = chim.map(c => ({ x: c[0], y: c[1] - 1, ph: Math.floor(c[2] * 150), per: 140 + Math.floor(c[2] * 40) }));
  const tmpCols = ['#6a4268', '#523250', '#3e2440'];

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      drawCloudRows(ctx, strips, f, W);
      for (const s of ships) { const P = W + 2 * s.m, x = Math.floor(((s.x0 + s.v * f) % P + P) % P) - s.m; ctx.drawImage(s.c, x, s.y); }
      ctx.drawImage(cityC, 0, 0);
      ctx.drawImage(backC, 0, 0);
      ctx.drawImage(frontC, 0, 0);
      for (const sm of smokes) smokeColumn(ctx, sm.x, sm.y, f + sm.ph, { n: 5, rise: 42, per: sm.per, sway: 2, r0: 1, r1: 4.5, wind: 12, cols: tmpCols });
      ctx.drawImage(twC, 0, 0);
      for (const [x, y, w, h, c, per, ph] of wins) if (tri(f, per, ph) > .14) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
      // шарик на шпиле башни мигает
      if (tri(f, 80, 0) > .6) { ctx.fillStyle = '#ffd870'; ctx.fillRect(towerX - 1, Y(54) - 10, 3, 3); ctx.fillStyle = '#fff0b0'; ctx.fillRect(towerX, Y(54) - 9, 1, 1); }
      else { ctx.fillStyle = '#c08a40'; ctx.fillRect(towerX - 1, Y(54) - 9, 2, 2); }
      // стрелки часов
      handL.clear();
      const am = TP * f / 600 - Math.PI / 2, ah = TP * f / 7200 - Math.PI / 2;
      handL.line(11, 11, Math.round(11 + 6 * Math.cos(am)), Math.round(11 + 6 * Math.sin(am)), '#2a1828');
      handL.line(11, 11, Math.round(11 + 4 * Math.cos(ah)), Math.round(11 + 4 * Math.sin(ah)), '#2a1828');
      handL.draw(ctx, hx - 11, hy - 11);
      for (const g of gears) {
        g.spr.clear(); gear(g.spr, g.c, g.c, g.r, g.t, g.dir * g.sp * f, g.col, { hi: g.hi, hub: '#e0b058', spokes: 6 }); g.spr.draw(ctx, g.x - g.c, g.y - g.c);
      }
      // манометр: стрелка качается
      ctx.drawImage(gaugeBase, gaugeX - 8, gaugeY - 8);
      needle.clear(); const na = -2.3 + 1.6 * (.5 + .5 * Math.sin(TP * f / 90));
      needle.line(8, 8, Math.round(8 + 5 * Math.sin(na)), Math.round(8 - 5 * Math.cos(na)), '#d02828'); needle.draw(ctx, gaugeX - 8, gaugeY - 8);
      // пар из клапана
      smokeColumn(ctx, steamX, Y(178), f, { n: 5, rise: 26, per: 70, sway: 1.5, r0: 1, r1: 3.5, wind: 2, cols: ['#f0e4dc', '#c8b8b0', '#8a7a82'] });
      ctx.drawImage(fgC, 0, 0);
      glowPulse(ov, lampX, Y(128), 15, '#ffa840', f, { per: 80, strength: .6, lo: .6 });
      ov.flush(ctx, Math.max(0, lampX - 17), Y(110), Math.min(W, lampX + 18), Y(148));
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, sunDisc, cloudRow, drawCloudRows,
      smokeColumn, gear, outward, drawBird, bay, clamp, tri } = px;
    const r = mulberry32(97), xc = W / 2, TP = 2 * Math.PI;
    const sunX = U(29), sunY = Ys(46);

    /* ---------- небо: тёплая золотистая дымка ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#6c92bc', '#8aa8c4', '#aebcc0', '#d0c8a8', '#ecd2a0', '#f8dc98', '#fce4aa'], 0, Y(130));
    addGlow(sky, sunX, sunY, 8, 70, '#fff0c0', .75, 5, 1.5);
    addGlow(sky, sunX, sunY, 8, 120, '#ffe8b0', .3, 4, 1.8);
    sunDisc(sky, sunX, sunY, [[8, '#fff0b8'], [6, '#fff8dc'], [4, '#ffffff']]);
    const skyC = sky.canvas();
    const strips = [
      cloudRow({ sizes: [[44, 9], [36, 8], [48, 10]], seed: 5, cols: ['#f6ecdc', '#c8b494', '#fff8ec'], y: Ys(18), v: .16, gap: 100, off: 12 }),
      cloudRow({ sizes: [[34, 7], [40, 8]], seed: 14, cols: ['#f2e6d2', '#c4ae90', '#fff8ec'], y: Ys(64), v: .22, gap: 110, off: 50 }),
    ];
    const pigeons = [[.34, Ys(40), 0], [.28, Ys(56), 3], [.4, Ys(48), 5]].map(([v, y, i]) => ({ v, y, i, x0: r() * (W + 60) }));

    /* ---------- дирижабли ---------- */
    function airship(w, h, body, lit, shade, stripe, gond, win) {
      const L = new Layer(w + 16, h + 10), x0 = 12, x1 = x0 + w;
      L.ellipseBox(x0, 0, x1, h, body);
      for (let y = 0; y <= h; y++) for (let x = x0; x <= x1; x++) if (L.has(x, y)) { if (y < h * .28) L.px(x, y, lit); else if (y > h * .76) L.px(x, y, shade); }
      L.hline(x0 + 3, x1 - 3, Math.round(h * .56), stripe);
      L.poly([[0, Math.round(h * .08)], [x0 + 3, Math.round(h * .3)], [x0 + 3, Math.round(h * .72)], [Math.round(h * .3), Math.round(h * 1.0)]], shade);
      L.poly([[2, Math.round(h * .1)], [x0 + 3, Math.round(h * .32)], [x0 + 3, Math.round(h * .5)]], lit);
      const gx = x0 + Math.round(w * .42), gw = Math.max(6, Math.round(w * .24));
      L.rect(gx, h + 1, gx + gw, h + 4, gond); for (let k = 0; k < 3; k++) L.px(gx + 1 + k * 2, h + 2, win);
      return L.canvas();
    }
    const shipBig = airship(46, 17, '#c47446', '#e8a468', '#8a5038', '#f8dc98', '#4a3430', '#f8e0a0');
    const shipFar = airship(28, 9, '#a88468', '#bc9a7c', '#8a6a58', '#d8c098', '#5a4640', '#d8c098');
    const ships = [
      { c: shipBig, y: Ys(34), v: .42, x0: r() * (W + 120), m: 70 },
      { c: shipFar, y: Ys(78), v: .2, x0: r() * (W + 100), m: 50 },
      { c: shipFar, y: Ys(52), v: .14, x0: r() * (W + 100), m: 50 },
    ];

    /* ---------- дома, трубы, окна ---------- */
    const wins = [], chim = [];
    const WC = ['#8ab4d0', '#a8cce0', '#e8d8a0'];
    function building(L, x, w, top, base, body, edge, bright, rg) {
      L.rect(x, top, x + w, base, body); L.vline(x, top, base, edge); L.hline(x, x + w, top, edge);
      const cols = Math.max(1, Math.floor((w - 3) / 5)), rows = Math.floor((base - top - 8) / 8);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const wx = x + 3 + i * 5, wy = top + 5 + j * 8, c = pick(rg, WC), q = rg();
        if (!bright) { if (q < .3) L.rect(wx, wy, wx + 1, wy + 1, '#b8c4c8'); continue; }
        if (q < .5) L.rect(wx, wy, wx + 2, wy + 2, c);
        else if (q < .66) wins.push([wx, wy, 3, 3, c, pick(rg, [60, 90, 150]), randint(rg, 0, 150)]);
      }
      if (bright) {
        L.vline(x + w - 2, top, base, '#d0a038'); for (let y = top + 6; y < base; y += 10) L.px(x + w - 2, y, '#ffe090');
        if (rg() < .55) { const hh = randint(rg, 9, 20); L.rect(x + 3, top - hh, x + 5, top, body); L.hline(x + 2, x + 6, top - hh, edge); chim.push([x + 4, top - hh, rg()]); }
      }
    }
    const city = new Layer(W, H), rg = mulberry32(12);
    for (let x = -6; x < W + 6;) {
      const w = randint(rg, 4, 10), h = randint(rg, 8, 26);
      city.rect(x, Y(150) - h, x + w, Y(160), '#c0a894'); if (rg() < .4) city.rect(x + 1, Y(150) - h - 6, x + 1, Y(150) - h, '#c0a894');
      x += w + randint(rg, 0, 2);
    }
    const back = new Layer(W, H);
    for (let x = -10; x < W + 6;) { const w = randint(rg, 12, 22), top = Y(randint(rg, 128, 146)); building(back, x, w, top, Y(190), '#9a8272', '#c0a48e', false, rg); x += w + randint(rg, 0, 3); }
    const front = new Layer(W, H);
    const towerX = Math.round(U(-22)), gx1 = Math.round(U(30)), gx2 = Math.round(U(43)), lampX = Math.round(U(-42)), steamX = Math.round(U(6));
    for (let x = -8; x < W + 6;) {
      const w = randint(rg, 14, 24), top = Y(randint(rg, 112, 142));
      building(front, x, w, top, Y(190), '#74544c', '#b08a72', true, rg); x += w + randint(rg, 0, 3);
    }
    const tw = new Layer(W, H), cy = Y(92);
    tw.rect(towerX - 13, Y(76), towerX + 13, Y(188), '#82605a'); tw.vline(towerX - 13, Y(76), Y(188), '#c8a284'); tw.vline(towerX + 13, Y(76), Y(188), '#52403a');
    tw.poly([[towerX - 15, Y(76)], [towerX + 15, Y(76)], [towerX, Y(54)]], '#5a8a74'); tw.poly([[towerX - 15, Y(76)], [towerX, Y(76)], [towerX, Y(54)]], '#78aa90');
    tw.line(towerX - 15, Y(76), towerX, Y(54), '#b0d8c0'); tw.vline(towerX, Y(54) - 7, Y(54), '#e0a840');
    for (const yy of [Y(110), Y(138), Y(166)]) { tw.rect(towerX - 14, yy, towerX + 14, yy + 2, '#e8b040'); tw.hline(towerX - 14, towerX + 14, yy, '#ffe090'); }
    tw.disc(towerX, cy, 10, '#e8b040'); tw.disc(towerX, cy, 8, '#f8f0d8'); tw.disc(towerX, cy, 7, '#f0e6c8');
    for (let k = 0; k < 12; k++) { const a = TP * k / 12; tw.px(Math.round(towerX + 6 * Math.sin(a)), Math.round(cy - 6 * Math.cos(a)), '#4a3430'); }
    tw.disc(towerX, cy, 1, '#4a3430');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) if (r() < .7) {
      const wx = towerX - 10 + i * 6, wy = Y(142) + j * 8; if (wy > Y(164)) continue;
      const c = pick(r, WC); if (r() < .75) tw.rect(wx, wy, wx + 2, wy + 3, c); else wins.push([wx, wy, 3, 4, c, 90, randint(r, 0, 90)]);
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) if (r() < .65) { const wx = towerX - 10 + i * 6, wy = Y(170) + j * 6; if (wy < Y(186)) tw.rect(wx, wy, wx + 2, wy + 2, pick(r, WC)); }
    const cityC = city.canvas(), backC = back.canvas(), frontC = front.canvas(), twC = tw.canvas();

    /* ---------- шестерни, манометр, фонарь, парапет ---------- */
    const gears = [
      { x: towerX, y: Y(126), r: 9, t: 10, dir: 1, col: '#d09a38', hi: '#ffe090' },
      { x: towerX + 6, y: Y(141), r: 6, t: 8, dir: -1, col: '#c08a30', hi: '#f0c868' },
      { x: gx1, y: Y(148), r: 12, t: 12, dir: 1, col: '#d09a38', hi: '#ffe090' },
      { x: gx2, y: Y(136), r: 8, t: 9, dir: -1, col: '#c08a30', hi: '#f0c868' },
    ];
    const rx = mulberry32(29);
    for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 36, 64, rx)) { const rr = randint(rx, 6, 10); gears.push({ x: Math.round(U(u)), y: Y(randint(rx, 132, 160)), r: rr, t: rr + 2, dir: rx() < .5 ? 1 : -1, col: '#c08a30', hi: '#f0c868' }); }
    gears.forEach(g => { g.c = g.r + 5; g.spr = new Layer(2 * g.c + 1, 2 * g.c + 1); g.sp = TP / (g.t * 36); });
    const gaugeX = gx1, gaugeY = Y(172);
    const gauge = new Layer(17, 17);
    gauge.disc(8, 8, 7, '#e0a840'); gauge.disc(8, 8, 6, '#f8f0d8'); for (let k = 0; k < 8; k++) { const a = TP * k / 8; gauge.px(Math.round(8 + 4.5 * Math.sin(a)), Math.round(8 - 4.5 * Math.cos(a)), '#7a4a38'); }
    const gaugeBase = gauge.canvas(), needle = new Layer(17, 17);
    const handL = new Layer(23, 23), hx = towerX, hy = cy;
    const fgL = new Layer(W, H);
    fgL.rect(0, Y(184), W, H, '#4a3430'); fgL.rect(0, Y(184), W, Y(186), '#e8b040'); fgL.hline(0, W, Y(184), '#ffe090'); fgL.hline(0, W, Y(186) + 1, '#a87028');
    for (let x = 6; x < W; x += 22) { fgL.rect(x, Y(182), x + 3, Y(197), '#d09a38'); fgL.vline(x, Y(182), Y(197), '#ffd870'); fgL.rect(x - 1, Y(182), x + 4, Y(183), '#e8b040'); }
    fgL.rect(lampX, Y(133), lampX + 1, Y(184), '#3a2a28'); fgL.rect(lampX - 3, Y(124), lampX + 4, Y(133), '#3a2a28');
    fgL.rect(lampX - 2, Y(125), lampX + 3, Y(132), '#c8dce4'); fgL.rect(lampX - 2, Y(125), lampX - 2, Y(132), '#f0f8fc'); fgL.poly([[lampX - 4, Y(124)], [lampX + 5, Y(124)], [lampX, Y(119)]], '#3a2a28');
    const fgC = fgL.canvas();
    const smokes = chim.map(c => ({ x: c[0], y: c[1] - 1, ph: Math.floor(c[2] * 150), per: 140 + Math.floor(c[2] * 40) }));
    const smokeCols = ['#d4c4b4', '#b4a498', '#948480'];

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, strips, f, W);
        for (const b of pigeons) { const x = Math.floor(((b.x0 + b.v * f) % (W + 60) + W + 60) % (W + 60)) - 30; drawBird(ctx, x, b.y + Math.round(1.5 * Math.sin(f / 20 + b.i)), (((f >> 2) + b.i) & 1) === 1, '#4a3a38'); }
        for (const s of ships) { const P = W + 2 * s.m, x = Math.floor(((s.x0 + s.v * f) % P + P) % P) - s.m; ctx.drawImage(s.c, x, s.y); }
        ctx.drawImage(cityC, 0, 0);
        ctx.drawImage(backC, 0, 0);
        ctx.drawImage(frontC, 0, 0);
        for (const sm of smokes) smokeColumn(ctx, sm.x, sm.y, f + sm.ph, { n: 5, rise: 42, per: sm.per, sway: 2, r0: 1, r1: 4.5, wind: 12, cols: smokeCols });
        ctx.drawImage(twC, 0, 0);
        for (const [x, y, w, h, c, per, ph] of wins) { ctx.fillStyle = tri(f, per, ph) > .93 ? '#ffffff' : c; ctx.fillRect(x, y, w, h); }
        if (tri(f, 80, 0) > .6) { ctx.fillStyle = '#ffe890'; ctx.fillRect(towerX - 1, Y(54) - 10, 3, 3); ctx.fillStyle = '#ffffff'; ctx.fillRect(towerX, Y(54) - 9, 1, 1); }
        else { ctx.fillStyle = '#e0a840'; ctx.fillRect(towerX - 1, Y(54) - 9, 2, 2); }
        handL.clear();
        const am = TP * f / 600 - Math.PI / 2, ah = TP * f / 7200 - Math.PI / 2;
        handL.line(11, 11, Math.round(11 + 6 * Math.cos(am)), Math.round(11 + 6 * Math.sin(am)), '#3a2a28');
        handL.line(11, 11, Math.round(11 + 4 * Math.cos(ah)), Math.round(11 + 4 * Math.sin(ah)), '#3a2a28');
        handL.draw(ctx, hx - 11, hy - 11);
        for (const g of gears) { g.spr.clear(); gear(g.spr, g.c, g.c, g.r, g.t, g.dir * g.sp * f, g.col, { hi: g.hi, hub: '#ffe090', spokes: 6 }); g.spr.draw(ctx, g.x - g.c, g.y - g.c); }
        ctx.drawImage(gaugeBase, gaugeX - 8, gaugeY - 8);
        needle.clear(); const na = -2.3 + 1.6 * (.5 + .5 * Math.sin(TP * f / 90));
        needle.line(8, 8, Math.round(8 + 5 * Math.sin(na)), Math.round(8 - 5 * Math.cos(na)), '#d02828'); needle.draw(ctx, gaugeX - 8, gaugeY - 8);
        smokeColumn(ctx, steamX, Y(178), f, { n: 5, rise: 26, per: 70, sway: 1.5, r0: 1, r1: 3.5, wind: 2, cols: ['#ffffff', '#ece4dc', '#c8bcb4'] });
        ctx.drawImage(fgC, 0, 0);
        if (tri(f, 50, 10) > .85) { ctx.fillStyle = '#ffffff'; ctx.fillRect(lampX - 1, Y(127), 2, 2); }
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('city_steampunk', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();

;/* ===== локация: city_hybrid ===== */
/* Город магии и стимпанка: месяц, сияние, часовая башня с кристаллом, дирижабль с кристальным двигателем,
 * остров с шестернёй, медные трубы с бегущей энергией, шпили с кристаллами, большая шестерня и кристаллы впереди.
 * Два варианта: buildNight (вечер/ночь) и buildDay (день); выбор по env.variant. */
(function () {
  function buildNight(env) {
  const { W, H, Y, Ys, U, limit, px } = env;
  const { C, Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, moonSprite, makeStars, drawStars, makeSparkles, drawSparkles,
    makeMotes, drawMotes, cloudRow, drawCloudRows, glowPulse, fog, crystalGem, gear, pine, outward, bay, clamp, tri } = px;
  const r = mulberry32(101), xc = W / 2, TP = 2 * Math.PI;
  const sc = clamp(W / 128, .7, 1), S1 = n => Math.round(n * sc);
  const moonX = U(32), moonY = Ys(30);

  /* ---------- небо, месяц, сияние ---------- */
  const sky = new Layer(W, H);
  gradient(sky, ['#0a0830', '#140f48', '#1e1262', '#2a1a78', '#36228a', '#40298e', '#4a2e92'], 0, Y(150));
  addGlow(sky, moonX, moonY, 10, 44, '#8a80e8', .45, 5, 1.6);
  const skyC = sky.canvas();
  const moon = moonSprite(9, ['#c8c0f4', '#f0ecff', '#ffffff'], true);
  const stars = makeStars(r, Math.round(74 * W / 128), W, Y(118), { avoid: (x, y) => Math.hypot(x - moonX, y - moonY) < 14 });
  const spark = makeSparkles(r, Math.round(4 * W / 128) + 1, W, Ys(8), Ys(70));
  const ribbons = [
    { yc: Ys(36), amp: Ys(8), kx: .6, ke: .5, sk: .5, wid: Ys(18), strength: .55, color: '#38d8b8', ph: 1.2 },
    { yc: Ys(22), amp: Ys(8), kx: .9, ke: .6, sk: -.45, wid: Ys(18), strength: .45, color: '#9a6cff', ph: 3.0 },
  ];
  const aurH = Ys(70), ovA = new Overlay(W, H);
  const LUT = new Float32Array(257);
  for (let i = 0; i <= 256; i++) { const u = -.8 + 3.8 * i / 256; LUT[i] = u >= 0 ? Math.exp(-u * 1.3) : Math.exp(-(u * 3.5) * (u * 3.5)); }
  const ribCols = ribbons.map(rb => C(rb.color));
  function auroraDraw(f) {
    ribbons.forEach((rb, k) => {
      const col = ribCols[k];
      for (let x = 0; x < W; x++) {
        const xr = (x - xc) / 128, th = TP * (rb.kx * xr + rb.sk * f / 120) + rb.ph;
        const cy = rb.yc + rb.amp * Math.sin(th) + .45 * rb.amp * Math.sin(2 * th + 1.3);
        const en = .35 + .65 * (.5 + .5 * Math.sin(TP * (rb.ke * xr + rb.sk * f / 120) + rb.ph * 1.7));
        const k0 = rb.strength * en * (.8 + .2 * Math.sin(TP * (18 * xr + rb.sk * f / 120)));
        for (let y = Math.max(0, Math.floor(cy - 3 * rb.wid)); y < Math.min(aurH, Math.ceil(cy + .8 * rb.wid)); y++) {
          const a = k0 * LUT[(((cy - y) / rb.wid + .8) * 256 / 3.8) | 0];
          if (a < .03) continue;
          const q = Math.floor(a * 4 + bay(x, y)) / 4;
          if (q > 0) ovA.over(x, y, col, q > 1 ? 1 : q);
        }
      }
    });
  }
  const strips = [cloudRow({ sizes: [[60, 3], [44, 3]], seed: 9, cols: ['#8a48a8', '#e070c8', '#b058b8'], y: Y(104), v: .12, gap: 150, off: 70 }),
    cloudRow({ sizes: [[50, 3], [38, 3]], seed: 21, cols: ['#703a9c', '#c85cb8', '#9a4cb0'], y: Y(122), v: .16, gap: 130, off: 10 })];

  /* ---------- остров с башней и шестернёй под ним ---------- */
  const wins = [], WC = ['#60f0ff', '#ffd070', '#9af8ff'];
  const isl = new Layer(W, H), ri = mulberry32(17);
  function island(L, cx, y, w, depth, tH, trees) {
    const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
    L.poly([[x0, y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#3a2c8a');
    L.poly([[Math.round(cx), y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#261c64');
    L.line(x0, y + 4, Math.round(cx) + 2, y + 4 + depth, '#6a5cc8');
    L.rect(x0, y, x1, y + 3, '#2aa884'); L.hline(x0, x1, y, '#58e0b0'); L.hline(x0, x1, y + 3, '#1a7a68');
    for (const t of trees) pine(L, Math.round(cx + t[0]), y, t[1], '#1a8a6a', '#3ad0a0', 7, 3);
    if (tH) {
      const bx = Math.round(cx + 2);
      L.rect(bx - 3, y - tH, bx + 3, y, '#463496'); L.vline(bx - 3, y - tH, y, '#6a58c0'); L.vline(bx + 3, y - tH, y, '#32246e');
      L.poly([[bx - 5, y - tH], [bx + 5, y - tH], [bx, y - tH - 10]], '#5a3aa8'); L.poly([[bx - 5, y - tH], [bx, y - tH], [bx, y - tH - 10]], '#6c4cbc');
      crystalGem(L, bx, y - tH - 10, '#c0f8ff', '#40d8f0', '#2090c0', 6, 3);
      L.rect(bx - 1, y - tH + 6, bx, y - tH + 8, '#60f0ff'); L.px(bx + 1, y - tH + 11, '#ffd070');
    }
  }
  const il = Math.round(U(-30)), iyl = Y(100);
  island(isl, il, iyl, S1(46) + 4, 20, 24, [[-16, 11], [-11, 8], [14, 9]]);
  for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 44, 80, ri)) island(isl, Math.round(U(u)), Y(randint(ri, 60, 126)), randint(ri, 16, 26), randint(ri, 8, 14), ri() < .5 ? randint(ri, 10, 18) : 0, [[-4, randint(ri, 6, 9)]]);
  const islC = isl.canvas();

  /* ---------- силуэты шпилей с медными кольцами ---------- */
  function spireRow(base, hmin, hmax, step, body, roof, edge, seed, bright) {
    const L = new Layer(W, H), rg = mulberry32(seed);
    for (let x = -8; x < W + 10; x += randint(rg, step[0], step[1])) {
      const w = randint(rg, 8, 14), h = randint(rg, hmin, hmax), top = base - h, xx = Math.round(x);
      L.rect(xx - (w >> 1), top, xx + (w >> 1), base + 20, body);
      L.poly([[xx - (w >> 1) - 1, top], [xx + (w >> 1) + 1, top], [xx + Math.round((rg() - .5) * 2), top - randint(rg, 12, 26)]], roof);
      L.vline(xx - (w >> 1), top, base, edge);
      if (bright) {
        for (let y = top + 8; y < base; y += randint(rg, 12, 18)) L.hline(xx - (w >> 1), xx + (w >> 1), y, '#c88a30');
        for (let k = 0; k < Math.floor(h / 10); k++) if (rg() < .45) wins.push([xx - 1 + (rg() < .5 ? -2 : 1), top + 5 + k * 9, randint(rg, 0, 2), pick(rg, [60, 90, 120, 180]), randint(rg, 0, 120)]);
      }
    }
    return L.canvas();
  }
  const farC = spireRow(Y(176), 24, 54, [8, 14], '#2e2282', '#382a92', '#4a3ca8', 4, false);
  const midC = spireRow(Y(190), 30, 62, [10, 17], '#231a6c', '#2c2282', '#40349a', 9, true);

  /* ---------- башня с часами и кристаллом ---------- */
  const tx = Math.round(U(18)), cyc = Y(93), tw = new Layer(W, H);
  tw.rect(tx - 10, Y(77), tx + 10, Y(205), '#241a78'); tw.vline(tx - 10, Y(77), Y(205), '#4a3ab0'); tw.vline(tx + 10, Y(77), Y(205), '#18104e');
  tw.poly([[tx - 12, Y(77)], [tx + 12, Y(77)], [tx, Y(60)]], '#3a2a98'); tw.poly([[tx - 12, Y(77)], [tx, Y(77)], [tx, Y(60)]], '#4a38aa'); tw.line(tx - 12, Y(77), tx, Y(60), '#6a58cc');
  tw.vline(tx, Y(55), Y(60), '#d8a040');
  crystalGem(tw, tx, Y(56), '#d0ffff', '#40d8f0', '#2090c8', 14, 5);
  for (const yy of [Y(109), Y(137), Y(165)]) { tw.rect(tx - 11, yy, tx + 11, yy + 2, '#d8a040'); tw.hline(tx - 11, tx + 11, yy, '#f8c860'); }
  tw.disc(tx, cyc, 9, '#e09838'); tw.disc(tx, cyc, 7, '#14104a'); tw.disc(tx, cyc, 6, '#1c1660');
  for (let k = 0; k < 12; k++) { const a = TP * k / 12; tw.px(Math.round(tx + 5 * Math.sin(a)), Math.round(cyc - 5 * Math.cos(a)), '#6a60c0'); }
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) if (r() < .45) { const wx = tx - 6 + i * 6, wy = Y(141) + j * 6; if (wy < Y(162)) wins.push([wx, wy, 0, pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
  for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (r() < .5) { const wx = tx - 6 + i * 6, wy = Y(170) + j * 7; wins.push([wx, wy, randint(r, 0, 2), pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
  const twC = tw.canvas();

  /* ---------- трубы с бегущей энергией ---------- */
  const pipes = new Layer(W, H), paths = [], joints = [];
  function pipe(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      pipes.rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1) + (y0 === y1 ? 0 : 1), Math.max(y0, y1) + (y0 === y1 ? 1 : 0), '#d8a040');
      pipes.line(x0, y0, x1, y1, '#f8c860');
    }
    for (const [x, y] of pts) { pipes.disc(x, y, 2, '#b87a30'); pipes.px(x, y, '#ffd070'); joints.push([x, y]); }
    const pt = []; let len = 0;
    for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k < n; k++) pt.push([x0 + Math.round((x1 - x0) * k / n), y0 + Math.round((y1 - y0) * k / n)]); }
    paths.push({ pt, sp: .9 + r() * .5, off: randint(r, 0, 90) });
  }
  const px0 = n => Math.round(U(n));
  pipe([[px0(-64), Y(160)], [px0(-24), Y(160)], [px0(-24), Y(143)], [tx - 11, Y(143)]]);
  pipe([[tx + 11, Y(151)], [px0(40), Y(151)], [px0(40), Y(168)]]);
  const rp = mulberry32(70);
  for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 40, 70, rp)) { const x0 = px0(u), len = randint(rp, 18, 36) * (rp() < .5 ? 1 : -1), y0 = Y(randint(rp, 148, 168)); pipe([[x0, y0], [x0 + len, y0], [x0 + len, y0 + randint(rp, 8, 16)]]); }
  const pipesC = pipes.canvas();

  /* ---------- шестерни, дирижабль, парящие камни ---------- */
  const gears = [
    { x: tx, y: Y(123), r: 8, t: 10, dir: 1, col: '#b87a30', hi: '#e8b050' },
    { x: il - 12, y: iyl + 12, r: 10, t: 10, dir: -1, col: '#b07230', hi: '#e0a848' },
    { x: S1(8), y: H + 4 - S1(0), r: 22, t: 14, dir: 1, col: '#6a4a28', hi: '#a07038' },
  ];
  gears.forEach(g => { g.c = g.r + 5; g.spr = new Layer(2 * g.c + 1, 2 * g.c + 1); g.sp = TP / (g.t * 40); });
  const ship = (() => {
    const L = new Layer(70, 40), x0 = 6, x1 = 64, h = 16, oy = 12;
    L.ellipseBox(x0, oy, x1, oy + h, '#34447c');
    for (let y = oy; y <= oy + h; y++) for (let x = x0; x <= x1; x++) if (L.has(x, y)) { if (y < oy + h * .3) L.px(x, y, '#4a5c9c'); else if (y > oy + h * .78) L.px(x, y, '#26346a'); }
    L.hline(x0 + 5, x1 - 5, oy + Math.round(h * .62), '#d8a040');
    L.poly([[0, oy + 2], [x0 + 6, oy + 5], [x0 + 6, oy + 12], [4, oy + h + 2]], '#26346a');
    L.poly([[30, oy + 1], [40, oy + 1], [35, oy - 11]], '#f060b0'); L.poly([[30, oy + 1], [35, oy + 1], [35, oy - 11]], '#ff90d0');
    L.vline(35, oy + h + 1, oy + h + 6, '#d8a040'); L.px(35, oy + h + 8, '#d0ffff'); L.px(34, oy + h + 8, '#40d8f0'); L.px(36, oy + h + 8, '#40d8f0'); L.px(35, oy + h + 7, '#40d8f0'); L.px(35, oy + h + 9, '#2090c8');
    return L.canvas();
  })();
  const shipY = Ys(48), shipV = .3, shipM = 90, r0 = r() * (W + 2 * shipM);
  const gemSpr = {
    pink: (() => { const L = new Layer(7, 11); crystalGem(L, 3, 10, '#ffd0f4', '#ff70d0', '#b83098', 9, 2); return L.canvas(); })(),
    cyan: (() => { const L = new Layer(7, 11); crystalGem(L, 3, 10, '#d8ffff', '#50e0ff', '#2090c8', 9, 2); return L.canvas(); })(),
  };
  const floaters = [[-58, 122, 'pink', 0], [-29, 123, 'pink', .3], [-21, 127, 'cyan', .55], [-11, 110, 'pink', .8], [4, 127, 'pink', .15], [33, 94, 'cyan', .4], [43, 113, 'pink', .65], [53, 110, 'cyan', .9]]
    .map(([u, y, c, ph]) => ({ x: U(u), y: Y(y), c, ph, rx: 2 + (ph * 10 | 0) % 3, ry: 2 }));
  for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 20, 44, ri)) floaters.push({ x: U(u), y: Y(randint(ri, 100, 150)), c: ri() < .5 ? 'pink' : 'cyan', ph: ri(), rx: 3, ry: 2 });

  /* ---------- передний план ---------- */
  const fg = new Layer(W, H), dark = '#0a0624';
  fg.poly([[W + 2, H + 2], [W + 2, Y(168)], [W - S1(16), Y(176)], [W - S1(32), H + 2]], dark);
  const CY = ['#8aecff', '#30b0e0', '#1a68b0'], PK = ['#ffa8e4', '#e050c0', '#9c2890'];
  function big(x, base, h, w, c) {
    x = Math.round(x); base = Math.round(base);
    fg.poly([[x - (w >> 1), base], [x - (w >> 1), base - h * .78], [x, base - h], [x, base]], c[1]);
    fg.poly([[x, base], [x, base - h], [x + (w >> 1), base - h * .78], [x + (w >> 1), base]], c[2]);
    fg.vline(x - (w >> 1) + 1, base - h * .7, base - 3, c[0]); fg.line(x - (w >> 1), Math.round(base - h * .78), x, Math.round(base - h), c[0]);
  }
  const gl = [], rgl = mulberry32(44), bxr = W - S1(14), bb = H + 2;
  big(bxr - 4, bb, S1(36), S1(9), PK); big(bxr - 18, bb, S1(14), S1(7), CY); big(bxr + 6, bb, S1(18), S1(7), CY);
  gl.push([bxr - 4, bb - S1(20), 22, '#ff60d8', 80, 25], [bxr - 18, bb - S1(8), 14, '#40d0ff', 70, 0]);
  for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 30, 60, rgl)) {
    if (d < 0 && u > -40) continue;
    const c = rgl() < .5 ? CY : PK, h = randint(rgl, 14, 32);
    fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], dark);
    big(U(u), Y(randint(rgl, 198, 204)), h, Math.round(h * .28) + 3, c); gl.push([U(u), Y(190) - h * .4, 14, c === CY ? '#40d0ff' : '#ff60d8', randint(rgl, 60, 90), randint(rgl, 0, 60)]);
  }
  const fgC = fg.canvas();
  const motes = makeMotes(r, Math.round(44 * W / 128), W, { y0: Y(70), y1: Y(190), colors: ['#60f0ff', '#ff80e0', '#ffd070', '#c0a8ff'], rise: .18, amp: [2, 5], big: .2 });
  const ov = new Overlay(W, H);
  const crown = [tx, Y(48)];

  return {
    draw(ctx, f) {
      ctx.drawImage(skyC, 0, 0);
      drawStars(ctx, stars, f);
      drawSparkles(ctx, spark, f, '#ffffff');
      ctx.drawImage(moon, moonX - (moon.width >> 1), moonY - (moon.height >> 1));
      auroraDraw(f); ovA.flush(ctx, 0, 0, W, aurH);
      // дирижабль
      const P = W + 2 * shipM, sx = Math.floor(((r0 + shipV * f) % P + P) % P) - shipM;
      ctx.drawImage(ship, sx, shipY);
      glowPulse(ov, sx + 35, shipY + 29, 9, '#40e8ff', f, { per: 40, strength: .8, lo: .5 });
      ov.flush(ctx, Math.max(0, sx + 24), shipY + 20, Math.min(W, sx + 47), shipY + 40);
      ctx.drawImage(islC, 0, 0);
      drawCloudRows(ctx, strips, f, W);
      ctx.drawImage(farC, 0, 0);
      ctx.drawImage(midC, 0, 0);
      ctx.drawImage(pipesC, 0, 0);
      ctx.drawImage(twC, 0, 0);
      // кристалл на башне: искры энергии вокруг
      for (let k = 0; k < 4; k++) {
        const a = TP * (f / 60 + k / 4), x = Math.round(crown[0] + 8 * Math.cos(a)), y = Math.round(crown[1] + 3 * Math.sin(a));
        ctx.fillStyle = k & 1 ? '#c8ffff' : '#50e0ff'; ctx.fillRect(x, y, 1, 1);
      }
      for (const [x, y, c, per, ph] of wins) if (tri(f, per, ph) > .16) { ctx.fillStyle = WC[c]; ctx.fillRect(x, y, 1, 2); }
      // стрелки часов
      ctx.fillStyle = '#80f0ff';
      const am = TP * f / 600 - Math.PI / 2;
      for (let k = 1; k <= 5; k++) ctx.fillRect(Math.round(tx + k * Math.cos(am)), Math.round(cyc + k * Math.sin(am)), 1, 1);
      const ah = TP * f / 7200 - Math.PI / 2;
      for (let k = 1; k <= 3; k++) ctx.fillRect(Math.round(tx + k * Math.cos(ah)), Math.round(cyc + k * Math.sin(ah)), 1, 1);
      for (const g of gears) { g.spr.clear(); gear(g.spr, g.c, g.c, g.r, g.t, g.dir * g.sp * f, g.col, { hi: g.hi, hub: '#e0b058', spokes: 6 }); g.spr.draw(ctx, g.x - g.c, g.y - g.c); }
      // энергия бежит по трубам
      for (const p of paths) {
        const n = p.pt.length, i = Math.floor((p.off + p.sp * f) % n);
        for (let k = 0; k < 3; k++) { const q = p.pt[(i - k + n) % n]; ctx.fillStyle = k === 0 ? '#d8ffff' : k === 1 ? '#60e8ff' : '#2aa8d0'; ctx.fillRect(q[0], q[1], 1, 1); }
      }
      for (const [x, y] of joints) glowPulse(ov, x, y, 5, '#40e8ff', f, { per: 60, ph: x, strength: .55, lo: .45 });
      ov.flush(ctx, 0, Y(120), W, H);
      for (const g of floaters) {
        const a = TP * (f / 120 + g.ph), x = Math.round(g.x + g.rx * Math.cos(a)), y = Math.round(g.y + g.ry * Math.sin(a));
        ctx.drawImage(gemSpr[g.c], x - 3, y - 10);
        if (tri(f, 48, g.ph * 90) > .85) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 7, 3, 1); ctx.fillRect(x, y - 8, 1, 3); }
      }
      fog(ov, f, { y0: Y(150), y1: H, color: '#a070e0', strength: .26, speed: .3, fade: 'mid', levels: 3 });
      ov.flush(ctx, 0, Y(150), W, H);
      ctx.drawImage(fgC, 0, 0);
      for (const [x, y, rad, col, per, ph] of gl) glowPulse(ov, x, y, rad, col, f, { per, ph, strength: .5, lo: .55 });
      ov.flush(ctx, 0, Y(120), W, H);
      drawMotes(ctx, motes, f);
    },
  };
}
/* ===== DAY ===== */
  function buildDay(env) {
    const { W, H, Y, Ys, U, limit, px } = env;
    const { Layer, Overlay, mulberry32, randint, pick, gradient, addGlow, sunDisc, makeSparkles, drawSparkles,
      makeMotes, drawMotes, cloudRow, drawCloudRows, glowPulse, fog, crystalGem, gear, pine, outward, drawBird, bay, clamp, tri } = px;
    const r = mulberry32(101), xc = W / 2, TP = 2 * Math.PI;
    const sc = clamp(W / 128, .7, 1), S1 = n => Math.round(n * sc);
    const sunX = U(32), sunY = Ys(30);

    /* ---------- небо и солнце ---------- */
    const sky = new Layer(W, H);
    gradient(sky, ['#4a98ec', '#6cb0f2', '#8ec8f6', '#b0def8', '#d0ecfa', '#e8f4fc', '#f6f0fc'], 0, Y(150));
    addGlow(sky, sunX, sunY, 8, 58, '#fff2c0', .7, 5, 1.5);
    sunDisc(sky, sunX, sunY, [[9, '#ffe27a'], [7, '#fff2a8'], [5, '#ffffff']]);
    const skyC = sky.canvas();
    const white = ['#f6f9fe', '#b4c8e6', '#ffffff'], candy = ['#fff0fa', '#e8b8e0', '#ffffff'];
    const rowsHi = [cloudRow({ sizes: [[44, 10], [34, 9], [50, 11]], seed: 11, cols: white, y: Ys(16), v: .22, gap: 118, off: 40 }),
      cloudRow({ sizes: [[36, 9], [46, 10]], seed: 23, cols: white, y: Ys(66), v: .3, gap: 108, off: 80 })];
    const strips = [cloudRow({ sizes: [[60, 7], [44, 6]], seed: 9, cols: candy, y: Y(104), v: .12, gap: 150, off: 70 }),
      cloudRow({ sizes: [[50, 6], [38, 6]], seed: 21, cols: candy, y: Y(122), v: .16, gap: 130, off: 10 })];
    const spark = makeSparkles(r, Math.round(3 * W / 128) + 1, W, Ys(8), Ys(70));
    const flock = [[0, 0], [-6, -2], [-6, 3], [-12, -4], [-12, 5]], flockX = r() * (W + 90), flockY = Ys(78);

    /* ---------- остров ---------- */
    const wins = [], WC = ['#7a9ad8', '#8aaae0', '#9af8ff'];
    const isl = new Layer(W, H), ri = mulberry32(17);
    function island(L, cx, y, w, depth, tH, trees) {
      const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
      L.poly([[x0, y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#d0c0ee');
      L.poly([[Math.round(cx), y + 4], [x1, y + 4], [Math.round(cx) + 2, y + 4 + depth]], '#a898d0');
      L.line(x0, y + 4, Math.round(cx) + 2, y + 4 + depth, '#f4ecff');
      L.rect(x0, y, x1, y + 3, '#5ad070'); L.hline(x0, x1, y, '#a8f488'); L.hline(x0, x1, y + 3, '#3aa858');
      for (const t of trees) pine(L, Math.round(cx + t[0]), y, t[1], '#2c9a4c', '#7ae070', 7, 3);
      if (tH) {
        const bx = Math.round(cx + 2);
        L.rect(bx - 3, y - tH, bx + 3, y, '#f0e6ff'); L.vline(bx - 3, y - tH, y, '#ffffff'); L.vline(bx + 3, y - tH, y, '#b8a8dc');
        L.poly([[bx - 5, y - tH], [bx + 5, y - tH], [bx, y - tH - 10]], '#d88a3a'); L.poly([[bx - 5, y - tH], [bx, y - tH], [bx, y - tH - 10]], '#f8b868');
        crystalGem(L, bx, y - tH - 10, '#e0ffff', '#50e0ff', '#2090c8', 6, 3);
        L.rect(bx - 1, y - tH + 6, bx, y - tH + 8, '#8ab0e8'); L.px(bx + 1, y - tH + 11, '#8ab0e8');
      }
    }
    const il = Math.round(U(-30)), iyl = Y(100);
    island(isl, il, iyl, S1(46) + 4, 20, 24, [[-16, 11], [-11, 8], [14, 9]]);
    for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 44, 80, ri)) island(isl, Math.round(U(u)), Y(randint(ri, 60, 126)), randint(ri, 16, 26), randint(ri, 8, 14), ri() < .5 ? randint(ri, 10, 18) : 0, [[-4, randint(ri, 6, 9)]]);
    const islC = isl.canvas();

    /* ---------- шпили с медными кольцами ---------- */
    function spireRow(base, hmin, hmax, step, body, roof, roof2, edge, seed, bright) {
      const L = new Layer(W, H), rg = mulberry32(seed); let n = 0;
      for (let x = -8; x < W + 10; x += randint(rg, step[0], step[1])) {
        const w = randint(rg, 8, 14), h = randint(rg, hmin, hmax), top = base - h, xx = Math.round(x), rc = (n++ % 3 === 0) ? roof2 : roof;
        L.rect(xx - (w >> 1), top, xx + (w >> 1), base + 20, body);
        L.poly([[xx - (w >> 1) - 1, top], [xx + (w >> 1) + 1, top], [xx + Math.round((rg() - .5) * 2), top - randint(rg, 12, 26)]], rc);
        L.vline(xx - (w >> 1), top, base, edge);
        if (bright) {
          for (let y = top + 8; y < base; y += randint(rg, 12, 18)) L.hline(xx - (w >> 1), xx + (w >> 1), y, '#e09838');
          for (let k = 0; k < Math.floor(h / 10); k++) if (rg() < .45) wins.push([xx - 1 + (rg() < .5 ? -2 : 1), top + 5 + k * 9, randint(rg, 0, 2), pick(rg, [60, 90, 120, 180]), randint(rg, 0, 120)]);
        }
      }
      return L.canvas();
    }
    const farC = spireRow(Y(176), 24, 54, [8, 14], '#cabfee', '#dcd0f8', '#f2c898', '#ece4fc', 4, false);
    const midC = spireRow(Y(190), 30, 62, [10, 17], '#a89cdc', '#c4b6ee', '#e8a860', '#d4c8f6', 9, true);

    /* ---------- башня с часами ---------- */
    const tx = Math.round(U(18)), cyc = Y(93), tw = new Layer(W, H);
    tw.rect(tx - 10, Y(77), tx + 10, Y(205), '#b4a6e4'); tw.vline(tx - 10, Y(77), Y(205), '#f0eaff'); tw.vline(tx + 10, Y(77), Y(205), '#8678c0');
    tw.poly([[tx - 12, Y(77)], [tx + 12, Y(77)], [tx, Y(60)]], '#d88a3a'); tw.poly([[tx - 12, Y(77)], [tx, Y(77)], [tx, Y(60)]], '#f8b868'); tw.line(tx - 12, Y(77), tx, Y(60), '#ffe0a8');
    tw.vline(tx, Y(55), Y(60), '#e8b040');
    crystalGem(tw, tx, Y(56), '#e8ffff', '#50e0ff', '#2090c8', 14, 5);
    for (const yy of [Y(109), Y(137), Y(165)]) { tw.rect(tx - 11, yy, tx + 11, yy + 2, '#e09838'); tw.hline(tx - 11, tx + 11, yy, '#ffd070'); }
    tw.disc(tx, cyc, 9, '#e09838'); tw.disc(tx, cyc, 7, '#f6f0e0'); tw.disc(tx, cyc, 6, '#fffaf0');
    for (let k = 0; k < 12; k++) { const a = TP * k / 12; tw.px(Math.round(tx + 5 * Math.sin(a)), Math.round(cyc - 5 * Math.cos(a)), '#7a6aa8'); }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) if (r() < .45) { const wx = tx - 6 + i * 6, wy = Y(141) + j * 6; if (wy < Y(162)) wins.push([wx, wy, 0, pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (r() < .5) { const wx = tx - 6 + i * 6, wy = Y(170) + j * 7; wins.push([wx, wy, randint(r, 0, 2), pick(r, [60, 90, 120]), randint(r, 0, 100)]); }
    const twC = tw.canvas();

    /* ---------- медные трубы ---------- */
    const pipes = new Layer(W, H), paths = [], joints = [];
    function pipe(pts) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        pipes.rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1) + (y0 === y1 ? 0 : 1), Math.max(y0, y1) + (y0 === y1 ? 1 : 0), '#d8883a');
        pipes.line(x0, y0, x1, y1, '#ffc878');
      }
      for (const [x, y] of pts) { pipes.disc(x, y, 2, '#b86a28'); pipes.px(x, y, '#ffd890'); joints.push([x, y]); }
      const pt = [];
      for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k < n; k++) pt.push([x0 + Math.round((x1 - x0) * k / n), y0 + Math.round((y1 - y0) * k / n)]); }
      paths.push({ pt, sp: .9 + r() * .5, off: randint(r, 0, 90) });
    }
    const px0 = n => Math.round(U(n));
    pipe([[px0(-64), Y(160)], [px0(-24), Y(160)], [px0(-24), Y(143)], [tx - 11, Y(143)]]);
    pipe([[tx + 11, Y(151)], [px0(40), Y(151)], [px0(40), Y(168)]]);
    const rp = mulberry32(70);
    for (const d of [-1, 1]) for (const u of outward(d * 58, d, limit, 40, 70, rp)) { const x0 = px0(u), len = randint(rp, 18, 36) * (rp() < .5 ? 1 : -1), y0 = Y(randint(rp, 148, 168)); pipe([[x0, y0], [x0 + len, y0], [x0 + len, y0 + randint(rp, 8, 16)]]); }
    const pipesC = pipes.canvas();

    /* ---------- шестерни с рунами, дирижабль, камни ---------- */
    const gears = [
      { x: tx, y: Y(123), r: 8, t: 10, dir: 1, col: '#d09a38', hi: '#ffe090', rune: true },
      { x: il - 12, y: iyl + 12, r: 10, t: 10, dir: -1, col: '#c88e34', hi: '#f8d070', rune: true },
      { x: S1(8), y: H + 4, r: 22, t: 14, dir: 1, col: '#a8782c', hi: '#e0b058', rune: false },
    ];
    gears.forEach(g => { g.c = g.r + 5; g.spr = new Layer(2 * g.c + 1, 2 * g.c + 1); g.sp = TP / (g.t * 40); });
    const ship = (() => {
      const L = new Layer(70, 40), x0 = 6, x1 = 64, h = 16, oy = 12;
      L.ellipseBox(x0, oy, x1, oy + h, '#6a84c8');
      for (let y = oy; y <= oy + h; y++) for (let x = x0; x <= x1; x++) if (L.has(x, y)) { if (y < oy + h * .3) L.px(x, y, '#8aa4e0'); else if (y > oy + h * .78) L.px(x, y, '#4a64a8'); }
      L.hline(x0 + 5, x1 - 5, oy + Math.round(h * .62), '#e8b040');
      L.poly([[0, oy + 2], [x0 + 6, oy + 5], [x0 + 6, oy + 12], [4, oy + h + 2]], '#4a64a8');
      L.poly([[30, oy + 1], [40, oy + 1], [35, oy - 11]], '#ff70b8'); L.poly([[30, oy + 1], [35, oy + 1], [35, oy - 11]], '#ffa8d4');
      L.vline(35, oy + h + 1, oy + h + 6, '#e8b040'); L.px(35, oy + h + 8, '#ffffff'); L.px(34, oy + h + 8, '#50e0ff'); L.px(36, oy + h + 8, '#50e0ff'); L.px(35, oy + h + 7, '#50e0ff'); L.px(35, oy + h + 9, '#2090c8');
      return L.canvas();
    })();
    const shipY = Ys(50), shipV = .3, shipM = 90, r0 = r() * (W + 2 * shipM);
    const gemSpr = {
      pink: (() => { const L = new Layer(7, 11); crystalGem(L, 3, 10, '#ffe0f8', '#ff80d8', '#c040a0', 9, 2); return L.canvas(); })(),
      cyan: (() => { const L = new Layer(7, 11); crystalGem(L, 3, 10, '#e8ffff', '#60e8ff', '#2898d0', 9, 2); return L.canvas(); })(),
    };
    const floaters = [[-58, 122, 'pink', 0], [-29, 123, 'pink', .3], [-21, 127, 'cyan', .55], [-11, 110, 'pink', .8], [4, 127, 'pink', .15], [33, 94, 'cyan', .4], [43, 113, 'pink', .65], [53, 110, 'cyan', .9]]
      .map(([u, y, c, ph]) => ({ x: U(u), y: Y(y), c, ph, rx: 2 + (ph * 10 | 0) % 3, ry: 2 }));
    for (const d of [-1, 1]) for (const u of outward(d * 62, d, limit, 20, 44, ri)) floaters.push({ x: U(u), y: Y(randint(ri, 100, 150)), c: ri() < .5 ? 'pink' : 'cyan', ph: ri(), rx: 3, ry: 2 });

    /* ---------- передний план ---------- */
    const fg = new Layer(W, H), dark = '#6a5a9c';
    fg.poly([[W + 2, H + 2], [W + 2, Y(168)], [W - S1(16), Y(176)], [W - S1(32), H + 2]], dark);
    const CY = ['#c8fcff', '#40c4f0', '#2078c0'], PK = ['#ffd0f0', '#f060c8', '#b030a0'];
    function big(x, base, h, w, c) {
      x = Math.round(x); base = Math.round(base);
      fg.poly([[x - (w >> 1), base], [x - (w >> 1), base - h * .78], [x, base - h], [x, base]], c[1]);
      fg.poly([[x, base], [x, base - h], [x + (w >> 1), base - h * .78], [x + (w >> 1), base]], c[2]);
      fg.vline(x - (w >> 1) + 1, base - h * .7, base - 3, c[0]); fg.line(x - (w >> 1), Math.round(base - h * .78), x, Math.round(base - h), c[0]);
    }
    const gl = [], rgl = mulberry32(44), bxr = W - S1(14), bb = H + 2;
    big(bxr - 4, bb, S1(36), S1(9), PK); big(bxr - 18, bb, S1(14), S1(7), CY); big(bxr + 6, bb, S1(18), S1(7), CY);
    gl.push([bxr - 4, bb - S1(20), 16, '#ffa0e8', 80, 25], [bxr - 18, bb - S1(8), 10, '#80f0ff', 70, 0]);
    for (const d of [-1, 1]) for (const u of outward(d * 60, d, limit, 30, 60, rgl)) {
      if (d < 0 && u > -40) continue;
      const c = rgl() < .5 ? CY : PK, h = randint(rgl, 14, 32);
      fg.poly([[U(u) - 14, H + 2], [U(u), Y(196)], [U(u) + 14, H + 2]], dark);
      big(U(u), Y(randint(rgl, 198, 204)), h, Math.round(h * .28) + 3, c); gl.push([U(u), Y(190) - h * .4, 10, c === CY ? '#80f0ff' : '#ffa0e8', randint(rgl, 60, 90), randint(rgl, 0, 60)]);
    }
    const fgC = fg.canvas();
    const motes = makeMotes(r, Math.round(40 * W / 128), W, { y0: Y(70), y1: Y(190), colors: ['#ffe880', '#ffb8e8', '#a8e8ff', '#ffffff'], rise: .16, amp: [2, 5], big: .22 });
    const ov = new Overlay(W, H);
    const crown = [tx, Y(48)];

    return {
      draw(ctx, f) {
        ctx.drawImage(skyC, 0, 0);
        drawCloudRows(ctx, rowsHi, f, W);
        drawSparkles(ctx, spark, f, '#ffffff');
        const fxp = Math.floor(((flockX + .28 * f) % (W + 90) + W + 90) % (W + 90)) - 45;
        flock.forEach(([dx, dy], i) => drawBird(ctx, fxp + dx, flockY + dy + Math.round(Math.sin(TP * f / 70 + i)), (((f >> 2) + i) & 1) === 1, '#6a5aa0'));
        const P = W + 2 * shipM, sx = Math.floor(((r0 + shipV * f) % P + P) % P) - shipM;
        ctx.drawImage(ship, sx, shipY);
        glowPulse(ov, sx + 35, shipY + 29, 7, '#80f0ff', f, { per: 40, strength: .5, lo: .5 });
        ov.flush(ctx, Math.max(0, sx + 26), shipY + 22, Math.min(W, sx + 45), shipY + 38);
        ctx.drawImage(islC, 0, 0);
        drawCloudRows(ctx, strips, f, W);
        ctx.drawImage(farC, 0, 0);
        ctx.drawImage(midC, 0, 0);
        ctx.drawImage(pipesC, 0, 0);
        ctx.drawImage(twC, 0, 0);
        for (let k = 0; k < 4; k++) {
          const a = TP * (f / 60 + k / 4), x = Math.round(crown[0] + 8 * Math.cos(a)), y = Math.round(crown[1] + 3 * Math.sin(a));
          ctx.fillStyle = k & 1 ? '#ffffff' : '#70f0ff'; ctx.fillRect(x, y, 1, 1);
        }
        if (tri(f, 44, 0) > .8) { ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 3, Y(48), 7, 1); ctx.fillRect(tx, Y(45), 1, 7); }
        for (const [x, y, c, per, ph] of wins) { ctx.fillStyle = tri(f, per, ph) > .93 ? '#ffffff' : WC[c]; ctx.fillRect(x, y, 1, 2); }
        ctx.fillStyle = '#3a2a48';
        const am = TP * f / 600 - Math.PI / 2;
        for (let k = 1; k <= 5; k++) ctx.fillRect(Math.round(tx + k * Math.cos(am)), Math.round(cyc + k * Math.sin(am)), 1, 1);
        const ah = TP * f / 7200 - Math.PI / 2;
        for (let k = 1; k <= 3; k++) ctx.fillRect(Math.round(tx + k * Math.cos(ah)), Math.round(cyc + k * Math.sin(ah)), 1, 1);
        for (const g of gears) {
          g.spr.clear(); const ang = g.dir * g.sp * f;
          gear(g.spr, g.c, g.c, g.r, g.t, ang, g.col, { hi: g.hi, hub: '#ffe090', spokes: 6 });
          if (g.rune) for (let k = 0; k < 3; k++) { const a = ang + TP * k / 3 + .5, rr = g.r - 1.2; g.spr.px(Math.round(g.c + rr * Math.cos(a)), Math.round(g.c + rr * Math.sin(a)), '#7af0ff'); }
          g.spr.draw(ctx, g.x - g.c, g.y - g.c);
        }
        for (const p of paths) {
          const n = p.pt.length, i = Math.floor((p.off + p.sp * f) % n);
          for (let k = 0; k < 3; k++) { const q = p.pt[(i - k + n) % n]; ctx.fillStyle = k === 0 ? '#ffffff' : k === 1 ? '#80f4ff' : '#30c4e8'; ctx.fillRect(q[0], q[1], 1, 1); }
        }
        for (const g of floaters) {
          const a = TP * (f / 120 + g.ph), x = Math.round(g.x + g.rx * Math.cos(a)), y = Math.round(g.y + g.ry * Math.sin(a));
          ctx.drawImage(gemSpr[g.c], x - 3, y - 10);
          if (tri(f, 48, g.ph * 90) > .85) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 7, 3, 1); ctx.fillRect(x, y - 8, 1, 3); }
        }
        fog(ov, f, { y0: Y(150), y1: H, color: '#fff0fa', strength: .28, speed: .3, fade: 'mid', levels: 3 });
        ov.flush(ctx, 0, Y(150), W, H);
        ctx.drawImage(fgC, 0, 0);
        for (const [x, y, rad, col, per, ph] of gl) glowPulse(ov, x, y, rad, col, f, { per, ph, strength: .3, lo: .5 });
        ov.flush(ctx, 0, Y(120), W, H);
        drawMotes(ctx, motes, f);
      },
    };
  }
/* ===== END ===== */
  PixelBG.register('city_hybrid', function (env) { return env.day ? buildDay(env) : buildNight(env); });
})();
