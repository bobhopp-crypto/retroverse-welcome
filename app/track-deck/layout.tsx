import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Charts · Retroverse",
  description: "Hot 100 chart exploration — timeline traversal and track discovery.",
};

export default function TrackDeckLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>;
}
