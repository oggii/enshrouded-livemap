// Flame Altars (player bases) as the server's add_buildzones_server system walks them. The
// system runs every tick, once per ECS chunk (8 + 2 altars = two calls), so an altar counts as
// gone once it has not been seen for kStaleMs.
#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <utility>

namespace livemap::bases {

constexpr uint64_t kStaleMs = 10000;

struct Base {
    double x = 0, y = 0, z = 0;                // metres
    float size_x = 0, size_y = 0, size_z = 0;  // build zone, metres
    bool abandoned = false;
    uint64_t seen_ms = 0;
};

class Store {
public:
    // One base during a walk; `id` is the game's 16-byte BaseId.
    void see(uint64_t id_lo, uint64_t id_hi, const Base& b, uint64_t now_ms);
    // {"version":N,"bases":[{"x":..,"y":..,"z":..,"size":[x,y,z],"abandoned":false},...]}
    std::string to_json(uint64_t now_ms);
    uint64_t version(uint64_t now_ms);
    size_t count(uint64_t now_ms);

private:
    void prune(uint64_t now_ms);  // caller holds the mutex
    std::mutex mutex_;
    std::map<std::pair<uint64_t, uint64_t>, Base> bases_;
    uint64_t version_ = 0;
};

}  // namespace livemap::bases
