#pragma once
#include <stdint.h>
class EspClass {
 public:
  void restart();
  uint32_t getFreeHeap() { return 200000; }
  uint32_t getHeapSize() { return 320000; }
  uint32_t getMinFreeHeap() { return 180000; }
  uint32_t getMaxAllocHeap() { return 110000; }
  uint32_t getCpuFreqMHz() { return 240; }
  uint32_t getCycleCount();
  const char *getSdkVersion() { return "WaferRobotSim"; }
  const char *getChipModel() { return "ESP32-S3 (sim)"; }
  uint8_t getChipRevision() { return 0; }
  uint64_t getEfuseMac() { return 0x1122334455ULL; }
};
extern EspClass ESP;
