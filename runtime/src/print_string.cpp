// Print / Stream / String implementations (Arduino semantics).
#include <Arduino.h>
#include <ctype.h>
#include <stdio.h>
#include <string.h>

// ------------------------------------------------------------------ Print
size_t Print::write(const uint8_t *buffer, size_t size) {
  size_t n = 0;
  while (size--) {
    if (write(*buffer++)) n++;
    else break;
  }
  return n;
}

size_t Print::vprintf(const char *format, va_list arg) {
  char loc[256];
  va_list copy;
  va_copy(copy, arg);
  int len = vsnprintf(loc, sizeof loc, format, copy);
  va_end(copy);
  if (len < 0) return 0;
  if ((size_t)len < sizeof loc) return write((const uint8_t *)loc, (size_t)len);
  char *buf = (char *)malloc((size_t)len + 1);
  if (!buf) return 0;
  vsnprintf(buf, (size_t)len + 1, format, arg);
  size_t n = write((const uint8_t *)buf, (size_t)len);
  free(buf);
  return n;
}

size_t Print::printf(const char *format, ...) {
  va_list arg;
  va_start(arg, format);
  size_t n = vprintf(format, arg);
  va_end(arg);
  return n;
}

size_t Print::print(const __FlashStringHelper *ifsh) { return print(reinterpret_cast<const char *>(ifsh)); }
size_t Print::print(const String &s) { return write((const uint8_t *)s.c_str(), s.length()); }
size_t Print::print(const char str[]) { return write(str); }
size_t Print::print(char c) { return write((uint8_t)c); }
size_t Print::print(unsigned char b, int base) { return print((unsigned long)b, base); }
size_t Print::print(int n, int base) { return print((long)n, base); }
size_t Print::print(unsigned int n, int base) { return print((unsigned long)n, base); }
size_t Print::print(long n, int base) { return print((long long)n, base); }
size_t Print::print(unsigned long n, int base) { return print((unsigned long long)n, base); }
size_t Print::print(long long n, int base) {
  if (base == 0) return write((uint8_t)n);
  if (base == 10 && n < 0) {
    size_t t = print('-');
    return printNumber((unsigned long long)(-(n + 1)) + 1ULL, 10) + t;
  }
  return printNumber((unsigned long long)n, (uint8_t)base);
}
size_t Print::print(unsigned long long n, int base) {
  if (base == 0) return write((uint8_t)n);
  return printNumber(n, (uint8_t)base);
}
size_t Print::print(double n, int digits) { return printFloat(n, (uint8_t)digits); }
size_t Print::print(const Printable &x) { return x.printTo(*this); }
size_t Print::print(struct tm *, const char *) { return 0; }

