import type { Metadata } from "next";

import "./explorer.css";

export const metadata: Metadata = {
  title: "Integrity Console (internal)",
  robots: { index: false, follow: false },
};

export default function IntegrityLayout({ children }: { children: React.ReactNode }) {
  return <div className="ic-shell">{children}</div>;
}
