#include "web.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <atomic>
#include <cstdio>
#include <cctype>
#include <cstring>
#include <string>
#include <thread>

#include "link.h"
#include "log.h"
#include "world.h"

namespace livemap::web {

namespace {

constexpr int kMaxClients = 32;

Config g_config;
std::wstring g_web_dir;
std::atomic<int> g_clients{0};

bool send_all(SOCKET s, const char* data, size_t size) {
    while (size > 0) {
        int n = send(s, data, static_cast<int>(size > 65536 ? 65536 : size), 0);
        if (n <= 0) return false;
        data += n;
        size -= static_cast<size_t>(n);
    }
    return true;
}

bool send_response(SOCKET s, const char* status, const char* type, const std::string& body,
                   const char* cache = "no-store", const char* extra = "") {
    char head[400];
    int n = std::snprintf(head, sizeof head,
                          "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\n"
                          "Cache-Control: %s\r\n%sConnection: close\r\n\r\n",
                          status, type, body.size(), cache, extra);
    return send_all(s, head, static_cast<size_t>(n)) && send_all(s, body.data(), body.size());
}

const char* content_type(const std::string& path) {
    auto ends = [&](const char* ext) {
        size_t n = std::strlen(ext);
        return path.size() >= n && path.compare(path.size() - n, n, ext) == 0;
    };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".json")) return "application/json";
    if (ends(".png")) return "image/png";
    if (ends(".jpg") || ends(".jpeg")) return "image/jpeg";
    if (ends(".webp")) return "image/webp";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".woff2")) return "font/woff2";
    if (ends(".txt")) return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

bool read_file(const std::string& rel, std::string& out) {
    std::wstring path = g_web_dir;
    for (char c : rel) path += (c == '/') ? L'\\' : static_cast<wchar_t>(c);
    FILE* f = _wfopen(path.c_str(), L"rb");
    if (f == nullptr) return false;
    char buf[65536];
    size_t n;
    out.clear();
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    std::fclose(f);
    return true;
}

// Value of `name` in the query string, or "".
std::string query_param(const std::string& query, const char* name) {
    std::string key = std::string(name) + "=";
    size_t pos = 0;
    while (pos < query.size()) {
        size_t end = query.find('&', pos);
        if (end == std::string::npos) end = query.size();
        if (query.compare(pos, key.size(), key) == 0) return query.substr(pos + key.size(), end - pos - key.size());
        pos = end + 1;
    }
    return {};
}

// True if the request's Accept-Encoding header lists gzip.
bool accepts_gzip(const std::string& req) {
    size_t pos = 0;
    while ((pos = req.find("\n", pos)) != std::string::npos) {
        ++pos;
        if (req.compare(pos, 16, "Accept-Encoding:") == 0 || req.compare(pos, 16, "accept-encoding:") == 0) {
            size_t end = req.find("\r\n", pos);
            return req.substr(pos, end == std::string::npos ? std::string::npos : end - pos).find("gzip") != std::string::npos;
        }
    }
    return false;
}

// Only plain file names and one folder level: letters, digits, '-', '_', '.', '/', no "..".
bool safe_path(const std::string& p) {
    if (p.empty() || p.find("..") != std::string::npos || p[0] == '/') return false;
    for (char c : p) {
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_' || c == '.' || c == '/')) return false;
    }
    return true;
}

void stream_events(SOCKET s) {
    const char* head =
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\n"
        "Connection: keep-alive\r\nX-Accel-Buffering: no\r\n\r\n";
    if (!send_all(s, head, std::strlen(head))) return;
    for (;;) {
        std::string msg = "data: " + world::snapshot_json() + "\n\n";
        if (!send_all(s, msg.data(), msg.size())) return;
        Sleep(static_cast<DWORD>(g_config.update_ms));
    }
}

