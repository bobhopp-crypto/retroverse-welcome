export default function Loading() {
  return (
    <div className="rv-memory-loading" role="status" aria-live="polite">
      <div className="rv-memory-loading__panel">
        <span className="rv-memory-loading__dial" aria-hidden />
        <p className="rv-memory-loading__kicker">Tuning the archive</p>
        <p className="rv-memory-loading__title">Finding the signal…</p>
      </div>
    </div>
  );
}
