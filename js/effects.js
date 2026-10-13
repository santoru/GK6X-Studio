// Lighting effects, generated from each model's key geometry (no vendor effect data).
// An effect builds { frames: [[repeat, [location...]]], params: [[colorType, '#rrggbb', val1, val2, [location...]]] },
// the shape the firmware's dynamic lighting expects. Colour types: 0 solid, 1 hue cycle, 2 breathing.

const SOLID = 0;
const CYCLE = 1;
const BREATHE = 2;

// Speed 1 (slowest) to 10 (fastest), mapped geometrically onto firmware timing units: hue-cycle and
// breathing "count" (higher = slower; the firmware divides 360 and 100 by them) and ticks per animation frame.
export const SPEED = { min: 1, max: 10, default: 3 };
const LEGACY_SPEEDS = { slow: 2, medium: 5, fast: 8 }; // presets saved by earlier versions

export const isSpeed = (value) => {
  const v = LEGACY_SPEEDS[value] ?? value;
  return Number.isInteger(v) && v >= SPEED.min && v <= SPEED.max;
};
export const speedOf = (value) => (isSpeed(value) ? LEGACY_SPEEDS[value] ?? value : SPEED.default);

function timing(speed) {
  const t = (speed - SPEED.min) / (SPEED.max - SPEED.min);
  const scale = (slow, fast) => Math.round(slow * (fast / slow) ** t);
  return { cycle: scale(300, 12), breathe: scale(60, 5), repeat: scale(12, 1) };
}
export const CYCLE_COLOR = 'cycle'; // pseudo colour: keys cycle through the spectrum instead of one colour

// Known-good limits from the vendor's own effects: animation length in ticks and colour groups per effect.
export const MAX_TICKS = 767;
export const MAX_PARAMS = 30;

/* ---------- colour helpers ---------- */

