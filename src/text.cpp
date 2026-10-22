#include "text.h"

#include <cstdint>

namespace livemap::text {

std::string clean_utf8(std::string_view bytes) {
    static constexpr char kReplacement[] = "\xEF\xBF\xBD";
    std::string out;
    out.reserve(bytes.size());
    size_t i = 0;
    while (i < bytes.size()) {
        const auto b = static_cast<uint8_t>(bytes[i]);
        if (b < 0x80) {
            out += (b < 0x20 || b == 0x7F) ? ' ' : static_cast<char>(b);
            ++i;
            continue;
        }
        // Sequence length and the smallest code point it may encode (rejects overlong forms).
        size_t length = 0;
        uint32_t cp = 0, min = 0;
        if (b >= 0xC2 && b <= 0xDF) { length = 2; cp = b & 0x1F; min = 0x80; }
        else if (b >= 0xE0 && b <= 0xEF) { length = 3; cp = b & 0x0F; min = 0x800; }
        else if (b >= 0xF0 && b <= 0xF4) { length = 4; cp = b & 0x07; min = 0x10000; }
        bool ok = length != 0 && i + length <= bytes.size();
        for (size_t k = 1; ok && k < length; ++k) {
            const auto c = static_cast<uint8_t>(bytes[i + k]);
            if ((c & 0xC0) != 0x80) ok = false;
            else cp = (cp << 6) | (c & 0x3F);
        }
        if (ok && (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))) ok = false;
        if (!ok) {
            out += kReplacement;
            ++i;
            continue;
        }
        out.append(bytes.substr(i, length));
        i += length;
    }
    return out;
}

}  // namespace livemap::text
