// The server's loaded world, read the way its ECS stores it (docs/RESEARCH.md section 21): chests,
// locks and switches, and the creatures around the players. Read only, every read guarded.
#pragma once

#include <cstdint>

#include "objects.h"

namespace livemap::scene {

// The registry hook sees the "ecs::EntityGrid" service at world start; the world is 0x1f8 before it.
void set_entity_grid(uintptr_t grid);
// Component type index by FNV-1a 32 of "keen::ecs::<Name>", -1 when unknown or no world yet.
int type_index(uint32_t hash);

struct Pass {
    std::vector<objects::Chest> chests;
    std::vector<objects::Switch> switches;
    std::vector<objects::Creature> creatures;
    int archetypes = 0;
};
// One pass over every loaded entity of interest. Call on the game thread (the world changes
// between ticks). False when there is no world yet or its layout is not the analysed one.
bool walk(Pass& out);

}  // namespace livemap::scene
