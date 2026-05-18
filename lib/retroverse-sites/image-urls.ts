/** Client-safe image URL builders (no Node.js builtins). */

export function imageApiHref(id: string, opts?: { w?: number; h?: number }): string {
  const params = new URLSearchParams({ id });
  if (opts?.w) params.set("w", String(opts.w));
  if (opts?.h) params.set("h", String(opts.h));
  return `/api/retroverse-sites/image?${params.toString()}`;
}

export function imageThumbHref(id: string): string {
  return imageApiHref(id, { w: 320, h: 200 });
}

export function fileLaunchHref(absPath: string): string {
  return `file://${absPath}`;
}
