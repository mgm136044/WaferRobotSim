// Arduino-ESP32 TwoWire. Bus 0 = "Wire" (PRIZM sensor port bus, 100 kHz default),
// bus 1 = "Wire1" (internal PRIZM DC-motor chip @0x05 and servo chip @0x06).
// Transactions cost virtual time like a real I2C bus and reach virtual devices.
#pragma once
#include "Arduino.h"

#define I2C_BUFFER_LENGTH 128

class TwoWire : public Stream {
 public:
  explicit TwoWire(uint8_t bus_num);
  bool begin(int sda, int scl, uint32_t frequency = 0);
  bool begin(uint8_t slaveAddr, int sda, int scl, uint32_t frequency) { (void)slaveAddr; return begin(sda, scl, frequency); }
  bool begin() { return begin(-1, -1, 0); }
  bool end();
  bool setPins(int sda, int scl) { (void)sda; (void)scl; return true; }
  bool setClock(uint32_t frequency);
  uint32_t getClock() { return clock_; }
  void setTimeOut(uint16_t timeOutMillis) { timeout_ms_ = timeOutMillis; }
  uint16_t getTimeOut() { return timeout_ms_; }
  size_t setBufferSize(size_t bSize) { return bSize; }

  // Same overload set as Arduino-ESP32 3.x (TwoWire : HardwareI2C)
  void beginTransmission(uint8_t address);
  uint8_t endTransmission(bool sendStop);
  uint8_t endTransmission(void) { return endTransmission(true); }
  size_t requestFrom(uint8_t address, size_t len, bool stopBit);
  size_t requestFrom(uint8_t address, size_t len) { return requestFrom(address, len, true); }

  size_t write(uint8_t) override;
  size_t write(const uint8_t *data, size_t quantity) override;
  int available() override;
  int read() override;
  int peek() override;
  void flush() override;
  inline size_t write(const char *s) { return write((uint8_t *)s, strlen(s)); }
  inline size_t write(unsigned long n) { return write((uint8_t)n); }
  inline size_t write(long n) { return write((uint8_t)n); }
  inline size_t write(unsigned int n) { return write((uint8_t)n); }
  inline size_t write(int n) { return write((uint8_t)n); }

  void onReceive(void (*)(int)) {}
  void onRequest(void (*)(void)) {}

 private:
  uint8_t num_;
  uint32_t clock_ = 100000;
  uint16_t timeout_ms_ = 50;
  uint16_t tx_address_ = 0;
  bool transmitting_ = false;
  uint8_t tx_buf_[I2C_BUFFER_LENGTH];
  size_t tx_len_ = 0;
  uint8_t rx_buf_[I2C_BUFFER_LENGTH];
  size_t rx_len_ = 0, rx_idx_ = 0;
};

extern TwoWire Wire;
extern TwoWire Wire1;
