// HardwareSerial: port 0 = USB console (Serial), port 1 = UART1 wired to the
// virtual Longan Serial-CAN adapter (AServo drives), port 2 = unconnected UART.
#pragma once
#include "Stream.h"

class HardwareSerial : public Stream {
 public:
  explicit HardwareSerial(uint8_t uart_nr);
  void begin(unsigned long baud, uint32_t config = 0x800001c, int8_t rxPin = -1, int8_t txPin = -1,
             bool invert = false, unsigned long timeout_ms = 20000UL, uint8_t rxfifo_full_thrhd = 112);
  void end();
  int available() override;
  int availableForWrite() override;
  int peek() override;
  int read() override;
  size_t read(uint8_t *buffer, size_t size);
  size_t read(char *buffer, size_t size) { return read((uint8_t *)buffer, size); }
  void flush() override;
  void flush(bool txOnly) { (void)txOnly; flush(); }
  size_t write(uint8_t) override;
  size_t write(const uint8_t *buffer, size_t size) override;
  using Print::write;
  inline size_t write(unsigned long n) { return write((uint8_t)n); }
  inline size_t write(long n) { return write((uint8_t)n); }
  inline size_t write(unsigned int n) { return write((uint8_t)n); }
  inline size_t write(int n) { return write((uint8_t)n); }
  uint32_t baudRate() { return baud_; }
  void updateBaudRate(unsigned long baud) { baud_ = baud; }
  operator bool() const { return true; }
  size_t setRxBufferSize(size_t n) { return n; }
  size_t setTxBufferSize(size_t n) { return n; }
  void setRxTimeout(uint8_t) {}
  void setDebugOutput(bool) {}
  void setPins(int8_t, int8_t, int8_t = -1, int8_t = -1) {}
  uint8_t port() const { return nr_; }

 private:
  uint8_t nr_;
  uint32_t baud_ = 115200;
};

extern HardwareSerial Serial;
extern HardwareSerial Serial0;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
