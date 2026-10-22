#include "scan.h"

#include <windows.h>

#include <cstdio>
#include <cstring>
#include <iterator>
#include <cstdlib>
#include <span>
#include <vector>

namespace livemap {

namespace {

// Builds of enshrouded_server.exe the hook sites were checked against.
struct Build {
    DWORD time_date_stamp;
    DWORD size_of_image;
    const char* label;
};
constexpr Build kBuilds[] = {
    {1792148062, 0x1dcf000, "25988414"},  // 16 Oct 2026, Game Version SVN 1269579
    {1792507668, 0x1dd1000, "26083076"},  // 20 Oct 2026, Game Version SVN 1273043
};

struct Pattern {
    const char* name;
    std::span<const uint8_t> bytes;
    size_t hook_offset;
};

constexpr uint8_t kPlayerTable[] = {0x48, 0x8b, 0xc4, 0x55, 0x53, 0x56, 0x57, 0x41, 0x54,
                                    0x41, 0x56, 0x41, 0x57, 0x48, 0x8d, 0xa8, 0x48, 0xf6,
                                    0xff, 0xff, 0x48, 0x81, 0xec, 0x80, 0x0a, 0x00, 0x00};
constexpr uint8_t kMovement[] = {0x48, 0x01, 0x0a, 0xf3, 0x48, 0x0f, 0x2c, 0xc6, 0xf3, 0x49, 0x0f,
                                 0x2c, 0xc8, 0x48, 0x03, 0xc8, 0x48, 0x01, 0x4a, 0x08, 0xf3, 0x48,
                                 0x0f, 0x2c, 0xcf, 0xf3, 0x48, 0x0f, 0x2c, 0xc6, 0x48, 0x03, 0xc8,
                                 0x48, 0x01, 0x4a, 0x10, 0x41, 0xb8, 0x48, 0x00, 0x00, 0x00, 0x48,
                                 0x8d, 0x54, 0x24, 0x40, 0x48, 0x8b, 0xcb};
constexpr uint8_t kRegistry[] = {0x48, 0x89, 0x5c, 0x24, 0x20, 0x55, 0x56, 0x57, 0x41, 0x54, 0x41, 0x55,
                                 0x48, 0x83, 0xec, 0x20, 0x4c, 0x8b, 0x52, 0x08, 0x33, 0xf6, 0x4c, 0x8b};
constexpr uint8_t kMining[] = {0x48, 0x8b, 0x46, 0x08, 0x33, 0xd2, 0x48, 0x8d, 0x0c, 0x40, 0x48, 0x8b, 0x06,
                               0x48, 0x89, 0x14, 0xc8, 0x48, 0x89, 0x54, 0xc8, 0x08, 0x89, 0x6c, 0xc8, 0x10,
                               0x44, 0x89, 0x7c, 0xc8, 0x14};
constexpr uint8_t kChest[] = {0x48, 0x8b, 0x44, 0x24, 0x38, 0x8b, 0x40, 0x24, 0x89, 0x47, 0x10, 0x48, 0x8b, 0x74,
                              0x24, 0x30, 0x4c, 0x8b, 0x4c, 0x24, 0x50, 0x44, 0x8b, 0x85, 0x58, 0x74, 0x00, 0x00};
constexpr uint8_t kChatPost[] = {0x40, 0x55, 0x56, 0x41, 0x54, 0x41, 0x55, 0x41, 0x57, 0x48, 0x83, 0xec, 0x30, 0x49,
                                 0x8b, 0x41, 0x08, 0x33, 0xed, 0x4d, 0x8b, 0xf9, 0x45, 0x0f, 0xb6, 0xe0, 0x48, 0x8b,
                                 0xf2, 0x4c, 0x8b, 0xe9, 0x48, 0x3d, 0x00, 0x04, 0x00, 0x00, 0x76, 0x16};
constexpr uint8_t kDaytime[] = {0x8b, 0xcf, 0xe8, 0x09, 0xe2, 0xfc, 0xff, 0x48, 0x8b, 0xd0,
                                0x48, 0x8b, 0xcf, 0xe8, 0x5e, 0x8b, 0xfc, 0xff, 0x48, 0x89,
                                0x47, 0x48, 0x49, 0x3b, 0x07, 0x7c, 0x09, 0x49};

// add_buildzones_server (FUN_1400e90e0 / FUN_1400e9f90): the loop head that copies the transform
// ("mov rax, [rbp-0x10]" ... "call"), 0x100 bytes after the function start in both builds.
constexpr uint8_t kBasesLoop[] = {0x48, 0x8b, 0x45, 0xf0, 0x48, 0x8d, 0x4c, 0x24, 0x70, 0x48, 0x8b, 0x55, 0xf8, 0x48,
                                  0x83, 0xc2, 0x10, 0x0f, 0x10, 0x00, 0x0f, 0x11, 0x44, 0x24, 0x70, 0x0f, 0x10, 0x48,
                                  0x10, 0x0f, 0x11, 0x4d, 0x80, 0x0f, 0x10, 0x40, 0x20, 0x0f, 0x11, 0x45, 0x90, 0xf2,
                                  0x0f, 0x10, 0x48, 0x30, 0xf2, 0x0f, 0x11, 0x4d, 0xa0, 0xe8};

// The join/leave chat line in the player table update (FUN_1407b34c0), from
// "cmp qword [rsi+0x60], 0" up to "mov r8b, 4"; the call of the chat function follows at +0x78
// and the next instruction at +0x7d. Hex with ?? for addresses and loca tags.
constexpr const char* kJoinLine =
    "48 83 7e 60 00 74 ?? 41 8b 4e 0c e8 ?? ?? ?? ?? 49 8b 4e 48 4c 8d 05 ?? ?? ?? ?? 41 8b 16 85 c0 "
    "4c 89 85 ?? ?? ?? ?? 41 b9 ?? ?? ?? ?? 41 b8 ?? ?? ?? ?? c6 85 ?? ?? ?? ?? 00 45 0f 44 c1 "
    "4c 89 a5 ?? ?? ?? ?? 4c 8d 8d ?? ?? ?? ?? 4c 89 4c 24 40 4c 8d 8d ?? ?? ?? ?? 48 89 4c 24 38 "
    "48 8d 8d ?? ?? ?? ?? 89 54 24 30 48 8b 56 60 89 44 24 28 44 89 44 24 20 41 b0 04";
constexpr size_t kJoinTagOffset = 0x29;
constexpr size_t kJoinCallOffset = 0x78;
constexpr size_t kJoinAfterOffset = 0x7d;

struct Masked {
    std::vector<uint8_t> bytes;
    std::vector<bool> fixed;
};

Masked parse(const char* text) {
    Masked p;
    for (const char* s = text; *s != 0;) {
        if (*s == ' ') { ++s; continue; }
        if (s[0] == '?' && s[1] == '?') {
            p.bytes.push_back(0);
            p.fixed.push_back(false);
        } else {
            char hex[3] = {s[0], s[1], 0};
            p.bytes.push_back(static_cast<uint8_t>(std::strtoul(hex, nullptr, 16)));
            p.fixed.push_back(true);
        }
        s += 2;
    }
    return p;
}

std::vector<uintptr_t> find_all(const uint8_t* begin, size_t size, const Masked& p) {
    std::vector<uintptr_t> hits;
    const size_t n = p.bytes.size();
    for (size_t i = 0; n != 0 && i + n <= size; ++i) {
        bool ok = true;
        for (size_t k = 0; k < n && ok; ++k) ok = !p.fixed[k] || begin[i + k] == p.bytes[k];
        if (ok) hits.push_back(reinterpret_cast<uintptr_t>(begin + i));
    }
    return hits;
}

uintptr_t call_target(uintptr_t call) {
    int32_t rel = 0;
    std::memcpy(&rel, reinterpret_cast<const void*>(call + 1), sizeof rel);
    return call + 5 + static_cast<intptr_t>(rel);
}

uintptr_t find_unique(const uint8_t* begin, size_t size, const Pattern& p, int& count) {
    count = 0;
    uintptr_t hit = 0;
    const size_t n = p.bytes.size();
    for (size_t i = 0; i + n <= size; ++i) {
        if (begin[i] == p.bytes[0] && std::memcmp(begin + i, p.bytes.data(), n) == 0) {
            if (++count == 1) hit = reinterpret_cast<uintptr_t>(begin + i) + p.hook_offset;
        }
    }
    return count == 1 ? hit : 0;
}

}  // namespace

bool find_targets(const uint8_t* base, Targets& out, std::string& error) {
    auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    char buf[160];
    const Build* build = nullptr;
    for (const Build& b : kBuilds) {
        if (nt->FileHeader.TimeDateStamp == b.time_date_stamp && nt->OptionalHeader.SizeOfImage == b.size_of_image) build = &b;
    }
    if (build == nullptr) {
        std::snprintf(buf, sizeof buf, "unknown server build (TimeDateStamp %lu, SizeOfImage 0x%lx), not hooking",
                      nt->FileHeader.TimeDateStamp, nt->OptionalHeader.SizeOfImage);
        error = buf;
        return false;
    }
    out.build = build->label;
    const IMAGE_SECTION_HEADER* text = nullptr;
    auto sec = IMAGE_FIRST_SECTION(nt);
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; ++i) {
        if (std::memcmp(sec[i].Name, ".text", 5) == 0) text = &sec[i];
    }
    if (text == nullptr) {
        error = "no .text section";
        return false;
    }
    const uint8_t* code = base + text->VirtualAddress;
    const size_t size = text->Misc.VirtualSize;
    const Pattern patterns[] = {
        {"player_table", kPlayerTable, 0},
        {"movement", kMovement, 0x25},
        {"daytime", kDaytime, 0x12},
        {"registry", kRegistry, 0},
    };
    uintptr_t* slots[] = {&out.player_table, &out.movement, &out.daytime, &out.registry};
    static_assert(std::size(patterns) == std::size(slots));
    for (size_t i = 0; i < std::size(patterns); ++i) {
        int count = 0;
        *slots[i] = find_unique(code, size, patterns[i], count);
        if (*slots[i] == 0) {
            std::snprintf(buf, sizeof buf, "pattern '%s' matched %d times (need exactly 1), not hooking",
                          patterns[i].name, count);
            error = buf;
            return false;
        }
    }
    // Optional sites: missing ones leave their feature off, the rest keeps working.
    int count = 0;
    out.mining = find_unique(code, size, Pattern{"mining", kMining, 0x16}, count);
    out.chest = find_unique(code, size, Pattern{"chest", kChest, 0xb}, count);
    out.chat_post = find_unique(code, size, Pattern{"chat_post", kChatPost, 0}, count);
    out.bases = find_unique(code, size, Pattern{"bases", kBasesLoop, 0}, count);
    return true;
}

