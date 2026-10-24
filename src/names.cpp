#include "names.h"

#include "memory.h"
#include "text.h"

namespace livemap::names {

std::string read(uintptr_t field) {
    uintptr_t ptr = 0;
    uint64_t length = 0;
    if (!read_ptr(field, ptr) || !read_u64(field + 8, length) || ptr < 0x10000 || length == 0 || length > kMaxBytes) return {};
    std::string s(static_cast<size_t>(length), '\0');
    if (!read_bytes(ptr, s.data(), s.size())) return {};
    return text::clean_utf8(s);
}

}  // namespace livemap::names
