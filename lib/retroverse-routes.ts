export function normalizeEntitySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function albumRoute(title: string): string {
  return `/albums/${normalizeEntitySlug(title)}`;
}

export function artistRoute(name: string): string {
  return `/artists/${normalizeEntitySlug(name)}`;
}
