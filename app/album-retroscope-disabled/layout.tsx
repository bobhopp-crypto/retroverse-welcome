import { BodyClassName } from "@/app/components/body-class-name";

import "./album-retroscope.css";

export default function AlbumRetroscopeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BodyClassName className="arv-body-lock" />
      <div className="arv-route-shell">{children}</div>
    </>
  );
}
