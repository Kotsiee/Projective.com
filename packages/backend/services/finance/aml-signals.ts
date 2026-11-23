import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import {
	AmlChurnFactsSchema,
	AmlHoldFactsSchema,
	AmlRoundTripFactsSchema,
	AmlSignalKind,
	type AmlSignalsRead,
	type AmlSignalView,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";

/**
 * aml-signals: the `/admin/ledger` AML signals section's read (LEGAL_COMPLIANCE LG7, Decision #529).
 * It lists what the money doors recorded in `finance.aml_signals` through the operator door
 * `finance.read_aml_signals()` (00001240). That door is the gate: it refuses anyone but a platform
 * operator (`security.is_admin()`) with 42501, which this maps to 403 and the page answers with a 404,
 * as `/admin/disputes` does (Decision #212). It decides nothing and acts on nothing: the review queue is
 * Identity X2's, and dormant. `LedgerHealthService.amlSignals` exposes it as the section's read.
 */

// #region Raw rows (the SQL jsonb, as written by the function)
interface RawSignal {
	id: string;
	kind: string;
	subject_user_id: string;
	subject_username: string | null;
	wallet_id: string | null;
	escrow_id: string | null;
	payout_id: string | null;
	amount_minor: number;
	currency: string;
	facts: Record<string, unknown> | null;
	created_at: string;
}

/** `finance.read_aml_signals()`'s answer. */
export interface RawAmlSignals {
	as_of: string;
	hold_enabled: boolean;
	counts: Record<string, number> | null;
	signals: RawSignal[] | null;
}
// #endregion

// #region Mapping
/** The facts of one kind, snake_case keys onto the schema's; null when they do not parse. */
function factsOf(kind: AmlSignalKind, raw: Record<string, unknown>) {
	switch (kind) {
		case "round_trip": {
			const parsed = AmlRoundTripFactsSchema.safeParse({
				event: raw.event,
				relation: raw.relation,
				ticketId: raw.ticket_id ?? null,
				cohortMembershipId: raw.cohort_membership_id ?? null,
			});
			return parsed.success ? parsed.data : null;
		}
		case "rapid_churn": {
			const parsed = AmlChurnFactsSchema.safeParse({
				inMinor: raw.in_minor,
				payments: raw.payments,
				lastInAt: raw.last_in_at,
				minMinor: raw.min_minor,
				windowHours: raw.window_hours,
			});
			return parsed.success ? parsed.data : null;
		}
		case "safety_hold": {
			const parsed = AmlHoldFactsSchema.safeParse({
				heldUntil: raw.held_until,
				triggers: raw.triggers,
			});
			return parsed.success ? parsed.data : null;
		}
	}
}

function toSignal(raw: RawSignal): AmlSignalView | null {
	const kind = AmlSignalKind.safeParse(raw.kind);
	if (!kind.success) return null;
	const facts = factsOf(kind.data, raw.facts ?? {});
	if (!facts) return null;
	return {
		id: raw.id,
		kind: kind.data,
		subjectUserId: raw.subject_user_id,
		subjectUsername: raw.subject_username,
		walletId: raw.wallet_id,
		escrowId: raw.escrow_id,
		payoutId: raw.payout_id,
		amountMinor: raw.amount_minor,
		currency: raw.currency,
		createdAt: raw.created_at,
		facts,
	} as AmlSignalView;
}

/**
 * The jsonb onto {@link AmlSignalsRead}, newest first as the database ordered it. A kind this build
 * does not know, or facts that do not parse, are dropped rather than guessed at; a missing count is 0.
 * Pure; pinned by `aml-signals.test.ts`.
 */
export function toAmlSignals(raw: RawAmlSignals | null): AmlSignalsRead {
	const counts = raw?.counts ?? {};
	return {
		asOf: raw?.as_of ?? new Date(0).toISOString(),
		holdEnabled: raw?.hold_enabled === true,
		counts: {
			round_trip: counts.round_trip ?? 0,
			rapid_churn: counts.rapid_churn ?? 0,
			safety_hold: counts.safety_hold ?? 0,
		},
		signals: (raw?.signals ?? []).map(toSignal).filter((s): s is AmlSignalView => s !== null),
	};
}
// #endregion

// #region The read
/**
 * The AML signals for an operator. 403 for anyone else (the definer's 42501), 401 with no session,
 * 503 without the live database or when it cannot be reached. Never throws into the route.
 */
export async function readAmlSignals(actor: ReadActor): Promise<ServiceResult<AmlSignalsRead>> {
	if (!isFinanceBackendLive()) return fail(503, { message: "AML signals need the live database." });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	try {
		const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
			"read_aml_signals",
			{ p_limit: 200 },
		);
		if (error) {
			if (error.code === "42501") return fail(403, { message: error.message });
			return fail(502, { message: "That couldn't be read just now. Please try again." });
		}
		return ok(toAmlSignals(data as RawAmlSignals | null));
	} catch (error) {
		console.error("[ledger:aml-signals]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach the ledger just now. Try again in a moment." });
	}
}
// #endregion
