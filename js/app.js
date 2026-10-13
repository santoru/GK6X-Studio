import { MODELS } from './models.js';
import { EFFECTS, SPEED, isSpeed, speedOf, CYCLE_COLOR } from './effects.js';
import { CATEGORIES, UNUSED, DISABLED, describe, valueForCode, withMods } from './keycodes.js';
import { Keyboard } from './protocol.js';
import { PRESET } from './preset.js';
import { lightingPayload, previewColors, isAnimated } from './lighting.js';

const $ = (id) => document.getElementById(id);
const LAYER_IDS = [0, 1, 2, 3];
const BASE = 0;
const layerName = (l) => (l === BASE ? 'Base' : `Layer ${l}`);
const FN_LOGIC = 0; // Fn is handled by the firmware and can't be remapped
const SWATCHES = ['#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#32ade6', '#007aff',
  '#5856d6', '#af52de', '#ff2d55', '#ff5f1f'];

const HEX = /^#[0-9a-f]{6}$/i;
const isValidEntry = (e) => e.type === 'effect'
  ? !!EFFECTS[e.name] && (e.color === undefined || e.color === CYCLE_COLOR || HEX.test(e.color))
    && (e.speed === undefined || isSpeed(e.speed))
    && (e.variant === undefined || !!EFFECTS[e.name].variants?.some((v) => v.id === e.variant))
  : e.type === 'static' && Object.values(e.colors ?? {}).every((c) => HEX.test(c));

/** Drops entries this version can't write (e.g. saved by an older version). */
function validLighting(lighting) {
  return Object.fromEntries(Object.entries(lighting).filter(([, e]) => e && isValidEntry(e)));
}

