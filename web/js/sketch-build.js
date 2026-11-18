// Arduino-builder compatible sketch preparation (shared by the browser compile worker
// and the Node CLI). Files are never edited: .ino files are concatenated with #line
// directives and auto-generated prototypes exactly like arduino-cli does.

const SRC_EXT = /\.(cpp|c|cc|cxx|S)$/i;
const HDR_EXT = /\.(h|hpp|hh|hxx|inc|tpp|ipp)$/i;
const IGNORED_DIRS = /(^|\/)(__MACOSX|\.git|\.vscode|\.theia|node_modules)(\/|$)/;

export function normalisePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

// files: { path: string(text) } (any folder layout, e.g. from a zip or folder picker)
// Returns { root, mainIno, inos, sources, headers, all } relative to the sketch root.
export function locateSketch(files) {
  const paths = Object.keys(files).map(normalisePath).filter((p) => !IGNORED_DIRS.test(p) && !/(^|\/)\._/.test(p));
  const inoPaths = paths.filter((p) => /\.ino$/i.test(p) || /\.pde$/i.test(p));
  if (!inoPaths.length) throw new Error('.ino 파일을 찾지 못했습니다. 스케치 폴더(또는 zip)를 통째로 넣어 주세요.');
  // Prefer an .ino whose name matches its folder (Arduino rule), shallowest first.
  const depth = (p) => p.split('/').length;
  const scored = inoPaths
    .map((p) => {
      const parts = p.split('/');
      const folder = parts.length > 1 ? parts[parts.length - 2] : '';
      const base = parts[parts.length - 1].replace(/\.(ino|pde)$/i, '');
      return { p, match: folder === base ? 0 : 1, d: depth(p) };
    })
    .sort((a, b) => a.d - b.d || a.match - b.match || a.p.localeCompare(b.p));
  const main = scored[0].p;
  const root = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
  const rel = {};
  for (const p of paths) {
    if (!p.startsWith(root)) continue;
    rel[p.slice(root.length)] = files[Object.keys(files).find((k) => normalisePath(k) === p)];
  }
  const relPaths = Object.keys(rel);
  // Arduino compiles: .ino in the root, sources in the root and (recursively) in src/.
  const inRootOrSrc = (p) => !p.includes('/') || p.startsWith('src/');
  const mainRel = main.slice(root.length);
  const inos = relPaths.filter((p) => !p.includes('/') && /\.(ino|pde)$/i.test(p));
  inos.sort((a, b) => (a === mainRel ? -1 : b === mainRel ? 1 : a.localeCompare(b)));
  const sources = relPaths.filter((p) => inRootOrSrc(p) && SRC_EXT.test(p));
  const headers = relPaths.filter((p) => HDR_EXT.test(p));
  return { root, mainIno: mainRel, inos, sources, headers, all: rel };
}

// Replace comments, string and char literals with spaces (keeps offsets/newlines).
function blank(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { out += code[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
    } else if (c === '"' || c === "'") {
      // raw strings are rare in sketches; treat normally
      out += ' '; i++;
      while (i < n && code[i] !== c) {
        if (code[i] === '\\') { out += ' '; i++; }
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += ' '; i++;
    } else if (c === '#' && /^\s*$/.test(out.slice(out.lastIndexOf('\n') + 1))) {
      // preprocessor line (with continuations) -> blank
      while (i < n && code[i] !== '\n') {
        if (code[i] === '\\' && code[i + 1] === '\n') { out += ' \n'; i += 2; continue; }
        out += ' '; i++;
      }
    } else {
      out += c; i++;
    }
  }
  return out;
}

const NOT_FUNCS = new Set(['if', 'while', 'for', 'switch', 'return', 'else', 'sizeof', 'catch', 'do', 'case', 'new', 'delete', 'operator']);

// Find top-level function definitions in (blanked) code.
export function findFunctions(code) {
  const b = blank(code);
  const found = [];
  let depth = 0;
  let parenDepth = 0;
  let stmtStart = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === '(') parenDepth++;
    else if (c === ')') parenDepth--;
    else if (c === ';' && depth === 0 && parenDepth === 0) stmtStart = i + 1;
    else if (c === '}') {
      depth--;
      if (depth === 0) stmtStart = i + 1;
    } else if (c === '{') {
      if (depth === 0 && parenDepth === 0) {
        const header = b.slice(stmtStart, i);
        const m = header.match(/^([\s\S]*?)([A-Za-z_][\w]*(?:::[A-Za-z_~][\w]*)*)\s*\(([\s\S]*)\)\s*((?:const|noexcept|override|final|volatile|\s)*)$/);
        if (m) {
          const ret = m[1].trim();
          const name = m[2];
          const shortName = name.split('::').pop();
          const isMember = name.includes('::');
          const badRet = !ret || /[=;{}]|\b(class|struct|union|enum|namespace|typedef|template)\b/.test(ret) || /\)\s*$/.test(ret);
          if (!badRet && !NOT_FUNCS.has(shortName) && !isMember && !/^(static_assert|extern)\b/.test(ret)) {
            const lineNo = code.slice(0, stmtStart).split('\n').length + (header.match(/^\s*/)[0].split('\n').length - 1);
            found.push({ name, ret: ret.replace(/\s+/g, ' '), args: m[3].replace(/\s+/g, ' ').trim(), qual: m[4].trim(), start: stmtStart, line: lineNo, header: header.trim() });
          }
        }
      }
      depth++;
    }
  }
  return found;
}

