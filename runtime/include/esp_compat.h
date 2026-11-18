// ESP-IDF / FreeRTOS symbols that Arduino-ESP32 sketches commonly touch.
#pragma once
#include <stdint.h>
#include <stdbool.h>

#define IRAM_ATTR
#define DRAM_ATTR
#define RTC_DATA_ATTR
#define RTC_NOINIT_ATTR
#define WORD_ALIGNED_ATTR
#define ESP_INTR_FLAG_IRAM 0

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_NOT_SUPPORTED 0x106
#define ESP_ERROR_CHECK(x) do { (void)(x); } while (0)

typedef struct { int owner; int count; } portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {0, 0}
#ifdef __cplusplus
extern "C" {
#endif
void sim_critical_enter(void);
void sim_critical_exit(void);
#ifdef __cplusplus
}
#endif
#define portENTER_CRITICAL(mux) sim_critical_enter()
#define portEXIT_CRITICAL(mux) sim_critical_exit()
#define portENTER_CRITICAL_ISR(mux) sim_critical_enter()
#define portEXIT_CRITICAL_ISR(mux) sim_critical_exit()
#define portENTER_CRITICAL_SAFE(mux) sim_critical_enter()
#define portEXIT_CRITICAL_SAFE(mux) sim_critical_exit()
#define portDISABLE_INTERRUPTS() sim_critical_enter()
#define portENABLE_INTERRUPTS() sim_critical_exit()
#define spinlock_initialize(m) do { (void)(m); } while (0)

typedef uint32_t TickType_t;
typedef int BaseType_t;
typedef unsigned int UBaseType_t;
typedef void *TaskHandle_t;
typedef void *QueueHandle_t;
typedef void *SemaphoreHandle_t;
typedef void (*TaskFunction_t)(void *);
#define pdTRUE 1
#define pdFALSE 0
#define pdPASS 1
#define pdFAIL 0
#define portMAX_DELAY 0xffffffffUL
#define portTICK_PERIOD_MS 1
#define portTICK_RATE_MS 1
#define configTICK_RATE_HZ 1000
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
#define tskIDLE_PRIORITY 0
#define tskNO_AFFINITY 0x7FFFFFFF
#define ARDUINO_RUNNING_CORE 1

#ifdef __cplusplus
extern "C" {
#endif
void vTaskDelay(TickType_t ticks);
TickType_t xTaskGetTickCount(void);
void vTaskDelayUntil(TickType_t *prev, TickType_t inc);
BaseType_t xTaskDelayUntil(TickType_t *prev, TickType_t inc);
BaseType_t xTaskCreate(TaskFunction_t fn, const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *handle);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *handle, BaseType_t core);
void vTaskDelete(TaskHandle_t handle);
TaskHandle_t xTaskGetCurrentTaskHandle(void);
int64_t esp_timer_get_time(void);
esp_err_t esp_task_wdt_reset(void);
esp_err_t esp_task_wdt_add(TaskHandle_t handle);
esp_err_t esp_task_wdt_delete(TaskHandle_t handle);
void esp_restart(void);
#ifdef __cplusplus
}
#endif
