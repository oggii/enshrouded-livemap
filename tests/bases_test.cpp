// Plain assert-based tests for the Flame Altar store (no framework).
#include <cstdio>
#include <string>

#include "../src/bases.h"

using livemap::bases::Base;
using livemap::bases::kStaleMs;
using livemap::bases::Store;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

static Base at(double x, double z) {
    Base b;
    b.x = x; b.y = 850; b.z = z;
    b.size_x = b.size_y = b.size_z = 40;
    return b;
}

int main() {
    Store s;
    uint64_t t = 1000;
    EXPECT(s.count(t) == 0 && s.to_json(t) == "{\"version\":0,\"bases\":[]}");

    // The system walks in chunks (8 + 2 altars per tick): every tick sees every altar once.
    s.see(1, 0, at(3753.25, 1422.25), t);
    s.see(2, 0, at(3454.25, 1837.25), t);
    EXPECT(s.count(t) == 2 && s.version(t) == 2);
    for (int tick = 0; tick < 100; ++tick) {
        t += 50;
        s.see(1, 0, at(3753.25, 1422.25), t);
        s.see(2, 0, at(3454.25, 1837.25), t);
    }
    EXPECT(s.version(t) == 2);  // the same altars again change nothing

    // Altar 2 is taken down: still listed shortly after, gone after kStaleMs without a sighting.
    const uint64_t last2 = t;
    for (uint64_t now = t + 50; now <= last2 + kStaleMs + 100; now += 50) s.see(1, 0, at(3753.25, 1422.25), now);
    t = last2 + kStaleMs + 100;
    EXPECT(s.count(t) == 1 && s.version(t) == 3);

    // Moving, growing (altar upgrade) and abandoning are changes.
    s.see(1, 0, at(3760.0, 1422.25), t);
    EXPECT(s.version(t) == 4);
    Base bigger = at(3760.0, 1422.25);
    bigger.size_x = bigger.size_z = 60;
    s.see(1, 0, bigger, t);
    EXPECT(s.version(t) == 5);
    bigger.abandoned = true;
    s.see(1, 0, bigger, t);
    EXPECT(s.version(t) == 6);

    const std::string json = s.to_json(t);
    EXPECT(json == "{\"version\":6,\"bases\":[{\"x\":3760.0,\"y\":850.0,\"z\":1422.2,\"size\":[60.0,40.0,60.0],\"abandoned\":true}]}");
    if (failures) std::printf("json: %s\n", json.c_str());

    // The server stops walking (the last altar is gone): the list empties all the same.
    EXPECT(s.count(t + kStaleMs + 1) == 0 && s.version(t + kStaleMs + 1) == 7);

    if (failures) std::printf("%d failure(s)\n", failures);
    else std::printf("all bases tests passed\n");
    return failures ? 1 : 0;
}
