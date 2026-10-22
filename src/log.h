#pragma once

#include <string>

namespace livemap {

// Opens livemap.log next to the server exe. Logging is a no-op until this ran with enabled=true.
void log_open(const std::wstring& dir, bool enabled);

// printf-style line with a UTC timestamp. Thread-safe.
void log(const char* fmt, ...);

}  // namespace livemap
