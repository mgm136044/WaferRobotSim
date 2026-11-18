// PRIZM Pro library re-implementation: same I2C protocol / pin usage / blocking delays
// as TETRIX PRIZM_PRO v1.15, talking to the virtual DC (0x05) and servo (0x06) chips.
#include <PRIZM_PRO.h>
#include <Wire.h>
#include "sim_internal.h"

using namespace sim;

static void tx(TwoWire &w, uint8_t addr, std::initializer_list<uint8_t> bytes) {
  w.beginTransmission(addr);
  for (uint8_t b : bytes) w.write(b);
  w.endTransmission();
}
#define PACE() delay(I2C_pace)

// ------------------------------------------------------------------ pixels / LED
static uint8_t pixel_brightness = 128;
static void set_pixel(int idx, uint32_t color) {
  if (idx < 0 || idx > 2) return;
  if (leds.rgb[idx] != color) {
    leds.rgb[idx] = color;
    event(EV_LED, idx, (double)color, 0, nullptr);
  }
  cost(40);  // NeoPixel show()
}
void PRIZM::enablePixels() { pixel_brightness = 128; clearPixels(); }
void PRIZM::clearPixel(uint8_t pixel) { set_pixel(pixel - 1, 0); }
void PRIZM::clearPixels() { for (int i = 0; i < 3; ++i) set_pixel(i, 0); }
void PRIZM::setPixelColor(uint8_t pixel, uint32_t color) { set_pixel(pixel - 1, color); }
void PRIZM::setPixelRGB(uint8_t pixel, uint8_t r, uint8_t g, uint8_t b) { set_pixel(pixel - 1, packPixelColor(r, g, b)); }
void PRIZM::setPixelBrightness(uint8_t percent) { pixel_brightness = (uint8_t)map(percent, 0, 100, 1, 255); cost(40); }
uint32_t PRIZM::packPixelColor(uint8_t R, uint8_t G, uint8_t B) { return ((uint32_t)R << 16) | ((uint32_t)G << 8) | B; }
uint32_t PRIZM::getWheelColor(uint8_t WheelPos) {
  WheelPos = 255 - WheelPos;
  if (WheelPos < 85) return packPixelColor(255 - WheelPos * 3, 0, WheelPos * 3);
  if (WheelPos < 170) { WheelPos -= 85; return packPixelColor(0, WheelPos * 3, 255 - WheelPos * 3); }
  WheelPos -= 170;
  return packPixelColor(WheelPos * 3, 255 - WheelPos * 3, 0);
}
void PRIZM::setPixelPattern(uint8_t pattern, uint8_t R, uint8_t G, uint8_t B) {
  (void)pattern;
  for (int i = 0; i < 3; ++i) set_pixel(i, packPixelColor(R, G, B));
  delay(500);
}
void PRIZM::SPARKLE(uint8_t R, uint8_t G, uint8_t B) { setPixelPattern(1, R, G, B); }
void PRIZM::CHASE(uint8_t R, uint8_t G, uint8_t B) { setPixelPattern(2, R, G, B); }
void PRIZM::RAINBOW() { setPixelPattern(5, 255, 0, 255); }
void PRIZM::FADE(uint8_t R, uint8_t G, uint8_t B) { setPixelPattern(6, R, G, B); }
void PRIZM::SWEEP(uint8_t R, uint8_t G, uint8_t B) { setPixelPattern(4, R, G, B); }
void PRIZM::TWINKLE() { setPixelPattern(3, 255, 255, 255); }
void PRIZM::setRedLED(uint8_t state) {
  if (state == 1) set_pixel(0, packPixelColor(255, 0, 0));
  if (state == 0) clearPixel(1);
}
void PRIZM::setGreenLED(uint8_t state) {
  if (state == 1) set_pixel(1, packPixelColor(0, 255, 0));
  if (state == 0) clearPixel(2);
}
void PRIZM::setBlueLED(uint8_t state) {
  if (state == 1) set_pixel(2, packPixelColor(0, 0, 255));
  if (state == 0) clearPixel(3);
}
void PRIZM::setStartLED(uint8_t state) {
  pinMode(12, OUTPUT);
  if (state == 1) digitalWrite(12, HIGH);
  if (state == 0) digitalWrite(12, LOW);
}

