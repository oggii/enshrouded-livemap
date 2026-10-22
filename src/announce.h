// Chat line on join: right after the server's own "Player X joined." line, the chat shows the
// map link. Uses the server's own chat queue with the joining player as the sender (the client
// drops lines without a valid sender); the line shows without a name. Coexists with Shared XP,
// which hooks the same spot.
#pragma once

#include <cstdint>
#include <functional>
#include <string>

namespace livemap {

// Finds the join line and hooks it; `line` is asked for the text at every join. Returns false,
// after logging why, when the join line is not found.
bool install_announce(const uint8_t* base, std::function<std::string()> line);

}  // namespace livemap
