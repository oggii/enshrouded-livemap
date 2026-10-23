#include "world.h"

#include <windows.h>

#include <array>
#include <atomic>
#include <cstdio>
#include <cmath>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include <safetyhook.hpp>

#include "ecs.h"
#include "log.h"
#include "memory.h"
#include "text.h"

#include "items_generated.h"

namespace livemap::world {

namespace {

// Player table (FUN_1407b34c0): 16 slots of 0x148 bytes at manager+0x1e0.
constexpr uintptr_t kSlots = 0x1e0;
constexpr uintptr_t kStride = 0x148;
constexpr int kSlotCount = 16;
constexpr uintptr_t kState = 0xA;
constexpr uintptr_t kEntity = 0x18;
constexpr uintptr_t kName = 0x20;
constexpr uint8_t kInGame = 3;

struct Slot {
    std::atomic<uint32_t> entity{0};  // 0 = nobody in game in this slot
    std::atomic<int64_t> x{0}, y{0}, z{0};
    std::atomic<uint32_t> qx{0}, qy{0}, qz{0}, qw{0};  // orientation quaternion, float bits
    std::atomic<uint64_t> seen_ms{0};  // when the movement system last visited this player
};

std::array<Slot, kSlotCount> g_slots;
std::mutex g_names_mutex;
std::array<std::string, kSlotCount> g_names;
std::array<uint32_t, kSlotCount> g_logged_entity{};

std::atomic<uintptr_t> g_manager{0};
std::atomic<uintptr_t> g_daytime{0};
std::atomic<int64_t> g_time{0};
std::atomic<uint64_t> g_time_ms{0};
std::atomic<int64_t> g_world_time{0};  // the game's Time (ns) the daytime system was given
std::atomic<uintptr_t> g_weather_system{0};

SafetyHookMid g_player_table_hook;
SafetyHookMid g_movement_hook;
SafetyHookMid g_daytime_hook;
SafetyHookMid g_registry_hook;
SafetyHookMid g_mining_hook;
SafetyHookMid g_chest_hook;
SafetyHookMid g_bases_hook;
finds::Store g_finds;
bases::Store g_bases;
discovered::Store g_discovered;
explored::Store g_explored;
bool g_discovered_off = false;  // layout not recognised once: stop looking

// Per-player dynamic knowledge (docs/RESEARCH.md section 17, build 26083076): the player
// manager holds the knowledge records object at +0x1c8; record = object + (handle & 0x3f) * 0x5620;
// in it the knowledge map {keys ptr, count, capacity 11000, ...} at +0x5b78 and the parallel
// values {ptr, count, capacity, ...} at +0x5ba0. Read only.
constexpr uintptr_t kKnowledgeRecords = 0x1c8;
constexpr uintptr_t kRecordStride = 0x5620;
constexpr uintptr_t kRecordKeys = 0x5b78;
constexpr uintptr_t kRecordValues = 0x5ba0;
constexpr uint64_t kKnowledgeCapacity = 11000;
std::atomic<int> g_bases_logged{0};

double meters(int64_t fixed);

// Chat probe (research): which message type does the client show as plain text?
using ChatPostFn = void* (*)(void* out, uintptr_t chat, uint8_t type, const void* text, uint32_t loca1,
                             uint32_t loca2, uint32_t player, uint64_t account, const void* opt);
ChatPostFn g_chat_post = nullptr;
// Variants come from chatprobe.txt next to the server exe, read on every join, one per line:
//   <type> <0|self> <locaTag1 hex> <locaTag2 hex> <text>
// "self" sends the line with the joining player's handle and account hash as the sender.
struct ProbeLine {
    int type = 0;
    bool self = false;
    uint32_t loca1 = 0, loca2 = 0;
    std::string text;
};
std::mutex g_probe_mutex;
std::vector<ProbeLine> g_probe_lines;
size_t g_probe_next = 0;
uint32_t g_probe_handle = 0;
uint64_t g_probe_account = 0;
std::atomic<uint64_t> g_probe_at_ms{0};
std::wstring g_probe_file;

void probe_arm(uint32_t handle, uint64_t account) {
    std::vector<ProbeLine> lines;
    if (FILE* f = _wfopen(g_probe_file.c_str(), L"rb")) {
        char buf[512];
        while (std::fgets(buf, sizeof buf, f)) {
            ProbeLine l;
            char who[8] = {};
            int used = 0;
            if (buf[0] == '#' || std::sscanf(buf, "%d %7s %x %x %n", &l.type, who, &l.loca1, &l.loca2, &used) < 4) continue;
            l.self = std::strcmp(who, "self") == 0;
            l.text = buf + used;
            while (!l.text.empty() && (l.text.back() == '\n' || l.text.back() == '\r')) l.text.pop_back();
            lines.push_back(l);
        }
        std::fclose(f);
    }
    std::lock_guard lock(g_probe_mutex);
    g_probe_lines = std::move(lines);
    g_probe_next = 0;
    g_probe_handle = handle;
    g_probe_account = account;
    g_probe_at_ms.store(GetTickCount64() + 10000, std::memory_order_relaxed);  // let the client load in
    log("CHATPROBE armed: %zu lines, handle %u, account %llx, first line in 10 s", g_probe_lines.size(), handle,
        static_cast<unsigned long long>(account));
}

void probe_step(uintptr_t manager) {
    if (g_chat_post == nullptr || GetTickCount64() < g_probe_at_ms.load(std::memory_order_relaxed)) return;
    std::lock_guard lock(g_probe_mutex);
    if (g_probe_next >= g_probe_lines.size()) return;
    uintptr_t chat = 0;
    if (!read_ptr(manager + 0x60, chat) || chat == 0) return;
    const ProbeLine& l = g_probe_lines[g_probe_next];
    struct { const char* ptr; uint64_t length; } text{l.text.c_str(), l.text.size()};
    struct { uint64_t value; uint8_t has; uint8_t pad[7]; } opt{};
    alignas(8) uint8_t out[16] = {};
    g_chat_post(out, chat, static_cast<uint8_t>(l.type), &text, l.loca1, l.loca2, l.self ? g_probe_handle : 0,
                l.self ? g_probe_account : 0, &opt);
    log("CHATPROBE posted #%zu type %d %s loca %08x %08x \"%s\", result %u", g_probe_next, l.type, l.self ? "self" : "0",
        l.loca1, l.loca2, l.text.c_str(), out[0]);
    ++g_probe_next;
    g_probe_at_ms.store(GetTickCount64() + 2000, std::memory_order_relaxed);
}

void on_player_table(SafetyHookContext& ctx) {
    g_manager.store(ctx.rcx, std::memory_order_relaxed);
    probe_step(ctx.rcx);
}

// Every entity the movement system moves passes here; only players are kept.
void on_movement(SafetyHookContext& ctx) {
    uint32_t entity = param_entity(ctx.rbx);
    if (entity == 0) return;
    for (Slot& s : g_slots) {
        if (s.entity.load(std::memory_order_relaxed) != entity) continue;
        uintptr_t pos = 0;
        uint64_t x = 0, y = 0, z = 0;
        if (read_ptr(ctx.rsp + 0x58, pos) && read_u64(pos, x) && read_u64(pos + 8, y) && read_u64(pos + 16, z)) {
            s.x.store(static_cast<int64_t>(x), std::memory_order_relaxed);
            s.y.store(static_cast<int64_t>(y), std::memory_order_relaxed);
            s.z.store(static_cast<int64_t>(z), std::memory_order_relaxed);
            // The transform record continues with the orientation quaternion (4 floats) and the
            // uniform scale, like the client's 56-byte transform records.
            uint32_t qx = 0, qy = 0, qz = 0, qw = 0;
            if (read_u32(pos + 0x18, qx) && read_u32(pos + 0x1c, qy) && read_u32(pos + 0x20, qz) && read_u32(pos + 0x24, qw)) {
                s.qx.store(qx, std::memory_order_relaxed);
                s.qy.store(qy, std::memory_order_relaxed);
                s.qz.store(qz, std::memory_order_relaxed);
                s.qw.store(qw, std::memory_order_relaxed);
            }
            s.seen_ms.store(GetTickCount64(), std::memory_order_relaxed);
        }
        return;
    }
}

void on_daytime(SafetyHookContext& ctx) {
    g_daytime.store(ctx.rdi, std::memory_order_relaxed);
    g_time.store(static_cast<int64_t>(ctx.rax), std::memory_order_relaxed);
    g_time_ms.store(GetTickCount64(), std::memory_order_relaxed);
    g_world_time.store(static_cast<int64_t>(ctx.rbx), std::memory_order_relaxed);  // param_2
}

// Item debug name for a runtime item id, or nullptr.
const char* item_name(uint32_t id) {
    size_t lo = 0, hi = std::size(kItemNames);
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (kItemNames[mid].id < id) lo = mid + 1; else hi = mid;
    }
    return lo < std::size(kItemNames) && kItemNames[lo].id == id ? kItemNames[lo].name : nullptr;
}

int64_t unix_now() {
    FILETIME ft;
    GetSystemTimeAsFileTime(&ft);
    uint64_t t = (static_cast<uint64_t>(ft.dwHighDateTime) << 32) | ft.dwLowDateTime;
    return static_cast<int64_t>(t / 10000000ULL) - 11644473600LL;
}

// A dig produced loot: record ore-like materials as a find at the player's position.
std::atomic<int> g_mining_logs{0};

void on_mining(SafetyHookContext& ctx) {
    uint32_t entity = 0;
    bool readable = read_u32(ctx.rdi + 0x14c, entity);
    const char* name = item_name(static_cast<uint32_t>(ctx.rbp));
    if (g_mining_logs.fetch_add(1, std::memory_order_relaxed) < 60) {
        log("MINING item %u (%s) amount %u material %llu entity@rdi+0x14c %u%s", static_cast<uint32_t>(ctx.rbp),
            name ? name : "?", static_cast<uint32_t>(ctx.r15), static_cast<unsigned long long>(ctx.rbx), entity,
            readable ? "" : " (unreadable)");
    }
    if (!readable || entity == 0) return;
    if (name == nullptr || !finds::is_ore_like(name)) return;
    for (int i = 0; i < kSlotCount; ++i) {
        const Slot& s = g_slots[i];
        if (s.entity.load(std::memory_order_relaxed) != entity || s.seen_ms.load(std::memory_order_relaxed) == 0) continue;
        std::string player;
        {
            std::lock_guard lock(g_names_mutex);
            player = g_names[i];
        }
        g_finds.record_ore(meters(s.x.load(std::memory_order_relaxed)), meters(s.y.load(std::memory_order_relaxed)),
                           meters(s.z.load(std::memory_order_relaxed)), name, 0, player, unix_now());
        return;
    }
}

// Chests (see RESEARCH.md section 12). The interaction system has just accepted a player's
// interaction and filled an InteractionAcceptedEvent. Chest-like verbs are kept, the entity's
// RandomLootContainer component tells a world chest from player storage, and its
// CurrentTransform gives the position. The component type indices come from the registry's
// type table, found once at runtime from the InteractionOfferRuntime index the system holds.
constexpr uint32_t kHashInteractionOfferRuntime = 0x78ee0f23;
constexpr uint32_t kHashCurrentTransform = 0x027ac564;
constexpr uint32_t kHashRandomLootContainer = 0x061dda01;
constexpr uint32_t kVerbOpen = 1317200649;    // defaultVerbId of LootChest_* and player storage
constexpr uint32_t kVerbLocked = 3711698580;  // locked chests (and locked doors)
constexpr uint16_t kTransformSize = 0x38;     // 3 x int64 position, quaternion, scale
TypeTable g_types;
int g_idx_transform = -1, g_idx_random_loot = -1;
std::atomic<int> g_types_state{0};  // 0 unknown, 1 found, -1 searched and not found
std::atomic<int> g_interaction_logs{0};

bool in_world(double x, double y, double z) {
    return x >= 0 && x <= 10240 && z >= 0 && z <= 10240 && y > -1000 && y < 4000;
}

bool read_position(uintptr_t transform, double& x, double& y, double& z) {
    uint64_t fx = 0, fy = 0, fz = 0;
    if (transform == 0 || !read_u64(transform, fx) || !read_u64(transform + 8, fy) || !read_u64(transform + 16, fz)) return false;
    x = meters(static_cast<int64_t>(fx));
    y = meters(static_cast<int64_t>(fy));
    z = meters(static_cast<int64_t>(fz));
    return in_world(x, y, z);
}

// Without the type table: the first 0x38-byte component that reads like a transform.
bool guess_position(uintptr_t record, double& x, double& y, double& z) {
    for (int i = 0; i < kTypeCount; ++i) {
        uintptr_t t = entity_component(record, i, kTransformSize);
        if (t == 0 || !read_position(t, x, y, z)) continue;
        uint32_t q[4] = {};
        float f[4] = {};
        bool ok = true;
        for (int k = 0; k < 4 && ok; ++k) ok = read_u32(t + 0x18 + k * 4, q[k]);
        if (!ok) continue;
        std::memcpy(f, q, sizeof f);
        double n = std::sqrt(static_cast<double>(f[0]) * f[0] + static_cast<double>(f[1]) * f[1] +
                             static_cast<double>(f[2]) * f[2] + static_cast<double>(f[3]) * f[3]);
        if (n > 0.9 && n < 1.1) return true;
    }
    return false;
}

void resolve_types(uintptr_t system, uint16_t offer_index, uintptr_t record) {
    if (g_types_state.load(std::memory_order_relaxed) != 0) return;
    uintptr_t owner = 0, world = 0, registry = 0;
    if (!read_ptr(system, owner) || !read_ptr(owner + 0x30, world) || !read_ptr(world, registry)) {
        log("CHEST registry not readable (system %llx)", static_cast<unsigned long long>(system));
        g_types_state.store(-1, std::memory_order_relaxed);
        return;
    }
    const uint32_t check[2] = {kHashCurrentTransform, kHashRandomLootContainer};
    uint64_t t0 = GetTickCount64();
    bool found = find_type_table(registry, offer_index, kHashInteractionOfferRuntime, check, g_types);
    if (found) {
        g_idx_transform = type_index(g_types, kHashCurrentTransform);
        g_idx_random_loot = type_index(g_types, kHashRandomLootContainer);
        found = component_size(record, g_idx_transform) == kTransformSize;
    }
    log("CHEST type table %s (%llu ms): base %llx stride %u, InteractionOfferRuntime=%u CurrentTransform=%d "
        "RandomLootContainer=%d",
        found ? "found" : "NOT found", static_cast<unsigned long long>(GetTickCount64() - t0),
        static_cast<unsigned long long>(g_types.base), g_types.stride, offer_index, g_idx_transform, g_idx_random_loot);
    if (!found) g_types = {};
    g_types_state.store(found ? 1 : -1, std::memory_order_relaxed);
}

std::string nearest_player(double x, double z, double within) {
    int best = -1;
    double best_d = within * within;
    for (int i = 0; i < kSlotCount; ++i) {
        const Slot& s = g_slots[i];
        if (s.entity.load(std::memory_order_relaxed) == 0 || s.seen_ms.load(std::memory_order_relaxed) == 0) continue;
        double dx = meters(s.x.load(std::memory_order_relaxed)) - x, dz = meters(s.z.load(std::memory_order_relaxed)) - z;
        double d = dx * dx + dz * dz;
        if (d < best_d) { best_d = d; best = i; }
    }
    if (best < 0) return {};
    std::lock_guard lock(g_names_mutex);
    return g_names[best];
}

void on_chest(SafetyHookContext& ctx) {
    uintptr_t event = ctx.rdi, offer = 0, record = 0, system = 0, accessor = 0;
    uint32_t entity = 0, guest = 0, verb = 0;
    uint16_t offer_index = 0;
    if (!read_u32(event + 0xc, entity) || !read_u32(event + 8, guest) || !read_ptr(ctx.rsp + 0x38, offer) ||
        !read_u32(offer + 0x10, verb) || !read_ptr(ctx.rsp + 0x48, record) || !read_ptr(ctx.rbp + 0x7450, system) ||
        !read_ptr(ctx.rbp + 0x38, accessor) || !read_u16(accessor, offer_index)) {
        return;
    }
    bool chest_like = verb == kVerbOpen || verb == kVerbLocked;
    if (g_interaction_logs.fetch_add(1, std::memory_order_relaxed) < 300 || chest_like) {
        log("INTERACT entity %u guest %u verb %u offer-type %u%s", entity, guest, verb, offer_index, chest_like ? " (chest-like)" : "");
    }
    if (!chest_like || record == 0) return;
    resolve_types(system, offer_index, record);
    int rl = -1;
    double x = 0, y = 0, z = 0;
    bool pos = false;
    if (g_types_state.load(std::memory_order_relaxed) == 1) {
        rl = entity_has(record, g_idx_random_loot) ? 1 : 0;
        pos = read_position(entity_component(record, g_idx_transform, kTransformSize), x, y, z);
    }
    if (!pos) pos = guess_position(record, x, y, z);
    log("CHEST entity %u verb %u random-loot %d position %s%.1f %.1f %.1f", entity, verb, rl, pos ? "" : "unknown ", x, y, z);
    if (!pos || rl == 0) return;
    g_finds.record_chest(x, y, z, -1, nearest_player(x, z, 12.0), unix_now(), rl);
}

// One base in add_buildzones_server's walk: [rbp-0x18] = BaseIdComponent (BaseId +0, wasAbandoned
// +0x28), [rbp-0x10] = transform, [rbp-0x8] = the build zone (size float3 at +4; the system adds
// a zone only when a side is above a minimum).
void on_base(SafetyHookContext& ctx) {
    uintptr_t component = 0, transform = 0, zone = 0;
    uint64_t id_lo = 0, id_hi = 0;
    uint32_t size[3] = {};
    uint8_t abandoned = 0;
    bases::Base b;
    if (!read_ptr(ctx.rbp - 0x18, component) || !read_ptr(ctx.rbp - 0x10, transform) || !read_ptr(ctx.rbp - 0x8, zone) ||
        component == 0 || !read_u64(component, id_lo) || !read_u64(component + 8, id_hi) ||
        !read_u8(component + 0x28, abandoned) || !read_position(transform, b.x, b.y, b.z)) {
        return;
    }
    if (zone == 0 || !read_u32(zone + 4, size[0]) || !read_u32(zone + 8, size[1]) || !read_u32(zone + 0xc, size[2])) {
        size[0] = size[1] = size[2] = 0;  // no zone: size 0
    }
    std::memcpy(&b.size_x, &size[0], 4);
    std::memcpy(&b.size_y, &size[1], 4);
    std::memcpy(&b.size_z, &size[2], 4);
    b.abandoned = abandoned != 0;
    if (g_bases_logged.fetch_add(1, std::memory_order_relaxed) < 60) {
        log("BASE id %016llx%016llx at %.2f %.2f %.2f zone %.1f x %.1f x %.1f%s", static_cast<unsigned long long>(id_hi),
            static_cast<unsigned long long>(id_lo), b.x, b.y, b.z, b.size_x, b.size_y, b.size_z,
            b.abandoned ? " abandoned" : "");
    }
    g_bases.see(id_lo, id_hi, b, GetTickCount64());
}

// Service registry entry: rdx = {const char* name, size_t length}, r8 = the service object.
void on_registry(SafetyHookContext& ctx) {
    uintptr_t name_ptr = 0;
    uint64_t length = 0;
    if (!read_ptr(ctx.rdx, name_ptr) || !read_u64(ctx.rdx + 8, length) || length == 0 || length > 80) return;
    char name[81] = {};
    for (uint64_t i = 0; i < length; ++i) {
        uint8_t c = 0;
        if (!read_u8(name_ptr + i, c)) return;
        name[i] = static_cast<char>(c);
    }
    log("SERVICE %-40s %llx", name, static_cast<unsigned long long>(ctx.r8));
    if (std::strcmp(name, "WeatherSystem") == 0) g_weather_system.store(ctx.r8, std::memory_order_relaxed);
}

// The name field is {char* data, u64 length, u64 capacity}, UTF-8 (raw slot dumps 2026-10-22:
// "OG Vanilla K" = length 12 / capacity 16, a 19-byte name = 19 / 32). Until 1.0.1 the field
// was first read as inline text, which turned a pointer without a zero byte early on into a
// garbled name.
std::string read_name(uintptr_t field) {
    uintptr_t ptr = 0;
    uint64_t length = 0;
    if (!read_ptr(field, ptr) || !read_u64(field + 8, length) || ptr < 0x10000 || length == 0 || length > 128) return {};
    std::string s(static_cast<size_t>(length), '\0');
    for (size_t i = 0; i < s.size(); ++i) {
        uint8_t c = 0;
        if (!read_u8(ptr + i, c)) return {};
        s[i] = static_cast<char>(c);
    }
    return text::clean_utf8(s);
}

void log_raw_slot(int index, uintptr_t slot) {
    char hex[3 * 0x40 + 1] = {};
    for (int i = 0; i < 0x40; ++i) {
        uint8_t c = 0;
        read_u8(slot + kName + i, c);
        std::snprintf(hex + i * 3, 4, "%02x ", c);
    }
    log("SLOT   %d raw +0x20: %s", index, hex);
}

bool create(SafetyHookMid& hook, uintptr_t at, safetyhook::MidHookFn fn, const char* name, std::string& error) {
    auto h = safetyhook::MidHook::create(reinterpret_cast<void*>(at), fn);
    if (!h) {
        error = std::string("could not hook ") + name;
        return false;
    }
    hook = std::move(*h);
    log("hooked %-12s at %llx", name, static_cast<unsigned long long>(at));
    return true;
}

double meters(int64_t fixed) {
    return static_cast<double>(fixed) / 4294967296.0;
}

void append_escaped(std::string& out, const std::string& s) {
    for (char c : s) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += c;
        } else if (static_cast<unsigned char>(c) < 0x20) {
            out += ' ';
        } else {
            out += c;
        }
    }
}


