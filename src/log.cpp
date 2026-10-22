#include "log.h"

#include <windows.h>

#include <cstdarg>
#include <cstdio>
#include <mutex>

namespace livemap {

namespace {
std::mutex g_mutex;
FILE* g_file = nullptr;
}  // namespace

void log_open(const std::wstring& dir, bool enabled) {
    std::lock_guard lock(g_mutex);
    if (!enabled || g_file != nullptr) {
        return;
    }
    std::wstring path = dir + L"\\livemap.log";
    g_file = _wfsopen(path.c_str(), L"a", _SH_DENYWR);
}

void log(const char* fmt, ...) {
    std::lock_guard lock(g_mutex);
    if (g_file == nullptr) {
        return;
    }
    SYSTEMTIME t;
    GetSystemTime(&t);
    std::fprintf(g_file, "%04d-%02d-%02d %02d:%02d:%02d.%03d ", t.wYear, t.wMonth, t.wDay,
                 t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    va_list args;
    va_start(args, fmt);
    std::vfprintf(g_file, fmt, args);
    va_end(args);
    std::fputc('\n', g_file);
    std::fflush(g_file);
}

}  // namespace livemap
