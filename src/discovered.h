// Which map markers each player has discovered. The server keeps a dynamic knowledge map per
// player slot (sorted uint32 keys + uint32 values, docs/RESEARCH.md section 17); a marker counts as
// discovered when the key of its "visible" query is set. The store remembers each player's set by
// name, also after they log out, and is saved to livemap/discovered.json.
#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace livemap::discovered {

class Store {
public:
    // The keys (value != 0) of one player who is in game now; returns true when they changed.
    bool update(const std::string& name, std::vector<uint32_t> keys, int64_t unix_now);
    // Players in game right now (for the "online" flag); others keep their last set.
    void set_online(const std::vector<std::string>& names);
    // {"version":N,"players":{"<name>":{"online":true,"at":unix,"keys":[..]}}}
    std::string to_json();
    // Reads what to_json wrote; false (and the store unchanged) on anything unexpected.
    bool from_json(const std::string& text);
    uint64_t version();
    size_t players();

private:
    struct Player {
        std::vector<uint32_t> keys;  // sorted
        int64_t at = 0;              // unix time of the last change
        bool online = false;
    };
    std::mutex mutex_;
    std::map<std::string, Player> players_;
    uint64_t version_ = 0;
};

}  // namespace livemap::discovered
