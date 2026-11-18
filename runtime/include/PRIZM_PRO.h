// WaferRobotSim re-implementation of the TETRIX PRIZM Pro (ESP32-S3) Arduino library API (v1.15).
// Public members and method signatures match the Pitsco header so sketches compile unchanged.
// Each method performs the SAME I2C transactions as the real library (Wire1 @0x05 DC chip,
// @0x06 servo chip), so direct register writes from user code behave identically.
#pragma once
#include <Arduino.h>

#define EFFECT_UFO 1
#define EFFECT_RANDOM 2
#define EFFECT_ALARM 3
#define EFFECT_WHISTLE_UP 4
#define EFFECT_WHISTLE_DOWN 5
#define EFFECT_SIREN 6
#define EFFECT_CORRECT 7
#define EFFECT_INCORRECT 8
#define PATTERN_SPARKLE 1
#define PATTERN_CHASE 2
#define PATTERN_TWINKLE 3
#define PATTERN_SWEEP 4
#define PATTERN_RAINBOW 5
#define PATTERN_FADE 6
#define NOTE_C4 262
#define NOTE_D4 294
#define NOTE_E4 330
#define NOTE_F4 349
#define NOTE_G4 392
#define NOTE_A4 440
#define NOTE_B4 494
#define NOTE_C5 523

class PRIZM {
 public:
  uint8_t lastPosition_1 = 90;
  uint8_t lastPosition_2 = 90;
  uint8_t lastPosition_3 = 90;
  uint8_t lastPosition_4 = 90;
  uint8_t lastPosition_5 = 90;
  uint8_t lastPosition_6 = 90;
  int16_t lastState_1 = 0;
  int16_t lastState_2 = 0;
  int16_t lastState_3 = 0;
  int16_t lastState_4 = 0;
  int16_t lastState_5 = 0;
  int16_t lastState_6 = 0;
  uint8_t lastServoSpeed_1 = 50;
  uint8_t lastServoSpeed_2 = 50;
  uint8_t lastServoSpeed_3 = 50;
  uint8_t lastServoSpeed_4 = 50;
  uint8_t lastServoSpeed_5 = 50;
  uint8_t lastServoSpeed_6 = 50;
#define UNITS_CM 0
#define UNITS_IN 1
#define BUTTON_A 4
#define BUTTON_C 5
  uint8_t I2C_pace = 0;

