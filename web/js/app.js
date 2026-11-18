// Main page: load a sketch, compile in a worker, run on the virtual robot in another
// worker, then play the result back in 3D with charts, serial log and analysis.
import { View3D } from './view3d.js';
import { ChartGroup } from './charts.js';
import { F, FRAME_SIZE } from './sim-host.js';
import { PARAM_SPECS, FIELD_PRESETS, defaultParams, applyFieldPreset, fieldGeometry, robotGeometry, PARAMS_VERSION, migrateParams } from './params.js';
import { analyseRun } from './analysis.js';
import { readZip, writeZip, decodeText } from './zip.js';
import { locateSketch } from './sketch-build.js';
import { EXAMPLE_FILES } from './example.js';
import { HELP_HTML } from './help.js';

const $ = (id) => document.getElementById(id);
const SRC_RE = /\.(ino|pde|cpp|c|cc|cxx|h|hpp|hh|hxx|S|inc|tpp|ipp)$/i;

// ------------------------------------------------------------------ state
const state = {
  files: {},          // path -> text (current, possibly edited)
  original: {},       // path -> text (as loaded)
  name: '',
  active: null,
  params: loadParams(),
  paramsAtRun: null,
  wasm: null,
  wasmKey: '',
  frames: new Float32Array(FRAME_SIZE * 1024),
  count: 0,
  serial: [],
  events: [],
  running: false,
  ended: null,
  playT: 0,
  playing: false,
  speed: 1,
  analysis: null,
};

// ------------------------------------------------------------------ persistence
function loadParams() {
  const p = defaultParams();
  try {
    const saved = migrateParams(JSON.parse(localStorage.getItem('wafersim.params') || '{}'));
    for (const [k, v] of Object.entries(saved)) if (k in p) p[k] = v;
  } catch {}
  return p;
}
function saveParams() { localStorage.setItem('wafersim.params', JSON.stringify({ ...state.params, _v: PARAMS_VERSION })); }

const DB = (() => {
  let dbp = null;
  const open = () => (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('wafersim', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  return {
    async get(k) { const db = await open(); return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); },
    async set(k, v) { const db = await open(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); },
  };
})();
let saveTimer = null;
function saveProject() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => DB.set('project', { files: state.files, original: state.original, name: state.name, active: state.active }), 400);
}

// ------------------------------------------------------------------ 3D + charts
const view = new View3D($('view3d'));
view.build(state.params);
const charts = new ChartGroup($('charts'), (t) => seek(t));
const geoNow = () => fieldGeometry(state.paramsAtRun || state.params);
charts.add({
  title: '바퀴 속도 (모터1, deg/s)',
  series: [
    { key: 'cmd1', label: '명령 setMotorSpeeds', color: '#f2c14e' },
    { key: 'w1', label: '실제(엔코더)', color: '#4fa3ff', width: 1.8, overlayColor: '#ff6b6b' },
    { key: 'ref1', label: 'PRIZM 내부 목표', color: '#6c7a89' },
  ],
});
charts.add({
  title: '위치 (경기장 시작 끝 기준, mm)',
  series: [
    { key: 'x', label: '모터축', color: '#3ccf7e', width: 1.8 },
    { key: 's5', label: '5번 센서', color: '#c792ea', fn: (d, b) => d[b + F.x] + robotGeometry(state.paramsAtRun || state.params).sensors[1].s },
  ],
  bands: () => geoNow().lines,
});
charts.add({
  title: '센서 · 구동 모드',
  ymin: -0.2, ymax: 4.4,
  series: [
    { key: 'sA', label: '4번 센서', color: '#ff6b6b', fn: (d, b) => 3.2 + d[b + F.sA] * 0.9 },
    { key: 'sB', label: '5번 센서', color: '#c792ea', fn: (d, b) => 2.0 + d[b + F.sB] * 0.9 },
    { key: 'mode1', label: '모드(0코스트 2브레이크 3속도)', color: '#f2c14e', fn: (d, b) => Math.max(0, d[b + F.mode1]) * 0.6 },
    { key: 'led0', label: '빨간 LED', color: '#ff3b30', fn: (d, b) => (d[b + F.led0] ? 1.6 : 1.2) },
  ],
});
charts.add({
  title: '가운데 레일 (가이드 롤러 좌우 편차 mm · 접촉력 N)',
  series: [
    { key: 'guideF', label: '앞 가이드 편차', color: '#4fa3ff' },
    { key: 'guideR', label: '뒤 가이드 편차', color: '#3ccf7e' },
    { key: 'railF', label: '레일 접촉력 (N)', color: '#ff6b6b' },
  ],
});
charts.add({
  title: '팔 · Z축',
  series: [
    { key: 'j1', label: 'J1 (÷100 unit)', color: '#4fa3ff', fn: (d, b) => d[b + F.j1] / 100 },
    { key: 'j2', label: 'J2 (÷100 unit)', color: '#3ccf7e', fn: (d, b) => d[b + F.j2] / 100 },
    { key: 'z', label: 'Z (mm)', color: '#f2c14e' },
    { key: 'wrist', label: '손목 (명령값)', color: '#c792ea' },
  ],
});

