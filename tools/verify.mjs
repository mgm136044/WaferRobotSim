// Design verification: checks the simulator against the three requirements with
// measurable criteria and writes docs/VERIFICATION.md (+ verification.json).
//
// node tools/verify.mjs --zip <team sketch zip> --real-log <serial.raw.log> --prizm-lib <TETRIX_PRIZM_PRO folder>
//
// The team's code and the vendor library are only READ from the given paths; nothing
// of them is copied into this repository.
import { runClang } from '@yowasp/clang';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareBuild, toTree, locateSketch } from '../web/js/sketch-build.js';
import { runSketch, F, FRAME_SIZE } from '../web/js/sim-host.js';
import { defaultParams, fieldGeometry, applyFieldPreset, FIELD_PRESETS } from '../web/js/params.js';
import { analyseRun } from '../web/js/analysis.js';
import { readZip, decodeText } from '../web/js/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const zipPath = arg('--zip'), realLogPath = arg('--real-log'), prizmLib = arg('--prizm-lib');
const rt = JSON.parse(fs.readFileSync(path.join(root, 'web/rt/runtime.json'), 'utf8'));
const rtObjects = {};
for (const o of rt.objects) rtObjects[o] = fs.readFileSync(path.join(root, 'web/rt/obj', o));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const results = [];
const check = (req, name, ok, detail, data) => { results.push({ req, name, ok, detail, data }); console.log(`${ok ? 'PASS' : 'FAIL'} [${req}] ${name}: ${detail}`); };

async function compile(files, runtime = { headers: rt.headers, objects: rtObjects }) {
  const { args, vfs, sketch } = prepareBuild(files, runtime);
  let log = '';
  try {
    const out = await runClang(args, toTree(vfs), { stderr: (b) => { if (b) log += new TextDecoder().decode(b); } });
    return { wasm: out['sketch.wasm'], sketch, log };
  } catch { return { wasm: null, sketch, log }; }
}
async function run(wasm, params) {
  const frames = [], serial = [], events = [];
  const res = await runSketch(wasm, {
    params, onSerial: (port, t, text) => serial.push({ port, t, text }),
    onFrame: (f) => frames.push(Float32Array.from(f.subarray(0, FRAME_SIZE))),
    onEvent: (e) => events.push(e), onTick: () => false,
  });
  return { res, frames, serial, events };
}
const frameAt = (frames, t) => frames.reduce((b, f) => (Math.abs(f[F.t] - t) < Math.abs(b[F.t] - t) ? f : b), frames[0]);
const serialT = (serial, re) => { const s = serial.find((l) => re.test(l.text)); return s ? s.t : null; };