const store = {
  get(name, fallback) {
    try { return JSON.parse(localStorage.getItem('gk6x.' + name)) ?? fallback; } catch { return fallback; }
  },
  set(name, value) { localStorage.setItem('gk6x.' + name, JSON.stringify(value)); },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Profiles saved before Base existed have no layer 0.
const withBase = (p) => ({ [BASE]: {}, ...p });

const state = {
  kb: null,
  modelId: store.get('model', 655491085),
  profile: withBase(store.get('profile', clone(PRESET))),
  // Last keymap known to be on the keyboard. It can't be read back, so the GK6XPlus layout is assumed at first.
  written: withBase(store.get('written', clone(PRESET))),
  // Per-layer lighting: null = keep whatever the keyboard has (never written), or {type:'static'|'effect', ...}
  lighting: validLighting(store.get('lighting', {})),
  writtenLighting: store.get('writtenLighting', {}),
  mode: 'keys',
  lightTab: null,
  color: store.get('paintColor', '#ff5f1f'),
  layer: 1,
  selected: null,
  tab: CATEGORIES[0][0],
  mods: 0,
  query: '',
};

const model = () => MODELS[state.modelId];
const valueOf = (layer, logic, src = state.profile) => src[layer][logic] ?? UNUSED;
const save = () => store.set('profile', state.profile);
const saveLighting = () => store.set('lighting', state.lighting);
// What the layer shows: pending change, else what was last written (unknown if neither).
const shownLighting = (layer) => state.lighting[layer] ?? state.writtenLighting[layer] ?? null;

function kindOf(value) {
  if (value === UNUSED) return 'default';
  if (value === DISABLED) return 'disabled';
  const type = value >>> 24;
  if (type === 0x02) return (value & 0xFFFF00) === 0 ? 'mod' : 'basic';
  if (type === 0x03) return 'media';
  if (type === 0x09) return 'light';
  if (type === 0x01) return 'mouse';
  if (value >>> 16 === 0x0a07 || value >>> 16 === 0x0a06) return 'layer';
  return 'basic';
}

// "Colour by function" palette: navigation stands out, modifiers stay dim, disabled keys stay dark.
const FUNCTION_COLORS = {
  arrow: '#00e5ff', nav: '#2f6bff', edit: '#ff9f1c', media: '#ff3df2', light: '#ffd60a',
  layer: '#9b5cff', mod: '#4a5068', key: '#b8c0d9', off: '#000000',
};
const ARROWS = [0x4F, 0x50, 0x51, 0x52];
const NAV = [0x4A, 0x4B, 0x4D, 0x4E]; // Home, PgUp, End, PgDn
const EDIT = [0x2A, 0x4C]; // Backspace, Delete
const SPACE = 0x2C;

function functionColor(value) {
  const kind = kindOf(value);
  const usage = (value >>> 8) & 0xFF;
  const c = FUNCTION_COLORS;
  if (kind === 'disabled') return c.off;
  if (kind === 'basic' && value >>> 24 === 0x02) {
    if (ARROWS.includes(usage)) return value & 0xFF ? c.nav : c.arrow; // with a modifier: word/line jumps
    if (NAV.includes(usage)) return c.nav;
    if (EDIT.includes(usage)) return c.edit;
    if (usage === SPACE) return c.mod;
    return c.key;
  }
  return { media: c.media, light: c.light, layer: c.layer, mod: c.mod, mouse: c.media }[kind] ?? c.key;
}

function dirtyKeys(layer) {
  const logics = new Set([...Object.keys(state.profile[layer]), ...Object.keys(state.written[layer])]);
  return [...logics].filter((l) => valueOf(layer, l) !== valueOf(layer, l, state.written));
}

const lightingDirty = (layer) =>
  layer !== BASE && !!state.lighting[layer] && !same(state.lighting[layer], state.writtenLighting[layer]);

function tabFor(layer) {
  const entry = state.lighting[layer];
  return entry ? entry.type : 'keep';
}


/* ---------- rendering ---------- */

function renderBoard() {
  const m = model();
  const board = $('board');
  const lighting = state.mode === 'lighting';
  const all = [...m.keys, ...m.leds.map(([loc, x, y, w, h]) => [null, '', x, y, w, h, loc])];
  const width = Math.max(...all.map((k) => k[2] + k[4]));
  const height = Math.max(...all.map((k) => k[3] + k[5]));
  board.style.aspectRatio = `${width} / ${height}`;
  board.classList.toggle('lighting', lighting);
  const dirty = new Set(dirtyKeys(state.layer));
  const box = (x, y, w, h) => `left:${x / width * 100}%;top:${y / height * 100}%;width:${w / width * 100}%;height:${h / height * 100}%`;

  const keys = m.keys.map(([logic, show, x, y, w, h, loc]) => {
    const el = document.createElement('button');
    el.className = 'key';
    el.style.cssText = box(x, y, w, h);
    el.dataset.loc = loc;
    const label = document.createElement('span');
    el.append(label);
    if (logic === FN_LOGIC) {
      el.classList.add('locked');
      el.title = 'Fn is fixed in firmware';
      label.textContent = 'Fn';
      return el;
    }
    const value = valueOf(state.layer, logic);
    const kind = kindOf(value);
    const info = describe(value);
    el.dataset.kind = kind;
    el.dataset.logic = logic;
    label.textContent = kind === 'default' ? show : info.label;
    el.title = `${show}: ${kind === 'default' ? 'firmware default' : info.name}`;
    if (!lighting) {
      el.classList.toggle('selected', state.selected === logic);
      el.classList.toggle('dirty', dirty.has(String(logic)));
    }
    return el;
  });
  const leds = lighting ? m.leds.map(([loc, x, y, w, h]) => {
    const el = document.createElement('div');
    el.className = 'led';
    el.style.cssText = box(x, y, w, h);
    el.dataset.loc = loc;
    return el;
  }) : [];
  board.replaceChildren(...keys, ...leds);
  animate();
}

let frame = 0;
function animate() {
  cancelAnimationFrame(frame);
  const board = $('board');
  if (state.mode !== 'lighting') return;
  const entry = state.layer === BASE ? null : shownLighting(state.layer);
  const colors = previewColors(entry, performance.now() / 1000, model());
  board.classList.toggle('unknown', !entry);
  for (const el of board.querySelectorAll('[data-loc]')) {
    const c = colors.get(+el.dataset.loc);
    el.classList.toggle('lit', !!c);
    if (c) el.style.setProperty('--led', c);
  }
  if (isAnimated(entry, model())) frame = requestAnimationFrame(animate);
}

function renderSelection() {
  const el = $('selection');
  const key = model().keys.find((k) => k[0] === state.selected);
  if (!key) {
    el.textContent = 'Select a key, then pick a keycode or press a key on your keyboard';
    return;
  }
  el.replaceChildren(`${layerName(state.layer)} · `);
  const b = document.createElement('b');
  b.textContent = key[1];
  el.append(b, ` → ${describe(valueOf(state.layer, key[0])).name}`);
}

function renderPicker() {
  const q = state.query.trim().toLowerCase();
  $('tabs').replaceChildren(...CATEGORIES.map(([name]) => {
    const t = document.createElement('button');
    t.textContent = name;
    t.classList.toggle('active', !q && name === state.tab);
    t.onclick = () => { state.tab = name; state.query = ''; $('search').value = ''; renderPicker(); };
    return t;
  }));
  const list = q
    ? CATEGORIES.flatMap(([, l]) => l).filter(([, label, name]) => (label + ' ' + name).toLowerCase().includes(q))
    : CATEGORIES.find(([name]) => name === state.tab)[1];
  const current = state.selected === null ? null : valueOf(state.layer, state.selected);
  $('chips').replaceChildren(...list.map(([value, label, name]) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.title = name;
    c.textContent = value === DISABLED ? '⊘' : value === UNUSED ? 'Default' : label;
    if (name !== label) {
      const small = document.createElement('small');
      small.textContent = name;
      c.append(small);
    }
    c.classList.toggle('current', value === current);
    c.onclick = () => assign(withMods(value, state.mods));
    return c;
  }));
  document.querySelectorAll('#mods button').forEach((b) => b.classList.toggle('on', !!(state.mods & b.dataset.mod)));
}

