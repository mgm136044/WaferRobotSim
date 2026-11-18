#pragma once
#include "Print.h"

class Stream : public Print {
 public:
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() = 0;
  void setTimeout(unsigned long timeout) { timeout_ = timeout; }
  unsigned long getTimeout(void) { return timeout_; }
  bool find(const char *target);
  bool find(char target) { char t[2] = {target, 0}; return find(t); }
  long parseInt();
  float parseFloat();
  size_t readBytes(char *buffer, size_t length);
  size_t readBytes(uint8_t *buffer, size_t length) { return readBytes((char *)buffer, length); }
  size_t readBytesUntil(char terminator, char *buffer, size_t length);
  String readString();
  String readStringUntil(char terminator);

 protected:
  unsigned long timeout_ = 1000;
  int timedRead();
  int timedPeek();
};
