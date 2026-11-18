// ESP-IDF 5 general purpose timer, emulated on the simulator's virtual clock.
// Alarm callbacks run as "ISRs" at their exact virtual timestamps.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "../esp_compat.h"

typedef struct sim_gptimer *gptimer_handle_t;
typedef enum { GPTIMER_CLK_SRC_DEFAULT = 0, GPTIMER_CLK_SRC_APB = 0, GPTIMER_CLK_SRC_XTAL = 1 } gptimer_clock_source_t;
typedef enum { GPTIMER_COUNT_DOWN = 0, GPTIMER_COUNT_UP = 1 } gptimer_count_direction_t;
typedef struct {
  gptimer_clock_source_t clk_src;
  gptimer_count_direction_t direction;
  uint32_t resolution_hz;
  int intr_priority;
  struct { uint32_t intr_shared : 1; uint32_t allow_pd : 1; uint32_t backup_before_sleep : 1; } flags;
} gptimer_config_t;
typedef struct { uint64_t count_value; uint64_t alarm_value; } gptimer_alarm_event_data_t;
typedef bool (*gptimer_alarm_cb_t)(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
typedef struct { gptimer_alarm_cb_t on_alarm; } gptimer_event_callbacks_t;
typedef struct {
  uint64_t alarm_count;
  uint64_t reload_count;
  struct { uint32_t auto_reload_on_alarm : 1; } flags;
} gptimer_alarm_config_t;

#ifdef __cplusplus
extern "C" {
#endif
esp_err_t gptimer_new_timer(const gptimer_config_t *config, gptimer_handle_t *ret_timer);
esp_err_t gptimer_del_timer(gptimer_handle_t timer);
esp_err_t gptimer_set_raw_count(gptimer_handle_t timer, uint64_t value);
esp_err_t gptimer_get_raw_count(gptimer_handle_t timer, uint64_t *value);
esp_err_t gptimer_register_event_callbacks(gptimer_handle_t timer, const gptimer_event_callbacks_t *cbs, void *user_data);
esp_err_t gptimer_set_alarm_action(gptimer_handle_t timer, const gptimer_alarm_config_t *config);
esp_err_t gptimer_enable(gptimer_handle_t timer);
esp_err_t gptimer_disable(gptimer_handle_t timer);
esp_err_t gptimer_start(gptimer_handle_t timer);
esp_err_t gptimer_stop(gptimer_handle_t timer);
#ifdef __cplusplus
}
#endif
