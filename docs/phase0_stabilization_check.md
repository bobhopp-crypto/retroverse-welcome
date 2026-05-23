# Phase 0 Stabilization Verification

**Date:** 2026-05-21  
**Type:** Read-only verification (no code changes, no deletes, no deploy, no Vercel dashboard changes)  
**Reference:** `docs/retroverse_structural_audit.md`

---

## Summary

| Check | Result |
|-------|--------|
| Canonical git repo | **PASS** — `retroverse-welcome` on `main` |
| Active dev server | **PASS** — port 3000, cwd = canonical app |
| `/track-deck` local | **PASS** — HTTP 200 |
| `/album-retroscope` local | **PASS** — HTTP 200 |
| `/tracks` local | **PASS** — route exists; server redirect to `/track-deck` |
| `vercel.json` outside canonical | **PASS** — none found under `RETROVERSE_v2` |
| `.vercel` in clean/clean2 | **WARN** — both exist, same project ID as canonical |

**Phase 0 local verification: PASS with one documented risk (duplicate `.vercel` links in stale folders).**

---

## 1. Git remote URL

```
origin  https://github.com/bobhopp-crypto/retroverse-welcome.git (fetch)
origin  https://github.com/bobhopp-crypto/retroverse-welcome.git (push)
```

**Git root:** `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome`

---

## 2. Current branch

```
main
```

---

## 3. Current working directory

Verification run cwd:

```
/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome
```

`git rev-parse --show-toplevel` matches this path.

---

## 4. Is `apps/retroverse-welcome` the active app?

**Yes.**

| Evidence | Value |
|----------|-------|
| Port 3000 listener | `node` PID 39909 — `next-server (v16.2.4)` |
| Process cwd | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` |
| Cursor / audit cwd | Same path |
| Git remote | `bobhopp-crypto/retroverse-welcome` |

No listener detected for a separate dev server from `retroverse-welcome-clean` or `retroverse-welcome-clean2`.

---

## 5. Does `npm run dev` from canonical app serve port 3000?

**Yes (observed running instance; not restarted during this check).**

| Item | Value |
|------|-------|
| Script | `"dev": "next dev"` in `package.json` |
| Default port | 3000 (no `-p` in script) |
| Listener | `*:3000` (service name `hbci`) |
| Next version | 16.2.4 |

**Note:** Dev server was already running from canonical cwd before this verification. Phase 0 does not require a fresh `npm run dev` start.

---

## 6. `/track-deck` — local HTTP status

```
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/track-deck
→ 200
```

**PASS**

---

## 7. `/album-retroscope` — local HTTP status

```
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/album-retroscope
→ 200
```

**PASS**

---

## 8. `/tracks` — exists locally and routing behavior

**Route files exist:**

| File | Route |
|------|-------|
| `app/tracks/page.tsx` | `/tracks` (index) |
| `app/tracks/[id]/page.tsx` | `/tracks/[id]` (detail — not redirected) |

**Index behavior (source):** `app/tracks/page.tsx` calls `redirect()` to `/track-deck` (preserves `q` / `artist` query params when present).

**HTTP observation:**

| Request | Status | Notes |
|---------|--------|-------|
| `GET /tracks` | **200** | No `Location` header on `curl -I`; RSC payload includes `NEXT_REDIRECT` and `track-deck` (Next.js App Router soft redirect in dev) |
| `GET /tracks/[id]` | Not tested in this pass | Separate page; expected to render track detail |

**Conclusion:** `/tracks` **exists** in the canonical app. Index **intends** `/track-deck` as destination. `/tracks/[id]` remains a distinct route.

---

## 9. `vercel.json` outside canonical app

**Search:** `find /Users/bobhopp/RETROVERSE_v2 -name vercel.json`

**Result:** No `vercel.json` files found anywhere under `RETROVERSE_v2` (including canonical app, clean, clean2, deploy/).

**PASS** — no stray `vercel.json` overrides detected.

---

## 10. `.vercel/project.json` in clean / clean2

| Path | Exists | projectName | projectId |
|------|--------|-------------|-----------|
| `apps/retroverse-welcome/.vercel/project.json` | **Yes** | `retroverse-welcome` | `prj_oxhn595udDtufp6wudx4D2NaePyA` |
| `apps/retroverse-welcome-clean/.vercel/project.json` | **Yes** | `retroverse-welcome` | `prj_oxhn595udDtufp6wudx4D2NaePyA` |
| `apps/retroverse-welcome-clean2/.vercel/project.json` | **Yes** | `retroverse-welcome` | `prj_oxhn595udDtufp6wudx4D2NaePyA` |
| `apps/retroverse_welcome/.vercel/project.json` | **No** | — | — |

**WARN:** Stale folders `clean` and `clean2` are still CLI-linked to the **same** Vercel project as canonical. Accidental `vercel deploy` from those directories remains a Phase 0 risk (documented in structural audit). No action taken per verification-only scope.

---

## Phase 0 checklist (local)

| Item | Status |
|------|--------|
| Dev + Git push target = `apps/retroverse-welcome` | ✅ |
| Branch = `main` | ✅ |
| Localhost serves canonical routes | ✅ |
| `/track-deck` and `/album-retroscope` return 200 | ✅ |
| No `vercel.json` drift | ✅ |
| Duplicate `.vercel` in clean/clean2 | ⚠️ Documented |

## Not verified (out of scope)

- Vercel dashboard Git integration / production branch
- Production URL HTTP checks
- Removing `.vercel` from stale folders (Phase 0 action — deferred)

---

*Verification only. No fixes applied.*
