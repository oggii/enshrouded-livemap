#include "config.h"

#include <windows.h>
#include <bcrypt.h>

#include <cstdio>
#include <cstdlib>
#include <string>

#include "link.h"

namespace livemap {

namespace {

std::string random_key() {
    unsigned char bytes[12] = {};
    BCryptGenRandom(nullptr, bytes, sizeof bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    static constexpr char kAlphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
    std::string key;
    for (unsigned char b : bytes) key += kAlphabet[b % (sizeof kAlphabet - 1)];
    return key;
}

std::string narrow(const wchar_t* s) {
    std::string out;
    for (; *s; ++s) out += (*s < 128) ? static_cast<char>(*s) : '?';
    return out;
}

}  // namespace

Config load_config(const std::wstring& dir) {
    std::wstring path = dir + L"\\livemap.ini";
    if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) {
        std::string text =
            "; Live map for Enshrouded dedicated servers.\n"
            "; The link to share is written to livemap.log (\"map link: ...\") and shown in the chat\n"
            "; when a player joins. Changes take effect after a server restart.\n"
            "[livemap]\n"
            "Enabled=1\n"
            "; auto = the same number as the game's queryPort in enshrouded_server.json, but TCP.\n"
            "; Open that port for TCP too (router: TCP/UDP; Docker: \"<port>:<port>/tcp\"), or set a number.\n"
            "Port=auto\n"
            "; Address people use from the internet. Empty = ask api.ipify.org for the public IP\n"
            "; (once an hour). Set it for a hostname or a tunnel, e.g. https://map.example.com\n"
            "PublicUrl=\n"
            "; 0 = never ask api.ipify.org (then set PublicUrl, or the link stays unknown).\n"
            "DetectPublicAddress=1\n"
            "; 1 = the chat shows the map link when a player joins (everyone online sees it).\n"
            "AnnounceInChat=1\n"
            "; 0.0.0.0 = all network interfaces, 127.0.0.1 = only this machine.\n"
            "Bind=0.0.0.0\n"
            "; Key in the link. Any word you like: 3 to 64 letters, digits, - or _ (case does not\n"
            "; matter). Players can type <address>/<Key>, e.g. 203.0.113.5:15637/ourmap. Short words are\n"
            "; easier to type but easier to guess. Everyone with the key sees all player positions;\n"
            "; change it to lock old links out.\n"
            "Key=" + random_key() + "\n"
            "; Milliseconds between updates of the page (100 to 5000).\n"
            "UpdateMs=250\n"
            "Log=1\n"
            "; 1 = log time and positions every 30 s (to check the mod reads the right values).\n"
            "LogDiagnostics=1\n";
        if (FILE* f = _wfopen(path.c_str(), L"wb")) {
            std::fwrite(text.data(), 1, text.size(), f);
            std::fclose(f);
        }
    }
    Config c;
    c.enabled = GetPrivateProfileIntW(L"livemap", L"Enabled", 1, path.c_str()) != 0;
    wchar_t buf[512];
    GetPrivateProfileStringW(L"livemap", L"Port", L"auto", buf, 32, path.c_str());
    std::string port = narrow(buf);
    int number = std::atoi(port.c_str());
    if (port.empty() || port == "auto" || number == 0) {
        c.port_from_game = true;
        c.port = 0;
        std::wstring json_path = dir + L"\\enshrouded_server.json";
        if (FILE* f = _wfopen(json_path.c_str(), L"rb")) {
            std::string json;
            char chunk[4096];
            size_t n;
            while ((n = std::fread(chunk, 1, sizeof chunk, f)) > 0 && json.size() < 1 << 20) json.append(chunk, n);
            std::fclose(f);
            c.port = link::query_port(json);
        }
        if (c.port == 0) c.port = 15680;
    } else {
        c.port = number >= 1 && number <= 65535 ? number : 15680;
    }
    GetPrivateProfileStringW(L"livemap", L"PublicUrl", L"", buf, 512, path.c_str());
    c.public_url = narrow(buf);
    c.detect_public_address = GetPrivateProfileIntW(L"livemap", L"DetectPublicAddress", 1, path.c_str()) != 0;
    c.announce_in_chat = GetPrivateProfileIntW(L"livemap", L"AnnounceInChat", 1, path.c_str()) != 0;
    GetPrivateProfileStringW(L"livemap", L"Bind", L"0.0.0.0", buf, 128, path.c_str());
    c.bind = narrow(buf);
    GetPrivateProfileStringW(L"livemap", L"Key", L"", buf, 128, path.c_str());
    c.key = narrow(buf);
    c.update_ms = static_cast<int>(GetPrivateProfileIntW(L"livemap", L"UpdateMs", 250, path.c_str()));
    if (c.update_ms < 100) c.update_ms = 100;
    if (c.update_ms > 5000) c.update_ms = 5000;
    c.log = GetPrivateProfileIntW(L"livemap", L"Log", 1, path.c_str()) != 0;
    c.log_diagnostics = GetPrivateProfileIntW(L"livemap", L"LogDiagnostics", 1, path.c_str()) != 0;
    c.finds = GetPrivateProfileIntW(L"livemap", L"Finds", 1, path.c_str()) != 0;
    c.bases = GetPrivateProfileIntW(L"livemap", L"Bases", 1, path.c_str()) != 0;
    c.chat_probe = GetPrivateProfileIntW(L"livemap", L"ChatProbe", 0, path.c_str()) != 0;
    return c;
}

}  // namespace livemap