// Weather (build 25988414, read 2026-10-20 on the test server):
// WeatherSystem+0x28 -> pool {allocator, records, capacity, ?, ?}; records are 0x48 bytes:
// +0x00 u32 free-list word (bit 31 set = free slot), +0x08 u8 layer, +0x09 u8 phenomenon index,
// +0x10/+0x18/+0x20 spawn position (int64 32.32 metres), +0x28 rotation (rad), +0x2c radius,
// +0x30 move speed (m/s), +0x38 spawn time, +0x40 despawn time (ns of world time).
// World time = daytime[+0x18] + (session time - daytime[+0x10]); the session time is the Time
// the daytime system was last given (rbx at the daytime hook).
constexpr uintptr_t kWeatherPool = 0x28;
constexpr uintptr_t kRecordSize = 0x48;
constexpr uint64_t kMaxRecords = 1024;

bool world_time_ns(int64_t& out) {
    uintptr_t day = g_daytime.load(std::memory_order_relaxed);
    uint64_t anchor_session = 0, anchor_world = 0;
    if (day == 0 || !read_u64(day + 0x10, anchor_session) || !read_u64(day + 0x18, anchor_world)) return false;
    int64_t session = g_world_time.load(std::memory_order_relaxed);
    out = static_cast<int64_t>(anchor_world) + (session - static_cast<int64_t>(anchor_session));
    return true;
}

