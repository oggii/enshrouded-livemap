// The map's public link: which port it listens on, which address people use from outside, and
// the chat line that tells players. Pure text handling, so it can be unit-tested.
#pragma once

#include <string>

namespace livemap::link {

// "queryPort" from enshrouded_server.json, or 0 if the text has none.
int query_port(const std::string& server_json);

// True for a plain IPv4 or IPv6 address as returned by "what is my IP" services.
bool valid_ip(const std::string& text);

// The link players open. `public_url` (from livemap.ini) wins when set, e.g.
// "https://map.example.com"; otherwise http://<ip>:<port>/ (IPv6 in brackets). Empty when
// neither is known.
std::string make(const std::string& public_url, const std::string& ip, int port, const std::string& key);

// The short form to type: no "http(s)://", and the key as the path ("karte.example.ch/ourmap").
// The web server redirects /<key> to /?key=<key>.
std::string short_form(const std::string& link);

// The chat line for a join (uses the short form).
std::string chat_line(const std::string& link, int port);

// A key that works in a link: 3 to 64 letters, digits, - or _, and not a name the server uses
// itself (state, events, finds, icons, ...).
bool key_ok(const std::string& key);

// Keys are compared without regard to case, so a phone keyboard's capital letter does no harm.
bool key_equal(const std::string& a, const std::string& b);

}  // namespace livemap::link