// ------------------------------------------------------------------ files
function setFiles(files, name) {
  const sketchFiles = {};
  for (const [p, c] of Object.entries(files)) if (SRC_RE.test(p) && !/(^|\/)(__MACOSX)\//.test(p) && !/(^|\/)\._/.test(p)) sketchFiles[p] = c;
  let sk;
  try { sk = locateSketch(sketchFiles); } catch (e) { alert(e.message); return; }
  // keep only what Arduino builds: the sketch root and src/ (analysis/, tests/, tmp/... are ignored)
  const kept = {};
  for (const [rel, text] of Object.entries(sk.all)) if (!rel.includes('/') || rel.startsWith('src/')) kept[rel] = text;
  state.files = kept;
  state.original = { ...kept };
  state.name = sk.mainIno.replace(/\.(ino|pde)$/i, '') || name;
  state.active = sk.mainIno;
  state.wasm = null;
  saveProject();
  renderFiles();
  setStatus(`${Object.keys(kept).length}개 파일 · 메인 ${sk.mainIno} · 컴파일 대상 .cpp ${sk.sources.length}개`);
}

function renderFiles() {
  $('projName').textContent = state.name || '스케치 없음';
  const tabs = $('fileTabs');
  tabs.innerHTML = '';
  const names = Object.keys(state.files).sort((a, b) => {
    const ra = /\.(ino|pde)$/i.test(a) ? 0 : /\.(h|hpp)$/i.test(a) ? 2 : 1;
    const rb = /\.(ino|pde)$/i.test(b) ? 0 : /\.(h|hpp)$/i.test(b) ? 2 : 1;
    return ra - rb || a.localeCompare(b);
  });
  for (const n of names) {
    const b = document.createElement('button');
    b.textContent = n;
    if (n === state.active) b.classList.add('active');
    if (state.files[n] !== state.original[n]) b.classList.add('mod');
    b.onclick = () => openFile(n);
    tabs.appendChild(b);
  }
  openFile(state.active, true);
}

function openFile(name, keepTabs) {
  if (!name || !(name in state.files)) { $('editor').value = ''; updateGutter(); return; }
  state.active = name;
  $('editor').value = state.files[name];
  $('editor').scrollTop = 0;
  updateGutter();
  if (!keepTabs) renderFiles();
  else for (const b of $('fileTabs').children) b.classList.toggle('active', b.textContent === name);
}

function updateGutter() {
  const n = $('editor').value.split('\n').length;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  $('gutter').textContent = s;
  $('gutter').scrollTop = $('editor').scrollTop;
}

function gotoLine(file, line) {
  if (!(file in state.files)) return;
  openFile(file);
  const ed = $('editor');
  const lines = ed.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  ed.focus();
  ed.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  ed.scrollTop = Math.max(0, (line - 6) * 18.75);
  updateGutter();
}

$('editor').addEventListener('input', () => {
  if (!state.active) return;
  state.files[state.active] = $('editor').value;
  state.wasm = null;
  updateGutter();
  for (const b of $('fileTabs').children) if (b.textContent === state.active) b.classList.toggle('mod', state.files[state.active] !== state.original[state.active]);
  saveProject();
});
$('editor').addEventListener('scroll', () => { $('gutter').scrollTop = $('editor').scrollTop; });
$('editor').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ed = e.target, s = ed.selectionStart;
    ed.setRangeText('  ', s, ed.selectionEnd, 'end');
    ed.dispatchEvent(new Event('input'));
  }
});
$('btnRevert').onclick = () => {
  if (!state.active) return;
  state.files[state.active] = state.original[state.active];
  state.wasm = null;
  renderFiles();
  saveProject();
};
$('btnExportZip').onclick = () => {
  if (!Object.keys(state.files).length) return;
  const files = {};
  for (const [p, t] of Object.entries(state.files)) files[`${state.name}/${p}`] = t;
  download(writeZip(files), `${state.name}.zip`);
};

async function readFileList(list) {
  const files = {};
  for (const f of list) {
    const rel = f.webkitRelativePath || f._rel || f.name;
    if (!SRC_RE.test(rel)) continue;
    if (/(^|\/)(analysis|tests?|tools|diagnostics|tmp|backups?|\.git|node_modules|__MACOSX)\//i.test(rel.split('/').slice(1).join('/') + '/')) {
      // nested helper folders are never part of an Arduino build (except src/)
      if (!/(^|\/)src\//.test(rel)) continue;
    }
    files[rel] = decodeText(new Uint8Array(await f.arrayBuffer()));
  }
  return files;
}
$('btnOpenFolder').onclick = () => $('inpFolder').click();
$('btnOpenZip').onclick = () => $('inpZip').click();
$('inpFolder').onchange = async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  const files = await readFileList(list);
  setFiles(files, list[0].webkitRelativePath.split('/')[0]);
  e.target.value = '';
};
$('inpZip').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  await loadZip(f);
  e.target.value = '';
};
async function loadZip(file) {
  try {
    const entries = await readZip(await file.arrayBuffer());
    const files = {};
    for (const [p, b] of Object.entries(entries)) if (SRC_RE.test(p)) files[p] = decodeText(b);
    setFiles(files, file.name.replace(/\.zip$/i, ''));
  } catch (err) {
    alert('ZIP을 읽지 못했습니다: ' + err.message);
  }
}
$('btnExample').onclick = () => {
  if (Object.keys(state.files).length && !confirm('지금 열린 코드를 예제로 바꿀까요? (현재 코드는 ZIP 저장으로 보관할 수 있습니다)')) return;
  setFiles(EXAMPLE_FILES, 'LineStop_Example');
};

