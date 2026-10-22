#include "ecs.h"

#include "memory.h"

#include <windows.h>

namespace livemap {

uint32_t param_entity(uintptr_t param) {
    uintptr_t world = 0, table = 0;
    uint32_t index = 0, id = 0;
    if (!read_ptr(param, world) || !read_u32(param + 8, index) || index == 0 ||
        !read_ptr(world + 0x828, table) ||
        !read_u32(table + static_cast<uintptr_t>(index - 1) * 16, id)) {
        return 0;
    }
    return id;
}

namespace {

constexpr uintptr_t kArchetype = 0x18, kChunkData = 0x20, kChunkIndex = 0x30;
constexpr uintptr_t kOffsets = 0x84, kSizes = 0xa84;

// How many bytes from `address` are committed and readable, at most `max`.
size_t readable_span(uintptr_t address, size_t max) {
    size_t total = 0;
    while (total < max) {
        MEMORY_BASIC_INFORMATION info{};
        if (VirtualQuery(reinterpret_cast<LPCVOID>(address + total), &info, sizeof info) == 0) break;
        const DWORD readable = PAGE_READONLY | PAGE_READWRITE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE;
        if (info.State != MEM_COMMIT || (info.Protect & readable) == 0 || (info.Protect & PAGE_GUARD) != 0) break;
        uintptr_t end = reinterpret_cast<uintptr_t>(info.BaseAddress) + info.RegionSize;
        total = end - address;
    }
    return total < max ? total : max;
}

}  // namespace

bool entity_has(uintptr_t record, int type_index) {
    uintptr_t arch = 0;
    uint64_t word = 0;
    if (type_index < 0 || type_index >= kTypeCount || record == 0 || !read_ptr(record + kArchetype, arch) ||
        arch == 0 || !read_u64(arch + static_cast<uintptr_t>(type_index >> 6) * 8, word)) {
        return false;
    }
    return ((word >> (type_index & 63)) & 1) != 0;
}

uint16_t component_size(uintptr_t record, int type_index) {
    uintptr_t arch = 0;
    uint16_t size = 0;
    if (!entity_has(record, type_index) || !read_ptr(record + kArchetype, arch) ||
        !read_u16(arch + kSizes + static_cast<uintptr_t>(type_index) * 2, size)) {
        return 0;
    }
    return size;
}

uintptr_t entity_component(uintptr_t record, int type_index, uint16_t expect_size) {
    uintptr_t arch = 0, data = 0;
    uint16_t offset = 0, size = 0;
    uint32_t index = 0;
    if (!entity_has(record, type_index) || !read_ptr(record + kArchetype, arch) ||
        !read_u16(arch + kOffsets + static_cast<uintptr_t>(type_index) * 2, offset) ||
        !read_u16(arch + kSizes + static_cast<uintptr_t>(type_index) * 2, size) || size == 0 ||
        (expect_size != 0 && size != expect_size) || !read_ptr(record + kChunkData, data) || data == 0 ||
        !read_u32(record + kChunkIndex, index)) {
        return 0;
    }
    return data + offset + static_cast<uintptr_t>(index) * size;
}

int type_index(const TypeTable& table, uint32_t hash) {
    if (table.base == 0) return -1;
    for (int i = 0; i < kTypeCount; ++i) {
        uint32_t h = 0;
        if (!read_u32(table.base + static_cast<uintptr_t>(i) * table.stride, h)) return -1;
        if (h == hash) return i;
    }
    return -1;
}

bool find_type_table(uintptr_t registry, int known_index, uint32_t known_hash, const uint32_t check[2],
                     TypeTable& out) {
    constexpr uint32_t kStrides[] = {4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96, 112, 128};
    constexpr size_t kWindow = 0x4000;
    if (registry == 0 || known_index < 0 || known_index >= kTypeCount) return false;
    // Roots: the registry itself, then everything its first 0x400 bytes point at.
    uintptr_t roots[1 + 0x400 / 8];
    size_t root_count = 0;
    roots[root_count++] = registry;
    for (uintptr_t k = 0; k < 0x400; k += 8) {
        uintptr_t p = 0;
        if (read_ptr(registry + k, p) && p > 0x10000 && (p & 3) == 0 && readable_span(p, 16) == 16) roots[root_count++] = p;
    }
    for (size_t r = 0; r < root_count; ++r) {
        size_t span = readable_span(roots[r], kWindow);
        for (uint32_t stride : kStrides) {
            uintptr_t need = static_cast<uintptr_t>(known_index) * stride + 4;
            if (need > span) continue;
            for (uintptr_t base = roots[r]; base + need <= roots[r] + span; base += 4) {
                if (*reinterpret_cast<const uint32_t*>(base + static_cast<uintptr_t>(known_index) * stride) != known_hash) continue;
                TypeTable t{base, stride};
                if (type_index(t, check[0]) >= 0 && type_index(t, check[1]) >= 0) {
                    out = t;
                    return true;
                }
            }
        }
    }
    return false;
}

uint32_t system_entity(uintptr_t param_slot) {
    uintptr_t param = 0;
    return read_ptr(param_slot, param) ? param_entity(param) : 0;
}

}  // namespace livemap
