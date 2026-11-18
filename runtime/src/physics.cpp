// Physical world: PRIZM DC-motor chip (I2C 0x05) + TorqueNADO motors + chassis guided
// by ONE centre rail (planar x / y / yaw rigid body: two driven wheels with a friction
// circle, a passive axle, guide rollers at both axles that touch the rail when the robot
// drifts sideways), line sensors, Z stepper, PRIZM servo chip (I2C 0x06), buttons, LEDs.
// Units: lengths in mm in parameters, SI inside the integrator.
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include "sim_internal.h"

namespace sim {

// ======================================================================= params
struct Params {
  // drive train / motor (TorqueNADO 44260, 60:1, values at motor.nominalV)
  double mm_per_rev;        // chassis travel per motor output revolution (wheel + gears)
  double vbatt, vnom;
  double stall_torque, stall_current, noload_rpm, noload_current;
  double rotor_J;           // reflected inertia at gearbox output, kg m^2
  double current_limit;
  // PRIZM speed loop behaviour (measured: command 100 deg/s -> ~76.5 deg/s)
  double speed_ratio, speed_lag_s, speed_dead_s, inner_kp;
  double target_tolerance_counts;
  // chassis (s = position along the robot from the MOTOR axle, forward +; l = left +)
  double mass, yaw_inertia, drive_frac, mu, tire_k, roll_force, roll_visc, passive_grip;
  double length_mm, rear_overhang_mm;
  double passive_s, front_axle_s, rear_axle_s, track, right_scale, width_mm, cg_s, work_half_w;
  int m1_sign, m2_sign;
  // centre rail
  int rail_on;
  double rail_clear, rail_k, rail_c, rail_mu;
  // field
  int line_count;
  double line_center[16], line_width;
  double track_len_mm;
  // sensors
  int sensor_count;
  int sensor_port[6];
  double sensor_offset[6];
  double sensor_margin, sensor_latency_s, sensor_l_mm;
  int black_level;
  // start
  double start_axle_mm;
  // Z
  double z_initial, z_top_stop, z_bottom_stop, z_home_at, z_pulses_per_mm;
  // servo
  double servo_rate_100, servo_rate_max;
};
static Params prm;

// ======================================================================= state
enum { MODE_COAST = 0, MODE_POWER = 1, MODE_BRAKE = 2, MODE_SPEED = 3, MODE_TARGET = 4 };

struct DeadQueue {
  uint64_t t[64];
  double v[64];
  int head = 0, count = 0;
  double base = 0;
  void reset(double b) { head = count = 0; base = b; }
  void push(uint64_t tt, double vv) {
    if (count == 64) { base = v[head]; head = (head + 1) % 64; count--; }
    int idx = (head + count) % 64;
    t[idx] = tt; v[idx] = vv; count++;
  }
  double at(uint64_t tt) {
    while (count && t[head] <= tt) { base = v[head]; head = (head + 1) % 64; count--; }
    return base;
  }
};

struct Motor {
  int mode = MODE_COAST;
  int invert = 0;
  double power = 0;          // logical -100..100
  double speed_cmd = 0;      // logical deg/s
  double target_counts = 0;  // logical counts (TARGET mode)
  double target_speed = 0;   // deg/s magnitude
  bool busy = false;
  DeadQueue dq;
  double ref = 0;            // logical rad/s reference after dead time + lag
  double omega = 0;          // physical rad/s of output shaft
  double theta = 0;          // physical rad
  double enc_zero = 0;       // logical counts at last reset
  double duty = 0, current = 0;
  double J = 0.004;
  bool driven = false;       // coupled to chassis
  int sign = 1;              // + : positive physical shaft speed moves robot forward
};

static Motor motors[4];
static bool dc_enabled = false;
static uint8_t dc_read_reg = 0;
static double R_ohm, Kt, Ke, tau_f;

// motor-axle centre (reference point): x along the track (m), y sideways from the rail centre
// line (m, left +), psi yaw (rad, CCW seen from above); its world velocity (v_ms, vy_ms).
// The rigid body is integrated at its centre of mass (s = cg_s on the robot axis): world
// velocity (vcx, vcy) and yaw rate r_yaw.
static double x_m = 0, v_ms = 0, y_m = 0, vy_ms = 0, psi = 0, r_yaw = 0, vcx = 0, vcy = 0;
static bool lateral_reported = false, offrail_reported = false;
static double rail_force = 0, guide_off[2] = {0, 0};
static double slip[2] = {0, 0};
static int collision = 0;
static bool rail_overload_reported = false;
static int sensor_level_cache[6];
static bool sensor_black_cache[6];

static double z_steps = 0;
static int z_limit_flag = 0;

static inline double sgn(double x) { return x > 0 ? 1.0 : (x < 0 ? -1.0 : 0.0); }

static void load_params() {
  prm.mm_per_rev = P("geom.mmPerRev", M_PI * 103.0 / 2.0);
  prm.vbatt = P("motor.batteryV", 12.6);
  prm.vnom = P("motor.nominalV", 12.0);
  prm.stall_torque = P("motor.stallTorqueNm", 4.94);
  prm.stall_current = P("motor.stallCurrentA", 8.7);
  prm.noload_rpm = P("motor.noLoadRpm", 100);
  prm.noload_current = P("motor.noLoadCurrentA", 0.3);
  prm.rotor_J = P("motor.reflectedInertia", 0.004);
  prm.current_limit = P("motor.currentLimitA", 20);
  prm.speed_ratio = P("prizm.speedRatio", 0.77);
  prm.speed_lag_s = P("prizm.speedLagMs", 60) / 1000.0;
  prm.speed_dead_s = P("prizm.speedDeadMs", 110) / 1000.0;
  prm.inner_kp = P("prizm.innerKp", 0.3);
  prm.target_tolerance_counts = P("prizm.targetToleranceCounts", 10);
  prm.mass = P("robot.massKg", 6.0);
  prm.yaw_inertia = P("robot.yawInertia", 0.2);
  prm.drive_frac = P("robot.driveWeightFrac", 0.55);
  prm.passive_grip = P("robot.passiveLateralGrip", 0.05);
  prm.mu = P("robot.tireMu", 0.7);
  prm.tire_k = P("robot.tireStiffness", 15000);
  prm.roll_force = P("robot.rollResistN", 2.0);
  prm.roll_visc = P("robot.rollViscous", 5.0);
  prm.length_mm = P("robot.lengthMm", 480);
  prm.rear_overhang_mm = P("robot.rearOverhangMm", 270);
  prm.passive_s = P("geom.passiveAxleS", -224) / 1000.0;
  prm.front_axle_s = P("geom.frontAxleS", 0) / 1000.0;
  prm.rear_axle_s = P("geom.rearAxleS", -224) / 1000.0;
  prm.track = P("robot.trackMm", 320) / 1000.0;
  prm.width_mm = P("robot.widthMm", 400);
  prm.cg_s = P("geom.cgS", -100.8) / 1000.0;
  prm.work_half_w = P("field.workWidthMm", 900) / 2.0;
  prm.right_scale = P("drive.rightWheelScale", 1.0);
  prm.rail_on = P("rail.enabled", 1) != 0;
  prm.rail_clear = P("rail.clearanceMm", 1.0) / 1000.0;
  prm.rail_k = P("rail.stiffnessNmm", 200) * 1000.0;
  prm.rail_c = P("rail.dampingNsm", 1000);
  prm.rail_mu = P("rail.rollerFriction", 0.02);
  prm.m1_sign = P("robot.motor1Forward", 1) >= 0 ? 1 : -1;
  prm.m2_sign = P("robot.motor2Forward", -1) >= 0 ? 1 : -1;

  prm.line_count = (int)P("field.lineCount", 5);
  if (prm.line_count < 1) prm.line_count = 1;
  if (prm.line_count > 16) prm.line_count = 16;
  prm.line_width = P("field.lineWidthMm", 10);
  double first = P("field.firstGapMm", 163), gap = P("field.gapMm", 360), last = P("field.lastGapMm", 163);
  for (int i = 0; i < prm.line_count; ++i)
    prm.line_center[i] = first + prm.line_width * 0.5 + i * (gap + prm.line_width);
  prm.track_len_mm = first + prm.line_count * prm.line_width + (prm.line_count - 1) * gap + last;

  prm.sensor_count = (int)P("sensor.count", 2);
  if (prm.sensor_count > 6) prm.sensor_count = 6;
  const char *pk[6] = {"sensor.0.port", "sensor.1.port", "sensor.2.port", "sensor.3.port", "sensor.4.port", "sensor.5.port"};
  const char *ok[6] = {"geom.sensor.0.s", "geom.sensor.1.s", "geom.sensor.2.s", "geom.sensor.3.s", "geom.sensor.4.s", "geom.sensor.5.s"};
  const int defport[6] = {4, 5, 1, 2, 3, 6};
  const double defoff[6] = {65, -139, 0, 0, 0, 0};
  for (int i = 0; i < prm.sensor_count; ++i) {
    prm.sensor_port[i] = (int)P(pk[i], defport[i]);
    prm.sensor_offset[i] = P(ok[i], defoff[i]);
  }
  prm.sensor_margin = P("sensor.marginMm", 0);
  prm.sensor_latency_s = P("sensor.latencyMs", 0.3) / 1000.0;
  prm.sensor_l_mm = P("sensor.lateralMm", 50);
  prm.black_level = P("sensor.blackLevel", 1) ? 1 : 0;
  prm.start_axle_mm = P("geom.startAxleMm", 270);

  prm.z_initial = P("z.initialMm", -30);
  prm.z_top_stop = P("z.topStopMm", 3);
  prm.z_bottom_stop = P("z.bottomStopMm", -420);
  prm.z_home_at = P("z.homeSwitchMm", 0);
  prm.z_pulses_per_mm = P("z.pulsesPerMm", 200);
  prm.servo_rate_100 = P("servo.rateAt100", 200);
  prm.servo_rate_max = P("servo.maxRate", 240);

  // DC motor constants at the gearbox output
  R_ohm = prm.vnom / prm.stall_current;
  Kt = prm.stall_torque / prm.stall_current;
  const double w_nl = prm.noload_rpm * 2 * M_PI / 60.0;
  Ke = (prm.vnom - prm.noload_current * R_ohm) / w_nl;
  tau_f = Kt * prm.noload_current;
}

static inline double r_eff() { return prm.mm_per_rev / 1000.0 / (2 * M_PI); }  // m per rad
static inline double logical_omega(const Motor &m) { return m.invert ? -m.omega : m.omega; }
static inline double logical_counts(const Motor &m) {
  double th = m.invert ? -m.theta : m.theta;
  return th * (1440.0 / (2 * M_PI));
}
static int32_t encoder_counts(int ch) {
  const Motor &m = motors[ch];
  return (int32_t)floor(logical_counts(m) - m.enc_zero + 0.5);
}

// ===================================================================== world
void world_init() {
  load_params();
  for (int i = 0; i < 4; ++i) {
    motors[i] = Motor();
    motors[i].J = prm.rotor_J;
  }
  motors[0].driven = true; motors[0].sign = prm.m1_sign;
  motors[1].driven = true; motors[1].sign = prm.m2_sign;
  x_m = prm.start_axle_mm / 1000.0;
  rail_overload_reported = false; lateral_reported = false; offrail_reported = false;
  vcx = vcy = 0;
  v_ms = 0; y_m = 0; vy_ms = 0; psi = 0; r_yaw = 0; rail_force = 0; guide_off[0] = guide_off[1] = 0;
  z_steps = prm.z_initial * prm.z_pulses_per_mm;
  for (int i = 0; i < 6; ++i) { sensor_level_cache[i] = -1; sensor_black_cache[i] = false; }
}

static bool black_at(double pos_mm) {
  const double half = prm.line_width * 0.5 + prm.sensor_margin;
  for (int i = 0; i < prm.line_count; ++i)
    if (fabs(pos_mm - prm.line_center[i]) <= half) return true;
  return false;
}

static int sensor_pin_for_port(int port) {
  switch (port) { case 1: return 6; case 2: return 15; case 3: return 17; case 4: return 10; case 5: return 35; case 6: return 9; }
  return -1;
}

static void update_sensors() {
  const double x_mm = (x_m - v_ms * prm.sensor_latency_s) * 1000.0;
  const double cpsi = cos(psi), spsi = sin(psi);
  const double lat = -prm.sensor_l_mm * spsi;  // sensors sit beside the rail (left +)
  for (int i = 0; i < prm.sensor_count; ++i) {
    const bool b = black_at(x_mm + prm.sensor_offset[i] * cpsi + lat);
    const int lv = b ? prm.black_level : !prm.black_level;
    if (lv != sensor_level_cache[i]) {
      const bool first = sensor_level_cache[i] < 0;
      sensor_level_cache[i] = lv;
      sensor_black_cache[i] = b;
      if (!first) {
        event(EV_SENSOR, prm.sensor_port[i], lv, x_mm + prm.sensor_offset[i] * cpsi + lat, b ? "black" : "white");
        gpio_input_changed(sensor_pin_for_port(prm.sensor_port[i]));
      }
    }
  }
}

int line_sensor_level(int pin, bool *is_sensor) {
  for (int i = 0; i < prm.sensor_count; ++i) {
    if (sensor_pin_for_port(prm.sensor_port[i]) == pin) {
      *is_sensor = true;
      if (sensor_level_cache[i] < 0) update_sensors();
      return sensor_level_cache[i];
    }
  }
  *is_sensor = false;
  return 0;
}

int button_level(int pin, bool *is_button) {
  if (pin == 5) { *is_button = true; return start_button_pressed() ? LOW : HIGH; }
  if (pin == 4) { *is_button = true; return button_a_pressed() ? LOW : HIGH; }
  *is_button = false;
  return 0;
}

// ---- motor electrical model (returns torque at gearbox output, N m)
static double motor_torque(Motor &m, double dt) {
  double v_applied = 0;
  bool shorted = false, open = false;
  if (!dc_enabled) {
    open = true;
  } else {
    switch (m.mode) {
      case MODE_COAST: open = true; break;
      case MODE_BRAKE: shorted = true; break;
      case MODE_POWER: {
        double p = m.power;
        if (p > 100) p = 100;
        if (p < -100) p = -100;
        m.duty = (m.invert ? -p : p) / 100.0;
        v_applied = m.duty * prm.vbatt;
        break;
      }
      case MODE_SPEED:
      case MODE_TARGET: {
        double cmd_dps;
        if (m.mode == MODE_SPEED) {
          cmd_dps = m.dq.at(now_us);
        } else {
          // position move: speed toward target with a braking curve, then hold
          const double err_counts = m.target_counts - (logical_counts(m) - m.enc_zero);
          const double err_deg = err_counts / 4.0;
          const double vmax = fabs(m.target_speed);
          const double vbrake = sqrt(2.0 * 720.0 * fabs(err_deg));  // ~720 deg/s^2 approach
          double v = fmin(vmax, vbrake);
          if (fabs(err_counts) <= prm.target_tolerance_counts) v = err_deg * 5.0;  // holding
          cmd_dps = sgn(err_deg) * fabs(v);
          if (fabs(err_deg) * 4 <= prm.target_tolerance_counts) cmd_dps = err_deg * 5.0;
          m.busy = fabs(err_counts) > prm.target_tolerance_counts;
        }
        const double target_ref = prm.speed_ratio * cmd_dps * M_PI / 180.0;
        const double a = dt / (prm.speed_lag_s + dt);
        m.ref += (target_ref - m.ref) * a;
        const double w_ref = m.invert ? -m.ref : m.ref;  // physical
        double ff = (Ke * w_ref + R_ohm * tau_f * sgn(w_ref) / Kt) / prm.vbatt;
        double duty = ff + prm.inner_kp * (w_ref - m.omega);
        if (duty > 1) duty = 1;
        if (duty < -1) duty = -1;
        m.duty = duty;
        v_applied = duty * prm.vbatt;
        break;
      }
    }
  }
  if (open) { m.current = 0; m.duty = 0; return 0; }
  if (shorted) { m.duty = 0; v_applied = 0; }
  double i = (v_applied - Ke * m.omega) / R_ohm;
  if (i > prm.current_limit) i = prm.current_limit;
  if (i < -prm.current_limit) i = -prm.current_limit;
  m.current = i;
  return Kt * i;
}

static void integrate_shaft(Motor &m, double tau_drive, double tau_load, double dt) {
  // Coulomb gearbox friction with stiction
  const double net = tau_drive - tau_load;
  if (fabs(m.omega) < 1e-4 && fabs(net) <= tau_f) {
    m.omega = 0;
    return;
  }
  const double fr = tau_f * (fabs(m.omega) < 1e-4 ? sgn(net) : sgn(m.omega));
  const double w_new = m.omega + (net - fr) / m.J * dt;
  if (m.omega != 0 && sgn(w_new) != sgn(m.omega) && fabs(net) <= tau_f) m.omega = 0;
  else m.omega = w_new;
  m.theta += m.omega * dt;
}

static inline void clamp_circle(double &fx, double &fy, double fmax) {
  const double mag = hypot(fx, fy);
  if (mag > fmax && mag > 0) { fx *= fmax / mag; fy *= fmax / mag; }
}

void world_step(double dt) {
  const double r = r_eff();
  const double g = 9.81;
  double tau[4];
  for (int i = 0; i < 4; ++i) tau[i] = motor_torque(motors[i], dt);

  // body-frame velocities: u forward (same for every body point), vbc sideways at the centre
  // of mass, vb sideways at the motor-axle centre (v_ref = v_cg - w x r_cg)
  const double c = cos(psi), sn = sin(psi);
  double u = vcx * c + vcy * sn;
  double vbc = -vcx * sn + vcy * c;
  const double vb = vbc - r_yaw * prm.cg_s;
  double Fx = 0, Fy = 0, Mz = 0;        // body-frame force sum (excl. rolling resistance), yaw moment about the CoM

  // driven wheels at s = 0: motor1 = right (l = -track/2), motor2 = left (l = +track/2)
  double F[2] = {0, 0};
  const double N = prm.mass * g * prm.drive_frac / 2.0;
  for (int k = 0; k < 2; ++k) {
    Motor &m = motors[k];
    const double l = (k == 0 ? -0.5 : 0.5) * prm.track;
    const double rk = r * (k == 0 ? prm.right_scale : 1.0);
    const double surf = m.sign * m.omega * rk;
    const double contact = u - r_yaw * l;
    double fx = prm.tire_k * (surf - contact);
    double fy = -prm.tire_k * vb;
    clamp_circle(fx, fy, prm.mu * N);
    F[k] = fx;
    slip[k] = (surf - contact) * 1000.0;
    Fx += fx; Fy += fy; Mz += (0.0 - prm.cg_s) * fy - l * fx;
  }
  for (int k = 0; k < 4; ++k) {
    const double rk = r * (k == 0 ? prm.right_scale : 1.0);
    const double load = (k < 2) ? motors[k].sign * F[k] * rk : 0.0;
    integrate_shaft(motors[k], tau[k], load, dt);
  }
  // passive axle (omni wheels by default): the side rollers give only a weak, low-limit
  // sideways force; the wheel rolls freely forward
  {
    const double Np = prm.mass * g * (1.0 - prm.drive_frac) / 2.0;
    for (int k = 0; k < 2; ++k) {
      double fx = 0, fy = -prm.tire_k * prm.passive_grip * (vb + r_yaw * prm.passive_s);
      clamp_circle(fx, fy, prm.passive_grip * prm.mu * Np);
      Fy += fy; Mz += (prm.passive_s - prm.cg_s) * fy;
    }
  }
  // centre rail: guide rollers at the front and rear axle straddle the rail with a small
  // clearance; beyond it a stiff spring-damper contact pushes the robot back (no pulling)
  rail_force = 0;
  const double vref_y = vcy + r_yaw * prm.cg_s * c * -1.0;  // world sideways velocity of the motor axle
  const double guide_s[2] = {prm.front_axle_s, prm.rear_axle_s};
  for (int k = 0; k < 2; ++k) {
    const double s_g = guide_s[k];
    const double yg = y_m + s_g * sn;
    const double vyg = vref_y + r_yaw * s_g * c;
    guide_off[k] = yg * 1000.0;
    const double pen = fabs(yg) - prm.rail_clear;
    if (!prm.rail_on || pen <= 0) continue;
    double fn = prm.rail_k * pen + prm.rail_c * vyg * sgn(yg);
    if (fn <= 0) continue;
    rail_force += fn;
    const double fyw = -sgn(yg) * fn;
    const double fxw = fabs(v_ms) > 1e-6 ? -prm.rail_mu * fn * sgn(v_ms) : 0.0;
    const double fxb = fxw * c + fyw * sn, fyb = -fxw * sn + fyw * c;
    Fx += fxb; Fy += fyb; Mz += (s_g - prm.cg_s) * fyb;
  }

  // forward motion (same Coulomb/viscous rolling resistance with stiction as before)
  if (fabs(u) < 1e-5 && fabs(Fx) <= prm.roll_force) {
    u = 0;
  } else {
    const double fr = prm.roll_force * (fabs(u) < 1e-5 ? sgn(Fx) : sgn(u)) + prm.roll_visc * u;
    const double u_new = u + ((Fx - fr) / prm.mass + r_yaw * vbc) * dt;
    if (u != 0 && sgn(u_new) != sgn(u) && fabs(Fx) <= prm.roll_force) u = 0;
    else u = u_new;
  }
  // sideways and yaw (at the centre of mass)
  vbc += (Fy / prm.mass - r_yaw * u) * dt;
  r_yaw += Mz / prm.yaw_inertia * dt;
  psi += r_yaw * dt;
  double c2 = cos(psi), s2 = sin(psi);
  vcx = u * c2 - vbc * s2;
  vcy = u * s2 + vbc * c2;
  const double vbr = vbc - r_yaw * prm.cg_s;  // motor-axle sideways velocity
  v_ms = u * c2 - vbr * s2;
  vy_ms = u * s2 + vbr * c2;
  x_m += v_ms * dt;
  y_m += vy_ms * dt;
  if (!rail_overload_reported && prm.rail_on && rail_force > 0 &&
      (fabs(guide_off[0]) > prm.rail_clear * 1000.0 + 3.0 || fabs(guide_off[1]) > prm.rail_clear * 1000.0 + 3.0)) {
    eventf(EV_WARN, 0, guide_off[0], guide_off[1], "centre rail guide pushed %.1f mm past its clearance", fmax(fabs(guide_off[0]), fabs(guide_off[1])) - prm.rail_clear * 1000.0);
    rail_overload_reported = true;
  }
  if (!prm.rail_on && !offrail_reported && fmax(fabs(guide_off[0]), fabs(guide_off[1])) > 30.0) {
    eventf(EV_WARN, 0, guide_off[0], guide_off[1], "no centre rail: a guide axle drifted %.0f mm off the rail line (the real robot would leave the rail)", fmax(fabs(guide_off[0]), fabs(guide_off[1])));
    offrail_reported = true;
  }

  // end walls of the field: use the chassis corners (yaw included)
  const double fe = (prm.length_mm - prm.rear_overhang_mm), re = -prm.rear_overhang_mm, hw = prm.width_mm * 0.5;
  const double x_hi = fe * c2 + hw * fabs(s2), x_lo = re * c2 - hw * fabs(s2);  // corner extremes relative to the motor axle
  const double rear_end = x_m * 1000.0 + x_lo;
  const double front_end = x_m * 1000.0 + x_hi;
  bool stop_fwd = false;
  if (rear_end < 0) {
    x_m = -x_lo / 1000.0;
    if (v_ms < 0) {
      // a resting re-contact (< 1 mm/s) right after a hit is not a new collision
      if (collision != -1 && v_ms < -0.001) eventf(EV_COLLISION, -1, v_ms * 1000, 0, "rear wall hit at %.0f mm/s", v_ms * 1000);
      stop_fwd = true;
    }
    collision = -1;
  } else if (front_end > prm.track_len_mm) {
    x_m = (prm.track_len_mm - x_hi) / 1000.0;
    if (v_ms > 0) {
      if (collision != 1 && v_ms > 0.001) eventf(EV_COLLISION, 1, v_ms * 1000, 0, "front wall hit at %.0f mm/s", v_ms * 1000);
      stop_fwd = true;
    }
    collision = 1;
  } else {
    collision = 0;
  }
  if (stop_fwd) {  // the wall removes the along-track motion of the whole body
    vcx = 0;
    v_ms = 0;
  }
  // sideways: the work area is open (trays/tables are not obstacles here) -> warning only
  if (!lateral_reported) {
    const double ylat = fmax(fabs(y_m * 1000.0 + fe * s2) , fabs(y_m * 1000.0 + re * s2)) + hw * fabs(c2);
    if (ylat > prm.work_half_w) {
      eventf(EV_WARN, 0, ylat, 0, "robot body left the %.0f mm wide work area sideways (%.0f mm from the centre)", prm.work_half_w * 2, ylat);
      lateral_reported = true;
    }
  }

  update_sensors();
  servo_step(dt);
  can_step(dt);
}

// ================================================================ Z stepper
void stepper_on_pulse_edge(int level) {
  if (!level) return;  // a step happens on the rising edge
  const bool down = gpio_output_level(7) == HIGH;
  const double next = z_steps + (down ? -1 : 1);
  const double z_next = next / prm.z_pulses_per_mm;
  if (z_next > prm.z_top_stop || z_next < prm.z_bottom_stop) {
    if (!z_limit_flag) {
      eventf(EV_ZLIMIT, z_next, 0, 0, "Z mechanical limit reached at %.1f mm (steps lost)", z_next);
      z_limit_flag = 1;
    }
    return;
  }
  z_limit_flag = 0;
  z_steps = next;
}
int stepper_home_level() { return (z_steps / prm.z_pulses_per_mm) >= prm.z_home_at ? LOW : HIGH; }
double stepper_z_mm() { return z_steps / prm.z_pulses_per_mm; }

// ============================================================ DC motor chip
static int16_t be16(const uint8_t *p) { return (int16_t)((p[0] << 8) | p[1]); }
static int32_t be32(const uint8_t *p) { return (int32_t)(((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3]); }

static void set_power(int ch, int16_t p) {
  Motor &m = motors[ch];
  if (p == 125) {
    m.mode = MODE_BRAKE;
  } else {
    m.mode = (p == 0) ? MODE_COAST : MODE_POWER;
    m.power = p;
  }
  m.busy = false;
}

static void set_speed(int ch, int16_t s) {
  Motor &m = motors[ch];
  double sp = s;
  if (sp > 720) sp = 720;
  if (sp < -720) sp = -720;
  if (m.mode != MODE_SPEED) {
    // (re)entering closed-loop speed control: start from the measured speed
    m.ref = logical_omega(m);
    m.dq.reset(prm.speed_ratio > 0 ? logical_omega(m) * 180.0 / M_PI / prm.speed_ratio : 0);
    m.mode = MODE_SPEED;
  }
  m.speed_cmd = sp;
  m.dq.push(now_us + (uint64_t)(prm.speed_dead_s * 1e6), sp);
  m.busy = false;
}

static void set_target(int ch, int16_t speed, int32_t target_counts) {
  Motor &m = motors[ch];
  if (m.mode != MODE_TARGET) m.ref = logical_omega(m);
  m.mode = MODE_TARGET;
  m.target_speed = fabs((double)speed);
  m.target_counts = target_counts;
  m.busy = true;
}

static void dc_reset() {
  for (int i = 0; i < 4; ++i) {
    Motor &m = motors[i];
    m.mode = MODE_COAST;
    m.power = 0;
    m.invert = 0;
    m.busy = false;
    m.enc_zero = logical_counts(m);
  }
  dc_enabled = false;
}

void dc_chip_init() {
  dc_enabled = false;
  dc_read_reg = 0;
}

int dc_chip_write(const uint8_t *d, size_t n) {
  if (!n) return 0;
  const uint8_t reg = d[0];
  dc_read_reg = reg;
  if (reg == 0x20) { dc_reset(); return 0; }
  if (reg == 0x1E) { dc_enabled = true; return 0; }
  if (reg >= 0x28 && reg <= 0x2B && n >= 3) { set_power(reg - 0x28, be16(d + 1)); event(EV_MOTOR_CMD, reg - 0x28 + 1, 1, be16(d + 1), nullptr); return 0; }
  if (reg == 0x2E && n >= 9) {
    for (int i = 0; i < 4; ++i) set_power(i, be16(d + 1 + 2 * i));
    return 0;
  }
  if (reg >= 0x2F && reg <= 0x32 && n >= 3) { set_speed(reg - 0x2F, be16(d + 1)); return 0; }
  if (reg == 0x33 && n >= 9) {
    for (int i = 0; i < 4; ++i) set_speed(i, be16(d + 1 + 2 * i));
    return 0;
  }
  if (reg >= 0x34 && reg <= 0x37 && n >= 7) { set_target(reg - 0x34, be16(d + 1), be32(d + 3)); return 0; }
  if (reg == 0x38 && n >= 25) {
    for (int i = 0; i < 4; ++i) set_target(i, be16(d + 1 + 6 * i), be32(d + 3 + 6 * i));
    return 0;
  }
  if (reg >= 0x3E && reg <= 0x41) { Motor &m = motors[reg - 0x3E]; m.enc_zero = logical_counts(m); return 0; }
  if (reg == 0x42) { for (auto &m : motors) m.enc_zero = logical_counts(m); return 0; }
  if (reg >= 0x47 && reg <= 0x4A && n >= 2) { motors[reg - 0x47].invert = d[1] ? 1 : 0; return 0; }
  if (reg >= 0x4F && reg <= 0x52 && n >= 7) { set_target(reg - 0x4F, be16(d + 1), be32(d + 3) * 4); return 0; }
  if (reg == 0x53 && n >= 25) {
    for (int i = 0; i < 4; ++i) set_target(i, be16(d + 1 + 6 * i), be32(d + 3 + 6 * i) * 4);
    return 0;
  }
  if (reg == 0x4D || reg == 0x4E) {
    event(EV_WARN, reg, 0, 0, "PRIZM PID gains changed: the simulator keeps its calibrated speed model");
    return 0;
  }
  return 0;  // read-pointer writes (encoder, busy, battery, firmware) and unknown commands
}

size_t dc_chip_read(uint8_t *out, size_t n) {
  const uint8_t reg = dc_read_reg;
  uint8_t buf[8] = {0};
  if (reg >= 0x39 && reg <= 0x3C) {
    uint32_t c = (uint32_t)encoder_counts(reg - 0x39);
    for (int i = 0; i < 4; ++i) buf[i] = (uint8_t)(c >> (8 * i));
  } else if (reg >= 0x54 && reg <= 0x57) {
    int32_t deg = (int32_t)floor(encoder_counts(reg - 0x54) / 4.0);
    uint32_t c = (uint32_t)deg;
    for (int i = 0; i < 4; ++i) buf[i] = (uint8_t)(c >> (8 * i));
  } else if (reg >= 0x43 && reg <= 0x46) {
    buf[0] = motors[reg - 0x43].busy ? 1 : 0;
  } else if (reg == 0x59) {
    uint16_t v = (uint16_t)lround(prm.vbatt * 100.0 / 1.6);
    buf[0] = (uint8_t)(v & 0xFF);
    buf[1] = (uint8_t)(v >> 8);
  } else if (reg == 0x26) {
    buf[0] = 5;  // firmware version placeholder
  }
  for (size_t i = 0; i < n; ++i) out[i] = i < 8 ? buf[i] : 0;
  return n;
}

// ============================================================= servo chip
struct Servo { double pos = 90, target = 90; double speed = 50; bool active = false; };
static Servo servos[6];
static bool servo_enabled = true;
static uint8_t servo_read_reg = 0;

void servo_chip_init() {
  for (int i = 0; i < 6; ++i) servos[i] = Servo();
  servos[0].pos = servos[0].target = P("servo.initialPos1", 90);
}

void servo_step(double dt) {
  for (auto &s : servos) {
    if (!s.active || !servo_enabled) continue;
    double rate = fmax(1.0, s.speed) / 100.0 * prm.servo_rate_100;
    if (rate > prm.servo_rate_max) rate = prm.servo_rate_max;
    const double d = s.target - s.pos;
    const double step = rate * dt;
    if (fabs(d) <= step) s.pos = s.target;
    else s.pos += step * sgn(d);
  }
}

int servo_chip_write(const uint8_t *d, size_t n) {
  if (!n) return 0;
  const uint8_t reg = d[0];
  servo_read_reg = reg;
  if (reg == 0x20) { servo_enabled = true; return 0; }
  if (reg == 0x3E) { servo_enabled = false; return 0; }
  if (reg == 0x3F || reg == 0x1E) { servo_enabled = true; return 0; }
  if (reg >= 0x28 && reg <= 0x2D && n >= 2) { servos[reg - 0x28].speed = d[1]; return 0; }
  if (reg == 0x2E && n >= 7) { for (int i = 0; i < 6; ++i) servos[i].speed = d[1 + i]; return 0; }
  if (reg >= 0x2F && reg <= 0x34 && n >= 2) {
    Servo &s = servos[reg - 0x2F];
    s.target = d[1] > 180 ? 180 : d[1];
    s.active = true;
    return 0;
  }
  if (reg == 0x35 && n >= 7) {
    for (int i = 0; i < 6; ++i) { servos[i].target = d[1 + i] > 180 ? 180 : d[1 + i]; servos[i].active = true; }
    return 0;
  }
  return 0;
}

size_t servo_chip_read(uint8_t *out, size_t n) {
  uint8_t v = 0;
  if (servo_read_reg >= 0x36 && servo_read_reg <= 0x3B) v = (uint8_t)lround(servos[servo_read_reg - 0x36].pos);
  else if (servo_read_reg == 0x26) v = 5;
  for (size_t i = 0; i < n; ++i) out[i] = i == 0 ? v : 0;
  return n;
}

double servo_position(int ch) { return (ch >= 0 && ch < 6) ? servos[ch].pos : 0; }
double servo_target(int ch) { return (ch >= 0 && ch < 6) ? servos[ch].target : 0; }

// ================================================================== frames
static uint32_t last_loops = 0, last_reads = 0, last_i2c = 0, last_can = 0;
static float last_sig[12];
static uint64_t last_activity_us = 0;
static bool started_once = false;
extern uint32_t console_bytes;
extern bool ending;

void world_frame() {
  float f[44];
  memset(f, 0, sizeof f);
  f[0] = (float)now_ms();
  f[1] = (float)(x_m * 1000.0);
  f[2] = (float)(v_ms * 1000.0);
  for (int k = 0; k < 2; ++k) {
    const Motor &m = motors[k];
    f[3 + k] = (m.mode == MODE_SPEED) ? (float)m.speed_cmd : NAN;
    f[5 + k] = (float)(logical_omega(m) * 180.0 / M_PI);
    f[7 + k] = dc_enabled ? (float)m.mode : -1.0f;
    f[9 + k] = (float)m.duty;
    f[11 + k] = (float)encoder_counts(k);
    f[26 + k] = (float)slip[k];
    f[31 + k] = (float)(m.ref * 180.0 / M_PI);
    f[33 + k] = (float)m.current;
  }
  f[13] = prm.sensor_count > 0 ? (float)sensor_level_cache[0] : -1.0f;
  f[14] = prm.sensor_count > 1 ? (float)sensor_level_cache[1] : -1.0f;
  f[15] = (float)stepper_z_mm();
  f[16] = (float)can_axis_position(0);
  f[17] = (float)can_axis_position(1);
  f[18] = (float)servo_position(0);
  f[19] = (float)leds.rgb[0];
  f[20] = (float)leds.rgb[1];
  f[21] = (float)leds.rgb[2];
  f[22] = (float)(loop_count - last_loops);
  f[23] = (float)(sensor_reads - last_reads);
  f[24] = (float)(i2c_transactions - last_i2c);
  f[25] = (float)(can_frames - last_can);
  f[28] = (float)collision;
  f[29] = (float)gpio_output_level(12);
  f[30] = (float)servo_target(0);
  f[35] = (float)can_axis_target(0);
  f[36] = (float)can_axis_target(1);
  f[37] = prm.sensor_count > 2 ? (float)sensor_level_cache[2] : -1.0f;
  f[38] = prm.sensor_count > 3 ? (float)sensor_level_cache[3] : -1.0f;
  f[39] = (float)(y_m * 1000.0);
  f[40] = (float)(psi * 180.0 / M_PI);
  f[41] = (float)rail_force;
  f[42] = (float)guide_off[0];
  f[43] = (float)guide_off[1];
  last_loops = loop_count; last_reads = sensor_reads; last_i2c = i2c_transactions; last_can = can_frames;
  host_frame(f, 44);

  // idle detection: nothing moves, no LED/serial change for run.idleStopSeconds -> end
  static uint32_t last_console = 0;
  const float sig[12] = {f[1], f[16], f[17], f[15], f[18], f[19], f[7], f[8], f[39], f[40], f[11], f[12]};
  bool active = console_bytes != last_console || fabsf(f[2]) > 0.2f;
  for (int i = 0; i < 12; ++i) if (fabsf(sig[i] - last_sig[i]) > 0.01f) active = true;
  memcpy(last_sig, sig, sizeof sig);
  last_console = console_bytes;
  if (start_button_pressed() || dc_enabled) started_once = true;
  if (active) last_activity_us = now_us;
  static double idle_limit = -2;
  if (idle_limit == -2) idle_limit = P("run.idleStopSeconds", 20);
  if (!ending && started_once && idle_limit > 0 && now_us - last_activity_us > (uint64_t)(idle_limit * 1e6))
    end_run(4, "idle: no motion, LED or serial output");
}

}  // namespace sim
