// HardwareSerial ports + UART1 -> Longan Serial-CAN adapter -> two AServo CiA-402 drives.
// Byte timing follows the configured baud rate, so every SDO round trip costs the same
// wall time it does on the robot (~8 ms at 38400 baud).
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include <deque>
#include <vector>
#include <algorithm>
#include "sim_internal.h"

namespace sim {

// ================================================================ AServo drive
struct Drive {
  int node = 1;
  uint16_t cw = 0;
  int8_t mode = 0, mode_req = 0;
  bool fault = false;
  bool enabled = false;
  double pos = 0, vel = 0, acc = 0;  // units, units/s, units/s^2
  double goal = 0;
  bool moving = false;
  bool ack = false;
  bool homing_active = false, homing_attained = false, homed_once = false;
  bool queued = false;
  double queued_goal = 0;
  // object dictionary values
  int32_t target_pos = 0, target_vel = 0;
  uint32_t prof_vel = 100, prof_acc = 1000, prof_dec = 1000, prof_jerk = 0;
  // profile latched at move start (units)
  double mv_vmax = 1, mv_acc = 1, mv_dec = 1, mv_jerk = 0;
  // S-curve = trapezoid position profile smoothed by a moving average of length A/J.
  // Averaging the POSITION keeps the end point exact (the drive's position loop settles
  // on the target) while limiting jerk to A/T.
  double tpos = 0, tvel = 0;           // trapezoid (unfiltered) state
  std::vector<double> ma;              // ring buffer of trapezoid positions (1 ms)
  size_t ma_head = 0, ma_len = 1;
  double ma_sum = 0;
  int still_ticks = 0;
  double tick_acc = 0;
  std::vector<std::pair<uint32_t, int32_t>> extra;  // generic objects written by the sketch
};

static Drive drives[2];
static double units_per_rev = 10000, window_units = 20, homing_rpm = 60;
static double sdo_latency_us = 500, adapter_latency_us = 200, can_frame_us = 250;
static bool debug_sdo = false;

static inline double sgn_of(double x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }
static inline double rpm_to_units(double rpm) { return rpm * units_per_rev / 60.0; }

static void latch_profile(Drive &d) {
  d.mv_vmax = fmax(1.0, rpm_to_units(d.prof_vel));
  d.mv_acc = fmax(1.0, rpm_to_units(d.prof_acc));
  d.mv_dec = fmax(1.0, rpm_to_units(d.prof_dec));
  d.mv_jerk = d.prof_jerk ? rpm_to_units(d.prof_jerk) : 0;
}

static void set_filter(Drive &d) {
  size_t want = 1;
  if (d.mv_jerk > 0) {
    const double T = fmax(d.mv_acc, d.mv_dec) / d.mv_jerk;
    want = (size_t)fmin(3000.0, fmax(1.0, round(T * 1000.0)));
  }
  if (want == d.ma_len && d.ma.size() == want) return;
  // Refill with the current output so the position stays continuous.
  d.ma.assign(want, d.pos);
  d.ma_len = want;
  d.ma_head = 0;
  d.ma_sum = d.pos * (double)want;
}

static void start_move(Drive &d, double goal) {
  latch_profile(d);
  if (!d.moving && !d.homing_active) { d.tpos = d.pos; d.tvel = 0; }
  set_filter(d);
  d.goal = goal;
  d.moving = true;
  d.still_ticks = 0;
}

static void axis_tick(Drive &d, double dt) {
  const bool halt = d.cw & 0x100;
  double target = d.goal;
  bool active = d.moving && !halt;
  if (d.homing_active) { target = 0; active = true; }
  double vdes = 0;
  const double vmax = d.homing_active ? rpm_to_units(homing_rpm) : d.mv_vmax;
  if (d.mode == 3 && !d.homing_active) {
    vdes = halt ? 0 : rpm_to_units(d.target_vel);
  } else if (active) {
    const double dist = target - d.tpos;
    vdes = sgn_of(dist) * fmin(vmax, sqrt(2.0 * d.mv_dec * fabs(dist)));
  }
  const bool speeding_up = fabs(vdes) > fabs(d.tvel) && vdes * d.tvel >= 0;
  const double amax = speeding_up ? d.mv_acc : d.mv_dec;
  double dv = vdes - d.tvel;
  if (dv > amax * dt) dv = amax * dt;
  if (dv < -amax * dt) dv = -amax * dt;
  d.tvel += dv;
  if (active && d.mode != 3) {
    const double rem = target - d.tpos;
    // land exactly on the target instead of oscillating around it
    if (fabs(rem) < 1e-9) d.tvel = 0;
    else if (fabs(d.tvel * dt) >= fabs(rem) && sgn_of(d.tvel) == sgn_of(rem)) d.tvel = rem / dt;
    else if (fabs(rem) < 0.5 * amax * dt * dt + 1e-6) d.tvel = rem / dt;
  }
  d.tpos += d.tvel * dt;
  if (active && d.mode != 3 && fabs(target - d.tpos) < 1e-6) { d.tpos = target; }
  // moving average of the trapezoid position
  d.ma_sum += d.tpos - d.ma[d.ma_head];
  d.ma[d.ma_head] = d.tpos;
  d.ma_head = (d.ma_head + 1) % d.ma_len;
  if (d.ma_head == 0) { double sum = 0; for (double v : d.ma) sum += v; d.ma_sum = sum; }
  const double pnew = d.ma_sum / (double)d.ma_len;
  const double vnew = (pnew - d.pos) / dt;
  d.acc = (vnew - d.vel) / dt;
  d.vel = vnew;
  d.pos = pnew;

  if (fabs(d.tvel) < 1e-12) d.still_ticks++;
  else d.still_ticks = 0;
  const bool settled = d.still_ticks >= (int)d.ma_len;
  if (settled) { d.pos = d.tpos; d.vel = 0; d.acc = 0; }
  if (d.homing_active && d.tpos == 0 && settled) {
    d.pos = 0; d.goal = 0;
    d.homing_active = false; d.homing_attained = true; d.homed_once = true;
  }
  if (d.moving && !halt && d.tpos == d.goal && settled) {
    d.moving = false;
    if (d.queued) { d.queued = false; start_move(d, d.queued_goal); }
  }
  if (halt && settled) d.moving = false;
}

static void axis_step(Drive &d, double dt) {
  if (!d.enabled) { d.vel = d.tvel = 0; d.acc = 0; d.tpos = d.pos; return; }
  d.tick_acc += dt;
  while (d.tick_acc >= 0.001 - 1e-9) {
    d.tick_acc -= 0.001;
    axis_tick(d, 0.001);
  }
}

static uint16_t statusword(const Drive &d) {
  uint16_t sw = 0x0200;  // remote
  if (d.fault) return sw | 0x0008;
  if (d.enabled) sw |= 0x0037;
  else if ((d.cw & 0x07) == 0x07) sw |= 0x0033;
  else if ((d.cw & 0x06) == 0x06) sw |= 0x0031;
  else sw |= 0x0040;
  const bool halt = d.cw & 0x100;
  if (d.mode == 1) {
    if (d.ack) sw |= 0x1000;
    const bool reached = d.enabled && ((halt && fabs(d.vel) < 1e-6) || (!d.moving && fabs(d.goal - d.pos) <= window_units));
    if (reached) sw |= 0x0400;
  } else if (d.mode == 6) {
    if (d.homing_attained) sw |= 0x1000 | 0x0400;
  } else if (d.mode == 3) {
    if (fabs(d.vel - rpm_to_units(d.target_vel)) < rpm_to_units(2)) sw |= 0x0400;
  }
  return sw;
}

static void write_controlword(Drive &d, uint16_t v) {
  const uint16_t prev = d.cw;
  d.cw = v;
  if ((v & 0x80) && !(prev & 0x80)) d.fault = false;
  const bool was = d.enabled;
  d.enabled = !d.fault && (v & 0x0F) == 0x0F;
  if (!d.enabled && was) { d.moving = false; d.vel = 0; d.acc = 0; d.homing_active = false; d.queued = false; }
  if (d.enabled && !was) {
    d.goal = d.tpos = d.pos; d.tvel = d.vel = 0; d.moving = false;
    d.ma.assign(d.ma_len, d.pos); d.ma_sum = d.pos * (double)d.ma_len;
  }
  const bool rise4 = (v & 0x10) && !(prev & 0x10);
  const bool fall4 = !(v & 0x10) && (prev & 0x10);
  if (d.mode == 1) {
    if (rise4 && d.enabled) {
      const double g = (v & 0x40) ? d.goal + d.target_pos : (double)d.target_pos;
      if (d.moving && !(v & 0x20)) { d.queued = true; d.queued_goal = g; }
      else { d.queued = false; start_move(d, g); }
      d.ack = true;
    }
    if (fall4) d.ack = false;
  } else if (d.mode == 6) {
    if (rise4 && d.enabled) {
      latch_profile(d);
      d.tpos = d.pos; d.tvel = 0;
      set_filter(d);
      d.still_ticks = 0;
      d.homing_active = true;
      d.homing_attained = false;
    }
  }
}

static bool lookup_extra(const Drive &d, uint32_t key, int32_t &v) {
  for (auto &e : d.extra) if (e.first == key) { v = e.second; return true; }
  return false;
}

// Returns response payload (8 bytes) for an SDO request.
static void sdo(Drive &d, const uint8_t *rq, uint8_t *rs) {
  const uint8_t ccs = rq[0];
  const uint16_t index = (uint16_t)(rq[1] | (rq[2] << 8));
  const uint8_t sub = rq[3];
  const int32_t val = (int32_t)((uint32_t)rq[4] | ((uint32_t)rq[5] << 8) | ((uint32_t)rq[6] << 16) | ((uint32_t)rq[7] << 24));
  memset(rs, 0, 8);
  rs[1] = rq[1]; rs[2] = rq[2]; rs[3] = sub;
  auto abort_code = [&](uint32_t code) {
    rs[0] = 0x80;
    rs[4] = (uint8_t)code; rs[5] = (uint8_t)(code >> 8); rs[6] = (uint8_t)(code >> 16); rs[7] = (uint8_t)(code >> 24);
  };
  if (ccs == 0x40) {  // upload (read)
    int32_t out = 0;
    uint8_t size = 4;
    switch (index) {
      case 0x6040: out = d.cw; size = 2; break;
      case 0x6041: out = statusword(d); size = 2; break;
      case 0x6060: out = d.mode_req; size = 1; break;
      case 0x6061: out = d.mode; size = 1; break;
      case 0x6064: out = (int32_t)lround(d.pos); break;
      case 0x606C: out = (int32_t)lround(d.vel * 60.0 / units_per_rev); break;
      case 0x607A: out = d.target_pos; break;
      case 0x6081: out = (int32_t)d.prof_vel; break;
      case 0x6083: out = (int32_t)d.prof_acc; break;
      case 0x6084: out = (int32_t)d.prof_dec; break;
      case 0x60A4: out = (int32_t)d.prof_jerk; break;
      case 0x60FF: out = d.target_vel; break;
      case 0x609C: out = d.homed_once ? 1 : 0; size = 1; break;
      default:
        if (!lookup_extra(d, ((uint32_t)index << 8) | sub, out)) { abort_code(0x06020000); return; }
    }
    rs[0] = size == 1 ? 0x4F : (size == 2 ? 0x4B : 0x43);
    rs[4] = (uint8_t)out; rs[5] = (uint8_t)(out >> 8); rs[6] = (uint8_t)(out >> 16); rs[7] = (uint8_t)(out >> 24);
    return;
  }
  if (ccs == 0x22 || ccs == 0x23 || ccs == 0x2B || ccs == 0x2F) {  // download (write)
    switch (index) {
      case 0x6040: write_controlword(d, (uint16_t)val); break;
      case 0x6060:
        d.mode_req = (int8_t)val;
        if (val == 1 || val == 3 || val == 6) {
          d.mode = (int8_t)val;
          d.ack = false;
          if (d.mode != 6) d.homing_active = false;
          d.homing_attained = d.mode == 6 ? false : d.homing_attained;
        }
        break;
      case 0x607A: d.target_pos = val; break;
      case 0x6081: d.prof_vel = (uint32_t)val; break;
      case 0x6083: d.prof_acc = (uint32_t)val; break;
      case 0x6084: d.prof_dec = (uint32_t)val; break;
      case 0x60A4: d.prof_jerk = (uint32_t)val; break;
      case 0x60FF: d.target_vel = val; break;
      default: {
        const uint32_t key = ((uint32_t)index << 8) | sub;
        bool found = false;
        for (auto &e : d.extra) if (e.first == key) { e.second = val; found = true; }
        if (!found) d.extra.push_back({key, val});
      }
    }
    rs[0] = 0x60;
    return;
  }
  abort_code(0x05040001);  // command specifier not valid
}

// ================================================================== UART / CAN
struct Pending { uint64_t t; int kind; uint8_t data[14]; int len; };
enum { K_TX_BYTE = 0, K_CAN_TO_DRIVE = 1, K_CAN_FROM_DRIVE = 2 };
static std::vector<Pending> pending;  // kept sorted by time
static std::deque<std::pair<uint64_t, uint8_t>> rx1;  // UART1 RX (bytes with arrival time)
static uint32_t baud1 = 38400;
static uint64_t tx_free_at = 0;
static uint8_t frame_buf[14];
static int frame_len = 0;
static uint64_t frame_last_byte = 0;
static uint64_t rx_line_free = 0;

static void schedule(const Pending &p) {
  auto it = std::upper_bound(pending.begin(), pending.end(), p.t, [](uint64_t t, const Pending &q) { return t < q.t; });
  pending.insert(it, p);
}
static inline uint64_t byte_us(uint32_t baud) { return (uint64_t)(10e6 / (baud ? baud : 9600) + 0.5); }

void can_init() {
  units_per_rev = P("arm.unitsPerRev", 10000);
  window_units = P("arm.positionWindow", 20);
  homing_rpm = P("arm.homingRpm", 60);
  sdo_latency_us = P("can.sdoLatencyMs", 0.5) * 1000;
  debug_sdo = P("debug.sdo", 0) != 0;
  adapter_latency_us = P("can.adapterLatencyMs", 0.2) * 1000;
  can_frame_us = 1e6 * 130.0 / P("can.bitrate", 500000);
  for (int i = 0; i < 2; ++i) {
    drives[i] = Drive();
    drives[i].node = i + 1;
  }
  drives[0].pos = P("arm.initialJ1", 2500);
  drives[1].pos = P("arm.initialJ2", -4000);
  for (auto &d : drives) {
    d.goal = d.tpos = d.pos; d.mv_dec = rpm_to_units(1000); d.mv_acc = d.mv_dec;
    d.ma.assign(1, d.pos); d.ma_len = 1; d.ma_sum = d.pos;
  }
}

void can_step(double dt) {
  for (auto &d : drives) axis_step(d, dt);
}

double can_axis_position(int axis) { return (axis >= 0 && axis < 2) ? drives[axis].pos : 0; }
double can_axis_target(int axis) { return (axis >= 0 && axis < 2) ? drives[axis].goal : 0; }

uint64_t uart_next_event() { return pending.empty() ? UINT64_MAX : pending.front().t; }

static void adapter_got_byte(uint64_t t, uint8_t b) {
  if (frame_len && t - frame_last_byte > 10000) frame_len = 0;  // stale partial frame
  frame_last_byte = t;
  frame_buf[frame_len++] = b;
  if (frame_len < 14) return;
  frame_len = 0;
  const uint32_t id = ((uint32_t)frame_buf[0] << 24) | ((uint32_t)frame_buf[1] << 16) | ((uint32_t)frame_buf[2] << 8) | frame_buf[3];
  can_frames++;
  for (auto &d : drives) {
    if (id == 0x600u + (uint32_t)d.node) {
      Pending p;
      p.t = t + (uint64_t)(adapter_latency_us + can_frame_us);
      p.kind = K_CAN_TO_DRIVE;
      p.len = 9;
      p.data[0] = (uint8_t)d.node;
      memcpy(p.data + 1, frame_buf + 6, 8);
      schedule(p);
    }
  }
}

void uart_process(uint64_t t) {
  while (!pending.empty() && pending.front().t <= t) {
    Pending p = pending.front();
    pending.erase(pending.begin());
    if (p.kind == K_TX_BYTE) {
      adapter_got_byte(p.t, p.data[0]);
    } else if (p.kind == K_CAN_TO_DRIVE) {
      Drive &d = drives[p.data[0] - 1];
      Pending r;
      r.kind = K_CAN_FROM_DRIVE;
      r.t = p.t + (uint64_t)(sdo_latency_us + can_frame_us);
      r.len = 12;
      const uint32_t rid = 0x580u + (uint32_t)d.node;
      r.data[0] = (uint8_t)(rid >> 24); r.data[1] = (uint8_t)(rid >> 16); r.data[2] = (uint8_t)(rid >> 8); r.data[3] = (uint8_t)rid;
      // The SDO is executed when the request arrives (state at that instant).
      sdo(d, p.data + 1, r.data + 4);
      if (debug_sdo) {
        const uint8_t *q = p.data + 1, *a = r.data + 4;
        const int32_t qv = (int32_t)(q[4] | (q[5] << 8) | (q[6] << 16) | ((uint32_t)q[7] << 24));
        const int32_t av = (int32_t)(a[4] | (a[5] << 8) | (a[6] << 16) | ((uint32_t)a[7] << 24));
        eventf(EV_SDO, d.node, (q[1] | (q[2] << 8)), q[0] == 0x40 ? av : qv, "%s node=%d idx=%04X val=%ld(0x%lX) pos=%.1f goal=%.1f tpos=%.1f vel=%.1f mov=%d",
               q[0] == 0x40 ? "R" : "W", d.node, q[1] | (q[2] << 8), (long)(q[0] == 0x40 ? av : qv),
               (unsigned long)(q[0] == 0x40 ? av : qv), d.pos, d.goal, d.tpos, d.vel, (int)d.moving);
      }
      schedule(r);
    } else if (p.kind == K_CAN_FROM_DRIVE) {
      // adapter forwards the frame to UART1 RX, 12 bytes at the line rate
      uint64_t start = std::max<uint64_t>(p.t + (uint64_t)adapter_latency_us, rx_line_free);
      const uint64_t bu = byte_us(baud1);
      for (int i = 0; i < 12; ++i) rx1.push_back({start + bu * (uint64_t)(i + 1), p.data[i]});
      rx_line_free = start + bu * 12;
    }
  }
}

void uart_begin(int port, uint32_t baud) {
  if (port == 1) baud1 = baud;
}

void uart_write(int port, uint8_t b) {
  if (port != 1) return;
  const uint64_t bu = byte_us(baud1);
  // ESP32 UART TX FIFO is 128 bytes: block if the line is more than 128 bytes behind.
  if (tx_free_at > now_us + bu * 128) advance_to(tx_free_at - bu * 128);
  const uint64_t start = std::max<uint64_t>(now_us, tx_free_at);
  tx_free_at = start + bu;
  Pending p;
  p.t = tx_free_at;
  p.kind = K_TX_BYTE;
  p.len = 1;
  p.data[0] = b;
  schedule(p);
}

int uart_available(int port) {
  if (port != 1) return 0;
  int n = 0;
  for (auto &e : rx1) { if (e.first <= now_us) n++; else break; }
  return n;
}
int uart_read(int port) {
  if (port != 1 || rx1.empty() || rx1.front().first > now_us) return -1;
  uint8_t b = rx1.front().second;
  rx1.pop_front();
  return b;
}
int uart_peek(int port) {
  if (port != 1 || rx1.empty() || rx1.front().first > now_us) return -1;
  return rx1.front().second;
}
void uart_flush(int port) {
  if (port == 1 && tx_free_at > now_us) advance_to(tx_free_at);
}

}  // namespace sim

