// Plain assert-based tests for reading the Flame level from the server's A2S_INFO reply.
#include <cstdio>
#include <string>

#include "../src/a2s.h"

using namespace livemap::a2s;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

int main() {
    // The live server's reply of 23 Oct 2026 (world at Flame level 3), byte for byte.
    static const unsigned char kLive[] = {
        0xff, 0xff, 0xff, 0xff, 0x49, 0x11, 0x59, 0x61, 0x68, 0x75, 0x64, 0x73, 0x65, 0x6e, 0x54,
        0x6f, 0x77, 0x6e, 0x20, 0x33, 0x33, 0x65, 0x72, 0x00, 0x00, 0x45, 0x6e, 0x73, 0x68, 0x72,
        0x6f, 0x75, 0x64, 0x65, 0x64, 0x00, 0x45, 0x6e, 0x73, 0x68, 0x72, 0x6f, 0x75, 0x64, 0x65,
        0x64, 0x00, 0x00, 0x00, 0x01, 0x05, 0x00, 0x64, 0x77, 0x01, 0x00, 0x30, 0x2e, 0x30, 0x2e,
        0x31, 0x35, 0x2e, 0x30, 0x00, 0xb1, 0x15, 0x3d, 0x18, 0x30, 0x06, 0xb6, 0x52, 0xcb, 0x40,
        0x01, 0x33, 0x3b, 0x31, 0x32, 0x37, 0x33, 0x30, 0x34, 0x33, 0x3b, 0x31, 0x3b, 0x30, 0x3b,
        0x31, 0x3b, 0x31, 0x3b, 0x31, 0x3b, 0x30, 0x3b, 0x30, 0x00, 0xa4, 0x5d, 0x12, 0x00, 0x00,
        0x00, 0x00, 0x00
    };
    const std::string live(reinterpret_cast<const char*>(kLive), sizeof kLive);
    EXPECT(keywords_of(live) == "3;1273043;1;0;1;1;1;0;0");
    EXPECT(flame_level(keywords_of(live)) == 3);
    EXPECT(flame_level("10;1273043") == 10);
    EXPECT(flame_level("") == -1);
    EXPECT(flame_level("x;1") == -1);
    EXPECT(flame_level("123;1") == -1);
    // Cut short anywhere: no keywords, no crash.
    for (size_t n = 0; n < live.size(); ++n) EXPECT(keywords_of(live.substr(0, n)).size() <= 23);
    EXPECT(keywords_of(live.substr(0, 90)).empty());
    // Challenge round trip.
    const std::string challenge_reply("\xff\xff\xff\xff" "A\x01\x02\x03\x04", 9);
    EXPECT(challenge_of(challenge_reply) == std::string("\x01\x02\x03\x04", 4));
    EXPECT(challenge_of(live).empty());
    EXPECT(info_request(std::string("\x01\x02\x03\x04", 4)).size() == 4 + 1 + 19 + 1 + 4);
    if (failures == 0) std::printf("a2s: all passed\n");
    return failures == 0 ? 0 : 1;
}
