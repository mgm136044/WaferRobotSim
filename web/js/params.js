// Simulator parameters (all editable in the UI, exportable as JSON for the team).
// Every value has a source note so the team knows what is measured vs. assumed.

export const FIELD_PRESETS = {
  measured: {
    label: '실측 (라인 사이 360 / 선 폭 10 / 끝 163 mm, 전장 1816)',
    'field.lineCount': 5,
    'field.firstGapMm': 163,
    'field.gapMm': 360,
    'field.lineWidthMm': 10,
    'field.lastGapMm': 163,
  },
  rules: {
    label: '대회 규정 V1.3 도면 (선 간격 370 mm, 전장 1860 mm)',
    'field.lineCount': 5,
    'field.firstGapMm': 180.5,
    'field.gapMm': 351,
    'field.lineWidthMm': 19,
    'field.lastGapMm': 180.5,
  },
};

// gear train between the drive motor and the wheel axle (selectable in the settings tab)
export const GEAR_PRESETS = {
  '40-80': { label: '모터 40T → 바퀴 80T (현재, 감속 2:1 · 모터 1회전 161.8 mm)', 'drive.motorGearTeeth': 40, 'drive.wheelGearTeeth': 80 },
  '80-40': { label: '모터 80T → 바퀴 40T (증속 1:2 · 모터 1회전 647.2 mm)', 'drive.motorGearTeeth': 80, 'drive.wheelGearTeeth': 40 },
};
export function applyGearPreset(params, name) {
  const g = GEAR_PRESETS[name];
  if (g) for (const [k, v] of Object.entries(g)) if (k !== 'label') params[k] = v;
  return params;
}

