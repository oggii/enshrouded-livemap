#include "public_ip.h"

#include <windows.h>
#include <winhttp.h>

#include "link.h"

namespace livemap::public_ip {

namespace {

std::string get(const wchar_t* host, const wchar_t* path, std::string& error) {
    std::string body;
    HINTERNET session = WinHttpOpen(L"enshrouded-livemap", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME,
                                    WINHTTP_NO_PROXY_BYPASS, 0);
    if (session == nullptr) {
        error = "WinHttpOpen failed (" + std::to_string(GetLastError()) + ")";
        return body;
    }
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    HINTERNET connection = WinHttpConnect(session, host, INTERNET_DEFAULT_HTTPS_PORT, 0);
    HINTERNET request = connection ? WinHttpOpenRequest(connection, L"GET", path, nullptr, WINHTTP_NO_REFERER,
                                                        WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE)
                                   : nullptr;
    if (request != nullptr && WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
        WinHttpReceiveResponse(request, nullptr)) {
        DWORD status = 0, size = sizeof status;
        WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                            &status, &size, WINHTTP_NO_HEADER_INDEX);
        char buf[256];
        DWORD read = 0;
        while (body.size() < 256 && WinHttpReadData(request, buf, sizeof buf, &read) && read > 0) body.append(buf, read);
        if (status != 200) {
            error = "HTTP " + std::to_string(status);
            body.clear();
        }
    } else {
        error = "request failed (" + std::to_string(GetLastError()) + ")";
    }
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    while (!body.empty() && (body.back() == '\n' || body.back() == '\r' || body.back() == ' ')) body.pop_back();
    return body;
}

}  // namespace

std::string detect(std::string& error) {
    const struct { const wchar_t* host; const wchar_t* path; } services[] = {
        {L"api.ipify.org", L"/"},
        {L"icanhazip.com", L"/"},
    };
    for (const auto& s : services) {
        std::string why;
        std::string ip = get(s.host, s.path, why);
        if (link::valid_ip(ip)) return ip;
        error = why.empty() ? "unexpected answer" : why;
    }
    return {};
}

}  // namespace livemap::public_ip