// drag & drop (folders via webkitGetAsEntry)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const items = [...(e.dataTransfer.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) {
    await loadZip(e.dataTransfer.files[0]);
    return;
  }
  const out = [];
  const walk = (entry, path) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { f._rel = path + entry.name; out.push(f); res(); }, () => res());
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readAll = () => reader.readEntries(async (batch) => {
        if (!batch.length) { for (const c of all) await walk(c, path + entry.name + '/'); res(); }
        else { all.push(...batch); readAll(); }
      }, () => res());
      readAll();
    } else res();
  });
  for (const en of entries) await walk(en, '');
  if (!out.length) return;
  const files = await readFileList(out);
  setFiles(files, entries[0].isDirectory ? entries[0].name : '');
});

// ------------------------------------------------------------------ compile + run
let compileWorker = null;
let runWorker = null;
function getCompileWorker() {
  if (!compileWorker) {
    compileWorker = new Worker(new URL('./compile-worker.js', import.meta.url), { type: 'module' });
  }
  return compileWorker;
}

function filesKey() {
  let h = 2166136261;
  for (const [p, t] of Object.entries(state.files).sort()) {
    const s = p + '\0' + t;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return String(h >>> 0);
}

function compile() {
  return new Promise((resolve) => {
    const w = getCompileWorker();
    $('buildOut').textContent = '';
    showConsole('build');
    setRunStatus('컴파일 중…', 'busy');
    w.onmessage = ({ data }) => {
      if (data.type === 'status') { setRunStatus(data.text, 'busy'); if (!/내려받는 중/.test(data.text)) appendBuild(data.text + '\n'); }
      if (data.type === 'error') { appendBuild(data.text + '\n', 'err'); resolve(null); }
      if (data.type === 'compiled') {
        if (data.sketch) appendBuild(`스케치: ${data.sketch.mainIno} (+${data.sketch.inos.length - 1} .ino), .cpp ${data.sketch.sources.length}개, 자동 프로토타입 ${data.sketch.prototypes.length}개\n`);
        if (data.log) renderBuildLog(data.log);
        if (data.ok) {
          appendBuild(`✔ 컴파일 성공 (${data.seconds.toFixed(1)}초, ${(data.wasm.length / 1024).toFixed(0)} KB)\n`, 'ok');
          resolve(data.wasm);
        } else {
          appendBuild(`✘ 컴파일 실패 (${data.seconds.toFixed(1)}초) — 위 오류를 확인하세요\n`, 'err');
          setRunStatus('컴파일 실패', 'bad');
          resolve(null);
        }
      }
    };
    w.postMessage({ type: 'compile', files: state.files });
  });
}

function appendBuild(text, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  $('buildOut').appendChild(span);
  $('buildOut').scrollTop = 1e9;
}
function renderBuildLog(log) {
  const out = $('buildOut');
  for (const line of log.split('\n')) {
    const m = line.match(/^([^:\s]+\.(?:ino|pde|cpp|c|h|hpp)):(\d+):(\d+):\s*(error|warning|note)?/);
    const div = document.createElement('div');
    if (m && m[1] in state.files) {
      const a = document.createElement('a');
      a.textContent = `${m[1]}:${m[2]}`;
      a.onclick = () => gotoLine(m[1], Number(m[2]));
      div.appendChild(a);
      div.appendChild(document.createTextNode(line.slice(m[1].length + m[2].length + 1)));
    } else div.textContent = line;
    if (/error/.test(line)) div.className = 'err';
    else if (/warning/.test(line)) div.className = 'warn';
    if (/undefined symbol:/.test(line)) div.appendChild(document.createTextNode('  ← 시뮬레이터가 아직 지원하지 않는 함수/라이브러리일 수 있습니다'));
    out.appendChild(div);
  }
}

async function runAll() {
  if (!Object.keys(state.files).length) { alert('먼저 스케치 폴더나 ZIP을 여세요 (또는 [예제]).'); return; }
  stopRun();
  $('btnRun').disabled = true;
  const key = filesKey();
  let wasm = state.wasm && state.wasmKey === key ? state.wasm : null;
  if (!wasm) {
    wasm = await compile();
    if (!wasm) { $('btnRun').disabled = false; return; }
    state.wasm = wasm;
    state.wasmKey = key;
  } else appendBuild('코드 변경 없음 → 이전 컴파일 결과로 다시 실행\n');
  startRun(wasm);
}

function startRun(wasm) {
  resetRun();
  state.paramsAtRun = { ...state.params };
  view.build(state.paramsAtRun);
  $('paramsDirty').textContent = '';
  state.running = true;
  $('btnStop').disabled = false;
  $('btnRun').disabled = false;
  setRunStatus('시뮬레이션 계산 중…', 'busy');
  showConsole('serial');
  runWorker = new Worker(new URL('./run-worker.js', import.meta.url), { type: 'module' });
  let lastMsg = performance.now();
  const watchdog = setInterval(() => {
    if (state.running && performance.now() - lastMsg > 15000) {
      stopRun('응답 없음: API 호출이 없는 무한 루프(예: while(1){}) 일 수 있습니다');
    }
  }, 2000);
  runWorker.onmessage = ({ data }) => {
    lastMsg = performance.now();
    if (data.type === 'frames') addFrames(data.data, data.count);
    else if (data.type === 'serial') addSerial(data.lines);
    else if (data.type === 'events') addEvents(data.events);
    else if (data.type === 'end') {
      clearInterval(watchdog);
      finishRun(data.result, data.wallSeconds);
    }
  };
  runWorker.onerror = (e) => { clearInterval(watchdog); finishRun({ code: -1, crash: true, message: e.message }, 0); };
  runWorker.postMessage({ type: 'run', wasm: wasm.slice(), params: state.paramsAtRun, budgetSeconds: 180 });
  state.playing = true;
  $('btnPlay').textContent = '❚❚';
}

function resetRun() {
  state.count = 0;
  state.serial = [];
  state.events = [];
  state.ended = null;
  state.playT = 0;
  state.analysis = null;
  serialShown = 0;
  $('serialOut').innerHTML = '';
  $('eventsOut').innerHTML = '';
  $('analysisOut').textContent = '계산 중…';
  charts.setOverlay('w1', null);
  charts.setData(state.frames, 0);
}

function stopRun(reason) {
  if (runWorker) {
    runWorker.terminate();
    runWorker = null;
    if (state.running) finishRun({ code: 2, reason: reason || '사용자가 정지', t: lastT() }, 0);
  }
}
$('btnStop').onclick = () => stopRun();

function addFrames(data, count) {
  const need = (state.count + count) * FRAME_SIZE;
  if (need > state.frames.length) {
    const n = new Float32Array(Math.max(need, state.frames.length * 2));
    n.set(state.frames.subarray(0, state.count * FRAME_SIZE));
    state.frames = n;
  }
  state.frames.set(data, state.count * FRAME_SIZE);
  state.count += count;
  charts.setData(state.frames, state.count);
  updateTimeline();
}

function addSerial(lines) {
  for (const l of lines) {
    if (l.port === 9) { appendBuild('[stdout] ' + l.text); continue; }
    state.serial.push(l);
  }
  renderSerial();
}

function addEvents(evs) {
  const box = $('eventsOut');
  const names = { 0: '정보', 1: '경고', 3: '충돌', 5: '미지원', 7: 'Z 한계' };
  for (const e of evs) {
    state.events.push(e);
    if (e.type === 2 || e.type === 4 || e.type === 6 || e.type === 8) continue;
    const div = document.createElement('div');
    div.className = 'ev' + (e.type === 1 || e.type === 5 || e.type === 7 ? ' warn' : e.type === 3 ? ' err' : '');
    div.innerHTML = `<span class="ts">${(e.t / 1000).toFixed(3)}s</span>[${names[e.type] || e.type}] `;
    div.appendChild(document.createTextNode(e.text));
    div.onclick = () => seek(e.t);
    box.appendChild(div);
  }
}

function finishRun(result, wall) {
  state.running = false;
  state.ended = result;
  $('btnStop').disabled = true;
  runWorker && runWorker.terminate();
  runWorker = null;
  const t = Number.isFinite(result.t) ? (result.t / 1000).toFixed(2) + 's' : '';
  let msg;
  if (result.crash) msg = `프로그램 비정상 종료 (${result.message})`;
  else if (result.code === 0) msg = `완료 ${t}`;
  else if (result.code === 1) msg = `PrizmEnd() ${t}`;
  else if (result.code === 4) msg = `완료 ${t} (이후 변화 없음)`;
  else msg = `정지 ${t} ${result.reason || ''}`;
  setRunStatus(msg + (wall ? ` · 계산 ${wall.toFixed(1)}초` : ''), result.crash ? 'bad' : 'ok');
  if (result.crash) {
    const div = document.createElement('div');
    div.className = 'ev err';
    div.textContent = `런타임 오류: ${result.message} — 실물에서는 ESP32 리셋(Guru Meditation)에 해당할 수 있습니다 (배열 범위 초과, 널 포인터 등).`;
    $('eventsOut').appendChild(div);
    showConsole('events');
  }
  if (result.reason && /PrizmEnd/.test(result.reason)) appendBuild('PrizmEnd() 호출로 종료: 실물은 워치독 리셋 후 다시 시작 버튼을 기다립니다.\n');
  state.analysis = analyseRun(framesArray(), state.serial, state.events, state.paramsAtRun);
  renderAnalysis();
  if (charts.auto) { charts.fit(); charts.draw(); }
  renderSerial(true);
}

function framesArray() {
  const out = [];
  for (let i = 0; i < state.count; i++) out.push(state.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
  return out;
}

// ------------------------------------------------------------------ playback
function lastT() { return state.count ? state.frames[(state.count - 1) * FRAME_SIZE + F.t] : 0; }
function frameIndexAt(t) {
  const n = state.count;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (state.frames[mid * FRAME_SIZE + F.t] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
const interp = new Float32Array(FRAME_SIZE);
function frameAt(t) {
  const i = frameIndexAt(t);
  if (i < 0) return null;
  const a = state.frames.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
  if (i + 1 >= state.count) return a;
  const b = state.frames.subarray((i + 1) * FRAME_SIZE, (i + 2) * FRAME_SIZE);
  const k = Math.min(1, Math.max(0, (t - a[F.t]) / (b[F.t] - a[F.t] || 1)));
  interp.set(a);
  for (const key of ['t', 'x', 'v', 'z', 'j1', 'j2', 'wrist']) interp[F[key]] = a[F[key]] + (b[F[key]] - a[F[key]]) * k;
  return interp;
}

function seek(t) {
  state.playT = Math.max(0, Math.min(t, lastT()));
  renderSerial(true);
  drawFrame();
}

let lastNow = performance.now();
function tick(now) {
  const dt = Math.min(100, now - lastNow);
  lastNow = now;
  if (state.playing && state.count) {
    const end = lastT();
    state.playT += dt * state.speed;
    if (state.playT >= end) {
      state.playT = end;
      if (!state.running) { state.playing = false; $('btnPlay').textContent = '▶'; }
    }
    renderSerial();
    drawFrame();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function drawFrame() {
  const f = frameAt(state.playT);
  const p = state.paramsAtRun || state.params;
  if (f) view.update(f, p);
  charts.setCursor(state.playT);
  updateTimeline();
  renderHud(f, p);
}

function updateTimeline() {
  const end = lastT();
  $('timeline').max = Math.max(1, Math.round(end));
  $('timeline').value = Math.round(state.playT);
  $('timeLabel').textContent = `${(state.playT / 1000).toFixed(3)} / ${(end / 1000).toFixed(3)} s`;
}
$('timeline').addEventListener('input', (e) => seek(Number(e.target.value)));
$('btnPlay').onclick = () => togglePlay();
function togglePlay() {
  if (!state.count) return;
  if (!state.playing && state.playT >= lastT() - 1 && !state.running) state.playT = 0;
  state.playing = !state.playing;
  $('btnPlay').textContent = state.playing ? '❚❚' : '▶';
}
$('btnStepBack').onclick = () => { state.playing = false; $('btnPlay').textContent = '▶'; seek(state.playT - 100); };
$('btnStepFwd').onclick = () => { state.playing = false; $('btnPlay').textContent = '▶'; seek(state.playT + 100); };
$('selSpeed').onchange = (e) => { state.speed = Number(e.target.value); };
for (const b of document.querySelectorAll('.cam-buttons button')) b.onclick = () => view.setCamera(b.dataset.cam);

const MODE = { '-1': '비활성', 0: '코스트(파워0)', 1: '파워', 2: '브레이크(125)', 3: '속도제어', 4: '목표위치' };
function renderHud(f, p) {
  if (!f) { $('hud').innerHTML = '<span class="k">상태</span>실행 전'; return; }
  const geo = fieldGeometry(p);
  const rg = robotGeometry(p);
  const s5 = f[F.x] + rg.sensors[1].s;
  let li = 0, bd = Infinity;
  geo.lines.forEach((c, i) => { if (Math.abs(s5 - c) < bd) { bd = Math.abs(s5 - c); li = i; } });
  const err = s5 - geo.lines[li];
  const black = Number(p['sensor.blackLevel'] ?? 1);
  const dot = (v) => `<span class="dot ${v === black ? 'on' : ''}"></span>`;
  const cmd = Number.isFinite(f[F.cmd1]) ? f[F.cmd1].toFixed(0) : '—';
  $('hud').innerHTML =
    `<div><span class="k">시간</span><b>${(f[F.t] / 1000).toFixed(3)} s</b></div>` +
    `<div><span class="k">차체 속도</span>${f[F.v].toFixed(1)} mm/s</div>` +
    `<div><span class="k">모터1</span>${MODE[f[F.mode1]] ?? f[F.mode1]} · 명령 ${cmd} · 실제 ${f[F.w1].toFixed(0)} deg/s</div>` +
    `<div><span class="k">센서</span>${dot(f[F.sA])}${p['sensor.0.port']}번 ${dot(f[F.sB])}${p['sensor.1.port']}번</div>` +
    `<div><span class="k">5번 센서</span>라인 ${li} ${err >= 0 ? '+' : ''}${err.toFixed(1)} mm</div>` +
    `<div><span class="k">모터축</span>${f[F.x].toFixed(1)} mm (앞끝 여유 ${(geo.length - f[F.x] - rg.frontEnd).toFixed(1)} mm)</div>` +
    `<div><span class="k">레일</span>좌우 ${Number.isFinite(f[F.y]) ? f[F.y].toFixed(2) : '0.00'} mm · 접촉력 ${Number.isFinite(f[F.railF]) ? f[F.railF].toFixed(1) : '0.0'} N</div>` +
    `<div><span class="k">Z / 손목</span>${f[F.z].toFixed(1)} mm / ${f[F.wrist].toFixed(0)}</div>` +
    `<div><span class="k">루프 주기</span>${f[F.loops] ? (Number((p['run.frameMs'] ?? 5)) / f[F.loops]).toFixed(2) + ' ms' : '— (블로킹 중)'}</div>`;
}

// ------------------------------------------------------------------ serial view
let serialShown = 0;
function renderSerial(full) {
  const out = $('serialOut');
  const sync = $('chkSyncSerial').checked;
  const limitT = sync ? state.playT : Infinity;
  if (full) { out.innerHTML = ''; serialShown = 0; }
  // if we went back in time, rebuild
  if (serialShown > 0 && sync && state.serial[serialShown - 1] && state.serial[serialShown - 1].t > limitT + 1) { out.innerHTML = ''; serialShown = 0; }
  let html = '';
  let i = serialShown;
  const start = full ? Math.max(0, countBefore(limitT) - 3000) : i;
  if (full) i = start;
  for (; i < state.serial.length && state.serial[i].t <= limitT; i++) {
    const l = state.serial[i];
    html += `<span class="ts">[${(l.t / 1000).toFixed(3)}]</span> ${esc(l.text.replace(/\r?\n$/, ''))}\n`;
  }
  if (html) {
    out.insertAdjacentHTML('beforeend', html);
    out.scrollTop = out.scrollHeight;
  }
  serialShown = i;
}
function countBefore(t) { let n = 0; while (n < state.serial.length && state.serial[n].t <= t) n++; return n; }
$('chkSyncSerial').onchange = () => renderSerial(true);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function showConsole(tab) {
  for (const b of $('consoleTabs').children) b.classList.toggle('active', b.dataset.tab === tab);
  $('serialOut').classList.toggle('active', tab === 'serial');
  $('buildOut').classList.toggle('active', tab === 'build');
  $('eventsOut').classList.toggle('active', tab === 'events');
}
for (const b of $('consoleTabs').children) b.onclick = () => showConsole(b.dataset.tab);
for (const b of $('rightTabs').children) b.onclick = () => {
  for (const x of $('rightTabs').children) x.classList.toggle('active', x === b);
  for (const p of document.querySelectorAll('.tabpane')) p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab);
  if (b.dataset.tab === 'charts') charts.draw();
};

// ------------------------------------------------------------------ analysis view
function renderAnalysis() {
  const a = state.analysis;
  const out = $('analysisOut');
  if (!a || !a.summary.frames) { out.textContent = '데이터 없음'; return; }
  const s = a.summary;
  const card = (v, l) => `<div class="card"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  let h = '<div class="cards">' +
    card(s.missionSeconds !== null ? s.missionSeconds + ' s' : '—', '미션 시간 (첫 움직임 → LED 3회)') +
    card(s.firstMotionS !== null ? s.firstMotionS + ' s' : '—', '전원 후 첫 움직임') +
    card(s.stopLines || '—', '정지한 라인 순서 (선 위 센서 기준)') +
    card(s.maxSpeedMmS + ' mm/s', '최고 차체 속도') +
    card(`${a.score.lineScore}점`, '라인·복귀 예상 점수 (참고)') +
    card(s.collisions ? `<span class="bad">${s.collisions}</span>` : '0', '경기장 끝 충돌') +
    '</div>';
  h += '<h3>정지 위치 (라인 중심 대비 센서 오차 mm, +는 4번 라인 쪽 · −는 시작 쪽)</h3><table><tr><th>#</th><th>시각</th><th>방향</th><th>라인</th><th>5번 센서</th><th>4번 센서</th><th>모터축 위치</th><th>앞끝/뒤끝 여유</th><th>정지 유지</th><th>바퀴 전부 시작구역</th></tr>';
  a.stops.forEach((st, k) => {
    const e5 = st.sensorErr[1], e4 = st.sensorErr[0];
    const ref5 = st.refSensor === 1;  // which sensor was actually on a line
    const cls = (e, isRef) => (!isRef ? 'note' : Math.abs(e) <= a.geo.width / 2 ? 'ok' : Math.abs(e) <= 20 ? 'warn' : 'bad');
    h += `<tr class="click" data-t="${st.t}"><td>${k + 1}</td><td>${(st.t / 1000).toFixed(2)}s</td><td>${st.dir > 0 ? '전진' : '후진'}</td><td>${st.nearestLine}</td>` +
      `<td class="${cls(e5, ref5)}">L${st.sensorLine[1]} ${e5 >= 0 ? '+' : ''}${e5.toFixed(1)}</td><td class="${cls(e4, !ref5)}">L${st.sensorLine[0]} ${e4 >= 0 ? '+' : ''}${e4.toFixed(1)}</td>` +
      `<td>${st.axle.toFixed(1)} mm</td><td class="${st.frontGap < 1 || st.rearGap < 1 ? 'bad' : ''}">${st.frontGap.toFixed(1)} / ${st.rearGap.toFixed(1)} mm</td><td>${(st.duration / 1000).toFixed(2)}s</td><td>${st.inStartZone ? '<span class="ok">예</span>' : '아니오'}</td></tr>`;
  });
  h += '</table>';
  h += '<h3>예상 점수 (대회 규정 V1.3 배점, 시뮬레이션 기준 참고값)</h3><table><tr><th>항목</th><th>배점</th><th>결과</th></tr>';
  for (const it of a.score.items) h += `<tr><td>${it.label}</td><td>${it.points}</td><td>${it.ok ? '<span class="ok">달성</span>' : '<span class="bad">미달성</span>'}${it.detail ? ` <span class="note">(바퀴 시작구역 ${it.detail.allWheelsIn ? 'O' : 'X'}, LED ${it.detail.returnBlinks}회)</span>` : ''}</td></tr>`;
  h += `</table><p class="note">${a.score.waferNote} 정지 라인은 선 위에 있던 센서(보통 5번, 0→4는 4번) 기준입니다. 심판 판정 기준(바퀴축/차체)에 맞게 오차 열을 함께 보세요.</p>`;
  h += '<h3>주행 구간</h3><table><tr><th>출발</th><th>도착</th><th>이동</th><th>최고속도</th><th>소요</th></tr>';
  for (const l of a.legs) h += `<tr class="click" data-t="${l.t0}"><td>${(l.t0 / 1000).toFixed(2)}s</td><td>${(l.t1 / 1000).toFixed(2)}s</td><td>${(l.to - l.from).toFixed(0)} mm</td><td>${l.peak.toFixed(0)} mm/s</td><td>${((l.t1 - l.t0) / 1000).toFixed(2)}s</td></tr>`;
  h += '</table>';
  if (a.markers.length) {
    h += '<h3>코드 로그 마커 (BASE_*, SCORING_*, MISSION_*)</h3><table><tr><th>시각</th><th>내용</th></tr>';
    for (const m of a.markers.slice(0, 400)) h += `<tr class="click" data-t="${m.t}"><td>${(m.t / 1000).toFixed(3)}s</td><td>${esc(m.text)}</td></tr>`;
    h += '</table>';
  }
  out.innerHTML = h;
  for (const tr of out.querySelectorAll('tr.click')) tr.onclick = () => { seek(Number(tr.dataset.t)); charts.zoomAround(Number(tr.dataset.t), 4000); };
}

// ------------------------------------------------------------------ settings
function renderParams() {
  const sel = $('selField');
  sel.innerHTML = Object.entries(FIELD_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('') + '<option value="custom">사용자 지정</option>';
  const cur = Object.entries(FIELD_PRESETS).find(([, v]) => Object.entries(v).every(([k, val]) => k === 'label' || Number(state.params[k]) === val));
  sel.value = cur ? cur[0] : 'custom';
  const groups = {};
  for (const spec of PARAM_SPECS) (groups[spec[4]] ??= []).push(spec);
  const form = $('paramsForm');
  form.innerHTML = '';
  for (const [g, specs] of Object.entries(groups)) {
    const div = document.createElement('div');
    div.className = 'pgroup';
    div.innerHTML = `<h4>${g}</h4>`;
    for (const [key, def, label, unit, , note] of specs) {
      const row = document.createElement('div');
      row.className = 'prow';
      const isText = typeof def === 'string';
      row.innerHTML = `<label title="${key}">${label}</label><input ${isText ? 'type="text"' : 'type="number" step="any"'} data-key="${key}"><span class="u">${unit}</span>` + (note ? `<div class="src">${note}</div>` : '');
      const inp = row.querySelector('input');
      inp.value = state.params[key];
      inp.onchange = () => {
        state.params[key] = isText ? inp.value : Number(inp.value);
        saveParams();
        markParamsDirty();
        if (key.startsWith('field.')) renderParams();
      };
      div.appendChild(row);
    }
    form.appendChild(div);
  }
}
function markParamsDirty() {
  $('paramsDirty').textContent = '변경됨 → [▶ 컴파일 & 실행]을 다시 눌러야 반영됩니다 (코드가 같으면 컴파일은 건너뜁니다)';
  if (!state.running && !state.count) { view.build(state.params); showIdleRobot(); }
}
$('selField').onchange = (e) => {
  if (e.target.value === 'custom') return;
  applyFieldPreset(state.params, e.target.value);
  saveParams();
  renderParams();
  markParamsDirty();
};
$('btnParamsDefault').onclick = () => { if (!confirm('모든 설정을 기본값으로 되돌릴까요?')) return; state.params = defaultParams(); saveParams(); renderParams(); markParamsDirty(); };
$('btnParamsExport').onclick = () => download(new Blob([JSON.stringify({ ...state.params, _v: PARAMS_VERSION }, null, 2)], { type: 'application/json' }), 'wafersim-settings.json');
$('btnParamsImport').onclick = () => $('inpParams').click();
$('inpParams').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    const p = defaultParams();
    // an exported field choice is explicit, keep it; robot geometry from older versions is outdated
    const kept = migrateParams(obj);
    for (const [k, v] of Object.entries(obj)) if (k.startsWith('field.') && k in p) kept[k] = v;
    for (const [k, v] of Object.entries(kept)) if (k in p) p[k] = v;
    state.params = p;
    saveParams();
    renderParams();
    markParamsDirty();
  } catch (err) { alert('설정 파일을 읽지 못했습니다: ' + err.message); }
  e.target.value = '';
};

// ------------------------------------------------------------------ calibration (real vs sim BASE_TRACE)
function parseTraceBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (line.startsWith('BASE_TRACE_STOP')) { cur = { head: line, rows: [] }; blocks.push(cur); continue; }
    const m = line.match(/^BASE_TRACE,(\d+),(-?\d+),(-?\d+),(-?[\d.]+),(-?[\d.]+),(\d+)/);
    if (m) {
      if (!cur) { cur = { head: '(헤더 없음)', rows: [] }; blocks.push(cur); }
      cur.rows.push({ ms: +m[1], cmd: +m[2], e1: +m[4], e2: +m[5], phase: +m[6] });
    }
  }
  return blocks.filter((b) => b.rows.length);
}
let calibReal = [], calibSim = [];
$('btnCalib').onclick = () => {
  calibReal = parseTraceBlocks($('calibInput').value.split('\n'));
  calibSim = parseTraceBlocks(state.serial.map((l) => l.text));
  const sel = $('selCalibBlock');
  sel.innerHTML = calibReal.map((b, i) => `<option value="${i}">실측 #${i + 1}: ${esc(b.head.slice(0, 70))}</option>`).join('');
  $('calibInfo').textContent = `실측 ${calibReal.length}개 · 시뮬 ${calibSim.length}개 블록`;
  drawCalib();
};
$('selCalibBlock').onchange = drawCalib;
function drawCalib() {
  const c = $('calibCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const i = Number($('selCalibBlock').value || 0);
  const real = calibReal[i], sim = calibSim[i];
  if (!real) { g.fillStyle = '#8a97a6'; g.fillText('실측 로그를 붙여 넣고 [비교하기]를 누르세요. (먼저 시뮬레이션을 실행해야 합니다)', 12, 20); return; }
  const all = [...real.rows, ...(sim ? sim.rows : [])];
  const tmax = Math.max(...all.map((r) => r.ms), 100);
  const vals = all.flatMap((r) => [r.cmd, Math.abs(r.e1)]);
  const vmax = Math.max(...vals, 10) * 1.1;
  const L = 44, B = 18, T = 8, R = 8;
  const x = (t) => L + (t / tmax) * (W - L - R), y = (v) => T + (H - T - B) * (1 - v / vmax);
  g.strokeStyle = 'rgba(128,128,128,.3)'; g.fillStyle = '#8a97a6'; g.font = '10px system-ui';
  for (let k = 0; k <= 4; k++) { const v = (vmax * k) / 4; g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - R, y(v)); g.stroke(); g.fillText(v.toFixed(0), 6, y(v) + 3); }
  for (let k = 0; k <= 6; k++) { const t = (tmax * k) / 6; g.fillText((t / 1000).toFixed(2) + 's', x(t) - 12, H - 4); }
  const plot = (rows, key, color, dash) => {
    g.strokeStyle = color; g.lineWidth = 1.8; g.setLineDash(dash || []);
    g.beginPath(); rows.forEach((r, k) => { const v = key === 'cmd' ? r.cmd : Math.abs(r.e1); k ? g.lineTo(x(r.ms), y(v)) : g.moveTo(x(r.ms), y(v)); }); g.stroke();
    g.setLineDash([]);
  };
  plot(real.rows, 'cmd', '#f2c14e', [4, 3]);
  plot(real.rows, 'e1', '#ff6b6b');
  if (sim) plot(sim.rows, 'e1', '#4fa3ff');
  g.fillStyle = '#ff6b6b'; g.fillText('■ 실측 엔코더1', W - 230, 14);
  g.fillStyle = '#4fa3ff'; g.fillText('■ 시뮬 엔코더1', W - 150, 14);
  g.fillStyle = '#f2c14e'; g.fillText('-- 명령', W - 70, 14);
  if (!sim) { g.fillStyle = '#ffb347'; g.fillText('같은 순서의 시뮬레이션 블록이 없습니다', L + 6, 16); }
  else {
    const n = Math.min(real.rows.length, sim.rows.length);
    let se = 0; for (let k = 0; k < n; k++) se += (Math.abs(real.rows[k].e1) - Math.abs(sim.rows[k].e1)) ** 2;
    $('calibInfo').textContent = `실측 ${calibReal.length}개 · 시뮬 ${calibSim.length}개 블록 · 이 블록 RMS 차이 ${Math.sqrt(se / Math.max(1, n)).toFixed(1)} deg/s`;
  }
}

// ------------------------------------------------------------------ misc
function setStatus(t) { $('projStatus').textContent = t; }
function setRunStatus(t, cls) { const el = $('runStatus'); el.textContent = t; el.className = 'run-status ' + (cls || ''); }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('btnRun').onclick = runAll;
$('btnHelp').onclick = () => { $('helpBody').innerHTML = HELP_HTML; $('helpDlg').showModal(); };
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAll(); }
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowLeft') $('btnStepBack').click();
  if (e.key === 'ArrowRight') $('btnStepFwd').click();
});
// splitter
(() => {
  const sp = $('splitter');
  let drag = false;
  sp.onmousedown = () => { drag = true; document.body.style.cursor = 'col-resize'; };
  window.addEventListener('mousemove', (e) => { if (drag) $('left').style.width = Math.max(300, Math.min(window.innerWidth - 450, e.clientX)) + 'px'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.cursor = ''; });
})();

// ------------------------------------------------------------------ boot
renderParams();
renderHud(null);
showIdleRobot();
function showIdleRobot() {
  const f = new Float32Array(FRAME_SIZE);
  f[F.x] = Number(state.params['robot.startAxleMm']);
  f[F.z] = Number(state.params['z.initialMm']);
  f[F.j1] = Number(state.params['arm.initialJ1']);
  f[F.j2] = Number(state.params['arm.initialJ2']);
  f[F.wrist] = 90;
  f[F.sA] = f[F.sB] = 1 - Number(state.params['sensor.blackLevel'] ?? 1);
  view.update(f, state.params);
}
(async () => {
  const saved = await DB.get('project');
  if (saved && saved.files && Object.keys(saved.files).length) {
    state.files = saved.files;
    state.original = saved.original || { ...saved.files };
    state.name = saved.name;
    state.active = saved.active;
    renderFiles();
    setStatus('지난번에 열었던 스케치를 불러왔습니다 (이 브라우저에만 저장됨)');
  }
  // warm up the compiler in the background so the first run is faster
  setTimeout(() => getCompileWorker().postMessage({ type: 'warmup' }), 1500);
})();
window.__wafersim = { state, view, charts };
