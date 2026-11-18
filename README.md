# 웨이퍼 이송 로봇 주행 시뮬레이터 (WaferRobotSim)

실제 로봇에 올리는 PRIZM Pro(ESP32-S3) 스케치(.ino + .cpp/.h)를 **한 글자도 고치지 않고** 브라우저에서 컴파일해
가상 로봇 위에서 실행하는 웹 시뮬레이터입니다. 설치 없이 URL만 열면 팀원 누구나 쓸 수 있습니다.

## 바로 쓰기

1. 시뮬레이터 주소를 연다 (팀 공유 주소 또는 아래 "직접 띄우기").
2. **📁 폴더 열기**로 스케치 폴더(예: `Wafer_Transfer_Robot_final`)를 통째로 고르거나, **🗜 ZIP 열기** / 화면에 끌어다 놓기.
3. **▶ 컴파일 & 실행** (Ctrl+Enter).
   - 처음 한 번은 브라우저용 컴파일러(약 26 MB)를 내려받습니다. 이후에는 브라우저에 저장돼 바로 시작합니다.
   - 컴파일 약 10초 → 최대 330초 미션을 1초 안팎으로 계산 → 1배속으로 재생.
4. 재생: Space 재생/정지, ←/→ 0.1초, 배속 0.1~30배, 타임라인 드래그. 그래프·표를 클릭하면 그 시각으로 이동.
5. 탭
   - **그래프**: 명령 속도와 실제 엔코더 속도, 위치(라인 점선), 센서·브레이크/코스트, 팔·Z.
   - **분석·점수**: 정지마다 라인 중심 대비 센서 오차(mm), 주행 구간별 시간, 규정 V1.3 배점 기준 라인·복귀 점수(참고값), 코드 로그 마커.
   - **로봇·경기장 설정**: 경기장 프리셋(팀 실측 / 규정 도면), 센서 위치, 바퀴 이동량 C, 질량, 마찰, PRIZM 속도제어 특성 등.
     **설정 내보내기(JSON)** 로 팀원과 같은 값을 공유합니다.
   - **실측 비교**: 실물 시리얼 로그의 `BASE_TRACE` 줄을 붙여 넣으면 시뮬레이션과 엔코더 속도를 겹쳐 보여 줍니다.

코드는 이 브라우저(IndexedDB)에만 저장되고 서버로 올라가지 않습니다. 화면에서 고친 코드는 **ZIP 저장**으로 받아 그대로 실물에 올리면 됩니다.

### 실행 옵션 (설정 → 실행)
- `초록 시작 버튼`: `auto`(기본) = `PrizmBegin()`이 기다리기 시작하면 0.3초 뒤 누름. 숫자(ms)를 쉼표로 여러 번.
- `시리얼 입력 예약`: `60000:s` → 60초에 `s` 전송 (코드의 `SERIAL_STOP` 시험).
- `변화 없으면 자동 종료`: 움직임·LED·시리얼 출력이 20초간 없으면 계산 종료.

## 직접 띄우기 (팀 공유)

정적 파일만 있으면 되므로 어디에 올려도 됩니다. 서버 쪽 컴파일이 없습니다.

| 방법 | 명령 / 절차 |
|---|---|
| 같은 Wi-Fi(LAN) | `node tools/serve.mjs 8090` (또는 `시뮬레이터_실행.command` 더블클릭) → 표시되는 `http://192.168.x.x:8090/` 공유 |
| GitHub Pages | 이 폴더를 저장소로 올리고 Settings → Pages → *GitHub Actions* 선택. `.github/workflows/pages.yml`이 `web/`을 배포 |
| Netlify / Cloudflare Pages | `web/` 폴더를 그대로 업로드 (빌드 명령 없음, 공개 폴더 = `web`) |

`web/` 크기는 약 27 MB입니다(가장 큰 파일 `llvm.core.wasm.gz` 22 MB). Cloudflare Pages의 25 MiB 파일 한도 안에 듭니다.

## 구조

```
runtime/include/   스케치가 보는 헤더: Arduino.h, Wire.h, HardwareSerial.h, PRIZM_PRO.h,
                   driver/gptimer.h, hal/gpio_ll.h, soc/gpio_struct.h, freertos/*, esp_*.h
runtime/src/       가상 하드웨어 (C++ → wasm 오브젝트로 미리 빌드)
  core.cpp          가상 시계(µs)·스케줄러·GPIO·Arduino API (모든 API 호출이 시간을 씀)
  physics.cpp       PRIZM DC 모터 칩(I2C 0x05) + TorqueNADO 모터 + 레일 주행 차체 + 라인센서
                    + Z 스텝모터 + PRIZM 서보 칩(0x06) + LED/버튼
  wire.cpp          Wire/Wire1 I2C (버스 시간 포함)
  uart_can.cpp      UART1 38400bps → Serial-CAN 변환기 → AServo 2축 CiA-402 (SDO, PP/호밍, S-커브)
  inputs_timer.cpp  START/BUTTON_A/시리얼 입력 예약 + ESP-IDF gptimer(ISR) 에뮬레이션
  prizm.cpp         PRIZM_PRO 라이브러리 API (원본과 같은 I2C 레지스터 프로토콜)
web/               정적 웹앱 (three.js 3D, 그래프, 분석)
  js/compile-worker.js  브라우저 안의 clang 21 (YoWASP)로 스케치 컴파일
  js/run-worker.js      wasm 실행 → 프레임/시리얼/이벤트 스트리밍
  js/sketch-build.js    아두이노 빌더 규칙(.ino 합치기, #line, 자동 프로토타입, src/ 포함)
tools/build-runtime.mjs 런타임 재빌드 + 컴파일러 복사 (npm install 후 `npm run build`)
tools/run-sketch.mjs    헤드리스 실행: `node tools/run-sketch.mjs <스케치폴더> [--set key=value]`
tools/serve.mjs         LAN/로컬 서버
```

## 개발

```
npm install            # @yowasp/clang (빌드용)
npm run build          # runtime/ 수정 후 실행 → web/rt 갱신
npm run serve          # http://localhost:8080
node tools/run-sketch.mjs ../Wafer_Transfer_Robot_final --csv out.csv
```

실물과의 차이점은 [docs/DIFFERENCES.md](docs/DIFFERENCES.md) 참고.