// [key, default, label, unit, group, note]
export const PARAM_SPECS = [
  // field
  ['field.lineCount', 5, '라인 수', '개', '경기장', '0~4번 라인'],
  ['field.firstGapMm', 163, '0번 앞 흰 구간', 'mm', '경기장', '실측 16.3cm (시작 끝 → 0번 선, 흰색만)'],
  ['field.gapMm', 360, '라인 사이 흰 구간', 'mm', '경기장', '실측 36cm (검은 선 제외 흰색만) → 선 중심 간격 370'],
  ['field.lineWidthMm', 10, '검은 선 폭', 'mm', '경기장', '실측 1cm'],
  ['field.lastGapMm', 163, '4번 뒤 흰 구간', 'mm', '경기장', '실측 16.3cm (4번 선 → 끝, 흰색만). 전장 1816'],
  ['field.startZoneMm', 500, '시작 구역 길이', 'mm', '경기장', '규정: 500×500 초록 시작 구역'],
  ['field.workWidthMm', 900, '작업 영역 폭', 'mm', '경기장', '규정 900mm. 차체가 옆으로 이 밖에 나가면 경고'],

  // robot geometry (1 unit = 1 mm everywhere: physics, analysis and 3D)
  ['robot.lengthMm', 480, '차체 길이', 'mm', '로봇 형상', '가정값 (규정 500 이내). 실측값으로 바꾸세요'],
  ['robot.widthMm', 400, '차체 폭', 'mm', '로봇 형상', '가정값 (규정 500 이내)'],
  ['robot.rearOverhangMm', 270, '로봇 뒤끝 → 모터축', 'mm', '로봇 형상', '실측: 로봇을 시작 위치 끝까지 붙였을 때 경기장 끝 → 모터축(앞바퀴) 중심 270mm'],
  ['robot.startGapMm', 0, '시작 시 로봇 뒤끝 ↔ 경기장 끝 간격', 'mm', '로봇 형상', '0 = 끝까지 붙임(실측 조건). 시작 모터축 위치 = 위 270 + 이 값'],
  ['robot.motorAxle', 'front', '모터가 달린 축', '', '로봇 형상', '실측: 모터축 = 앞바퀴 (rear로 바꾸면 뒷축 구동)'],
  ['robot.wheelbaseMm', 224, '모터축(앞) ↔ 뒷바퀴축', 'mm', '로봇 형상', '실측: 두 축 중심 사이 22.4cm'],
  ['robot.passiveWheelDiameterMm', 90, '뒷바퀴(비구동) 지름', 'mm', '로봇 형상', '가정값·표시용(물리 영향 없음). 뒷바퀴축이 시작 끝에서 46mm라 92mm 이하여야 경기장 안에 들어감'],
  ['robot.trackMm', 320, '좌우 바퀴 간격(중심)', 'mm', '로봇 형상', '가정값. 가운데 레일을 좌우 바퀴가 사이에 두고 달림'],
  ['sensor.0.port', 4, '앞 센서 포트', '', '센서', '코드: FRONT_PORT=4'],
  ['sensor.0.axle', 'front', '4번 센서 기준 축', '', '센서', '실측: 모터축(앞바퀴)'],
  ['sensor.0.fromAxleMm', 65, '4번 센서: 축 중심에서 앞으로', 'mm', '센서', '실측: 모터축 바퀴 축 중심에서 6.5cm'],
  ['sensor.1.port', 5, '중심 센서 포트', '', '센서', '코드: CENTER_PORT=5'],
  ['sensor.1.axle', 'rear', '5번 센서 기준 축', '', '센서', '실측: 뒷바퀴축 (코드 주석: 뒷바퀴 바로 앞)'],
  ['sensor.1.fromAxleMm', 85, '5번 센서: 축 중심에서 앞으로', 'mm', '센서', '실측: 뒷바퀴축 축 중심에서 8.5cm'],
  ['sensor.lateralMm', 50, '센서 좌우 위치(레일 중심에서 왼쪽 +)', 'mm', '센서', '가정값: 레일 옆 바닥을 봄. 차체가 돌아갈 때만 감지 위치에 영향'],
  ['sensor.marginMm', 0, '검정 판정 여유', 'mm', '센서', '+면 선이 넓게, −면 좁게 감지'],
  ['sensor.latencyMs', 0.3, '센서 응답 지연', 'ms', '센서', 'IR 반사형 디지털 출력 가정'],
  ['sensor.blackLevel', 1, '검정일 때 출력', '', '센서', 'PRIZM 라인센서: 검정=1'],

  // centre rail (single rail under the middle of the robot; guide rollers at both axles)
  ['rail.enabled', 1, '가운데 레일 구속', '', '레일', '1 = 사용, 0 = 끔 (레일 효과 비교 시험용)'],
  ['rail.widthMm', 30, '레일 폭', 'mm', '레일', '규정 도면의 레일 폭 30mm (실물은 가운데 1개)'],
  ['rail.heightMm', 20, '레일 높이', 'mm', '레일', '가정값 (표시용)'],
  ['rail.clearanceMm', 1.0, '가이드 롤러 한쪽 틈새', 'mm', '레일', '가정값: 롤러와 레일 사이 여유. 이 이상 벗어나면 접촉력 발생'],
  ['rail.stiffnessNmm', 200, '롤러 접촉 강성', 'N/mm', '레일', '가정값'],
  ['rail.dampingNsm', 1000, '롤러 접촉 감쇠', 'N·s/m', '레일', '가정값'],
  ['rail.rollerFriction', 0.02, '롤러 구름 저항 계수', '', '레일', '접촉력 × 계수만큼 진행 방향 저항'],

  // drive train
  ['drive.wheelDiameterMm', 103, '모터축 바퀴 지름', 'mm', '구동', '실측 10.3cm → 바퀴 1회전 323.6mm'],
  ['drive.motorGearTeeth', 40, '모터 구동 기어 잇수', 'T', '구동', '현재 40T. 위 "기어 구성"에서 80T→40T로 바꿀 수 있음'],
  ['drive.wheelGearTeeth', 80, '동력 전달(바퀴) 기어 잇수', 'T', '구동', '현재 80T. 모터 회전 / 바퀴 회전 = 바퀴 기어 ÷ 모터 기어'],
  ['drive.rightWheelScale', 1.0, '오른쪽 바퀴 유효 지름 배율', '', '구동', '좌우 바퀴 차이 시험용 (1 = 같음)'],
  ['robot.motor1Forward', 1, '모터1 전진 부호', '', '구동', '코드: setMotorSpeeds(+v, −v). 모터1 = 오른쪽(교육자료: 채널1=우)'],
  ['robot.motor2Forward', -1, '모터2 전진 부호', '', '구동', '거울 대칭 장착. 모터2 = 왼쪽'],
  ['robot.massKg', 6.0, '로봇 질량', 'kg', '구동', '가정값'],
  ['robot.yawInertia', 0.2, '수직축 관성모멘트', 'kg·m²', '구동', '가정값 (6kg, 480×400 상자)'],
  ['robot.driveWeightFrac', 0.55, '구동축 하중 비율', '', '구동', '가정값. 무게중심 위치도 이 값으로 정함(모터축에서 뒤로 축간 × (1 − 비율))'],
  ['robot.tireMu', 0.7, '바퀴 마찰계수', '', '구동', '가정값 (제동 시 미끄럼 한계)'],
  ['robot.passiveLateralGrip', 0.05, '비구동 바퀴 옆방향 저항 비율', '', '구동', '0.05 = 옴니휠(키트 구성 가정, 옆으로 거의 자유), 1 = 일반 바퀴'],
  ['robot.rollResistN', 2.0, '구름 저항', 'N', '구동', '가정값'],
  ['robot.rollViscous', 5.0, '속도 비례 저항', 'N/(m/s)', '구동', '가정값'],
  ['robot.tireStiffness', 15000, '타이어 미끄럼 강성', 'N/(m/s)', '구동', '수치 모델용 (앞뒤·옆 공통)'],

  // motor
  ['motor.batteryV', 12.6, '배터리 전압', 'V', '모터', 'TETRIX 12V 팩 (충전 상태에 따라 변경)'],
  ['motor.nominalV', 12.0, '모터 정격 전압', 'V', '모터', 'TorqueNADO 44260'],
  ['motor.stallTorqueNm', 4.94, '정지 토크', 'N·m', '모터', '700 oz-in (60:1)'],
  ['motor.stallCurrentA', 8.7, '정지 전류', 'A', '모터', '스펙'],
  ['motor.noLoadRpm', 100, '무부하 속도', 'rpm', '모터', '60:1 = 600 deg/s'],
  ['motor.noLoadCurrentA', 0.3, '무부하 전류(기어 마찰)', 'A', '모터', '가정값'],
  ['motor.reflectedInertia', 0.004, '출력축 환산 관성', 'kg·m²', '모터', '가정값'],
  ['motor.currentLimitA', 20, '드라이버 전류 제한', 'A', '모터', '가정값'],

  // PRIZM speed loop
  ['prizm.speedRatio', 0.77, '속도 추종 비율 (실제/명령)', '', 'PRIZM 속도제어', '실측 BASE_TRACE: 명령 100 → 75~77.5 deg/s'],
  ['prizm.speedDeadMs', 110, '속도 명령 지연', 'ms', 'PRIZM 속도제어', '실측 트레이스 피팅'],
  ['prizm.speedLagMs', 60, '속도 응답 시정수', 'ms', 'PRIZM 속도제어', '실측 트레이스 피팅'],
  ['prizm.innerKp', 0.3, '내부 추종 게인', 'duty/(rad/s)', 'PRIZM 속도제어', '수치 모델용'],

  // arm / Z / wrist (timing only)
  ['arm.unitsPerRev', 10000, 'AServo 단위/모터 회전', '', '팔·Z', 'ARM_UNITS_PER_MOTOR_REV'],
  ['arm.initialJ1', 2500, 'J1 초기 위치', 'unit', '팔·Z', '전원 투입 시 임의 자세'],
  ['arm.initialJ2', -4000, 'J2 초기 위치', 'unit', '팔·Z', '전원 투입 시 임의 자세'],
  ['arm.homingRpm', 60, '팔 호밍 속도', 'rpm', '팔·Z', '가정값'],
  ['arm.positionWindow', 20, '도착 판정 허용오차', 'unit', '팔·Z', 'CiA402 position window 가정'],
  ['can.sdoLatencyMs', 1.0, 'SDO 처리 지연', 'ms', '팔·Z', '실측 보정: SDO 1회 ≈ 9.9 ms (ARM_START_COMMAND_GAP_MS)'],
  ['can.adapterLatencyMs', 0.8, 'Serial-CAN 변환 지연', 'ms', '팔·Z', '실측 보정 (위와 함께)'],
  ['z.initialMm', -30, 'Z 초기 높이', 'mm', '팔·Z', '원점(0) 아래'],
  ['servo.rateAt100', 200, '손목 속도(100%)', '명령단위/s', '팔·Z', '코드의 WRIST_COMMAND_DPS_AT_100 가정과 동일'],
  ['servo.maxRate', 240, '손목 최대 속도', '명령단위/s', '팔·Z', '가정값'],

  // arm visualisation only (does not change timing)
  ['viz.armBaseMm', 0, '팔 회전축 위치(모터축 기준, 앞 +)', 'mm', '시각화(팔)', '3D 표시용 가정값 (이전 버전과 같은 경기장 위치에서 정지)'],
  ['viz.armZeroDeg', 0, '팔 0점 방향', 'deg', '시각화(팔)', '0=경기장 쪽(전진 방향), 180=시작 끝 쪽'],
  ['viz.j1Sign', -1, '관절 부호', '', '시각화(팔)', '+1 또는 −1 (1번 트레이 삽입이 오른쪽 줄 트레이로 향함)'],
  ['viz.wristSign', -1, '손목 부호', '', '시각화(팔)', '+1 또는 −1'],
  ['viz.unitsPer90', 25000, '90°당 드라이브 단위', 'unit', '시각화(팔)', '교육자료: 각도 = 펄스 × 90 / 25000'],
  ['viz.link1Mm', 232.5, '1번 링크', 'mm', '시각화(팔)', 'CONTEXT.md 실측'],
  ['viz.link2Mm', 175, '2번 링크', 'mm', '시각화(팔)', 'CONTEXT.md 실측'],
  ['viz.forkMm', 195, '손목→포크 끝', 'mm', '시각화(팔)', 'CONTEXT.md 실측'],
  ['viz.armHomeHeightMm', 524, 'Z=0일 때 팔 높이', 'mm', '시각화(팔)', '3D 표시용 가정값'],

  // run / inputs
  ['input.startPressMs', 'auto', '초록 시작 버튼 누름 시각', 'ms', '실행', 'auto = 시작 LED가 켜지고 0.3초 뒤 누름. 숫자(ms)를 쉼표로 여러 번 지정 가능'],
  ['input.buttonAPressMs', '', '검정 BUTTON_A 누름 시각', 'ms', '실행', '비우면 누르지 않음'],
  ['input.serial', '', '시리얼 입력 예약', '', '실행', '예: 60000:s  (60초에 s 전송)'],
  ['run.maxSeconds', 330, '최대 시뮬 시간', 's', '실행', '경기 300초 + 여유'],
  ['run.frameMs', 5, '기록 간격', 'ms', '실행', ''],
  ['run.idleStopSeconds', 20, '변화 없으면 자동 종료', 's', '실행', '움직임·LED·시리얼 출력이 이 시간 동안 없으면 계산 종료 (0=끄기)'],
  ['cpu.millisUs', 1, 'millis() 호출 비용', 'µs', '실행', '빈 루프가 시간을 소모하도록'],
  ['cpu.loopUs', 3, 'loop() 사이 오버헤드', 'µs', '실행', ''],
];

