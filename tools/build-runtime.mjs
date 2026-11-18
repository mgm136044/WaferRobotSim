// Builds the simulator runtime into web/rt (precompiled wasm objects + header bundle)
// and copies the in-browser clang toolchain into web/vendor/yowasp-clang.
// Usage: node tools/build-runtime.mjs
import { runClang } from '@yowasp/clang';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPILE_FLAGS, toTree } from '../web/js/sketch-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const incDir = path.join(root, 'runtime/include');
const srcDir = path.join(root, 'runtime/src');
const outDir = path.join(root, 'web/rt');
fs.mkdirSync(path.join(outDir, 'obj'), { recursive: true });

function walk(dir, base = '') {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, walk(path.join(dir, e.name), rel));
    else out[rel] = fs.readFileSync(path.join(dir, e.name), 'utf8');
  }
  return out;
}

const headers = walk(incDir);
const srcs = fs.readdirSync(srcDir).filter((f) => f.endsWith('.cpp'));
const internal = { 'sim_internal.h': fs.readFileSync(path.join(srcDir, 'sim_internal.h'), 'utf8') };
const objects = [];
const flags = COMPILE_FLAGS.filter((f) => f !== '-w').concat(['-Wall', '-Wno-unused-function', '-Wno-unused-variable']);
for (const f of srcs) {
  const vfs = { [`src/${f}`]: fs.readFileSync(path.join(srcDir, f), 'utf8'), 'src/sim_internal.h': internal['sim_internal.h'] };
  for (const [p, c] of Object.entries(headers)) vfs[`include/${p}`] = c;
  const obj = f.replace(/\.cpp$/, '.o');
  let stderr = '';
  try {
    const out = await runClang(['clang++', ...flags, '-Iinclude', '-c', `src/${f}`, '-o', obj], toTree(vfs), {
      stderr: (b) => { if (b) stderr += new TextDecoder().decode(b); },
    });
    fs.writeFileSync(path.join(outDir, 'obj', obj), out[obj]);
    objects.push(obj);
    if (stderr.trim()) console.log(`--- ${f}\n${stderr}`);
    console.log(`compiled ${f} -> ${out[obj].length} bytes`);
  } catch (e) {
    console.error(`FAILED ${f}\n${stderr}`);
    process.exitCode = 1;
  }
}
fs.writeFileSync(path.join(outDir, 'runtime.json'), JSON.stringify({ version: Date.now(), headers, objects }));
console.log(`runtime.json: ${Object.keys(headers).length} headers, ${objects.length} objects`);

// copy the clang toolchain for the browser (served next to the app).
// Big binaries are stored gzip-compressed (*.gz, ~26 MB total) and decompressed in the
// compile worker, so any static host works (GitHub Pages, Netlify, a LAN laptop...).
import zlib from 'node:zlib';
const gen = path.join(root, 'node_modules/@yowasp/clang/gen');
const vend = path.join(root, 'web/vendor/yowasp-clang');
fs.mkdirSync(vend, { recursive: true });
for (const f of fs.readdirSync(gen)) {
  const src = path.join(gen, f);
  if (f === 'bundle.js') { fs.copyFileSync(src, path.join(vend, f)); continue; }
  const dst = path.join(vend, f + '.gz');
  const stamp = path.join(vend, f + '.gz.src-size');
  const size = String(fs.statSync(src).size);
  if (fs.existsSync(dst) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === size) continue;
  fs.writeFileSync(dst, zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
  fs.writeFileSync(stamp, size);
  const raw = path.join(vend, f);
  if (fs.existsSync(raw)) fs.unlinkSync(raw);
  console.log(`gz ${f}: ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
}
console.log('toolchain ready in web/vendor/yowasp-clang');
