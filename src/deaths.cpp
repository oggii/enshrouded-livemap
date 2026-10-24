#include "deaths.h"

#include <cstdio>
#include <cstdlib>

namespace livemap::deaths {

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

// Minimal reader for the store's own JSON.
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

// The number after "key": in body, or fallback.
double number(const std::string& body, const char* key, double fallback) {
    const std::string k = std::string("\"") + key + "\":";
    size_t at = body.find(k);
    return at == std::string::npos ? fallback : std::strtod(body.c_str() + at + k.size(), nullptr);
}

bool flag(const std::string& body, const char* key) {
    const std::string k = std::string("\"") + key + "\":true";
    return body.find(k) != std::string::npos;
}

}  // namespace

void Store::record(const Death& d) {
    std::lock_guard lock(mutex_);
    Player& p = players_[d.name];
    ++p.count;
    if (d.cause >= 0 && d.cause < kCauses) ++p.causes[static_cast<size_t>(d.cause)];
    p.at = d.at;
    recent_.push_back(d);
    while (recent_.size() > kRecent) recent_.pop_front();
    ++version_;
}

std::string Store::to_json() {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"players\":{";
    bool first = true;
    for (const auto& [name, p] : players_) {
        out += first ? "\"" : ",\"";
        first = false;
        append_escaped(out, name);
        out += "\":{\"count\":" + std::to_string(p.count) + ",\"causes\":[";
        for (int i = 0; i < kCauses; ++i) out += (i ? "," : "") + std::to_string(p.causes[static_cast<size_t>(i)]);
        out += "],\"at\":" + std::to_string(p.at) + "}";
    }
    out += "},\"recent\":[";
    first = true;
    for (const Death& d : recent_) {
        out += first ? "{\"name\":\"" : ",{\"name\":\"";
        first = false;
        append_escaped(out, d.name);
        char buf[160];
        std::snprintf(buf, sizeof buf, "\",\"at\":%lld,\"cause\":%d,\"x\":%.1f,\"z\":%.1f,\"fog\":%s,\"drowned\":%s}",
                      static_cast<long long>(d.at), d.cause, d.x, d.z, d.fog ? "true" : "false", d.drowned ? "true" : "false");
        out += buf;
    }
    out += "]}";
    return out;
}

bool Store::from_json(const std::string& t) {
    std::map<std::string, Player> players;
    std::deque<Death> recent;
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
        p.count = static_cast<int>(number(body, "count", 0));
        p.at = static_cast<int64_t>(number(body, "at", 0));
        size_t c = body.find("\"causes\":[");
        if (c != std::string::npos) {
            const char* s = body.c_str() + c + 10;
            for (int k = 0; k < kCauses; ++k) {
                char* next = nullptr;
                p.causes[static_cast<size_t>(k)] = static_cast<int>(std::strtol(s, &next, 10));
                if (next == s) break;
                s = next;
                if (*s == ',') ++s;
            }
        }
        if (p.count < 0) return false;
        players[name] = p;
        i = end + 1;
    }
    size_t r = t.find("\"recent\":[");
    if (r != std::string::npos) {
        size_t j = r + 10;
        for (;;) {
            skip_ws(t, j);
            if (j >= t.size() || t[j] == ']') break;
            if (t[j] == ',') { ++j; continue; }
            if (t[j] != '{') return false;
            size_t name_at = t.find("\"name\":", j);
            if (name_at == std::string::npos) return false;
            size_t k = name_at + 7;
            Death d;
            if (!read_string(t, k, d.name)) return false;
            size_t end = t.find('}', k);
            if (end == std::string::npos) return false;
            const std::string body = t.substr(k, end - k);
            d.at = static_cast<int64_t>(number(body, "at", 0));
            d.cause = static_cast<int>(number(body, "cause", 0));
            d.x = static_cast<float>(number(body, "x", 0));
            d.z = static_cast<float>(number(body, "z", 0));
            d.fog = flag(body, "fog");
            d.drowned = flag(body, "drowned");
            recent.push_back(d);
            j = end + 1;
        }
    }
    while (recent.size() > kRecent) recent.pop_front();
    std::lock_guard lock(mutex_);
    players_ = std::move(players);
    recent_ = std::move(recent);
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

int Store::count(const std::string& name) {
    std::lock_guard lock(mutex_);
    auto it = players_.find(name);
    return it == players_.end() ? 0 : it->second.count;
}

}  // namespace livemap::deaths
