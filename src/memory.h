#pragma once

#include <cstddef>
#include <cstdint>

namespace livemap {

// Reads game memory under a structured-exception guard: a bad address returns false
// instead of crashing the server.
bool read_u8(uintptr_t address, uint8_t& out);
bool read_u16(uintptr_t address, uint16_t& out);
bool read_u32(uintptr_t address, uint32_t& out);
bool read_ptr(uintptr_t address, uintptr_t& out);
bool read_u64(uintptr_t address, uint64_t& out);
bool write_u32(uintptr_t address, uint32_t value);
// `size` bytes from game memory into `out`; false if any of it cannot be read.
bool read_bytes(uintptr_t address, void* out, size_t size);

}  // namespace livemap
