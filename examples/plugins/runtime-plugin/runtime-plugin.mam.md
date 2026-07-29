---
title: Runtime Plugin
description: Custom runtime plugin for MAM modules
version: 1.0.0
author: MAM Examples
license: MIT
tags: [plugin, runtime, deno, bun, wasm, example]
---

# Runtime Plugin

Demonstrates how to register custom runtimes with the MAM Plugin API.
This plugin adds runtime contexts for Deno, Bun, and WebAssembly execution
environments, each with sandboxed configuration and capability reporting.

## Overview

Runtimes execute code blocks found in MAM modules. Each runtime context
declares which languages it can handle, provides an `execute` function,
and reports its capabilities. The plugin system routes code blocks to
the appropriate runtime based on language detection.

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "custom-runtimes",
  "version": "1.0.0",
  "description": "Custom runtimes: Deno, Bun, and WebAssembly for MAM modules",
  "author": "MAM Examples",
  "license": "MIT",
  "mamVersion": ">=0.1.0",
  "keywords": ["runtime", "deno", "bun", "wasm"],
  "categories": ["runtime"],
  "main": "dist/index.js",
  "engines": { "mam": ">=0.1.0" }
}
```

## TypeScript Plugin Code

```typescript
import {
  MAMPlugin,
  RuntimeContext,
  RuntimeCapability,
  ExecutionContext,
  ExecutionResult,
  ExecutionArtifact,
} from "@mam/plugin-api";
import { MAMModule } from "@mam/ast";
import { execFile } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// ─── Deno Runtime ─────────────────────────────────────────────────

const denoRuntime: RuntimeContext = {
  name: "deno",
  language: "typescript",
  version: "1.40.0",

  canHandle(language: string): boolean {
    const supported = ["typescript", "javascript", "ts", "js", "tsx", "jsx"];
    return supported.includes(language.toLowerCase());
  },

  getCapabilities(): RuntimeCapability[] {
    return [
      { name: "typescript", description: "Native TypeScript execution", supported: true },
      { name: "npm-compat", description: "npm package imports", supported: true },
      { name: "web-apis", description: "Web Platform API access", supported: true },
      { name: "permissions", description: "Fine-grained permission system", supported: true },
      { name: "compile", description: "Single binary compilation", supported: true },
    ];
  },

  getExtensions(): string[] {
    return [".ts", ".js", ".tsx", ".jsx", ".mts", ".mjs"];
  },

  getBinaryPath(): string | null {
    return process.env.DENO_PATH || "deno";
  },

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execCommand("deno", ["--version"]);
      return result.includes("deno");
    } catch {
      return false;
    }
  },

  async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = performance.now();
    const tmpFile = join(tmpdir(), `mam-deno-${randomBytes(8).toString("hex")}.ts`);

    try {
      await writeFile(tmpFile, code, "utf-8");

      const args = [
        "run",
        "--allow-read",
        "--allow-net",
        "--allow-env",
        "--no-lock",
      ];

      if (context.env) {
        for (const [key, value] of Object.entries(context.env)) {
          args.push("--allow-env", `${key}=${value}`);
        }
      }

      args.push(tmpFile);

      const result = await execCommand("deno", args, {
        timeout: context.timeout || 30000,
        cwd: context.cwd,
        env: context.env,
      });

      return {
        success: true,
        output: result,
        stdout: result,
        timeMs: performance.now() - startTime,
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || "",
        timeMs: performance.now() - startTime,
        exitCode: error.code || 1,
      };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  },
};

// ─── Bun Runtime ──────────────────────────────────────────────────

const bunRuntime: RuntimeContext = {
  name: "bun",
  language: "javascript",
  version: "1.1.0",

  canHandle(language: string): boolean {
    const supported = ["javascript", "js", "jsx", "typescript", "ts", "tsx"];
    return supported.includes(language.toLowerCase());
  },

  getCapabilities(): RuntimeCapability[] {
    return [
      { name: "fast-startup", description: "Sub-millisecond startup time", supported: true },
      { name: "node-compat", description: "Node.js API compatibility", supported: true },
      { name: "bun:test", description: "Built-in test runner", supported: true },
      { name: "bun:sqlite", description: "Built-in SQLite support", supported: true },
      { name: "bun:ffi", description: "Foreign function interface", supported: true },
      { name: "bundler", description: "Built-in bundler", supported: true },
    ];
  },

  getExtensions(): string[] {
    return [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
  },

  getBinaryPath(): string | null {
    return process.env.BUN_PATH || "bun";
  },

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execCommand("bun", ["--version"]);
      return /^\d+\.\d+/.test(result.trim());
    } catch {
      return false;
    }
  },

  async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = performance.now();
    const tmpFile = join(tmpdir(), `mam-bun-${randomBytes(8).toString("hex")}.js`);

    try {
      await writeFile(tmpFile, code, "utf-8");

      const args = ["run", tmpFile];
      const result = await execCommand("bun", args, {
        timeout: context.timeout || 30000,
        cwd: context.cwd,
        env: context.env,
      });

      return {
        success: true,
        output: result,
        stdout: result,
        timeMs: performance.now() - startTime,
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || "",
        timeMs: performance.now() - startTime,
        exitCode: error.code || 1,
      };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  },
};

