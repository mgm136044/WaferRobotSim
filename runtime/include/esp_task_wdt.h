#pragma once
#include "esp_compat.h"
typedef struct { uint32_t timeout_ms; uint32_t idle_core_mask; bool trigger_panic; } esp_task_wdt_config_t;
#ifdef __cplusplus
extern "C" {
#endif
esp_err_t esp_task_wdt_init(const esp_task_wdt_config_t *config);
esp_err_t esp_task_wdt_deinit(void);
#ifdef __cplusplus
}
#endif
