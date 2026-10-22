// livemap: a live web map for an Enshrouded dedicated server (players, time of day).
// Loaded by the server as iphlpapi.dll (Wine: WINEDLLOVERRIDES="iphlpapi=n,b"), so it can sit next
// to mods that use powrprof.dll (Shared XP) or dinput8.dll (Quest Catch-Up).
#include <windows.h>

#include <string>

#include "config.h"
#include "log.h"
#include "proxy.h"
#include "scan.h"
#include "web.h"
#include "world.h"
#include "announce.h"
#include "link.h"
#include "public_ip.h"

#include <mutex>

#include <cstdio>
#include <thread>

namespace {

constexpr const char* kVersion = LIVEMAP_VERSION;  // from project() in CMakeLists.txt
bool g_real_loaded = false;

std::wstring exe_dir() {
    wchar_t path[MAX_PATH];
    DWORD len = GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::wstring dir(path, len);
    return dir.substr(0, dir.find_last_of(L"\\/"));
}

// The link to share: PublicUrl from livemap.ini, or the public IP asked once an hour.
std::mutex g_link_mutex;
std::string g_link;

std::string current_link() {
    std::lock_guard lock(g_link_mutex);
    return g_link;
}

void set_link(const std::string& value) {
    {
        std::lock_guard lock(g_link_mutex);
        if (g_link == value) return;
        g_link = value;
    }
    livemap::log("map link: %s", value.c_str());
}

void start_link(const livemap::Config& config) {
    if (!config.public_url.empty()) {
        set_link(livemap::link::make(config.public_url, "", config.port, config.key));
        return;
    }
    if (!config.detect_public_address) {
        livemap::log("map link: unknown (DetectPublicAddress=0 and no PublicUrl); open port %d over TCP and share "
                     "http://<server address>:%d/?key=<Key>", config.port, config.port);
        return;
    }
    livemap::Config c = config;
    std::thread([c] {
        for (;;) {
            std::string error;
            std::string ip = livemap::public_ip::detect(error);
            if (!ip.empty()) {
                set_link(livemap::link::make("", ip, c.port, c.key));
                Sleep(60 * 60 * 1000);
            } else {
                livemap::log("map link: public address unknown (%s), retry in 5 minutes", error.c_str());
                Sleep(5 * 60 * 1000);
            }
        }
    }).detach();
}

DWORD WINAPI start(LPVOID) {
    std::wstring dir = exe_dir();
    livemap::Config config = livemap::load_config(dir);
    livemap::log_open(dir, config.log);
    livemap::log("livemap %s starting: Enabled=%d Port=%d%s real iphlpapi %s", kVersion, config.enabled, config.port,
                 config.port_from_game ? " (auto: the game's queryPort, TCP)" : "", g_real_loaded ? "loaded" : "MISSING");
    if (!livemap::link::key_ok(config.key)) {
        livemap::log("WARNING: Key in livemap.ini should be 3 to 64 letters, digits, - or _ (and not state, events, "
                     "finds, icons, index, livemap); other characters can break the link");
    }
    if (!config.enabled) {
        livemap::log("disabled in livemap.ini");
        return 0;
    }
    livemap::Targets targets;
    std::string error;
    auto base = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
    if (!livemap::find_targets(base, targets, error) || !livemap::world::install(targets, error)) {
        livemap::log("%s; no live map", error.c_str());
        return 0;
    }
    if (config.finds) {
        livemap::world::install_mining(targets);
        livemap::world::install_chest(targets);
    } else {
        livemap::log("finds off in livemap.ini (Finds=0)");
    }
    if (config.chat_probe) livemap::world::enable_chat_probe(targets);
    const std::wstring finds_path = dir + L"\\livemap\\finds.json";
    if (FILE* f = _wfopen(finds_path.c_str(), L"rb")) {
        std::string text;
        char buf[65536];
        size_t n;
        while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) text.append(buf, n);
        std::fclose(f);
        if (livemap::world::store().from_json(text)) {
            livemap::log("finds: %zu ore deposits, %zu chests loaded", livemap::world::store().deposits(),
                         livemap::world::store().chests());
        } else {
            livemap::log("finds: could not read livemap\\finds.json, starting empty (file left as is)");
        }
    }
    uint64_t saved_version = livemap::world::store().version();
    uint64_t last_save = 0;
    if (!livemap::web::start(config, dir, error)) {
        livemap::log("%s; no live map", error.c_str());
        return 0;
    }
    start_link(config);
    if (config.announce_in_chat) {
        const int port = config.port;
        livemap::install_announce(base, [port] { return livemap::link::chat_line(current_link(), port); });
    }
    uint64_t last_diag = 0;
    for (;;) {
        livemap::world::refresh_players();
        uint64_t now = GetTickCount64();
        // Finds go to disk at most every 5 s, written to a temp file and renamed into place.
        if (now - last_save >= 5'000 && livemap::world::store().version() != saved_version) {
            last_save = now;
            uint64_t version = livemap::world::store().version();
            std::string text = livemap::world::store().to_json();
            std::wstring tmp = finds_path + L".tmp";
            bool ok = false;
            if (FILE* f = _wfopen(tmp.c_str(), L"wb")) {
                ok = std::fwrite(text.data(), 1, text.size(), f) == text.size();
                std::fclose(f);
            }
            if (ok && MoveFileExW(tmp.c_str(), finds_path.c_str(), MOVEFILE_REPLACE_EXISTING)) saved_version = version;
            else livemap::log("finds: could not write livemap\\finds.json (error %lu), will retry", GetLastError());
        }
        if (config.log_diagnostics && now - last_diag >= 30'000) {
            last_diag = now;
            livemap::world::log_diagnostics();
        }
        Sleep(250);
    }
}

}  // namespace

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(self);
        g_real_loaded = livemap::load_real_library(self);
        if (HANDLE thread = CreateThread(nullptr, 0, start, nullptr, 0, nullptr)) {
            CloseHandle(thread);
        }
    }
    return TRUE;
}
