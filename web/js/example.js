// Small self-contained example (not the team's competition code).
export const EXAMPLE_FILES = {
  'LineStop_Example/LineStop_Example.ino': `#include <PRIZM_PRO.h>

// 예제: 0번 라인 정렬 → 2번 라인까지 전진(중간 라인 계수) → 브레이크 → 0번으로 후진 복귀
// 모터1 = +속도, 모터2 = -속도 가 전진 (거울 대칭 장착)
PRIZM prizm;

const int FRONT = 4;   // 앞 라인센서 포트
const int CENTER = 5;  // 중심 라인센서 포트 (뒷바퀴 바로 앞)
const int BLACK = 1;

bool black(int port) { return prizm.getLineSensor(port) == BLACK; }

void driveSpeed(int v) { prizm.setMotorSpeeds(v, -v); }
void brake() { prizm.setMotorPowers(125, 125); }

// 앞 센서로 라인 n개를 센 뒤, 중심 센서가 검정이 되면 정지
void forwardLines(int n, int fast, int slow) {
  int seen = 0;
  bool wasBlack = black(FRONT);
  driveSpeed(fast);
  while (seen < n) {
    bool b = black(FRONT);
    if (b && !wasBlack) {
      seen++;
      Serial.printf("front line %d/%d at %lu ms enc=%ld\\n", seen, n, millis(), (long)prizm.getEncoderCount(1));
    }
    wasBlack = b;
  }
  driveSpeed(slow);
  while (black(CENTER)) {}
  while (!black(CENTER)) {}
  brake();
  Serial.printf("BRAKE at %lu ms\\n", millis());
}

void setup() {
  Serial.begin(115200);
  prizm.PrizmBegin();          // 초록 START 버튼 대기 (시뮬레이터가 자동으로 눌러 줌)
  Serial.println("start");
  // 1) 0번 라인 정렬
  driveSpeed(100);
  while (!black(CENTER)) {}
  brake();
  delay(500);
  prizm.resetEncoders();
  // 2) 2번 라인까지 전진
  forwardLines(2, 600, 120);
  delay(1000);
  // 3) 후진: 중심 센서로 라인 2개 지나서 0번에서 정지
  driveSpeed(-400);
  int passed = 0;
  bool wasBlack = black(CENTER);
  while (passed < 2) {
    bool b = black(CENTER);
    if (b && !wasBlack) passed++;
    wasBlack = b;
  }
  brake();
  // 4) 빨간 LED 3회
  for (int i = 0; i < 3; i++) { prizm.setRedLED(HIGH); delay(200); prizm.setRedLED(LOW); delay(200); }
  Serial.println("done");
}

void loop() {}
`,
};
