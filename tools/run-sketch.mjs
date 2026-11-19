// Headless check: compile an unmodified sketch folder with the same pipeline as the
// browser and run it on the virtual robot. Prints the serial log and a drive summary.
// Usage: node tools/run-sketch.mjs <sketch-folder> [--max 330] [--set key=value ...] [--quiet] [--csv out.csv]
import { runClang } from '@yowasp/clang';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuild, toTree } from '../web/js/sketch-build.js';
import { runSketch, F, FRAME_SIZE } from '../web/js/sim-host.js';
import { defaultParams, fieldGeometry, resolveParams, validateParams } from '../web/js/params.js';
import { analyseRun } from '../web/js/analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const dir = args[0];
if (!dir) { console.error('usage: node tools/run-sketch.mjs <sketch-folder> [--set key=value]'); process.exit(2); }
const params = defaultParams();
let quiet = false, csv = null, sdoFrom = null, sdoTo = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--set') { const [k, v] = args[++i].split('='); params[k] = isNaN(Number(v)) ? v : Number(v); }
  else if (args[i] === '--max') params['run.maxSeconds'] = Number(args[++i]);
  else if (args[i] === '--quiet') quiet = true;
  else if (args[i] === '--csv') csv = args[++i];
  else if (args[i] === '--sdo') { const [a, b] = args[++i].split('-').map(Number); sdoFrom = a * 1000; sdoTo = b * 1000; params['debug.sdo'] = 1; }
}

function readDir(d, base = '') {
  const out = {};
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!/^(analysis|tests|tools|diagnostics|tmp|\.git|node_modules)$/.test(e.name) || base) Object.assign(out, readDir(path.join(d, e.name), rel)); }
    else if (/\.(ino|pde|cpp|c|cc|h|hpp|hh|S)$/i.test(e.name)) out[rel] = fs.readFileSync(path.join(d, e.name), 'utf8');
  }
  return out;
}

for (const w of validateParams(params).warnings) console.log('설정 점검: ' + w);
const files = readDir(path.resolve(dir), path.basename(path.resolve(dir)));
const rtMeta = JSON.parse(fs.readFileSync(path.join(root, 'web/rt/runtime.json'), 'utf8'));
const objects = {};
for (const o of rtMeta.objects) objects[o] = fs.readFileSync(path.join(root, 'web/rt/obj', o));
const { args: clangArgs, vfs, sketch, prototypes } = prepareBuild(files, { headers: rtMeta.headers, objects });
console.log(`sketch: ${sketch.mainIno} | ino: ${sketch.inos.join(', ')} | sources: ${sketch.sources.length} | prototypes: ${prototypes.length}`);
const t0 = Date.now();
let stderr = '';
let out;
try {
  out = await runClang(clangArgs, toTree(vfs), { stderr: (b) => { if (b) stderr += new TextDecoder().decode(b); } });
} catch (e) {
  console.error('COMPILE FAILED\n' + stderr);
  process.exit(1);
}
if (stderr.trim()) console.log(stderr);
const wasm = out['sketch.wasm'];
console.log(`compiled in ${((Date.now() - t0) / 1000).toFixed(1)} s, wasm ${(wasm.length / 1024).toFixed(0)} KB`);

const frames = [];
const serial = [];
const events = [];
const t1 = Date.now();
const res = await runSketch(wasm, {
  params,
  onSerial: (port, t, text) => {
    serial.push({ port, t, text });
    if (!quiet) process.stdout.write(`[${(t / 1000).toFixed(3).padStart(8)}] ${text}`);
  },
  onFrame: (f) => frames.push(Float32Array.from(f.subarray(0, FRAME_SIZE))),
  onEvent: (e) => { if (e.type === 8) { if (e.t >= sdoFrom && e.t <= sdoTo) console.log(`  sdo @${(e.t / 1000).toFixed(4)} ${e.text}`); return; } events.push(e); if (e.type === 1 || e.type === 3 || e.type === 5 || e.type === 7) console.log(`  ! event ${e.type} @${(e.t / 1000).toFixed(3)}s ${e.text}`); },
  onTick: () => false,
});
console.log(`\nrun ended: code=${res.code} t=${(res.t / 1000).toFixed(3)}s reason=${res.reason}${res.message ? ' msg=' + res.message : ''}`);
console.log(`simulated ${frames.length} frames in ${((Date.now() - t1) / 1000).toFixed(1)} s wall`);
const report = analyseRun(frames, serial, events, resolveParams(params));
console.log(JSON.stringify(report.summary, null, 1));
for (const s of report.stops) console.log(`stop @${(s.t / 1000).toFixed(2)}s line~${s.nearestLine} axle=${s.axle.toFixed(1)}mm s5err=${s.sensorErr[1]?.toFixed(1)} s4err=${s.sensorErr[0]?.toFixed(1)} front=${s.frontGap.toFixed(1)} rear=${s.rearGap.toFixed(1)} dur=${s.duration}ms`);
if (csv) {
  const head = ['t', 'x', 'v', 'cmd1', 'w1', 'w2', 'mode1', 'sA', 'sB', 'z', 'j1', 'j2', 'wrist', 'y', 'yaw', 'railF', 'guideF', 'guideR', 'enc1', 'slip1', 'slip2'];
  const lines = [head.join(',')];
  for (const f of frames) lines.push(head.map((k) => f[F[k]]).join(','));
  fs.writeFileSync(csv, lines.join('\n'));
}
