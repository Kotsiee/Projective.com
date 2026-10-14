import type { SupabaseClient } from "supabaseClient";

/**
 * catalogue-stub-client — a Supabase client that answers each table and RPC with a fixed result,
 * for the catalogue tests that run without a database (the same construction as the schedule-page
 * tests' stub). Every RPC call is recorded, so a test can assert what was SENT as well as how the
 * answer was mapped.
 */

/** A PostgREST error as a door raises it. */
export interface StubError {
	code: string;
	message: string;
	details?: string;
}

/** What the stub answers: rows per table, a result or an error per RPC. */
export interface StubAnswers {
	tables?: Record<string, unknown[]>;
	rpc?: Record<string, unknown>;
	rpcErrors?: Record<string, StubError>;
}

/** One recorded RPC call. */
export interface StubCall {
	name: string;
	args: Record<string, unknown>;
}

/**
 * A stub client and the RPC calls made through it. A table answers every query chain with its rows:
 * an awaited chain gets the list, `maybeSingle()` gets the first row (or `null`).
 */
export function stubCatalogueClient(
	answers: StubAnswers,
): { client: SupabaseClient; calls: StubCall[] } {
	const calls: StubCall[] = [];
	const query = (table: string) => {
		const rows = answers.tables?.[table] ?? [];
		const chain: Record<string, unknown> = {};
		for (const method of ["select", "eq", "neq", "in", "is", "or", "order", "limit", "gt", "lt"]) {
			chain[method] = () => chain;
		}
		chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
		chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve({ data: rows, error: null }).then(resolve, reject);
		return chain;
	};
	const schema = {
		from: (table: string) => query(table),
		rpc: (name: string, args: Record<string, unknown> = {}) => {
			calls.push({ name, args });
			const error = answers.rpcErrors?.[name];
			return Promise.resolve(
				error ? { data: null, error } : { data: answers.rpc?.[name] ?? null, error: null },
			);
		},
	};
	return { client: { schema: () => schema } as unknown as SupabaseClient, calls };
}
