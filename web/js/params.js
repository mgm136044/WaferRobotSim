// Simulator parameters (all editable in the UI, exportable as JSON for the team).
// Every value has a source note so the team knows what is measured vs. assumed.

export const FIELD_PRESETS = {
  measured: {
    label: '팀 실측 (흰 칸 470 / 끝 150 / 선 10 mm)',
    'field.lineCount': 5,
    'field.firstGapMm': 150,
    'field.gapMm': 470,
    'field.lineWidthMm': 10,
    'field.lastGapMm': 150,
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

// [key, default, label, unit, group, note]
export const PARAM_SPECS = [
  // field
  ['field.lineCount', 5, '라인 수', '개', '경기장', '0~4번 라인'],
  ['field.firstGapMm', 150, '0번 앞 흰 구간', 'mm', '경기장', '팀 실측(바퀴축 기준)'],
  ['field.gapMm', 470, '라인 사이 흰 구간', 'mm', '경기장', '팀 실측: 한 칸(흰색만) 470'],
  ['field.lineWidthMm', 10, '검은 선 폭', 'mm', '경기장', '팀 실측 10mm (규정 도면 기반 교육용 시뮬은 19mm)'],
  ['field.lastGapMm', 150, '4번 뒤 흰 구간', 'mm', '경기장', '팀 실측'],
  ['field.startZoneMm', 500, '시작 구역 길이', 'mm', '경기장', '규정: 500×500 초록 시작 구역'],

  // robot geometry
  ['robot.lengthMm', 480, '차체 길이', 'mm', '로봇 형상', '규정 500 이내. 실측값으로 바꾸세요'],
  ['robot.rearOverhangMm', 70, '뒤끝 → 구동축', 'mm', '로봇 형상', '가정값'],
  ['robot.frontAxleMm', 330, '구동축 → 앞바퀴축', 'mm', '로봇 형상', '가정값 (시작 구역 판정용)'],
  ['sensor.0.port', 4, '앞 센서 포트', '', '센서', '코드: FRONT_PORT=4'],
  ['sensor.0.offsetMm', 280, '앞 센서 위치(구동축 기준)', 'mm', '센서', '가정값: 5번보다 앞, 간격 < 라인 간격'],
  ['sensor.1.port', 5, '중심 센서 포트', '', '센서', '코드: CENTER_PORT=5'],
  ['sensor.1.offsetMm', 30, '중심 센서 위치(구동축 기준)', 'mm', '센서', '코드 주석: 뒷바퀴 바로 앞'],
  ['sensor.marginMm', 0, '검정 판정 여유', 'mm', '센서', '+면 선이 넓게, −면 좁게 감지'],
  ['sensor.latencyMs', 0.3, '센서 응답 지연', 'ms', '센서', 'IR 반사형 디지털 출력 가정'],
  ['sensor.blackLevel', 1, '검정일 때 출력', '', '센서', 'PRIZM 라인센서: 검정=1'],
  ['robot.startAxleMm', 75, '시작 시 구동축 위치', 'mm', '로봇 형상', '경기장 시작 끝에서부터'],

  // drive train
  ['drive.mmPerRev', 153.2, '모터 1회전당 이동거리 C', 'mm', '구동', '키트(4" 바퀴 + 40:80 기어) 기준. 실측 권장'],
  ['robot.motor1Forward', 1, '모터1 전진 부호', '', '구동', '코드: setMotorSpeeds(+v, −v)'],
  ['robot.motor2Forward', -1, '모터2 전진 부호', '', '구동', '거울 대칭 장착'],
  ['robot.massKg', 6.0, '로봇 질량', 'kg', '구동', '가정값'],
  ['robot.driveWeightFrac', 0.55, '구동축 하중 비율', '', '구동', '가정값'],
  ['robot.tireMu', 0.7, '바퀴 마찰계수', '', '구동', '가정값 (제동 시 미끄럼 한계)'],
  ['robot.rollResistN', 2.0, '구름·가이드 롤러 저항', 'N', '구동', '가정값'],
  ['robot.rollViscous', 5.0, '속도 비례 저항', 'N/(m/s)', '구동', '가정값'],
  ['robot.tireStiffness', 15000, '타이어 미끄럼 강성', 'N/(m/s)', '구동', '수치 모델용'],

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
  ['can.sdoLatencyMs', 0.5, 'SDO 처리 지연', 'ms', '팔·Z', '가정값'],
  ['can.adapterLatencyMs', 0.2, 'Serial-CAN 변환 지연', 'ms', '팔·Z', '가정값'],
  ['z.initialMm', -30, 'Z 초기 높이', 'mm', '팔·Z', '원점(0) 아래'],
  ['servo.rateAt100', 200, '손목 속도(100%)', '명령단위/s', '팔·Z', '코드의 WRIST_COMMAND_DPS_AT_100 가정과 동일'],
  ['servo.maxRate', 240, '손목 최대 속도', '명령단위/s', '팔·Z', '가정값'],

  // arm visualisation only (does not change timing)
  ['viz.armBaseMm', 330, '팔 회전축 위치(구동축 기준)', 'mm', '시각화(팔)', '3D 표시용 가정값'],
  ['viz.armZeroDeg', 180, '팔 0점 방향', 'deg', '시각화(팔)', '0=전진 방향, 180=후진 방향'],
  ['viz.j1Sign', -1, '관절 부호', '', '시각화(팔)', '+1 또는 −1 (양수 각도가 초록 트레이 쪽)'],
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