export const PARAMS_VERSION = 5;
// keys whose defaults changed (2: arm faces the field, 3: measured robot geometry + centre rail)
export const MIGRATE_KEYS = {
  2: ['viz.armZeroDeg', 'viz.armBaseMm', 'viz.j1Sign', 'viz.wristSign'],
  3: ['robot.rearOverhangMm', 'robot.startAxleMm', 'robot.lengthMm', 'viz.armBaseMm', 'field.gapMm', 'field.lineWidthMm', 'field.firstGapMm', 'field.lastGapMm', 'field.lineCount'],
  4: ['robot.wheelbaseMm', 'robot.motorAxle', 'sensor.0.axle', 'sensor.1.axle', 'drive.wheelDiameterMm', 'robot.rearOverhangMm', 'robot.startAxleMm'],
  // 5: new field measurement (white 360 / ends 163 / line 10); the 470/150 values are withdrawn
  5: ['field.gapMm', 'field.firstGapMm', 'field.lastGapMm', 'field.lineWidthMm', 'field.lineCount', 'robot.wheelbaseMm', 'robot.rearOverhangMm', 'drive.wheelDiameterMm', 'sensor.0.fromAxleMm', 'sensor.1.fromAxleMm', 'sensor.0.axle', 'sensor.1.axle', 'robot.motorAxle'],
};
// drop values that an older version saved/exported for keys whose meaning or default changed.
// `dropped` (optional array) receives the keys that were replaced so the UI can tell the user.
export function migrateParams(saved, dropped) {
  const from = Number(saved && saved._v) || 1;
  const stale = new Set();
  for (let v = from + 1; v <= PARAMS_VERSION; v++) for (const k of MIGRATE_KEYS[v] || []) stale.add(k);
  const out = {};
  for (const [k, v] of Object.entries(saved || {})) {
    if (k === '_v') continue;
    if (stale.has(k)) { if (dropped) dropped.push(k); continue; }
    out[k] = v;
  }
  return out;
}

