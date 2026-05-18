import Link from "next/link";

type EntityStatusProps = {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
};

export function EntityStatus({ title, message, backHref = "/", backLabel = "Home" }: EntityStatusProps) {
  return (
    <main className="min-h-[calc(100vh-var(--rv-header-offset))] flex items-center justify-center px-4 py-16">
      <div className="max-w-md text-center space-y-3">
        <h1 className="font-serif text-2xl text-[var(--text-primary)]">{title}</h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
        <Link href={backHref} className="inline-block text-sm underline-offset-2 hover:underline text-[var(--text-secondary)]">
          ← {backLabel}
        </Link>
      </div>
    </main>
  );
}
