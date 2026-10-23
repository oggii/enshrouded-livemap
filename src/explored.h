// Where each player has been: a grid of 20 m cells over the 10240 m world, a cell counts as
// explored once a player was within 300 m of it (the game's own reveal radius,
// ecs::FogOfWarDiscovery.discoveryRange of the player templates). The game keeps its real fog in
// the character save on the player's PC (docs/RESEARCH.md section 18), so the map builds its own
// from the positions it sees. Saved to livemap/explored.json by name, like discovered markers.
#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace livemap::explored {

constexpr int kCells = 512;            // per side
constexpr double kCellMetres = 20.0;   // 512 * 20 = 10240 m
constexpr double kRadiusMetres = 300.0;

class Store {
public:
    // A player at world position (x, z) in metres; marks every cell whose centre is within the
    // radius. Returns true when a new cell was marked.
    bool reveal(const std::string& name, double x, double z);
    bool explored(const std::string& name, double x, double z);
    // {"version":N,"cells":512,"cellMetres":20,"players":{"<name>":"<base64 of 512*512 bits, row 0 =
    // z 0 (south), bit i of byte j = cell 8*j+i>"}}
    std::string to_json();
    bool from_json(const std::string& text);
    uint64_t version();
    size_t players();

private:
    std::mutex mutex_;
    std::map<std::string, std::vector<uint8_t>> grids_;
    uint64_t version_ = 0;
};

std::string base64(const std::vector<uint8_t>& data);
bool unbase64(const std::string& text, std::vector<uint8_t>& out);

}  // namespace livemap::explored
