// A small HTTP server for the map page. Serves the files in the "livemap" folder next to the
// server exe, the current state as JSON (/state) and a live stream of it (/events, Server-Sent
// Events). Every request needs ?key=<Key from livemap.ini>.
#pragma once

#include <string>

#include "config.h"

namespace livemap::web {

// Starts the listener thread. Returns false and fills `error` if the port cannot be opened.
bool start(const Config& config, const std::wstring& exe_dir, std::string& error);

}  // namespace livemap::web
