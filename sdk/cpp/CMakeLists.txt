# MAM C++ SDK — CMake
#
# Builds a thin C++17 RAII wrapper over the MAM C SDK. The C SDK lives in the
# sibling `../c` directory and is compiled directly into this library, so the
# C++ SDK can be built without installing anything.
#
#   cmake -S . -B build
#   cmake --build build
#   ctest --test-dir build --output-on-failure
#
# Useful overrides:
#   -DMAM_CPP_BUILD_TESTS=OFF    skip the test target
#   -DMAM_CPP_SANITIZE=ON         build with AddressSanitizer and UBSan
#   -DCMAKE_BUILD_TYPE=Debug     unoptimised build with assertions

cmake_minimum_required(VERSION 3.16)

project(mam-sdk-cpp
        VERSION 0.1.0
        DESCRIPTION "C++17 SDK for MAM (Machine Agent Modules)"
        LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(MAM_CPP_BUILD_TESTS "Build the C++ SDK test suite" ON)
option(MAM_CPP_SANITIZE "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)

# --------------------------------------------------------------------------- #
# The C core                                                                   #
# --------------------------------------------------------------------------- #

set(MAM_C_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../c")

if(NOT EXISTS "${MAM_C_DIR}/include/mam/mam.h")
    message(FATAL_ERROR
            "The MAM C SDK was not found at ${MAM_C_DIR}. "
            "Both sdk/c and sdk/cpp must be checked out side by side.")
endif()

add_library(mam_c STATIC
            "${MAM_C_DIR}/src/ast.c"
            "${MAM_C_DIR}/src/cache.c"
            "${MAM_C_DIR}/src/config.c"
            "${MAM_C_DIR}/src/doctor.c"
            "${MAM_C_DIR}/src/format.c"
            "${MAM_C_DIR}/src/graph.c"
            "${MAM_C_DIR}/src/parser.c"
            "${MAM_C_DIR}/src/runtime.c"
            "${MAM_C_DIR}/src/template.c"
            "${MAM_C_DIR}/src/util.c"
            "${MAM_C_DIR}/src/validator.c")

target_include_directories(mam_c PUBLIC "${MAM_C_DIR}/include")
set_target_properties(mam_c PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(mam_c PRIVATE -Wall -Wextra)
endif()

# --------------------------------------------------------------------------- #
# The C++ wrapper                                                              #
# --------------------------------------------------------------------------- #

add_library(mam_cpp src/mam.cpp)
target_include_directories(mam_cpp PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(mam_cpp PUBLIC mam_c)
set_target_properties(mam_cpp PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(mam_cpp PRIVATE -Wall -Wextra)
endif()

# --------------------------------------------------------------------------- #
# Sanitizers                                                                   #
# --------------------------------------------------------------------------- #

if(MAM_CPP_SANITIZE)
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        set(MAM_SANITIZE_FLAGS -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_compile_options(mam_c PRIVATE ${MAM_SANITIZE_FLAGS})
        target_compile_options(mam_cpp PRIVATE ${MAM_SANITIZE_FLAGS})
        target_link_options(mam_cpp PUBLIC ${MAM_SANITIZE_FLAGS})
    else()
        message(WARNING "MAM_CPP_SANITIZE is not supported for ${CMAKE_CXX_COMPILER_ID}")
    endif()
endif()

# --------------------------------------------------------------------------- #
# Tests                                                                        #
# --------------------------------------------------------------------------- #

if(MAM_CPP_BUILD_TESTS)
    enable_testing()

    add_executable(mam_cpp_tests tests/test_mam.cpp)
    target_link_libraries(mam_cpp_tests PRIVATE mam_cpp)
    add_test(NAME mam_cpp_tests COMMAND mam_cpp_tests)
endif()

# --------------------------------------------------------------------------- #
# Install                                                                      #
# --------------------------------------------------------------------------- #

include(GNUInstallDirs)

install(TARGETS mam_cpp
        ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(TARGETS mam_c
        ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(DIRECTORY include/mam
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
        FILES_MATCHING PATTERN "*.hpp")
install(DIRECTORY "${MAM_C_DIR}/include/mam"
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
        FILES_MATCHING PATTERN "*.h")
