#include "finds.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace livemap::finds {

namespace {

double dist2(double ax, double az, double bx, double bz) {
    return (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
}

void append_escaped(std::string& out, const std::string& s) {
    for (char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (static_cast<unsigned char>(c) < 0x20) out += ' ';
        else out += c;
    }
}

// A deliberately small JSON reader for the shape to_json() writes: it walks the text with a
// cursor and knows objects, arrays, strings, numbers, true/false/null.
struct Reader {
    const std::string& s;
    size_t i = 0;
    bool ok = true;
    void ws() { while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) ++i; }
    bool take(char c) { ws(); if (i < s.size() && s[i] == c) { ++i; return true; } return false; }
    bool expect(char c) { if (!take(c)) ok = false; return ok; }
    std::string string() {
        std::string out;
        if (!expect('"')) return out;
        while (i < s.size() && s[i] != '"') {
            if (s[i] == '\\' && i + 1 < s.size()) { ++i; out += s[i] == 'n' ? '\n' : s[i]; }
            else out += s[i];
            ++i;
        }
        expect('"');
        return out;
    }
    double number() {
        ws();
        char* end = nullptr;
        double v = std::strtod(s.c_str() + i, &end);
        if (end == s.c_str() + i) { ok = false; return 0; }
        i = static_cast<size_t>(end - s.c_str());
        return v;
    }
    void skip_value() {
        ws();
        if (i >= s.size()) { ok = false; return; }
        char c = s[i];
        if (c == '"') { string(); return; }
        if (c == '{' || c == '[') {
            char close = c == '{' ? '}' : ']';
            ++i;
            if (take(close)) return;
            for (;;) {
                if (c == '{') { string(); expect(':'); }
                skip_value();
                if (!ok) return;
                if (take(close)) return;
                if (!expect(',')) return;
            }
        }
        while (i < s.size() && s[i] != ',' && s[i] != '}' && s[i] != ']') ++i;  // number, true, false, null
    }
};

}  // namespace

bool is_ore_like(const std::string& n) {
    // Deposits among the items terrain digging can drop (TerraformingEfficiencyRegistryResource,
    // build 26083076): ores, gems and minerals. Debris such as twigs, bricks, straw or metal
    // sheets from ruins is left out, and so is plain stone, dirt and wood.
    static const char* kDeposits[] = {
        "Material_T1_Salt",        "Material_T1_Stone_Flint", "Material_T1_KryptCrystal", "Material_T1_Red_Marble_Fragment",
        "Material_T1_Tar",         "Material_T2_Amber",       "Material_T2_Ore_Copper",   "Material_T3_Ore_Tin",
        "Material_T4_Lapislazuli", "Material_T4_Ore_Iron",    "Material_T4_Sulfur",       "Material_T5_Amethyst",
        "Material_T5_Coal",        "Material_T5_Obsidian",    "Material_T5_Silver_Ore",   "Material_T6_Aquamarine",
        "Material_T6_Gold_Ore",    "Material_T6_MotherOfPearl", "Material_T7_Celesthium_Ore", "Material_T7_Diamond",
        "Material_T7_Moonstone",
    };
    for (const char* d : kDeposits) {
        if (n == d) return true;
    }
    return false;
}

bool Store::record_ore(double x, double y, double z, const std::string& sort, uint32_t xp,
                       const std::string& player, int64_t now) {
    std::lock_guard lock(mutex_);
    Deposit* best = nullptr;
    double best_d2 = kMergeRadius * kMergeRadius;
    for (Deposit& d : ore_) {
        if (d.sort != sort) continue;
        double d2 = dist2(d.x, d.z, x, z);
        if (d2 <= best_d2) { best_d2 = d2; best = &d; }
    }
    if (best == nullptr) {
        ore_.push_back({x, y, z, sort, xp, 1, now, now, {player}});
    } else {
        double n = best->hits;
        best->x = (best->x * n + x) / (n + 1);
        best->y = (best->y * n + y) / (n + 1);
        best->z = (best->z * n + z) / (n + 1);
        best->hits++;
        best->last = now;
        if (xp != 0) best->xp = xp;
        if (!player.empty() && std::find(best->by.begin(), best->by.end(), player) == best->by.end() &&
            best->by.size() < kMaxFinders) {
            best->by.push_back(player);
        }
    }
    ++version_;
    return true;
}

bool Store::record_chest(double x, double y, double z, int poi, const std::string& player, int64_t now, int rl) {
    std::lock_guard lock(mutex_);
    for (Chest& c : chests_) {
        bool same = (poi >= 0 && c.poi == poi) || dist2(c.x, c.z, x, z) <= kChestMatchRadius * kChestMatchRadius;
        if (!same) continue;
        if (c.by == player && c.at == now) return false;
        c.by = player;
        c.at = now;
        if (poi >= 0) c.poi = poi;
        if (rl >= 0) c.rl = rl;
        ++version_;
        return true;
    }
    chests_.push_back({x, y, z, poi, rl, player, now});
    ++version_;
    return true;
}

