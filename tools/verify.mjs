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
import { defaultParams, fieldGeometry, applyFieldPreset, FIELD_PRESETS, robotGeometry, resolveParams, applyGearPreset, GEAR_PRESETS } from '../web/js/params.js';
import { analyseRun } from '../web/js/analysis.js';
import { readZip, decodeText } from '../web/js/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const zipPath = arg('--zip'), realLogPath = arg('--real-log'), prizmLib = arg('--prizm-lib'), beforePath = arg('--before');
const rt = JSON.parse(fs.readFileSync(path.join(root, 'web/rt/runtime.json'), 'utf8'));
const rtObjects = {};
for (const o of rt.objects) rtObjects[o] = fs.readFileSync(path.join(root, 'web/rt/obj', o));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const results = [];
// ok: true = 통과, false = 실패, null = 확인 필요(실측과 어긋나지만 시뮬레이터 버그가 아닌 항목)
const check = (req, name, ok, detail, data) => { results.push({ req, name, ok, detail, data }); console.log(`${ok === null ? 'WARN' : ok ? 'PASS' : 'FAIL'} [${req}] ${name}: ${detail}`); };

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
const measured = {};
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
    const a = analyseRun(mission.frames, mission.serial, mission.events, resolveParams(params));
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
  const ss = (arr) => { const tail = arr.filter((r) => r.ms >= 500); return tail.reduce((a, r) => a + r.e1, 0) / tail.length; };
  check('1', '실측 BASE_TRACE 재현 (0번 정렬, 명령 100 deg/s)', rms < 5,
    `샘플 ${n}개 RMS 차이 ${rms.toFixed(1)} deg/s, 0.5초 이후 평균 실측 ${ss(real).toFixed(1)} / 시뮬 ${ss(sim).toFixed(1)} deg/s. 정렬 시간 실측 ${real.length ? (real[real.length - 1].ms / 1000 + 0.05).toFixed(2) : '?'} s / 시뮬 ${sim.length ? (sim[sim.length - 1].ms / 1000 + 0.05).toFixed(2) : '?'} s (시작 위치·축간 거리에 따라 다름)`, { rows });
}

// 1a'. distance driven during the initial line-0 alignment: real log vs simulation
if (realLogPath && mission) {
  const lines = fs.readFileSync(realLogPath, 'utf8').split(/\r?\n/);
  let deg = 0, prevMs = 0;
  for (const l of lines) {
    const m = l.match(/BASE_TRACE,(\d+),(-?\d+),(-?\d+),(-?[\d.]+),(-?[\d.]+),(\d+)/);
    if (m) { const ms = +m[1]; deg += Math.abs(+m[4]) * (ms - prevMs) / 1000; prevMs = ms; }
    if (/BASE_DONE/.test(l) && deg) break;
  }
  const stopL = lines.find((l) => /BASE_TRACE_STOP/.test(l));
  const tStop = stopL ? +stopL.match(/t_ms=(\d+)/)[1] : prevMs;
  const lastSpeed = (() => { const t = lines.filter((l) => /^BASE_TRACE,/.test(l)); const m = t.length ? t[t.length - 1].split(',') : null; return m ? Math.abs(+m[4]) : 0; })();
  deg += lastSpeed * Math.max(0, tStop - prevMs) / 1000;
  const rg = robotGeometry(defaultParams());
  const realMm = deg / 360 * rg.mmPerRev;
  const simMm = mission.analysis.stops[0].axle - mission.frames[0][F.x];
  measured.alignment = { realDeg: deg, realMm, simMm };
  check('1', '0번 정렬 이동거리 (실물 로그 vs 시뮬)', Math.abs(realMm - simMm) <= 5 ? true : null,
    `실물 로그: 엔코더 ${deg.toFixed(1)}° → ${realMm.toFixed(1)} mm (모터 1회전 ${rg.mmPerRev.toFixed(1)} mm 기준). 시뮬: ${simMm.toFixed(1)} mm (로봇을 끝까지 붙였을 때가 최대). ` +
    (Math.abs(realMm - simMm) <= 5 ? '일치' : `차이 ${(realMm - simMm).toFixed(1)} mm → 로그 당시 로봇이 시작 끝에 붙어 있었다면 첫 칸 길이·5번 센서 위치·축간·기어비 중 하나가 실물과 다름. 시작 위치가 아닌 곳에서 찍은 로그라면 비교 대상이 아님`));
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
  const C = robotGeometry(params).mmPerRev;
  const dxEnc = (fB[F.enc1] - fA[F.enc1]) / 1440 * C, dx = fB[F.x] - fA[F.x];
  check('1', '엔코더 ↔ 차체 이동 일치 (등속, 미끄럼 없음)', Math.abs(dxEnc - dx) / dx < 0.01, `엔코더 환산 ${dxEnc.toFixed(1)} mm / 차체 ${dx.toFixed(1)} mm (모터 1회전 ${C.toFixed(2)} mm)`);
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
  // (the centre-rail rollers add no drag here: symmetric wheels never touch the rail)
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
    `선 간격 ${g.pitch} mm, 전장 ${g.length} mm, 시작구역 ${g.startZone} mm`);
  const gm = fieldGeometry(defaultParams());
  check('1', '실측 경기장 (기본값)', gm.pitch === 370 && gm.width === 10 && gm.lines[0] === 168 && Math.abs(gm.length - 1816) < 0.01,
    `라인 사이 360 + 선 10 → 선 중심 간격 ${gm.pitch} mm, 0번 선 중심 ${gm.lines[0]} mm, 전장 ${gm.length} mm`);
}

