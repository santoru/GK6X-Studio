// GK6X HID protocol over WebHID. Ported from pixeltris/GK6X (KeyboardDevice.cs, KeyboardDeviceManager.cs).
// Only commands that pixeltris uses in production are implemented, on purpose: unknown opcodes may
// overwrite configuration that cannot be read back.

export const VENDOR_ID = 0x1EA7;
export const PRODUCT_ID = 0x0907;
const USAGE_PAGE = 0xFF00;

const OP = { INFO: 0x01, SET_LAYER: 0x0B, RESET_DATA: 0x21, SET_KEYS: 0x22, SET_LIGHTING: 0x27 };
const INFO = { FIRMWARE: 0x01, MODEL: 0x08, BUFFERS: 0x09 };
const DATA_KEYSET = 1;
const DATA_LIGHTING = 6;
const CHUNK = 0x38;
const TIMEOUT_MS = 1500;

export const LAYERS = { 0: 1, 1: 2, 2: 3, 3: 4 }; // UI layer (0 = Base) -> firmware layer id

const CRC_TABLE = Uint16Array.from({ length: 256 }, (_, i) => {
  let c = i << 8;
  for (let b = 0; b < 8; b++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
  return c & 0xFFFF;
});

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF). */
export function crc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) crc = (CRC_TABLE[(b ^ (crc >> 8)) & 0xFF] ^ (crc << 8)) & 0xFFFF;
  return crc;
}

function withCrc(report) {
  report[6] = report[7] = 0;
  const crc = crc16(report);
  report[6] = crc & 0xFF;
  report[7] = crc >> 8;
  return report;
}

export function crcValid(report) {
  const copy = Uint8Array.from(report);
  copy[6] = copy[7] = 0;
  const crc = crc16(copy);
  return report[6] === (crc & 0xFF) && report[7] === crc >> 8;
}

/**
 * Splits a command into 64-byte reports. Byte-for-byte equivalent to pixeltris WritePacket for the
 * opcodes used here: [op1, op2, offset lo|op3, offset hi, chunk len, 0, crc lo, crc hi, payload...].
 * Lighting (0x27) puts the chunk length in byte 5 instead of 4.
 */
export function buildReports(op1, op2, payload = null, op3 = 0) {
  const lengthAt = op1 === OP.SET_LIGHTING ? 5 : 4;
  const count = payload ? Math.floor(payload.length / CHUNK) + 1 : 1;
  const reports = [];
  for (let i = 0, offset = 0; i < count; i++, offset += CHUNK) {
    const r = new Uint8Array(64);
    r[0] = op1;
    r[1] = op2;
    if (op3) r[2] = op3;
    if (payload) {
      const chunk = payload.subarray(offset, offset + CHUNK);
      r.set(chunk, 8);
      if (count > 1) {
        r[2] = offset & 0xFF;
        r[3] = offset >> 8;
        r[lengthAt] = chunk.length;
      }
    }
    reports.push(withCrc(r));
  }
  return reports;
}

/** Little-endian uint32 array as bytes, the layout the keyboard expects for key values. */
export function keyPayload(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0, true));
  return bytes;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export class Keyboard {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.waiter = null;
    this.queue = Promise.resolve();
    device.addEventListener('inputreport', (e) => {
      const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      if (this.waiter?.(data)) this.waiter = null;
    });
  }

  /** Previously authorized keyboard, if any (no prompt). */
  static async paired(log) {
    const [device] = (await navigator.hid.getDevices()).filter(isConfigInterface);
    return device ? Keyboard.open(device, log) : null;
  }

  /** Shows the browser's device picker. */
  static async request(log) {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID, usagePage: USAGE_PAGE }],
    });
    const device = devices.find(isConfigInterface);
    return device ? Keyboard.open(device, log) : null;
  }

  static async open(device, log) {
    if (!device.opened) await device.open();
    const kb = new Keyboard(device, log);
    kb.info = await kb.handshake();
    return kb;
  }

  close() {
    return this.device.close();
  }

  /** Sends one report and resolves with the matching response (same opcode, valid CRC). */
  transact(report, isMatch = (r) => r[0] === report[0]) {
    const run = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('Keyboard did not respond (op 0x' + report[0].toString(16) + ')'));
      }, TIMEOUT_MS);
      this.waiter = (r) => {
        if (!isMatch(r)) return false; // unsolicited report (e.g. key callback), keep waiting
        clearTimeout(timer);
        this.log('←', hex(r));
        if (crcValid(r)) resolve(r);
        else reject(new Error('Bad CRC in keyboard response'));
        return true;
      };
      this.log('→', hex(report));
      this.device.sendReport(0, report).catch((err) => {
        clearTimeout(timer);
        this.waiter = null;
        reject(err);
      });
    });
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  async command(op1, op2, payload, op3) {
    for (const report of buildReports(op1, op2, payload, op3)) await this.transact(report);
  }

  async query(sub) {
    const [report] = buildReports(OP.INFO, sub);
    const r = await this.transact(report, (r) => r[0] === OP.INFO && r[1] === sub);
    if (r[2] !== 1) throw new Error('Handshake rejected (info 0x' + sub.toString(16) + ')');
    return new DataView(r.buffer, r.byteOffset + 8);
  }

  async handshake() {
    const buf = await this.query(INFO.BUFFERS);
    const keyCount = buf.getUint8(0) * buf.getUint8(1);
    const fw = await this.query(INFO.FIRMWARE);
    const model = await this.query(INFO.MODEL);
    const modelBytes = new Uint8Array(model.buffer, model.byteOffset, 6);
    if (crc16(modelBytes) !== model.getUint16(6, true)) throw new Error('Bad model id checksum');
    if (!keyCount) throw new Error('Keyboard reported no key buffer');
    return {
      keyCount,
      firmwareId: fw.getUint32(0, true),
      firmwareVersion: fw.getUint8(5) + '.' + fw.getUint8(4),
      modelId: model.getUint32(0, true),
    };
  }

  /** Replaces one layer's key set. `values` is indexed by logic code; UNUSED keeps the firmware default. */
  async writeLayer(layer, values) {
    if (values.length !== this.info.keyCount) throw new Error('Key array size mismatch');
    await this.command(OP.RESET_DATA, LAYERS[layer], null, DATA_KEYSET);
    await this.command(OP.SET_KEYS, LAYERS[layer], keyPayload(values));
  }

  /** Replaces one layer's lighting effect with `payload` from lighting.js. */
  async writeLighting(layer, payload) {
    await this.command(OP.RESET_DATA, LAYERS[layer], null, DATA_LIGHTING);
    await this.command(OP.SET_LIGHTING, LAYERS[layer], payload);
  }

  /** Activates a layer; also makes the keyboard reload freshly written key data. */
  setLayer(layer) {
    return this.command(OP.SET_LAYER, LAYERS[layer]);
  }
}

function isConfigInterface(device) {
  return device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID &&
    device.collections.some((c) => c.usagePage === USAGE_PAGE);
}
