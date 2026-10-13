// GK6X "driver values": 32-bit key actions, as reverse-engineered by pixeltris/GK6X (KeyValues.cs).
// Standard keys are 0x02 << 24 | HID usage << 8 | modifier mask.

export const UNUSED = 0xFFFFFFFF; // keyboard falls back to its firmware default
export const DISABLED = 0x02000000;

const key = (usage, mods = 0) => (0x02000000 | (usage << 8) | mods) >>> 0;

// [value, keycap label, full name, KeyboardEvent.code]
const basic = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => [key(0x04 + i), c, c, 'Key' + c]),
  ...'1234567890'.split('').map((c, i) => [key(0x1E + i), c, c, 'Digit' + c]),
  [key(0x29), 'Esc', 'Escape', 'Escape'],
  [key(0x35), '`', 'Backtick', 'Backquote'],
  [key(0x2D), '-', 'Minus', 'Minus'],
  [key(0x2E), '=', 'Equal', 'Equal'],
  [key(0x2A), '⌫', 'Backspace', 'Backspace'],
  [key(0x2B), 'Tab', 'Tab', 'Tab'],
  [key(0x2F), '[', 'Left bracket', 'BracketLeft'],
  [key(0x30), ']', 'Right bracket', 'BracketRight'],
  [key(0x31), '\\', 'Backslash', 'Backslash'],
  [key(0x39), 'Caps', 'Caps Lock', 'CapsLock'],
  [key(0x33), ';', 'Semicolon', 'Semicolon'],
  [key(0x34), "'", 'Quote', 'Quote'],
  [key(0x28), '⏎', 'Enter', 'Enter'],
  [key(0x36), ',', 'Comma', 'Comma'],
  [key(0x37), '.', 'Period', 'Period'],
  [key(0x38), '/', 'Slash', 'Slash'],
  [key(0x2C), 'Space', 'Space', 'Space'],
  [key(0x64), 'ISO \\', 'ISO backslash', 'IntlBackslash'],
  [key(0x65), 'Menu', 'Menu', 'ContextMenu'],
  [key(0x52), '↑', 'Up', 'ArrowUp'],
  [key(0x51), '↓', 'Down', 'ArrowDown'],
  [key(0x50), '←', 'Left', 'ArrowLeft'],
  [key(0x4F), '→', 'Right', 'ArrowRight'],
  [key(0x49), 'Ins', 'Insert', 'Insert'],
  [key(0x4C), 'Del', 'Delete', 'Delete'],
  [key(0x4A), 'Home', 'Home', 'Home'],
  [key(0x4D), 'End', 'End', 'End'],
  [key(0x4B), 'PgUp', 'Page Up', 'PageUp'],
  [key(0x4E), 'PgDn', 'Page Down', 'PageDown'],
  [key(0x46), 'PrtSc', 'Print Screen', 'PrintScreen'],
  [key(0x47), 'ScrLk', 'Scroll Lock', 'ScrollLock'],
  [key(0x48), 'Pause', 'Pause', 'Pause'],
];

const fkeys = [
  ...Array.from({ length: 12 }, (_, i) => [key(0x3A + i), 'F' + (i + 1), 'F' + (i + 1), 'F' + (i + 1)]),
  ...Array.from({ length: 12 }, (_, i) => [key(0x68 + i), 'F' + (i + 13), 'F' + (i + 13), 'F' + (i + 13)]),
];

const mods = [
  [key(0, 0x01), 'Ctrl', 'Left Ctrl', 'ControlLeft'],
  [key(0, 0x02), 'Shift', 'Left Shift', 'ShiftLeft'],
  [key(0, 0x04), 'Alt', 'Left Alt / Option', 'AltLeft'],
  [key(0, 0x08), 'Win', 'Left Win / Cmd', 'MetaLeft'],
  [key(0, 0x10), 'RCtrl', 'Right Ctrl', 'ControlRight'],
  [key(0, 0x20), 'RShift', 'Right Shift', 'ShiftRight'],
  [key(0, 0x40), 'RAlt', 'Right Alt / Option', 'AltRight'],
  [key(0, 0x80), 'RWin', 'Right Win / Cmd', 'MetaRight'],
];

const numpad = [
  ...'1234567890'.split('').map((c, i) => [key(0x59 + i), 'Num ' + c, 'Numpad ' + c, 'Numpad' + c]),
  [key(0x53), 'NumLk', 'Num Lock', 'NumLock'],
  [key(0x54), 'Num /', 'Numpad /', 'NumpadDivide'],
  [key(0x55), 'Num *', 'Numpad *', 'NumpadMultiply'],
  [key(0x56), 'Num -', 'Numpad -', 'NumpadSubtract'],
  [key(0x57), 'Num +', 'Numpad +', 'NumpadAdd'],
  [key(0x58), 'Num ⏎', 'Numpad Enter', 'NumpadEnter'],
  [key(0x63), 'Num .', 'Numpad .', 'NumpadDecimal'],
];

