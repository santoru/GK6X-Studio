// Default keymap, keyed by GK61 logic code. Layers 1-2 are the GK6XPlus layout; layer 3 is a macOS-friendly
// navigation layer.
import { CATEGORIES, DISABLED, withMods } from './keycodes.js';

const code = Object.fromEntries(CATEGORIES.flatMap(([, list]) => list).map(([v, , name]) => [name, v]));

// logic code -> standard key, for the 60% ANSI GK61 matrix
const STANDARD = {
  47: 'Escape', 36: '1', 37: '2', 38: '3', 39: '4', 40: '5', 41: '6', 42: '7', 43: '8', 44: '9', 45: '0',
  51: 'Minus', 52: 'Equal', 48: 'Backspace',
  49: 'Tab', 26: 'Q', 32: 'W', 14: 'E', 27: 'R', 29: 'T', 34: 'Y', 30: 'U', 18: 'I', 24: 'O', 25: 'P',
  53: 'Left bracket', 54: 'Right bracket', 55: 'Backslash',
  62: 'Caps Lock', 10: 'A', 28: 'S', 13: 'D', 15: 'F', 16: 'G', 17: 'H', 19: 'J', 20: 'K', 21: 'L',
  56: 'Semicolon', 57: 'Quote', 46: 'Enter',
  3: 'Left Shift', 35: 'Z', 33: 'X', 12: 'C', 31: 'V', 11: 'B', 23: 'N', 22: 'M',
  59: 'Comma', 60: 'Period', 61: 'Slash', 7: 'Right Shift',
  2: 'Left Ctrl', 5: 'Left Win / Cmd', 4: 'Left Alt / Option', 50: 'Space',
  8: 'Right Alt / Option', 1: 'Menu', 6: 'Right Ctrl',
};

const resolve = (map) => Object.fromEntries(Object.entries(map).map(([k, name]) => [k, code[name]]));

const main = resolve({
  ...STANDARD,
  5: 'Left Alt / Option', // Ctrl, Alt, Win: Mac order
  4: 'Left Win / Cmd',
  8: 'Left Win / Cmd',
  1: 'Layer 3 while held',
});

const ALT = 0x04;
const CMD = 0x08;

// Modifiers stay live (GK6X has no pass-through), so Shift/Option/Cmd + arrows work as on a Mac keyboard.
const layer3 = {
  ...Object.fromEntries(Object.keys(STANDARD).map((k) => [k, DISABLED])),
  ...resolve({
    47: 'Backtick', 36: 'Backlight down', 37: 'Backlight up',
    42: 'Previous track', 43: 'Play / Pause', 44: 'Next track',
    45: 'Mute', 51: 'Volume down', 52: 'Volume up', 48: 'Delete',
    25: 'Up', 21: 'Left', 56: 'Down', 57: 'Right', // right-hand arrows: P / L ; '
    14: 'Up', 28: 'Left', 13: 'Down', 15: 'Right', // left-hand arrows: E / S D F
    54: 'Page Up', 55: 'Page Down',
    3: 'Left Shift', 7: 'Right Shift', 2: 'Left Ctrl', 6: 'Right Ctrl',
    5: 'Left Alt / Option', 4: 'Left Win / Cmd', 8: 'Left Win / Cmd', 50: 'Space',
  }),
  20: withMods(code.Left, ALT), // K: word left
  46: withMods(code.Right, ALT), // Enter: word right
  24: withMods(code.Left, CMD), // O: line start
  53: withMods(code.Right, CMD), // [: line end
};

// Base is never touched by GK6XPlus, so it's left at firmware defaults.
export const PRESET = { 0: {}, 1: main, 2: { ...main }, 3: layer3 };
