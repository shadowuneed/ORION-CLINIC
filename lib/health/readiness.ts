export const READINESS_SCHEMA_MARKER =
  'department_access_assignment_heads_advance_guard';

export interface ReadinessPreparedStatement {
  bind(value: string): ReadinessPreparedStatement;
  first(): Promise<{ ok: number } | null>;
}

export interface ReadinessDatabase {
  prepare(query: string): ReadinessPreparedStatement;
}

export interface ReadinessBucket {
  list(options: { limit: number }): Promise<unknown>;
}

export async function assertStorageReady(
  database: ReadinessDatabase,
  files: ReadinessBucket,
) {
  const marker = await database
    .prepare(`
      select 1 as ok
      from sqlite_master
      where type = 'trigger' and name = ?1
      limit 1
    `)
    .bind(READINESS_SCHEMA_MARKER)
    .first();

  if (marker?.ok !== 1) {
    throw new Error('Required database schema is unavailable');
  }

  await files.list({ limit: 1 });
}