void append_weather(std::string& out) {
    uintptr_t ws = g_weather_system.load(std::memory_order_relaxed);
    int64_t now = 0;
    uintptr_t pool = 0, records = 0;
    uint64_t capacity = 0;
    if (ws == 0 || !world_time_ns(now) || !read_ptr(ws + kWeatherPool, pool) || !read_ptr(pool + 8, records) ||
        !read_u64(pool + 0x10, capacity) || capacity == 0 || capacity > kMaxRecords) {
        out += "null";
        return;
    }
    char buf[320];
    std::snprintf(buf, sizeof buf, "{\"worldTime\":%.3f,\"instances\":[", static_cast<double>(now) / 1e9);
    out += buf;
    bool first = true;
    for (uint64_t i = 0; i < capacity; ++i) {
        uintptr_t r = records + i * kRecordSize;
        uint32_t word = 0;
        uint8_t layer = 0, phenomenon = 0;
        uint64_t x = 0, z = 0, spawn = 0, despawn = 0;
        uint32_t rot = 0, radius = 0, speed = 0;
        if (!read_u32(r, word) || (word & 0x80000000u) != 0) continue;
        if (!read_u8(r + 8, layer) || !read_u8(r + 9, phenomenon) || !read_u64(r + 0x10, x) ||
            !read_u64(r + 0x20, z) || !read_u32(r + 0x28, rot) || !read_u32(r + 0x2c, radius) ||
            !read_u32(r + 0x30, speed) || !read_u64(r + 0x38, spawn) || !read_u64(r + 0x40, despawn)) {
            continue;
        }
        float frot, fradius, fspeed;
        std::memcpy(&frot, &rot, 4);
        std::memcpy(&fradius, &radius, 4);
        std::memcpy(&fspeed, &speed, 4);
        if (!(fradius > 0.0f && fradius < 100000.0f)) continue;
        std::snprintf(buf, sizeof buf,
                      "%s{\"layer\":%u,\"phenomenon\":%u,\"spawn\":[%.1f,%.1f],\"rotation\":%.4f,\"radius\":%.1f,"
                      "\"speed\":%.3f,\"spawnTime\":%.3f,\"despawnTime\":%.3f}",
                      first ? "" : ",", layer, phenomenon, meters(static_cast<int64_t>(x)), meters(static_cast<int64_t>(z)),
                      frot, fradius, fspeed, static_cast<double>(static_cast<int64_t>(spawn)) / 1e9,
                      static_cast<double>(static_cast<int64_t>(despawn)) / 1e9);
        out += buf;
        first = false;
    }
    out += "]}";
}

}  // namespace

