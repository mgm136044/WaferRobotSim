#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include "WString.h"

class Print;
class Printable {
 public:
  virtual ~Printable() {}
  virtual size_t printTo(Print &p) const = 0;
};

class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size);
  size_t write(const char *str) { return str ? write((const uint8_t *)str, strlen(str)) : 0; }
  size_t write(const char *buffer, size_t size) { return write((const uint8_t *)buffer, size); }
  virtual int availableForWrite() { return 0; }
  virtual void flush() {}
  int getWriteError() { return 0; }
  void clearWriteError() {}

  size_t printf(const char *format, ...) __attribute__((format(printf, 2, 3)));
  size_t vprintf(const char *format, va_list arg);

  size_t print(const __FlashStringHelper *);
  size_t print(const String &);
  size_t print(const char[]);
  size_t print(char);
  size_t print(unsigned char, int = DEC_BASE);
  size_t print(int, int = DEC_BASE);
  size_t print(unsigned int, int = DEC_BASE);
  size_t print(long, int = DEC_BASE);
  size_t print(unsigned long, int = DEC_BASE);
  size_t print(long long, int = DEC_BASE);
  size_t print(unsigned long long, int = DEC_BASE);
  size_t print(double, int = 2);
  size_t print(const Printable &);
  size_t print(struct tm *timeinfo, const char *format = nullptr);

  size_t println(const __FlashStringHelper *);
  size_t println(const String &s);
  size_t println(const char[]);
  size_t println(char);
  size_t println(unsigned char, int = DEC_BASE);
  size_t println(int, int = DEC_BASE);
  size_t println(unsigned int, int = DEC_BASE);
  size_t println(long, int = DEC_BASE);
  size_t println(unsigned long, int = DEC_BASE);
  size_t println(long long, int = DEC_BASE);
  size_t println(unsigned long long, int = DEC_BASE);
  size_t println(double, int = 2);
  size_t println(const Printable &);
  size_t println(void);

 protected:
  enum { DEC_BASE = 10 };
  size_t printNumber(unsigned long long n, uint8_t base);
  size_t printFloat(double number, uint8_t digits);
};
