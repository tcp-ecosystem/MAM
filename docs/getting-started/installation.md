# Installation

> **Get up and running with MAM in minutes.**

---

## Prerequisites

Before installing MAM, ensure you have:

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 20+ | Runtime environment |
| pnpm | 8+ | Package manager |
| npm | 10+ | Alternative package manager |
| Git | 2.30+ | Version control |

### Checking Prerequisites

```bash
node --version    # v20.0.0 or higher
pnpm --version    # 8.0.0 or higher
npm --version     # 10.0.0 or higher
git --version     # 2.30.0 or higher
```

---

## Installation Methods

### Method 1: Install via npm (Recommended)

The simplest way to install MAM globally:

```bash
npm install -g @mam/cli
```

Verify installation:

```bash
mam --version
# Output: 1.0.0
```

### Method 2: Install via pnpm

```bash
pnpm add -g @mam/cli
```

### Method 3: Install from Source

Clone the repository and build from source:

```bash
git clone https://github.com/lifejiggy/mam.git
cd mam
pnpm install
pnpm build
```

Link the CLI globally:

```bash
pnpm link --global
```

### Method 4: Using npx (No Install)

Run MAM without installing:

```bash
npx @mam/cli init
```

---

## Platform-Specific Instructions

### macOS

```bash
# Using Homebrew (if available)
brew install node@20

# Install MAM
npm install -g @mam/cli
```

### Windows

```powershell
# Using Chocolatey
choco install nodejs-lts

# Install MAM
npm install -g @mam/cli
```

### Linux (Ubuntu/Debian)

```bash
# Install Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Install MAM
npm install -g @mam/cli
```

### Docker

```bash
docker pull mam/cli:latest
docker run -v $(pwd):/workspace mam/cli init
```

---

## IDE Setup

### VS Code Extension

Install the MAM extension for VS Code:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "MAM"
4. Install the MAM extension

Features included:
- Syntax highlighting for `.mam.md` files
- Auto-completion for section names
- Real-time validation
- Hover documentation
- Go to definition
- Find references

### JetBrains IDEs

1. Go to Settings > Plugins
2. Search for "MAM"
3. Install and restart IDE

---

## Configuration

### Global Configuration

Create `~/.mam/config.json`:

```json
{
  "defaultRuntime": "python",
  "validationLevel": "schema",
  "sandboxType": "process",
  "outputFormat": "json",
  "plugins": [],
  "editor": {
    "formatOnSave": true,
    "lintOnSave": true
  }
}
```

### Project Configuration

Create `mam.config.json` in your project root:

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "runtime": "python",
  "modules": {
    "src": "./modules",
    "output": "./dist"
  },
  "validation": {
    "level": "strict",
    "rules": []
  },
  "plugins": []
}
```

---

## Verifying Installation

### Quick Health Check

```bash
mam doctor
```

Expected output:

```
✓ Node.js: v20.10.0
✓ pnpm: 8.14.0
✓ MAM CLI: 1.0.0
✓ Parser: OK
✓ Validator: OK
✓ Runtime: OK
✓ Plugins: 4 loaded
✓ All checks passed!
```

### Create Your First Module

```bash
mam init
```

This creates a `hello.mam.md` file in your current directory.

### Validate the Module

```bash
mam validate hello.mam.md
```

Expected output:

```
✓ Validation passed
  - Front matter: valid
  - Sections: 1 found
  - Code blocks: 0
  - Warnings: 0
```

---

## Troubleshooting

### Common Issues

#### Permission Denied

```bash
# Fix npm permissions (macOS/Linux)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
```

#### Command Not Found

```bash
# Add npm global path to your shell profile
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### Version Conflict

```bash
# Clear npm cache
npm cache clean --force

# Reinstall
npm install -g @mam/cli@latest
```

#### Parser Error

```bash
# Ensure your .mam.md file starts with ---
# Example:
# ---
# id: my-module
# version: 2.0.0
# ---
```

### Getting Help

```bash
mam --help          # General help
mam <command> --help # Command-specific help
mam doctor          # Diagnose issues
```

---

## Next Steps

- [Quickstart Guide](./quickstart.md) — Build your first MAM module
- [Concepts](./concepts.md) — Understand MAM core concepts
- [Specification](../specification/overview.md) — Read the formal spec

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