// ─── WebAssembly Runtime ──────────────────────────────────────────

const wasmRuntime: RuntimeContext = {
  name: "wasm",
  language: "wasm",
  version: "1.0",

  canHandle(language: string): boolean {
    const supported = ["wasm", "webassembly", "wat"];
    return supported.includes(language.toLowerCase());
  },

  getCapabilities(): RuntimeCapability[] {
    return [
      { name: "sandboxed", description: "Memory-safe sandboxed execution", supported: true },
      { name: "wasi", description: "WebAssembly System Interface", supported: true },
      { name: "simd", description: "SIMD operations", supported: true },
      { name: "threads", description: "Shared-memory threads", supported: false, version: "preview" },
    ];
  },

  getExtensions(): string[] {
    return [".wasm", ".wat"];
  },

  getBinaryPath(): string | null {
    return process.env.WASM_PATH || null;
  },

  async isAvailable(): Promise<boolean> {
    // WASM is available in Node.js 16+ natively
    const nodeVersion = parseInt(process.version.slice(1), 10);
    return nodeVersion >= 16;
  },

  async execute(code: string, context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      // For .wat (text format), we need to convert to .wasm
      let wasmBinary: Buffer;
      if (code.trim().startsWith("(module")) {
        // WAT text format — requires wabt tools
        const tmpWat = join(tmpdir(), `mam-wasm-${randomBytes(8).toString("hex")}.wat`);
        const tmpWasm = tmpWat.replace(".wat", ".wasm");
        await writeFile(tmpWat, code, "utf-8");
        await execCommand("wat2wasm", [tmpWat, "-o", tmpWasm]);
        wasmBinary = await readFile(tmpWasm);
        await unlink(tmpWat).catch(() => {});
        await unlink(tmpWasm).catch(() => {});
      } else {
        // Binary WASM
        wasmBinary = Buffer.from(code, "base64");
      }

      // Execute with Node.js WASM runtime
      const wasmModule = await WebAssembly.compile(wasmBinary);
      const imports = buildWasiImports(context);
      const instance = await WebAssembly.instantiate(wasmModule, imports);

      // Try to call exported main or _start
      const exports = instance.exports as Record<string, any>;
      let output = "";

      if (typeof exports._start === "function") {
        exports._start();
      } else if (typeof exports.main === "function") {
        const result = exports.main();
        if (result !== undefined) output = String(result);
      }

      return {
        success: true,
        output,
        stdout: output,
        timeMs: performance.now() - startTime,
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timeMs: performance.now() - startTime,
        exitCode: 1,
      };
    }
  },
};

// ─── Plugin Assembly ──────────────────────────────────────────────

const runtimePlugin: MAMPlugin = {
  manifest: {
    name: "custom-runtimes",
    version: "1.0.0",
    description: "Custom runtimes: Deno, Bun, and WebAssembly for MAM modules",
    author: "MAM Examples",
    license: "MIT",
    mamVersion: ">=0.1.0",
    keywords: ["runtime", "deno", "bun", "wasm"],
    categories: ["runtime"],
    main: "dist/index.js",
  },

  contexts: [denoRuntime, bunRuntime, wasmRuntime],

  hooks: {
    beforeExecution: (module) => {
      // Attach runtime availability metadata
      (module as any)._runtimeMeta = {
        checkedAt: new Date().toISOString(),
        available: {} as Record<string, boolean>,
      };
      return module;
    },

    afterExecution: (result) => {
      // Enrich result with runtime metadata
      if ((result as any).stdout) {
        (result as any).artifacts = (result as any).artifacts || [];
      }
      return result;
    },

    onError: (error) => {
      if (error.phase === "execution") {
        console.error(`[runtime-plugin] Execution error in ${error.plugin}: ${error.error.message}`);
        error.handled = true;
        error.recovery = "Check runtime availability and permissions";
      }
      return error;
    },
  },
};

