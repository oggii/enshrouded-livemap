// Player deaths. The server reports each one as a keen::PlayerDeath telemetry event (cause,
// position, docs/RESEARCH.md section 20); the store counts them per player name, keeps the last
// deaths with where and how, and is saved to livemap/deaths.json.
#pragma once

#include <array>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace livemap::deaths {

// keen::DeathCause: 0 Impact (an enemy or a hit), 1 FallDamage, 2 Fog (shroud), 3 Suffocated.
constexpr int kCauses = 4;
constexpr size_t kRecent = 50;

struct Death {
    std::string name;
    int64_t at = 0;
    int cause = 0;
    float x = 0, z = 0;
    bool fog = false;      // deadly shroud
    bool drowned = false;
};

class Store {
public:
    void record(const Death& d);
    // {"version":N,"players":{"<name>":{"count":n,"causes":[i,f,s,o],"at":unix}},
    //  "recent":[{"name":"..","at":n,"cause":c,"x":x,"z":z,"fog":b,"drowned":b},...]} (newest last)
    std::string to_json();
    // Reads what to_json wrote; false (and the store unchanged) on anything unexpected.
    bool from_json(const std::string& text);
    uint64_t version();
    size_t players();
    int count(const std::string& name);

private:
    struct Player {
        int count = 0;
        std::array<int, kCauses> causes{};
        int64_t at = 0;   // unix time of the last death
    };
    std::mutex mutex_;
    std::map<std::string, Player> players_;
    std::deque<Death> recent_;
    uint64_t version_ = 0;
};

}  // namespace livemap::deaths