function hueHex(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const [x, y] = [toRgb(a), toRgb(b)]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const shade = (hex, t) => mix('#000000', hex, t);
/** Same lightness, opposite hue. */
const complement = (hex) => { const c = toRgb(hex); const m = Math.max(...c) + Math.min(...c); return toHex(c.map((v) => m - v)); };
const gradient = (stops, t) => {
  const p = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(p);
  return mix(stops[i], stops[i + 1], p - i);
};

/* ---------- geometry ---------- */

/** LEDs of a model: centres normalised to 0..1, plus whether the key is a modifier-sized/labelled key. */
function geometry(model) {
  const items = [
    ...model.keys.map(([, label, x, y, w, h, loc]) => ({ loc, label, x, y, w, h })),
    ...model.leds.map(([loc, x, y, w, h]) => ({ loc, label: '', x, y, w, h, led: true })),
  ];
  const width = Math.max(...items.map((k) => k.x + k.w));
  const height = Math.max(...items.map((k) => k.y + k.h));
  return items.map((k) => ({
    loc: k.loc,
    label: k.label,
    led: !!k.led,
    mod: !k.led && (k.label.length > 1 || k.w > k.h * 1.3),
    x: (k.x + k.w / 2) / width,
    y: (k.y + k.h / 2) / height,
  }));
}

const bin = (v, n) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
const groups = (leds, n, value) =>
  Array.from({ length: n }, (_, i) => leds.filter((l) => bin(value(l), n) === i).map((l) => l.loc));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const locsOf = (leds) => leds.map((l) => l.loc);
const center = (l) => Math.hypot((l.x - 0.5) * 2.6, l.y - 0.5) / 1.4; // 0 centre .. ~1 corners
const angle = (l) => (Math.atan2(l.y - 0.5, (l.x - 0.5) / 2.6) / (2 * Math.PI) + 1) % 1;

/** Keys in reading order, snaking: even rows left to right, odd rows right to left. */
function serpentine(leds) {
  const rows = groups(leds.filter((l) => !l.led), 5, (l) => l.y);
  const byLoc = new Map(leds.map((l) => [l.loc, l]));
  return rows.flatMap((row, r) => row.map((loc) => byLoc.get(loc)).sort((a, b) => (r % 2 ? b.x - a.x : a.x - b.x)));
}

function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- building blocks ---------- */

const allOn = (leds) => [[1, locsOf(leds)]];

/** Solid colour per LED, grouped into one parameter per distinct colour. */
function solids(leds, colorOf) {
  const byColor = new Map();
  for (const l of leds) {
    const c = colorOf(l);
    if (c) byColor.set(c, [...(byColor.get(c) ?? []), l.loc]);
  }
  return [...byColor].map(([c, locs]) => [SOLID, c, 1, 0, locs]);
}

// One parameter covering every LED, in the chosen colour or cycling.
const paint = (leds, color, s) =>
  [color === CYCLE_COLOR ? [CYCLE, '#ff0000', s.cycle, 0, locsOf(leds)] : [SOLID, color, 1, 0, locsOf(leds)]];

/** Frames lighting each band in `order`, `width` bands at a time. */
const steps = (bands, order, width, repeat) =>
  order.map((i) => [repeat, Array.from({ length: width }, (_, k) => bands[i - k] ?? []).flat()]);

const palette = (colors, seed) => { const next = random(seed); return () => colors[Math.floor(next() * colors.length)]; };

/* ---------- effects ---------- */
// id: [label, group, colour option ('cycle' also allows the spectrum swatch), build(leds, colour, timing, palette),
//      optional variants { id: [label, palette colours or null, style] }]

const THEMES = 'Themes';
const FLOW = 'Colour flow';
const MOTION = 'Motion';

/** Vivid rainbow, then every palette as a glow. */
const kaleidoscopeVariants = (palettes) => Object.fromEntries([
  ['vivid', ['Vivid rainbow', null]],
  ...Object.entries(palettes).map(([id, [name, colors]]) => [id, [`${name} glow`, colors, 'glow']]),
]);

const themeByY = (stops) => (leds) => ({ frames: allOn(leds), params: solids(leds, (l) => gradient(stops, Math.floor(l.y * 6) / 5)) });

const LIST = {
  /* Themes: still patterns */
  solid: ['Solid', THEMES, 'cycle', (leds, color, s) => ({ frames: allOn(leds), params: paint(leds, color, s) })],
  gradient: ['Rainbow', THEMES, false, (leds) => ({
    frames: allOn(leds), params: groups(leds, 12, (l) => l.x).map((locs, i) => [SOLID, hueHex(i * 25), 1, 0, locs]),
  })],
  sunset: ['Sunset', THEMES, false, themeByY(['#ffd166', '#ff7b54', '#e63e6d', '#7a3ea1'])],
  ocean: ['Ocean', THEMES, false, themeByY(['#a8f0ff', '#22b8cf', '#1c6dd0', '#0b2a6f'])],
  forest: ['Forest', THEMES, false, themeByY(['#d4f28b', '#6cc04a', '#2e8b57', '#14532d'])],
  ember: ['Ember', THEMES, false, themeByY(['#ffe066', '#ff9f1c', '#ff4d00', '#b80000'])],
  ice: ['Glacier', THEMES, false, themeByY(['#ffffff', '#cdeffd', '#7cc6fe', '#3a86ff'])],
  synthwave: ['Synthwave', THEMES, false, (leds) => ({
    frames: allOn(leds),
    params: solids(leds, (l) => gradient(['#05d9e8', '#7b2ff7', '#d300c5', '#ff2a6d'], Math.floor((l.x * 0.7 + l.y * 0.3) * 10) / 9)),
  })],
  candy: ['Candy stripes', THEMES, false, (leds) => {
    const stripes = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];
    return { frames: allOn(leds), params: solids(leds, (l) => stripes[bin(l.x, 15) % stripes.length]) };
  }],
  retro: ['Retro keycaps', THEMES, false, (leds) => ({
    frames: allOn(leds),
    params: solids(leds, (l) => (/^(esc|enter|return)$/i.test(l.label) ? '#e63946' : l.mod || l.led ? '#7d8597' : '#f1e3c8')),
  })],
  accent: ['Accent mods', THEMES, true, (leds, color) => ({
    frames: allOn(leds), params: solids(leds, (l) => (l.mod || l.led ? color : '#d8dce6')),
  })],
  spotlight: ['Spotlight', THEMES, true, (leds, color) => ({
    frames: allOn(leds), params: solids(leds, (l) => shade(color, 1 - Math.floor(center(l) * 10) / 11)),
  })],
  duotone: ['Duotone', THEMES, true, (leds, color) => ({
    frames: allOn(leds),
    params: solids(leds, (l) => mix(color, complement(color), Math.floor((l.x * 0.75 + l.y * 0.25) * 12) / 11)),
  })],
  checker: ['Checkerboard', THEMES, true, (leds, color) => ({
    frames: allOn(leds), params: solids(leds, (l) => ((bin(l.x, 15) + bin(l.y, 5)) % 2 ? color : complement(color))),
  })],

  /* Colour flow: everything lit, colours change */
  breathing: ['Breathing', FLOW, 'cycle', (leds, color, s) => ({
    frames: allOn(leds),
    params: [color === CYCLE_COLOR ? [CYCLE, '#ff0000', s.cycle, 0, locsOf(leds)] : [BREATHE, color, s.breathe, 2, locsOf(leds)]],
  })],
  spectrum: ['Spectrum', FLOW, false, (leds, _, s) => ({ frames: allOn(leds), params: [[CYCLE, '#ff0000', s.cycle, 0, locsOf(leds)]] })],
  rainbow: ['Rainbow wave', FLOW, false, (leds, _, s) => ({
    frames: allOn(leds), params: groups(leds, 12, (l) => l.x).map((locs, i) => [CYCLE, hueHex(i * 30), s.cycle, 0, locs]),
  })],
  aurora: ['Aurora', FLOW, false, (leds, _, s) => ({
    frames: allOn(leds), params: groups(leds, 5, (l) => l.y).map((locs, i) => [CYCLE, hueHex(120 + i * 45), s.cycle, 0, locs]),
  })],
  vortex: ['Vortex', FLOW, false, (leds, _, s) => ({
    frames: allOn(leds), params: groups(leds, 18, angle).map((locs, i) => [CYCLE, hueHex(i * 20), s.cycle, 0, locs]),
  })],
  bloom: ['Bloom', FLOW, false, (leds, _, s) => ({
    frames: allOn(leds), params: groups(leds, 10, center).map((locs, i) => [CYCLE, hueHex(i * 36), s.cycle, 0, locs]),
  })],
  lava: ['Lava lamp', FLOW, false, (leds, _, s) => {
    const warm = ['#ff4d00', '#ff006e', '#ffbe0b', '#fb5607', '#c9184a', '#ff7b00'];
    const blobs = groups(leds, 12, (l) => (bin(l.x, 6) + 6 * bin(l.y, 2)) / 12);
    return {
      frames: allOn(leds),
      params: blobs.map((locs, i) => [BREATHE, warm[i % warm.length], Math.max(2, Math.round(s.breathe * (0.6 + (i % 5) * 0.2))), 1, locs]),
    };
  }],
  kaleidoscope: ['Kaleidoscope', FLOW, false, (leds, _, s, variant) => {
    // Keys share 24 random groups (within the colour-group limit), each with its own pace so neighbours drift.
    // Vivid: every key cycles the whole spectrum from its own hue (the firmware's cycle mode always spans it all).
    // Palettes: the firmware can't rotate within a hue range, and starts all breathing from dark when the layer
    // activates (no phase setting). So ~40% of keys stay solid in palette shades (bright from the first frame)
    // and the rest breathe between them, with paces spread ~5x and varied hold times so they never sync.
    const next = random(77);
    const keyGroups = range(24).map(() => []);
    for (const l of leds) keyGroups[Math.floor(next() * 24)].push(l.loc);
    const used = keyGroups.filter((g) => g.length);
    const BREATHE_PACES = [0.35, 1, 0.55, 1.75, 0.8, 1.3, 0.45, 1.5, 0.65, 1.15];
    const breathePace = (i) => Math.max(2, Math.round(s.breathe * BREATHE_PACES[i % BREATHE_PACES.length]));
    const cyclePace = (i) => Math.max(2, Math.round(s.cycle * (0.6 + (i % 7) * 0.15)));
    return {
      frames: allOn(leds),
      params: used.map((locs, i) => {
        if (!variant.colors) return [CYCLE, hueHex(i * 15), cyclePace(i), 0, locs];
        const color = variant.colors[(i * 5) % variant.colors.length];
        return i % 5 === 0 || i % 5 === 2 ? [SOLID, color, 1, 0, locs] : [BREATHE, color, breathePace(i), 1 + (i % 4), locs];
      }),
    };
  }, kaleidoscopeVariants({
    pastel: ['Pastel', ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']],
    neon: ['Neon', ['#ff00ff', '#00ffff', '#39ff14', '#ffff00', '#ff073a', '#bc13fe']],
    sunset: ['Sunset', ['#ff4e50', '#fc913a', '#f9d423', '#ff2e63', '#e84393', '#ff7b54']],
    ocean: ['Ocean', ['#00b4d8', '#0077b6', '#48cae4', '#90e0ef', '#023e8a', '#00f5d4']],
  })],
  heartbeat: ['Heartbeat', FLOW, true, (leds, color, s) => {
    const all = locsOf(leds);
    const r = Math.max(1, Math.round(s.repeat / 2));
    return { frames: [[r, all], [r, []], [r, all], [r * 6, []]], params: [[SOLID, color, 1, 0, all]] };
  }],

  /* Motion: lit keys move */
  sweep: ['Sweep', MOTION, 'cycle', (leds, color, s) => ({
    frames: steps(groups(leds, 16, (l) => l.x), range(18), 3, s.repeat), params: paint(leds, color, s),
  })],
  bounce: ['Bounce', MOTION, 'cycle', (leds, color, s) => {
    const forth = range(16);
    return { frames: steps(groups(leds, 16, (l) => l.x), [...forth, ...forth.slice(1, -1).reverse()], 2, s.repeat), params: paint(leds, color, s) };
  }],
  curtain: ['Curtain', MOTION, 'cycle', (leds, color, s) => {
    const bands = groups(leds, 16, (l) => l.x);
    const upTo = (n, from = 0) => bands.slice(from, n).flat();
    return {
      frames: [...range(17).map((i) => [s.repeat, upTo(i)]), [s.repeat * 6, upTo(16)], ...range(16).map((i) => [s.repeat, upTo(16, i + 1)])],
      params: paint(leds, color, s),
    };
  }],
  fill: ['Typewriter', MOTION, 'cycle', (leds, color, s) => {
    const order = serpentine(leds).map((l) => l.loc);
    const step = Math.ceil(order.length / 32);
    const counts = range(Math.ceil(order.length / step) + 1).map((i) => i * step);
    return { frames: [...counts.map((n) => [s.repeat, order.slice(0, n)]), [s.repeat * 8, order]], params: paint(leds, color, s) };
  }],
  snake: ['Snake', MOTION, false, (leds, _, s) => {
    const path = serpentine(leds);
    const r = Math.max(1, Math.round(s.repeat / 2));
    const length = 8;
    const hueAt = new Map(path.map((l, i) => [l.loc, hueHex(Math.floor(i / path.length * 24) * 15)]));
    return {
      frames: range(path.length + length).map((i) => [r, path.slice(Math.max(0, i - length), i).map((l) => l.loc)]),
      params: solids(leds.filter((l) => hueAt.has(l.loc)), (l) => hueAt.get(l.loc)),
    };
  }],
  ripple: ['Ripple', MOTION, 'cycle', (leds, color, s) => ({
    frames: steps(groups(leds, 10, center), range(12), 2, s.repeat), params: paint(leds, color, s),
  })],
  prism: ['Prism ripple', MOTION, false, (leds, _, s) => {
    const rings = groups(leds, 10, center);
    return {
      frames: steps(rings, range(12), 3, s.repeat),
      params: rings.map((locs, i) => [SOLID, hueHex(i * 36), 1, 0, locs]),
    };
  }],
  radar: ['Radar', MOTION, 'cycle', (leds, color, s) => {
    const wedges = groups(leds, 24, angle);
    return { frames: range(24).map((i) => [s.repeat, [...wedges[i], ...wedges[(i + 23) % 24]]]), params: paint(leds, color, s) };
  }],
  spiral: ['Spiral', MOTION, false, (leds, _, s) => {
    const arms = groups(leds, 24, (l) => (angle(l) * 2 + center(l) * 1.2) % 1);
    return {
      frames: range(24).map((i) => [s.repeat, [0, 1, 2, 3].flatMap((k) => arms[(i + k) % 24])]),
      params: groups(leds, 12, angle).map((locs, i) => [SOLID, hueHex(i * 30), 1, 0, locs]),
    };
  }],
  siren: ['Siren', MOTION, false, (leds, _, s) => {
    const left = locsOf(leds.filter((l) => l.x < 0.5));
    const right = locsOf(leds.filter((l) => l.x >= 0.5));
    const r = Math.max(1, s.repeat);
    return {
      frames: [[r, left], [r, []], [r, left], [r * 2, []], [r, right], [r, []], [r, right], [r * 2, []]],
      params: [[SOLID, '#ff1a1a', 1, 0, left], [SOLID, '#1a53ff', 1, 0, right]],
    };
  }],
  rain: ['Rain', MOTION, 'cycle', (leds, color, s) => {
    const cols = 15;
    const rows = 5;
    const next = random(11);
    const phase = range(cols).map(() => Math.floor(next() * (rows + 3)));
    return {
      frames: range(rows + 3).map((f) => [s.repeat, locsOf(leds.filter((l) => (f + phase[bin(l.x, cols)]) % (rows + 3) === bin(l.y, rows)))]),
      params: paint(leds, color, s),
    };
  }],
  matrix: ['Matrix', MOTION, false, (leds, _, s) => {
    const cols = 15;
    const cycle = 9;
    const next = random(23);
    const phase = range(cols).map(() => Math.floor(next() * cycle));
    const green = palette(['#00ff41', '#00c22a', '#008f11', '#5dff8a'], 5);
    const lit = (f, l) => { const d = (f + phase[bin(l.x, cols)]) % cycle - bin(l.y, 5); return d === 0 || d === 1 || d === 2; };
    return {
      frames: range(cycle).map((f) => [s.repeat, locsOf(leds.filter((l) => lit(f, l)))]),
      params: solids(leds, () => green()),
    };
  }],
  equalizer: ['Equalizer', MOTION, false, (leds, _, s) => {
    const cols = 15;
    const next = random(3);
    const heights = range(14).map(() => range(cols).map(() => 1 + Math.floor(next() * 5)));
    return {
      frames: heights.map((h) => [s.repeat, locsOf(leds.filter((l) => 4 - bin(l.y, 5) < h[bin(l.x, cols)]))]),
      params: solids(leds, (l) => ['#ff3b30', '#ff9500', '#ffcc00', '#a3e635', '#34c759'][bin(l.y, 5)]),
    };
  }],
  fireworks: ['Fireworks', MOTION, false, (leds, _, s) => {
    const next = random(42);
    const bursts = range(6).map(() => ({ x: 0.15 + next() * 0.7, y: 0.2 + next() * 0.6 }));
    const dist = (l, b) => Math.hypot((l.x - b.x) * 2.6, l.y - b.y);
    const r = Math.max(1, Math.round(s.repeat / 2));
    return {
      frames: bursts.flatMap((b) => [
        ...range(5).map((ring) => [r, locsOf(leds.filter((l) => Math.abs(dist(l, b) - ring * 0.13) < 0.08))]),
        [r * 3, []],
      ]),
      params: groups(leds, 12, (l) => l.x).map((locs, i) => [SOLID, hueHex(i * 30 + 15), 1, 0, locs]),
    };
  }],
  twinkle: ['Twinkle', MOTION, 'cycle', (leds, color, s) => {
    const next = random(7);
    return { frames: range(24).map(() => [s.repeat, locsOf(leds.filter(() => next() < 0.14))]), params: paint(leds, color, s) };
  }],
  confetti: ['Confetti', MOTION, false, (leds, _, s) => {
    const next = random(17);
    const color = palette(range(12).map((i) => hueHex(i * 30)), 9);
    return { frames: range(24).map(() => [s.repeat, locsOf(leds.filter(() => next() < 0.22))]), params: solids(leds, () => color()) };
  }],
  galaxy: ['Galaxy', MOTION, false, (leds, _, s) => {
    const next = random(31);
    const color = palette(['#7b2ff7', '#3a0ca3', '#4361ee', '#f72585', '#b5179e', '#4cc9f0', '#ffffff'], 13);
    return { frames: range(16).map(() => [s.repeat + 1, locsOf(leds.filter(() => next() < 0.7))]), params: solids(leds, () => color()) };
  }],
};

// The firmware divides these into per-tick steps, so larger counts would mean a step of 0 (frozen).
const MAX_COUNT = { [CYCLE]: 360, [BREATHE]: 100 };

/**
 * Shortens animations beyond the known-good length by reducing repeats, then dropping frames, and keeps
 * colour speeds in the firmware's usable range.
 */
function fit(effect) {
  const ticks = (frames) => frames.reduce((n, [repeat]) => n + repeat, 0);
  let frames = effect.frames;
  if (ticks(frames) > MAX_TICKS) {
    const k = MAX_TICKS / ticks(frames);
    frames = frames.map(([repeat, lit]) => [Math.max(1, Math.floor(repeat * k)), lit]);
  }
  const every = Math.ceil(ticks(frames) / MAX_TICKS);
  if (every > 1) frames = frames.filter((_, i) => i % every === 0);
  const params = effect.params.map(([kind, color, count, ...rest]) =>
    [kind, color, MAX_COUNT[kind] ? Math.min(count, MAX_COUNT[kind]) : count, ...rest]);
  return { frames, params };
}

export const EFFECTS = Object.fromEntries(Object.entries(LIST).map(([id, [label, group, colorable, , variants]]) => [id, {
  label,
  group,
  colorable: !!colorable,
  cycle: colorable === 'cycle',
  variants: variants && Object.entries(variants).map(([v, [name, colors, style]]) => ({ id: v, label: name, colors, style })),
}]));

const cache = new WeakMap(); // model -> Map(entry key -> effect)

/** Effect data for an entry {type:'effect', name, color, speed} on a model, or null if unknown. */
export function buildEffect(entry, model) {
  const def = LIST[entry?.name];
  if (!def || !model) return null;
  const { colorable, cycle } = EFFECTS[entry.name];
  const fallback = '#ff5f1f';
  const color = !colorable ? null : entry.color === CYCLE_COLOR && !cycle ? fallback : entry.color ?? fallback;
  const speed = speedOf(entry.speed);
  const variants = EFFECTS[entry.name].variants;
  const variant = variants && (variants.find((v) => v.id === entry.variant) ?? variants[0]);
  const key = `${entry.name}|${color}|${speed}|${variant?.id}`;
  if (!cache.has(model)) cache.set(model, new Map());
  const built = cache.get(model);
  if (!built.has(key)) built.set(key, fit(def[3](geometry(model), color, timing(speed), variant)));
  return built.get(key);
}
