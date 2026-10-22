#include "bases.h"

#include <cmath>
#include <cstdio>

namespace livemap::bases {

void Store::prune(uint64_t now_ms) {
    for (auto it = bases_.begin(); it != bases_.end();) {
        if (now_ms > it->second.seen_ms + kStaleMs) {
            it = bases_.erase(it);
            ++version_;
        } else {
            ++it;
        }
    }
}

void Store::see(uint64_t id_lo, uint64_t id_hi, const Base& b, uint64_t now_ms) {
    std::lock_guard lock(mutex_);
    auto [it, inserted] = bases_.try_emplace({id_lo, id_hi}, b);
    Base& old = it->second;
    if (inserted) {
        ++version_;
    } else if (std::fabs(old.x - b.x) > 0.5 || std::fabs(old.z - b.z) > 0.5 || std::fabs(old.y - b.y) > 0.5 ||
               old.size_x != b.size_x || old.size_y != b.size_y || old.size_z != b.size_z || old.abandoned != b.abandoned) {
        old = b;
        ++version_;
    }
    old.seen_ms = now_ms;
}

std::string Store::to_json(uint64_t now_ms) {
    std::lock_guard lock(mutex_);
    prune(now_ms);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"bases\":[";
    bool first = true;
    char buf[200];
    for (const auto& [id, b] : bases_) {
        std::snprintf(buf, sizeof buf, "%s{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"size\":[%.1f,%.1f,%.1f],\"abandoned\":%s}",
                      first ? "" : ",", b.x, b.y, b.z, b.size_x, b.size_y, b.size_z, b.abandoned ? "true" : "false");
        out += buf;
        first = false;
    }
    out += "]}";
    return out;
}

uint64_t Store::version(uint64_t now_ms) {
    std::lock_guard lock(mutex_);
    prune(now_ms);
    return version_;
}

size_t Store::count(uint64_t now_ms) {
    std::lock_guard lock(mutex_);
    prune(now_ms);
    return bases_.size();
}

}  // namespace livemap::bases
