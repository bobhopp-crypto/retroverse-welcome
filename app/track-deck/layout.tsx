import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track deck · Retroverse",
  description: "Operational Hot 100 chart browser with VDJ ownership state.",
  robots: { index: false, follow: false },
};

export default function TrackDeckLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>;
}
