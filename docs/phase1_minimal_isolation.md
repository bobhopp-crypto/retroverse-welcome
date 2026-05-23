# Phase 1 — Minimal App Isolation

**Date:** 2026-05-21  
**Scope:** File/folder clarity only (no runtime guards, no canonical app changes)

---

## Summary

Stale app folders are marked with `RETROVERSE_ARCHIVE.md`. Vercel CLI project links were removed from `clean` and `clean2`. Incomplete guard changes from the aborted isolation task were **reverted**.

---

## Reverted (aborted task cleanup)

The previous isolation attempt modified runtime/config before it was stopped. These were **restored**:

| Path | Reverted change |
|------|-----------------|
| `apps/retroverse-welcome-clean/next.config.ts` | Removed `console.error` + `process.exit(1)` guard |
| `apps/retroverse-welcome-clean2/next.config.ts` | Same |
| `apps/retroverse-welcome-clean/package.json` | Restored `dev` / `build` / `start` scripts |
| `apps/retroverse-welcome-clean2/package.json` | Same |
| `apps/retroverse-welcome-clean/scripts/archived-app-guard.mjs` | **Deleted** |
| `apps/retroverse-welcome-clean2/scripts/archived-app-guard.mjs` | **Deleted** |

---

## Changed (minimal isolation)

### 1. `RETROVERSE_ARCHIVE.md` created

| Folder | File |
|--------|------|
| `apps/retroverse-welcome-clean` | `RETROVERSE_ARCHIVE.md` |
| `apps/retroverse-welcome-clean2` | `RETROVERSE_ARCHIVE.md` |
| `apps/retroverse_welcome` | `RETROVERSE_ARCHIVE.md` |

Each file states: archived/stale, do not deploy, canonical app = `apps/retroverse-welcome`.

### 2. `.vercel/project.json` removed

| Folder | Action |
|--------|--------|
| `apps/retroverse-welcome-clean/.vercel/project.json` | **Removed** (`.vercel/README.txt` remains) |
| `apps/retroverse-welcome-clean2/.vercel/project.json` | **Removed** (`.vercel/README.txt` remains) |

Effect: `vercel deploy` from those directories is no longer pre-linked to project `retroverse-welcome` (`prj_oxhn595udDtufp6wudx4D2NaePyA`).

---

## Untouched

### Canonical app — **no modifications**

`apps/retroverse-welcome` was not changed except this report file:

- No edits to `package.json`, `next.config.ts`, routes, UI, nav, charts, or retroscope
- `apps/retroverse-welcome/.vercel/project.json` — **unchanged** (still linked)

### Archived app code

- No routes, layouts, or components modified
- No dependencies changed
- Folders not deleted or moved

### `retroverse_welcome` stub

- No `.vercel` folder (none existed)
- Only `RETROVERSE_ARCHIVE.md` added

---

## Verification checklist

| Check | Expected |
|-------|----------|
| Canonical `.vercel/project.json` exists | Yes |
| clean/clean2 `.vercel/project.json` absent | Yes |
| clean/clean2 `RETROVERSE_ARCHIVE.md` present | Yes |
| clean/clean2 `next.config.ts` has no exit guard | Yes |
| clean/clean2 `package.json` has `dev`/`build`/`start` | Yes |

---

## Remaining risk (documented, not fixed)

- `npm run dev` still works inside clean/clean2 if run manually (scripts restored on revert)
- Rely on `RETROVERSE_ARCHIVE.md` + removed Vercel link for deploy confusion prevention
- Stricter script disabling was **not** applied per minimal-isolation scope

---

*Minimal isolation complete. Canonical app untouched.*
