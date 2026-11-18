// Compact Arduino String implementation (enough for typical sketch usage).
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>

class __FlashStringHelper;

class String {
 public:
  String(const char *cstr = "") : s_(cstr ? cstr : "") {}
  String(const String &o) = default;
  String(String &&o) = default;
  String(const __FlashStringHelper *str) : s_(reinterpret_cast<const char *>(str)) {}
  explicit String(char c) : s_(1, c) {}
  explicit String(unsigned char v, unsigned char base = 10) { fromUnsigned(v, base); }
  explicit String(int v, unsigned char base = 10) { fromSigned(v, base); }
  explicit String(unsigned int v, unsigned char base = 10) { fromUnsigned(v, base); }
  explicit String(long v, unsigned char base = 10) { fromSigned(v, base); }
  explicit String(unsigned long v, unsigned char base = 10) { fromUnsigned(v, base); }
  explicit String(long long v, unsigned char base = 10) { fromSigned(v, base); }
  explicit String(unsigned long long v, unsigned char base = 10) { fromUnsigned(v, base); }
  explicit String(float v, unsigned int decimals = 2) { fromDouble(v, decimals); }
  explicit String(double v, unsigned int decimals = 2) { fromDouble(v, decimals); }
  String &operator=(const String &o) = default;
  String &operator=(String &&o) = default;
  String &operator=(const char *c) { s_ = c ? c : ""; return *this; }

  unsigned int length() const { return (unsigned int)s_.size(); }
  const char *c_str() const { return s_.c_str(); }
  bool reserve(unsigned int n) { s_.reserve(n); return true; }
  bool isEmpty() const { return s_.empty(); }
  char charAt(unsigned int i) const { return i < s_.size() ? s_[i] : 0; }
  void setCharAt(unsigned int i, char c) { if (i < s_.size()) s_[i] = c; }
  char operator[](unsigned int i) const { return charAt(i); }
  char &operator[](unsigned int i) { static char dummy; return i < s_.size() ? s_[i] : dummy; }

  bool concat(const String &o) { s_ += o.s_; return true; }
  bool concat(const char *c) { if (c) s_ += c; return true; }
  bool concat(char c) { s_ += c; return true; }
  bool concat(unsigned char v) { return concat(String(v)); }
  bool concat(int v) { return concat(String(v)); }
  bool concat(unsigned int v) { return concat(String(v)); }
  bool concat(long v) { return concat(String(v)); }
  bool concat(unsigned long v) { return concat(String(v)); }
  bool concat(long long v) { return concat(String(v)); }
  bool concat(unsigned long long v) { return concat(String(v)); }
  bool concat(float v) { return concat(String(v)); }
  bool concat(double v) { return concat(String(v)); }
  bool concat(const __FlashStringHelper *f) { return concat(reinterpret_cast<const char *>(f)); }
  template <class T> String &operator+=(const T &v) { concat(v); return *this; }

  int compareTo(const String &o) const { return s_.compare(o.s_); }
  bool equals(const String &o) const { return s_ == o.s_; }
  bool equals(const char *c) const { return s_ == (c ? c : ""); }
  bool equalsIgnoreCase(const String &o) const;
  bool startsWith(const String &p) const { return s_.compare(0, p.s_.size(), p.s_) == 0; }
  bool endsWith(const String &p) const {
    return s_.size() >= p.s_.size() && s_.compare(s_.size() - p.s_.size(), p.s_.size(), p.s_) == 0;
  }
  bool operator==(const String &o) const { return equals(o); }
  bool operator==(const char *c) const { return equals(c); }
  bool operator!=(const String &o) const { return !equals(o); }
  bool operator!=(const char *c) const { return !equals(c); }
  bool operator<(const String &o) const { return s_ < o.s_; }
  bool operator>(const String &o) const { return s_ > o.s_; }

  int indexOf(char c, unsigned int from = 0) const { auto p = s_.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(const String &t, unsigned int from = 0) const { auto p = s_.find(t.s_, from); return p == std::string::npos ? -1 : (int)p; }
  int lastIndexOf(char c) const { auto p = s_.rfind(c); return p == std::string::npos ? -1 : (int)p; }
  int lastIndexOf(const String &t) const { auto p = s_.rfind(t.s_); return p == std::string::npos ? -1 : (int)p; }
  String substring(unsigned int from) const { return from >= s_.size() ? String() : String(s_.substr(from).c_str()); }
  String substring(unsigned int from, unsigned int to) const {
    if (from > to) std::swap(from, to);
    if (from >= s_.size()) return String();
    return String(s_.substr(from, to - from).c_str());
  }
  void replace(char a, char b) { for (auto &c : s_) if (c == a) c = b; }
  void replace(const String &a, const String &b);
  void remove(unsigned int index) { if (index < s_.size()) s_.erase(index); }
  void remove(unsigned int index, unsigned int count) { if (index < s_.size()) s_.erase(index, count); }
  void toLowerCase();
  void toUpperCase();
  void trim();
  long toInt() const { return strtol(s_.c_str(), nullptr, 10); }
  float toFloat() const { return (float)strtod(s_.c_str(), nullptr); }
  double toDouble() const { return strtod(s_.c_str(), nullptr); }
  void getBytes(unsigned char *buf, unsigned int n, unsigned int index = 0) const;
  void toCharArray(char *buf, unsigned int n, unsigned int index = 0) const { getBytes((unsigned char *)buf, n, index); }
  const std::string &std() const { return s_; }

 private:
  std::string s_;
  void fromSigned(long long v, unsigned char base);
  void fromUnsigned(unsigned long long v, unsigned char base);
  void fromDouble(double v, unsigned int decimals);
};

inline String operator+(const String &a, const String &b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, const char *b) { String r(a); r.concat(b); return r; }
inline String operator+(const char *a, const String &b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, char b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, int b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, unsigned int b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, long b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, unsigned long b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, float b) { String r(a); r.concat(b); return r; }
inline String operator+(const String &a, double b) { String r(a); r.concat(b); return r; }