void handle(SOCKET s) {
    DWORD timeout = 5000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof timeout);
    std::string req;
    char buf[2048];
    while (req.find("\r\n\r\n") == std::string::npos && req.size() < 16384) {
        int n = recv(s, buf, sizeof buf, 0);
        if (n <= 0) return;
        req.append(buf, n);
    }
    size_t sp1 = req.find(' ');
    size_t sp2 = sp1 == std::string::npos ? std::string::npos : req.find(' ', sp1 + 1);
    if (sp2 == std::string::npos || req.compare(0, sp1, "GET") != 0) {
        send_response(s, "405 Method Not Allowed", "text/plain", "GET only\n");
        return;
    }
    std::string target = req.substr(sp1 + 1, sp2 - sp1 - 1);
    std::string path = target, query;
    if (size_t q = target.find('?'); q != std::string::npos) {
        path = target.substr(0, q);
        query = target.substr(q + 1);
    }
    // The short link: /<key> (typed from the chat) goes to the page with ?key=.
    if (query.empty() && path.size() > 1 && !g_config.key.empty() && link::key_equal(path.substr(1), g_config.key)) {
        send_response(s, "302 Found", "text/plain", "", "no-store", ("Location: /?key=" + g_config.key + "\r\n").c_str());
        return;
    }
    if (g_config.key.empty() || !link::key_equal(query_param(query, "key"), g_config.key)) {
        send_response(s, "403 Forbidden", "text/plain", "Open the map with ?key=<Key from livemap.ini>\n");
        return;
    }
    if (path == "/state") {
        send_response(s, "200 OK", "application/json", world::snapshot_json());
        return;
    }
    if (path == "/finds") {
        send_response(s, "200 OK", "application/json", world::store().to_json());
        return;
    }
    if (path == "/explored") {
        send_response(s, "200 OK", "application/json", world::explored_store().to_json());
        return;
    }
    if (path == "/discovered") {
        send_response(s, "200 OK", "application/json", world::discovered_store().to_json());
        return;
    }
    if (path == "/objects") {
        send_response(s, "200 OK", "application/json", world::objects_store().objects_json());
        return;
    }
    if (path == "/creatures") {
        send_response(s, "200 OK", "application/json", world::objects_store().creatures_json());
        return;
    }
    if (path == "/deaths") {
        send_response(s, "200 OK", "application/json", world::deaths_store().to_json());
        return;
    }
    if (path == "/bases") {
        send_response(s, "200 OK", "application/json", world::bases_store().to_json(GetTickCount64()));
        return;
    }
    if (path == "/events") {
        stream_events(s);
        return;
    }
    std::string rel = path == "/" ? "index.html" : path.substr(1);
    if (!safe_path(rel)) {
        send_response(s, "404 Not Found", "text/plain", "not found\n");
        return;
    }
    // A pre-compressed twin (file.gz, written by tools/extract_pois.py) is sent as is to
    // browsers that accept gzip: the data files shrink to a fifth.
    std::string body;
    const char* encoding = "";
    if (accepts_gzip(req) && read_file(rel + ".gz", body)) {
        encoding = "Content-Encoding: gzip\r\n";
    } else if (!read_file(rel, body)) {
        send_response(s, "404 Not Found", "text/plain", "not found\n");
        return;
    }
    // Map images and icons change only with a new release, data files rarely: let browsers keep
    // them. The page itself is always fetched, so an update shows at the next load.
    const char* type = content_type(rel);
    const char* cache = std::strncmp(type, "image/", 6) == 0 ? "public, max-age=86400"
                        : rel == "index.html" ? "no-store" : "public, max-age=600";
    send_response(s, "200 OK", type, body, cache, encoding);
}

void serve(SOCKET listener) {
    for (;;) {
        SOCKET s = accept(listener, nullptr, nullptr);
        if (s == INVALID_SOCKET) {
            Sleep(100);
            continue;
        }
        if (g_clients.load() >= kMaxClients) {
            closesocket(s);
            continue;
        }
        ++g_clients;
        std::thread([s] {
            handle(s);
            shutdown(s, SD_BOTH);
            closesocket(s);
            --g_clients;
        }).detach();
    }
}

}  // namespace

bool start(const Config& config, const std::wstring& exe_dir, std::string& error) {
    g_config = config;
    g_web_dir = exe_dir + L"\\livemap\\";
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        error = "WSAStartup failed";
        return false;
    }
    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) {
        error = "socket failed";
        return false;
    }
    BOOL yes = TRUE;
    setsockopt(listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&yes), sizeof yes);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<u_short>(config.port));
    if (inet_pton(AF_INET, config.bind.c_str(), &addr.sin_addr) != 1) {
        error = "invalid Bind address " + config.bind;
        closesocket(listener);
        return false;
    }
    if (bind(listener, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || listen(listener, 16) != 0) {
        error = "could not listen on " + config.bind + ":" + std::to_string(config.port) + " (error " +
                std::to_string(WSAGetLastError()) + ")";
        closesocket(listener);
        return false;
    }
    std::thread(serve, listener).detach();
    log("web map listening on %s:%d (TCP)", config.bind.c_str(), config.port);
    return true;
}

}  // namespace livemap::web