function stripDefaults(args) {
  // default arguments may only appear once: remove "= value" from prototypes
  let out = '';
  let depth = 0;
  let skipping = false;
  for (const ch of args) {
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '>' || ch === '}' || ch === ']') depth--;
    if (ch === '=' && depth === 0) { skipping = true; continue; }
    if (ch === ',' && depth === 0) skipping = false;
    if (!skipping) out += ch;
  }
  return out.trim();
}

// Build the single translation unit for all .ino files (arduino-cli style).
export function buildInoUnit(sketch) {
  const parts = [];
  let combined = '';
  for (const name of sketch.inos) {
    const text = sketch.all[name].replace(/\r\n?/g, '\n');
    parts.push({ name, text });
    combined += text + '\n';
  }
  // prototypes are generated from all .ino files and inserted before the first definition
  const main = parts[0];
  const funcs = [];
  for (const part of parts) for (const f of findFunctions(part.text)) funcs.push({ ...f, file: part.name });
  const declared = new Set();
  const blankedAll = blank(combined);
  const protos = [];
  for (const f of funcs) {
    if (f.ret.includes('static') && f.ret.includes('inline')) continue;
    const proto = `${f.ret} ${f.name}(${stripDefaults(f.args)})${f.qual ? ' ' + f.qual : ''};`;
    const key = proto.replace(/\s+/g, '');
    if (declared.has(key)) continue;
    // skip if a prototype for this name already appears before the definition
    const before = blankedAll.slice(0, blankedAll.indexOf(f.header) >= 0 ? blankedAll.indexOf(f.header) : 0);
    if (new RegExp(`\\b${f.name}\\s*\\([^)]*\\)\\s*;`).test(before) && !/\{/.test(before.slice(-1))) {
      declared.add(key);
      continue;
    }
    declared.add(key);
    protos.push({ proto, file: f.file, line: f.line });
  }
  let unit = '#include <Arduino.h>\n';
  for (const part of parts) {
    let text = part.text;
    if (part === main && protos.length) {
      const first = funcs.filter((f) => f.file === main.name).sort((a, b) => a.start - b.start)[0];
      if (first) {
        const lines = text.split('\n');
        const at = first.line - 1;
        const head = lines.slice(0, at).join('\n');
        const tail = lines.slice(at).join('\n');
        unit += `#line 1 "${part.name}"\n${head}\n`;
        unit += protos.map((p) => `#line ${p.line} "${p.file}"\n${p.proto}`).join('\n') + '\n';
        unit += `#line ${at + 1} "${part.name}"\n${tail}\n`;
        continue;
      }
    }
    unit += `#line 1 "${part.name}"\n${text}\n`;
  }
  return { unit, prototypes: protos.map((p) => p.proto) };
}

export const COMPILE_FLAGS = [
  '--target=wasm32-wasip1',
  '-std=gnu++2b',
  '-O2',
  '-fno-exceptions',
  '-fno-rtti',
  '-funsigned-char',
  '-w',
  '-ferror-limit=50',
  '-DARDUINO=10819',
  '-DESP32',
  '-DARDUINO_ARCH_ESP32',
  '-DCONFIG_IDF_TARGET_ESP32S3',
  '-DARDUINO_ESP32S3_DEV',
  '-DESP_ARDUINO_VERSION_MAJOR=3',
  '-DWAFER_ROBOT_SIM=1',
];
export const LINK_FLAGS = ['-Wl,-z,stack-size=1048576', '-Wl,--initial-memory=33554432'];

// Produce the clang++ argument list and the virtual file map.
// runtime: { headers: {path: text}, objects: {name: Uint8Array} }
export function prepareBuild(files, runtime) {
  const sketch = locateSketch(files);
  const vfs = {};
  const S = 'sketch/';
  for (const [p, content] of Object.entries(sketch.all)) {
    if (SRC_EXT.test(p) || HDR_EXT.test(p)) vfs[S + p] = content;
  }
  const { unit, prototypes } = buildInoUnit(sketch);
  vfs[S + sketch.mainIno + '.cpp'] = unit;
  for (const [p, content] of Object.entries(runtime.headers)) vfs['rt/include/' + p] = content;
  const objs = [];
  for (const [name, bytes] of Object.entries(runtime.objects)) {
    vfs['rt/obj/' + name] = bytes;
    objs.push('rt/obj/' + name);
  }
  const srcs = [S + sketch.mainIno + '.cpp', ...sketch.sources.map((p) => S + p)];
  const incDirs = new Set(['sketch']);
  for (const p of sketch.sources) if (p.includes('/')) incDirs.add(S + p.slice(0, p.lastIndexOf('/')));
  const args = ['clang++', ...COMPILE_FLAGS, '-Irt/include', ...[...incDirs].map((d) => '-I' + d), ...srcs, ...objs, ...LINK_FLAGS, '-o', 'sketch.wasm'];
  return { args, vfs, sketch, prototypes };
}

// YoWASP's virtual filesystem uses nested objects for directories.
export function toTree(flat) {
  const tree = {};
  for (const [p, content] of Object.entries(flat)) {
    const parts = p.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
    node[parts[parts.length - 1]] = content;
  }
  return tree;
}
