import type { Metadata } from "next";

import { IntegrityReport } from "./integrity-report";
import { loadIntegrityAudits } from "./load-integrity-audits";

import "./integrity.css";

export const metadata: Metadata = {
  title: "Integrity (internal)",
  robots: { index: false, follow: false },
};

export default async function IntegrityPage() {
  const data = await loadIntegrityAudits();
  return (
    <div className="int-root">
      <IntegrityReport data={data} />
    </div>
  );
}