// ============================================================ measured geometry + centre rail (2026-11-19 change)

{
  const params = defaultParams();
  const rg = robotGeometry(params);
  const geo = fieldGeometry(params);
  // slow pass over the whole field: every sensor transition is a measurement in the simulator
  const SWEEP = `#include <PRIZM_PRO.h>
PRIZM prizm;
void setup() {
  Serial.begin(115200);
  prizm.PrizmBegin();
  prizm.resetEncoders();
  prizm.setMotorSpeeds(100, -100);
  while (millis() < 70000) { delay(5); }
  prizm.setMotorPowers(125, 125);
  delay(500);
  Serial.println("END");
}
void loop() {}
`;
  const c = await compile({ 'Sweep/Sweep.ino': SWEEP });
  const r = await run(c.wasm, params);
  const fr = r.frames;
  const xAt = (t, key = F.x) => { // linear interpolation between 5 ms frames
    let i = fr.findIndex((f) => f[F.t] >= t);
    if (i <= 0) return fr[Math.max(0, i)][key];
    const a = fr[i - 1], b = fr[i], w = (t - a[F.t]) / (b[F.t] - a[F.t]);
    return a[key] + (b[key] - a[key]) * w;
  };
  const ev = (port) => r.events.filter((e) => e.type === 2 && e.a === port);
  const blackLv = Number(params['sensor.blackLevel']);
  const segs = (port) => { const out = []; let cur = null; for (const e of ev(port)) { if (e.b === blackLv) cur = { in: e.c, tin: e.t }; else if (cur) { out.push({ ...cur, out: e.c, tout: e.t }); cur = null; } } return out; };
  const s4 = segs(rg.sensors[0].port), s5 = segs(rg.sensors[1].port);
  // sensor 4 starts beyond line 0 and sensor 5 never reaches line 4: take each line from
  // whichever sensor crossed it (both crossed lines 1-3 and must agree)
  const byLine = geo.lines.map((c) => [...s5, ...s4].filter((q) => Math.abs((q.in + q.out) / 2 - c) < 100));
  const lineSeg = byLine.map((list) => list[0]);
  const agree = byLine.every((list) => list.every((q) => Math.abs(q.in - list[0].in) < 0.05 && Math.abs(q.out - list[0].out) < 0.05));
  const widths = lineSeg.map((q) => q.out - q.in);
  const gaps = lineSeg.slice(1).map((q, i) => q.in - lineSeg[i].out);
  const centres = lineSeg.map((q) => (q.in + q.out) / 2);
  const pitches = centres.slice(1).map((c, i) => c - centres[i]);
  // the same gaps as the robot itself would measure them with its encoder (nominal 161.79 mm/rev)
  const encMm = (t) => (xAt(t, F.enc1) / 1440) * rg.mmPerRev;
  const encGaps = [s5, s4].flatMap((sg) => sg.slice(1).map((q, i) => encMm(q.tin) - encMm(sg[i].tout))); // same sensor, consecutive lines
  const rng = (a) => `${Math.min(...a).toFixed(2)}~${Math.max(...a).toFixed(2)}`;
  measured.field = { widths, gaps, pitches, encGaps, firstEdge: s5.length ? s5[0].in : null, lineCount: s4.length };
  // far end wall measured physically: the sweep drives into it; wall = motor axle at contact + front overhang
  const hit = r.events.find((e) => e.type === 3 && e.a === 1);
  const wallPos = hit ? xAt(hit.t) + rg.frontEnd : NaN;
  const endGap = wallPos - lineSeg[4].out;
  measured.fieldLength = wallPos;
  check('치수', '① 라인 사이 흰색 구간 36cm [센서 전환 위치 + 엔코더 환산]', lineSeg.every(Boolean) && agree && gaps.length === 4 && gaps.every((g) => Math.abs(g - 360) < 0.05) && pitches.every((q) => Math.abs(q - 370) < 0.05),
    `센서가 실제로 선을 지나며 잰 선 사이 흰 구간 ${gaps.map((g) => g.toFixed(2)).join(' / ')} mm (선 중심 간격 ${rng(pitches)} mm, 두 센서 측정 일치=${agree}). 로봇 엔코더로 환산하면 ${rng(encGaps)} mm (타이어 미끄럼 0.2% 포함)`);
  check('치수', '② 양 끝 칸(0번 앞, 4번 뒤 흰색만) 16.3cm [센서 전환 위치 + 끝 벽 접촉]', Math.abs(lineSeg[0].in - 163) < 0.05 && Math.abs(endGap - 163) < 0.5,
    `시작 끝 → 0번 선 ${lineSeg[0].in.toFixed(2)} mm (5번 센서), 4번 선 → 반대쪽 끝 벽 ${endGap.toFixed(2)} mm (4번 센서 + 로봇이 벽에 닿은 위치)`);
  check('치수', '전체 길이 181.6cm [시작 끝 ↔ 반대쪽 끝 벽]', Math.abs(wallPos - 1816) < 0.5 && Math.abs(geo.length - 1816) < 0.01,
    `로봇이 반대쪽 끝 벽에 닿은 위치에서 잰 벽 위치 ${wallPos.toFixed(2)} mm (모터축 ${hit ? xAt(hit.t).toFixed(2) : '?'} + 앞끝 ${rg.frontEnd} mm), 설정 전장 ${geo.length} mm = 163 + 10×5 + 360×4 + 163`);
  check('치수', '③ 검은 선 1cm [센서 전환 위치]', widths.length === 5 && widths.every((w) => Math.abs(w - 10) < 0.05),
    `0~4번 선 검정 구간 폭 ${widths.map((w) => w.toFixed(2)).join(' / ')} mm`);
  // wheel diameter from encoder vs travel at constant speed. Run 1: no rolling resistance,
  // so the tyre carries no load and does not creep -> pure rolling kinematics.
  const tA = 10000, tB = 35000;
  const wheelFrom = (rr) => {
    const xa = (t, key = F.x) => { let i = rr.frames.findIndex((f) => f[F.t] >= t); const a = rr.frames[i - 1], b = rr.frames[i], w = (t - a[F.t]) / (b[F.t] - a[F.t]); return a[key] + (b[key] - a[key]) * w; };
    const dX = xa(tB) - xa(tA), dCounts = xa(tB, F.enc1) - xa(tA, F.enc1);
    const wheelRevs = dCounts / 1440 / rg.G;
    return { dX, dCounts, wheelRevs, perRev: dX / wheelRevs, dMeas: dX / wheelRevs / Math.PI };
  };
  const rFree = await run(c.wasm, { ...params, 'robot.rollResistN': 0, 'robot.rollViscous': 0 });
  const wFree = wheelFrom(rFree), wLoad = wheelFrom(r);
  measured.wheel = { free: wFree, loaded: wLoad };
  // gear selection: the same sweep with each preset, rolling without load (pure kinematics)
  const gearRes = {};
  for (const name of Object.keys(GEAR_PRESETS)) {
    const pg = applyGearPreset({ ...params, 'robot.rollResistN': 0, 'robot.rollViscous': 0 }, name);
    const rgg = robotGeometry(pg);
    const rr = await run(c.wasm, pg);
    const xa = (t, key = F.x) => { const i = rr.frames.findIndex((f) => f[F.t] >= t); const a0 = rr.frames[i - 1], b0 = rr.frames[i], w = (t - a0[F.t]) / (b0[F.t] - a0[F.t]); return a0[key] + (b0[key] - a0[key]) * w; };
    const t1 = 4000, t2 = name === '80-40' ? 9000 : 30000;  // faster gear reaches the far end sooner
    const dX = xa(t2) - xa(t1), motorRevs = (xa(t2, F.enc1) - xa(t1, F.enc1)) / 1440;
    gearRes[name] = { teeth: `${rgg.motorT}→${rgg.wheelT}`, perMotorRev: dX / motorRevs, perWheelRev: dX / (motorRevs / rgg.G), expect: rgg.mmPerRev, speed: Math.max(...rr.frames.map((f) => f[F.v])) };
  }
  measured.gears = gearRes;
  check('구동', '기어 구성 선택 (모터 40T→80T / 80T→40T)', Object.values(gearRes).every((g) => Math.abs(g.perMotorRev - g.expect) < 0.05 && Math.abs(g.perWheelRev - Math.PI * 103) < 0.05),
    Object.values(gearRes).map((g) => `${g.teeth}: 모터 1회전 ${g.perMotorRev.toFixed(2)} mm (기대 ${g.expect.toFixed(2)}), 바퀴 1회전 ${g.perWheelRev.toFixed(2)} mm, 100 deg/s 명령 속도 ${g.speed.toFixed(1)} mm/s`).join(' · '));
  check('치수', '④ 모터축 바퀴 지름 10.3cm [이동거리 ÷ 회전수, 운동 측정]', Math.abs(wFree.dMeas - 103) < 0.01 && Math.abs(wLoad.dMeas - 103) < 0.5,
    `${((tB - tA) / 1000)}초 등속 구간에서 차체 이동 ÷ (엔코더 회전 ÷ 기어 ${rg.G}): 미끄럼 없는 조건 ${wFree.dX.toFixed(2)} mm / 바퀴 ${wFree.wheelRevs.toFixed(4)}회전 → 1회전 ${wFree.perRev.toFixed(2)} mm, 지름 ${wFree.dMeas.toFixed(3)} mm. 기본 설정(구름 저항 있음)은 타이어 미끄럼 때문에 1회전 ${wLoad.perRev.toFixed(2)} mm (지름 환산 ${wLoad.dMeas.toFixed(2)} mm, −${((1 - wLoad.dMeas / 103) * 100).toFixed(2)}%)`);
  // start position
  const f0 = fr[0];
  const rearAt0 = f0[F.x] + rg.rearEnd;
  const firstMove = fr.find((f) => Math.abs(f[F.x] - f0[F.x]) > 0.01);
  measured.start = { axle: f0[F.x], rear: rearAt0 };
  check('치수', '⑤ 시작 위치: 경기장 끝 → 모터축 중심 27cm [초기 상태 확인]', Math.abs(f0[F.x] - 270) < 0.01 && Math.abs(rearAt0) < 0.01,
    `시뮬 시작 프레임: 모터축 ${f0[F.x].toFixed(2)} mm, 로봇 뒤끝 ${rearAt0.toFixed(2)} mm (= 시작 끝에 닿음), 첫 이동 ${firstMove ? (firstMove[F.t] / 1000).toFixed(3) + '초' : '없음'}`);
  // wheelbase from rigid-body motion: with the rail engaged and only one motor driving, the
  // chassis yaws against the front and rear guide rollers, which sit on the two axles.
  // axle distance = (front guide offset - rear guide offset) / tan(yaw)
  {
    const one = await compile({ 'OneMotorWB/OneMotorWB.ino': `#include <PRIZM_PRO.h>
PRIZM prizm;
void setup() { prizm.PrizmBegin(); prizm.setMotorPower(2, 0); prizm.setMotorSpeed(1, 400); delay(4000); prizm.setMotorPowers(125, 125); delay(500); }
void loop() {}
` });
    const ro = await run(one.wasm, params);
    const wbs = ro.frames.filter((f) => Math.abs(f[F.yaw]) > 0.2).map((f) => (f[F.guideF] - f[F.guideR]) / Math.tan((f[F.yaw] * Math.PI) / 180));
    const wbMeas = wbs.reduce((a, b) => a + b, 0) / wbs.length;
    measured.wheelbase = { n: wbs.length, mean: wbMeas, min: Math.min(...wbs), max: Math.max(...wbs) };
    check('치수', '⑥ 모터축(앞) ↔ 뒷바퀴축 중심 22.4cm [물리 내부 축 위치를 회전 운동에서 역산]', wbs.length > 50 && Math.abs(wbMeas - 224) < 0.1,
      `한쪽 모터만 돌려 차체가 레일에 기대 돌아갈 때 앞·뒤 축 가이드 위치에서 역산: ${wbMeas.toFixed(2)} mm (${wbs.length}프레임, ${Math.min(...wbs).toFixed(2)}~${Math.max(...wbs).toFixed(2)})`);
    measured.wheelbaseMm = wbMeas;
  }
  // sensor positions measured from timing: when a sensor turns black while driving forward it is
  // exactly on the near edge of a line, so offset = (known line edge) - (motor axle position then).
  // This does not read the sensor position the runtime reports.
  const lat = Number(params['sensor.latencyMs']) / 1000;
  const sensMeas = rg.sensors.map((sn) => {
    const e = ev(sn.port).filter((q) => q.b === blackLv);
    const offs = e.map((q) => {
      const edge = geo.lines.map((c) => c - geo.width / 2).reduce((a, b) => (Math.abs(b - q.c) < Math.abs(a - q.c) ? b : a));
      return edge - (xAt(q.t) - xAt(q.t, F.v) * lat);
    });
    const off = offs.reduce((a, b) => a + b, 0) / offs.length;
    return { port: sn.port, axle: sn.axle, off, n: offs.length, spread: Math.max(...offs) - Math.min(...offs) };
  });
  measured.sensors = sensMeas;
  const s4m = sensMeas[0], s5m = sensMeas[1];
  const s5FromRear = s5m.off + measured.wheelbaseMm; // rear axle = motor axle - wheelbase
  check('치수', '⑦ 4번 센서: 모터축 바퀴 축 중심에서 6.5cm [선 감지 시각 측정]', Math.abs(s4m.off - 65) < 0.05,
    `선 검정 진입 ${s4m.n}회의 시각에서 (선 앞 경계 − 그때 모터축 위치) = +${s4m.off.toFixed(2)} mm (편차 ${s4m.spread.toFixed(3)} mm). 시작 시 경기장 끝에서 ${(270 + s4m.off).toFixed(1)} mm`);
  check('치수', '⑧ 5번 센서: 뒷바퀴축 축 중심에서 8.5cm [선 감지 시각 측정]', Math.abs(s5FromRear - 85) < 0.1,
    `(선 앞 경계 − 모터축 위치) = ${s5m.off.toFixed(2)} mm (검정 진입 ${s5m.n}회) → 뒷바퀴축(모터축 −${measured.wheelbaseMm.toFixed(2)})에서 +${s5FromRear.toFixed(2)} mm. 시작 시 경기장 끝에서 ${(270 + s5m.off).toFixed(1)} mm (0번 선 ${lineSeg[0].in.toFixed(0)} mm보다 ${(lineSeg[0].in - 270 - s5m.off).toFixed(1)} mm 뒤)`);

  // centre rail: same disturbances with the rail on and off
  const DIST = {
    'Mismatch/Mismatch.ino': `#include <PRIZM_PRO.h>
PRIZM prizm;
void setup() { prizm.PrizmBegin(); prizm.setMotorSpeeds(720, -720); delay(6000); prizm.setMotorPowers(125, 125); delay(1000); }
void loop() {}
`,
    'OneMotor/OneMotor.ino': `#include <PRIZM_PRO.h>
PRIZM prizm;
void setup() { prizm.PrizmBegin(); prizm.setMotorPower(2, 0); prizm.setMotorSpeed(1, 400); delay(5000); prizm.setMotorPowers(125, 125); delay(1000); }
void loop() {}
` };
  const railRuns = {};
  {
    // long one-motor run without the centre rail: the robot must be free to go far past the old
    // side-rail line (x = ±159 mm), proving nothing else constrains it sideways
    const cc = await compile({ 'Spin/Spin.ino': `#include <PRIZM_PRO.h>
PRIZM prizm;
void setup() { prizm.PrizmBegin(); prizm.setMotorPower(2, 0); prizm.setMotorSpeed(1, 600); delay(12000); prizm.setMotorPowers(125, 125); delay(500); }
void loop() {}
` });
    const pr = { ...defaultParams(), 'rail.enabled': 0 };
    const rr = await run(cc.wasm, pr);
    const maxY = Math.max(...rr.frames.map((f) => Math.max(Math.abs(f[F.y]), Math.abs(f[F.guideF]), Math.abs(f[F.guideR]))));
    const maxYaw = Math.max(...rr.frames.map((f) => Math.abs(f[F.yaw])));
    railRuns.spinOff = { maxY, maxYaw, warns: rr.events.filter((e) => e.type === 1).map((e) => e.text) };
  }
  for (const [file, extra] of [['Mismatch/Mismatch.ino', { 'drive.rightWheelScale': 1.03 }], ['OneMotor/OneMotor.ino', {}]]) {
    const cc = await compile({ [file]: DIST[file] });
    for (const on of [1, 0]) {
      const pr = { ...defaultParams(), ...extra, 'rail.enabled': on };
      const rr = await run(cc.wasm, pr);
      const a = analyseRun(rr.frames, rr.serial, rr.events, resolveParams(pr));
      railRuns[`${file.split('/')[0]}-${on}`] = { guide: a.summary.maxGuideOffsetMm, yaw: a.summary.maxYawDeg, force: a.summary.maxRailForceN, endY: rr.frames[rr.frames.length - 1][F.y] };
    }
  }
  measured.rail = railRuns;
  const clr = Number(params['rail.clearanceMm']);
  const okOn = railRuns['Mismatch-1'].guide < clr + 0.3 && railRuns['OneMotor-1'].guide < clr + 0.3;
  const okOff = railRuns['Mismatch-0'].guide > 20 && railRuns['OneMotor-0'].guide > 20;
  check('레일', '가운데 레일이 좌우 이탈을 잡음 (구속·접촉)', okOn && okOff,
    `좌우 바퀴 지름 3% 차이로 720 deg/s 주행: 레일 있음 → 가이드 편차 최대 ${railRuns['Mismatch-1'].guide.toFixed(2)} mm(틈새 ${clr} mm)·회전 ${railRuns['Mismatch-1'].yaw.toFixed(2)}°·접촉력 최대 ${railRuns['Mismatch-1'].force.toFixed(1)} N / 레일 끔 → ${railRuns['Mismatch-0'].guide.toFixed(1)} mm·${railRuns['Mismatch-0'].yaw.toFixed(2)}°. ` +
    `한쪽 모터만 구동: 레일 있음 ${railRuns['OneMotor-1'].guide.toFixed(2)} mm·${railRuns['OneMotor-1'].yaw.toFixed(2)}°·${railRuns['OneMotor-1'].force.toFixed(1)} N / 레일 끔 ${railRuns['OneMotor-0'].guide.toFixed(1)} mm·${railRuns['OneMotor-0'].yaw.toFixed(1)}°`);
  check('레일', '양쪽 레일 구속이 물리에서 사라짐', railRuns.spinOff.maxY > 200,
    `가운데 레일을 끄고 한쪽 모터만 12초 돌리면 차체가 ${railRuns.spinOff.maxYaw.toFixed(0)}°까지 돌고 좌우로 ${railRuns.spinOff.maxY.toFixed(0)} mm까지 벗어남 → 예전 양쪽 레일 위치(±159 mm)에도 막는 것이 없음. 이때 경고: ${railRuns.spinOff.warns.length ? railRuns.spinOff.warns.join(' / ') : '없음'}. 화면의 레일 개수는 브라우저 검사에서 확인`);

  // team mission: unchanged code, with the rail actually engaged by a 1 % wheel mismatch
  if (teamFiles) {
    const cc = await compile(teamFiles);
    const pr = { ...defaultParams(), 'drive.rightWheelScale': 1.01 };
    const rr = await run(cc.wasm, pr);
    const a = analyseRun(rr.frames, rr.serial, rr.events, resolveParams(pr));
    const txt = rr.serial.map((q) => q.text).join('');
    measured.missionMismatch = a.summary;
    check('레일', '팀 코드 미션 중 레일 안내 (좌우 바퀴 1% 차이)', /MISSION_DONE/.test(txt) && a.summary.stopLines === mission.analysis.summary.stopLines && a.summary.maxGuideOffsetMm < clr + 0.3,
      `정지 순서 ${a.summary.stopLines} (차이 없을 때와 동일), 가이드 편차 최대 ${a.summary.maxGuideOffsetMm.toFixed(2)} mm, 접촉력 최대 ${a.summary.maxRailForceN.toFixed(1)} N, 회전 최대 ${a.summary.maxYawDeg.toFixed(2)}°, 미션 ${a.summary.missionSeconds} s`);
  }
}