bool find_chat_sites(const uint8_t* base, ChatSites& out) {
    auto dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    auto sec = IMAGE_FIRST_SECTION(nt);
    const uint8_t* code = nullptr;
    size_t size = 0;
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; ++i) {
        if (std::memcmp(sec[i].Name, ".text", 5) == 0) {
            code = base + sec[i].VirtualAddress;
            size = sec[i].Misc.VirtualSize;
        }
    }
    if (code == nullptr) return false;
    std::vector<uintptr_t> hits = find_all(code, size, parse(kJoinLine));
    if (hits.size() != 1) return false;
    int count = 0;
    const uintptr_t chat = find_unique(code, size, Pattern{"chat_post", kChatPost, 0}, count);
    if (chat == 0) return false;
    const uintptr_t at = hits[0];
    const uint8_t call_op = *reinterpret_cast<const uint8_t*>(at + kJoinCallOffset);
    const uint8_t after_op = *reinterpret_cast<const uint8_t*>(at + kJoinAfterOffset);
    if (call_op == 0xe8) {
        if (call_target(at + kJoinCallOffset) != chat) return false;
    } else if (call_op != 0xe9) {
        return false;  // neither the call nor another mod's jump to its hook
    }
    if (after_op != 0x44 && after_op != 0xe9) return false;
    out.join_call = at + kJoinCallOffset;
    out.join_after = at + kJoinAfterOffset;
    out.chat_post = chat;
    out.shared = call_op == 0xe9;
    std::memcpy(&out.join_tag, reinterpret_cast<const void*>(at + kJoinTagOffset), sizeof out.join_tag);
    return true;
}

}  // namespace livemap
