# MAM C SDK — Makefile
#
# Builds the static library, the test binaries, and runs the suite.
# The SDK has no third-party dependencies, so a bare toolchain is enough:
#
#   make            build the library and tests
#   make test       build and run every suite
#   make clean      remove build output
#
# Useful overrides:
#   make CC=clang
#   make SANITIZE=1        build with AddressSanitizer and UBSan
#   make COVERAGE=1        build with gcov instrumentation

CC      ?= cc
AR      ?= ar
CSTD    ?= -std=c11
WARN    ?= -Wall -Wextra -Wpedantic -Wshadow -Wstrict-prototypes
OPT     ?= -O2
CFLAGS  ?= $(CSTD) $(WARN) $(OPT) -Iinclude
LDFLAGS ?=
LDLIBS  ?=

BUILD   := build
SRC     := $(wildcard src/*.c)
OBJ     := $(patsubst src/%.c,$(BUILD)/%.o,$(SRC))
LIB     := $(BUILD)/libmam.a

TEST_SRC := $(wildcard tests/*.c)
TEST_BIN := $(patsubst tests/%.c,$(BUILD)/%,$(TEST_SRC))

SANITIZE_FLAGS := -fsanitize=address,undefined -fno-omit-frame-pointer
ifeq ($(SANITIZE),1)
  CFLAGS  += $(SANITIZE_FLAGS)
  LDFLAGS += $(SANITIZE_FLAGS)
endif

ifeq ($(COVERAGE),1)
  CFLAGS += --coverage
  LDFLAGS += --coverage
endif

.PHONY: all test clean check help

all: $(LIB) $(TEST_BIN)

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/%.o: src/%.c | $(BUILD)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD)/%.o: tests/%.c | $(BUILD)
	$(CC) $(CFLAGS) -Itests -c $< -o $@

$(LIB): $(OBJ)
	$(AR) rcs $@ $(OBJ)

$(BUILD)/%: tests/%.c $(LIB) | $(BUILD)
	$(CC) $(CFLAGS) -Itests $< $(LIB) $(LDFLAGS) $(LDLIBS) -o $@

test: $(TEST_BIN)
	@fail=0; \
	for binary in $(TEST_BIN); do \
		echo "--- $$binary"; \
		./$$binary || fail=1; \
	done; \
	if [ $$fail -ne 0 ]; then echo "FAILED"; exit 1; fi; \
	echo "all suites passed"

check: test

clean:
	@rm -rf $(BUILD)
	@rm -f test-sdk-config.tmp

help:
	@echo "targets: all (default), test, check, clean"
	@echo "flags:   CC, OPT, SANITIZE=1, COVERAGE=1"