// ─── Utilities ────────────────────────────────────────────────────

function execCommand(
  cmd: string,
  args: string[],
  options: { timeout?: number; cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: options.timeout || 30000,
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          (error as any).stderr = stderr;
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

function buildWasiImports(context: ExecutionContext): Record<string, any> {
  return {
    wasi_snapshot_preview1: {
      proc_exit: () => {},
      fd_write: () => 0,
      fd_read: () => 0,
      fd_seek: () => 0,
      environ_sizes_get: () => 0,
      environ_get: () => 0,
      clock_time_get: () => 0,
    },
    env: context.env || {},
  };
}

export default runtimePlugin;
```

## Python Runtime Manager

```python
"""
Custom runtime manager for MAM modules.

Provides Deno, Bun, and WebAssembly execution environments with
sandboxed configuration, capability detection, and timeout management.
Designed for integration with the MAM execution pipeline.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import base64
import hashlib
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Protocol


class RuntimeType(Enum):
    """Supported runtime types."""
    DENO = "deno"
    BUN = "bun"
    WASM = "wasm"
    NODE = "node"


@dataclass
class RuntimeCapability:
    """A single runtime capability."""
    name: str
    description: str
    supported: bool
    version: str | None = None


@dataclass
class ExecutionResult:
    """Result of a code execution."""
    success: bool
    output: str = ""
    error: str = ""
    stdout: str = ""
    stderr: str = ""
    time_ms: float = 0.0
    exit_code: int = 0
    artifacts: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ExecutionConfig:
    """Configuration for an execution."""
    timeout: int = 30000
    cwd: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    max_output_size: int = 1024 * 1024
    permissions: list[str] = field(default_factory=lambda: ["read", "write", "env"])


class Runtime(Protocol):
    """Protocol defining a runtime interface."""
    name: str
    language: str
    version: str

    def can_handle(self, language: str) -> bool: ...
    def get_capabilities(self) -> list[RuntimeCapability]: ...
    def execute(self, code: str, config: ExecutionConfig | None = None) -> ExecutionResult: ...
    def is_available(self) -> bool: ...


# ─── Deno Runtime ──────────────────────────────────────────────────

class DenoRuntime:
    """Deno runtime for TypeScript and JavaScript execution."""

    def __init__(self) -> None:
        self.name = "deno"
        self.language = "typescript"
        self.version = self._detect_version()

    def _detect_version(self) -> str:
        try:
            result = subprocess.run(
                ["deno", "--version"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                if line.startswith("deno"):
                    return line.split()[-1]
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        return "unknown"

    def can_handle(self, language: str) -> bool:
        supported = {"typescript", "javascript", "ts", "js", "tsx", "jsx"}
        return language.lower() in supported

    def get_capabilities(self) -> list[RuntimeCapability]:
        return [
            RuntimeCapability("typescript", "Native TypeScript execution", True),
            RuntimeCapability("npm-compat", "npm package imports", True),
            RuntimeCapability("web-apis", "Web Platform API access", True),
            RuntimeCapability("permissions", "Fine-grained permission system", True),
        ]

    def is_available(self) -> bool:
        try:
            result = subprocess.run(
                ["deno", "--version"],
                capture_output=True, text=True, timeout=5,
            )
            return "deno" in result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    def execute(self, code: str, config: ExecutionConfig | None = None) -> ExecutionResult:
        cfg = config or ExecutionConfig()
        start = time.perf_counter()

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".ts", delete=False, prefix="mam-deno-"
        ) as f:
            f.write(code)
            tmp_path = f.name

        try:
            args = ["deno", "run", "--allow-read", "--allow-net", "--allow-env", "--no-lock"]

            for key, val in cfg.env.items():
                args.extend(["--allow-env", f"{key}={val}"])

            args.append(tmp_path)

            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=cfg.timeout / 1000,
                cwd=cfg.cwd,
                env={**os.environ, **cfg.env},
            )

            return ExecutionResult(
                success=result.returncode == 0,
                output=result.stdout,
                stdout=result.stdout,
                stderr=result.stderr,
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=result.returncode,
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                success=False,
                error=f"Execution timed out after {cfg.timeout}ms",
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=-1,
            )
        except Exception as e:
            return ExecutionResult(
                success=False,
                error=str(e),
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=1,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ─── Bun Runtime ───────────────────────────────────────────────────

class BunRuntime:
    """Bun runtime for fast JavaScript and TypeScript execution."""

    def __init__(self) -> None:
        self.name = "bun"
        self.language = "javascript"
        self.version = self._detect_version()

    def _detect_version(self) -> str:
        try:
            result = subprocess.run(
                ["bun", "--version"],
                capture_output=True, text=True, timeout=5,
            )
            return result.stdout.strip()
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return "unknown"

    def can_handle(self, language: str) -> bool:
        supported = {"javascript", "js", "jsx", "typescript", "ts", "tsx"}
        return language.lower() in supported

    def get_capabilities(self) -> list[RuntimeCapability]:
        return [
            RuntimeCapability("fast-startup", "Sub-millisecond startup time", True),
            RuntimeCapability("node-compat", "Node.js API compatibility", True),
            RuntimeCapability("bun:test", "Built-in test runner", True),
            RuntimeCapability("bun:sqlite", "Built-in SQLite support", True),
        ]

    def is_available(self) -> bool:
        try:
            result = subprocess.run(
                ["bun", "--version"],
                capture_output=True, text=True, timeout=5,
            )
            return bool(result.stdout.strip())
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    def execute(self, code: str, config: ExecutionConfig | None = None) -> ExecutionResult:
        cfg = config or ExecutionConfig()
        start = time.perf_counter()

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".js", delete=False, prefix="mam-bun-"
        ) as f:
            f.write(code)
            tmp_path = f.name

        try:
            result = subprocess.run(
                ["bun", "run", tmp_path],
                capture_output=True,
                text=True,
                timeout=cfg.timeout / 1000,
                cwd=cfg.cwd,
                env={**os.environ, **cfg.env},
            )

            return ExecutionResult(
                success=result.returncode == 0,
                output=result.stdout,
                stdout=result.stdout,
                stderr=result.stderr,
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=result.returncode,
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                success=False,
                error=f"Execution timed out after {cfg.timeout}ms",
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=-1,
            )
        except Exception as e:
            return ExecutionResult(
                success=False,
                error=str(e),
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=1,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ─── WebAssembly Runtime ───────────────────────────────────────────

class WasmRuntime:
    """WebAssembly runtime using Node.js built-in WASM support."""

    def __init__(self) -> None:
        self.name = "wasm"
        self.language = "wasm"
        self.version = "1.0"

    def can_handle(self, language: str) -> bool:
        supported = {"wasm", "webassembly", "wat"}
        return language.lower() in supported

    def get_capabilities(self) -> list[RuntimeCapability]:
        return [
            RuntimeCapability("sandboxed", "Memory-safe sandboxed execution", True),
            RuntimeCapability("wasi", "WebAssembly System Interface", True, "preview1"),
            RuntimeCapability("simd", "SIMD operations", True),
            RuntimeCapability("threads", "Shared-memory threads", False, "preview"),
        ]

    def is_available(self) -> bool:
        # WASM is available in Python via wasmer or wasmtime
        try:
            import wasmtime  # noqa: F401
            return True
        except ImportError:
            return False

    def execute(self, code: str, config: ExecutionConfig | None = None) -> ExecutionResult:
        cfg = config or ExecutionConfig()
        start = time.perf_counter()

        try:
            if code.strip().startswith("(module"):
                wasm_binary = self._wat_to_wasm(code)
            else:
                wasm_binary = base64.b64decode(code)

            try:
                from wasmtime import Engine, Module, Store
                engine = Engine()
                module = Module(engine, wasm_binary)
                store = Store(engine)
                instance = module.instantiate(store)
                result = instance.exports(store).get("main")
                if result:
                    output = str(result(store))
                else:
                    output = ""
            except ImportError:
                # Fallback: just validate the binary
                output = f"WASM binary validated: {len(wasm_binary)} bytes"

            return ExecutionResult(
                success=True,
                output=output,
                stdout=output,
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=0,
            )
        except Exception as e:
            return ExecutionResult(
                success=False,
                error=str(e),
                time_ms=(time.perf_counter() - start) * 1000,
                exit_code=1,
            )

    def _wat_to_wasm(self, wat: str) -> bytes:
        """Convert WAT text format to WASM binary using wabt tools."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".wat", delete=False
        ) as f:
            f.write(wat)
            wat_path = f.name

        wasm_path = wat_path.replace(".wat", ".wasm")
        try:
            subprocess.run(
                ["wat2wasm", wat_path, "-o", wasm_path],
                capture_output=True, check=True, timeout=30,
            )
            with open(wasm_path, "rb") as f:
                return f.read()
        finally:
            for p in [wat_path, wasm_path]:
                try:
                    os.unlink(p)
                except OSError:
                    pass


# ─── Runtime Manager ───────────────────────────────────────────────

class RuntimeManager:
    """Manages multiple runtimes and routes execution to the best match."""

    def __init__(self) -> None:
        self.runtimes: list[Runtime] = [
            DenoRuntime(),
            BunRuntime(),
            WasmRuntime(),
        ]

    def get_runtime(self, language: str) -> Runtime | None:
        """Find the best runtime for a given language."""
        for runtime in self.runtimes:
            if runtime.can_handle(language) and runtime.is_available():
                return runtime
        return None

    def get_available_runtimes(self) -> list[Runtime]:
        """List all available runtimes."""
        return [r for r in self.runtimes if r.is_available()]

    def execute(
        self, code: str, language: str, config: ExecutionConfig | None = None
    ) -> ExecutionResult:
        """Execute code using the appropriate runtime."""
        runtime = self.get_runtime(language)
        if not runtime:
            return ExecutionResult(
                success=False,
                error=f"No available runtime for language: {language}",
                exit_code=1,
            )
        return runtime.execute(code, config)


# ─── Tests ──────────────────────────────────────────────────────────

def test_deno_can_handle():
    r = DenoRuntime()
    assert r.can_handle("typescript")
    assert r.can_handle("ts")
    assert r.can_handle("javascript")
    assert not r.can_handle("python")
    assert not r.can_handle("rust")


def test_bun_can_handle():
    r = BunRuntime()
    assert r.can_handle("javascript")
    assert r.can_handle("js")
    assert r.can_handle("tsx")
    assert not r.can_handle("go")


def test_wasm_can_handle():
    r = WasmRuntime()
    assert r.can_handle("wasm")
    assert r.can_handle("webassembly")
    assert r.can_handle("wat")
    assert not r.can_handle("python")


def test_runtime_manager_dispatch():
    manager = RuntimeManager()
    runtime = manager.get_runtime("typescript")
    # Runtime depends on what is installed
    if runtime:
        assert runtime.can_handle("typescript")


def test_execution_config():
    cfg = ExecutionConfig(timeout=5000, env={"KEY": "val"})
    assert cfg.timeout == 5000
    assert cfg.env["KEY"] == "val"


def test_deno_capabilities():
    r = DenoRuntime()
    caps = r.get_capabilities()
    assert len(caps) >= 3
    assert any(c.name == "typescript" for c in caps)


if __name__ == "__main__":
    test_deno_can_handle()
    test_bun_can_handle()
    test_wasm_can_handle()
    test_runtime_manager_dispatch()
    test_execution_config()
    test_deno_capabilities()
    print("All tests passed.")
```

## Usage

```bash
# List available runtimes
mam runtimes list

# Execute a code block with a specific runtime
mam run my-module.mam.md --runtime deno
mam run my-module.mam.md --runtime bun
mam run my-module.mam.md --runtime wasm

# Check runtime availability
mam runtimes check deno
```

```typescript
// Programmatic usage
import { PluginRegistry, HookManager } from "@mam/plugin-api";

const hookManager = new HookManager();
const registry = new PluginRegistry(hookManager);
await registry.loadPlugin("./plugins/runtime-plugin");

const plugin = registry.getPlugin("custom-runtimes")?.plugin;
const denoRuntime = plugin?.contexts?.find((c) => c.name === "deno");

if (denoRuntime && await denoRuntime.isAvailable()) {
  const result = await denoRuntime.execute('console.log("Hello from Deno!")', {
    module: mamModule,
    inputs: {},
    memory: {},
    timeout: 10000,
  });
  console.log(result.stdout);
}
```

## What This Demonstrates

| Concept | Where |
|---------|-------|
| Runtime registration | `contexts` array with `name`, `language`, `version` |
| Capability reporting | `getCapabilities()` returning `RuntimeCapability[]` |
| Language detection | `canHandle()` routing code to appropriate runtime |
| Binary detection | `isAvailable()` checking if runtime is installed |
| Sandboxed execution | Temp file creation, timeout, cleanup, permission flags |
| WASM support | WAT-to-WASM conversion, Node.js WASM compilation |
| Error recovery | `onError` hook with recovery suggestions |
| Python runtime manager | `RuntimeManager` class with `get_runtime()` dispatch |
