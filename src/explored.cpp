#include "explored.h"

#include <cmath>
#include <cstdio>

namespace livemap::explored {

namespace {

constexpr size_t kBytes = static_cast<size_t>(kCells) * kCells / 8;
const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

}  // namespace

std::string base64(const std::vector<uint8_t>& d) {
    std::string out;
    out.reserve((d.size() + 2) / 3 * 4);
    for (size_t i = 0; i < d.size(); i += 3) {
        uint32_t v = static_cast<uint32_t>(d[i]) << 16;
        if (i + 1 < d.size()) v |= static_cast<uint32_t>(d[i + 1]) << 8;
        if (i + 2 < d.size()) v |= d[i + 2];
        out += kAlphabet[(v >> 18) & 63];
        out += kAlphabet[(v >> 12) & 63];
        out += i + 1 < d.size() ? kAlphabet[(v >> 6) & 63] : '=';
        out += i + 2 < d.size() ? kAlphabet[v & 63] : '=';
    }
    return out;
}

bool unbase64(const std::string& t, std::vector<uint8_t>& out) {
    auto val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    if (t.size() % 4) return false;
    out.clear();
    for (size_t i = 0; i < t.size(); i += 4) {
        int a = val(t[i]), b = val(t[i + 1]), c = t[i + 2] == '=' ? 0 : val(t[i + 2]), d = t[i + 3] == '=' ? 0 : val(t[i + 3]);
        if (a < 0 || b < 0 || c < 0 || d < 0) return false;
        uint32_t v = (a << 18) | (b << 12) | (c << 6) | d;
        out.push_back(static_cast<uint8_t>(v >> 16));
        if (t[i + 2] != '=') out.push_back(static_cast<uint8_t>(v >> 8));
        if (t[i + 3] != '=') out.push_back(static_cast<uint8_t>(v));
    }
    return true;
}

bool Store::reveal(const std::string& name, double x, double z) {
    if (!(x >= -kRadiusMetres && x <= kCells * kCellMetres + kRadiusMetres && z >= -kRadiusMetres &&
          z <= kCells * kCellMetres + kRadiusMetres)) {
        return false;
    }
    const int r = static_cast<int>(std::ceil(kRadiusMetres / kCellMetres));
    const int cx = static_cast<int>(std::floor(x / kCellMetres)), cz = static_cast<int>(std::floor(z / kCellMetres));
    std::lock_guard lock(mutex_);
    std::vector<uint8_t>& g = grids_[name];
    if (g.size() != kBytes) g.assign(kBytes, 0);
    bool changed = false;
    for (int dz = -r; dz <= r; ++dz) {
        const int row = cz + dz;
        if (row < 0 || row >= kCells) continue;
        const double mz = (row + 0.5) * kCellMetres - z;
        for (int dx = -r; dx <= r; ++dx) {
            const int col = cx + dx;
            if (col < 0 || col >= kCells) continue;
            const double mx = (col + 0.5) * kCellMetres - x;
            if (mx * mx + mz * mz > kRadiusMetres * kRadiusMetres) continue;
            const size_t bit = static_cast<size_t>(row) * kCells + col;
            const uint8_t mask = static_cast<uint8_t>(1u << (bit & 7));
            if (!(g[bit >> 3] & mask)) {
                g[bit >> 3] |= mask;
                changed = true;
            }
        }
    }
    if (changed) ++version_;
    return changed;
}

bool Store::explored(const std::string& name, double x, double z) {
    const int col = static_cast<int>(std::floor(x / kCellMetres)), row = static_cast<int>(std::floor(z / kCellMetres));
    if (col < 0 || row < 0 || col >= kCells || row >= kCells) return false;
    std::lock_guard lock(mutex_);
    auto it = grids_.find(name);
    if (it == grids_.end()) return false;
    const size_t bit = static_cast<size_t>(row) * kCells + col;
    return (it->second[bit >> 3] >> (bit & 7)) & 1;
}

std::string Store::to_json() {
    std::lock_guard lock(mutex_);
    std::string out = "{\"version\":" + std::to_string(version_) + ",\"cells\":" + std::to_string(kCells) +
                      ",\"cellMetres\":" + std::to_string(static_cast<int>(kCellMetres)) + ",\"players\":{";
    bool first = true;
    for (const auto& [name, g] : grids_) {
        out += first ? "\"" : ",\"";
        first = false;
        append_escaped(out, name);
        out += "\":\"" + base64(g) + "\"";
    }
    out += "}}";
    return out;
}

bool Store::from_json(const std::string& t) {
    size_t i = t.find("\"players\"");
    if (i == std::string::npos || t.find("\"cells\":" + std::to_string(kCells)) == std::string::npos) return false;
    i = t.find('{', i);
    if (i == std::string::npos) return false;
    std::map<std::string, std::vector<uint8_t>> loaded;
    for (++i;;) {
        while (i < t.size() && (t[i] == ' ' || t[i] == ',' || t[i] == '\n' || t[i] == '\r')) ++i;
        if (i >= t.size()) return false;
        if (t[i] == '}') break;
        if (t[i] != '"') return false;
        std::string name;
        for (++i; i < t.size() && t[i] != '"'; ++i) {
            if (t[i] == '\\' && i + 1 < t.size()) ++i;
            name += t[i];
        }
        i = t.find('"', i + 1);  // the value's opening quote (after the colon)
        if (i == std::string::npos) return false;
        size_t end = t.find('"', i + 1);
        if (end == std::string::npos) return false;
        std::vector<uint8_t> g;
        if (!unbase64(t.substr(i + 1, end - i - 1), g) || g.size() != kBytes) return false;
        loaded[name] = std::move(g);
        i = end + 1;
    }
    std::lock_guard lock(mutex_);
    grids_ = std::move(loaded);
    ++version_;
    return true;
}

uint64_t Store::version() {
    std::lock_guard lock(mutex_);
    return version_;
}

size_t Store::players() {
    std::lock_guard lock(mutex_);
    return grids_.size();
}

}  // namespace livemap::explored
