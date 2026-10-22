#include "link.h"

#include <cctype>
#include <cstdlib>
#include <string>

namespace livemap::link {

int query_port(const std::string& json) {
    size_t at = json.find("\"queryPort\"");
    if (at == std::string::npos) return 0;
    at = json.find(':', at);
    if (at == std::string::npos) return 0;
    ++at;
    while (at < json.size() && std::isspace(static_cast<unsigned char>(json[at]))) ++at;
    char* end = nullptr;
    long v = std::strtol(json.c_str() + at, &end, 10);
    if (end == json.c_str() + at || v < 1 || v > 65535) return 0;
    return static_cast<int>(v);
}

bool valid_ip(const std::string& t) {
    if (t.empty() || t.size() > 45) return false;
    if (t.find(':') != std::string::npos) {  // IPv6: hex digits, colons, at most one "::"
        for (char c : t) {
            if (!(std::isxdigit(static_cast<unsigned char>(c)) || c == ':')) return false;
        }
        return t.find("::") == t.rfind("::");
    }
    int parts = 0;
    size_t i = 0;
    while (i <= t.size()) {
        size_t j = t.find('.', i);
        if (j == std::string::npos) j = t.size();
        if (j == i || j - i > 3) return false;
        for (size_t k = i; k < j; ++k) {
            if (!std::isdigit(static_cast<unsigned char>(t[k]))) return false;
        }
        if (std::atoi(t.substr(i, j - i).c_str()) > 255) return false;
        ++parts;
        i = j + 1;
    }
    return parts == 4;
}

std::string make(const std::string& public_url, const std::string& ip, int port, const std::string& key) {
    std::string base;
    if (!public_url.empty()) {
        base = public_url;
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (base.find("://") == std::string::npos) base = "http://" + base;
    } else if (valid_ip(ip) && port > 0) {
        base = "http://" + (ip.find(':') != std::string::npos ? "[" + ip + "]" : ip) + ":" + std::to_string(port);
    } else {
        return {};
    }
    return base + "/?key=" + key;
}

std::string short_form(const std::string& link) {
    std::string s = link;
    for (const char* scheme : {"https://", "http://"}) {
        if (s.rfind(scheme, 0) == 0) s = s.substr(std::char_traits<char>::length(scheme));
    }
    if (size_t q = s.find("/?key="); q != std::string::npos) s = s.substr(0, q) + "/" + s.substr(q + 6);
    return s;
}

bool key_ok(const std::string& key) {
    if (key.size() < 3 || key.size() > 64) return false;
    for (char c : key) {
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_')) return false;
    }
    static const char* kReserved[] = {"state", "events", "finds", "icons", "index", "livemap"};
    for (const char* r : kReserved) {
        if (key_equal(key, r)) return false;
    }
    return true;
}

bool key_equal(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
    }
    return true;
}

std::string chat_line(const std::string& link, int port) {
    if (!link.empty()) return "Live map: " + short_form(link);
    return "Live map is running on port " + std::to_string(port) + " (TCP). The admin finds the link in livemap.log.";
}

}  // namespace livemap::link
