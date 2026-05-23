# Cursor + Retroverse workspace setup audit

**Date:** 2026-05-22  
**Mode:** Read-only inspection (no installs, commits, deploys, or config changes)  
**Auditor context:** Cursor agent session rooted at `retroverse-welcome`

---

## 1. Current workspace folder opened in Cursor

| Item | Value |
|------|--------|
| **Cursor workspace root** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` |
| **Cursor project metadata** | `~/.cursor/projects/Users-bobhopp-RETROVERSE-v2-apps-retroverse-welcome/` (transcripts, built-in MCP tool defs) |
| **Related app (not workspace root)** | `/Users/bobhopp/RETROVERSE_PUBLIC` |

**Implication:** Agents and file search default to **welcome** (backend + full Retroverse app). **PUBLIC** search UI changes require either opening a second workspace, a multi-root workspace, or explicit paths in prompts.

---

## 2. Git repo status (opened folder)

**Repo root:** `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` (not monorepo root `RETROVERSE_v2`)

```
## main...origin/main [ahead 37]
```

- **Many modified** app/lib/scripts files (retroscope, track-deck, home-search, etc.)
- **Many untracked** docs, scripts, `lib/home-search/*`, `worktree-76205744/`, SQL, exports, etc.
- **Dirty working tree** — not merge/deploy ready without review

**RETROVERSE_PUBLIC** is a **separate git repo** at `/Users/bobhopp/RETROVERSE_PUBLIC` (also dirty, different change set).

---

## 3. Current branch and remote

### retroverse-welcome (workspace)

| | |
|--|--|
| **Branch** | `main` |
| **Tracking** | `origin/main` (**ahead 37** commits, not pushed) |
| **Remote** | `https://github.com/bobhopp-crypto/retroverse-welcome.git` |
| **Other local branches** | `feature/50-years-ago`, `preview/retroscope-76205744-exact` |
| **Git worktree** | `worktree-76205744` → branch `preview/retroscope-76205744-exact` @ `76205744` (~843MB) |

### RETROVERSE_PUBLIC

| | |
|--|--|
| **Branch** | `main` |
| **Tracking** | `origin/main` (in sync at `510c8c1`) |
| **Remote** | `https://github.com/bobhopp-crypto/retroverse-public.git` |

---

## 4. Whether `.cursor/` exists

| Location | `.cursor/` project folder |
|----------|---------------------------|
| `retroverse-welcome` | **No** |
| `RETROVERSE_PUBLIC` | **No** |
| User home `~/.cursor/` | **Yes** (global Cursor config, skills, MCP, projects) |

No repo-local `.cursor/rules`, `.cursor/mcp.json`, or `AGENTS.md` under `.cursor/`.

---

## 5. Existing Cursor rules

### In-repo (welcome)

| File | Role |
|------|------|
| `AGENTS.md` | Next.js 16 agent rules — read `node_modules/next/dist/docs/` before API changes |
| `CLAUDE.md` | Pointer: `@AGENTS.md` |

### In-repo (PUBLIC)

No `AGENTS.md` / `CLAUDE.md` detected in audit.

### User-level (from active Cursor session, not in repo)

- **Bob — No Fluff, Data First** (short steps, checkpoints, VDJ/JSON source-of-truth)
- **Commit / PR workflows** (only commit when asked; use `gh` for PRs)
- **Code citation format**, minimal diffs, etc.

These live in **Cursor Settings → Rules**, not in the project tree.

---

## 6. MCP / tools / config

### User MCP (`~/.cursor/mcp.json`)

```json
{ "mcpServers": {} }
```

**No custom MCP servers** configured globally.

### Cursor built-in MCP (project cache)

Under `~/.cursor/projects/.../mcps/`:

- `cursor-ide-browser` (navigate, snapshot, screenshot, click, etc.)
- `cursor-backend-control` (automations)
- `cursor-app-control` (project / agent root moves)

Available to the agent when enabled in Cursor UI; not defined in repo.

### User skills (`~/.cursor/skills-cursor/`)

Includes: `babysit`, `canvas`, `create-hook`, `create-rule`, `create-skill`, `sdk`, `shell`, `split-to-prs`, `statusline`, `update-cursor-settings`, etc.

---

## 7. Package manager and scripts

| Project | PM | Node (detected) | Lockfile |
|---------|-----|-----------------|----------|
| welcome | npm | v25.2.1 | `package-lock.json` |
| PUBLIC | npm | (same machine) | `package-lock.json` |

### welcome — primary scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next dev server |
| `npm run build` / `start` | Production |
| `npm run lint` | ESLint |
| `graph:*`, `dossiers:*`, `vdj:*`, `artwork:*` | Data/graph/ingest pipelines (large surface) |

### PUBLIC — scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next dev |
| `npm run build` / `start` | Production |

**Stack mismatch:** welcome **Next 16.2.4**; PUBLIC **Next ^15.3.3**. Different major versions — intentional split, but agents must not assume one Next API for both.

---

## 8. Codex (OpenAI) — installed / configured

| Check | Result |
|-------|--------|
| `codex` on PATH | **Not found** |
| `~/.codex/` | **Present** (`config.toml`, `auth.json`, cache, etc.) |
| `config.toml` | `model = "gpt-5.3-codex"`, GitHub plugin enabled |
| Trusted project in Codex | `/Users/bobhopp/Sites/retroverse` (**not** `RETROVERSE_v2/apps/retroverse-welcome`) |
| `openai` CLI | Present at Python 3.12 framework bin (may be separate from Cursor) |

**Conclusion:** Codex desktop/config exists, but **CLI `codex` is not on PATH** in this shell, and Codex trust path points at an **older/different** `Sites/retroverse` tree — not the current v2 welcome workspace.

---

## 9. Vercel config

| Project | `vercel.json` in repo | `.vercel/project.json` |
|---------|----------------------|-------------------------|
| welcome | **No** | **Yes** → `retroverse-welcome` (`prj_oxhn595udDtufp6wudx4D2NaePyA`) |
| PUBLIC | **No** | **Yes** → `retroverse-public` (`prj_s34zNbJJB9LXmIDGCe5YBWkdWbae`) |
| `retroverse-welcome-clean` | — | **No** `project.json` (link removed per `docs/phase1_minimal_isolation.md`) |
| `retroverse-welcome-clean2` | — | **No** `project.json` |

Deploy is **Vercel-linked per directory**; wrong cwd = wrong project.

---

## 10. `.env*` files (names only — no values)

### retroverse-welcome

| File | Present |
|------|---------|
| `.env.local` | Yes |
| `.env.example` | **No** (undocumented keys in repo) |

**Variable names in `.env.local`:**

- `DISCOGS_TOKEN`
- `NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`
- `RETROVERSE_PG_HOST`, `RETROVERSE_PG_USER`, `RETROVERSE_PG_DATABASE`

### RETROVERSE_PUBLIC

| File | Present |
|------|---------|
| `.env.local` | Yes |
| `.env.example` | Yes (untracked in git status) |

**Variable names:**

- `.env.local`: `SEARCH_UPSTREAM_BASE_URL`
- `.env.example`: documents `SEARCH_UPSTREAM_BASE_URL=http://localhost:3000`

---

## 11. Local dev ports (expected)

| Service | Default | Documented / configured |
|---------|---------|-------------------------|
| welcome `npm run dev` | **3000** (Next default) | `docs/search_local_infra.md` curls `:3000/api/home-search` |
| PUBLIC `npm run dev` | **3000** if started alone; **3001** if welcome already on 3000 | Next auto-increments port |
| PUBLIC → welcome proxy | `SEARCH_UPSTREAM_BASE_URL` | `.env.example` → `3000`; **actual `.env.local` → `3001`** |

**Search data path**

```
Browser → RETROVERSE_PUBLIC (/api/search)
       → GET SEARCH_UPSTREAM_BASE_URL/api/home-search
       → retroverse-welcome
```

**Known failure mode:** PUBLIC on 3000 proxying to 3001 while welcome runs on **3000** (or the reverse) → empty/wrong/stale search. Always confirm both ports after `npm run dev`.

**API routes**

- welcome: `/api/home-search`
- PUBLIC: `/api/search` (proxies upstream)

---

## 12. Duplicate or confusing folders nearby

| Path | Risk |
|------|------|
| `RETROVERSE_v2/apps/retroverse-welcome` | **Canonical** app (use this) |
| `RETROVERSE_v2/apps/retroverse-welcome/worktree-76205744` | **Old preview** (~843MB); docs warn not to use for search |
| `RETROVERSE_v2/apps/retroverse-welcome-clean` | Legacy; Vercel link removed |
| `RETROVERSE_v2/apps/retroverse-welcome-clean2` | Legacy; Vercel link removed |
| `RETROVERSE_v2/apps/retroverse_welcome` | **Underscore** duplicate name — easy typo |
| `RETROVERSE_PUBLIC` | Separate repo; search UI only |
| `RETROVERSE_DATA` | Runtime scripts/data (referenced by npm scripts) |
| `~/Sites/retroverse` | Codex trusted path; may not match v2 layout |

**Git worktree:** `preview/retroscope-76205744-exact` — fine for Retroscope archaeology, confusing if you `cd worktree-*` and run `npm run dev` expecting current search.

---

## 13. Recommended Cursor setup for Retroverse

### A. Workspace layout

1. **Multi-root workspace** (recommended for search work):
   - Folder 1: `RETROVERSE_v2/apps/retroverse-welcome`
   - Folder 2: `RETROVERSE_PUBLIC`
2. Or keep welcome root but **prefix prompts**: “UI = PUBLIC path, API = welcome path”.

### B. Project rules (add via Cursor, not done in this audit)

Create `.cursor/rules/` in **each** repo (or one multi-root `.code-workspace`):

| Rule file idea | Content |
|----------------|---------|
| `retroverse-architecture.mdc` | PUBLIC proxies welcome; never rebuild search pipeline in PUBLIC |
| `ports.mdc` | After dev start, print both ports; `SEARCH_UPSTREAM` must match welcome |
| `source-of-truth.mdc` | VDJ + graph + dossiers; Supabase optional locally |
| `stepwise-frontend.mdc` | One panel/task per agent turn; no drive-by refactors |
| `worktree-warning.mdc` | Do not run dev from `worktree-76205744` for current search |

### C. Reliability checklist (each session)

1. `cd retroverse-welcome && npm run dev` → note port (expect 3000).
2. `cd RETROVERSE_PUBLIC && npm run dev` → note port.
3. Set `SEARCH_UPSTREAM_BASE_URL` to welcome’s **actual** port.
4. Smoke: `curl localhost:<welcome>/api/home-search?q=Fleetwood%20Mac`
5. Smoke: `curl localhost:<public>/api/search?q=Fleetwood%20Mac`

### D. Git hygiene

- welcome **37 commits ahead** of origin — push or branch before relying on CI/another machine.
- Keep PUBLIC and welcome changes in **separate commits/PRs** when possible (`retroverse-public` vs `retroverse-welcome` remotes).

### E. Codex vs Cursor

- Use **Cursor** for welcome + PUBLIC paired work (current setup).
- If using **Codex app**, update `~/.codex/config.toml` trusted path to v2 welcome or add `RETROVERSE_v2` — today it still references `Sites/retroverse`.

### F. Agent behavior (matches your “one step at a time” goal)

- Scope tasks: `PUBLIC/app/search/**` OR `welcome/lib/home-search/**`, not both unless explicit.
- Require **checkpoint** after each change: curl timing + 3 sample titles.
- Forbid: commit/deploy/install unless asked (aligns with your user rules).

### G. Optional additions (later)

- `welcome/.env.example` mirroring `.env.local` **keys only**
- `RETROVERSE.code-workspace` committed under `RETROVERSE_v2`
- `.cursorignore` for `worktree-76205744/`, `exports/`, large `public/data/**`

---

## Quick reference

```
┌─────────────────────┐     SEARCH_UPSTREAM      ┌──────────────────────────┐
│ RETROVERSE_PUBLIC   │ ───────────────────────► │ retroverse-welcome       │
│ :3000 or :3001      │   /api/home-search       │ :3000 (typical)          │
│ /api/search         │                          │ graph + dossier + SB     │
└─────────────────────┘                          └──────────────────────────┘
         │                                                    │
         └──────────────── separate git repos ────────────────┘
```

---

*End of audit. No configuration changes were made during this inspection.*
