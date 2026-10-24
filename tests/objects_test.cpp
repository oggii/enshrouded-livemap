// Plain assert-based tests for the chest, switch and creature store (no framework).
#include <cstdio>
#include <string>

#include "../src/objects.h"

using namespace livemap::objects;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

static size_t count(const std::string& s, const std::string& what) {
    size_t n = 0;
    for (size_t at = s.find(what); at != std::string::npos; at = s.find(what, at + 1)) ++n;
    return n;
}

int main() {
    Store s;
    const uint64_t v0 = s.version();
    // First pass near a player: two chests (one already looted), a locked door, a barrier.
    std::vector<Chest> chests = {{4711, "LootChest_Random_silver_fog", 3626.7f, 870.0f, 1638.4f, true},
                                 {4712, "LootChest_Random_wood", 3601.0f, 860.5f, 1590.2f, false}};
    std::vector<Switch> switches = {{"Prop_Door_Large_Castle_02_Locked_Pickable", 3400.6f, 900.0f, 1723.0f, 'l', false},
                                    {"Door_Magical_Barrier_Skeleton_trigger", 3500.0f, 910.0f, 1700.0f, 'b', false}};
    EXPECT(s.update(chests, switches, 1000));
    EXPECT(s.version() > v0);
    EXPECT(s.chests() == 2 && s.switches() == 2);

    // The same pass again changes nothing.
    const uint64_t v1 = s.version();
    EXPECT(!s.update(chests, switches, 1010));
    EXPECT(s.version() == v1);

    // The wooden chest is looted and the lock picked: both change, with the new time.
    chests[1].empty = true;
    switches[0].on = true;
    EXPECT(s.update(chests, switches, 1100));
    std::string j = s.objects_json();
    EXPECT(j.find("\"id\":4712,\"t\":\"LootChest_Random_wood\",\"x\":3601.0,\"y\":860.5,\"z\":1590.2,\"empty\":true,\"at\":1100") != std::string::npos);
    EXPECT(j.find("\"id\":4711,\"t\":\"LootChest_Random_silver_fog\",\"x\":3626.7,\"y\":870.0,\"z\":1638.4,\"empty\":true,\"at\":1000") != std::string::npos);
    EXPECT(j.find("\"k\":\"l\",\"on\":true,\"at\":1100") != std::string::npos);
    EXPECT(j.find("\"k\":\"b\",\"on\":false,\"at\":1000") != std::string::npos);

    // Out of range (not in the pass): kept with the last known state.
    EXPECT(!s.update({}, {}, 1200));
    EXPECT(s.chests() == 2 && s.switches() == 2);

    // A chest without a scene id is keyed by template and place (1 m).
    EXPECT(s.update({{0, "LootChest_Random_gold", 100.2f, 50.0f, 200.4f, false}}, {}, 1300));
    EXPECT(!s.update({{0, "LootChest_Random_gold", 100.4f, 50.0f, 200.3f, false}}, {}, 1310));
    EXPECT(s.chests() == 3);

    // Round trip through the file format.
    Store t;
    EXPECT(t.from_json(s.objects_json()));
    EXPECT(t.chests() == 3 && t.switches() == 2);
    std::string a = s.objects_json(), b = t.objects_json();
    EXPECT(a.substr(a.find(",\"chests\"")) == b.substr(b.find(",\"chests\"")));
    EXPECT(!t.update({{4712, "LootChest_Random_wood", 3601.0f, 860.5f, 1590.2f, true}}, {}, 1400));  // same state after loading

    // Creatures: replaced on every pass, version follows.
    const uint64_t c0 = s.creatures_version();
    s.set_creatures({{0x82a6, "Enemy_Wildbeast_wolf_earlygame", 3725.3f, 1301.7f, 20, 34, 6, 3, false, false},
                     {0x2e07, "Animal_Wildlife_T2_Bunny_AG2", 3664.7f, 1405.8f, 19, 19, 0, 1, false, true}});
    EXPECT(s.creatures_version() > c0);
    std::string cj = s.creatures_json();
    EXPECT(count(cj, "\"e\":") == 2);
    EXPECT(cj.find("\"t\":\"Enemy_Wildbeast_wolf_earlygame\",\"x\":3725.3,\"z\":1301.7,\"hp\":20,\"max\":34,\"s\":6,\"lv\":3,\"boss\":false,\"animal\":false") != std::string::npos);
    const uint64_t c1 = s.creatures_version();
    s.set_creatures({});
    EXPECT(s.creatures_version() > c1 && count(s.creatures_json(), "\"e\":") == 0);
    const uint64_t c2 = s.creatures_version();
    s.set_creatures({});
    EXPECT(s.creatures_version() == c2);  // still none: no new version

    Store bad;
    EXPECT(!bad.from_json("garbage"));
    EXPECT(!bad.from_json("{\"version\":1,\"chests\":[{\"id\":1,\"x\":5,\"z\":5}],\"switches\":[]}"));  // no template
    EXPECT(bad.chests() == 0);

    if (failures) std::printf("%d failure(s)\n", failures);
    else std::printf("all object tests passed\n");
    return failures ? 1 : 0;
}
