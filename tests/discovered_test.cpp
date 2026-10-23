// Plain assert-based tests for the discovered-markers store (no framework).
#include <cstdio>
#include <string>

#include "../src/discovered.h"

using livemap::discovered::Store;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

int main() {
    Store s;
    EXPECT(s.update("OG Vanilla K", {7, 3, 3, 0x7d496e64u}, 100));          // sorted, deduplicated
    EXPECT(!s.update("OG Vanilla K", {3, 7, 0x7d496e64u}, 200));            // same set: no change
    const uint64_t v = s.version();
    EXPECT(s.update("OG Vanilla K", {3, 7, 9, 0x7d496e64u}, 300));
    EXPECT(s.version() > v);
    EXPECT(s.update("Bro \"Two\"", {1}, 400));
    std::string json = s.to_json();
    EXPECT(json.find("\"OG Vanilla K\":{\"online\":true,\"at\":300,\"keys\":[3,7,9,2101964388]}") != std::string::npos);
    EXPECT(json.find("\"Bro \\\"Two\\\"\"") != std::string::npos);
    // Logging out keeps the set, only the flag changes.
    s.set_online({"OG Vanilla K"});
    EXPECT(s.to_json().find("\"Bro \\\"Two\\\"\":{\"online\":false,\"at\":400,\"keys\":[1]}") != std::string::npos);
    // Round trip through the file format; loaded players count as offline until seen again.
    Store t;
    EXPECT(t.from_json(s.to_json()));
    EXPECT(t.players() == 2);
    std::string back = t.to_json();
    EXPECT(back.find("\"OG Vanilla K\":{\"online\":false,\"at\":300,\"keys\":[3,7,9,2101964388]}") != std::string::npos);
    EXPECT(back.find("\"Bro \\\"Two\\\"\":{\"online\":false,\"at\":400,\"keys\":[1]}") != std::string::npos);
    Store u;
    EXPECT(!u.from_json("not json"));
    EXPECT(u.players() == 0);
    EXPECT(u.from_json("{\"version\":1,\"players\":{}}"));
    if (failures == 0) std::printf("discovered: all passed\n");
    return failures == 0 ? 0 : 1;
}