function renderLightPanel() {
  const base = state.layer === BASE;
  const tab = base ? null : (state.lightTab ?? tabFor(state.layer));
  const entry = state.lighting[state.layer];
  document.querySelectorAll('#light-kind button').forEach((b) => {
    b.classList.toggle('active', b.dataset.kind === tab);
    b.disabled = base;
  });
  $('paint-tools').hidden = tab !== 'static';
  $('effect-tools').hidden = tab !== 'effect';
  $('color').value = state.color;
  $('swatches').replaceChildren(...swatches(SWATCHES, state.color, setColor));

  const note = {
    keep: state.writtenLighting[state.layer]
      ? 'Showing what was last written. Nothing new will be written.'
      : "The keyboard keeps this layer's current lighting. Nothing is written.",
    static: 'Click or drag across keys to paint. Alt-click picks a key\'s colour.',
    effect: entry?.type === 'effect' ? `${effectTitle(entry)} · preview is approximate` : 'Pick an effect.',
  };
  $('light-note').textContent = base ? "Base lighting isn't editable: Base is the safe layer." : note[tab];

  if (tab === 'effect') {
    const effect = entry?.type === 'effect' ? entry : null;
    let group;
    $('effects').replaceChildren(...Object.entries(EFFECTS).flatMap(([name, { label, group: g }]) => {
      const c = document.createElement('button');
      c.className = 'chip';
      c.textContent = label;
      c.classList.toggle('current', effect?.name === name);
      c.onclick = () => setLighting({ type: 'effect', name, color: effect?.color ?? state.color, speed: speedOf(effect?.speed) });
      if (g === group) return [c];
      group = g;
      const h = document.createElement('h4');
      h.textContent = g;
      return [h, c];
    }));
    $('effect-opts').hidden = !effect;
    if (effect) {
      const { colorable, cycle, variants } = EFFECTS[effect.name];
      $('effect-color').hidden = !colorable;
      $('effect-swatches').hidden = !colorable && !variants;
      if (HEX.test(effect.color)) $('effect-color').value = effect.color;
      $('effect-swatches').replaceChildren(...(variants
        ? variantSwatches(variants, effect.variant ?? variants[0].id, (variant) => setLighting({ ...effect, variant }))
        : swatches(cycle ? [...SWATCHES, CYCLE_COLOR] : SWATCHES, effect.color, (color) => setLighting({ ...effect, color }))));
      $('speed').value = speedOf(effect.speed);
      $('speed').title = `Speed ${speedOf(effect.speed)} of ${SPEED.max}`;
    }
  }
}

