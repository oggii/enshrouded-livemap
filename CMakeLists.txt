cmake_minimum_required(VERSION 3.28)
project(enshrouded_livemap VERSION 1.2.0 LANGUAGES CXX ASM_MASM)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT: the Wine prefix of the server image needs no extra runtime.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)
set(SAFETYHOOK_FETCH_ZYDIS ON CACHE BOOL "" FORCE)
FetchContent_Declare(
    safetyhook
    GIT_REPOSITORY https://github.com/cursey/safetyhook.git
    GIT_TAG v0.7.0
)
FetchContent_MakeAvailable(safetyhook)

add_library(livemap_core STATIC src/scan.cpp src/finds.cpp src/link.cpp src/text.cpp src/bases.cpp)
target_include_directories(livemap_core PUBLIC src)

# The DLL is named iphlpapi.dll because the server loads it in place of the real one.
add_library(iphlpapi SHARED
    src/main.cpp
    src/config.cpp
    src/log.cpp
    src/memory.cpp
    src/ecs.cpp
    src/world.cpp
    src/web.cpp
    src/announce.cpp
    src/public_ip.cpp
    src/proxy.cpp
    src/proxy_stubs.asm
    src/proxy.def
)
target_link_libraries(iphlpapi PRIVATE livemap_core safetyhook::safetyhook ws2_32 bcrypt winhttp)
target_compile_definitions(iphlpapi PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _CRT_SECURE_NO_WARNINGS
    LIVEMAP_VERSION="${PROJECT_VERSION}")
target_compile_options(iphlpapi PRIVATE $<$<COMPILE_LANGUAGE:CXX>:/W4 /permissive->)

# Offline check against an enshrouded_server.exe on disk: would the DLL hook this build?
add_executable(finds_test tests/finds_test.cpp)
target_link_libraries(finds_test PRIVATE livemap_core)
enable_testing()
add_test(NAME finds COMMAND finds_test)
add_executable(link_test tests/link_test.cpp)
target_link_libraries(link_test PRIVATE livemap_core)
add_test(NAME link COMMAND link_test)
add_executable(text_test tests/text_test.cpp)
target_link_libraries(text_test PRIVATE livemap_core)
add_test(NAME text COMMAND text_test)
add_executable(bases_test tests/bases_test.cpp)
target_link_libraries(bases_test PRIVATE livemap_core)
add_test(NAME bases COMMAND bases_test)

add_executable(livemap_selftest tools/selftest.cpp)
target_link_libraries(livemap_selftest PRIVATE livemap_core)
target_compile_definitions(livemap_selftest PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
