#include "memory.h"

#include <windows.h>

namespace livemap {

// No C++ objects with destructors in these functions, so __try/__except is allowed.
bool read_u8(uintptr_t address, uint8_t& out) {
    __try {
        out = *reinterpret_cast<const volatile uint8_t*>(address);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool read_u16(uintptr_t address, uint16_t& out) {
    __try {
        out = *reinterpret_cast<const volatile uint16_t*>(address);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool read_u32(uintptr_t address, uint32_t& out) {
    __try {
        out = *reinterpret_cast<const volatile uint32_t*>(address);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool write_u32(uintptr_t address, uint32_t value) {
    __try {
        *reinterpret_cast<volatile uint32_t*>(address) = value;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool read_ptr(uintptr_t address, uintptr_t& out) {
    __try {
        out = *reinterpret_cast<const volatile uintptr_t*>(address);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool read_u64(uintptr_t address, uint64_t& out) {
    __try {
        out = *reinterpret_cast<const volatile uint64_t*>(address);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool read_bytes(uintptr_t address, void* out, size_t size) {
    __try {
        const volatile uint8_t* src = reinterpret_cast<const volatile uint8_t*>(address);
        uint8_t* dst = static_cast<uint8_t*>(out);
        for (size_t i = 0; i < size; ++i) dst[i] = src[i];
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

}  // namespace livemap
