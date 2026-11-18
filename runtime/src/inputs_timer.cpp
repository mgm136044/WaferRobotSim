// Scheduled operator inputs (green start button, black BUTTON_A, serial console
// characters) and the ESP-IDF gptimer emulation.
#include <Arduino.h>
#include <driver/gptimer.h>
#include <string.h>
#include <stdlib.h>
#include <deque>
#include <vector>
#include "sim_internal.h"

namespace sim {

// ================================================================== inputs
struct Press { uint64_t t0, t1; };
static std::vector<Press> start_presses, a_presses;
struct SerialIn { uint64_t t; std::string text; };
static std::vector<SerialIn> serial_script;
static size_t serial_next = 0;
static std::deque<uint8_t> console_rx;

static bool auto_start = true;
static double auto_delay_ms = 300, hold_ms_g = 200;

static void parse_presses(const char *key, std::vector<Press> &out, double def_ms, double hold_ms, bool *auto_flag) {
  // "t1,t2,..." in ms; a negative value disables the button; "auto" = press when the
  // green start LED lights up (i.e. when PrizmBegin() is waiting), like an operator would.
  char buf[256];
  int n = Pstr(key, buf, sizeof buf - 1);
  out.clear();
  if (auto_flag) *auto_flag = false;
  if (n > 0) {
    buf[n] = 0;
    if (strncmp(buf, "auto", 4) == 0) {
      if (auto_flag) *auto_flag = true;
      if (buf[4] == '+') auto_delay_ms = atof(buf + 5);
      return;
    }
  }
  if (n <= 0) {
    if (def_ms >= 0) out.push_back({(uint64_t)(def_ms * 1000), (uint64_t)((def_ms + hold_ms) * 1000)});
    return;
  }
  buf[n] = 0;
  char *p = buf;
  while (*p) {
    char *end;
    double t = strtod(p, &end);
    if (end == p) break;
    if (t >= 0) out.push_back({(uint64_t)(t * 1000), (uint64_t)((t + hold_ms) * 1000)});
    p = end;
    while (*p == ',' || *p == ' ' || *p == ';') p++;
  }
}

void inputs_init() {
  const double hold = P("input.buttonHoldMs", 200);
  hold_ms_g = hold;
  auto_delay_ms = 300;
  parse_presses("input.startPressMs", start_presses, -1, hold, &auto_start);
  if (Pstr("input.startPressMs", nullptr, 0) < 0) auto_start = true;  // not configured -> auto
  parse_presses("input.buttonAPressMs", a_presses, -1, hold, nullptr);
  // serial script: "12000:s;45000:hello\n"
  char buf[1024];
  int n = Pstr("input.serial", buf, sizeof buf - 1);
  serial_script.clear();
  serial_next = 0;
  if (n > 0) {
    buf[n] = 0;
    char *p = buf;
    while (*p) {
      char *end;
      double t = strtod(p, &end);
      if (end == p || *end != ':') break;
      p = end + 1;
      std::string text;
      while (*p && *p != ';') {
        if (*p == '\\' && p[1] == 'n') { text += '\n'; p += 2; continue; }
        text += *p++;
      }
      if (*p == ';') p++;
      serial_script.push_back({(uint64_t)(t * 1000), text});
    }
  }
}

static bool pressed(const std::vector<Press> &v) {
  for (auto &p : v) if (now_us >= p.t0 && now_us < p.t1) return true;
  return false;
}
bool start_button_pressed() { return pressed(start_presses); }
void inputs_on_start_led(bool on) {
  if (!on || !auto_start) return;
  const uint64_t t0 = now_us + (uint64_t)(auto_delay_ms * 1000);
  for (auto &p : start_presses) if (p.t1 > now_us) return;  // a press is already pending
  start_presses.push_back({t0, t0 + (uint64_t)(hold_ms_g * 1000)});
}
bool button_a_pressed() { return pressed(a_presses); }

uint64_t inputs_next_event() {
  uint64_t n = UINT64_MAX;
  if (serial_next < serial_script.size()) n = serial_script[serial_next].t;
  return n;
}
void inputs_process(uint64_t t) {
  while (serial_next < serial_script.size() && serial_script[serial_next].t <= t) {
    for (char c : serial_script[serial_next].text) console_rx.push_back((uint8_t)c);
    eventf(EV_INFO, 0, 0, 0, "serial input: \"%s\"", serial_script[serial_next].text.c_str());
    serial_next++;
  }
}
int console_rx_available() { return (int)console_rx.size(); }
int console_rx_read() {
  if (console_rx.empty()) return -1;
  int c = console_rx.front();
  console_rx.pop_front();
  return c;
}
int console_rx_peek() { return console_rx.empty() ? -1 : console_rx.front(); }

}  // namespace sim

