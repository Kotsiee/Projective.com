import {
	type AccountLifecycle,
	AccountLifecycleRowSchema,
	type ChangeHandle,
	type DeletionScope,
	type HandlePolicy,
	HandlePolicyRowSchema,
	type ScheduleDeletion,
} from "@projective/types/org";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { lifecycleFailure, type RpcError } from "./account-lifecycle-refusals.ts";

/**
 * AccountLifecycleBackendService — the FAT service behind a person's own account lifecycle in
 * Settings → Account: the @handle change policy, giving up the freelancer profile, deleting the
 * account, and cancelling either inside its window (migration 00001060).
 *
 * Every rule is in SQL. Each call runs a definer bound to the caller's OWN access token
 * ({@link getUserClient}), which resolves the person from `auth.uid()`; nothing here takes a user id
 * from the request. The one exception is {@link sweepDue}, the scheduler's door, which runs as the
 * service role and acts on every due request.
 *
 * Gated on `AUTH_BACKEND_LIVE`: with no database there is nothing truthful to answer, so every method
 * refuses with a 503. A guest is a 401.
 */

// #region Guards
function sessionToken(actor: ReadActor): string | ServiceResult<never> {
	if (!actor.userId) return fail(401, { message: "Sign in to manage your account." });
	if (!isAuthBackendLive()) {
		return fail(503, { message: "Your account can't be changed in this environment." });
	}
	if (!canReadLive(actor)) {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return actor.accessToken;
}

function unreachable(error: unknown): ServiceResult<never> {
	return fail(503, {
		message: "We couldn't reach the server. Try again in a moment.",
		details: { reason: error instanceof Error ? error.message : String(error) },
	});
}

function malformed(what: string): ServiceResult<never> {
	return fail(502, { message: `The server answered with an unreadable ${what}.` });
}
// #endregion

/** What a handle change answers: the new standing under the policy and the handle given up. */
export interface HandleChanged {
	policy: HandlePolicy;
	previous: string;
}

export class AccountLifecycleBackendService {
	// #region Handle
	/** Where the caller stands under the handle change policy. */
	static async handlePolicy(actor: ReadActor): Promise<ServiceResult<{ policy: HandlePolicy }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("get_handle_policy");
			if (res.error) return lifecycleFailure(res.error as RpcError);
			const parsed = HandlePolicyRowSchema.safeParse(res.data);
			return parsed.success ? ok({ policy: parsed.data }) : malformed("handle policy");
		} catch (error) {
			return unreachable(error);
		}
	}

	/**
	 * Change the caller's @handle. The session must be renewed afterwards — the access token carries
	 * the handle — which the client does once this answers.
	 */
	static async changeHandle(
		actor: ReadActor,
		input: ChangeHandle,
	): Promise<ServiceResult<HandleChanged>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("change_username", {
				p_handle: input.handle,
			});
			if (res.error) return lifecycleFailure(res.error as RpcError);
			const parsed = HandlePolicyRowSchema.safeParse(res.data);
			const previous = (res.data as { previous?: unknown } | null)?.previous;
			if (!parsed.success || typeof previous !== "string") return malformed("handle change");
			return ok({ policy: parsed.data, previous }, {
				message: `Your handle is now @${parsed.data.handle}.`,
			});
		} catch (error) {
			return unreachable(error);
		}
	}
	// #endregion

	// #region Lifecycle
	/** The freelancer persona, anything scheduled, and what blocks scheduling. */
	static async lifecycle(
		actor: ReadActor,
	): Promise<ServiceResult<{ lifecycle: AccountLifecycle }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("get_account_lifecycle");
			if (res.error) return lifecycleFailure(res.error as RpcError);
			const parsed = AccountLifecycleRowSchema.safeParse(res.data);
			return parsed.success ? ok({ lifecycle: parsed.data }) : malformed("account state");
		} catch (error) {
			return unreachable(error);
		}
	}

	/**
	 * Schedule a removal: the freelancer profile (the persona drops at once, erasure in 90 days) or
	 * the whole account (hidden at once, erasure in 30 days). Answers the lifecycle afterwards.
	 */
	static async schedule(
		actor: ReadActor,
		input: ScheduleDeletion,
	): Promise<ServiceResult<{ lifecycle: AccountLifecycle }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		const fn = input.scope === "account"
			? "schedule_account_deletion"
			: "schedule_freelancer_removal";
		try {
			const res = await getUserClient(token).schema("org").rpc(fn, {
				p_confirmation: input.confirmation,
			});
			if (res.error) return lifecycleFailure(res.error as RpcError);
			const after = await AccountLifecycleBackendService.lifecycle(actor);
			if (!after.ok || !after.data) return after;
			return ok(after.data, {
				message: input.scope === "account"
					? "Your account is scheduled for deletion."
					: "Your freelancer profile is scheduled for deletion.",
			});
		} catch (error) {
			return unreachable(error);
		}
	}

	/** Cancel the caller's open request of one scope, restoring what scheduling paused. */
	static async cancel(
		actor: ReadActor,
		scope: DeletionScope,
	): Promise<ServiceResult<{ lifecycle: AccountLifecycle }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("cancel_deletion_request", {
				p_scope: scope,
			});
			if (res.error) return lifecycleFailure(res.error as RpcError);
			const parsed = AccountLifecycleRowSchema.safeParse(res.data);
			if (!parsed.success) return malformed("account state");
			return ok({ lifecycle: parsed.data }, {
				message: scope === "account"
					? "Your account will not be deleted."
					: "Your freelancer profile is back.",
			});
		} catch (error) {
			return unreachable(error);
		}
	}
	// #endregion

	// #region Scheduler
	/** Whether a request carries the scheduler's bearer token (`ACCOUNT_CRON_SECRET`). */
	static isCronAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().accountCronSecret);
	}

	/**
	 * Run every erasure that has come due (`security.purge_due_account_deletions`). The scheduler's
	 * door — never reachable from a person's session. Answers how many requests completed; a request
	 * whose blockers came back is deferred by the definer, not forced.
	 */
	static async sweepDue(limit = 100): Promise<ServiceResult<{ completed: number }>> {
		if (!isAuthBackendLive()) {
			return fail(503, { message: "The erasure sweep can't run in this environment." });
		}
		try {
			const res = await getServiceClient().schema("security").rpc("purge_due_account_deletions", {
				p_limit: limit,
			});
			if (res.error) return lifecycleFailure(res.error as RpcError);
			return ok({ completed: typeof res.data === "number" ? res.data : Number(res.data ?? 0) });
		} catch (error) {
			return unreachable(error);
		}
	}
	// #endregion
}