using namespace sim;

// ============================================================ HardwareSerial
HardwareSerial Serial(0);
HardwareSerial Serial0(0);
HardwareSerial Serial1(1);
HardwareSerial Serial2(2);

HardwareSerial::HardwareSerial(uint8_t uart_nr) : nr_(uart_nr) {}

void HardwareSerial::begin(unsigned long baud, uint32_t, int8_t, int8_t, bool, unsigned long, uint8_t) {
  baud_ = (uint32_t)baud;
  uart_begin(nr_, baud_);
  cost(50);
}
void HardwareSerial::end() {}
int HardwareSerial::available() {
  cost(2);
  return nr_ == 0 ? console_rx_available() : uart_available(nr_);
}
int HardwareSerial::availableForWrite() { return 128; }
int HardwareSerial::peek() {
  cost(1);
  return nr_ == 0 ? console_rx_peek() : uart_peek(nr_);
}
int HardwareSerial::read() {
  cost(2);
  return nr_ == 0 ? console_rx_read() : uart_read(nr_);
}
size_t HardwareSerial::read(uint8_t *buffer, size_t size) {
  size_t n = 0;
  while (n < size) {
    int c = read();
    if (c < 0) break;
    buffer[n++] = (uint8_t)c;
  }
  return n;
}
void HardwareSerial::flush() {
  if (nr_ == 0) { console_flush_line(); return; }
  uart_flush(nr_);
}
size_t HardwareSerial::write(uint8_t c) {
  cost(2);
  if (nr_ == 0) console_write(&c, 1);
  else uart_write(nr_, c);
  return 1;
}
size_t HardwareSerial::write(const uint8_t *buffer, size_t size) {
  if (nr_ == 0) {
    cost(2 + size / 8);  // USB CDC: fast, buffered
    console_write(buffer, size);
    return size;
  }
  for (size_t i = 0; i < size; ++i) write(buffer[i]);
  return size;
}