// ================================================================== gptimer
using namespace sim;

struct sim_gptimer {
  uint32_t resolution = 1000000;
  bool enabled = false, running = false;
  uint64_t base_count = 0;     // count value at base_time
  uint64_t base_time = 0;      // us
  bool alarm_armed = false;
  uint64_t alarm_count = 0;
  bool auto_reload = false;
  uint64_t reload_count = 0;
  gptimer_alarm_cb_t cb = nullptr;
  void *user = nullptr;
};
static std::vector<sim_gptimer *> timers;

static uint64_t count_at(const sim_gptimer *t, uint64_t time_us) {
  if (!t->running) return t->base_count;
  return t->base_count + (time_us - t->base_time) * t->resolution / 1000000ULL;
}
static uint64_t alarm_time(const sim_gptimer *t) {
  if (!t->running || !t->alarm_armed || !t->cb) return UINT64_MAX;
  if (t->alarm_count <= t->base_count) return t->base_time;
  const uint64_t ticks = t->alarm_count - t->base_count;
  return t->base_time + (ticks * 1000000ULL + t->resolution - 1) / t->resolution;
}

namespace sim {
uint64_t timers_next_event() {
  uint64_t n = UINT64_MAX;
  for (auto *t : timers) { uint64_t a = alarm_time(t); if (a < n) n = a; }
  return n;
}
void timers_process(uint64_t now) {
  for (auto *t : timers) {
    int guard = 0;
    while (alarm_time(t) <= now && guard++ < 1000) {
      const uint64_t ta = alarm_time(t);
      gptimer_alarm_event_data_t ev;
      ev.alarm_value = t->alarm_count;
      ev.count_value = count_at(t, ta);
      if (t->auto_reload) {
        t->base_count = t->reload_count;  // counter reloads at the alarm instant
        t->base_time = ta;
      } else {
        t->alarm_armed = false;  // one-shot unless re-armed from the callback
      }
      in_isr++;
      t->cb(t, &ev, t->user);
      in_isr--;
    }
  }
}
}  // namespace sim

extern "C" {
esp_err_t gptimer_new_timer(const gptimer_config_t *config, gptimer_handle_t *ret) {
  auto *t = new sim_gptimer();
  t->resolution = config && config->resolution_hz ? config->resolution_hz : 1000000;
  timers.push_back(t);
  *ret = t;
  return ESP_OK;
}
esp_err_t gptimer_del_timer(gptimer_handle_t t) {
  for (size_t i = 0; i < timers.size(); ++i) if (timers[i] == t) { timers.erase(timers.begin() + i); break; }
  delete t;
  return ESP_OK;
}
esp_err_t gptimer_set_raw_count(gptimer_handle_t t, uint64_t value) {
  t->base_count = value;
  t->base_time = now_us;
  return ESP_OK;
}
esp_err_t gptimer_get_raw_count(gptimer_handle_t t, uint64_t *value) {
  *value = count_at(t, now_us);
  return ESP_OK;
}
esp_err_t gptimer_register_event_callbacks(gptimer_handle_t t, const gptimer_event_callbacks_t *cbs, void *user) {
  if (t->enabled) return ESP_ERR_INVALID_STATE;
  t->cb = cbs ? cbs->on_alarm : nullptr;
  t->user = user;
  return ESP_OK;
}
esp_err_t gptimer_set_alarm_action(gptimer_handle_t t, const gptimer_alarm_config_t *config) {
  if (!config) { t->alarm_armed = false; return ESP_OK; }
  t->alarm_count = config->alarm_count;
  t->auto_reload = config->flags.auto_reload_on_alarm;
  t->reload_count = config->reload_count;
  t->alarm_armed = true;
  return ESP_OK;
}
esp_err_t gptimer_enable(gptimer_handle_t t) {
  if (t->enabled) return ESP_ERR_INVALID_STATE;
  t->enabled = true;
  return ESP_OK;
}
esp_err_t gptimer_disable(gptimer_handle_t t) {
  if (!t->enabled || t->running) return ESP_ERR_INVALID_STATE;
  t->enabled = false;
  return ESP_OK;
}
esp_err_t gptimer_start(gptimer_handle_t t) {
  if (!t->enabled || t->running) return ESP_ERR_INVALID_STATE;
  t->base_time = now_us;
  t->running = true;
  return ESP_OK;
}
esp_err_t gptimer_stop(gptimer_handle_t t) {
  if (!t->running) return ESP_ERR_INVALID_STATE;
  t->base_count = count_at(t, now_us);
  t->base_time = now_us;
  t->running = false;
  return ESP_OK;
}
}
