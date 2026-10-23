// What the map shows, read from the running server: players (from the player table), their
// positions (from the movement system) and the time of day (from the daytime system).
#pragma once

#include <cstdint>
#include <string>

#include "bases.h"
#include "finds.h"
#include "scan.h"

namespace livemap::world {

// Installs the three hooks. Returns false and fills `error` if any fails; none stays installed.
bool install(const Targets& targets, std::string& error);

// Re-reads the player table (who is in game, names) so the movement hook knows which entities
// to record. Call a few times per second from a normal thread.
void refresh_players();

// The current state as JSON for the web page.
std::string snapshot_json();

// The world's Flame level as the server reports it to Steam (-1 = not known yet); main.cpp sets it.
void set_flame_level(int level);

// One log line with the time of day and every player's position (diagnostics).
void log_diagnostics();

// The finds (ore deposits, looted chests) the hooks feed; main.cpp saves it, web.cpp serves it.
finds::Store& store();
// Installs the optional mining hook (no-op when the site was not found).
void install_mining(const Targets& targets);
// Installs the optional chest hook (no-op when the site was not found).
void install_chest(const Targets& targets);
// Flame Altars (player bases) the server's build zone system walks; web.cpp serves them.
bases::Store& bases_store();
// Installs the optional bases hooks (no-op when the sites were not found).
void install_bases(const Targets& targets);
// Research switch: after a player joins, post one chat line per message type 0..7.
void enable_chat_probe(const Targets& targets);

}  // namespace livemap::world
