export function logEntityLoaderError(
  loader: string,
  route: string,
  entityId: string,
  err: unknown,
  field?: string,
): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[entity-loader]", { loader, route, entityId, field: field ?? null, message });
}
