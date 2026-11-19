import {
	type HealthBody,
	HeartbeatSchema,
	type WebhookFailure,
	WebhookFailureSchema,
	type WebhookOutcomeClass,
} from "@projective/types/ops";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { getServiceClient, isSupabaseConfigured, useMocks } from "../../core/supabase.ts";

/**
 * OpsHealthService — the two signals the alert pipeline cannot raise for itself (OPS5).
 *
 * - {@link recordWebhookFailure}: every webhook service reports each non-2xx outcome here, facts only
 *   (a provider code, the status, a reason code, and the event's id and type when it had a verified
 *   one). It becomes one `ops.log_entries` row per provider, outcome class and minute (scope
 *   `webhook.<provider>`), its count in `data`, and `ops-watch-jobs` turns a burst into an alert
 *   (`ops.fn_watch_webhooks`). A single failure never alerts by itself.
 * - {@link heartbeat}: what `GET /api/ops/health` answers an outside monitor — whether the database
 *   answers, the watcher ran recently, and no alert has waited (`ops.fn_heartbeat`). The one failure the
 *   database cannot report is its own, so only something outside it can see that.
 */

// #region Webhook failures
/** Every failure in a minute is written while there are at most this many; past it, only at powers of 2. */
const EXACT_WRITES = 10;

/** How long a webhook waits on the record before it answers anyway. */
const RECORD_TIMEOUT_MS = 2_000;

/**
 * How a failed outcome counts: a 5xx is a `failure` (the provider redelivers); a `signature_*` reason
 * is a `signature` refusal; any other status is `refused`. Pure.
 */
export function webhookOutcomeClass(status: number, reason: string): WebhookOutcomeClass {
	if (status >= 500) return "failure";
	if (reason.startsWith("signature")) return "signature";
	return "refused";
}

/** Where a count of one provider's failures of one class is folded in (`ops.fn_record_webhook_failure`). */
export type WebhookFailureDoor = (
	failure: WebhookFailure,
	outcome: WebhookOutcomeClass,
	count: number,
) => Promise<void>;

/** The live door, as the service role. Nothing to write to without a live database. */
export const liveWebhookFailureDoor: WebhookFailureDoor = async (failure, outcome, count) => {
	if (!isSupabaseConfigured() || useMocks()) return;
	const { error } = await getServiceClient().schema("ops").rpc("fn_record_webhook_failure", {
		p_provider: failure.provider,
		p_class: outcome,
		p_status: failure.status,
		p_reason: failure.reason,
		p_count: count,
		p_event_id: failure.eventId ?? null,
		p_event_type: failure.eventType ?? null,
	}).abortSignal(AbortSignal.timeout(RECORD_TIMEOUT_MS));
	if (error) throw new Error(`ops.fn_record_webhook_failure failed (${error.code ?? "no code"})`);
};

/** A recorder of webhook failures: {@link createWebhookFailureRecorder}. */
export interface WebhookFailureRecorder {
	/** Count one failure, writing when this minute's count calls for it. Never rejects. */
	record(failure: WebhookFailure): Promise<void>;
}

/**
 * A recorder that bounds what a flood costs. Per provider and outcome class it counts the failures of
 * the current minute, and calls the door with what is new since its last call: on each of the first
 * {@link EXACT_WRITES} failures of a minute (so a threshold of 5 is always seen exactly), then at
 * the 16th, 32nd, 64th … So a minute of N forged posts costs about 10 + log2(N) database calls, and
 * the database keeps one row for it. What a minute leaves unwritten past its last power of 2 is carried
 * into the next minute's first write. A door that fails is logged, never thrown into the webhook.
 */
