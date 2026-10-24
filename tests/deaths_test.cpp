// Plain assert-based tests for the death counter store (no framework).
#include <cstdio>
#include <string>

#include "../src/deaths.h"

using namespace livemap::deaths;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

int main() {
    Store s;
    EXPECT(s.count("OG Vanilla K") == 0);
    const uint64_t v0 = s.version();
    s.record({"OG Vanilla K", 1792830000, 1, 4211.5f, 3988.0f, false, false});   // fell
    s.record({"OG Vanilla K", 1792830100, 2, 4300.0f, 4000.0f, true, false});    // deadly shroud
    s.record({"Brom \"the\" Bold", 1792830200, 3, 3700.0f, 4250.0f, false, true});  // drowned
    EXPECT(s.version() > v0);
    EXPECT(s.count("OG Vanilla K") == 2);
    EXPECT(s.count("Brom \"the\" Bold") == 1);
    EXPECT(s.players() == 2);
    const std::string json = s.to_json();
    EXPECT(json.find("\"causes\":[0,1,1,0]") != std::string::npos);
    EXPECT(json.find("\"fog\":true") != std::string::npos);
    EXPECT(json.find("\"drowned\":true") != std::string::npos);

    // Round trip through the file format.
    Store t;
    EXPECT(t.from_json(json));
    EXPECT(t.count("OG Vanilla K") == 2 && t.count("Brom \"the\" Bold") == 1);
    EXPECT(t.to_json().substr(t.to_json().find(",\"players\"")) == json.substr(json.find(",\"players\"")));

    // Only the last 50 deaths are kept; counts keep everything.
    Store many;
    for (int i = 0; i < 60; ++i) many.record({"Kesh", 1792830000 + i, 0, 1.0f * i, 2.0f, false, false});
    EXPECT(many.count("Kesh") == 60);
    const std::string m = many.to_json();
    size_t n = 0;
    for (size_t at = m.find("\"name\":\"Kesh\""); at != std::string::npos; at = m.find("\"name\":\"Kesh\"", at + 1)) ++n;
    EXPECT(n == kRecent);
    EXPECT(m.find("\"x\":10.0,") != std::string::npos && m.find("\"x\":9.0,") == std::string::npos);

    Store bad;
    EXPECT(!bad.from_json("garbage"));
    EXPECT(bad.players() == 0);

    if (failures) std::printf("%d failure(s)\n", failures);
    else std::printf("all death tests passed\n");
    return failures ? 1 : 0;
}
