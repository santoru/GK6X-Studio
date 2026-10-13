// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, crcValid, buildReports, keyPayload } from '../js/protocol.js';
import { describe, withMods, UNUSED, DISABLED } from '../js/keycodes.js';
import { PRESET } from '../js/preset.js';
import { MODELS } from '../js/models.js';

test('crc16 is CRC-16/CCITT-FALSE', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29B1);
});

test('simple command: opcode, op3 in byte 2, little-endian crc in bytes 6-7', () => {
  const [r] = buildReports(0x21, 2, null, 1);
  assert.equal(r.length, 64);
  assert.deepEqual([...r.subarray(0, 6)], [0x21, 2, 1, 0, 0, 0]);
  const copy = Uint8Array.from(r);
  copy[6] = copy[7] = 0;
  const crc = crc16(copy);
  assert.deepEqual([r[6], r[7]], [crc & 0xFF, crc >> 8]);
  assert.ok(crcValid(r));
});

test('payload is chunked in 0x38-byte pieces with offset and length', () => {
  const payload = keyPayload(new Array(128).fill(0x02000400)); // 512 bytes
  const reports = buildReports(0x22, 4, payload);
  assert.equal(reports.length, 10);
  reports.forEach((r, i) => {
    const offset = i * 0x38;
    assert.equal(r[2] | (r[3] << 8), offset);
    assert.equal(r[4], Math.min(0x38, 512 - offset));
    assert.ok(crcValid(r));
  });
  assert.deepEqual([...reports[0].subarray(8, 12)], [0x00, 0x04, 0x00, 0x02]); // uint32 LE
});

test('payload that fits one report carries no offset/length (matches pixeltris)', () => {
  const [r, extra] = buildReports(0x22, 2, new Uint8Array(8).fill(7));
  assert.equal(extra, undefined);
  assert.deepEqual([r[2], r[3], r[4]], [0, 0, 0]);
});

test('exact multiple of 0x38 sends a trailing empty chunk (matches pixeltris)', () => {
  const reports = buildReports(0x22, 2, new Uint8Array(0x38 * 2));
  assert.equal(reports.length, 3);
  assert.equal(reports[2][4], 0);
});

test('keycode labels', () => {
  assert.equal(describe(0x02000400).label, 'A');
  assert.equal(describe(withMods(0x02000600, 0x01)).label, 'Ctrl+C');
  assert.equal(withMods(0x030000CD, 0x01), 0x030000CD);
  assert.equal(withMods(DISABLED, 0x01), DISABLED);
});

test('preset resolves every key and maps onto every GK61 layout', () => {
  for (const layer of [1, 2, 3]) {
    for (const [logic, value] of Object.entries(PRESET[layer])) {
      assert.ok(Number.isInteger(value) && value !== UNUSED, `layer ${layer} key ${logic}`);
      assert.doesNotMatch(describe(value).name, /Unknown/);
    }
  }
  assert.equal(PRESET[1][1], 0x0a070004); // Layer3 key: hold
  const logics = new Set(MODELS[655491085].keys.map((k) => String(k[0])));
  for (const logic of Object.keys(PRESET[1])) assert.ok(logics.has(logic), `logic ${logic} on GK61`);
});

test('handshake and layer write against a mock keyboard', async () => {
  const sent = [];
  const listeners = [];
  const respond = (req) => {
    const r = new Uint8Array(64);
    r[0] = req[0]; r[1] = req[1]; r[2] = 1;
    const view = new DataView(r.buffer);
    if (req[0] === 0x01 && req[1] === 0x09) { r[8] = 8; r[9] = 16; }
    if (req[0] === 0x01 && req[1] === 0x01) { view.setUint32(8, 0x02103701, true); r[12] = 3; r[13] = 1; }
    if (req[0] === 0x01 && req[1] === 0x08) {
      view.setUint32(8, 655491085, true);
      view.setUint16(14, crc16(r.subarray(8, 14)), true);
    }
    r[6] = r[7] = 0;
    view.setUint16(6, crc16(r), true);
    return r;
  };
  const device = {
    opened: true,
    addEventListener: (_, fn) => listeners.push(fn),
    async sendReport(id, data) {
      assert.equal(id, 0);
      sent.push(data);
      const r = respond(data);
      setTimeout(() => listeners.forEach((fn) => fn({ data: new DataView(r.buffer) })));
    },
  };
  const { Keyboard } = await import('../js/protocol.js');
  const kb = await Keyboard.open(device);
  assert.deepEqual(kb.info, { keyCount: 128, firmwareId: 0x02103701, firmwareVersion: '1.3', modelId: 655491085 });
  assert.equal(MODELS[kb.info.modelId].fw, kb.info.firmwareId);

  sent.length = 0;
  await kb.writeLayer(3, new Array(128).fill(UNUSED));
  assert.deepEqual([...sent[0].subarray(0, 3)], [0x21, 4, 1]); // reset layer 3 key set
  assert.equal(sent.length, 1 + 10); // reset + 512 bytes in 10 chunks
  assert.ok(sent.slice(1).every((r) => r[0] === 0x22 && r[1] === 4));
});