uint64_t Store::version() const {
    std::lock_guard lock(mutex_);
    return version_;
}

size_t Store::deposits() const { std::lock_guard lock(mutex_); return ore_.size(); }
size_t Store::chests() const { std::lock_guard lock(mutex_); return chests_.size(); }

std::string Store::to_json() const {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"ore\":[";
    char buf[160];
    bool first = true;
    for (const Deposit& d : ore_) {
        out += first ? "" : ",";
        first = false;
        std::snprintf(buf, sizeof buf, "{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"sort\":", d.x, d.y, d.z);
        out += buf;
        if (d.sort.empty()) out += "null";
        else { out += '"'; append_escaped(out, d.sort); out += '"'; }
        std::snprintf(buf, sizeof buf, ",\"xp\":%u,\"hits\":%u,\"first\":%lld,\"last\":%lld,\"by\":[", d.xp, d.hits,
                      static_cast<long long>(d.first), static_cast<long long>(d.last));
        out += buf;
        for (size_t i = 0; i < d.by.size(); ++i) {
            out += i ? ",\"" : "\"";
            append_escaped(out, d.by[i]);
            out += '"';
        }
        out += "]}";
    }
    out += "],\"chests\":[";
    first = true;
    for (const Chest& c : chests_) {
        out += first ? "" : ",";
        first = false;
        std::snprintf(buf, sizeof buf, "{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"poi\":", c.x, c.y, c.z);
        out += buf;
        out += c.poi >= 0 ? std::to_string(c.poi) : "null";
        out += c.rl > 0 ? ",\"rl\":true" : c.rl == 0 ? ",\"rl\":false" : ",\"rl\":null";
        out += ",\"by\":\"";
        append_escaped(out, c.by);
        std::snprintf(buf, sizeof buf, "\",\"at\":%lld}", static_cast<long long>(c.at));
        out += buf;
    }
    out += "]}";
    return out;
}

bool Store::from_json(const std::string& text) {
    Reader r{text};
    std::vector<Deposit> ore;
    std::vector<Chest> chests;
    uint64_t version = 0;
    if (!r.expect('{')) return false;
    if (!r.take('}')) {
        for (;;) {
            std::string key = r.string();
            if (!r.expect(':')) return false;
            if (key == "version") {
                version = static_cast<uint64_t>(r.number());
            } else if (key == "ore" || key == "chests") {
                if (!r.expect('[')) return false;
                if (!r.take(']')) {
                    for (;;) {
                        if (!r.expect('{')) return false;
                        Deposit d{0, 0, 0};
                        Chest c{0, 0, 0};
                        if (!r.take('}')) {
                            for (;;) {
                                std::string f = r.string();
                                if (!r.expect(':')) return false;
                                r.ws();
                                if (f == "x") d.x = c.x = r.number();
                                else if (f == "y") d.y = c.y = r.number();
                                else if (f == "z") d.z = c.z = r.number();
                                else if (f == "sort") { if (r.take('n')) { r.i += 3; } else d.sort = r.string(); }
                                else if (f == "xp") d.xp = static_cast<uint32_t>(r.number());
                                else if (f == "hits") d.hits = static_cast<uint32_t>(r.number());
                                else if (f == "first") d.first = static_cast<int64_t>(r.number());
                                else if (f == "last") d.last = static_cast<int64_t>(r.number());
                                else if (f == "by" && key == "ore") {
                                    if (!r.expect('[')) return false;
                                    if (!r.take(']')) {
                                        for (;;) { d.by.push_back(r.string()); if (r.take(']')) break; if (!r.expect(',')) return false; }
                                    }
                                } else if (f == "by") c.by = r.string();
                                else if (f == "poi") { if (r.take('n')) { r.i += 3; c.poi = -1; } else c.poi = static_cast<int>(r.number()); }
                                else if (f == "at") c.at = static_cast<int64_t>(r.number());
                                else if (f == "rl") { if (r.take('t')) { r.i += 3; c.rl = 1; } else if (r.take('f')) { r.i += 4; c.rl = 0; } else { r.i += 4; c.rl = -1; } }
                                else r.skip_value();
                                if (!r.ok) return false;
                                if (r.take('}')) break;
                                if (!r.expect(',')) return false;
                            }
                        }
                        if (key == "ore") ore.push_back(d); else chests.push_back(c);
                        if (r.take(']')) break;
                        if (!r.expect(',')) return false;
                    }
                }
            } else {
                r.skip_value();
            }
            if (!r.ok) return false;
            if (r.take('}')) break;
            if (!r.expect(',')) return false;
        }
    }
    std::lock_guard lock(mutex_);
    ore_ = std::move(ore);
    chests_ = std::move(chests);
    version_ = version;
    return true;
}

}  // namespace livemap::finds
