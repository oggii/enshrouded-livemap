// The server's public internet address, asked from a "what is my IP" service. Only used when
// livemap.ini has no PublicUrl and DetectPublicAddress=1; nothing but the request itself is sent.
#pragma once

#include <string>

namespace livemap::public_ip {

// Asks api.ipify.org, then icanhazip.com, over HTTPS (5 s timeout each). Returns the address,
// or "" and a reason in `error`.
std::string detect(std::string& error);

}  // namespace livemap::public_ip
