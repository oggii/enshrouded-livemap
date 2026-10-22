#pragma once

#include <cstdint>

namespace livemap {

// Entity id that an ECS system is visiting right now, read like the game's FUN_140653a80:
// the system's first parameter points to {world, index}; id = [[world+0x828] + (index-1)*16].
// `param` is that parameter itself (e.g. still in rbx). 0 if unreadable.
uint32_t param_entity(uintptr_t param);

// Same, for a system that saved its parameter in memory: `param_slot` is where (e.g. [rbp+0x130]).
uint32_t system_entity(uintptr_t param_slot);

// Entity records and archetypes (read from FUN_1406535e0 / FUN_140653690): a record holds its
// archetype at +0x18, the chunk data at +0x20 and the entity's index in the chunk at +0x30. The
// archetype starts with a bitset of component type indices; +0x84 is a table of the component
// array offsets inside the chunk and +0xa84 a table of the element sizes (both uint16 per type).
constexpr int kTypeCount = 0x280;
bool entity_has(uintptr_t record, int type_index);
// Address of the entity's component of that type, 0 if it has none (or the size differs when
// `expect_size` is not 0).
uintptr_t entity_component(uintptr_t record, int type_index, uint16_t expect_size);
uint16_t component_size(uintptr_t record, int type_index);

// Component type ids are FNV-1a 32 of "keen::ecs::<Name>"; systems address components by
// type index (uint16, assigned at start). The registry (*world) keeps a table hash-per-index;
// where exactly is found at runtime: `find_type_table` searches the registry and the memory its
// fields point at for `known_hash` at `known_index`, and accepts the first spot where the two
// `check` hashes are also found below kTypeCount.
struct TypeTable {
    uintptr_t base = 0;
    uint32_t stride = 0;
};
bool find_type_table(uintptr_t registry, int known_index, uint32_t known_hash, const uint32_t check[2],
                     TypeTable& out);
int type_index(const TypeTable& table, uint32_t hash);  // -1 if absent

}  // namespace livemap