// Sanity limits: values that would break the physics are clamped (with a message), and
// geometry that cannot be built physically is reported. Returns { params, warnings }.
const LIMITS = {
  'robot.massKg': [0.5, 100], 'robot.yawInertia': [0.005, 50], 'drive.wheelDiameterMm': [10, 500],
  'drive.motorGearTeeth': [4, 400], 'drive.wheelGearTeeth': [4, 400], 'robot.trackMm': [50, 1000], 'robot.wheelbaseMm': [10, 1000],
  'robot.lengthMm': [50, 2000], 'robot.widthMm': [50, 1000], 'robot.rearOverhangMm': [0, 2000],
  'robot.startGapMm': [0, 2000], 'robot.passiveWheelDiameterMm': [5, 500], 'field.lineWidthMm': [0.5, 200],
  'field.gapMm': [10, 5000], 'field.firstGapMm': [0, 5000], 'field.lastGapMm': [0, 5000],
  'robot.tireMu': [0.01, 3], 'robot.driveWeightFrac': [0.05, 0.95], 'motor.batteryV': [1, 30],
};
export function validateParams(p) {
  const q = { ...p };
  const warnings = [];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(q[k]);
    if (q[k] === undefined) continue;
    if (!Number.isFinite(v) || v < lo || v > hi) {
      const nv = !Number.isFinite(v) || (v <= 0 && lo > 0) ? Number(defaultParams()[k]) : Math.min(hi, Math.max(lo, v));
      warnings.push(`${k} = ${q[k]} 은(는) 계산할 수 없는 값이라 ${nv}(으)로 바꿔 실행합니다 (허용 ${lo}~${hi})`);
      q[k] = nv;
    }
  }
  const g = robotGeometry(q);
  const geo = fieldGeometry(q);
  if (g.start + g.rearAxle - g.rearR < -0.01) warnings.push(`시작 위치에서 뒷바퀴가 경기장 끝 밖으로 ${(-(g.start + g.rearAxle - g.rearR)).toFixed(1)} mm 나갑니다 (뒷바퀴 지름·축간·시작 거리 확인)`);
  if (g.frontEnd < g.frontAxle + g.frontR) warnings.push('차체 앞끝이 앞바퀴보다 뒤에 있습니다 (차체 길이 확인)');
  if (g.start + g.frontEnd > geo.length) warnings.push('시작 위치에서 차체 앞끝이 경기장 반대쪽 끝을 넘습니다');
  const l0 = geo.lines[0] - geo.width / 2;
  const rearmost = g.sensors.reduce((a, b) => (a.s <= b.s ? a : b));
  if (g.start + rearmost.s >= l0) warnings.push(`출발할 때 모든 라인 센서가 이미 0번 선(${l0} mm)에 닿았거나 지나 있습니다(가장 뒤 ${rearmost.port}번 센서 ${(g.start + rearmost.s).toFixed(1)} mm). 0번 선을 처음 찾는 코드는 1번 선을 0번으로 셀 수 있습니다`);
  return { params: q, warnings };
}

