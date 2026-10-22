// Finds: ore deposits players mined and chests they opened. Pure bookkeeping plus JSON, so it
// can be unit-tested; the hooks feed it, the web server reads it, main.cpp saves it.
#pragma once

#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

namespace livemap::finds {

struct Deposit {
    double x, y, z;        // mean position of the hits, metres
    std::string sort;      // item debug name, e.g. "Material_T2_Ore_Copper"; "" = unknown
    uint32_t xp = 0;       // XP per hit when known (0 = unknown)
    uint32_t hits = 0;
    int64_t first = 0, last = 0;  // Unix seconds
    std::vector<std::string> by;  // finders, in order of first hit, at most kMaxFinders
};

struct Chest {
    double x, y, z;
    int poi = -1;          // index into pois.json's "pois", -1 = unknown chest
    int rl = -1;           // 1 = has the RandomLootContainer component, 0 = not (player storage), -1 = not checked
    std::string by;
    int64_t at = 0;
};

constexpr double kMergeRadius = 6.0;    // hits within this distance join a deposit
constexpr double kChestMatchRadius = 3.0;
constexpr size_t kMaxFinders = 8;

class Store {
public:
    // A mining hit. Joins the nearest deposit of the same sort within kMergeRadius, else starts
    // one. Returns true if something changed (always, but keeps the interface honest).
    bool record_ore(double x, double y, double z, const std::string& sort, uint32_t xp,
                    const std::string& player, int64_t now);

    // A chest opened at (x, y, z). `poi` is the matched pois.json index or -1. A chest already
    // recorded within kChestMatchRadius is updated, not duplicated. Returns true if changed.
    bool record_chest(double x, double y, double z, int poi, const std::string& player, int64_t now, int rl = -1);

    // Bumps on every change; the page refetches when it moves.
    uint64_t version() const;

    std::string to_json() const;
    // Loads a file written by to_json(); unknown fields are ignored. False on a parse error.
    bool from_json(const std::string& text);

    size_t deposits() const;
    size_t chests() const;

private:
    mutable std::mutex mutex_;
    uint64_t version_ = 0;
    std::vector<Deposit> ore_;
    std::vector<Chest> chests_;
};

// Mining hits are only worth a mark for ore-like materials, not for every lump of dirt.
bool is_ore_like(const std::string& item_name);

}  // namespace livemap::finds
