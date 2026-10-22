#pragma once

#include <windows.h>

namespace livemap {

// Loads the real iphlpapi.dll from the system directory and points every stub at it.
// Runs inside DllMain; returns false if the real library could not be loaded.
bool load_real_library(HMODULE self);

}  // namespace livemap
