// Post-run analysis: stops vs. lines, legs, LED blinks and a reference score estimate
// following the 2026 rules (V1.3) line/return items. Wafer items need the real arm.
import { F } from './sim-host.js';
import { fieldGeometry, robotGeometry } from './params.js';

const RED = 0xff0000;

export function analyseRun(frames, serial, events, params) {
  const geo = fieldGeometry(params);
  const rg = robotGeometry(params);
  const sensorOffsets = rg.sensors.map((s) => s.s);
  const sensorPorts = rg.sensors.map((s) => s.port);
  const startZone = geo.startZone;
  // all four wheels inside the green start zone (motor axle position -> wheel edges)
  const wheelsInStart = (axle) => axle + rg.rearAxle - rg.r >= 0 && axle + rg.frontAxle + rg.r <= startZone;
  const n = frames.length;
  const stops = [];
  const legs = [];
  if (!n) return { summary: { frames: 0 }, stops, legs, score: null, geo };

  const nearestLine = (pos) => {
    let best = 0, bd = Infinity;
    geo.lines.forEach((c, i) => { const d = Math.abs(pos - c); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  // --- first motion (rule: time starts when the robot starts to move after init)
  const x0 = frames[0][F.x], j10 = frames[0][F.j1], j20 = frames[0][F.j2], z0 = frames[0][F.z];
  let firstMotion = null;
  for (const f of frames) {
    if (Math.abs(f[F.x] - x0) > 0.5 || Math.abs(f[F.j1] - j10) > 50 || Math.abs(f[F.j2] - j20) > 50 || Math.abs(f[F.z] - z0) > 0.5) {
      firstMotion = f[F.t];
      break;
    }
  }

  // --- stops: |v| < 1.5 mm/s for >= 250 ms after the chassis moved
  let moving = false, stillSince = null, legStart = null, peak = 0, legDir = 0, legStartX = 0;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const v = f[F.v];
    if (Math.abs(v) > 15) {
      if (!moving) { moving = true; legStart = f[F.t]; peak = 0; legStartX = f[F.x]; }
      peak = Math.max(peak, Math.abs(v));
      legDir = Math.sign(v);
      stillSince = null;
    } else if (moving && Math.abs(v) < 1.5) {
      if (stillSince === null) stillSince = i;
      if (f[F.t] - frames[stillSince][F.t] >= 250) {
        const s = frames[stillSince];
        const axle = s[F.x];
        const sensorPos = sensorOffsets.map((o) => axle + o);
        // the line the robot stopped on = the line under whichever sensor is closest to one
        const errs = sensorPos.map((p) => Math.abs(p - geo.lines[nearestLine(p)]));
        const refSensor = errs[1] <= errs[0] ? 1 : 0;
        const line = nearestLine(sensorPos[refSensor]);
        const stop = {
          t: s[F.t],
          axle,
          sensorPos,
          sensorPorts,
          nearestLine: line,
          refSensor,
          sensorErr: sensorPos.map((p) => p - geo.lines[nearestLine(p)]),
          sensorLine: sensorPos.map((p) => nearestLine(p)),
          axleErr: axle - geo.lines[nearestLine(axle)],
          inStartZone: wheelsInStart(axle),
          frontGap: geo.length - (axle + rg.frontEnd),
          rearGap: axle + rg.rearEnd,
          duration: 0,
          dir: legDir,
        };
        legs.push({ t0: legStart, t1: s[F.t], from: legStartX, to: axle, peak, dir: legDir });
        stops.push(stop);
        moving = false;
      }
    } else if (moving) {
      stillSince = null;
    }
  }
  // durations
  for (let k = 0; k < stops.length; k++) {
    const next = legs[k + 1];
    stops[k].duration = Math.round((next ? next.t0 : frames[n - 1][F.t]) - stops[k].t);
  }

  // --- LED red blinks (pixel 0) : count OFF->RED transitions
  const blinks = [];
  let prev = frames[0][F.led0];
  for (const f of frames) {
    const c = f[F.led0];
    if (c === RED && prev !== RED) blinks.push(f[F.t]);
    prev = c;
  }

  // --- reference score: line items (rule 1-5) using the centre sensor's nearest line at each stop
  const seq = stops.map((s) => s.nearestLine);
  const items = [];
  const reachedAndReturned = (target) => {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] !== target) continue;
      // must have departed from 0 before and come back to 0 after
      const before = seq.slice(0, i).lastIndexOf(0);
      const after = seq.slice(i + 1).indexOf(0);
      if (before >= 0 && after >= 0) return true;
    }
    return false;
  };
  const pts = { 1: 5, 2: 10, 3: 15, 4: 20 };
  for (const k of [1, 2, 3, 4]) items.push({ label: `0→${k} 정지 후 복귀`, points: pts[k], ok: reachedAndReturned(k) });
  let ok42 = false;
  for (let i = 0; i + 1 < seq.length; i++) {
    if (seq[i] === 4 && seq[i + 1] === 2 && seq.slice(i + 2).includes(0) && seq.slice(0, i).includes(0)) ok42 = true;
  }
  items.push({ label: '0→4→2 정지 후 복귀', points: 25, ok: ok42 });
  const last = stops[stops.length - 1];
  const lastStill = last && Math.abs(frames[n - 1][F.v]) < 1.5;
  const returnBlinks = last ? blinks.filter((t) => t >= last.t).length : 0;
  const allWheelsIn = last ? wheelsInStart(last.axle) : false;
  items.push({ label: '시작 구역 복귀 + 빨간 LED 3회', points: 5, ok: !!(last && lastStill && allWheelsIn && returnBlinks >= 3), detail: { allWheelsIn, returnBlinks } });
  const lineScore = items.reduce((a, it) => a + (it.ok ? it.points : 0), 0);

  // --- serial markers useful for the driving code
  const markers = [];
  for (const s of serial) {
    const m = s.text.match(/^(BASE_[A-Z_]+|FINISH_[A-Z_]+|SCORING_[A-Z_]+|REVERSE_[A-Z_]+|MISSION_[A-Z_]+|ARM_START_FAILED|CONFIG_[A-Z_]+)/);
    if (m) markers.push({ t: s.t, tag: m[1], text: s.text.trim() });
  }

  // body clearance to the field ends and centre-rail guidance over the whole run
  let minFront = Infinity, minRear = Infinity, maxGuide = 0, maxRailF = 0, maxYaw = 0, maxY = 0;
  for (const f of frames) {
    minFront = Math.min(minFront, geo.length - (f[F.x] + rg.frontEnd));
    minRear = Math.min(minRear, f[F.x] + rg.rearEnd);
    if (F.guideF !== undefined) {
      maxGuide = Math.max(maxGuide, Math.abs(f[F.guideF]), Math.abs(f[F.guideR]));
      maxRailF = Math.max(maxRailF, f[F.railF]);
      maxYaw = Math.max(maxYaw, Math.abs(f[F.yaw]));
      maxY = Math.max(maxY, Math.abs(f[F.y]));
    }
  }

  const tEnd = frames[n - 1][F.t];
  const finishT = returnBlinks >= 3 ? blinks.filter((t) => t >= last.t)[2] : null;
  return {
    geo,
    stops,
    legs,
    blinks,
    markers,
    score: { items, lineScore, waferNote: '웨이퍼 점수(6~8번)는 팔-트레이 접촉 물리를 모델링하지 않아 계산하지 않습니다.' },
    summary: {
      frames: n,
      simSeconds: +(tEnd / 1000).toFixed(2),
      firstMotionS: firstMotion !== null ? +(firstMotion / 1000).toFixed(3) : null,
      missionSeconds: firstMotion !== null && finishT ? +((finishT - firstMotion) / 1000).toFixed(2) : null,
      stops: stops.length,
      stopLines: seq.join(' → '),
      stopReference: '정지 라인 = 선 위에 있는 센서(4번 또는 5번) 기준',
      maxSpeedMmS: +Math.max(...legs.map((l) => l.peak), 0).toFixed(1),
      redBlinks: blinks.length,
      lineScoreEstimate: lineScore,
      collisions: events.filter((e) => e.type === 3).length,
      minFrontGapMm: +minFront.toFixed(1),
      minRearGapMm: +minRear.toFixed(1),
      maxGuideOffsetMm: +maxGuide.toFixed(3),
      maxRailForceN: +maxRailF.toFixed(2),
      maxYawDeg: +maxYaw.toFixed(4),
      warnings: events.filter((e) => e.type === 1 || e.type === 5).length,
    },
  };
}