function effectTitle(entry) {
  const { label, variants } = EFFECTS[entry.name];
  const variant = variants && (variants.find((v) => v.id === entry.variant) ?? variants[0]);
  return variant ? `${label}: ${variant.label}` : label;
}

/** Palette choices drawn like colour swatches; a null palette means the full rainbow. */
function variantSwatches(variants, current, pick) {
  return variants.flatMap(({ id, label, colors, style }, i) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (colors ? '' : ' cycle');
    s.title = label;
    if (colors) s.style.background = `conic-gradient(${[...colors, colors[0]].join(', ')})`;
    s.classList.toggle('on', id === current);
    s.onclick = () => pick(id);
    // A divider between style groups (rainbow | palettes)
    const prev = variants[i - 1];
    if (!prev || (prev.style ?? null) === (style ?? null)) return [s];
    const gap = document.createElement('span');
    gap.className = 'swatch-gap';
    return [gap, s];
  });
}

function swatches(colors, current, pick) {
  return colors.map((color) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (color === CYCLE_COLOR ? ' cycle' : '');
    s.title = color === CYCLE_COLOR ? 'Cycle through all colours' : color;
    if (color !== CYCLE_COLOR) s.style.background = color;
    s.classList.toggle('on', color === current);
    s.onclick = () => pick(color);
    return s;
  });
}

function changeCount() {
  return LAYER_IDS.reduce((n, l) => n + dirtyKeys(l).length + (lightingDirty(l) ? 1 : 0), 0);
}

function renderStatus() {
  const { kb } = state;
  const status = $('status');
  status.classList.toggle('on', !!kb);
  $('status-text').textContent = kb
    ? `${MODELS[kb.info.modelId]?.name ?? 'Unknown model ' + kb.info.modelId} · fw ${kb.info.firmwareVersion}`
    : 'Not connected';
  $('connect').textContent = kb ? 'Disconnect' : 'Connect keyboard';
  $('model').disabled = !!kb;
  $('model').value = state.modelId;
  document.querySelectorAll('#layers button').forEach((b) => b.classList.toggle('active', +b.dataset.layer === state.layer));
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('picker').hidden = state.mode !== 'keys';
  $('light').hidden = state.mode !== 'lighting';
  $('clear').hidden = state.mode !== 'keys';

  const count = changeCount();
  $('dirty').textContent = count ? `${count} unsaved change${count > 1 ? 's' : ''}` : 'All changes written';
  $('dirty').classList.toggle('has', count > 0);
  $('revert').disabled = !count;
  $('write').disabled = !count || !writable();
}

function render() {
  renderBoard();
  if (state.mode === 'keys') {
    renderSelection();
    renderPicker();
  } else {
    renderLightPanel();
  }
  renderStatus();
}

/* ---------- editing ---------- */

function editableKeys() {
  return model().keys.filter((k) => k[0] !== FN_LOGIC).sort((a, b) => a[3] - b[3] || a[2] - b[2]).map((k) => k[0]);
}