finds::Store& store() { return g_finds; }
bases::Store& bases_store() { return g_bases; }
discovered::Store& discovered_store() { return g_discovered; }
explored::Store& explored_store() { return g_explored; }

void refresh_explored() {
    const uint64_t now = GetTickCount64();
    for (int i = 0; i < kSlotCount; ++i) {
        const Slot& s = g_slots[i];
        const uint64_t seen = s.seen_ms.load(std::memory_order_relaxed);
        if (s.entity.load(std::memory_order_relaxed) == 0 || seen == 0 || now - seen > 5000) continue;
        std::string name;
        {
            std::lock_guard lock(g_names_mutex);
            name = g_names[i];
        }
        if (name.empty()) continue;
        g_explored.reveal(name, meters(s.x.load(std::memory_order_relaxed)), meters(s.z.load(std::memory_order_relaxed)));
    }
}

void refresh_discovered(int64_t unix_now) {
    uintptr_t manager = g_manager.load(std::memory_order_relaxed);
    if (manager == 0 || g_discovered_off) return;
    uintptr_t records = 0;
    if (!read_ptr(manager + kKnowledgeRecords, records) || records < 0x10000) return;
    std::vector<std::string> online;
    for (int i = 0; i < kSlotCount; ++i) {
        uintptr_t slot = manager + kSlots + static_cast<uintptr_t>(i) * kStride;
        uint32_t handle = 0, entity = 0;
        uint8_t state = 0;
        if (!read_u32(slot, handle) || handle == 0 || !read_u8(slot + kState, state) || state != kInGame ||
            !read_u32(slot + kEntity, entity) || entity == 0) {
            continue;
        }
        std::string name;
        {
            std::lock_guard lock(g_names_mutex);
            name = g_names[i];
        }
        if (name.empty()) continue;
        online.push_back(name);
        const uintptr_t record = records + static_cast<uintptr_t>(handle & 0x3f) * kRecordStride;
        uintptr_t keys = 0, values = 0;
        uint64_t count = 0, capacity = 0, value_count = 0;
        if (!read_ptr(record + kRecordKeys, keys) || !read_u64(record + kRecordKeys + 8, count) ||
            !read_u64(record + kRecordKeys + 16, capacity) || !read_ptr(record + kRecordValues, values) ||
            !read_u64(record + kRecordValues + 8, value_count)) {
            continue;
        }
        if (capacity != kKnowledgeCapacity || count > capacity || value_count != count) {
            log("DISCOVERED layout not recognised (capacity %llu, count %llu / %llu); markers stay unknown",
                static_cast<unsigned long long>(capacity), static_cast<unsigned long long>(count),
                static_cast<unsigned long long>(value_count));
            g_discovered_off = true;
            return;
        }
        std::vector<uint32_t> k(count), v(count);
        if (count && (!read_bytes(keys, k.data(), count * 4) || !read_bytes(values, v.data(), count * 4))) continue;
        std::vector<uint32_t> set;
        set.reserve(count);
        for (size_t j = 0; j < k.size(); ++j)
            if (v[j] != 0) set.push_back(k[j]);
        if (g_discovered.update(name, std::move(set), unix_now)) {
            log("DISCOVERED %s: %llu knowledge keys", name.c_str(), static_cast<unsigned long long>(count));
        }
    }
    g_discovered.set_online(online);
}

