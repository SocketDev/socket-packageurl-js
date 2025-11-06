# Getting Started

**Quick start guide** — Get started with Package URL development in 5 minutes.

---

## 📋 Prerequisites

```
Required:
 ✓ Node.js 20+ (LTS recommended)
 ✓ pnpm 9+
 ✓ Git
```

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone
git clone https://github.com/SocketDev/socket-packageurl-js.git
cd socket-packageurl-js

# Install & verify
pnpm install
pnpm test
```

**Expected:** ✓ 100% test coverage, ✓ 100% type coverage

---

### 2. Project Structure

```
socket-packageurl-js/
├── src/              # Source code
│   ├── index.ts      # Main PackageURL class
│   ├── parse.ts      # Parser implementation
│   ├── builder.ts    # Builder implementation
│   └── types.ts      # TypeScript definitions
│
├── test/             # Tests (mirrors src/)
├── scripts/          # Build scripts
└── docs/             # Documentation
    ├── api-reference.md
    ├── usage-examples.md
    └── getting-started.md
```

---

### 3. Essential Commands

```bash
# Development
pnpm run dev         # Watch mode
pnpm build           # Build for production

# Testing
pnpm test            # Run tests
pnpm run cover       # With coverage

# Quality
pnpm run check       # Type check + lint
pnpm run fix         # Auto-fix issues
```

---

## 🧪 What is a Package URL?

A Package URL (purl) standardizes software package identification:

```
pkg:npm/lodash@4.17.21
│   │   │      │
│   │   │      └─ Version
│   │   └──────── Name
│   └──────────── Namespace (optional)
└──────────────── Type (ecosystem)
```

**Supported ecosystems:**
- npm, pypi, cargo, gem, maven, nuget, go, docker, etc.

---

## 💡 Development Workflow

```
1. Branch     → git checkout -b feature/my-change
2. Implement  → Edit src/ files
3. Test       → pnpm test (100% coverage required)
4. Verify     → pnpm run fix && pnpm test
5. Commit     → Conventional commits
6. PR         → Submit pull request
```

---

## 📚 Key Concepts

### 1. Spec Compliance

This library implements the [Package URL specification](https://github.com/package-url/purl-spec).

All changes must maintain spec compliance.

### 2. Zero Dependencies

Runtime has zero dependencies. All code is self-contained.

### 3. Type Safety

Full TypeScript support with 100% type coverage:

```typescript
import { PackageURL } from '@socketregistry/packageurl-js'

const purl = new PackageURL(
  'npm',           // type
  null,            // namespace
  'lodash',        // name
  '4.17.21',       // version
  null,            // qualifiers
  null             // subpath
)
```

---

## 📖 Additional Resources

- [API Reference](./api-reference.md) - Complete API docs
- [Usage Examples](./usage-examples.md) - Common patterns
