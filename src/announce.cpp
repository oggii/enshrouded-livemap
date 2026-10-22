#include "announce.h"

#include <windows.h>

#include <safetyhook.hpp>

#include "log.h"
#include "memory.h"
#include "scan.h"

namespace livemap {

namespace {

// Type 4 with no loca tag is shown as plain text without a name, but only with a valid player
// handle as the sender (checked in game on build 26083076, 22 Oct 2026).
using ChatPostFn = void* (*)(void* out, uintptr_t chat, uint8_t type, const void* text, uint32_t loca1,
                             uint32_t loca2, uint32_t player, uint64_t account, const void* opt);
constexpr uint8_t kSystemLine = 4;

SafetyHookMid g_join_call;
SafetyHookMid g_join_after;
ChatPostFn g_post = nullptr;
uint32_t g_join_tag = 0;
std::function<std::string()> g_line;

// Both hooks run on the server thread that sends the join line, one right after the other.
struct Pending {
    bool armed = false;
    uintptr_t chat = 0;
    uint32_t handle = 0;
    uint64_t account = 0;
};
Pending g_pending;

void on_join_call(SafetyHookContext& ctx) {
    uint32_t tag = 0, handle = 0;
    uint64_t account = 0;
    if (!read_u32(ctx.rsp + 0x20, tag) || tag != g_join_tag || !read_u32(ctx.rsp + 0x30, handle) || handle == 0 ||
        !read_u64(ctx.rsp + 0x38, account) || ctx.rdx == 0) {
        return;
    }
    g_pending = {true, ctx.rdx, handle, account};
}

void on_join_after(SafetyHookContext&) {
    if (!g_pending.armed) return;
    Pending p = g_pending;
    g_pending = {};
    std::string line = g_line();
    struct { const char* ptr; uint64_t length; } text{line.c_str(), line.size()};
    struct { uint64_t value; uint8_t has; uint8_t pad[7]; } opt{};
    alignas(8) uint8_t out[16] = {};
    g_post(out, p.chat, kSystemLine, &text, 0, 0, p.handle, p.account, &opt);
    log("announce: \"%s\" after the join of player handle %u%s", line.c_str(), p.handle,
        out[0] == 0 ? "" : " (chat queue full, not sent)");
}

}  // namespace

bool install_announce(const uint8_t* base, std::function<std::string()> line) {
    ChatSites sites;
    if (!find_chat_sites(base, sites)) {
        log("announce: the server's join line was not found, no chat line");
        return false;
    }
    g_line = std::move(line);
    g_post = reinterpret_cast<ChatPostFn>(sites.chat_post);
    g_join_tag = sites.join_tag;
    auto call = safetyhook::MidHook::create(reinterpret_cast<void*>(sites.join_call), on_join_call);
    auto after = safetyhook::MidHook::create(reinterpret_cast<void*>(sites.join_after), on_join_after);
    if (!call || !after) {
        log("announce: could not hook the join line, no chat line");
        return false;
    }
    g_join_call = std::move(*call);
    g_join_after = std::move(*after);
    log("hooked %-12s at %llx (map link in the chat when a player joins)%s", "join_line",
        static_cast<unsigned long long>(sites.join_call), sites.shared ? " (shared with another mod)" : "");
    return true;
}

}  // namespace livemap
