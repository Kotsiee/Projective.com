import type { SupabaseClient } from "supabaseClient";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isCommunityBackendLive } from "../../core/supabase.ts";
import {
	defineRowMapper,
	recordsFromRows,
	type RowMapper,
	RowMapperError,
	type RowMapperSpec,
	rowsFromRecords,
} from "../../core/row-mapper.ts";

/**
 * community-source.ts — the one shared module every community surface service reuses
 * (Decision #274): the gate, the live-or-fixture read, the typed table declaration and the
 * `community` schema handle for definer-door calls.
 *
 * ## The model
 *
 * Community rows are user-generated — helpfulness votes, feedback ideas, votes and status history —
 * so unlike editorial content they have no authored source: a live read selects what people wrote,
 * and the fixture road (`COMMUNITY_BACKEND_LIVE` off) serves demo records a service declares beside
 * itself (`services/community/<surface>-fixtures.ts`). Both roads end in the same row parse and
 * `fromRow`, exactly as editorial's do: fixture records are authored as domain records, pushed
 * through `toRow` and the row's Zod schema, and only then mapped back — so a fixture can never be a
 * shape the table would refuse.
 *
 * Reads take the caller's client (its JWT decides what RLS lets it see — a guest the public board,
 * a member their own votes too); writes go through the SECURITY DEFINER doors in `00001320` with
 * {@link communityRpc}, never a direct table write. The newsletter is the one exception to the gate:
 * it lives in this schema but keeps its own `NEWSLETTER_BACKEND_LIVE` (and the service role, because
 * no client may touch the subscriber list).
 */

// #region Gate
/** Where a community read was answered from. */
export type CommunitySource = "live" | "fixture";

export { isCommunityBackendLive };

/** The road a community read takes in this environment. */
export function communitySource(): CommunitySource {
	return isCommunityBackendLive() ? "live" : "fixture";
}
// #endregion

// #region Tables
/** A table in the `community` schema, declared once for the reader and the fixtures. */
export type CommunityTable<Row extends Record<string, unknown>, Domain> = RowMapper<Row, Domain>;

/** Declare a community table. Refuses a table outside the `community` schema. */
export function defineCommunityTable<Row extends Record<string, unknown>, Domain>(
	spec: RowMapperSpec<Row, Domain> & { table: `community.${string}` },
): CommunityTable<Row, Domain> {
	if (!spec.table.startsWith("community.")) {
		throw new TypeError(`A community table lives in the community schema, got "${spec.table}".`);
	}
	return defineRowMapper(spec);
}

/** The `community` schema on a client — the handle every definer-door call and live read starts from. */
export function communityDb(client: SupabaseClient): ReturnType<SupabaseClient["schema"]> {
	return client.schema("community");
}

/**
 * Call a `community` definer door. A thin, named seam over `client.schema("community").rpc(…)` so
 * every surface calls its doors the same way and a test can stub one place.
 */
export function communityRpc(
	client: SupabaseClient,
	fn: string,
	args: Record<string, unknown>,
): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
	return communityDb(client).rpc(fn, args);
}
// #endregion

// #region Reading
/** What {@link readCommunityTable} answers: the mapped records and the road they came by. */
export interface CommunityRead<Domain> {
	records: Domain[];
	source: CommunitySource;
}

/** How one community read runs on each road. */
export interface CommunityReadPlan<Domain> {
	/** The client the live read runs as — the caller's JWT client, or the anon client for a guest. */
	client: () => SupabaseClient;
	/**
	 * The live query, given the `community` schema handle; defaults to the whole table. It must
	 * express the same selection as {@link CommunityReadPlan.filter}.
	 */
	live?: (
		db: ReturnType<SupabaseClient["schema"]>,
	) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>;
	/** The fixture road's records, authored as domain records. */
	fixtures: readonly Domain[];
	/** The fixture road's equivalent of the live query's WHERE clause. */
	filter?: (record: Domain) => boolean;
	/** Force a road instead of reading the gate (tests). */
	source?: CommunitySource;
}

/**
 * Read one community table by the road this environment takes. Failures are answers, not throws: an
 * unreachable or unexposed schema is a 503 (`PGRST106` until `community` is exposed and the stack
 * restarted), and a row that fails its schema is a 500 naming the table and row.
 */
export async function readCommunityTable<Row extends Record<string, unknown>, Domain>(
	table: CommunityTable<Row, Domain>,
	plan: CommunityReadPlan<Domain>,
): Promise<ServiceResult<CommunityRead<Domain>>> {
	const source = plan.source ?? communitySource();
	try {
		if (source === "fixture") {
			const records = recordsFromRows(table, rowsFromRecords(table, plan.fixtures));
			return ok({ records: plan.filter ? records.filter(plan.filter) : records, source });
		}
		const db = communityDb(plan.client());
		const { data, error } = plan.live ? await plan.live(db) : await db.from(table.name).select("*");
		if (error) {
			return fail(503, {
				message: "This is unavailable right now. Please try again shortly.",
				details: { table: table.table, code: error.code ?? null },
			});
		}
		return ok({ records: recordsFromRows(table, data ?? []), source });
	} catch (err) {
		if (err instanceof RowMapperError) {
			return fail(500, {
				message: "This could not be read.",
				details: { table: err.table, row: err.index, issues: err.issues },
			});
		}
		throw err;
	}
}
// #endregion
