// Low-level GPIO access used from ISRs; routed to the virtual GPIO block.
#pragma once
#include <stdint.h>
#include "../soc/gpio_struct.h"
#ifdef __cplusplus
extern "C" {
#endif
void sim_gpio_ll_set_level(int pin, int level);
int sim_gpio_ll_get_level(int pin);
#ifdef __cplusplus
}
#endif
static inline void gpio_ll_set_level(gpio_dev_t *hw, uint32_t gpio_num, uint32_t level) { (void)hw; sim_gpio_ll_set_level((int)gpio_num, (int)level); }
static inline int gpio_ll_get_level(gpio_dev_t *hw, uint32_t gpio_num) { (void)hw; return sim_gpio_ll_get_level((int)gpio_num); }
