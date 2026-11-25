// Offline check: maps an enshrouded_server.exe from disk (without running it) and runs the same
// build check and pattern search the DLL runs inside the server.
//
// Usage: livemap_selftest <path\to\enshrouded_server.exe>
// Exit code 0 = the mod would hook this build, 1 = it would stay inactive, 2 = usage/load error.
#include <windows.h>

#include <cstdio>
#include <cstring>
#include <string>

#include "scan.h"

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: livemap_selftest <path\\to\\enshrouded_server.exe>\n");
        return 2;
    }
    HMODULE image = LoadLibraryExW(argv[1], nullptr, DONT_RESOLVE_DLL_REFERENCES);
    if (image == nullptr) {
        std::fprintf(stderr, "could not map %ls (error %lu)\n", argv[1], GetLastError());
        return 2;
    }
    auto base = reinterpret_cast<const uint8_t*>(image);
    livemap::Targets t;
    std::string error;
    if (!livemap::find_targets(base, t, error)) {
        std::printf("INACTIVE: %s\n", error.c_str());
        return 1;
    }
    // Expected RVAs per build: player_table, movement, daytime, registry, mining, chest, bases,
    // chat_post, player_death.
    struct Known { const char* build; uintptr_t rva[9]; };
    constexpr Known kKnown[] = {
        {"25988414", {0x7b34c0, 0x90e7a, 0x95d1f2, 0x675e10, 0x2236f8, 0xa0c4a, 0xe91e0, 0x908ce0, 0x4dfc0}},
        {"26083076", {0x7b5800, 0x91d2a, 0x95f842, 0x677240, 0x2245a8, 0xa1afa, 0xea090, 0x90b330, 0x4ee70}},
        {"26430253", {0x7bed90, 0x9581a, 0x969c62, 0x67e720, 0x22a034, 0xa578a, 0xee3f0, 0x9151f0, 0x52430}},
    };
    const Known* known = nullptr;
    for (const Known& k : kKnown) {
        if (std::strcmp(k.build, t.build) == 0) known = &k;
    }
    if (known == nullptr) {
        std::printf("server build %s: no expected addresses in the selftest\n", t.build);
        return 1;
    }
    std::printf("server build %s%s\n", t.build, t.mining_record ? " (mining via the stack entry)" : "");
    const char* names[] = {"player_table", "movement", "daytime", "registry", "mining",
                           "chest", "bases", "chat_post", "player_death"};
    const uintptr_t found[] = {t.player_table, t.movement, t.daytime, t.registry, t.mining,
                               t.chest, t.bases, t.chat_post, t.player_death};
    struct { const char* name; uintptr_t at; uintptr_t expected; } sites[9];
    for (int i = 0; i < 9; ++i) sites[i] = {names[i], found[i], known->rva[i]};
    bool ok = true;
    for (const auto& s : sites) {
        uintptr_t rva = s.at - reinterpret_cast<uintptr_t>(base);
        ok = ok && rva == s.expected;
        std::printf("%-13s rva 0x%llx%s\n", s.name, static_cast<unsigned long long>(rva),
                    rva == s.expected ? "" : "  (UNEXPECTED)");
    }
    std::printf(ok ? "OK: all hook sites found\n" : "FAIL: a hook site moved\n");
    return ok ? 0 : 1;
}
