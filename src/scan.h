#pragma once

#include <cstdint>
#include <string>

namespace livemap {

struct Targets {
    // Entry of FUN_1407b34c0, the player table update (every tick): rcx = player manager.
    uintptr_t player_table = 0;
    // FUN_140090c60 (movement: position += velocity * dt), join point after the position adds:
    // [rsp+0x58] = position (3 x int64, 32.32 fixed point), rbx = system parameter.
    uintptr_t movement = 0;
    // FUN_14095d000 (g38_daytime update): mov [rdi+0x48], rax stores the time of day.
    uintptr_t daytime = 0;
    // FUN_140675e10(registry, {name ptr, length}*, object, ...): the server registers its
    // services by name at world start ("WeatherSystem", "g38_daytime::Daytime", ...).
    uintptr_t registry = 0;
    // Optional: FUN_140223520 (voxel dig -> loot per material), at the store of the loot entry:
    // ebp = item id, r15d = amount, rbx = material index, rdi = mining context (entity id +0x14c).
    uintptr_t mining = 0;
    // Optional: FUN_1400a0340 (interaction system), right after it filled an
    // InteractionAcceptedEvent: rdi = event {+8 guest id, +0xc entity}, [rsp+0x38] = the entity's
    // InteractionOfferRuntime, [rsp+0x48] = its entity record, [rbp+0x7450] = the system,
    // [rbp+0x38] = pointer to the InteractionOfferRuntime type index.
    uintptr_t chest = 0;
    // Optional: FUN_140908ce0(out, chat, type, {text, length}*, locaTag1, locaTag2, playerHandle,
    // accountIdHash, {value, has}*): queues one chat line for every connected client. The
    // server uses it for join/leave lines (type 4 with a loca tag). chat = manager + 0x60.
    uintptr_t chat_post = 0;
    // Optional: the loop head of FUN_1400e90e0, the ECS system add_buildzones_server, which walks
    // every player base (Flame Altar) each tick, once per ECS chunk. [rbp-0x18] = BaseIdComponent
    // (16-byte BaseId, wasAbandoned at +0x28), [rbp-0x10] = the altar's transform (position
    // 3 x int64 32.32 fixed point), [rbp-0x8] = its build zone (size float3 at +4).
    uintptr_t bases = 0;
    const char* build = nullptr;  // label of the recognised server build
};

// Checks that the image at `base` is the analysed build and finds each hook site by a pattern
// that must match exactly once. On failure `error` says why and nothing should be hooked.
bool find_targets(const uint8_t* base, Targets& out, std::string& error);

// The server's own "Player X joined." chat line in the player table update (FUN_1407b34c0).
// The map sends its line right after it, to the same chat queue and with the same sender.
// Found on any build. Another mod (Shared XP) may have hooked the call or the instruction after
// it already; then those bytes start with a jmp (e9) and the hook goes on top of it.
struct ChatSites {
    uintptr_t join_call = 0;   // call chat_post: rdx = chat queue, [rsp+0x20] = loca tag,
                               // [rsp+0x30] = player handle, [rsp+0x38] = account id hash
    uintptr_t join_after = 0;  // the instruction after that call
    uintptr_t chat_post = 0;   // FUN_140908ce0, queues a chat line for every client
    uint32_t join_tag = 0;     // loca tag of "Player X joined." (the same call sends "left")
    bool shared = false;       // the call was hooked by another mod already
};
bool find_chat_sites(const uint8_t* base, ChatSites& out);

}  // namespace livemap