// ------------------------------------------------------------------ sound (timing only)
void PRIZM::setSoundTone(uint16_t f_tone, uint32_t duration) {
  ledcWriteTone(14, f_tone);
  delay(duration);
  if (duration > 0) ledcWriteTone(14, 0);
}
void PRIZM::setSoundNote(uint16_t note, uint32_t duration) { setSoundTone(note, duration); }
void PRIZM::setSoundOff() { ledcWriteTone(14, 0); }
void PRIZM::setSoundEffect(uint8_t effect) {
  switch (effect) {
    case 1: UFO(); break;
    case 2: randomNoise(); break;
    case 3: alarm(); break;
    case 4: whistleUp(); break;
    case 5: whistleDown(); break;
    case 6: siren(); break;
    case 7: correct(); break;
    case 8: incorrect(); break;
  }
}
void PRIZM::UFO() { delay(1500); }
void PRIZM::randomNoise() { delay(1000); }
void PRIZM::alarm() { delay(1200); }
void PRIZM::whistleUp() { delay(600); }
void PRIZM::whistleDown() { delay(600); }
void PRIZM::siren() { delay(2000); }
void PRIZM::correct() { delay(400); }
void PRIZM::incorrect() { delay(600); }

// ------------------------------------------------------------------ begin / end
void PRIZM::PrizmBegin(uint8_t I2C_delay) {
  Wire.begin(8, 9, 100000);
  Wire1.begin(1, 2);
  Wire1.setClock(400000);
  I2C_pace = I2C_delay;
  ledcAttach(14, 100, 12);
  ledcWrite(14, 0);
  delay(500);
  enablePixels();
  clearPixels();
  tx(Wire1, 5, {0x20}); PACE();
  tx(Wire1, 6, {0x20}); PACE();
  for (uint8_t a = 1; a <= 4; ++a) { tx(Wire, a, {0x27}); delay(10); }
  setSoundTone(700, 100);
  setSoundTone(350, 100);
  setSoundOff();
  setStartLED(HIGH);
  event(EV_INFO, 0, 0, 0, "PrizmBegin: waiting for the GREEN start button");
  while (!readStartButton()) { delay(0); }
  event(EV_INFO, 0, 0, 0, "start button pressed");
  setStartLED(LOW);
  setSoundTone(350, 100);
  setSoundTone(700, 100);
  setSoundOff();
  tx(Wire1, 5, {0x20}); PACE();
  tx(Wire1, 6, {0x20}); PACE();
  for (uint8_t a = 1; a <= 4; ++a) { tx(Wire, a, {0x27}); delay(10); }
  delay(1000);
  tx(Wire1, 5, {0x1E}); PACE();
  tx(Wire1, 6, {0x1E}); PACE();
  for (uint8_t a = 1; a <= 4; ++a) { tx(Wire, a, {0x25}); delay(10); }
}

void PRIZM::PrizmEnd(void) {
  tx(Wire1, 5, {0x20}); PACE();
  tx(Wire1, 6, {0x20}); PACE();
  for (uint8_t a = 1; a <= 4; ++a) { tx(Wire1, a, {0x27}); PACE(); }
  delay(60);
  end_run(1, "PrizmEnd() called: on the robot the watchdog resets the board and it waits for START again");
}