export function createWebhookFailureRecorder(
	door: WebhookFailureDoor,
	now: () => number = Date.now,
): WebhookFailureRecorder {
	const buckets = new Map<
		string,
		{ minute: number; seen: number; written: number; carry: number }
	>();
	return {
		async record(failure) {
			const parsed = WebhookFailureSchema.safeParse(failure);
			if (!parsed.success) {
				console.warn("[ops:webhooks] a webhook failure that is not facts only was not recorded");
				return;
			}
			const outcome = webhookOutcomeClass(parsed.data.status, parsed.data.reason);
			const key = `${parsed.data.provider}:${outcome}`;
			const minute = Math.floor(now() / 60_000);
			let bucket = buckets.get(key);
			if (!bucket || bucket.minute !== minute) {
				const carry = bucket ? bucket.seen - bucket.written + bucket.carry : 0;
				bucket = { minute, seen: 0, written: 0, carry };
				buckets.set(key, bucket);
			}
			bucket.seen += 1;
			const due = bucket.seen <= EXACT_WRITES || (bucket.seen & (bucket.seen - 1)) === 0;
			if (!due) return;
			const count = bucket.seen - bucket.written + bucket.carry;
			bucket.written = bucket.seen;
			bucket.carry = 0;
			try {
				await door(parsed.data, outcome, count);
			} catch (error) {
				console.warn(
					"[ops:webhooks] a webhook failure was not recorded:",
					error instanceof Error ? error.message : error,
				);
			}
		},
	};
}

let recorder: WebhookFailureRecorder = createWebhookFailureRecorder(liveWebhookFailureDoor);

/**
 * Report one non-2xx webhook outcome (OPS5). Facts only: `provider` is a code (`stripe`,
 * `stripe-v2`, `zoom`, …; an unknown provider is reported as `unknown`), `reason` a code
 * (`signature_invalid`, `handler_failed`, …), and the event's id and type only when the delivery was
 * verified. Never rejects, and never holds the webhook's answer for more than 2 seconds.
 */
export function recordWebhookFailure(failure: WebhookFailure): Promise<void> {
	return recorder.record(failure);
}

/**
 * Point {@link recordWebhookFailure} at another door (a test's fake), with fresh counts; returns the
 * function that puts the live door back.
 */
export function useWebhookFailureDoor(door: WebhookFailureDoor, now?: () => number): () => void {
	const previous = recorder;
	recorder = createWebhookFailureRecorder(door, now);
	return () => {
		recorder = previous;
	};
}
// #endregion

// #region The heartbeat
/** What the heartbeat reads: a live database, and `ops.fn_heartbeat()`. */
export interface HeartbeatDeps {
	live: boolean;
	read(): Promise<unknown>;
}

function liveHeartbeatDeps(): HeartbeatDeps {
	return {
		live: isSupabaseConfigured() && !useMocks(),
		async read() {
			const { data, error } = await getServiceClient().schema("ops").rpc("fn_heartbeat")
				.abortSignal(AbortSignal.timeout(5_000));
			if (error) throw new Error(`ops.fn_heartbeat failed (${error.code ?? "no code"})`);
			return data;
		},
	};
}

/**
 * `{ ok: true }` only when all three hold: the database answers; `ops-watch-jobs` is enabled and
 * succeeded within `heartbeat_watch_minutes`; and no alert has waited undelivered for 15 minutes.
 * Anything else, including no live database, is `{ ok: false }`. Never throws, and says nothing more.
 */
export async function heartbeat(deps: HeartbeatDeps = liveHeartbeatDeps()): Promise<HealthBody> {
	if (!deps.live) return { ok: false };
	try {
		const parsed = HeartbeatSchema.safeParse(await deps.read());
		return { ok: parsed.success && parsed.data.watch && parsed.data.alerts };
	} catch (error) {
		console.error("[ops:health]", error instanceof Error ? error.message : error);
		return { ok: false };
	}
}
// #endregion

/** The webhook failure record and the heartbeat, as the webhook services and `/api/ops/health` reach them. */
export const OpsHealthService = {
	/** Whether a request carries the monitor's bearer (`OPS_HEALTH_TOKEN`), in constant time. */
	isHealthAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().opsHealthToken);
	},
	heartbeat: () => heartbeat(),
	recordWebhookFailure,
};
