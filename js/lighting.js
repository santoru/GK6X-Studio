// Lighting effect encoding (ported from pixeltris/GK6X KeyboardDevice.SetLighting) and an approximate preview.
// Effects address LEDs by location code (0-175).
import { buildEffect } from './effects.js';

const MAX_EFFECTS = 32; // header slots; layers 1-3 hold one effect
const LEDS = 176;
const MASK_BYTES = LEDS / 8;
const TYPE_STATIC = 0;
const TYPE_DYNAMIC = 3;
const BREATHING = 2;

const rgb = (hex) => parseInt(hex.slice(1), 16);
// Keyboard colour layout is 0xAABBGGRR
const toDevice = (hex, alpha) => {
  const c = rgb(hex);
  return (((c >> 16) & 0xFF) | (c & 0xFF00) | ((c & 0xFF) << 16) | (alpha << 24)) >>> 0;
};

function mask(locations) {
  const bytes = new Uint8Array(MASK_BYTES);
  for (const loc of locations) bytes[loc >> 3] |= 1 << (loc & 7);
  return bytes;
}

/** Resolves a layer lighting entry ({type:'static', colors} or {type:'effect', ...}) to effect data. */
const effectData = (entry, model) => (entry?.type === 'effect' ? buildEffect(entry, model) : null);

/** Bytes for opcode 0x27 (set layer lighting): 32 header slots, then the effect data. */
export function lightingPayload(entry, model) {
  const parts = [];
  let size = MAX_EFFECTS * 16;
  const push = (bytes) => { parts.push(bytes); size += bytes.length; };
  const u16 = (...v) => { const b = new DataView(new ArrayBuffer(v.length * 2)); v.forEach((x, i) => b.setUint16(i * 2, x, true)); return new Uint8Array(b.buffer); };
  const u32 = (...v) => { const b = new DataView(new ArrayBuffer(v.length * 4)); v.forEach((x, i) => b.setUint32(i * 4, x >>> 0, true)); return new Uint8Array(b.buffer); };

  let slot;
  if (entry.type === 'static') {
    const colors = new Array(LEDS).fill(0);
    for (const [loc, hex] of Object.entries(entry.colors)) {
      if (+loc < LEDS) colors[+loc] = rgb(hex) ? toDevice(hex, 0xFF) : 0;
    }
    slot = [size, 1, 0, 0];
    push(u16(TYPE_STATIC, LEDS * 4));
    push(u32(...colors));
  } else {
    const effect = effectData(entry, model);
    if (!effect) throw new Error(`Unknown lighting effect "${entry.name}"`);
    const { frames, params } = effect;
    const data1 = size;
    let total = 0;
    for (const [repeat, locations] of frames) {
      for (let i = 0; i < repeat; i++, total++) {
        push(u16(TYPE_DYNAMIC, MASK_BYTES));
        push(mask(locations));
      }
    }
    const data2 = size;
    for (const [kind, hex, val1, val2, locations] of params) {
      push(new Uint8Array([kind, 32]));
      push(mask(locations));
      push(u32(toDevice(hex, 0)));
      push(kind === BREATHING
        ? u16(val1 ? Math.trunc(100 / val1) : 0, val2)
        : u16(val1 ? Math.trunc(360 / val1) : 0, 0));
    }
    slot = [data1, total, data2, params.length];
  }

  const header = new Int32Array(MAX_EFFECTS * 4).fill(-1);
  header.set(slot);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  header.forEach((v, i) => view.setInt32(i * 4, v, true));
  let offset = MAX_EFFECTS * 16;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

const hsl = (h, s, l) => `hsl(${h % 360} ${s}% ${l}%)`;

function hueOf(hex) {
  const c = rgb(hex);
  const [r, g, b] = [(c >> 16) / 255, ((c >> 8) & 0xFF) / 255, (c & 0xFF) / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return (h * 60 + 360) % 360;
}

/**
 * Approximate colours per location at time `t` (seconds), for the on-screen preview only.
 * Returns a Map of location -> CSS colour; unlit LEDs are absent.
 */
export function previewColors(entry, t, model) {
  const out = new Map();
  if (entry?.type === 'static') {
    for (const [loc, hex] of Object.entries(entry.colors)) if (rgb(hex)) out.set(+loc, hex);
    return out;
  }
  const effect = effectData(entry, model);
  if (!effect) return out;
  const total = effect.frames.reduce((n, [repeat]) => n + repeat, 0);
  let tick = Math.floor(t * 20) % total; // ~20 frames per second
  const frame = effect.frames.find(([repeat]) => (tick -= repeat) < 0);
  for (const loc of frame[1]) {
    const param = effect.params.find((p) => p[4].includes(loc));
    if (!param) continue;
    const [kind, hex, val1] = param;
    const speed = val1 ? 360 / val1 : 6;
    if (kind === 0) out.set(loc, hex);
    else if (kind === 1) out.set(loc, hsl(Math.floor(hueOf(hex) + t * 20 * speed), 90, 60));
    else {
      // Firmware steps brightness by 100/val1 per tick and starts from dark: one breath is 200/step ticks.
      const step = val1 ? Math.trunc(100 / val1) : 1;
      const level = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * (20 * step / 200));
      const c = rgb(hex);
      out.set(loc, `rgb(${(c >> 16) * level | 0} ${((c >> 8) & 0xFF) * level | 0} ${(c & 0xFF) * level | 0})`);
    }
  }
  return out;
}

export const isAnimated = (entry, model) => {
  const e = effectData(entry, model);
  return !!e && (e.frames.length > 1 || e.params.some((p) => p[0] !== 0));
};