// ============================================================ team mission with the alternative gear (80T -> 40T)
if (teamFiles) {
  const cc = await compile(teamFiles);
  const pr = applyGearPreset(defaultParams(), '80-40');
  const rr = await run(cc.wasm, pr);
  const a = analyseRun(rr.frames, rr.serial, rr.events, resolveParams(pr));
  const txt = rr.serial.map((q) => q.text).join('');
  const done = /MISSION_DONE/.test(txt);
  const faults = (txt.match(/^.*(FAULT|ABORT|TIMEOUT).*$/gm) || []).slice(0, 3);
  measured.gear8040 = { summary: a.summary, stops: a.stops.map((s) => ({ line: s.nearestLine, axle: s.axle, e5: s.sensorErr[1], e4: s.sensorErr[0], front: s.frontGap, rear: s.rearGap })), done, faults, events: rr.events.filter((e) => e.type === 3 || e.type === 1).map((e) => `${(e.t / 1000).toFixed(2)}s ${e.text}`) };
  const same = done && a.summary.stopLines === mission.analysis.summary.stopLines && a.summary.collisions === 0;
  check('구동', '팀 코드 그대로 + 기어 80T→40T 미션 (참고)', same ? true : null,
    `${done ? `MISSION_DONE ${(rr.serial.find((q) => /MISSION_DONE/.test(q.text)).t / 1000).toFixed(1)} s` : 'MISSION_DONE 없음'}, 정지 순서 ${a.summary.stopLines}, 최고 속도 ${a.summary.maxSpeedMmS} mm/s, 끝 벽 접촉 ${a.summary.collisions}회` +
    (faults.length ? `, 로그: ${faults.join(' / ')}` : '') + (same ? '' : ' → 코드의 속도·감속 설정이 40T→80T 기준이라 조정 필요'));
}

