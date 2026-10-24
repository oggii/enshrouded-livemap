#pragma once
#include <cstdint>
#include <string>

namespace livemap::names {

// Longest name taken from a slot, in bytes (32 characters of 4-byte UTF-8 fit twice over).
constexpr uint64_t kMaxBytes = 256;

// A player's name from the game's player table. The field is {char* data, u64 length,
// u64 capacity}, UTF-8 and not zero-terminated: exactly `length` bytes are the name. Empty when
// the field is empty or unreadable. 1.0.0 read up to a zero byte instead and dropped a name
// whenever leftover bytes in the buffer followed it (Nexus bug 1156280, "Player 3").
std::string read(uintptr_t field);

}  // namespace livemap::names
