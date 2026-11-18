// Compiles the sketch in the browser with clang/lld built for WebAssembly (YoWASP).
// The first compile downloads the toolchain (~26 MB compressed); the browser caches it.
import { prepareBuild, toTree } from './sketch-build.js';

let clangPromise = null;

// Serve the toolchain from *.gz (decompressed here) and keep it in Cache Storage so the
// ~26 MB download happens once per browser.
const TOOLCHAIN_RE = /\/(llvm\.core\d?\.wasm|llvm-resources\.tar)(\?.*)?$/;
const CACHE_NAME = 'wafersim-toolchain-21.1.4-3';
const origFetch = globalThis.fetch.bind(globalThis);
let downloaded = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (!TOOLCHAIN_RE.test(url)) return origFetch(input, init);
  const type = /\.wasm/.test(url) ? 'application/wasm' : 'application/x-tar';
  let cache = null;
  try { cache = self.caches ? await caches.open(CACHE_NAME) : null; } catch { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  let resp = await origFetch(url + '.gz');
  if (!resp.ok) resp = await origFetch(url);
  const reader = resp.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    downloaded += value.length;
    post('status', { text: `컴파일러 내려받는 중… ${(downloaded / 1e6).toFixed(1)} / 약 26 MB (처음 한 번만)` });
  }
  let bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) { bytes.set(p, off); off += p.length; }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const out = new Response(bytes, { headers: { 'Content-Type': type } });
  if (cache) { try { await cache.put(url, out.clone()); } catch {} }
  return out;
};
let runtimePromise = null;

function post(type, data, transfer) { self.postMessage({ type, ...data }, transfer || []); }

async function loadClang() {
  if (!clangPromise) {
    clangPromise = (async () => {
      post('status', { text: '컴파일러 내려받는 중… (처음 한 번, 약 26MB)' });
      const mod = await import('../vendor/yowasp-clang/bundle.js');
      return mod.runClang;
    })();
  }
  return clangPromise;
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const meta = await (await fetch(new URL('../rt/runtime.json', import.meta.url))).json();
      const objects = {};
      await Promise.all(meta.objects.map(async (o) => {
        const buf = await (await fetch(new URL(`../rt/obj/${o}?v=${meta.version}`, import.meta.url))).arrayBuffer();
        objects[o] = new Uint8Array(buf);
      }));
      return { headers: meta.headers, objects, version: meta.version };
    })();
  }
  return runtimePromise;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'warmup') {
    try { await Promise.all([loadClang(), loadRuntime()]); post('ready', {}); }
    catch (e) { post('error', { text: String(e && e.message || e) }); }
    return;
  }
  if (data.type !== 'compile') return;
  const t0 = performance.now();
  try {
    const [runClang, runtime] = await Promise.all([loadClang(), loadRuntime()]);
    const { args, vfs, sketch, prototypes } = prepareBuild(data.files, runtime);
    post('status', { text: `컴파일 중… ${sketch.mainIno} + ${sketch.sources.length}개 소스` });
    let stderr = '';
    const decoder = new TextDecoder();
    let out;
    try {
      out = await runClang(args, toTree(vfs), {
        stderr: (b) => { if (b) stderr += decoder.decode(b, { stream: true }); },
        stdout: (b) => { if (b) stderr += decoder.decode(b, { stream: true }); },
      });
    } catch (e) {
      post('compiled', { ok: false, log: cleanLog(stderr) || String(e && e.message || e), seconds: (performance.now() - t0) / 1000, sketch: summary(sketch, prototypes) });
      return;
    }
    const wasm = out['sketch.wasm'];
    post('compiled', {
      ok: true,
      wasm,
      log: cleanLog(stderr),
      seconds: (performance.now() - t0) / 1000,
      sketch: summary(sketch, prototypes),
    }, [wasm.buffer]);
  } catch (e) {
    post('compiled', { ok: false, log: String(e && e.message || e), seconds: (performance.now() - t0) / 1000 });
  }
};

function summary(sketch, prototypes) {
  return { mainIno: sketch.mainIno, inos: sketch.inos, sources: sketch.sources, headers: sketch.headers, prototypes };
}

// Hide the driver banner lines; keep diagnostics (paths are relative to the sketch).
function cleanLog(text) {
  return text
    .split('\n')
    .filter((l) => !/^(clang version|Target:|Thread model:|InstalledDir:|Build config:)/.test(l))
    .map((l) => l.replace(/\bsketch\//g, ''))
    .join('\n')
    .trim();
}