  void setSoundEffect(uint8_t effect);
  void setSoundTone(uint16_t f_tone = 0, uint32_t duration = 0);
  void setSoundNote(uint16_t note = 0, uint32_t duration = 0);
  void setSoundOff();
  void UFO();
  void randomNoise();
  void alarm();
  void whistleUp();
  void whistleDown();
  void siren();
  void correct();
  void incorrect();
  void enablePixels();
  void setPixelColor(uint8_t pixel, uint32_t color);
  void setPixelRGB(uint8_t pixel, uint8_t red, uint8_t green, uint8_t blue);
  void setPixelBrightness(uint8_t percent = 50);
  void setPixelPattern(uint8_t pattern = 0, uint8_t R = 255, uint8_t G = 255, uint8_t B = 255);
  void clearPixel(uint8_t pixel);
  void clearPixels();
  uint32_t packPixelColor(uint8_t R, uint8_t G, uint8_t B);
  uint32_t getWheelColor(uint8_t WheelPos);
  void SPARKLE(uint8_t R = 255, uint8_t G = 255, uint8_t B = 255);
  void CHASE(uint8_t R = 255, uint8_t G = 255, uint8_t B = 255);
  void RAINBOW();
  void FADE(uint8_t R = 255, uint8_t G = 255, uint8_t B = 255);
  void SWEEP(uint8_t R = 255, uint8_t G = 255, uint8_t B = 255);
  void TWINKLE();
  void setMotorPWM_Freq(uint16_t freq = 12000);
  void setMotorPower(uint8_t channel, int16_t power);
  void setMotorPowers(int16_t power1 = 0, int16_t power2 = 0, int16_t power3 = 0, int16_t power4 = 0);
  void setMotorSpeed(uint8_t channel, int16_t Mspeed);
  void setMotorSpeeds(int16_t Mspeed1 = 0, int16_t Mspeed2 = 0, int16_t Mspeed3 = 0, int16_t Mspeed4 = 0);
  void setMotorTarget(uint8_t channel, int16_t Mspeed, int32_t Mtarget);
  void setMotorTargets(int16_t Mspeed1 = 0, int32_t Mtarget1 = 0, int16_t Mspeed2 = 0, int32_t Mtarget2 = 0,
                       int16_t Mspeed3 = 0, int32_t Mtarget3 = 0, int16_t Mspeed4 = 0, int32_t Mtarget4 = 0);
  void setMotorDegree(uint8_t channel, int16_t Mspeed, int32_t Mdegrees);
  void setMotorDegrees(int16_t Mspeed1 = 0, int32_t Mdegrees1 = 0, int16_t Mspeed2 = 0, int32_t Mdegrees2 = 0,
                       int16_t Mspeed3 = 0, int32_t Mdegrees3 = 0, int16_t Mspeed4 = 0, int32_t Mdegrees4 = 0);
  void setMotorInvert(uint8_t channel, uint8_t invert);
  void setMotorBrake(uint8_t channel = 0, uint8_t brake = 0);
  uint8_t readMotorBusy(uint8_t channel);
  uint8_t getMotorBusy(uint8_t channel);
  int32_t readEncoderCount(uint8_t channel);
  int32_t getEncoderCount(uint8_t channel);
  int32_t readEncoderDegrees(uint8_t channel);
  int32_t getEncoderDegrees(uint8_t channel);
  void resetEncoder(uint8_t channel);
  void resetEncoders(void);
  void setMotorSpeedPID(uint8_t P, uint8_t I, uint8_t D);
  void setMotorTargetPID(uint8_t P, uint8_t I, uint8_t D);
  uint8_t readLineSensor(uint8_t port);
  uint8_t getLineSensor(uint8_t port);
  uint16_t readSonicSensorCM(uint8_t port);
  uint16_t readSonicSensorIN(uint8_t port);
  double getSonicSensor(uint8_t port = 0, uint8_t = 0);
  uint16_t getSensorAnalog(uint8_t port, uint8_t pin);
  uint8_t getSensorDigital(uint8_t port, uint8_t pin);
  void setSensorDigital(uint8_t port, uint8_t pin, uint8_t level);
  double readBatteryVoltage(void);
  double getBatteryVoltage(void);
  void PrizmBegin(uint8_t I2C_delay = 0);
  void PrizmEnd(void);
  uint8_t readDCFirmware(void);
  uint8_t getDCFirmware(void);
  uint8_t readSVOFirmware(void);
  uint8_t getSVOFirmware(void);
  void setRedLED(uint8_t state = 0);
  void setGreenLED(uint8_t state = 0);
  void setBlueLED(uint8_t state = 0);
  void setStartLED(uint8_t state = 0);
  uint8_t readStartButton(void);
  uint8_t getButton(uint8_t button);
  void enableServos(uint8_t condition);
  void setServoSpeed(uint8_t channel = 0, uint8_t servospeed = 50);
  void setServoSpeeds(uint8_t servospeed1 = 50, uint8_t servospeed2 = 50, uint8_t servospeed3 = 50,
                      uint8_t servospeed4 = 50, uint8_t servospeed5 = 50, uint8_t servospeed6 = 50);
  void setServoPosition(uint8_t channel = 0, uint8_t servoposition = 90);
  void setServoPositions(uint8_t servoposition1 = 90, uint8_t servoposition2 = 90, uint8_t servoposition3 = 90,
                         uint8_t servoposition4 = 90, uint8_t servoposition5 = 90, uint8_t servoposition6 = 90);
  void setCRServoState(uint8_t channel = 0, int16_t state = 0, int8_t trim = 0);
  uint8_t readServoPosition(uint8_t channel = 0);
  uint8_t getServoPosition(uint8_t channel = 0);

 private:
};

class EXPANSION {
 public:
  void WDT_STOP(int address);
  void controllerEnable(int address);
  void controllerReset(int address);
  void setExpID(int newID);
  int readExpID(void);
  int getExpID(void);
  void setMotorPower(int address, int channel, int power);
  void setMotorPowers(int address, int power1, int power2);
  void setMotorSpeed(int address, int channel, long Mspeed);
  void setMotorSpeeds(int address, long Mspeed1, long Mspeed2);
  void setMotorTarget(int address, int channel, long Mspeed, long Mtarget);
  void setMotorTargets(int address, long Mspeed1, long Mtarget1, long Mspeed2, long Mtarget2);
  void setMotorDegree(int address, int channel, long Mspeed, long Mdegrees);
  void setMotorDegrees(int address, long Mspeed1, long Mdegrees1, long Mspeed2, long Mdegrees2);
  void setMotorInvert(int address, int channel, int invert);
  int readMotorBusy(int address, int channel);
  int getMotorBusy(int address, int channel);
  int readMotorCurrent(int address, int channel);
  int getMotorCurrent(int address, int channel);
  int readBatteryVoltage(int address);
  int getBatteryVoltage(int address);
  long readEncoderCount(int address, int channel);
  long getEncoderCount(int address, int channel);
  long readEncoderDegrees(int address, int channel);
  long getEncoderDegrees(int address, int channel);
  void resetEncoder(int address, int channel);
  void resetEncoders(int address);
  void setMotorSpeedPID(int address, int P, int I, int D);
  void setMotorTargetPID(int address, int P, int I, int D);
  int readDCFirmware(int address);
  int getDCFirmware(int address);
  int readSVOFirmware(int address);
  int getSVOFirmware(int address);
  void setServoSpeed(int address, int channel, int servospeed);
  void setServoSpeeds(int address, int servospeed1, int servospeed2, int servospeed3, int servospeed4, int servospeed5, int servospeed6);
  void setServoPosition(int address, int channel, int servoposition);
  void setServoPositions(int address, int servoposition1, int servoposition2, int servoposition3, int servoposition4, int servoposition5, int servoposition6);
  void setCRServoState(int address, int channel, int servospeed);
  int readServoPosition(int address, int channel);
  int getServoPosition(int address, int channel);
};