// ------------------------------------------------------------------ DC motors
void PRIZM::setMotorPWM_Freq(uint16_t freq) { tx(Wire1, 5, {0x21, (uint8_t)(freq >> 8), (uint8_t)freq}); PACE(); }
void PRIZM::setMotorPower(uint8_t channel, int16_t power) {
  if (channel < 1 || channel > 4) return;
  tx(Wire1, 5, {(uint8_t)(0x27 + channel), (uint8_t)(power >> 8), (uint8_t)power});
  PACE();
}
void PRIZM::setMotorPowers(int16_t p1, int16_t p2, int16_t p3, int16_t p4) {
  tx(Wire1, 5, {0x2E, (uint8_t)(p1 >> 8), (uint8_t)p1, (uint8_t)(p2 >> 8), (uint8_t)p2, (uint8_t)(p3 >> 8), (uint8_t)p3,
                (uint8_t)(p4 >> 8), (uint8_t)p4});
  PACE();
}
void PRIZM::setMotorBrake(uint8_t channel, uint8_t brake) {
  if (brake) setMotorPower(channel, 125);
  if (!brake) setMotorPower(channel, 0);
}
void PRIZM::setMotorSpeed(uint8_t channel, int16_t s) {
  if (channel < 1 || channel > 4) return;
  tx(Wire1, 5, {(uint8_t)(0x2E + channel), (uint8_t)(s >> 8), (uint8_t)s});
  PACE();
}
void PRIZM::setMotorSpeeds(int16_t s1, int16_t s2, int16_t s3, int16_t s4) {
  tx(Wire1, 5, {0x33, (uint8_t)(s1 >> 8), (uint8_t)s1, (uint8_t)(s2 >> 8), (uint8_t)s2, (uint8_t)(s3 >> 8), (uint8_t)s3,
                (uint8_t)(s4 >> 8), (uint8_t)s4});
  PACE();
}
static void target_tx(uint8_t reg, int16_t sp, int32_t t, uint8_t pace) {
  tx(Wire1, 5, {reg, (uint8_t)(sp >> 8), (uint8_t)sp, (uint8_t)(t >> 24), (uint8_t)(t >> 16), (uint8_t)(t >> 8), (uint8_t)t});
  delay(pace);
}
static void targets_tx(uint8_t reg, const int16_t *sp, const int32_t *t, uint8_t pace) {
  Wire1.beginTransmission(5);
  Wire1.write(reg);
  for (int i = 0; i < 4; ++i) {
    Wire1.write((uint8_t)(sp[i] >> 8)); Wire1.write((uint8_t)sp[i]);
    Wire1.write((uint8_t)(t[i] >> 24)); Wire1.write((uint8_t)(t[i] >> 16));
    Wire1.write((uint8_t)(t[i] >> 8)); Wire1.write((uint8_t)t[i]);
  }
  Wire1.endTransmission();
  delay(pace);
}
void PRIZM::setMotorTarget(uint8_t channel, int16_t Mspeed, int32_t Mtarget) {
  if (channel >= 1 && channel <= 4) target_tx((uint8_t)(0x33 + channel), Mspeed, Mtarget, I2C_pace);
}
void PRIZM::setMotorTargets(int16_t s1, int32_t t1, int16_t s2, int32_t t2, int16_t s3, int32_t t3, int16_t s4, int32_t t4) {
  const int16_t s[4] = {s1, s2, s3, s4};
  const int32_t t[4] = {t1, t2, t3, t4};
  targets_tx(0x38, s, t, I2C_pace);
}
void PRIZM::setMotorDegree(uint8_t channel, int16_t Mspeed, int32_t Mdegrees) {
  if (channel >= 1 && channel <= 4) target_tx((uint8_t)(0x4E + channel), Mspeed, Mdegrees, I2C_pace);
}
void PRIZM::setMotorDegrees(int16_t s1, int32_t d1, int16_t s2, int32_t d2, int16_t s3, int32_t d3, int16_t s4, int32_t d4) {
  const int16_t s[4] = {s1, s2, s3, s4};
  const int32_t t[4] = {d1, d2, d3, d4};
  targets_tx(0x53, s, t, I2C_pace);
}
void PRIZM::setMotorInvert(uint8_t channel, uint8_t invert) {
  if (channel < 1 || channel > 4) return;
  tx(Wire1, 5, {(uint8_t)(0x46 + channel), invert});
  PACE();
}
static int32_t read32(uint8_t reg, uint8_t pace) {
  tx(Wire1, 5, {reg});
  delay(pace);
  Wire1.requestFrom(5, 4);
  uint8_t b1 = Wire1.read(), b2 = Wire1.read(), b3 = Wire1.read(), b4 = Wire1.read();
  delay(pace);
  return (int32_t)((uint32_t)b4 << 24 | (uint32_t)b3 << 16 | (uint32_t)b2 << 8 | b1);
}
uint8_t PRIZM::readMotorBusy(uint8_t channel) { return getMotorBusy(channel); }
uint8_t PRIZM::getMotorBusy(uint8_t channel) {
  if (channel < 1 || channel > 4) return 0;
  tx(Wire1, 5, {(uint8_t)(0x42 + channel)});
  PACE();
  Wire1.requestFrom(5, 1);
  uint8_t v = Wire1.read();
  PACE();
  return v;
}
int32_t PRIZM::readEncoderCount(uint8_t channel) { return getEncoderCount(channel); }
int32_t PRIZM::getEncoderCount(uint8_t channel) {
  if (channel < 1 || channel > 4) return 0;
  return read32((uint8_t)(0x38 + channel), I2C_pace);
}
int32_t PRIZM::readEncoderDegrees(uint8_t channel) { return getEncoderDegrees(channel); }
int32_t PRIZM::getEncoderDegrees(uint8_t channel) {
  if (channel < 1 || channel > 4) return 0;
  return read32((uint8_t)(0x53 + channel), I2C_pace);
}
void PRIZM::resetEncoder(uint8_t channel) {
  if (channel < 1 || channel > 4) return;
  tx(Wire1, 5, {(uint8_t)(0x3D + channel)});
  PACE();
}
void PRIZM::resetEncoders(void) { tx(Wire1, 5, {0x42}); PACE(); }
void PRIZM::setMotorSpeedPID(uint8_t P_, uint8_t I_, uint8_t D_) {
  tx(Wire1, 5, {0x4D, 0, P_, 0, I_, 0, D_});
  PACE();
}
void PRIZM::setMotorTargetPID(uint8_t P_, uint8_t I_, uint8_t D_) {
  tx(Wire1, 5, {0x4E, 0, P_, 0, I_, 0, D_});
  PACE();
}
double PRIZM::readBatteryVoltage(void) { return getBatteryVoltage(); }
double PRIZM::getBatteryVoltage(void) {
  tx(Wire1, 5, {0x59});
  PACE();
  Wire1.requestFrom(5, 4);
  uint8_t b1 = Wire1.read(), b2 = Wire1.read();
  PACE();
  uint16_t v = (uint16_t)(b2 << 8 | b1);
  return (v * 1.6) / 100.0;
}
uint8_t PRIZM::readDCFirmware(void) { return getDCFirmware(); }
uint8_t PRIZM::getDCFirmware(void) {
  tx(Wire1, 5, {0x26});
  Wire1.requestFrom(5, 1);
  return Wire1.read();
}
uint8_t PRIZM::readSVOFirmware(void) { return getSVOFirmware(); }
uint8_t PRIZM::getSVOFirmware(void) {
  tx(Wire1, 6, {0x26});
  Wire1.requestFrom(6, 1);
  return Wire1.read();
}

