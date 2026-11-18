// Virtual clock, scheduler, GPIO and the basic Arduino/ESP32 API.
// Time only advances when the sketch calls an API (each call has a realistic cost)
// or explicitly waits (delay). The physics world is stepped on a fixed 100 us grid.
#include <Arduino.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "sim_internal.h"
#include <soc/gpio_struct.h>

namespace sim {

uint64_t now_us = 0;
int in_isr = 0;
int critical_depth = 0;
uint32_t loop_count = 0, sensor_reads = 0, i2c_transactions = 0, can_frames = 0;
LedState leds = {{0, 0, 0}, false};

static const uint64_t PHYS_DT_US = 100;
static uint64_t phys_next = PHYS_DT_US;
static uint64_t frame_next = 0, frame_dt = 5000;
static uint64_t tick_next = 100000;
static uint64_t max_time_us = 330000000ULL;
static bool advancing = false;

// CPU cost model (microseconds per call), tunable from the UI.
static uint32_t COST_MILLIS = 1, COST_GPIO = 1, COST_DELAY0 = 5, COST_LOOP = 3;

double P(const char *name, double def) { return host_param(name, (int)strlen(name), def); }
int Pstr(const char *name, char *out, int cap) { return host_param_str(name, (int)strlen(name), out, cap); }

void event(int type, double a, double b, double c, const char *text) {
  host_event(type, now_ms(), a, b, c, text ? text : "", text ? (int)strlen(text) : 0);
}
void eventf(int type, double a, double b, double c, const char *fmt, ...) {
  char buf[256];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  event(type, a, b, c, buf);
}

bool ending = false;
void end_run(int code, const char *reason) {
  if (ending) { host_end(code, now_ms(), reason, (int)strlen(reason)); __builtin_trap(); }
  ending = true;
  console_flush_line();
  world_frame();
  host_end(code, now_ms(), reason, (int)strlen(reason));
  __builtin_trap();
}

static void process_due() {
  bool any = true;
  while (any) {
    any = false;
    if (critical_depth == 0 && timers_next_event() <= now_us) { timers_process(now_us); any = true; }
    if (uart_next_event() <= now_us) { uart_process(now_us); any = true; }
    if (inputs_next_event() <= now_us) { inputs_process(now_us); any = true; }
    if (phys_next <= now_us) {
      world_step(PHYS_DT_US * 1e-6);
      phys_next += PHYS_DT_US;
      any = true;
      if (now_us >= frame_next) { world_frame(); frame_next += frame_dt; }
      if (now_us >= tick_next) {
        tick_next += 100000;
        console_flush_line();
        if (host_tick(now_ms())) { advancing = false; end_run(2, "stopped by host"); }
      }
      if (now_us >= max_time_us) { advancing = false; end_run(0, "time limit reached"); }
    }
  }
}

void advance_to(uint64_t target) {
  // Nested call from inside device/ISR code: ISR execution time is not modelled.
  if (in_isr || advancing) return;
  advancing = true;
  for (;;) {
    process_due();
    if (now_us >= target) break;
    uint64_t next = target;
    if (phys_next < next) next = phys_next;
    if (critical_depth == 0) { uint64_t t = timers_next_event(); if (t < next) next = t; }
    uint64_t u = uart_next_event(); if (u < next) next = u;
    uint64_t in = inputs_next_event(); if (in < next) next = in;
    if (next > now_us) now_us = next;
  }
  advancing = false;
}

void cost(uint64_t us) {
  if (in_isr) return;
  advance_to(now_us + us);
}

// ---------------------------------------------------------------- GPIO
struct PinState {
  uint8_t mode = 0;  // 0 = never configured
  uint8_t out = 0;
  uint8_t last_in = 0;
  void (*isr)(void) = nullptr;
  void (*isr_arg)(void *) = nullptr;
  void *arg = nullptr;
  int isr_mode = 0;
};
static PinState pins[64];

void gpio_init() {
  for (auto &p : pins) p = PinState();
}

static int external_level(int pin, bool *driven) {
  bool is = false;
  int lv = line_sensor_level(pin, &is);
  if (is) { *driven = true; return lv; }
  lv = button_level(pin, &is);
  if (is) { *driven = true; return lv; }
  if (pin == 9) { *driven = true; return stepper_home_level(); }
  *driven = false;
  return 0;
}

int gpio_read(int pin) {
  if (pin < 0 || pin >= 64) return 0;
  PinState &p = pins[pin];
  if (p.mode == OUTPUT || p.mode == OUTPUT_OPEN_DRAIN) return p.out;
  bool driven = false;
  int lv = external_level(pin, &driven);
  if (driven) return lv;
  if (p.mode == INPUT_PULLUP) return HIGH;
  return LOW;
}

int gpio_output_level(int pin) { return (pin >= 0 && pin < 64) ? pins[pin].out : 0; }

void gpio_write(int pin, int level) {
  if (pin < 0 || pin >= 64) return;
  level = level ? 1 : 0;
  PinState &p = pins[pin];
  int prev = p.out;
  p.out = (uint8_t)level;
  if (pin == 6 && prev != level) stepper_on_pulse_edge(level);
  if (pin == 12 && prev != level) inputs_on_start_led(level);
}

void gpio_mode(int pin, int mode) {
  if (pin < 0 || pin >= 64) return;
  pins[pin].mode = (uint8_t)mode;
  pins[pin].last_in = (uint8_t)gpio_read(pin);
}

void gpio_input_changed(int pin) {
  if (pin < 0 || pin >= 64) return;
  PinState &p = pins[pin];
  int lv = gpio_read(pin);
  int prev = p.last_in;
  p.last_in = (uint8_t)lv;
  if (!(p.isr || p.isr_arg) || lv == prev) return;
  bool fire = (p.isr_mode == CHANGE) || (p.isr_mode == RISING && lv) || (p.isr_mode == FALLING && !lv) ||
              (p.isr_mode == ONLOW && !lv) || (p.isr_mode == ONHIGH && lv);
  if (!fire || critical_depth) return;
  in_isr++;
  if (p.isr) p.isr();
  else p.isr_arg(p.arg);
  in_isr--;
}

void attach_isr(int pin, void (*f)(void), void (*fa)(void *), void *arg, int mode) {
  if (pin < 0 || pin >= 64) return;
  pins[pin].isr = f;
  pins[pin].isr_arg = fa;
  pins[pin].arg = arg;
  pins[pin].isr_mode = mode;
  pins[pin].last_in = (uint8_t)gpio_read(pin);
}

// ------------------------------------------------------------ console out
uint32_t console_bytes = 0;
static char line_buf[512];
static int line_len = 0;
static double line_t = 0;

void console_flush_line() {
  if (line_len) host_serial(0, line_t, line_buf, line_len);
  line_len = 0;
}

void console_write(const uint8_t *d, size_t n) {
  console_bytes += (uint32_t)n;
  for (size_t i = 0; i < n; ++i) {
    if (line_len == 0) line_t = now_ms();
    line_buf[line_len++] = (char)d[i];
    if (d[i] == '\n' || line_len >= (int)sizeof(line_buf)) console_flush_line();
  }
}

static void load_cost_params() {
  COST_MILLIS = (uint32_t)P("cpu.millisUs", 1);
  COST_GPIO = (uint32_t)P("cpu.gpioUs", 1);
  COST_DELAY0 = (uint32_t)P("cpu.yieldUs", 5);
  COST_LOOP = (uint32_t)P("cpu.loopUs", 3);
  frame_dt = (uint64_t)(P("run.frameMs", 5) * 1000);
  if (frame_dt < 1000) frame_dt = 1000;
  max_time_us = (uint64_t)(P("run.maxSeconds", 330) * 1e6);
}

}  // namespace sim