function assign(value) {
  if (state.selected === null) return toast('Select a key first');
  state.profile[state.layer][state.selected] = value;
  save();
  const order = editableKeys();
  state.selected = order[order.indexOf(state.selected) + 1] ?? null; // advance like VIA
  render();
}

function setProfile(profile, message) {
  state.profile = profile;
  save();
  render();
  if (message) toast(message);
}

function setLighting(entry, layer = state.layer) {
  state.lighting[layer] = entry;
  state.lightTab = null;
  saveLighting();
  render();
}

function setColor(hex) {
  state.color = hex;
  store.set('paintColor', hex);
  renderLightPanel();
}

/** The layer's static entry, created from what it currently shows if it's static. */
function staticEntry() {
  const shown = shownLighting(state.layer);
  if (state.lighting[state.layer]?.type !== 'static') {
    state.lighting[state.layer] = { type: 'static', colors: shown?.type === 'static' ? clone(shown.colors) : {} };
  }
  return state.lighting[state.layer];
}

function fill(pickColor) {
  const colors = {};
  for (const [logic, , , , , , loc] of model().keys) colors[loc] = pickColor(logic);
  for (const [loc] of model().leds) colors[loc] = pickColor(null);
  setLighting({ type: 'static', colors });
}

/* ---------- device ---------- */

function log(dir, line) {
  const el = $('log');
  el.textContent = (el.textContent + `${dir} ${line}\n`).split('\n').slice(-300).join('\n');
  el.scrollTop = el.scrollHeight;
}

function writable() {
  const { kb } = state;
  return !!kb && MODELS[kb.info.modelId]?.fw === kb.info.firmwareId;
}

function attach(kb) {
  state.kb = kb;
  const m = MODELS[kb.info.modelId];
  if (m) {
    state.modelId = kb.info.modelId;
    store.set('model', state.modelId);
  }
  if (!m) toast(`Unknown model ${kb.info.modelId}. Preview only, writing disabled.`, true);
  else if (m.fw !== kb.info.firmwareId) toast('Firmware ID differs from known data. Writing disabled for safety.', true);
  else toast(`Connected to ${m.name}`);
  render();
}

async function connect() {
  if (state.kb) {
    await state.kb.close();
    state.kb = null;
    return render();
  }
  try {
    const kb = await Keyboard.request(log);
    if (kb) attach(kb);
  } catch (err) {
    toast(err.message, true);
  }
}

function confirmBase() {
  const dialog = $('base-warning');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = () => resolve(dialog.returnValue === 'write');
  });
}

async function write() {
  const { kb } = state;
  if (dirtyKeys(BASE).length && !(await confirmBase())) return;
  const btn = $('write');
  btn.disabled = true;
  btn.textContent = 'Writing…';
  try {
    for (const layer of LAYER_IDS.filter((l) => dirtyKeys(l).length)) {
      const values = new Array(kb.info.keyCount).fill(UNUSED);
      for (const [logic, value] of Object.entries(state.profile[layer])) {
        if (+logic < values.length && +logic !== FN_LOGIC) values[+logic] = value;
      }
      await kb.writeLayer(layer, values);
      state.written[layer] = clone(state.profile[layer]);
      store.set('written', state.written);
    }
    for (const layer of LAYER_IDS.filter(lightingDirty)) {
      await kb.writeLighting(layer, lightingPayload(state.lighting[layer], model()));
      state.writtenLighting[layer] = clone(state.lighting[layer]);
      store.set('writtenLighting', state.writtenLighting);
    }
    // Activates the new data. Always layer 1: landing on layer 3 could leave you without letters.
    await kb.setLayer(1);
    toast('Written to keyboard ✓');
  } catch (err) {
    toast('Write failed: ' + err.message, true);
  } finally {
    btn.textContent = 'Write to keyboard';
    render();
  }
}

/* ---------- import / export ---------- */

