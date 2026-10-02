# VanishTrans Documentation Structure

## 📁 Root Directory Files

### Core Documentation
- **[README.md](./README.md)** - Project overview, setup instructions, and quick start
- **[AGENTS.md](./AGENTS.md)** - AI agent specification and project context ⚠️ **Required in root**

### Why AGENTS.md is in Root
The `AGENTS.md` file must be in the project root directory because:
1. AI coding assistants automatically discover it here
2. It provides immediate context for any agent working on the project
3. Standard convention for AI-assisted projects
4. Contains critical constraints and command catalog

---

## 📚 Organized Documentation (`docs/`)

### Current Documentation

#### Architecture (`docs/architecture/`)
- **AGENTS.md** - Backup copy for reference
- **ARCHITECTURE.md** - System architecture diagrams and data flow
- **REFACTORING_SUMMARY.md** - Refactoring overview
- **REFACTORING_FINAL.md** - Deep refactoring metrics

#### Testing (`docs/testing/`)
- **TESTING_SUMMARY.md** - Test suite summary (156 frontend + 15+ backend tests)
- **REFACTORING_CHECKLIST.md** - Verification checklist

#### Development (`docs/development/`)
- **FOUR_POINTS_VERIFICATION.md** - Four-point completion report
- **COMPLETE_SUMMARY.md** - Complete project summary

### Archived Documentation

#### Archive (`docs/archive/`)
- **legacy-plans/** - Historical development plans (19 documents)
- **superpowers/** - Feature design documents
- **visuals/** - UI mockups and screenshots

---

## 🗂️ Directory Tree

```
VanishTrans/
├── README.md                    # Project overview
├── AGENTS.md                    # ⚠️ AI agent spec (MUST be in root)
├── DOCUMENTATION_STRUCTURE.md   # This file
│
└── docs/
    ├── README.md                # Documentation index
    │
    ├── architecture/            # System design
    │   ├── AGENTS.md           # Backup copy
    │   ├── ARCHITECTURE.md
    │   ├── REFACTORING_SUMMARY.md
    │   └── REFACTORING_FINAL.md
    │
    ├── testing/                 # Test documentation
    │   ├── TESTING_SUMMARY.md
    │   └── REFACTORING_CHECKLIST.md
    │
    ├── development/             # Development reports
    │   ├── FOUR_POINTS_VERIFICATION.md
    │   └── COMPLETE_SUMMARY.md
    │
    └── archive/                 # Historical docs
        ├── legacy-plans/       # 19 planning documents
        ├── superpowers/        # Feature designs
        └── visuals/            # Screenshots
```

---

## 📊 Documentation Statistics

| Location | Category | Files | Size | Purpose |
|----------|----------|-------|------|---------|
| **Root** | Core | 2 | ~9 KB | Quick access |
| `docs/architecture/` | Current | 4 | ~29 KB | System design |
| `docs/testing/` | Current | 2 | ~16 KB | Quality assurance |
| `docs/development/` | Current | 2 | ~31 KB | Project reports |
| `docs/archive/` | Historical | 21+ | ~100 KB | Reference |
| **Total** | - | **31+** | **~185 KB** | Complete |

---

## 🔄 Maintenance Guidelines

### Root Directory
- ✅ Keep `README.md` and `AGENTS.md` in root
- ✅ Update `AGENTS.md` when adding new Tauri commands or constraints
- ❌ Do NOT move AGENTS.md into `docs/`

### Current Documentation
- ✅ Keep synchronized with codebase
- ✅ Update when architecture changes
- ✅ Maintain test summaries

### Archived Documentation
- ✅ Preserve for historical reference
- ❌ Do NOT modify archived content
- ✅ Add new archives when needed

---

## 📖 Quick Access

### For AI Agents
1. Read [AGENTS.md](./AGENTS.md) first (root directory)
2. Check [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) for design
3. Review [docs/testing/TESTING_SUMMARY.md](./docs/testing/TESTING_SUMMARY.md) for tests

### For Developers
1. Start with [README.md](./README.md)
2. Browse [docs/README.md](./docs/README.md) for documentation index
3. Check specific category in `docs/`

---

**Last Updated**: 2026-08-27  
**Structure Version**: 1.0.0  
**Status**: ✅ Organized and Production-ready
