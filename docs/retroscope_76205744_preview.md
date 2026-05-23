# Retroscope exact preview — commit `76205744`

Side-by-side comparison without touching your `main` working tree.

## What was created

| Item | Location |
|------|----------|
| Git branch | `preview/retroscope-76205744-exact` → commit `76205744` |
| Worktree folder | `apps/retroverse-welcome/worktree-76205744/` |
| Dev server | **http://localhost:3001** (port 3001) |

## Compare

| Version | URL | Folder |
|---------|-----|--------|
| **Exact May 20 commit** | http://localhost:3001/album-retroscope | `worktree-76205744/` |
| **Current work (main)** | http://localhost:3000/album-retroscope | `retroverse-welcome/` (unchanged) |

Also try:

- http://localhost:3001/artist-retroscope
- http://localhost:3001/track-retroscope

## What `76205744` includes

- `arv-hero-stage` — 3+3 utility rails flanking cover
- `retroscope-utility-rail.tsx` — Exit, Curator, Map | Albums, Artists, Charts
- `arv-body-lock arv-structure-strip` on Retroscope layouts
- Mobile orient band + year lane (with structure-strip)

## Restart preview server

```bash
cd /Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/worktree-76205744
npm run dev -- -p 3001
```

## Remove when done

```bash
cd /Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome
git worktree remove worktree-76205744
git branch -d preview/retroscope-76205744-exact
```
