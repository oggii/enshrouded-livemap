#include "discovered.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <set>

namespace livemap::discovered {

namespace {

void append_escaped(std::string& out, const std::string& s) {
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            char buf[8];
            std::snprintf(buf, sizeof buf, "\\u%04x", c);
            out += buf;
        } else {
            out += static_cast<char>(c);
        }
    }
}

// Minimal reader for the store's own JSON: "name": {"online":b,"at":n,"keys":[n,...]}.
bool read_string(const std::string& t, size_t& i, std::string& out) {
    if (i >= t.size() || t[i] != '"') return false;
    ++i;
    out.clear();
    while (i < t.size() && t[i] != '"') {
        if (t[i] == '\\' && i + 1 < t.size()) {
            ++i;
            if (t[i] == 'u' && i + 4 < t.size()) {
                out += static_cast<char>(std::strtol(t.substr(i + 1, 4).c_str(), nullptr, 16));
                i += 4;
            } else {
                out += t[i];
            }
        } else {
            out += t[i];
        }
        ++i;
    }
    if (i >= t.size()) return false;
    ++i;
    return true;
}

void skip_ws(const std::string& t, size_t& i) {
    while (i < t.size() && (t[i] == ' ' || t[i] == '\n' || t[i] == '\r' || t[i] == '\t')) ++i;
}

}  // namespace

bool Store::update(const std::string& name, std::vector<uint32_t> keys, int64_t unix_now) {
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    std::lock_guard lock(mutex_);
    Player& p = players_[name];
    const bool was_online = p.online;
    p.online = true;
    if (p.keys == keys) {
        if (!was_online) ++version_;
        return false;
    }
    p.keys = std::move(keys);
    p.at = unix_now;
    ++version_;
    return true;
}

void Store::set_online(const std::vector<std::string>& names) {
    std::set<std::string> now(names.begin(), names.end());
    std::lock_guard lock(mutex_);
    for (auto& [name, p] : players_) {
        bool on = now.count(name) != 0;
        if (p.online != on) {
            p.online = on;
            ++version_;
        }
    }
}

std::string Store::to_json() {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"players\":{";
    bool first = true;
    for (const auto& [name, p] : players_) {
        out += first ? "\"" : ",\"";
        first = false;
        append_escaped(out, name);
        out += "\":{\"online\":";
        out += p.online ? "true" : "false";
        out += ",\"at\":" + std::to_string(p.at) + ",\"keys\":[";
        for (size_t i = 0; i < p.keys.size(); ++i) {
            if (i) out += ',';
            out += std::to_string(p.keys[i]);
        }
        out += "]}";
    }
    out += "}}";
    return out;
}

bool Store::from_json(const std::string& t) {
    std::map<std::string, Player> loaded;
    size_t i = t.find("\"players\"");
    if (i == std::string::npos) return false;
    i = t.find('{', i);
    if (i == std::string::npos) return false;
    ++i;
    for (;;) {
        skip_ws(t, i);
        if (i < t.size() && t[i] == '}') break;
        if (i < t.size() && t[i] == ',') ++i;
        skip_ws(t, i);
        std::string name;
        if (!read_string(t, i, name)) return false;
        size_t end = t.find('}', i);
        if (end == std::string::npos) return false;
        const std::string body = t.substr(i, end - i);
        Player p;
        size_t at = body.find("\"at\":");
        if (at != std::string::npos) p.at = std::strtoll(body.c_str() + at + 5, nullptr, 10);
        size_t k = body.find('[');
        size_t kend = body.find(']', k == std::string::npos ? 0 : k);
        if (k == std::string::npos || kend == std::string::npos) return false;
        const char* s = body.c_str() + k + 1;
        const char* stop = body.c_str() + kend;
        while (s < stop) {
            char* next = nullptr;
            unsigned long v = std::strtoul(s, &next, 10);
            if (next == s) break;
            p.keys.push_back(static_cast<uint32_t>(v));
            s = next;
            while (s < stop && (*s == ',' || *s == ' ')) ++s;
        }
        std::sort(p.keys.begin(), p.keys.end());
        loaded[name] = std::move(p);
        i = end + 1;
    }
    std::lock_guard lock(mutex_);
    players_ = std::move(loaded);
    ++version_;
    return true;
}

uint64_t Store::version() {
    std::lock_guard lock(mutex_);
    return version_;
}

size_t Store::players() {
    std::lock_guard lock(mutex_);
    return players_.size();
}

}  // namespace livemap::discovered