using namespace sim;

// --------------------------------------------------------------- Arduino API
extern "C" {
unsigned long millis(void) { cost(COST_MILLIS); return (unsigned long)(now_us / 1000ULL); }
unsigned long micros(void) { cost(COST_MILLIS); return (unsigned long)now_us; }
void delay(uint32_t ms) {
  if (ms == 0) { cost(COST_DELAY0); return; }
  console_flush_line();
  advance_to(now_us + (uint64_t)ms * 1000ULL);
}
void delayMicroseconds(uint32_t us) { cost(us ? us : 1); }
void yield(void) { cost(COST_DELAY0); }
void pinMode(uint8_t pin, uint8_t mode) { cost(COST_GPIO); gpio_mode(pin, mode); }
void digitalWrite(uint8_t pin, uint8_t val) { cost(COST_GPIO); gpio_write(pin, val); }
int digitalRead(uint8_t pin) {
  cost(COST_GPIO);
  if (pin == 10 || pin == 35) sensor_reads++;
  return gpio_read(pin);
}
uint16_t analogRead(uint8_t pin) { cost(10); return gpio_read(pin) ? 4095 : 0; }
uint32_t analogReadMilliVolts(uint8_t pin) { cost(10); return gpio_read(pin) ? 3300 : 0; }
void analogWrite(uint8_t pin, int value) { cost(COST_GPIO); gpio_write(pin, value > 127); }
void analogReadResolution(uint8_t) {}
void sim_interrupts_enable(int on) {
  if (on) { if (critical_depth > 0) critical_depth--; }
  else critical_depth++;
}
void sim_critical_enter(void) { critical_depth++; }
void sim_critical_exit(void) { if (critical_depth > 0) critical_depth--; }
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  (void)pin; (void)state;
  cost(timeout);
  return 0;
}
unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout) { return pulseIn(pin, state, timeout); }
void attachInterrupt(uint8_t pin, void (*f)(void), int mode) { sim::attach_isr(pin, f, nullptr, nullptr, mode); }
void attachInterruptArg(uint8_t pin, void (*f)(void *), void *arg, int mode) { sim::attach_isr(pin, nullptr, f, arg, mode); }
void detachInterrupt(uint8_t pin) { sim::attach_isr(pin, nullptr, nullptr, nullptr, 0); }
bool ledcAttach(uint8_t, uint32_t, uint8_t) { cost(5); return true; }
bool ledcAttachPin(uint8_t, uint8_t) { cost(5); return true; }
bool ledcWrite(uint8_t, uint32_t) { cost(5); return true; }
uint32_t ledcWriteTone(uint8_t, uint32_t f) { cost(5); return f; }
bool ledcDetach(uint8_t) { return true; }
void tone(uint8_t, unsigned int, unsigned long) { cost(5); }
void noTone(uint8_t) { cost(5); }

