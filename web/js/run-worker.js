// Runs a compiled sketch on the virtual robot as fast as possible and streams the
// results (frames, serial lines, events) to the page, which plays them back.
import { runSketch, FRAME_SIZE } from './sim-host.js';

let frameBuf = new Float32Array(FRAME_SIZE * 400);
let frameCount = 0;
let serialBuf = [];
let eventBuf = [];
let lastFlush = 0;
let wallStart = 0;
let budgetMs = 120000;

function flush(force) {
  const now = performance.now();
  if (!force && now - lastFlush < 120) return;
  lastFlush = now;
  if (frameCount) {
    const out = frameBuf.slice(0, frameCount * FRAME_SIZE);
    self.postMessage({ type: 'frames', data: out, count: frameCount }, [out.buffer]);
    frameCount = 0;
  }
  if (serialBuf.length) { self.postMessage({ type: 'serial', lines: serialBuf }); serialBuf = []; }
  if (eventBuf.length) { self.postMessage({ type: 'events', events: eventBuf }); eventBuf = []; }
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run') return;
  budgetMs = (data.budgetSeconds || 120) * 1000;
  wallStart = performance.now();
  const res = await runSketch(data.wasm, {
    params: data.params,
    onSerial(port, t, text) {
      serialBuf.push({ port, t, text });
      if (serialBuf.length > 200) flush(true);
    },
    onFrame(f) {
      if ((frameCount + 1) * FRAME_SIZE > frameBuf.length) {
        flush(true);
        if ((frameCount + 1) * FRAME_SIZE > frameBuf.length) frameBuf = new Float32Array(frameBuf.length * 2);
      }
      frameBuf.set(f.subarray(0, FRAME_SIZE), frameCount * FRAME_SIZE);
      frameCount++;
      if (frameCount >= 400) flush(false);
    },
    onEvent(e) { eventBuf.push(e); },
    onTick(t) {
      flush(false);
      return performance.now() - wallStart > budgetMs;
    },
  });
  flush(true);
  self.postMessage({ type: 'end', result: res, wallSeconds: (performance.now() - wallStart) / 1000 });
};
