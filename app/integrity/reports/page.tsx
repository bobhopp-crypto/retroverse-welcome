import type { Metadata } from "next";

import { IntegrityReport } from "../integrity-report";
import { loadIntegrityAudits } from "../load-integrity-audits";

import "../integrity.css";

export const metadata: Metadata = {
  title: "Integrity reports (internal)",
  robots: { index: false, follow: false },
};

export default async function IntegrityReportsPage() {
  const data = await loadIntegrityAudits();
  return (
    <div className="int-root">
      <p style={{ marginBottom: "1rem" }}>
        <a href="/integrity" style={{ color: "#8b8fa3" }}>
          ← Integrity explorer
        </a>
      </p>
      <IntegrityReport data={data} />
    </div>
  );
}
