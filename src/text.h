#pragma once
#include <string>
#include <string_view>

namespace livemap::text {

// Bytes from game memory as text for JSON and the log: valid UTF-8 sequences stay, every
// invalid byte becomes U+FFFD, control characters become spaces.
std::string clean_utf8(std::string_view bytes);

}  // namespace livemap::text
