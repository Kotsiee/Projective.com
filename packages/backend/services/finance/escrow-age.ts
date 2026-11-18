import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import {
	type EscrowAge,
	EscrowAgeKind,
	type EscrowAgeOver,
	type EscrowAgeRow,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";

/**
 * escrow-age: the `/admin/ledger` Escrow age section's read (MR7, Decision #473). It answers how long
 * held money has sat in the platform's Stripe balance, per kind and currency, through the operator
 * door `finance.read_escrow_age()` (00001200). That door is the gate: it refuses anyone but a
 * platform operator (`security.is_admin()`) with 42501, which this maps to 403 and the page answers
 * with a 404, as `/admin/disputes` does (Decision #212). It decides nothing and moves nothing; the
 * database classifies and ages every row.
 *
 * `/admin/ledger` and `LedgerHealthService` are FBP DB16's and have not landed. When they do, the
 * service exposes this as its Escrow age read and the page renders it as one section.
 */

// #region Raw rows (the SQL jsonb, as written by the function)
interface RawOver {
	days: number;
	count: number;
	total_minor: number;
}

interface RawRow {
	kind: string;
	currency: string;
	count: number;
	total_minor: number;
	oldest_at: string;
	p50_days: number;
	p90_days: number;
	max_days: number;
	over: RawOver[] | null;
}

/** `finance.read_escrow_age()`'s answer. */
export interface RawEscrowAge {
	as_of: string;
	rows: RawRow[] | null;
}
// #endregion

// #region Mapping
function toOver(raw: RawOver): EscrowAgeOver {
	return { days: raw.days, count: raw.count, totalMinor: raw.total_minor };
}

function toRow(raw: RawRow): EscrowAgeRow | null {
	const kind = EscrowAgeKind.safeParse(raw.kind);
	if (!kind.success) return null;
	return {
		kind: kind.data,
		currency: raw.currency,
		count: raw.count,
		totalMinor: raw.total_minor,
		oldestAt: raw.oldest_at,
		p50Days: raw.p50_days,
		p90Days: raw.p90_days,
		maxDays: raw.max_days,
		over: (raw.over ?? []).map(toOver),
	};
}

/**
 * The jsonb onto {@link EscrowAge}, order kept (by currency, then clock order). A kind this build
 * does not know is dropped rather than guessed at. Pure; pinned by `escrow-age.test.ts`.
 */
export function toEscrowAge(raw: RawEscrowAge | null): EscrowAge {
	return {
		asOf: raw?.as_of ?? new Date(0).toISOString(),
		rows: (raw?.rows ?? []).map(toRow).filter((row): row is EscrowAgeRow => row !== null),
	};
}
// #endregion

// #region The read
/**
 * The escrow-age read for an operator. 403 for anyone else (the definer's 42501), 401 with no
 * session, 503 without the live database or when it cannot be reached. Never throws into the route.
 */
export async function readEscrowAge(actor: ReadActor): Promise<ServiceResult<EscrowAge>> {
	if (!isFinanceBackendLive()) return fail(503, { message: "Escrow age needs the live database." });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	try {
		const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
			"read_escrow_age",
		);
		if (error) {
			if (error.code === "42501") return fail(403, { message: error.message });
			return fail(502, { message: "That couldn't be read just now. Please try again." });
		}
		return ok(toEscrowAge(data as RawEscrowAge | null));
	} catch (error) {
		console.error("[ledger:escrow-age]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach the ledger just now. Try again in a moment." });
	}
}
// #endregion