void install_bases(const Targets& t) {
    if (t.bases == 0) {
        log("bases site not found: Flame Altars are off");
        return;
    }
    auto h = safetyhook::MidHook::create(reinterpret_cast<void*>(t.bases), on_base);
    if (!h) { log("could not hook bases: Flame Altars are off"); return; }
    g_bases_hook = std::move(*h);
    log("hooked %-12s at %llx", "bases", static_cast<unsigned long long>(t.bases));
}

void install_mining(const Targets& t) {
    if (t.mining == 0) {
        log("mining site not found: ore finds are off");
        return;
    }
    auto h = safetyhook::MidHook::create(reinterpret_cast<void*>(t.mining), on_mining);
    if (!h) { log("could not hook mining: ore finds are off"); return; }
    g_mining_hook = std::move(*h);
    log("hooked %-12s at %llx", "mining", static_cast<unsigned long long>(t.mining));
}

void install_chest(const Targets& t) {
    if (t.chest == 0) {
        log("chest site not found: looted chests are off");
        return;
    }
    auto h = safetyhook::MidHook::create(reinterpret_cast<void*>(t.chest), on_chest);
    if (!h) { log("could not hook chest: looted chests are off"); return; }
    g_chest_hook = std::move(*h);
    log("hooked %-12s at %llx", "chest", static_cast<unsigned long long>(t.chest));
}

