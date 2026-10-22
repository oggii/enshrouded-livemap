// iphlpapi.dll proxy: resolves the real system library and fills the stub jump table.
#include "proxy.h"

#include <windows.h>

#include <array>

namespace {

constexpr std::array kNames = {
#include "proxy_names.inc"
};

// Every export we do not find in the real library returns ERROR_NOT_SUPPORTED.
DWORD WINAPI missing_export() {
    return ERROR_NOT_SUPPORTED;
}

}  // namespace

extern "C" uintptr_t g_real_exports[kNames.size()] = {};

namespace livemap {

bool load_real_library(HMODULE self) {
    for (auto& slot : g_real_exports) {
        slot = reinterpret_cast<uintptr_t>(&missing_export);
    }
    wchar_t path[MAX_PATH];
    UINT len = GetSystemDirectoryW(path, MAX_PATH);
    if (len == 0 || len + 15 >= MAX_PATH) {
        return false;
    }
    lstrcatW(path, L"\\iphlpapi.dll");
    HMODULE real = LoadLibraryW(path);
    if (real == nullptr || real == self) {
        return false;
    }
    for (size_t i = 0; i < kNames.size(); ++i) {
        if (FARPROC fn = GetProcAddress(real, kNames[i])) {
            g_real_exports[i] = reinterpret_cast<uintptr_t>(fn);
        }
    }
    return true;
}

}  // namespace livemap
