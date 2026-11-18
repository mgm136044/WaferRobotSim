// Host side of the simulator runtime: provides the wasm imports (WASI subset + env)
// and turns the runtime callbacks into serial lines, frames and events.
// Works in a Web Worker and in Node.

import { resolveParams } from './params.js';

export class ExitSignal extends Error {
  constructor(code, t, reason) {
    super(reason);
    this.code = code;
    this.t = t;
    this.reason = reason;
  }
}

export const FRAME_FIELDS = [
  't', 'x', 'v', 'cmd1', 'cmd2', 'w1', 'w2', 'mode1', 'mode2', 'duty1', 'duty2', 'enc1', 'enc2', 'sA', 'sB',
  'z', 'j1', 'j2', 'wrist', 'led0', 'led1', 'led2', 'loops', 'sreads', 'i2c', 'can', 'slip1', 'slip2', 'coll',
  'startLed', 'wristTarget', 'ref1', 'ref2', 'amp1', 'amp2', 'j1t', 'j2t', 'sC', 'sD',
  'y', 'yaw', 'railF', 'guideF', 'guideR',
];
// y = sideways offset of the motor axle from the centre rail (mm, left +), yaw (deg),
// railF = total rail contact force (N), guideF/guideR = front/rear guide offset from the rail (mm)
export const FRAME_SIZE = 44;
export const F = Object.fromEntries(FRAME_FIELDS.map((k, i) => [k, i]));

export function createHost({ params: rawParams = {}, onSerial, onFrame, onEvent, onTick }) {
  // derived geometry (geom.*) is computed here so every caller (browser worker, CLI,
  // verification) feeds the runtime the same numbers the 3D view and analysis use
  const params = 'geom.mmPerRev' in rawParams ? rawParams : resolveParams(rawParams);
  let memory = null;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const bytes = (p, n) => new Uint8Array(memory.buffer, p, n);
  const str = (p, n) => dec.decode(bytes(p, n).slice());
  const dv = () => new DataView(memory.buffer);

  const env = {
    host_param(p, len, def) {
      const v = params[str(p, len)];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return def;
    },
    host_param_str(p, len, out, cap) {
      const v = params[str(p, len)];
      if (v === undefined || v === null) return -1;
      const b = enc.encode(String(v));
      const n = Math.min(b.length, cap);
      bytes(out, n).set(b.subarray(0, n));
      return n;
    },
    host_serial(port, t, p, len) { onSerial && onSerial(port, t, str(p, len)); },
    host_frame(p, n) { onFrame && onFrame(new Float32Array(memory.buffer, p, n)); },
    host_event(type, t, a, b, c, p, len) { onEvent && onEvent({ type, t, a, b, c, text: str(p, len) }); },
    host_end(code, t, p, len) { throw new ExitSignal(code, t, str(p, len)); },
    host_tick(t) { return onTick && onTick(t) ? 1 : 0; },
  };

  const ENOSYS = 52, EBADF = 8;
  const wasiImpl = {
    proc_exit(code) { throw new ExitSignal(code, NaN, `exit(${code})`); },
    fd_write(fd, iovs, iovsLen, nwritten) {
      const view = dv();
      let total = 0;
      let text = '';
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        text += str(ptr, len);
        total += len;
      }
      view.setUint32(nwritten, total, true);
      if (fd === 1 || fd === 2) onSerial && onSerial(9, NaN, text);
      return 0;
    },
    environ_sizes_get(count, size) { dv().setUint32(count, 0, true); dv().setUint32(size, 0, true); return 0; },
    environ_get() { return 0; },
    args_sizes_get(argc, size) { dv().setUint32(argc, 0, true); dv().setUint32(size, 0, true); return 0; },
    args_get() { return 0; },
    clock_time_get(id, precision, out) { dv().setBigUint64(out, 0n, true); return 0; },
    clock_res_get(id, out) { dv().setBigUint64(out, 1000n, true); return 0; },
    random_get(buf, len) { const b = bytes(buf, len); for (let i = 0; i < len; i++) b[i] = (i * 97 + 13) & 255; return 0; },
    fd_close() { return 0; },
    fd_seek() { return ENOSYS; },
    fd_fdstat_get(fd, out) {
      if (fd > 2) return EBADF;
      const view = dv();
      view.setUint8(out, 2);
      view.setUint16(out + 2, 0, true);
      view.setBigUint64(out + 8, 0n, true);
      view.setBigUint64(out + 16, 0n, true);
      return 0;
    },
    fd_prestat_get() { return EBADF; },
    fd_prestat_dir_name() { return EBADF; },
    fd_read() { return ENOSYS; },
    sched_yield() { return 0; },
  };
  const wasi = new Proxy(wasiImpl, {
    get(target, prop) { return prop in target ? target[prop] : () => ENOSYS; },
  });

  return {
    imports: { env, wasi_snapshot_preview1: wasi },
    setMemory(m) { memory = m; },
  };
}

// Instantiate and run a compiled sketch. Resolves with { code, t, reason } or throws
// { crash: true, message } for traps (memory fault, unreachable, stack overflow...).
export async function runSketch(moduleOrBytes, callbacks) {
  const host = createHost(callbacks);
  const module = moduleOrBytes instanceof WebAssembly.Module ? moduleOrBytes : await WebAssembly.compile(moduleOrBytes);
  const instance = await WebAssembly.instantiate(module, host.imports);
  host.setMemory(instance.exports.memory);
  try {
    instance.exports._start();
    return { code: 0, t: NaN, reason: 'program returned' };
  } catch (e) {
    if (e instanceof ExitSignal) return { code: e.code, t: e.t, reason: e.reason };
    return { code: -1, t: NaN, reason: 'crash', crash: true, message: String(e && e.message ? e.message : e) };
  }
}
