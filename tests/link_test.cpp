// Plain assert-based tests for the map link (no framework, runs on the build PC).
#include <cstdio>
#include <cstdlib>

#include "../src/link.h"

namespace link = livemap::link;

static int failures = 0;

#define EXPECT(cond)                                                                              \
    do {                                                                                          \
        if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } \
    } while (0)

int main() {
    EXPECT(link::query_port("{\n\t\"name\": \"x\",\n\t\"queryPort\": 15637,\n\t\"slotCount\": 2\n}") == 15637);
    EXPECT(link::query_port("{\"queryPort\":15699}") == 15699);
    EXPECT(link::query_port("{\"gamePort\": 15636}") == 0);
    EXPECT(link::query_port("{\"queryPort\": \"x\"}") == 0);
    EXPECT(link::query_port("{\"queryPort\": 70000}") == 0);

    EXPECT(link::valid_ip("203.0.113.5"));
    EXPECT(link::valid_ip("2001:db8::1"));
    EXPECT(!link::valid_ip("203.0.113"));
    EXPECT(!link::valid_ip("256.1.1.1"));
    EXPECT(!link::valid_ip("<html>"));
    EXPECT(!link::valid_ip(""));
    EXPECT(!link::valid_ip("1::2::3"));

    EXPECT(link::make("", "203.0.113.5", 15637, "abc") == "http://203.0.113.5:15637/?key=abc");
    EXPECT(link::make("", "2001:db8::1", 15637, "abc") == "http://[2001:db8::1]:15637/?key=abc");
    EXPECT(link::make("https://karte.example.ch/", "203.0.113.5", 15637, "abc") == "https://karte.example.ch/?key=abc");
    EXPECT(link::make("map.example.com:8080", "", 0, "k") == "http://map.example.com:8080/?key=k");
    EXPECT(link::make("", "", 15637, "abc").empty());

    EXPECT(link::chat_line("http://203.0.113.5:15637/?key=abc", 15637) == "Live map: 203.0.113.5:15637/abc");
    EXPECT(link::short_form("https://karte.example.ch/?key=ourmap") == "karte.example.ch/ourmap");
    EXPECT(link::short_form("http://[2001:db8::1]:15637/?key=x1y2") == "[2001:db8::1]:15637/x1y2");

    EXPECT(link::key_ok("ourmap"));
    EXPECT(link::key_ok("Embervale-33_map"));
    EXPECT(link::key_ok("map"));
    EXPECT(!link::key_ok("ab"));             // too short
    EXPECT(!link::key_ok("our map"));        // space
    EXPECT(!link::key_ok("map.json"));       // dot
    EXPECT(!link::key_ok("State"));          // a route of the server
    EXPECT(link::key_equal("OurMap", "ourmap"));
    EXPECT(!link::key_equal("ourmap", "ourmaps"));
    EXPECT(link::chat_line("", 15637).find("port 15637") != std::string::npos);

    if (failures == 0) {
        std::printf("link tests passed\n");
        return EXIT_SUCCESS;
    }
    std::printf("%d link test(s) failed\n", failures);
    return EXIT_FAILURE;
}
