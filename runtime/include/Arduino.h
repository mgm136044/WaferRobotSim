// WaferRobotSim - Arduino-ESP32 (core 3.x) compatible API surface.
// The sketch is compiled UNMODIFIED against these headers; every call is routed
// to the virtual hardware in runtime/src (virtual time, I2C/UART/GPIO devices).
#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include <inttypes.h>
#include <math.h>

#ifdef __cplusplus
#include <algorithm>
#include <cmath>
#endif

#include "esp_compat.h"

#define HIGH 0x1
#define LOW 0x0

#define INPUT 0x01
#define OUTPUT 0x03
#define PULLUP 0x04
#define INPUT_PULLUP 0x05
#define PULLDOWN 0x08
#define INPUT_PULLDOWN 0x09
#define OPEN_DRAIN 0x10
#define OUTPUT_OPEN_DRAIN 0x13
#define ANALOG 0xC0

#define DISABLED 0x00
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define ONLOW 0x04
#define ONHIGH 0x05

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define EULER 2.718281828459045235360287471352

#define SERIAL_5N1 0x8000010
#define SERIAL_6N1 0x8000014
#define SERIAL_7N1 0x8000018
#define SERIAL_8N1 0x800001c
#define SERIAL_8N2 0x800003c
#define SERIAL_8E1 0x800001e
#define SERIAL_8O1 0x800001f

#define LSBFIRST 0
#define MSBFIRST 1

#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitToggle(value, bit) ((value) ^= (1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))
#define _BV(b) (1UL << (b))

#define sq(x) ((x) * (x))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define _min(a, b) ((a) < (b) ? (a) : (b))
#define _max(a, b) ((a) > (b) ? (a) : (b))

#define clockCyclesPerMicrosecond() ((long int)240)
#define clockCyclesToMicroseconds(a) ((a) / clockCyclesPerMicrosecond())
#define microsecondsToClockCycles(a) ((a) * clockCyclesPerMicrosecond())

#define interrupts() sim_interrupts_enable(1)
#define noInterrupts() sim_interrupts_enable(0)
#define digitalPinToInterrupt(p) (p)

#define PROGMEM
#define PGM_P const char *
#define PSTR(s) (s)
#define pgm_read_byte(addr) (*(const unsigned char *)(addr))
#define pgm_read_word(addr) (*(const unsigned short *)(addr))
#define pgm_read_dword(addr) (*(const unsigned long *)(addr))
#define pgm_read_float(addr) (*(const float *)(addr))
#define pgm_read_ptr(addr) (*(void *const *)(addr))
#define strlen_P strlen
#define strcpy_P strcpy
#define strncpy_P strncpy
#define strcmp_P strcmp
#define memcpy_P memcpy
#define sprintf_P sprintf
#define snprintf_P snprintf

typedef bool boolean;
typedef uint8_t byte;
typedef unsigned int word;

#ifdef __cplusplus
extern "C" {
#endif
unsigned long millis(void);
unsigned long micros(void);
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield(void);
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
uint16_t analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void analogWrite(uint8_t pin, int value);
void analogReadResolution(uint8_t bits);
void sim_interrupts_enable(int on);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout);
unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout);
void attachInterrupt(uint8_t pin, void (*)(void), int mode);
void attachInterruptArg(uint8_t pin, void (*)(void *), void *arg, int mode);
void detachInterrupt(uint8_t pin);
// LEDC (sound / PWM) - accepted, no physical effect except logging.
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
bool ledcAttachPin(uint8_t pin, uint8_t channel);
bool ledcWrite(uint8_t pin, uint32_t duty);
uint32_t ledcWriteTone(uint8_t pin, uint32_t freq);
bool ledcDetach(uint8_t pin);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration);
void noTone(uint8_t pin);
#ifdef __cplusplus
}
#endif

#ifdef __cplusplus
// Arduino-ESP32 exposes these std helpers globally.
using std::abs;
using std::isinf;
using std::isnan;
using std::max;
using std::min;
using ::round;

long map(long x, long in_min, long in_max, long out_min, long out_max);
long random(long howbig);
long random(long howsmall, long howbig);
void randomSeed(unsigned long seed);
inline void tone(uint8_t pin, unsigned int frequency) { tone(pin, frequency, 0); }
inline unsigned long pulseIn(uint8_t pin, uint8_t state) { return pulseIn(pin, state, 1000000UL); }
uint16_t makeWord(uint16_t w);
uint16_t makeWord(uint8_t h, uint8_t l);
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val);

class __FlashStringHelper;
#define FPSTR(pstr_pointer) (reinterpret_cast<const __FlashStringHelper *>(pstr_pointer))
#define F(string_literal) (FPSTR(PSTR(string_literal)))

#include "WString.h"
#include "Print.h"
#include "Stream.h"
#include "HardwareSerial.h"
#include "Esp.h"

void setup(void);
void loop(void);
#endif