// ------------------------------------------------------------------ sensors / buttons
static uint8_t port_pin(uint8_t port) {
  switch (port) { case 1: return 6; case 2: return 15; case 3: return 17; case 4: return 10; case 5: return 35; case 6: return 9; }
  return 0;
}
uint8_t PRIZM::readLineSensor(uint8_t port) { return getLineSensor(port); }
uint8_t PRIZM::getLineSensor(uint8_t port) {
  uint8_t pin = port_pin(port);
  pinMode(pin, INPUT);
  return HIGH == digitalRead(pin) ? 1 : 0;
}
uint16_t PRIZM::readSonicSensorCM(uint8_t port) { (void)port; delayMicroseconds(1000); cost(5000); return 0; }
uint16_t PRIZM::readSonicSensorIN(uint8_t port) { (void)port; delayMicroseconds(1000); cost(5000); return 0; }
double PRIZM::getSonicSensor(uint8_t port, uint8_t) {
  (void)port;
  cost(6000);
  event(EV_UNSUPPORTED, 0, 0, 0, "ultrasonic sensor is not modelled (returns 0)");
  return 0;
}
uint16_t PRIZM::getSensorAnalog(uint8_t port, uint8_t pin) { (void)port; (void)pin; cost(20); return 0; }
uint8_t PRIZM::getSensorDigital(uint8_t port, uint8_t pin) {
  static const uint8_t map1[7][2] = {{0, 0}, {6, 7}, {15, 16}, {17, 18}, {10, 11}, {35, 36}, {9, 8}};
  uint8_t dpin = (port >= 1 && port <= 6 && (pin == 1 || pin == 2)) ? map1[port][pin - 1] : 0;
  pinMode(dpin, INPUT);
  return (uint8_t)digitalRead(dpin);
}
void PRIZM::setSensorDigital(uint8_t port, uint8_t pin, uint8_t level) {
  static const uint8_t map1[7][2] = {{0, 0}, {6, 7}, {15, 16}, {17, 18}, {10, 11}, {35, 36}, {9, 8}};
  uint8_t dpin = (port >= 1 && port <= 6 && (pin == 1 || pin == 2)) ? map1[port][pin - 1] : 0;
  pinMode(dpin, OUTPUT);
  digitalWrite(dpin, level);
}
uint8_t PRIZM::readStartButton(void) {
  pinMode(5, INPUT);
  uint8_t b = (uint8_t)digitalRead(5);
  return !b;
}
uint8_t PRIZM::getButton(uint8_t button) {
  pinMode(button, INPUT);
  uint8_t b = (uint8_t)digitalRead(button);
  return !b;
}

