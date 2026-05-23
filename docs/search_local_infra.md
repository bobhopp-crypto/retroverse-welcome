# Local home-search infrastructure

## Runtime

Use the **main** app (not `worktree-76205744`):

```bash
cd apps/retroverse-welcome
npm run dev
```

Load env from `.env.local` (includes `RETROVERSE_PG_*` for local graph + Supabase keys).

## Track corpus (local Postgres)

Home-search track hits prefer `canonical_track_display` on database `retroverse` (see `RETROVERSE_PG_*` in `.env.local`).

Verify:

```bash
psql -h localhost -U bobhopp -d retroverse -c "SELECT count(*) FROM canonical_track_display;"
```

## Supabase (artists / albums / RVTR fallback)

Project: `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`.

If REST returns **PGRST002** (`Could not query the database for the schema cache`):

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → project → **Settings** → confirm project is not paused.
2. **Database** → check instance healthy; restart if needed.
3. **API** → reload PostgREST schema / restart API.
4. Re-test: `curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/retroverse_tracks?select=retroverse_track_id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`

Artists/albums panels need Supabase; **tracks can still serve from local graph** while PostgREST is down.

## Smoke test

```bash
curl -s "http://localhost:3000/api/home-search?q=Madonna" | jq '{artists,albums: .albums[0:3],tracks: .tracks[0:4]}'
```

Expect `RVTR` hrefs on tracks, no `/tracks/hot100-*`.