void enable_chat_probe(const Targets& t) {
    if (t.chat_post == 0) {
        log("chat_post site not found: chat probe is off");
        return;
    }
    g_chat_post = reinterpret_cast<ChatPostFn>(t.chat_post);
    wchar_t path[MAX_PATH] = {};
    DWORD len = GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::wstring dir(path, len);
    g_probe_file = dir.substr(0, dir.find_last_of(L"\\/") + 1) + L"chatprobe.txt";
    log("CHATPROBE on: chat_post at %llx", static_cast<unsigned long long>(t.chat_post));
}

bool install(const Targets& t, std::string& error) {
    if (create(g_player_table_hook, t.player_table, on_player_table, "player_table", error) &&
        create(g_movement_hook, t.movement, on_movement, "movement", error) &&
        create(g_daytime_hook, t.daytime, on_daytime, "daytime", error) &&
        create(g_registry_hook, t.registry, on_registry, "registry", error)) {
        return true;
    }
    g_registry_hook = {};
    g_daytime_hook = {};
    g_movement_hook = {};
    g_player_table_hook = {};
    return false;
}

void refresh_players() {
    uintptr_t manager = g_manager.load(std::memory_order_relaxed);
    if (manager == 0) return;
    for (int i = 0; i < kSlotCount; ++i) {
        uintptr_t slot = manager + kSlots + static_cast<uintptr_t>(i) * kStride;
        uint32_t handle = 0, entity = 0;
        uint8_t state = 0;
        bool in_game = read_u32(slot, handle) && handle != 0 && read_u8(slot + kState, state) &&
                       state == kInGame && read_u32(slot + kEntity, entity) && entity != 0;
        if (!in_game) entity = 0;
        uint32_t previous = g_slots[i].entity.exchange(entity, std::memory_order_relaxed);
        if (previous == 0 && entity != 0 && g_chat_post != nullptr) {
            uint64_t account = 0;
            read_u64(slot + 0x48, account);
            probe_arm(handle, account);
        }
        if (previous != entity) {
            g_slots[i].seen_ms.store(0, std::memory_order_relaxed);
        }
        std::string name = entity != 0 ? read_name(slot + kName) : std::string();
        {
            std::lock_guard lock(g_names_mutex);
            g_names[i] = name;
        }
        if (entity != 0 && g_logged_entity[i] != entity) {
            g_logged_entity[i] = entity;
            log("PLAYER slot %d entity %u name \"%s\"", i, entity, name.c_str());
            log_raw_slot(i, slot);
        } else if (entity == 0 && g_logged_entity[i] != 0) {
            log("LEFT   slot %d entity %u", i, g_logged_entity[i]);
            g_logged_entity[i] = 0;
        }
    }
}

