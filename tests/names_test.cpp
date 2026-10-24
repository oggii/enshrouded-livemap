// Plain assert-based tests for reading player names from a slot's name field (no framework).
// The fields are built in this process's memory the way the game lays them out.
#include <cstdio>
#include <cstring>
#include <string>

#include "../src/memory.h"
#include "../src/names.h"

using livemap::names::read;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

// The slot's name field: {char* data, u64 length, u64 capacity}.
struct Field {
    const char* data;
    uint64_t length;
    uint64_t capacity;
};

// 1.0.0's way, kept to show the bug: inline text first, else the pointer up to a zero byte,
// giving up on any control byte.
static std::string read_100(uintptr_t field) {
    char inline_buf[33] = {};
    bool printable = true;
    for (int i = 0; i < 32; ++i) {
        uint8_t c = 0;
        if (!livemap::read_u8(field + i, c)) return {};
        inline_buf[i] = static_cast<char>(c);
        if (c == 0) break;
        if (c < 0x20) printable = false;
    }
    if (printable && inline_buf[0] != 0) return inline_buf;
    uintptr_t ptr = 0;
    if (!livemap::read_ptr(field, ptr) || ptr < 0x10000) return {};
    std::string s;
    for (int i = 0; i < 64; ++i) {
        uint8_t c = 0;
        if (!livemap::read_u8(ptr + i, c) || c == 0) break;
        if (c < 0x20) return {};
        s += static_cast<char>(c);
    }
    return s;
}

int main() {
    // Bug report 1156280: a 9-byte name in a 16-byte buffer (length 9, capacity 16, as in the
    // reporter's SLOT dump), the rest of the buffer and what follows it leftover bytes.
    char buffer[64];
    std::memset(buffer, 0x01, sizeof buffer);
    std::memcpy(buffer, "Headshoot", 9);
    std::memcpy(buffer + 9, "\x10\x7f\x02\xa5\x00\x03\x1b", 7);
    Field reported{buffer, 9, 16};
    const auto at = [](const Field& f) { return reinterpret_cast<uintptr_t>(&f); };
    EXPECT(read_100(at(reported)).empty());          // what the map showed: "Player 3"
    EXPECT(read(at(reported)) == "Headshoot");       // what it shows now

    // Exactly the length counts, also when a zero byte or more text follows.
    char more[32] = "OG Vanilla Kxyz";
    Field cut{more, 12, 16};
    EXPECT(read(at(cut)) == "OG Vanilla K");

    // UTF-8 names stay whole, up to the longest a 32-character name can be.
    const char* utf8 = "\xC3\x96zg\xC3\xBCr \xF0\x9F\x94\xA5";   // Özgür 🔥
    Field kurdish{utf8, std::strlen(utf8), 16};
    EXPECT(read(at(kurdish)) == utf8);
    std::string longest;
    for (int i = 0; i < 32; ++i) longest += "\xF0\x9F\x94\xA5";
    Field big{longest.data(), longest.size(), 256};
    EXPECT(read(at(big)) == longest);

    // Nothing usable: empty, no buffer, absurd length, a pointer that cannot be read.
    Field none{buffer, 0, 16};
    EXPECT(read(at(none)).empty());
    Field null_ptr{nullptr, 9, 16};
    EXPECT(read(at(null_ptr)).empty());
    Field huge{buffer, 100000, 100000};
    EXPECT(read(at(huge)).empty());
    Field unmapped{reinterpret_cast<const char*>(uintptr_t{0x7ff0'0000'0000}), 9, 16};
    EXPECT(read(at(unmapped)).empty());

    if (failures) std::printf("%d failure(s)\n", failures);
    else std::printf("all name tests passed\n");
    return failures ? 1 : 0;
}