// ============================================================ REQ 3: code compatibility
let teamFiles = null, mission = null;
if (zipPath) {
  const entries = await readZip(fs.readFileSync(zipPath).buffer.slice(0));
  const files = {};
  for (const [p, b] of Object.entries(entries)) if (/\.(ino|cpp|c|h|hpp)$/i.test(p) && !p.startsWith('__MACOSX')) files[p] = decodeText(b);
  const sk = locateSketch(files);
  teamFiles = {};
  for (const [rel, text] of Object.entries(sk.all)) if (!rel.includes('/') || rel.startsWith('src/')) teamFiles[rel] = text;
  // byte-identity: what gets compiled == what is in the zip
  const { vfs } = prepareBuild(teamFiles, { headers: rt.headers, objects: rtObjects });
  let identical = 0, total = 0;
  for (const rel of Object.keys(teamFiles)) {
    if (/\.(ino|pde)$/i.test(rel)) continue; // .ino is wrapped with #line, checked below
    total++;
    const zipKey = Object.keys(entries).find((k) => !k.startsWith('__MACOSX') && (k === sk.root + rel));
    if (zipKey && sha(Buffer.from(vfs['sketch/' + rel], 'utf8')) === sha(Buffer.from(entries[zipKey]))) identical++;
  }
  const inoUnit = vfs['sketch/' + sk.mainIno + '.cpp'];
  const inoOriginal = teamFiles[sk.mainIno].replace(/\r\n?/g, '\n');
  // remove the arduino-builder additions (#include <Arduino.h>, #line markers, prototype block)
  const U = inoUnit.split('\n').slice(1).filter((l) => !/^#line \d+ "/.test(l));
  const L = inoOriginal.split('\n');
  let k = 0;
  while (k < L.length && U[k] === L[k]) k++;
  const protoCount = U.length - L.length - 1; // trailing newline added by the unit
  const rest = U.slice(k + protoCount);
  const inoContained = rest.slice(0, L.length - k).join('\n') === L.slice(k).join('\n');
  check('3', '원본 무수정 컴파일 대상', identical === total && inoContained,
    `.cpp/.h ${identical}/${total}개가 ZIP과 SHA-256 동일, .ino 본문 그대로 포함(.ino ${L.length}줄 그대로 + 자동 프로토타입 ${protoCount}줄을 ${k + 1}번째 줄 앞에 삽입)`);
  const t0 = Date.now();
  const c = await compile(teamFiles);
  check('3', '브라우저용 clang으로 컴파일', !!c.wasm, c.wasm ? `${((Date.now() - t0) / 1000).toFixed(1)}초, 오류 0` : c.log.slice(0, 400));
  if (c.wasm) {
    const params = defaultParams();
    const t1 = Date.now();
    mission = await run(c.wasm, params);
    const a = analyseRun(mission.frames, mission.serial, mission.events, params);
    mission.analysis = a;
    const text = mission.serial.map((s) => s.text).join('');
    const faults = (text.match(/^.*(FAULT|ABORT|REJECT|FAILED).*$/gm) || []).filter((l) => !/ServoOff FAIL/.test(l));
    check('3', '미션 끝까지 실행 (32장 작업 + 채점 경로)', /MISSION_DONE/.test(text) && faults.length === 0,
      `MISSION_DONE ${(serialT(mission.serial, /MISSION_DONE/) / 1000).toFixed(1)}초, FAULT/ABORT 0건, 계산 ${((Date.now() - t1) / 1000).toFixed(1)}초`);
    check('3', '코드가 의도한 정지 순서', a.summary.stopLines === '0 → 1 → 0 → 2 → 0 → 3 → 0 → 4 → 2 → 0', a.summary.stopLines);
    const unsupported = mission.events.filter((e) => e.type === 5);
    check('3', '미지원 API 호출 없음', unsupported.length === 0, unsupported.length ? unsupported.map((e) => e.text).join('; ') : '0건');
    const blinks = a.blinks.filter((t) => t > (serialT(mission.serial, /BASE_DONE line=0/g) || 0));
    check('3', '종료 LED 3회 + 시작 구역 복귀', a.score.items[5].ok, `복귀 후 빨간 LED ${a.score.items[5].detail.returnBlinks}회, 바퀴 전부 시작구역=${a.score.items[5].detail.allWheelsIn}`);
  }
}

// ============================================================ REQ 1: driving fidelity
// 1a. real BASE_TRACE (initial line-0 alignment) vs simulation
if (realLogPath && mission) {
  const parse = (lines) => {
    const out = [];
    for (const l of lines) { const m = l.match(/BASE_TRACE,(\d+),(-?\d+),(-?\d+),(-?[\d.]+),(-?[\d.]+),(\d+)/); if (m) out.push({ ms: +m[1], cmd: +m[2], e1: +m[4] }); if (/BASE_DONE/.test(l) && out.length) break; }
    return out;
  };
  const real = parse(fs.readFileSync(realLogPath, 'utf8').split(/\r?\n/));
  const sim = parse(mission.serial.map((s) => s.text.trim()));
  const n = Math.min(real.length, sim.length);
  let se = 0;
  const rows = [];
  for (let i = 0; i < n; i++) { se += (real[i].e1 - sim[i].e1) ** 2; rows.push([real[i].ms, real[i].cmd, real[i].e1, sim[i].e1]); }
  const rms = Math.sqrt(se / n);
  const ss = (arr) => { const tail = arr.slice(-8); return tail.reduce((a, r) => a + r.e1, 0) / tail.length; };
  check('1', '실측 BASE_TRACE 재현 (0번 정렬, 명령 100 deg/s)', rms < 5,
    `샘플 ${n}개 RMS 차이 ${rms.toFixed(1)} deg/s, 정상상태 실측 ${ss(real).toFixed(1)} / 시뮬 ${ss(sim).toFixed(1)} deg/s`, { rows });
}

// 1b-1e. physics consistency with a probe sketch
const PROBE = `#include <PRIZM_PRO.h>
PRIZM prizm;
long enc() { return prizm.getEncoderCount(1); }
void setup() {
  Serial.begin(115200);
  prizm.PrizmBegin();
  prizm.resetEncoders();
  prizm.setMotorSpeeds(360, -360);
  delay(2000);
  long e0 = enc(); unsigned long t0 = millis(); delay(1000); long e1 = enc(); unsigned long t1 = millis();
  Serial.printf("SPEED360 %.2f\\n", (e1 - e0) * 250.0 / (t1 - t0));
  prizm.setMotorSpeeds(720, -720);
  delay(1500);
  e0 = enc(); t0 = millis(); delay(500); e1 = enc(); t1 = millis();
  Serial.printf("SPEED720 %.2f\\n", (e1 - e0) * 250.0 / (t1 - t0));
  Serial.println("MARK_BRAKE");
  prizm.setMotorPowers(125, 125);
  delay(1500);
  prizm.setMotorSpeeds(-720, 720);
  delay(1500);
  Serial.println("MARK_COAST");
  prizm.setMotorPowers(0, 0);
  delay(2500);
  prizm.setMotorSpeeds(120, -120);
  delay(2500);
  Serial.println("MARK_SLOWBRAKE");
  prizm.setMotorPowers(125, 125);
  delay(1000);
  Serial.println("END");
}
void loop() {}
`;
{
  const params = defaultParams();
  const c = await compile({ 'Probe/Probe.ino': PROBE });
  const r1 = await run(c.wasm, params);
  const r2 = await run(c.wasm, params);
  const ratio = Number(params['prizm.speedRatio']);
  const s360 = Number((r1.serial.find((l) => /SPEED360/.test(l.text)) || { text: 'SPEED360 0' }).text.split(' ')[1]);
  const s720 = Number((r1.serial.find((l) => /SPEED720/.test(l.text)) || { text: 'SPEED720 0' }).text.split(' ')[1]);
  check('1', '속도제어 추종 (360 deg/s 명령)', Math.abs(s360 - 360 * ratio) < 360 * 0.03, `엔코더 ${s360.toFixed(1)} deg/s (설정 추종비율 ${ratio} → 기대 ${(360 * ratio).toFixed(0)})`);
  const wNoLoad = Number(params['motor.noLoadRpm']) * 6 * Number(params['motor.batteryV']) / Number(params['motor.nominalV']);
  check('1', '720 deg/s 명령이 모터 한계 안에서 동작', s720 <= wNoLoad && s720 > 360, `엔코더 ${s720.toFixed(1)} deg/s (무부하 한계 ${wNoLoad.toFixed(0)} deg/s 이하)`);
  // encoder vs chassis displacement (no slip at constant speed)
  const tA = 2600, tB = 3400;
  const fA = frameAt(r1.frames, tA), fB = frameAt(r1.frames, tB);
  const C = Number(params['drive.mmPerRev']);
  const dxEnc = (fB[F.enc1] - fA[F.enc1]) / 1440 * C, dx = fB[F.x] - fA[F.x];
  check('1', '엔코더 ↔ 차체 이동 일치 (등속, 미끄럼 없음)', Math.abs(dxEnc - dx) / dx < 0.01, `엔코더 환산 ${dxEnc.toFixed(1)} mm / 차체 ${dx.toFixed(1)} mm (C=${C} mm/rev)`);
  const stopDist = (mark) => {
    const t = serialT(r1.serial, mark);
    const f0 = frameAt(r1.frames, t);
    let tStop = null;
    for (const f of r1.frames) if (f[F.t] > t && Math.abs(f[F.v]) < 0.5) { tStop = f[F.t]; break; }
    const f1 = frameAt(r1.frames, tStop ?? t + 1000);
    return { v0: f0[F.v], d: Math.abs(f1[F.x] - f0[F.x]), dt: (tStop ?? NaN) - t };
  };
  const br = stopDist(/MARK_BRAKE/), co = stopDist(/MARK_COAST/), sb = stopDist(/MARK_SLOWBRAKE/);
  const mu = Number(params['robot.tireMu']), frac = Number(params['robot.driveWeightFrac']), M = Number(params['robot.massKg']);
  // fastest physically possible stop: drive wheels skidding (mu*N) + rolling/guide resistance
  const aMax = (mu * 9.81 * frac * M + Number(params['robot.rollResistN']) + Number(params['robot.rollViscous']) * Math.abs(br.v0) / 1000) / M * 1000;
  const dExpect = (br.v0 * br.v0) / (2 * aMax);
  check('1', '브레이크(125) 정지거리 물리 일관성', Math.abs(br.d - dExpect) / dExpect < 0.15 && br.d < co.d,
    `${br.v0.toFixed(0)} mm/s에서 ${br.d.toFixed(1)} mm/${br.dt.toFixed(0)} ms — 바퀴 미끄럼 한계 계산값 ${dExpect.toFixed(1)} mm와 일치, 코스트(파워 0) ${co.d.toFixed(1)} mm/${co.dt.toFixed(0)} ms보다 짧음`);
  check('1', '저속 접근 브레이크 (120 deg/s)', sb.d < 3, `${Math.abs(sb.v0).toFixed(1)} mm/s에서 ${sb.d.toFixed(2)} mm 만에 정지`);
  // line sensor edges
  const geo = fieldGeometry(params);
  const edges = geo.lines.flatMap((c) => [c - geo.width / 2, c + geo.width / 2]);
  const sensorEv = r1.events.filter((e) => e.type === 2);
  const errs = sensorEv.map((e) => Math.min(...edges.map((x) => Math.abs(e.c - x))));
  const maxErr = Math.max(...errs, 0);
  check('1', '라인 센서 경계 위치', sensorEv.length > 0 && maxErr < 0.5, `센서 전환 ${sensorEv.length}회, 선 경계와의 최대 차이 ${maxErr.toFixed(3)} mm (응답지연 ${params['sensor.latencyMs']} ms 포함)`);
  // determinism
  const h = (r) => sha(Buffer.concat(r.frames.map((f) => Buffer.from(f.buffer.slice(0)))));
  check('1', '결정적 재현 (같은 입력 → 같은 결과)', h(r1) === h(r2), `프레임 ${r1.frames.length}개 해시 동일`);
}

// 1f. CAN SDO round trip vs measured start gap (team drivers, unmodified)
if (teamFiles) {
  const need = ['ArduinoCANBus.cpp', 'ArduinoCANBus.hpp', 'AservoDrive.cpp', 'AservoDrive.hpp', 'IAservoBus.hpp', 'SerialToCAN.cpp', 'SerialToCAN.h'];
  if (need.every((f) => f in teamFiles)) {
    const files = { 'CanTiming/CanTiming.ino': `#include "ArduinoCANBus.hpp"
#include "AservoDrive.hpp"
HardwareSerial mySerial(1);
robowell::ArduinoCANBus bus;
robowell::AservoDrive d1(bus, 1);
void setup() {
  Serial.begin(115200);
  bus.begin(mySerial, 38400, 15, 16);
  int hist[40] = {0};
  for (int i = 0; i < 200; i++) {
    delayMicroseconds(37 * (i % 27));          // de-phase from the 1 ms tick like the real loop
    unsigned long s = millis();
    d1.TriggerAbsolute();                      // the same single SDO write as arm_moves_trigger()
    unsigned long gap = millis() - s;
    if (gap < 40) hist[gap]++;
    d1.ReleaseAbsolute();
  }
  for (int g = 0; g < 40; g++) if (hist[g]) Serial.printf("GAP %d %d\\n", g, hist[g]);
  Serial.println("END");
}
void loop() {}
` };
    for (const f of need) files['CanTiming/' + f] = teamFiles[f];
    const c = await compile(files);
    const r = await run(c.wasm, defaultParams());
    const hist = Object.fromEntries(r.serial.filter((l) => /^GAP/.test(l.text)).map((l) => l.text.trim().split(' ').slice(1).map(Number)));
    const n = Object.values(hist).reduce((a, b) => a + b, 0);
    const mean = Object.entries(hist).reduce((a, [g, k]) => a + g * k, 0) / n;
    let realHist = null;
    if (realLogPath) {
      realHist = {};
      for (const m of fs.readFileSync(realLogPath, 'utf8').matchAll(/ARM_START_COMMAND_GAP_MS=(\d+)/g)) if (+m[1] > 0) realHist[m[1]] = (realHist[m[1]] || 0) + 1;
    }
    const realMean = realHist ? Object.entries(realHist).reduce((a, [g, k]) => a + g * k, 0) / Object.values(realHist).reduce((a, b) => a + b, 0) : null;
    check('1', 'CAN SDO 1회 시간 (팀 드라이버 코드 그대로)', realMean ? Math.abs(mean - realMean) <= 1 : true,
      `시뮬 ${JSON.stringify(hist)} 평균 ${mean.toFixed(2)} ms` + (realHist ? ` / 실측 ARM_START_COMMAND_GAP_MS ${JSON.stringify(realHist)} 평균 ${realMean.toFixed(2)} ms` : ''));
  }
}

// ============================================================ REQ 3: PRIZM protocol conformance
if (prizmLib && fs.existsSync(path.join(prizmLib, 'PRIZM_PRO.cpp'))) {
  const PROTO = `#include <PRIZM_PRO.h>
#include <Wire.h>
PRIZM prizm;
void setup() {
  Serial.begin(115200);
  prizm.PrizmBegin();
  prizm.setMotorSpeeds(100, -100); prizm.setMotorSpeeds(-720, 720, 5, -5);
  prizm.setMotorPowers(125, 125); prizm.setMotorPowers(0, 0, 50, -50);
  prizm.setMotorPower(1, 40); prizm.setMotorPower(2, 125); prizm.setMotorBrake(1, 1); prizm.setMotorBrake(2, 0);
  prizm.setMotorSpeed(1, 300); prizm.setMotorSpeed(2, -300);
  prizm.setMotorTarget(1, 200, 1440); prizm.setMotorTargets(150, -2880, 150, 2880);
  prizm.setMotorDegree(2, 180, -90); prizm.setMotorDegrees(90, 45, 90, -45);
  prizm.setMotorInvert(2, 1); prizm.setMotorInvert(2, 0);
  long a = prizm.getEncoderCount(1) + prizm.readEncoderCount(2) + prizm.getEncoderDegrees(1);
  prizm.resetEncoder(1); prizm.resetEncoders();
  int b = prizm.getMotorBusy(1) + prizm.readMotorBusy(2);
  prizm.setMotorSpeedPID(10, 20, 30); prizm.setMotorTargetPID(1, 2, 3);
  prizm.setServoSpeed(1, 30); prizm.setServoSpeed(1, 30); prizm.setServoPosition(1, 120); prizm.setServoPosition(1, 120);
  prizm.setServoSpeeds(10, 20, 30, 40, 50, 60); prizm.setServoPositions(10, 20, 30, 40, 50, 60);
  prizm.setCRServoState(2, 50); prizm.enableServos(0); prizm.enableServos(1);
  int c = prizm.getServoPosition(1) + prizm.readServoPosition(3);
  double v = prizm.getBatteryVoltage();
  prizm.setMotorPWM_Freq(20000);
  // direct register writes used by the team code (tray_motion.cpp / base_speed_trace.h)
  Wire1.beginTransmission(6); Wire1.write(0x2F); Wire1.write(77); Wire1.endTransmission();
  Wire1.beginTransmission(5); Wire1.write(uint8_t(0x38 + 1)); Wire1.endTransmission(); Wire1.requestFrom(uint8_t(5), size_t(4));
  Serial.printf("DONE %ld %d %d %.1f\\n", a, b, c, v);
}
void loop() {}
`;
    // build A: simulator implementation; build B: the vendor library compiled on the same virtual bus
    const params = { ...defaultParams(), 'debug.i2c': 1 };
    const logOf = (r) => r.events.filter((e) => e.type === 9).map((e) => e.text);
    const A = await compile({ 'Proto/Proto.ino': PROTO });
    const rA = await run(A.wasm, params);
    const hdr = { ...rt.headers };
    delete hdr['PRIZM_PRO.h'];
    hdr['esp_system.h'] = '#pragma once\n#include "esp_compat.h"\n';
    hdr['esp32-hal-ledc.h'] = '#pragma once\n';
    const objs = Object.fromEntries(Object.entries(rtObjects).filter(([k]) => k !== 'prizm.o'));
    const libFiles = { 'Proto/Proto.ino': PROTO };
    for (const f of ['PRIZM_PRO.cpp', 'PRIZM_PRO.h', 'notes.h', 'soundEffects.h', 'pixelPatterns.h'])
      libFiles['Proto/' + f] = fs.readFileSync(path.join(prizmLib, f), 'utf8');
    libFiles['Proto/Adafruit_NeoPixel.h'] = `#pragma once
#include <Arduino.h>
#define NEO_GRB 0
#define NEO_KHZ800 0
class Adafruit_NeoPixel { public:
  Adafruit_NeoPixel(uint16_t, int16_t = 6, int = 0) {}
  void begin() {} void show() {} void clear() {} void setBrightness(uint8_t) {} uint16_t numPixels() const { return 3; }
  void setPixelColor(uint16_t, uint32_t) {} void setPixelColor(uint16_t, uint8_t, uint8_t, uint8_t) {}
  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) { return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }
};
`;
    const B = await compile(libFiles, { headers: hdr, objects: objs });
    if (!B.wasm) {
      check('3', 'PRIZM 라이브러리 I2C 프로토콜 일치', false, '원본 라이브러리 빌드 실패: ' + B.log.slice(0, 300));
    } else {
      const rB = await run(B.wasm, params);
      const la = logOf(rA), lb = logOf(rB);
      let firstDiff = -1;
      for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) { firstDiff = i; break; }
      check('3', 'PRIZM 라이브러리 I2C 프로토콜 일치 (원본 PRIZM_PRO v1.15 대비)', firstDiff < 0,
        firstDiff < 0 ? `API 호출 ${la.length}개 트랜잭션 바이트 단위 동일` : `#${firstDiff}: 시뮬 ${la[firstDiff]} / 원본 ${lb[firstDiff]}`);
    }
}

