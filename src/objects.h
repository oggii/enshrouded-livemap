// What the server's loaded world says about chests, locks and switches, and the creatures around
// the players (docs/RESEARCH.md section 21). The server only holds the world within about 500 m
// of each player, so chests and switches keep their last known state (saved to
// livemap/objects.json); creatures are live only.
#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace livemap::objects {

struct Chest {
    uint32_t id = 0;     // SceneLootNodeId, stable per placed chest (0 = none: keyed by place)
    std::string tpl;     // template, e.g. LootChest_Random_silver_fog
    float x = 0, y = 0, z = 0;
    bool empty = false;  // looted (InventoryEmptyState.isEmpty or RandomLootLock)
};

// A lock (locked chest or door), a magic barrier or another switch (lever, button, secret door).
struct Switch {
    std::string tpl;
    float x = 0, y = 0, z = 0;
    char kind = 's';     // 'l' lock, 'b' barrier, 's' switch
    bool on = false;     // unlocked / open / switched
};

struct Creature {
    uint32_t entity = 0;
    std::string tpl;
    float x = 0, z = 0;
    uint32_t hp = 0, max = 0;
    uint8_t state = 0;   // keen::enemy01::State (6 = combat); 0 for animals
    uint16_t level = 0;
    bool boss = false;
    bool animal = false;
};

class Store {
public:
    // One pass over the loaded world: known chests and switches are updated, new ones added, the
    // rest keep their last known state. True when something the map shows changed.
    bool update(const std::vector<Chest>& chests, const std::vector<Switch>& switches, int64_t now);
    void set_creatures(std::vector<Creature> creatures);

    // {"version":N,"chests":[{"id":n,"t":"..","x":x,"y":y,"z":z,"empty":b,"at":unix}],
    //  "switches":[{"t":"..","x":x,"y":y,"z":z,"k":"l|b|s","on":b,"at":unix}]}; "at" = when the state
    // was first seen or last changed.
    std::string objects_json();
    // {"version":N,"creatures":[{"e":n,"t":"..","x":x,"z":z,"hp":n,"max":n,"s":n,"lv":n,"boss":b,"animal":b}]}
    std::string creatures_json();
    // Reads what objects_json wrote; false (and the store unchanged) on anything unexpected.
    bool from_json(const std::string& text);

    uint64_t version();
    uint64_t creatures_version();
    size_t chests();
    size_t switches();

private:
    struct ChestRec {
        Chest c;
        int64_t at = 0;
    };
    struct SwitchRec {
        Switch s;
        int64_t at = 0;
    };
    std::mutex mutex_;
    std::map<std::string, ChestRec> chests_;
    std::map<std::string, SwitchRec> switches_;
    std::vector<Creature> creatures_;
    uint64_t version_ = 0, creatures_version_ = 0;
};

std::string chest_key(const Chest& c);
std::string switch_key(const Switch& s);

}  // namespace livemap::objects
