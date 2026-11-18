// TwoWire (Arduino-ESP32 3.x) on top of the virtual I2C buses.
#include <Wire.h>
#include "sim_internal.h"

namespace sim {

static uint8_t mux_mask = 0;
static bool warned[2][128];
static void warn_missing(int bus, uint8_t addr) {
  if (addr >= 1 && addr <= 4) return;  // PRIZM probes EXPANSION boxes 1..4 on purpose
  if (warned[bus & 1][addr & 127]) return;
  warned[bus & 1][addr & 127] = true;
  eventf(EV_UNSUPPORTED, bus, addr, 0, "I2C %s address 0x%02X: no simulated device (NACK). Sensors such as ToF/colour are not modelled",
         bus ? "Wire1" : "Wire", addr);
}

static int debug_i2c = -1;
static void log_i2c(char kind, int bus, uint8_t addr, const uint8_t *d, size_t n) {
  if (debug_i2c < 0) debug_i2c = P("debug.i2c", 0) != 0;
  if (!debug_i2c) return;
  char buf[200];
  int k = snprintf(buf, sizeof buf, "%c%d@%02X:", kind, bus, addr);
  for (size_t i = 0; i < n && k < (int)sizeof buf - 4; ++i) k += snprintf(buf + k, sizeof buf - k, "%02X", d[i]);
  event(9, bus, addr, (double)n, buf);
}

int i2c_write(int bus, uint8_t addr, const uint8_t *d, size_t n) {
  i2c_transactions++;
  log_i2c('W', bus, addr, d, n);
  if (bus == 1) {
    if (addr == 5) return dc_chip_write(d, n);
    if (addr == 6) return servo_chip_write(d, n);
    warn_missing(bus, addr);
    return 2;
  }
  // bus 0: Grove 8-channel hub (TCA9548A) at 0x70..0x77
  if (addr >= 0x70 && addr <= 0x77) {
    if (n) mux_mask = d[n - 1];
    return 0;
  }
  warn_missing(bus, addr);
  return 2;
}

size_t i2c_read(int bus, uint8_t addr, uint8_t *out, size_t n) {
  i2c_transactions++;
  log_i2c('R', bus, addr, nullptr, n);
  if (bus == 1) {
    if (addr == 5) return dc_chip_read(out, n);
    if (addr == 6) return servo_chip_read(out, n);
    warn_missing(bus, addr);
    return 0;
  }
  if (addr >= 0x70 && addr <= 0x77) {
    for (size_t i = 0; i < n; ++i) out[i] = mux_mask;
    return n;
  }
  warn_missing(bus, addr);
  return 0;
}

}  // namespace sim

using namespace sim;

TwoWire Wire(0);
TwoWire Wire1(1);

TwoWire::TwoWire(uint8_t bus_num) : num_(bus_num) {}

bool TwoWire::begin(int sda, int scl, uint32_t frequency) {
  (void)sda; (void)scl;
  if (frequency) clock_ = frequency;
  cost(20);
  return true;
}
bool TwoWire::end() { return true; }
bool TwoWire::setClock(uint32_t frequency) { if (frequency) clock_ = frequency; return true; }

static uint64_t bus_time_us(uint32_t clock, size_t bytes) {
  // start + address + bytes, 9 clocks per byte, plus ~35 us ESP-IDF driver overhead
  const double bit_us = 1e6 / (clock ? clock : 100000);
  return (uint64_t)(35.0 + (bytes + 1) * 9.0 * bit_us);
}

void TwoWire::beginTransmission(uint8_t address) {
  tx_address_ = address;
  tx_len_ = 0;
  transmitting_ = true;
}

uint8_t TwoWire::endTransmission(bool sendStop) {
  (void)sendStop;
  if (!transmitting_) return 4;
  transmitting_ = false;
  cost(bus_time_us(clock_, tx_len_));
  return (uint8_t)i2c_write(num_, (uint8_t)tx_address_, tx_buf_, tx_len_);
}

size_t TwoWire::requestFrom(uint8_t address, size_t len, bool stopBit) {
  (void)stopBit;
  if (len > I2C_BUFFER_LENGTH) len = I2C_BUFFER_LENGTH;
  cost(bus_time_us(clock_, len));
  rx_idx_ = 0;
  rx_len_ = i2c_read(num_, address, rx_buf_, len);
  return rx_len_;
}

size_t TwoWire::write(uint8_t data) {
  if (!transmitting_ || tx_len_ >= I2C_BUFFER_LENGTH) return 0;
  tx_buf_[tx_len_++] = data;
  return 1;
}
size_t TwoWire::write(const uint8_t *data, size_t quantity) {
  size_t n = 0;
  for (size_t i = 0; i < quantity; ++i) n += write(data[i]);
  return n;
}
int TwoWire::available() { return (int)(rx_len_ - rx_idx_); }
int TwoWire::read() { return rx_idx_ < rx_len_ ? rx_buf_[rx_idx_++] : -1; }
int TwoWire::peek() { return rx_idx_ < rx_len_ ? rx_buf_[rx_idx_] : -1; }
void TwoWire::flush() { rx_idx_ = rx_len_ = 0; tx_len_ = 0; }
