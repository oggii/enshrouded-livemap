// Plain assert-based tests for cleaning names from game memory (no framework).
#include <cstdio>
#include <string>

#include "../src/text.h"

using livemap::text::clean_utf8;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

int main() {
    const std::string fffd = "\xEF\xBF\xBD";
    EXPECT(clean_utf8("OG Vanilla K") == "OG Vanilla K");
    // Valid UTF-8 stays: Turkish, Kurdish, German letters, CJK, an emoji (4 bytes).
    EXPECT(clean_utf8("\xC3\x96zg\xC3\xBC\x72") == "\xC3\x96zg\xC3\xBCr");                // Özgür
    EXPECT(clean_utf8("\xC5\x9E\x65\x76\xC3\xAA") == "\xC5\x9E\x65v\xC3\xAA");             // Şevê
    EXPECT(clean_utf8("\xE6\x9D\xB1\xE4\xBA\xAC") == "\xE6\x9D\xB1\xE4\xBA\xAC");          // 東京
    EXPECT(clean_utf8("a\xF0\x9F\x94\xA5" "b") == "a\xF0\x9F\x94\xA5" "b");                 // a🔥b
    // The bytes of a pointer read as text (the bug of 1.0.1): each invalid byte -> U+FFFD.
    EXPECT(clean_utf8("\xE0\xF0\x84G\xB5u") == fffd + fffd + fffd + "G" + fffd + "u");
    // Cut-off sequence, overlong form, UTF-16 surrogate, beyond U+10FFFF.
    EXPECT(clean_utf8("x\xC3") == "x" + fffd);
    EXPECT(clean_utf8("\xC0\xAF") == fffd + fffd);
    EXPECT(clean_utf8("\xED\xA0\x80") == fffd + fffd + fffd);
    EXPECT(clean_utf8("\xF4\x90\x80\x80") == fffd + fffd + fffd + fffd);
    // Control characters become spaces, quotes stay (JSON escaping happens later).
    EXPECT(clean_utf8("a\tb\x7F" "c\"") == "a b c\"");
    EXPECT(clean_utf8("") == "");

    if (failures) std::printf("%d failure(s)\n", failures);
    else std::printf("all text tests passed\n");
    return failures ? 1 : 0;
}