// ------------------------------------------------------------------ servos (chip 0x06)
void PRIZM::enableServos(uint8_t condition) {
  if (condition == 0) tx(Wire1, 6, {0x3E});
  if (condition == 1) tx(Wire1, 6, {0x3F});
  PACE();
}
static uint8_t *last_speed(PRIZM &p, uint8_t ch) {
  switch (ch) { case 1: return &p.lastServoSpeed_1; case 2: return &p.lastServoSpeed_2; case 3: return &p.lastServoSpeed_3;
    case 4: return &p.lastServoSpeed_4; case 5: return &p.lastServoSpeed_5; case 6: return &p.lastServoSpeed_6; }
  return nullptr;
}
static uint8_t *last_pos(PRIZM &p, uint8_t ch) {
  switch (ch) { case 1: return &p.lastPosition_1; case 2: return &p.lastPosition_2; case 3: return &p.lastPosition_3;
    case 4: return &p.lastPosition_4; case 5: return &p.lastPosition_5; case 6: return &p.lastPosition_6; }
  return nullptr;
}
static int16_t *last_state(PRIZM &p, uint8_t ch) {
  switch (ch) { case 1: return &p.lastState_1; case 2: return &p.lastState_2; case 3: return &p.lastState_3;
    case 4: return &p.lastState_4; case 5: return &p.lastState_5; case 6: return &p.lastState_6; }
  return nullptr;
}
void PRIZM::setServoSpeed(uint8_t channel, uint8_t servospeed) {
  uint8_t *ls = last_speed(*this, channel);
  if (!ls || *ls == servospeed) return;  // the library skips repeated values
  *ls = servospeed;
  tx(Wire1, 6, {(uint8_t)(0x27 + channel), servospeed});
  PACE();
}
void PRIZM::setServoSpeeds(uint8_t s1, uint8_t s2, uint8_t s3, uint8_t s4, uint8_t s5, uint8_t s6) {
  lastServoSpeed_1 = s1; lastServoSpeed_2 = s2; lastServoSpeed_3 = s3;
  lastServoSpeed_4 = s4; lastServoSpeed_5 = s5; lastServoSpeed_6 = s6;
  tx(Wire1, 6, {0x2E, s1, s2, s3, s4, s5, s6});
  PACE();
}
void PRIZM::setServoPosition(uint8_t channel, uint8_t servoposition) {
  uint8_t *lp = last_pos(*this, channel);
  if (!lp || *lp == servoposition) return;  // the library skips repeated values
  *lp = servoposition;
  tx(Wire1, 6, {(uint8_t)(0x2E + channel), servoposition});
  PACE();
}
void PRIZM::setServoPositions(uint8_t p1, uint8_t p2, uint8_t p3, uint8_t p4, uint8_t p5, uint8_t p6) {
  lastPosition_1 = p1; lastPosition_2 = p2; lastPosition_3 = p3;
  lastPosition_4 = p4; lastPosition_5 = p5; lastPosition_6 = p6;
  tx(Wire1, 6, {0x35, p1, p2, p3, p4, p5, p6});
  PACE();
}
void PRIZM::setCRServoState(uint8_t channel, int16_t state, int8_t trim) {
  int16_t *ls = last_state(*this, channel);
  if (!ls || *ls == state) return;
  *ls = state;
  uint8_t crspeed = (uint8_t)map(state, -100, 100, 0, 180);
  crspeed = (uint8_t)(crspeed + trim);
  crspeed = constrain(crspeed, 0, 180);
  tx(Wire1, 6, {(uint8_t)(0x2E + channel), crspeed});
  PACE();
}
uint8_t PRIZM::readServoPosition(uint8_t channel) { return getServoPosition(channel); }
uint8_t PRIZM::getServoPosition(uint8_t channel) {
  if (channel < 1 || channel > 6) return 0;
  tx(Wire1, 6, {(uint8_t)(0x35 + channel)});
  PACE();
  Wire1.requestFrom(6, 1);
  uint8_t v = Wire1.read();
  PACE();
  return v;
}

