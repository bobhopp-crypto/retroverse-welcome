import Link from "next/link";

type EntityStatusProps = {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
};

export function EntityStatus({ title, message, backHref = "/", backLabel = "Home" }: EntityStatusProps) {
  return (
    <main className="rv-entity-status rv-public-surface">
      <div className="rv-entity-status-inner">
        <h1>{title}</h1>
        <p>{message}</p>
        <Link href={backHref}>← {backLabel}</Link>
      </div>
    </main>
  );
}
