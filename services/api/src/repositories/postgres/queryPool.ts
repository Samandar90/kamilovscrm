// Repositories take the pool as a dependency so SQL tests can run real PostgreSQL (PGlite)
// without loading application credentials. `pg.Pool` satisfies these interfaces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueryClient { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }
export interface QueryPool extends QueryClient { connect(): Promise<QueryClient & { release(): void }> }