// ------------------------------------------------------------------ EXPANSION boxes (not fitted)
static void exp_warn() {
  static bool once = false;
  if (!once) { once = true; event(EV_UNSUPPORTED, 0, 0, 0, "EXPANSION controllers are not part of this robot model (calls are ignored)"); }
  cost(200);
}
void EXPANSION::WDT_STOP(int) { exp_warn(); }
void EXPANSION::controllerEnable(int) { exp_warn(); }
void EXPANSION::controllerReset(int) { exp_warn(); }
void EXPANSION::setExpID(int) { exp_warn(); }
int EXPANSION::readExpID(void) { exp_warn(); return 0; }
int EXPANSION::getExpID(void) { exp_warn(); return 0; }
void EXPANSION::setMotorPower(int, int, int) { exp_warn(); }
void EXPANSION::setMotorPowers(int, int, int) { exp_warn(); }
void EXPANSION::setMotorSpeed(int, int, long) { exp_warn(); }
void EXPANSION::setMotorSpeeds(int, long, long) { exp_warn(); }
void EXPANSION::setMotorTarget(int, int, long, long) { exp_warn(); }
void EXPANSION::setMotorTargets(int, long, long, long, long) { exp_warn(); }
void EXPANSION::setMotorDegree(int, int, long, long) { exp_warn(); }
void EXPANSION::setMotorDegrees(int, long, long, long, long) { exp_warn(); }
void EXPANSION::setMotorInvert(int, int, int) { exp_warn(); }
int EXPANSION::readMotorBusy(int, int) { exp_warn(); return 0; }
int EXPANSION::getMotorBusy(int, int) { exp_warn(); return 0; }
int EXPANSION::readMotorCurrent(int, int) { exp_warn(); return 0; }
int EXPANSION::getMotorCurrent(int, int) { exp_warn(); return 0; }
int EXPANSION::readBatteryVoltage(int) { exp_warn(); return 0; }
int EXPANSION::getBatteryVoltage(int) { exp_warn(); return 0; }
long EXPANSION::readEncoderCount(int, int) { exp_warn(); return 0; }
long EXPANSION::getEncoderCount(int, int) { exp_warn(); return 0; }
long EXPANSION::readEncoderDegrees(int, int) { exp_warn(); return 0; }
long EXPANSION::getEncoderDegrees(int, int) { exp_warn(); return 0; }
void EXPANSION::resetEncoder(int, int) { exp_warn(); }
void EXPANSION::resetEncoders(int) { exp_warn(); }
void EXPANSION::setMotorSpeedPID(int, int, int, int) { exp_warn(); }
void EXPANSION::setMotorTargetPID(int, int, int, int) { exp_warn(); }
int EXPANSION::readDCFirmware(int) { exp_warn(); return 0; }
int EXPANSION::getDCFirmware(int) { exp_warn(); return 0; }
int EXPANSION::readSVOFirmware(int) { exp_warn(); return 0; }
int EXPANSION::getSVOFirmware(int) { exp_warn(); return 0; }
void EXPANSION::setServoSpeed(int, int, int) { exp_warn(); }
void EXPANSION::setServoSpeeds(int, int, int, int, int, int, int) { exp_warn(); }
void EXPANSION::setServoPosition(int, int, int) { exp_warn(); }
void EXPANSION::setServoPositions(int, int, int, int, int, int, int) { exp_warn(); }
void EXPANSION::setCRServoState(int, int, int) { exp_warn(); }
int EXPANSION::readServoPosition(int, int) { exp_warn(); return 0; }
int EXPANSION::getServoPosition(int, int) { exp_warn(); return 0; }