function exportProfile() {
  const layers = Object.fromEntries(LAYER_IDS.map((l) => [l, Object.fromEntries(
    Object.entries(state.profile[l]).map(([k, v]) => [k, '0x' + v.toString(16).padStart(8, '0')]))]));
  const data = { app: 'gk6x-studio', version: 2, modelId: state.modelId, layers, lighting: state.lighting };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gk6x-${model().name.replace(/\W+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function checkLighting(entry, layer) {
  if (!entry) return null;
  if (!isValidEntry(entry)) throw new Error(`Bad lighting for ${layerName(+layer)}`);
  return entry;
}

async function importProfile(file) {
  try {
    const data = JSON.parse(await file.text());
    const profile = Object.fromEntries(LAYER_IDS.map((l) => [l, Object.fromEntries(
      Object.entries(data.layers?.[l] ?? {}).map(([k, v]) => {
        const n = typeof v === 'string' ? parseInt(v, 16) : v;
        if (!Number.isInteger(n) || n < 0 || n > UNUSED) throw new Error(`Bad value for key ${k}`);
        return [k, n];
      }))]));
    const lighting = Object.fromEntries([1, 2, 3].map((l) => [l, checkLighting(data.lighting?.[l], l)]));
    state.lighting = lighting;
    saveLighting();
    setProfile(profile, 'Profile imported');
  } catch (err) {
    toast('Import failed: ' + err.message, true);
  }
}

/* ---------- misc UI ---------- */

let toastTimer;
function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function toggleMenu(id, force) {
  const el = $(id);
  el.hidden = force ?? !el.hidden;
}

function initLighting() {
  $('mode').onclick = (e) => {
    const { mode } = e.target.dataset;
    if (mode) { state.mode = mode; state.selected = null; render(); }
  };
  $('light-kind').onclick = (e) => {
    const { kind } = e.target.dataset;
    if (!kind) return;
    if (kind === 'keep') setLighting(null);
    if (kind === 'static') { staticEntry(); setLighting(state.lighting[state.layer]); }
    if (kind === 'effect') { state.lightTab = 'effect'; render(); }
  };
  $('color').oninput = (e) => setColor(e.target.value);
  $('fill').onclick = () => fill(() => state.color);
  $('off').onclick = () => fill(() => '#000000');
  // A key that switches to this layer elsewhere is the one being held: keep it lit as a layer key.
  const holdsThisLayer = (logic) => LAYER_IDS.some((l) => l !== state.layer && kindOf(valueOf(l, logic)) === 'layer');
  $('by-function').onclick = () => fill((logic) => {
    if (logic === null || logic === FN_LOGIC) return FUNCTION_COLORS.layer;
    const value = valueOf(state.layer, logic);
    return value === DISABLED && holdsThisLayer(logic) ? FUNCTION_COLORS.layer : functionColor(value);
  });
  $('mapped').onclick = () => fill((logic) =>
    logic === null || logic === FN_LOGIC || valueOf(state.layer, logic) !== DISABLED ? state.color : '#000000');
  const effectEntry = () => state.lighting[state.layer];
  $('effect-color').oninput = (e) => setLighting({ ...effectEntry(), color: e.target.value });
  $('speed').onchange = (e) => setLighting({ ...effectEntry(), speed: +e.target.value });

  // Drag to paint; alt-click picks a colour.
  let painting = false;
  const paint = (e) => {
    const loc = e.target.closest('[data-loc]')?.dataset.loc;
    if (loc === undefined) return;
    const entry = staticEntry();
    entry.colors[loc] = state.color;
    animate();
  };
  $('board').addEventListener('pointerdown', (e) => {
    if (state.mode !== 'lighting' || state.layer === BASE || tabFor(state.layer) !== 'static') return;
    const loc = e.target.closest('[data-loc]')?.dataset.loc;
    if (loc === undefined) return;
    e.preventDefault();
    if (e.altKey) return setColor(state.lighting[state.layer].colors[loc] ?? '#000000');
    painting = true;
    paint(e);
  });
  $('board').addEventListener('pointerover', (e) => { if (painting) paint(e); });
  window.addEventListener('pointerup', () => {
    if (!painting) return;
    painting = false;
    saveLighting();
    renderStatus();
  });
}

function init() {
  $('model').append(...Object.entries(MODELS)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, m]) => new Option(`${m.name} (${id})`, id)));
  $('model').onchange = (e) => {
    state.modelId = +e.target.value;
    state.selected = null;
    store.set('model', state.modelId);
    render();
  };

  $('connect').onclick = connect;
  $('write').onclick = write;
  $('revert').onclick = () => {
    state.lighting = clone(state.writtenLighting);
    saveLighting();
    setProfile(clone(state.written), 'Reverted to last written state');
  };
  $('clear').onclick = () => {
    state.profile[state.layer] = {};
    setProfile(state.profile, `${layerName(state.layer)} cleared to firmware defaults`);
  };

  $('layers').onclick = (e) => {
    const { layer } = e.target.dataset;
    if (layer !== undefined) { state.layer = +layer; state.lightTab = null; render(); }
  };

  $('board').onclick = (e) => {
    if (state.mode !== 'keys') return;
    const key = e.target.closest('.key');
    state.selected = key?.dataset.logic !== undefined && state.selected !== +key.dataset.logic ? +key.dataset.logic : null;
    render();
  };

  $('mods').onclick = (e) => {
    const bit = +e.target.dataset.mod;
    if (bit) { state.mods ^= bit; renderPicker(); }
  };
  $('search').oninput = (e) => { state.query = e.target.value; renderPicker(); };

  $('copy').onclick = () => {
    const lighting = state.mode === 'lighting';
    const targets = LAYER_IDS.filter((l) => l !== state.layer && !(lighting && l === BASE));
    $('copy-list').replaceChildren(...targets.map((l) => {
      const b = document.createElement('button');
      b.textContent = layerName(l);
      b.onclick = () => {
        const what = lighting ? 'lighting' : 'keys';
        if (lighting) setLighting(clone(shownLighting(state.layer)), l);
        else setProfile(Object.assign(state.profile, { [l]: clone(state.profile[state.layer]) }));
        toast(`Copied ${layerName(state.layer)} ${what} to ${layerName(l)}`);
      };
      return b;
    }));
    toggleMenu('copy-list');
  };
  $('more').onclick = () => toggleMenu('more-list');
  $('more-list').onclick = (e) => {
    const action = e.target.dataset.action;
    if (action === 'export') exportProfile();
    if (action === 'import') $('file').click();
    if (action === 'preset') setProfile(clone(PRESET), 'Loaded your default keymap');
    if (action === 'log') $('log').hidden = !$('log').hidden;
  };
  $('file').onchange = (e) => { if (e.target.files[0]) importProfile(e.target.files[0]); e.target.value = ''; };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) { toggleMenu('copy-list', true); toggleMenu('more-list', true); }
    else if (e.target.closest('.menu-list')) { toggleMenu('copy-list', true); toggleMenu('more-list', true); }
  });

  // With a key selected, pressing a physical key assigns it.
  document.addEventListener('keydown', (e) => {
    if (state.selected === null || e.target.matches('input, select') || e.repeat || $('base-warning').open) return;
    const value = valueForCode(e.code);
    if (value === undefined) return;
    e.preventDefault();
    assign(value);
  });

  initLighting();
  window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message ?? String(e.reason), true));

  if (!navigator.hid) {
    $('no-hid').hidden = false;
    $('connect').disabled = true;
  } else {
    navigator.hid.addEventListener('disconnect', (e) => {
      if (state.kb?.device === e.device) {
        state.kb = null;
        toast('Keyboard disconnected', true);
        render();
      }
    });
    Keyboard.paired(log).then((kb) => kb && attach(kb)).catch(() => {});
  }

  if (!model()) state.modelId = +Object.keys(MODELS)[0];
  render();
}

init();