size_t Print::println(void) { return print("\r\n"); }
size_t Print::println(const __FlashStringHelper *ifsh) { size_t n = print(ifsh); return n + println(); }
size_t Print::println(const String &s) { size_t n = print(s); return n + println(); }
size_t Print::println(const char c[]) { size_t n = print(c); return n + println(); }
size_t Print::println(char c) { size_t n = print(c); return n + println(); }
size_t Print::println(unsigned char b, int base) { size_t n = print(b, base); return n + println(); }
size_t Print::println(int num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(unsigned int num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(long num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(unsigned long num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(long long num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(unsigned long long num, int base) { size_t n = print(num, base); return n + println(); }
size_t Print::println(double num, int digits) { size_t n = print(num, digits); return n + println(); }
size_t Print::println(const Printable &x) { size_t n = print(x); return n + println(); }

size_t Print::printNumber(unsigned long long n, uint8_t base) {
  char buf[8 * sizeof(n) + 1];
  char *str = &buf[sizeof(buf) - 1];
  *str = '\0';
  if (base < 2) base = 10;
  do {
    unsigned long long m = n;
    n /= base;
    char c = (char)(m - base * n);
    *--str = c < 10 ? c + '0' : c + 'A' - 10;
  } while (n);
  return write(str);
}

size_t Print::printFloat(double number, uint8_t digits) {
  size_t n = 0;
  if (isnan(number)) return print("nan");
  if (isinf(number)) return print("inf");
  if (number > 4294967040.0) return print("ovf");
  if (number < -4294967040.0) return print("ovf");
  if (number < 0.0) {
    n += print('-');
    number = -number;
  }
  double rounding = 0.5;
  for (uint8_t i = 0; i < digits; ++i) rounding /= 10.0;
  number += rounding;
  unsigned long int_part = (unsigned long)number;
  double remainder = number - (double)int_part;
  n += print(int_part);
  if (digits > 0) n += print(".");
  while (digits-- > 0) {
    remainder *= 10.0;
    int toPrint = int(remainder);
    n += print(toPrint);
    remainder -= toPrint;
  }
  return n;
}

// ------------------------------------------------------------------ Stream
int Stream::timedRead() {
  unsigned long start = millis();
  do {
    int c = read();
    if (c >= 0) return c;
    delay(1);
  } while (millis() - start < timeout_);
  return -1;
}
int Stream::timedPeek() {
  unsigned long start = millis();
  do {
    int c = peek();
    if (c >= 0) return c;
    delay(1);
  } while (millis() - start < timeout_);
  return -1;
}
bool Stream::find(const char *target) {
  size_t len = strlen(target), idx = 0;
  if (!len) return true;
  for (;;) {
    int c = timedRead();
    if (c < 0) return false;
    if (c == target[idx]) {
      if (++idx >= len) return true;
    } else idx = (c == target[0]) ? 1 : 0;
  }
}
long Stream::parseInt() {
  int c;
  do { c = timedPeek(); if (c < 0) return 0; if (c == '-' || isdigit(c)) break; read(); } while (true);
  bool neg = false;
  long value = 0;
  if (c == '-') { neg = true; read(); }
  while ((c = timedPeek()) >= 0 && isdigit(c)) { value = value * 10 + (c - '0'); read(); }
  return neg ? -value : value;
}
float Stream::parseFloat() {
  String s;
  int c;
  do { c = timedPeek(); if (c < 0) return 0; if (c == '-' || c == '.' || isdigit(c)) break; read(); } while (true);
  while ((c = timedPeek()) >= 0 && (c == '-' || c == '.' || isdigit(c))) { s += (char)c; read(); }
  return s.toFloat();
}
size_t Stream::readBytes(char *buffer, size_t length) {
  size_t count = 0;
  while (count < length) {
    int c = timedRead();
    if (c < 0) break;
    *buffer++ = (char)c;
    count++;
  }
  return count;
}
size_t Stream::readBytesUntil(char terminator, char *buffer, size_t length) {
  size_t index = 0;
  while (index < length) {
    int c = timedRead();
    if (c < 0 || c == terminator) break;
    *buffer++ = (char)c;
    index++;
  }
  return index;
}
String Stream::readString() {
  String ret;
  int c = timedRead();
  while (c >= 0) { ret += (char)c; c = timedRead(); }
  return ret;
}
String Stream::readStringUntil(char terminator) {
  String ret;
  int c = timedRead();
  while (c >= 0 && c != terminator) { ret += (char)c; c = timedRead(); }
  return ret;
}

// ------------------------------------------------------------------ String
void String::fromSigned(long long v, unsigned char base) {
  if (base == 10) { char b[32]; snprintf(b, sizeof b, "%lld", v); s_ = b; return; }
  fromUnsigned((unsigned long long)v, base);
}
void String::fromUnsigned(unsigned long long v, unsigned char base) {
  if (base < 2) base = 10;
  char buf[70];
  char *p = &buf[sizeof buf - 1];
  *p = 0;
  do { int d = (int)(v % base); *--p = (char)(d < 10 ? '0' + d : 'a' + d - 10); v /= base; } while (v);
  s_ = p;
}
void String::fromDouble(double v, unsigned int decimals) {
  char b[64];
  snprintf(b, sizeof b, "%.*f", (int)decimals, v);
  s_ = b;
}
bool String::equalsIgnoreCase(const String &o) const {
  if (s_.size() != o.s_.size()) return false;
  for (size_t i = 0; i < s_.size(); ++i)
    if (tolower((unsigned char)s_[i]) != tolower((unsigned char)o.s_[i])) return false;
  return true;
}
void String::replace(const String &a, const String &b) {
  if (a.s_.empty()) return;
  size_t pos = 0;
  while ((pos = s_.find(a.s_, pos)) != std::string::npos) { s_.replace(pos, a.s_.size(), b.s_); pos += b.s_.size(); }
}
void String::toLowerCase() { for (auto &c : s_) c = (char)tolower((unsigned char)c); }
void String::toUpperCase() { for (auto &c : s_) c = (char)toupper((unsigned char)c); }
void String::trim() {
  size_t a = 0, b = s_.size();
  while (a < b && isspace((unsigned char)s_[a])) a++;
  while (b > a && isspace((unsigned char)s_[b - 1])) b--;
  s_ = s_.substr(a, b - a);
}
void String::getBytes(unsigned char *buf, unsigned int n, unsigned int index) const {
  if (!n || !buf) return;
  if (index >= s_.size()) { buf[0] = 0; return; }
  unsigned int len = (unsigned int)s_.size() - index;
  if (len > n - 1) len = n - 1;
  memcpy(buf, s_.data() + index, len);
  buf[len] = 0;
}