const media = [
  [0x030000CD, 'Play', 'Play / Pause'],
  [0x030000B6, 'Prev', 'Previous track'],
  [0x030000B5, 'Next', 'Next track'],
  [0x030000B7, 'Stop', 'Stop'],
  [0x030000E2, 'Mute', 'Mute'],
  [0x030000EA, 'Vol −', 'Volume down'],
  [0x030000E9, 'Vol +', 'Volume up'],
  [0x03000183, 'Player', 'Media player'],
  [0x03000192, 'Calc', 'Calculator'],
  [0x0300018A, 'Mail', 'Email'],
  [0x03000194, 'PC', 'My computer'],
  [0x03000223, 'WWW', 'Browser home'],
  [0x03000221, 'Search', 'Browser search'],
  [0x03000224, 'Back', 'Browser back'],
  [0x03000225, 'Fwd', 'Browser forward'],
  [0x03000227, 'Reload', 'Browser refresh'],
];

const lighting = [
  [0x09020002, '☀−', 'Backlight down'],
  [0x09020001, '☀+', 'Backlight up'],
  [0x09060002, 'LED', 'Backlight on / off'],
  [0x09060001, 'LED ⏸', 'Pause lighting'],
  [0x09030002, 'FX −', 'Effect slower'],
  [0x09030001, 'FX +', 'Effect faster'],
  [0x09010010, 'FX ⇄', 'Next lighting effect'],
  [0x09010011, 'React ⇄', 'Next reactive effect'],
];

const mouse = [
  [0x01010001, 'LMB', 'Left click'],
  [0x01010002, 'RMB', 'Right click'],
  [0x01010004, 'MMB', 'Middle click'],
  [0x01010008, 'M4', 'Mouse back'],
  [0x01010010, 'M5', 'Mouse forward'],
];

const layers = [
  [0x0a070002, 'Hold L1', 'Layer 1 while held'],
  [0x0a070003, 'Hold L2', 'Layer 2 while held'],
  [0x0a070004, 'Hold L3', 'Layer 3 while held'],
  [0x0a060002, '→ L1', 'Switch to layer 1'],
  [0x0a060003, '→ L2', 'Switch to layer 2'],
  [0x0a060004, '→ L3', 'Switch to layer 3'],
];

const special = [
  [DISABLED, '', 'Disabled'],
  [UNUSED, '', 'Firmware default'],
  [0x0A020002, 'WinLk', 'Toggle Win key lock'],
];

export const CATEGORIES = [
  ['Basic', basic], ['Modifiers', mods], ['F-keys', fkeys], ['Media', media],
  ['Lighting', lighting], ['Mouse', mouse], ['Layers', layers], ['Numpad', numpad], ['Special', special],
];

const byValue = new Map();
const byCode = new Map();
for (const [, list] of CATEGORIES) {
  for (const [value, label, name, code] of list) {
    if (!byValue.has(value)) byValue.set(value, { label, name });
    if (code) byCode.set(code, value);
  }
}

const MOD_NAMES = ['Ctrl', 'Shift', 'Alt', 'Win', 'RCtrl', 'RShift', 'RAlt', 'RWin'];

/** Keycap label and long name for any driver value, including modifier combos like Ctrl+C. */
export function describe(value) {
  const known = byValue.get(value);
  if (known) return known;
  if (value >>> 24 === 0x02) {
    const mask = value & 0xFF;
    const base = byValue.get((value & 0xFFFFFF00) >>> 0);
    const prefix = MOD_NAMES.filter((_, i) => mask & (1 << i)).join('+');
    if (prefix && (value & 0xFFFFFF00) >>> 0 === DISABLED) return { label: prefix, name: prefix };
    if (base && prefix) {
      return { label: prefix + '+' + base.label, name: prefix + ' + ' + base.name };
    }
  }
  const hex = '0x' + value.toString(16).padStart(8, '0');
  return { label: hex, name: 'Unknown ' + hex };
}

export const valueForCode = (code) => byCode.get(code);

/** Adds a modifier mask to a standard key; other action types can't carry modifiers. */
export function withMods(value, mask) {
  return value >>> 24 === 0x02 && value !== DISABLED ? (value | mask) >>> 0 : value;
}