// ============================================================ before / after comparison
let comparison = null;
if (beforePath && mission && fs.existsSync(beforePath)) {
  const B = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const A = mission;
  const aS = A.analysis;
  const tOf = (serial, re) => { const q = serial.find((l) => re.test(l.text)); return q ? q.t : null; };
  const bFrames = B.frames, aFrames = A.frames;
  const xAtB = (t) => bFrames.reduce((b, f) => (Math.abs(f.t - t) < Math.abs(b.t - t) ? f : b), bFrames[0]).x;
  const alignB = { d: B.stops[0].axle - bFrames[0].x, t: (tOf(B.serial, /BASE_DONE line=0/) - tOf(B.serial, /BASE_SEEK_ZERO/)) / 1000 };
  const alignA = { d: aS.stops[0].axle - aFrames[0][F.x], t: (tOf(A.serial, /BASE_DONE line=0/) - tOf(A.serial, /BASE_SEEK_ZERO/)) / 1000 };
  // first black of each sensor per line during the scoring run (line detection timing)
  const bCm = B.params['geom.mmPerRev'] ?? B.params['drive.mmPerRev'] ?? 153.2;
  const bGeo = fieldGeometry(B.params);
  const bS4 = B.params['geom.sensor.0.s'] ?? B.params['sensor.0.offsetMm'], bS5 = B.params['geom.sensor.1.s'] ?? B.params['sensor.1.offsetMm'];
  const bRear = B.params['geom.rearEndS'] ?? -(B.params['robot.rearOverhangMm'] ?? 70);
  const firstBlack = (events, port, lines, wid) => lines.map((c) => { const e = events.find((q) => q.type === 2 && q.a === port && q.b === 1 && Math.abs(q.c - (c - wid / 2)) < 0.6); return e ? e.t : null; });
  const geo = fieldGeometry(defaultParams());
  const fbA4 = firstBlack(A.events, 4, geo.lines, geo.width), fbB4 = firstBlack(B.events, 4, bGeo.lines, bGeo.width);
  const fbA5 = firstBlack(A.events, 5, geo.lines, geo.width), fbB5 = firstBlack(B.events, 5, bGeo.lines, bGeo.width);
  const rgA = robotGeometry(defaultParams());
  comparison = {
    rows: [
      ['경기장 (흰 구간 / 양 끝 / 선 폭)', `${B.params['field.gapMm']} / ${B.params['field.firstGapMm']} / ${B.params['field.lineWidthMm']} mm`, `${defaultParams()['field.gapMm']} / ${defaultParams()['field.firstGapMm']} / ${defaultParams()['field.lineWidthMm']} mm`],
      ['선 중심 간격 / 전장', `${bGeo.pitch} / ${bGeo.length} mm`, `${geo.pitch} / ${geo.length} mm`],
      ['모터 1회전당 이동', `${(+bCm).toFixed(2)} mm`, `${rgA.mmPerRev.toFixed(2)} mm`],
      ['720 deg/s 명령 최고 속도', `${B.summary.maxSpeedMmS} mm/s`, `${aS.summary.maxSpeedMmS} mm/s`],
      ['선 한 칸 = 모터 회전각', `${(bGeo.pitch / bCm * 360).toFixed(0)}°`, `${(geo.pitch / rgA.mmPerRev * 360).toFixed(0)}°`],
      ['시작 위치 (모터축)', `${bFrames[0].x} mm (뒤끝 ${(bFrames[0].x + bRear).toFixed(0)} mm)`, `${aFrames[0][F.x]} mm (뒤끝 0 mm)`],
      ['센서 위치 (모터축 기준)', `4번 ${bS4 >= 0 ? '+' : ''}${bS4} · 5번 ${bS5 >= 0 ? '+' : ''}${bS5} mm`, `4번 +${rgA.sensors[0].s} · 5번 ${rgA.sensors[1].s} mm`],
      ['0번 정렬 (5번 센서가 0번 선까지)', `${alignB.d.toFixed(1)} mm 이동, ${alignB.t.toFixed(2)} s`, `${alignA.d.toFixed(1)} mm 이동, ${alignA.t.toFixed(2)} s`],
      ['첫 움직임', `${B.summary.firstMotionS} s`, `${aS.summary.firstMotionS} s`],
      ['정지 순서', B.summary.stopLines, aS.summary.stopLines],
      ['MISSION_DONE', `${(tOf(B.serial, /MISSION_DONE/) / 1000).toFixed(2)} s`, `${(tOf(A.serial, /MISSION_DONE/) / 1000).toFixed(2)} s`],
      ['미션 시간 (첫 움직임~LED 3회)', `${B.summary.missionSeconds} s`, `${aS.summary.missionSeconds} s`],
      ['끝 벽 접촉', `${B.summary.collisions}회`, `${aS.summary.collisions}회`],
      ['라인 점수(참고)', `${B.summary.lineScoreEstimate}`, `${aS.summary.lineScoreEstimate}`],
    ],
    stops: aS.stops.map((sa, i) => {
      const sb = B.stops[i] || {};
      return [`${i + 1}. ${sa.nearestLine}번`, sb.sensorErr ? `5번 ${sb.sensorErr[1].toFixed(1)} / 4번 ${sb.sensorErr[0].toFixed(1)}` : '-', `5번 ${sa.sensorErr[1].toFixed(1)} / 4번 ${sa.sensorErr[0].toFixed(1)}`,
        sb.t ? (sb.t / 1000).toFixed(2) : '-', (sa.t / 1000).toFixed(2), `${sa.frontGap.toFixed(1)} / ${sa.rearGap.toFixed(1)}`];
    }),
    detect: geo.lines.map((c, i) => [`${i}번 선`, fbB4[i] ? (fbB4[i] / 1000).toFixed(3) : '-', fbA4[i] ? (fbA4[i] / 1000).toFixed(3) : '-', fbB5[i] ? (fbB5[i] / 1000).toFixed(3) : '-', fbA5[i] ? (fbA5[i] / 1000).toFixed(3) : '-']),
  };
  check('비교', '수정 전후 주행 결과 비교', true, `정지 순서 ${B.summary.stopLines === aS.summary.stopLines ? '같음' : '다름'}, 미션 ${B.summary.missionSeconds} → ${aS.summary.missionSeconds} s, 최고 속도 ${B.summary.maxSpeedMmS} → ${aS.summary.maxSpeedMmS} mm/s, 끝 벽 접촉 ${B.summary.collisions} → ${aS.summary.collisions}회 (표 참조)`);
}