std::atomic<int> g_flame_level{-1};

void set_flame_level(int level) {
    int previous = g_flame_level.exchange(level, std::memory_order_relaxed);
    if (previous != level) log("FLAME level %d (from the server's A2S_INFO)", level);
}

std::string snapshot_json() {
    const uint64_t now = GetTickCount64();
    std::string out = "{\"time\":";
    uintptr_t day = g_daytime.load(std::memory_order_relaxed);
    if (day == 0) {
        out += "null";
    } else {
        uint64_t start = 0, end = 0;
        uint8_t is_day = 0;
        read_u64(day + 0x28, start);
        read_u64(day + 0x30, end);
        read_u8(day + 0x58, is_day);
        char buf[256];
        std::snprintf(buf, sizeof buf, "{\"raw\":%lld,\"dayStart\":%lld,\"dayEnd\":%lld,\"isDay\":%s,\"ageMs\":%llu}",
                      static_cast<long long>(g_time.load(std::memory_order_relaxed)),
                      static_cast<long long>(start), static_cast<long long>(end), is_day ? "true" : "false",
                      static_cast<unsigned long long>(now - g_time_ms.load(std::memory_order_relaxed)));
        out += buf;
    }
    out += ",\"players\":[";
    bool first = true;
    for (int i = 0; i < kSlotCount; ++i) {
        const Slot& s = g_slots[i];
        uint32_t entity = s.entity.load(std::memory_order_relaxed);
        if (entity == 0) continue;
        std::string name;
        {
            std::lock_guard lock(g_names_mutex);
            name = g_names[i];
        }
        uint64_t seen = s.seen_ms.load(std::memory_order_relaxed);
        char buf[256];
        if (seen == 0) {
            std::snprintf(buf, sizeof buf, "{\"entity\":%u,\"name\":\"", entity);
            out += first ? "" : ",";
            out += buf;
            append_escaped(out, name);
            out += "\",\"pos\":null}";
        } else {
            std::snprintf(buf, sizeof buf, "{\"entity\":%u,\"name\":\"", entity);
            out += first ? "" : ",";
            out += buf;
            append_escaped(out, name);
            float q[4];
            uint32_t qbits[4] = {s.qx.load(std::memory_order_relaxed), s.qy.load(std::memory_order_relaxed),
                                 s.qz.load(std::memory_order_relaxed), s.qw.load(std::memory_order_relaxed)};
            std::memcpy(q, qbits, sizeof q);
            std::snprintf(buf, sizeof buf, "\",\"pos\":[%.2f,%.2f,%.2f],\"rot\":[%.4f,%.4f,%.4f,%.4f],\"ageMs\":%llu}",
                          meters(s.x.load(std::memory_order_relaxed)), meters(s.y.load(std::memory_order_relaxed)),
                          meters(s.z.load(std::memory_order_relaxed)), q[0], q[1], q[2], q[3],
                          static_cast<unsigned long long>(now - seen));
            out += buf;
        }
        first = false;
    }
    out += "],\"weather\":";
    append_weather(out);
    out += ",\"findsVersion\":" + std::to_string(g_finds.version());
    out += ",\"basesVersion\":" + std::to_string(g_bases.version(GetTickCount64()));
    const int flame = g_flame_level.load(std::memory_order_relaxed);
    out += ",\"flameLevel\":" + (flame >= 0 ? std::to_string(flame) : std::string("null"));
    out += ",\"discoveredVersion\":" + std::to_string(g_discovered.version());
    out += ",\"exploredVersion\":" + std::to_string(g_explored.version()) + "}";
    return out;
}

