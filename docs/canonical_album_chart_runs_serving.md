# Canonical album chart spine (`canonical_album_chart_runs`)

## Migration

Apply:

`supabase/migrations/20260513120000_canonical_album_chart_runs.sql`

This:

- Creates **`canonical_album_chart_runs`** (PK: `retroverse_album_id`, `chart_date`) and **`canonical_album_chart_conflicts`**.
- **Truncates** only those two serving tables (not the warehouse), then fills conflicts then canonical rows from **`retroverse_chart_appearances`** with `chart_name = 'Billboard 200'`, positions **1–200**, non-null album id and date, **`MIN(chart_position)`** per album/week.
- Adds **`canonical_album_chart_validation_report(p_album_id text default 'RVAL000003')`** returning JSON ( **`EXECUTE` granted to `service_role` only** ).

## Validation

SQL file: `supabase/validation/canonical_album_chart_runs_validation.sql`

Or:

```bash
pnpm validate:canonical-album-chart
# optional album id:
pnpm exec tsx scripts/validate_canonical_album_chart_runs.ts RVAL000003
```

Requires **`SUPABASE_SERVICE_ROLE_KEY`** and **`SUPABASE_URL`** or **`NEXT_PUBLIC_SUPABASE_URL`**.

## Wiring Retroscope (done)

- **`occupancy-queries.ts`** — `fetchBillboard200AppearancesForAlbum` reads **`canonical_album_chart_runs`** (paginated).
- **`load-occupancy.ts`** — heavy-hitter discovery uses **`canonical_album_chart_week_counts`** + density scans on **`canonical_album_chart_runs`**; main deck uses canonical trails only; **synthetic fallback only** when env missing, no heavy IDs, **zero** canonical rows for the candidate set, or exception. **`unstable_cache`** keys bumped to **`v6-canonical-spine`**.
- **`occupancy-field-render.ts`** — polyline gaps use **`min(requestedGap, ~20d)`** so off-chart periods do not bridge across re-entries.
- **`retroverse-v3-machine.tsx`** — dev-only **`console.log("[retroscope:canonical]", …)`** for the tuned album (remove when debugging is finished).

## Rebuild after warehouse changes

Re-run the **INSERT / TRUNCATE** portion (extract to a maintenance SQL or a new migration) so conflicts and canonical stay aligned with raw data.
