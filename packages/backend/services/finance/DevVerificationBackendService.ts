import type { VerificationStatus } from "@projective/types/finance";
import { serverEnv } from "../../core/env.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	applyIdentityEvent,
	attachIdentitySession,
	beginIdentityVerification,
	type DbRefusal,
	myVerificationStatus,
	payoutAccountFor,
	recordPayoutAccount,
	syncPayoutAccount,
} from "./live-payments.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";

type Result<T> = ServiceResult<T>;

const PERSONAL = { scope: "personal", teamId: null, businessId: null } as const;

function refused<T>(refusal: DbRefusal): Result<T> {
	return fail(refusal.status, { message: refusal.message, errors: refusal.errors });
}

function syntheticId(): string {
	return crypto.randomUUID().replaceAll("-", "");
}

function processorDoorFailed<T>(label: string, error: unknown): Result<T> {
	console.error(`[payments:dev:${label}]`, error);
	const detail = error instanceof Error ? error.message : String(error);
	return fail(500, { message: `The ${label} step failed: ${detail}` });
}

async function forceIdentityVerified(
	actor: ReadActor & { accessToken: string },
): Promise<Result<null>> {
	const begun = await beginIdentityVerification(actor.accessToken);
	if (!begun.ok) return refused(begun.refusal);
	const session = `vs_dev_${syntheticId()}`;
	const bound = await attachIdentitySession(actor.accessToken, begun.value.id, session);
	if (!bound.ok) return refused(bound.refusal);
	try {
		const applied = await applyIdentityEvent({
			eventId: `evt_dev_${syntheticId()}`,
			eventType: "identity.verification_session.verified",
			session,
			errorCode: null,
			livemode: false,
		});
		if (applied.outcome !== "applied") {
			return fail(409, {
				message: `The identity decision was ${applied.outcome}: ${applied.detail ?? "no detail"}.`,
			});
		}
	} catch (error) {
		return processorDoorFailed("identity", error);
	}
	return ok(null);
}

async function forcePayoutVerified(
	actor: ReadActor & { accessToken: string },
): Promise<Result<null>> {
	const lookup = await payoutAccountFor(actor.accessToken, PERSONAL);
	if (!lookup.ok) return refused(lookup.refusal);
	let accountId = lookup.value.account?.accountId ?? null;
	if (!accountId) {
		const recorded = await recordPayoutAccount(
			actor.accessToken,
			PERSONAL,
			`acct_DEV${syntheticId()}`,
		);
		if (!recorded.ok) return refused(recorded.refusal);
		accountId = recorded.value.accountId;
	}
	try {
		const synced = await syncPayoutAccount(accountId, "verified");
		if (!synced.payoutReady) {
			return fail(409, {
				message: "The payout account is verified but the earning gate did not open.",
			});
		}
	} catch (error) {
		return processorDoorFailed("payout", error);
	}
	return ok(null);
}

/**
 * DevVerificationBackendService — DEVELOPMENT ONLY. Opens the earning gate (Decision #196) for the
 * signed-in freelancer without a trip through Stripe: KYC-verified at tier 2 and a verified personal
 * payout account, so `finance.fn_freelancer_payout_ready` answers true.
 *
 * Walks the SAME doors the real flow does, with synthetic processor ids in place of Stripe's: the
 * user doors open and bind an identity case (`vs_dev_…`), the service-role door applies a
 * `identity.verification_session.verified` decision for it (`evt_dev_…`), and the personal payout
 * account — the caller's existing one, or a new `acct_DEV…` row — is synced to `verified`. Every
 * trigger, notification and standing stamp downstream fires as it would for a real verification.
 *
 * A synthetic `acct_DEV…` account is not a Stripe account: a withdrawal or a status sync against
 * Stripe refuses it. The server's `DENO_ENV` gates the whole call (404 anywhere but development).
 */
export class DevVerificationBackendService {
	/** Force the caller identity-verified and payout-ready, then return their verification picture. */
	static async forcePayoutReady(actor: ReadActor): Promise<Result<VerificationStatus>> {
		if (serverEnv().appEnv !== "development") {
			return fail(404, { message: "Not found." });
		}
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to verify your account." });
		if (!isFinanceBackendLive()) {
			return fail(503, {
				message:
					"Verification isn't connected in this environment — run against the live database.",
			});
		}

		const current = await myVerificationStatus(actor.accessToken);
		if (!current.ok) return refused(current.refusal);
		if (!current.value.isFreelancer) {
			return fail(403, {
				message: "Set up your freelancer profile first — the earning gate is a freelancer's.",
			});
		}

		if (current.value.kycStatus !== "verified") {
			const identity = await forceIdentityVerified(actor);
			if (!identity.ok) return fail(identity.status, identity);
		}
		if (!current.value.payoutReady) {
			const payout = await forcePayoutVerified(actor);
			if (!payout.ok) return fail(payout.status, payout);
		}

		const after = await PaymentBackendService.verificationStatus(actor);
		if (!after.ok || !after.data) return after;
		return ok(after.data, { message: "Identity verified and payout account ready." });
	}
}
