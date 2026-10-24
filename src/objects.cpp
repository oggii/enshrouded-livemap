#include "objects.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace livemap::objects {

namespace {

void append_escaped(std::string& out, const std::string& s) {
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c >= 0x20) {
            out += static_cast<char>(c);
        }
    }
}

// Minimal reader for the store's own JSON: the objects of the array after "key":[ as bodies.
std::vector<std::string> objects_in(const std::string& t, const char* key) {
    std::vector<std::string> out;
    const std::string k = std::string("\"") + key + "\":[";
    size_t i = t.find(k);
    if (i == std::string::npos) return out;
    i += k.size();
    while (i < t.size() && t[i] != ']') {
        if (t[i] != '{') { ++i; continue; }
        size_t end = t.find('}', i);
        if (end == std::string::npos) break;
        out.push_back(t.substr(i + 1, end - i - 1));
        i = end + 1;
    }
    return out;
}

double number(const std::string& body, const char* key, double fallback) {
    const std::string k = std::string("\"") + key + "\":";
    size_t at = body.find(k);
    return at == std::string::npos ? fallback : std::strtod(body.c_str() + at + k.size(), nullptr);
}

bool flag(const std::string& body, const char* key) {
    return body.find(std::string("\"") + key + "\":true") != std::string::npos;
}

std::string text(const std::string& body, const char* key) {
    const std::string k = std::string("\"") + key + "\":\"";
    size_t at = body.find(k);
    if (at == std::string::npos) return {};
    std::string out;
    for (size_t i = at + k.size(); i < body.size() && body[i] != '"'; ++i) {
        if (body[i] == '\\' && i + 1 < body.size()) ++i;
        out += body[i];
    }
    return out;
}

std::string place_key(const std::string& tpl, float x, float z) {
    return tpl + "@" + std::to_string(std::lround(x)) + "," + std::to_string(std::lround(z));
}

}  // namespace

std::string chest_key(const Chest& c) {
    return c.id != 0 ? "#" + std::to_string(c.id) : place_key(c.tpl, c.x, c.z);
}

std::string switch_key(const Switch& s) {
    return place_key(s.tpl, s.x, s.z);
}

bool Store::update(const std::vector<Chest>& chests, const std::vector<Switch>& switches, int64_t now) {
    std::lock_guard lock(mutex_);
    bool changed = false;
    for (const Chest& c : chests) {
        auto [it, added] = chests_.try_emplace(chest_key(c), ChestRec{c, now});
        if (added) { changed = true; continue; }
        if (it->second.c.empty != c.empty) { it->second.at = now; changed = true; }
        it->second.c = c;
    }
    for (const Switch& s : switches) {
        auto [it, added] = switches_.try_emplace(switch_key(s), SwitchRec{s, now});
        if (added) { changed = true; continue; }
        if (it->second.s.on != s.on) { it->second.at = now; changed = true; }
        it->second.s = s;
    }
    if (changed) ++version_;
    return changed;
}

void Store::set_creatures(std::vector<Creature> creatures) {
    std::lock_guard lock(mutex_);
    if (creatures.empty() && creatures_.empty()) return;
    creatures_ = std::move(creatures);
    ++creatures_version_;
}

std::string Store::objects_json() {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"chests\":[";
    bool first = true;
    char buf[160];
    for (const auto& [key, r] : chests_) {
        std::snprintf(buf, sizeof buf, "%s{\"id\":%u,\"t\":\"", first ? "" : ",", r.c.id);
        out += buf;
        append_escaped(out, r.c.tpl);
        std::snprintf(buf, sizeof buf, "\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"empty\":%s,\"at\":%lld}", r.c.x, r.c.y, r.c.z,
                      r.c.empty ? "true" : "false", static_cast<long long>(r.at));
        out += buf;
        first = false;
    }
    out += "],\"switches\":[";
    first = true;
    for (const auto& [key, r] : switches_) {
        out += first ? "{\"t\":\"" : ",{\"t\":\"";
        append_escaped(out, r.s.tpl);
        std::snprintf(buf, sizeof buf, "\",\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"k\":\"%c\",\"on\":%s,\"at\":%lld}", r.s.x, r.s.y, r.s.z, r.s.kind,
                      r.s.on ? "true" : "false", static_cast<long long>(r.at));
        out += buf;
        first = false;
    }
    out += "]}";
    return out;
}

std::string Store::creatures_json() {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(creatures_version_) + ",\"creatures\":[";
    char buf[200];
    for (size_t i = 0; i < creatures_.size(); ++i) {
        const Creature& c = creatures_[i];
        std::snprintf(buf, sizeof buf, "%s{\"e\":%u,\"t\":\"", i ? "," : "", c.entity);
        out += buf;
        append_escaped(out, c.tpl);
        std::snprintf(buf, sizeof buf, "\",\"x\":%.1f,\"z\":%.1f,\"hp\":%u,\"max\":%u,\"s\":%u,\"lv\":%u,\"boss\":%s,\"animal\":%s}",
                      c.x, c.z, c.hp, c.max, c.state, c.level, c.boss ? "true" : "false", c.animal ? "true" : "false");
        out += buf;
    }
    out += "]}";
    return out;
}

bool Store::from_json(const std::string& t) {
    if (t.find("\"chests\":[") == std::string::npos || t.find("\"switches\":[") == std::string::npos) return false;
    std::map<std::string, ChestRec> chests;
    std::map<std::string, SwitchRec> switches;
    for (const std::string& b : objects_in(t, "chests")) {
        ChestRec r;
        r.c.id = static_cast<uint32_t>(number(b, "id", 0));
        r.c.tpl = text(b, "t");
        r.c.x = static_cast<float>(number(b, "x", -1));
        r.c.y = static_cast<float>(number(b, "y", 0));
        r.c.z = static_cast<float>(number(b, "z", -1));
        r.c.empty = flag(b, "empty");
        r.at = static_cast<int64_t>(number(b, "at", 0));
        if (r.c.tpl.empty() || r.c.x < 0 || r.c.z < 0) return false;
        chests[chest_key(r.c)] = r;
    }
    for (const std::string& b : objects_in(t, "switches")) {
        SwitchRec r;
        r.s.tpl = text(b, "t");
        r.s.x = static_cast<float>(number(b, "x", -1));
        r.s.y = static_cast<float>(number(b, "y", 0));
        r.s.z = static_cast<float>(number(b, "z", -1));
        const std::string k = text(b, "k");
        r.s.kind = k.empty() ? 's' : k[0];
        r.s.on = flag(b, "on");
        r.at = static_cast<int64_t>(number(b, "at", 0));
        if (r.s.tpl.empty() || r.s.x < 0 || r.s.z < 0) return false;
        switches[switch_key(r.s)] = r;
    }
    std::lock_guard lock(mutex_);
    chests_ = std::move(chests);
    switches_ = std::move(switches);
    ++version_;
    return true;
}

uint64_t Store::version() {
    std::lock_guard lock(mutex_);
    return version_;
}

uint64_t Store::creatures_version() {
    std::lock_guard lock(mutex_);
    return creatures_version_;
}

size_t Store::chests() {
    std::lock_guard lock(mutex_);
    return chests_.size();
}

size_t Store::switches() {
    std::lock_guard lock(mutex_);
    return switches_.size();
}

}  // namespace livemap::objects
