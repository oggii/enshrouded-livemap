// The world's Flame level, as the server tells Steam's server browser: the A2S_INFO reply on the
// game's query port carries keywords like "3;1273043;1;0;1;1;1;0;0", and the first number is the
// Flame level (keen::GameParameters starts with flameLevel; checked 23 Oct 2026 against a world at
// Flame level 3). The page needs it to tell deadly shroud (zone level above it) from normal.
#pragma once

#include <string>

namespace livemap::a2s {

// The A2S_INFO request; with a challenge (4 bytes from an 'A' reply) appended when asked for one.
std::string info_request(const std::string& challenge = {});

// For a reply datagram: the challenge if it is an 'A' challenge reply, else empty.
std::string challenge_of(const std::string& reply);

// The keywords of an 'I' info reply, or empty when the reply has none or is cut short.
std::string keywords_of(const std::string& reply);

// The Flame level from the keywords (first number, 0..99), or -1.
int flame_level(const std::string& keywords);

}  // namespace livemap::a2s