void log_diagnostics() {
    uintptr_t day = g_daytime.load(std::memory_order_relaxed);
    if (day != 0) {
        uint64_t start = 0, end = 0;
        uint8_t is_day = 0;
        read_u64(day + 0x28, start);
        read_u64(day + 0x30, end);
        read_u8(day + 0x58, is_day);
        int64_t t = g_time.load(std::memory_order_relaxed);
        log("TIME   raw %lld dayStart %lld dayEnd %lld isDay %u worldTime %lld weather %llx",
            static_cast<long long>(t), static_cast<long long>(start), static_cast<long long>(end), is_day,
            static_cast<long long>(g_world_time.load(std::memory_order_relaxed)),
            static_cast<unsigned long long>(g_weather_system.load(std::memory_order_relaxed)));
    } else {
        log("TIME   daytime system not seen yet");
    }
    for (int i = 0; i < kSlotCount; ++i) {
        const Slot& s = g_slots[i];
        uint32_t entity = s.entity.load(std::memory_order_relaxed);
        if (entity == 0) continue;
        log("POS    entity %u x %.2f y %.2f z %.2f (seen %llu ms ago)", entity,
            meters(s.x.load(std::memory_order_relaxed)), meters(s.y.load(std::memory_order_relaxed)),
            meters(s.z.load(std::memory_order_relaxed)),
            static_cast<unsigned long long>(GetTickCount64() - s.seen_ms.load(std::memory_order_relaxed)));
    }
}

}  // namespace livemap::world