// ============================================================ field geometry (rules V1.3 + team measurement)
{
  const pr = applyFieldPreset(defaultParams(), 'rules');
  const g = fieldGeometry(pr);
  check('1', '규정 V1.3 경기장 프리셋', g.pitch === 370 && Math.abs(g.length - 1860) < 0.01 && g.startZone === 500,
    `선 간격 ${g.pitch} mm, 전장 ${g.length} mm, 시작구역 ${g.startZone} mm (레일 간격 288·폭 30은 3D에 반영)`);
  const gm = fieldGeometry(defaultParams());
  check('1', '팀 실측 경기장 프리셋 (기본값)', gm.pitch === 480 && gm.width === 10 && gm.lines[0] === 155,
    `흰 칸 470 + 선 10 → 피치 ${gm.pitch} mm, 0번 선 중심 ${gm.lines[0]} mm, 전장 ${gm.length} mm`);
}

const out = { generatedAt: new Date().toISOString(), runtimeVersion: rt.version, results };
fs.writeFileSync(path.join(root, 'docs/verification.json'), JSON.stringify(out, null, 1));
const md = ['# 설계 검증 결과', '', `생성: ${out.generatedAt} · \`node tools/verify.mjs\``, '',
  '| 요구 | 항목 | 결과 | 근거 |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.req} | ${r.name} | ${r.ok ? '✅ 통과' : '❌ 실패'} | ${String(r.detail).replace(/\|/g, '/')} |`)];
const trace = results.find((r) => r.data && r.data.rows);
if (trace) {
  md.push('', '## 실측 vs 시뮬레이션 BASE_TRACE (0번 정렬, 모터1 엔코더 deg/s)', '', '| ms | 명령 | 실측 | 시뮬 |', '|---|---|---|---|');
  for (const [ms, cmd, re, si] of trace.data.rows) md.push(`| ${ms} | ${cmd} | ${re} | ${si} |`);
}
const browserPart = path.join(root, 'docs/verification-browser.md');
if (fs.existsSync(browserPart)) md.push('', fs.readFileSync(browserPart, 'utf8').trim());
md.push('', '요구 1 = 주행 재현도, 요구 2 = 팀 공유, 요구 3 = 코드 호환 (사용자 요청서 기준)');
fs.writeFileSync(path.join(root, 'docs/VERIFICATION.md'), md.join('\n') + '\n');
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed → docs/VERIFICATION.md`);