const out = { generatedAt: new Date().toISOString(), runtimeVersion: rt.version, results, measured, comparison };
fs.writeFileSync(path.join(root, 'docs/verification.json'), JSON.stringify(out, null, 1));
const md = ['# 설계 검증 결과', '', `생성: ${out.generatedAt} · \`node tools/verify.mjs\``, '',
  '| 요구 | 항목 | 결과 | 근거 |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.req} | ${r.name} | ${r.ok === null ? '⚠️ 확인 필요' : r.ok ? '✅ 통과' : '❌ 실패'} | ${String(r.detail).replace(/\|/g, '/')} |`)];
md.push('', '측정 방법 표기: [센서 전환 위치] = 물리 엔진 안에서 센서가 검정/흰색으로 바뀐 지점(설정한 선 위치가 물리 계산에 그대로 쓰이는지 확인). [엔코더 환산]·[운동 측정]·[선 감지 시각 측정] = 시간과 엔코더·차체 위치로 잰 값(설정값을 직접 읽지 않음). [물리 내부 축 위치를 회전 운동에서 역산] = 레일에 기댄 회전에서 앞뒤 가이드 위치로 계산. [초기 상태 확인] = 첫 프레임 값. ⚠️ 확인 필요 = 시뮬레이터 오류는 아니지만 실물 자료와 어긋나 팀 확인이 필요한 항목.');
const trace = results.find((r) => r.data && r.data.rows);
if (trace) {
  md.push('', '## 실측 vs 시뮬레이션 BASE_TRACE (0번 정렬, 모터1 엔코더 deg/s)', '', '| ms | 명령 | 실측 | 시뮬 |', '|---|---|---|---|');
  for (const [ms, cmd, re, si] of trace.data.rows) md.push(`| ${ms} | ${cmd} | ${re} | ${si} |`);
}
if (comparison) {
  md.push('', '## 수정 전후 비교 (원본 코드 무수정, 기본 설정)', '', '| 항목 | 수정 전 | 수정 후 |', '|---|---|---|', ...comparison.rows.map((r) => `| ${r.join(' | ')} |`));
  md.push('', '### 정지 위치 (선 중심 기준 센서 오차 mm, + = 선을 지나침)', '', '| 정지 | 수정 전 | 수정 후 | 전 시각 s | 후 시각 s | 후 앞끝/뒤끝 여유 mm |', '|---|---|---|---|---|---|', ...comparison.stops.map((r) => `| ${r.join(' | ')} |`));
  md.push('', '### 라인 처음 감지 시각 (s)', '', '| 선 | 4번 전 | 4번 후 | 5번 전 | 5번 후 |', '|---|---|---|---|---|', ...comparison.detect.map((r) => `| ${r.join(' | ')} |`));
}
const browserPart = path.join(root, 'docs/verification-browser.md');
if (fs.existsSync(browserPart)) md.push('', fs.readFileSync(browserPart, 'utf8').trim());
md.push('', '요구 1 = 주행 재현도, 요구 2 = 팀 공유, 요구 3 = 코드 호환 (사용자 요청서 기준)');
fs.writeFileSync(path.join(root, 'docs/VERIFICATION.md'), md.join('\n') + '\n');
console.log(`\n${results.filter((r) => r.ok === true).length}/${results.length} passed, ${results.filter((r) => r.ok === null).length} warn, ${results.filter((r) => r.ok === false).length} fail → docs/VERIFICATION.md`);
