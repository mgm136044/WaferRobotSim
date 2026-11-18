// Internal interfaces of the WaferRobotSim runtime (not visible to sketches).
#pragma once
#include <stdint.h>
#include <stddef.h>

#define SIM_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

extern "C" {
// Parameters come from the web UI (robot geometry, drive model, field, inputs...).
SIM_IMPORT(host_param) double host_param(const char *name, int len, double def);
SIM_IMPORT(host_param_str) int host_param_str(const char *name, int len, char *out, int cap);
// Serial console output (port 0 = USB Serial).
SIM_IMPORT(host_serial) void host_serial(int port, double t_ms, const char *p, int len);
// Periodic state snapshot for 3D playback / charts.
SIM_IMPORT(host_frame) void host_frame(const float *p, int n);
// Discrete events (sensor edges, collisions, warnings, unsupported API...).
SIM_IMPORT(host_event) void host_event(int type, double t_ms, double a, double b, double c, const char *p, int len);
// Ends the run (the host throws, unwinding the sketch). Never returns.
SIM_IMPORT(host_end) void host_end(int code, double t_ms, const char *p, int len);
// Called every 100 ms of virtual time; lets the host enforce a wall-clock budget.
SIM_IMPORT(host_tick) int host_tick(double t_ms);
}

namespace sim {

// ---- virtual time -------------------------------------------------------
extern uint64_t now_us;
extern int in_isr;          // >0 while an emulated interrupt handler runs
extern int critical_depth;  // portENTER_CRITICAL nesting
void cost(uint64_t us);     // consume CPU/bus time (advances the world)
void advance_to(uint64_t t_us);
inline double now_ms() { return now_us / 1000.0; }

// ---- parameters / host --------------------------------------------------
double P(const char *name, double def);
int Pstr(const char *name, char *out, int cap);
void event(int type, double a, double b, double c, const char *text);
void eventf(int type, double a, double b, double c, const char *fmt, ...);
[[noreturn]] void end_run(int code, const char *reason);

enum EventType {
  EV_INFO = 0,
  EV_WARN = 1,
  EV_SENSOR = 2,      // a=port b=level c=sensor position mm
  EV_COLLISION = 3,   // a=which end (-1 rear, +1 front) b=impact speed mm/s
  EV_MOTOR_CMD = 4,   // a=channel b=mode c=value
  EV_UNSUPPORTED = 5,
  EV_LED = 6,         // a=pixel index b=packed rgb
  EV_ZLIMIT = 7,
  EV_SDO = 8,         // a=node b=index c=value (debug, off by default)
};

// ---- GPIO ---------------------------------------------------------------
void gpio_init();
int gpio_read(int pin);
void gpio_write(int pin, int level);
void gpio_mode(int pin, int mode);
int gpio_output_level(int pin);
void gpio_input_changed(int pin);  // fire attachInterrupt handlers if needed

// ---- devices: stepped by the world --------------------------------------
void world_init();
void world_step(double dt_s);       // physics substep
void world_frame();                 // emits host_frame
void dc_chip_init();
void servo_chip_init();
void can_init();
void can_step(double dt_s);
void stepper_on_pulse_edge(int level);  // GPIO 6 edges
int stepper_home_level();               // GPIO 9 level
int line_sensor_level(int pin, bool *is_sensor);
int button_level(int pin, bool *is_button);

// accessors used by frames / UI
double can_axis_position(int axis);   // drive units
double can_axis_target(int axis);
double servo_position(int ch);         // 0..180 (PRIZM command scale)
double servo_target(int ch);
double stepper_z_mm();
int dc_chip_write(const uint8_t *d, size_t n);
size_t dc_chip_read(uint8_t *out, size_t n);
int servo_chip_write(const uint8_t *d, size_t n);
size_t servo_chip_read(uint8_t *out, size_t n);
void servo_step(double dt_s);

// ---- I2C ---------------------------------------------------------------
// returns 0 = ACK, 2 = address NACK
int i2c_write(int bus, uint8_t addr, const uint8_t *d, size_t n);
// returns number of bytes delivered (0 if NACK)
size_t i2c_read(int bus, uint8_t addr, uint8_t *out, size_t n);

// ---- UART / console -------------------------------------------------------
void uart_begin(int port, uint32_t baud);
void uart_write(int port, uint8_t b);
int uart_available(int port);
int uart_read(int port);
int uart_peek(int port);
void uart_flush(int port);
uint64_t uart_next_event();
void uart_process(uint64_t t);
void console_write(const uint8_t *d, size_t n);
void console_flush_line();

// ---- gptimer -------------------------------------------------------------
uint64_t timers_next_event();
void timers_process(uint64_t t);

// ---- scheduled inputs ------------------------------------------------------
void inputs_init();
uint64_t inputs_next_event();
void inputs_process(uint64_t t);
bool start_button_pressed();
void inputs_on_start_led(bool on);
bool button_a_pressed();
int console_rx_available();
int console_rx_read();
int console_rx_peek();

// ---- counters for frames -------------------------------------------------
extern uint32_t loop_count;
extern uint32_t sensor_reads;
extern uint32_t i2c_transactions;
extern uint32_t can_frames;

// ---- shared world state used by frames / PRIZM devices ---------------------
struct LedState { uint32_t rgb[3]; bool start_led; };
extern LedState leds;

}  // namespace sim