test('static lighting payload: header slot, type 0, 176 ABGR colours with alpha', async () => {
  const { lightingPayload } = await import('../js/lighting.js');
  const p = lightingPayload({ type: 'static', colors: { 5: '#112233', 6: '#000000' } });
  const v = new DataView(p.buffer);
  assert.equal(p.length, 512 + 4 + 704);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt32(i * 4, true)), [512, 1, 0, 0]);
  assert.equal(v.getInt32(16, true), -1); // unused slots
  assert.deepEqual([v.getUint16(512, true), v.getUint16(514, true)], [0, 704]);
  assert.equal(v.getUint32(516 + 5 * 4, true), 0xFF332211);
  assert.equal(v.getUint32(516 + 6 * 4, true), 0);
});

test('dynamic lighting payload: frames, then params with scaled speed', async () => {
  const { lightingPayload } = await import('../js/lighting.js');
  const gk61 = MODELS[655491085];
  const p = lightingPayload({ type: 'effect', name: 'breathing', color: '#00ff00', speed: 10 }, gk61);
  const v = new DataView(p.buffer);
  const data2 = 512 + 26;
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt32(i * 4, true)), [512, 1, data2, 1]);
  assert.deepEqual([v.getUint16(512, true), v.getUint16(514, true)], [3, 22]);
  const esc = gk61.keys.find((k) => k[1] === 'Esc')[6];
  assert.ok(p[516 + (esc >> 3)] & (1 << (esc & 7)), 'Esc lit');
  assert.deepEqual([p[data2], p[data2 + 1]], [2, 32]); // breathing
  assert.equal(v.getUint32(data2 + 24, true), 0x0000FF00); // green as 0x00BBGGRR
  assert.deepEqual([v.getUint16(data2 + 28, true), v.getUint16(data2 + 30, true)], [20, 2]); // 100/5, stay
  assert.equal(p.length, data2 + 32);

  const hueStep = (speed) => {
    const r = new DataView(lightingPayload({ type: 'effect', name: 'rainbow', speed }, gk61).buffer);
    assert.equal(r.getInt32(12, true), 12); // 12 colour bands
    return r.getUint16(r.getInt32(8, true) + 28, true);
  };
  assert.equal(hueStep(10), 30); // 360/12
  assert.equal(hueStep(1), 1); // 360/300
  assert.equal(hueStep('medium'), hueStep(5)); // legacy preset
});

test('every effect builds for every model and speed', async () => {
  const { EFFECTS, SPEED, MAX_PARAMS, MAX_TICKS, buildEffect } = await import('../js/effects.js');
  const { lightingPayload } = await import('../js/lighting.js');
  for (const model of Object.values(MODELS)) {
    const locs = new Set([...model.keys.map((k) => k[6]), ...model.leds.map((l) => l[0])]);
    for (const name of Object.keys(EFFECTS)) {
      for (let speed = SPEED.min; speed <= SPEED.max; speed++) {
        for (const variant of EFFECTS[name].variants?.map((v) => v.id) ?? [undefined]) {
        const entry = { type: 'effect', name, color: '#ff8800', speed, variant };
        const { frames, params } = buildEffect(entry, model);
        const covered = new Set(params.flatMap((p) => p[4]));
        for (const [repeat, lit] of frames) {
          assert.ok(repeat >= 1);
          for (const l of lit) assert.ok(locs.has(l) && covered.has(l), `${name} ${model.name} loc ${l}`);
        }
        assert.ok(frames.some(([, lit]) => lit.length), `${name} lights something`);
        assert.ok(params.length <= MAX_PARAMS, `${name} has ${params.length} colour groups`);
        for (const [kind, , count] of params) {
          if (kind === 1) assert.ok(Math.trunc(360 / count) >= 1, `${name} hue step at speed ${speed}`);
          if (kind === 2) assert.ok(Math.trunc(100 / count) >= 1, `${name} breathing step at speed ${speed}`);
        }
        assert.ok(frames.reduce((n, [repeat]) => n + repeat, 0) <= MAX_TICKS, `${name} speed ${speed} length`);
        }
      }
    }
  }
});

test('lighting reports carry chunk length in byte 5', () => {
  const reports = buildReports(0x27, 2, new Uint8Array(1220));
  assert.equal(reports.length, 22);
  assert.deepEqual([reports[1][2], reports[1][3], reports[1][4], reports[1][5]], [0x38, 0, 0, 0x38]);
  assert.equal(reports[21][5], 1220 - 21 * 0x38);
});
