import { Pool } from "pg";

let pool: Pool | null = null;

export function getIntegrityPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.RETROVERSE_PG_HOST ?? "localhost",
      database: process.env.RETROVERSE_PG_DATABASE ?? "retroverse",
      user: process.env.RETROVERSE_PG_USER ?? "bobhopp",
      password: process.env.RETROVERSE_PG_PASSWORD ?? "",
      max: 5,
    });
  }
  return pool;
}

export async function integrityQuery<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getIntegrityPool().query(text, params);
  return result.rows as T[];
}