export function defaultParams() {
  const p = {};
  for (const [k, v] of PARAM_SPECS) p[k] = v;
  p['sensor.count'] = 2;
  return p;
}

export function applyFieldPreset(params, name) {
  const preset = FIELD_PRESETS[name];
  if (!preset) return params;
  for (const [k, v] of Object.entries(preset)) if (k !== 'label') params[k] = v;
  return params;
}

export function fieldGeometry(p) {
  const n = Number(p['field.lineCount']);
  const w = Number(p['field.lineWidthMm']);
  const first = Number(p['field.firstGapMm']);
  const gap = Number(p['field.gapMm']);
  const last = Number(p['field.lastGapMm']);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(first + w / 2 + i * (gap + w));
  const length = first + n * w + (n - 1) * gap + last;
  return { lines, width: w, length, pitch: gap + w, startZone: Number(p['field.startZoneMm'] ?? 500) };
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

// Robot geometry along the travel direction, in mm relative to the MOTOR axle (forward +).
// Single source of truth for physics (via resolveParams), analysis and the 3D view.
export function robotGeometry(p) {
  const D = num(p['drive.wheelDiameterMm'], 103);
  // motor revolutions per wheel revolution = wheel gear teeth / motor gear teeth (40 -> 80 : 2)
  const motorT = num(p['drive.motorGearTeeth'], 40), wheelT = num(p['drive.wheelGearTeeth'], 80);
  const G = motorT > 0 && wheelT > 0 ? wheelT / motorT : 2;
  const r = D / 2;
  const wb = num(p['robot.wheelbaseMm'], 224);
  const driveFrac = num(p['robot.driveWeightFrac'], 0.55);
  const rp = num(p['robot.passiveWheelDiameterMm'], 90) / 2;
  const motorFront = String(p['robot.motorAxle'] ?? 'front').toLowerCase() !== 'rear';
  const frontAxle = motorFront ? 0 : wb;
  const rearAxle = motorFront ? -wb : 0;
  const rearEnd = -num(p['robot.rearOverhangMm'], 270);
  const frontEnd = rearEnd + num(p['robot.lengthMm'], 480);
  const sensors = [0, 1].map((i) => {
    const axle = String(p[`sensor.${i}.axle`] ?? (i ? 'rear' : 'front')).toLowerCase() === 'rear' ? 'rear' : 'front';
    const axleS = axle === 'front' ? frontAxle : rearAxle;
    const fromAxle = num(p[`sensor.${i}.fromAxleMm`], i ? 85 : 65);
    return { port: num(p[`sensor.${i}.port`], i ? 5 : 4), axle, axleS, fromAxle, s: axleS + fromAxle };
  });
  return {
    D, r, G, motorT, wheelT, wheelCirc: Math.PI * D, mmPerRev: (Math.PI * D) / G,
    motorFront, wheelbase: wb, frontAxle, rearAxle, passiveAxle: motorFront ? rearAxle : frontAxle,
    passiveR: rp, frontR: motorFront ? r : rp, rearR: motorFront ? rp : r,
    rearEnd, frontEnd, length: frontEnd - rearEnd, width: num(p['robot.widthMm'], 400), track: num(p['robot.trackMm'], 320),
    // robot pushed against the start end: motor axle = rear overhang (+ optional gap)
    start: -rearEnd + num(p['robot.startGapMm'], 0), sensors, sensorLateral: num(p['sensor.lateralMm'], 50),
    // centre of mass between the axles from the axle load split (front load fraction)
    cg: rearAxle + (motorFront ? driveFrac : 1 - driveFrac) * wb,
    rail: { enabled: num(p['rail.enabled'], 1) !== 0, width: num(p['rail.widthMm'], 30), height: num(p['rail.heightMm'], 20), clearance: num(p['rail.clearanceMm'], 1) },
  };
}

// Parameters handed to the C++ runtime: user values + derived geometry (geom.*).
export function resolveParams(p) {
  const out = validateParams(p).params;
  const g = robotGeometry(out);
  out['geom.mmPerRev'] = g.mmPerRev;
  out['geom.frontAxleS'] = g.frontAxle;
  out['geom.rearAxleS'] = g.rearAxle;
  out['geom.passiveAxleS'] = g.passiveAxle;
  out['geom.rearEndS'] = g.rearEnd;
  out['geom.frontEndS'] = g.frontEnd;
  out['geom.startAxleMm'] = g.start;
  out['geom.cgS'] = g.cg;
  g.sensors.forEach((s, i) => { out[`geom.sensor.${i}.s`] = s.s; });
  if (out['sensor.count'] === undefined) out['sensor.count'] = 2;
  return out;
}
