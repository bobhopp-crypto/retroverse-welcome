import Link from "next/link";

export default function CuratorAlbumResolveError({
  albumId,
  issues,
  title,
  artist,
  year,
}: {
  albumId: string;
  issues: string[];
  title: string;
  artist: string;
  year: number | null;
}) {
  return (
    <div
      className="flex min-h-[calc(100dvh-var(--rv-header-offset))] flex-col items-center px-6 py-14"
      style={{ fontFamily: "var(--font-pv2-sans), system-ui, sans-serif", background: "#05070b", color: "#f3eadb" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[rgba(200,169,107,0.35)] bg-[#08111d] px-6 py-8 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.4)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#c8a96b]">Curator blocked</p>
        <h1 className="mt-3 font-[family-name:var(--font-pv2-display)] text-[1.35rem] leading-snug">
          Album metadata could not be resolved
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#b7aa95]">
          Discogs candidate search requires a real artist and album title from the Retroverse archive. This album resolved with
          insufficient metadata.
        </p>
        <dl className="mt-6 space-y-2 rounded-xl bg-[rgba(0,0,0,0.28)] px-4 py-3 text-[13px] text-[#d9cec0]">
          <div className="flex gap-2">
            <dt className="text-[#8a7f6f]">albumId</dt>
            <dd className="font-mono text-[12px] text-[#c8a96b]">{albumId}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[#8a7f6f]">title</dt>
            <dd>{title || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[#8a7f6f]">artist</dt>
            <dd>{artist || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[#8a7f6f]">year</dt>
            <dd>{year != null ? year : "—"}</dd>
          </div>
        </dl>
        <div className="mt-6 rounded-xl border border-amber-500/35 bg-[rgba(120,83,28,0.16)] px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-amber-200/90">Technical issues</p>
          <ul className="mt-2 list-disc pl-4 text-[13px] leading-relaxed text-amber-100/90">
            {issues.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/portal-v2"
            className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-full bg-[#c8a96b] px-6 py-3 text-[15px] font-semibold text-[#05070b] no-underline"
          >
            Back to portal
          </Link>
          <Link
            href={`/albums/${albumId}`}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-full border border-[rgba(200,169,107,0.45)] px-6 py-3 text-[15px] font-medium text-[#f3eadb] no-underline"
          >
            Album page
          </Link>
        </div>
      </div>
    </div>
  );
}