void vTaskDelay(TickType_t ticks) { delay(ticks); }
TickType_t xTaskGetTickCount(void) { return (TickType_t)(now_us / 1000ULL); }
void vTaskDelayUntil(TickType_t *prev, TickType_t inc) {
  uint64_t target = (uint64_t)(*prev + inc) * 1000ULL;
  if (target > now_us) advance_to(target);
  *prev += inc;
}
BaseType_t xTaskDelayUntil(TickType_t *prev, TickType_t inc) { vTaskDelayUntil(prev, inc); return pdTRUE; }
BaseType_t xTaskCreate(TaskFunction_t, const char *name, uint32_t, void *, UBaseType_t, TaskHandle_t *h) {
  sim::eventf(EV_UNSUPPORTED, 0, 0, 0, "xTaskCreate(\"%s\"): FreeRTOS tasks are not simulated", name ? name : "");
  if (h) *h = nullptr;
  return pdFAIL;
}
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char *name, uint32_t st, void *arg, UBaseType_t pr,
                                   TaskHandle_t *h, BaseType_t) {
  return xTaskCreate(fn, name, st, arg, pr, h);
}
void vTaskDelete(TaskHandle_t) {}
TaskHandle_t xTaskGetCurrentTaskHandle(void) { return nullptr; }
int64_t esp_timer_get_time(void) { cost(COST_MILLIS); return (int64_t)now_us; }
esp_err_t esp_task_wdt_reset(void) { return ESP_OK; }
esp_err_t esp_task_wdt_add(TaskHandle_t) { return ESP_OK; }
esp_err_t esp_task_wdt_delete(TaskHandle_t) { return ESP_OK; }
void esp_restart(void) { sim::end_run(3, "esp_restart() called"); }
}

long map(long x, long in_min, long in_max, long out_min, long out_max) {
  const long run = in_max - in_min;
  if (run == 0) return out_min;  // Arduino-ESP32 guards division by zero the same way
  const long rise = out_max - out_min;
  const long delta = x - in_min;
  return (delta * rise) / run + out_min;
}
static uint32_t rng_state = 12345;
long random(long howbig) {
  if (howbig <= 0) return 0;
  rng_state = rng_state * 1664525u + 1013904223u;
  return (long)((rng_state >> 1) % (uint32_t)howbig);
}
long random(long howsmall, long howbig) {
  if (howsmall >= howbig) return howsmall;
  return random(howbig - howsmall) + howsmall;
}
void randomSeed(unsigned long seed) { if (seed) rng_state = (uint32_t)seed; }
uint16_t makeWord(uint16_t w) { return w; }
uint16_t makeWord(uint8_t h, uint8_t l) { return (uint16_t)((h << 8) | l); }
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder) {
  uint8_t value = 0;
  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(clockPin, HIGH);
    if (bitOrder == LSBFIRST) value |= digitalRead(dataPin) << i;
    else value |= digitalRead(dataPin) << (7 - i);
    digitalWrite(clockPin, LOW);
  }
  return value;
}
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val) {
  for (uint8_t i = 0; i < 8; i++) {
    if (bitOrder == LSBFIRST) digitalWrite(dataPin, !!(val & (1 << i)));
    else digitalWrite(dataPin, !!(val & (1 << (7 - i))));
    digitalWrite(clockPin, HIGH);
    digitalWrite(clockPin, LOW);
  }
}

EspClass ESP;
void EspClass::restart() { esp_restart(); }
uint32_t EspClass::getCycleCount() { return (uint32_t)(now_us * 240ULL); }
gpio_dev_t GPIO;

extern "C" void sim_gpio_ll_set_level(int pin, int level) { sim::gpio_write(pin, level); }
extern "C" int sim_gpio_ll_get_level(int pin) { return sim::gpio_read(pin); }

// ------------------------------------------------------------------ main
int main() {
  sim::load_cost_params();
  sim::gpio_init();
  sim::inputs_init();
  sim::world_init();
  sim::dc_chip_init();
  sim::servo_chip_init();
  sim::can_init();
  sim::world_frame();
  sim::frame_next = sim::frame_dt;
  setup();
  for (;;) {
    loop();
    sim::loop_count++;
    sim::cost(sim::COST_LOOP);  // Arduino loopTask overhead between iterations
  }
}
