import type { SupabaseClient } from "supabaseClient";
import {
	type ClaimedDelivery,
	ClaimedDeliveryRowSchema,
	type DispatchTally,
	type OutboundChannel,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { getServiceClient, isAuthBackendLive } from "../../core/supabase.ts";
import { buildDispatchPayload } from "./dispatch-payload.ts";
import {
	configuredTransports,
	type DispatchTransport,
	type TransportOutcome,
} from "./dispatch-transports.ts";

/**
 * NotificationDispatchService — the notification dispatcher (Decision #344 (a); CAS §2.3; EPI §8.1).
 *
 * Two doors call {@link NotificationDispatchService.dispatch}: `POST /api/comms/dispatch`, which the
 * `comms.notifications` trigger posts each new notification's id to through pg_net, and
 * `POST /api/comms/cron/dispatch`, the `comms-dispatch-sweep` job, which re-drives what that post
 * missed and every failure due a retry. Both are machine-to-app, so both check
 * `COMMS_DISPATCH_SECRET` in constant time and answer 404 otherwise
 * ({@link NotificationDispatchService.isDispatchAuthorised}).
 *
 * One pass claims the due deliveries of the channels the transport registry can serve
 * (`comms.fn_claim_deliveries`, FOR UPDATE SKIP LOCKED, gated on the `comms.dispatch_webhook` flag),
 * builds each payload (the title, the absolute deep link, the notification id; never the body or the
 * payload), hands it to its channel's transport and records the outcome
 * (`comms.fn_record_delivery_result`). A destination is used for the send and nothing else: it is
 * never returned, logged or written anywhere. Logs carry counts and ids only. Runs under the service
 * role, gated on `AUTH_BACKEND_LIVE` like the inbox.
 */

// #region Seams
/** The database half of a pass, behind a seam so a unit test can run one without Postgres. */
export interface DispatchDb {
	/** Claim due deliveries of `channels` (one notification's, or any). Raw rows, as Postgres sends them. */
	claim(
		channels: OutboundChannel[],
		notificationId: string | null,
		limit: number,
	): Promise<unknown[]>;
	/** Record one send's outcome on its delivery. */
	record(deliveryId: string, outcome: TransportOutcome): Promise<void>;
	/** Whether the `comms.dispatch_webhook` flag is on. */
	enabled(): Promise<boolean>;
}

/** What one pass runs against. */
export interface DispatchDeps {
	/** Whether this environment dispatches at all (Supabase live). */
	live: boolean;
	db: DispatchDb;
	transports: () => Map<OutboundChannel, DispatchTransport>;
	/** The public origin a deep link is built on (`APP_URL`). */
	appUrl: string;
}

const commsDb = () => getServiceClient().schema("comms") as unknown as SupabaseClient;

/** The live database: the comms RPCs, under the service role. Errors name the RPC and code only. */
export const liveDispatchDb: DispatchDb = {
	async claim(channels, notificationId, limit) {
		const { data, error } = await commsDb().rpc("fn_claim_deliveries", {
			p_channels: channels,
			p_notification: notificationId,
			p_limit: limit,
		});
		if (error) throw new Error(`comms.fn_claim_deliveries failed (${error.code ?? "no code"})`);
		return (data ?? []) as unknown[];
	},
	async record(deliveryId, outcome) {
		const { error } = await commsDb().rpc("fn_record_delivery_result", {
			p_delivery: deliveryId,
			p_status: outcome.status,
			p_provider: outcome.provider,
			p_provider_ref: outcome.providerRef ?? null,
			p_error: outcome.error ?? null,
		});
		if (error) {
			throw new Error(`comms.fn_record_delivery_result failed (${error.code ?? "no code"})`);
		}
	},
	async enabled() {
		const { data, error } = await commsDb().rpc("fn_dispatch_enabled");
		if (error) throw new Error(`comms.fn_dispatch_enabled failed (${error.code ?? "no code"})`);
		return data === true;
	},
};

function liveDeps(): DispatchDeps {
	return {
		live: isAuthBackendLive(),
		db: liveDispatchDb,
		transports: () => configuredTransports(),
		appUrl: serverEnv().appUrl,
	};
}
// #endregion

// #region Helpers
/** The most rows one pass claims, and the default for the trigger's single-notification pass. */
export const MAX_DISPATCH_LIMIT = 500;
export const DEFAULT_DISPATCH_LIMIT = 200;

/** How many sends run at once, so one pass cannot open hundreds of provider connections. */
const SEND_CONCURRENCY = 10;

/** How long the flag read is reused, so a settings render does not cost a query each time. */
const FLAG_TTL_MS = 30_000;

const EMPTY_TALLY: DispatchTally = { claimed: 0, sent: 0, failed: 0, skipped: 0, suppressed: 0 };

const NOT_LIVE = "Notification dispatch isn't connected in this environment.";
const UNREACHABLE = "Notifications couldn't be dispatched just now. The sweep will retry.";

/** A dispatcher bearer counts only at 32 characters or more, so the `XXXX-XXXX` placeholder never does. */
export function isWellFormedDispatchSecret(secret: string | undefined): boolean {
	return (secret?.trim().length ?? 0) >= 32;
}

/** A claim row in the service's terms, or `null` when it does not read as one. */
function toClaimed(raw: unknown): ClaimedDelivery | null {
	const parsed = ClaimedDeliveryRowSchema.safeParse(raw);
	if (!parsed.success) return null;
	const r = parsed.data;
	return {
		deliveryId: r.delivery_id,
		notificationId: r.notification_id,
		userId: r.user_id,
		channel: r.channel,
		status: r.status,
		attempts: r.attempts,
		suppressedReason: r.suppressed_reason,
		destination: r.destination,
		title: r.title,
		actionUrl: r.action_url,
		type: r.type,
		category: r.category,
		urgency: r.urgency,
		groupKey: r.group_key,
	};
}

/** The id of a claim row that failed to parse, when it still carries one, so it can be closed. */
function rawDeliveryId(raw: unknown): string | null {
	const id = (raw as { delivery_id?: unknown } | null)?.delivery_id;
	return typeof id === "string" ? id : null;
}

/** A throw, as a delivery row may record it: its message cut short. Transports never put a destination in one. */
function errorCode(error: unknown): string {
	return (error instanceof Error ? error.message : "send_failed").slice(0, 200) || "send_failed";
}

/** Run `fn` over `rows`, at most {@link SEND_CONCURRENCY} at a time. */
async function inChunks<T, R>(rows: T[], fn: (row: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < rows.length; i += SEND_CONCURRENCY) {
		results.push(...await Promise.all(rows.slice(i, i + SEND_CONCURRENCY).map(fn)));
	}
	return results;
}

let flagCache: { value: boolean; at: number } | null = null;
// #endregion

// #region Service
export class NotificationDispatchService {
	/** Whether a request carries the dispatcher's bearer (`COMMS_DISPATCH_SECRET`), in constant time. */
	static isDispatchAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().commsDispatchSecret);
	}

	/**
	 * Whether the dispatcher runs here: its bearer is well formed and the `comms.dispatch_webhook`
	 * flag is on. Channel liveness reads this, so no surface promises a channel nothing dispatches.
	 * The flag read is reused for 30 seconds; a failed read counts as off.
	 */
	static async isRunning(deps: DispatchDeps = liveDeps(), now = Date.now()): Promise<boolean> {
		if (!deps.live || !isWellFormedDispatchSecret(serverEnv().commsDispatchSecret)) return false;
		if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.value;
		let value = false;
		try {
			value = await deps.db.enabled();
		} catch (error) {
			console.error("[comms:dispatch]", errorCode(error));
		}
		flagCache = { value, at: now };
		return value;
	}

	/** Forget the cached flag read (tests, and a flag flipped by hand in development). */
	static resetFlagCache(): void {
		flagCache = null;
	}

	/**
	 * One dispatch pass: `notificationId`'s deliveries (the trigger's post) or every due one (the
	 * sweep), up to `limit`. Only channels with a configured transport are claimed; with none, the
	 * pass does nothing and every delivery waits. Answers counts by outcome.
	 */
	static async dispatch(
		notificationId: string | null,
		limit: number = DEFAULT_DISPATCH_LIMIT,
		deps: DispatchDeps = liveDeps(),
	): Promise<ServiceResult<DispatchTally>> {
		if (!deps.live) return fail(503, { message: NOT_LIVE });
		const transports = deps.transports();
		if (transports.size === 0) return ok({ ...EMPTY_TALLY });

		const bounded = Math.min(
			Math.max(Math.trunc(limit) || DEFAULT_DISPATCH_LIMIT, 1),
			MAX_DISPATCH_LIMIT,
		);
		let rows: unknown[];
		try {
			rows = await deps.db.claim([...transports.keys()], notificationId, bounded);
		} catch (error) {
			console.error("[comms:dispatch]", errorCode(error));
			return fail(503, { message: UNREACHABLE });
		}

		const tally: DispatchTally = { ...EMPTY_TALLY, claimed: rows.length };
		const outcomes = await inChunks(rows, async (raw) => {
			const delivery = toClaimed(raw);
			if (!delivery) {
				const id = rawDeliveryId(raw);
				if (id) {
					await NotificationDispatchService.#record(deps, id, {
						status: "failed",
						provider: "dispatcher",
						error: "unreadable_claim",
					});
				}
				return "failed" as const;
			}
			if (delivery.status === "skipped" || delivery.status === "suppressed") return delivery.status;
			if (delivery.status !== "queued") return "skipped" as const;

			const transport = transports.get(delivery.channel as OutboundChannel);
			let outcome: TransportOutcome;
			if (!transport || !delivery.destination) {
				outcome = { status: "failed", provider: "dispatcher", error: "no_transport" };
			} else {
				try {
					outcome = await transport.send(delivery, buildDispatchPayload(delivery, deps.appUrl));
				} catch (error) {
					outcome = { status: "failed", provider: transport.provider, error: errorCode(error) };
				}
			}
			await NotificationDispatchService.#record(deps, delivery.deliveryId, outcome);
			return outcome.status === "failed" ? "failed" as const : "sent" as const;
		});

		for (const outcome of outcomes) tally[outcome] += 1;
		return ok(tally);
	}

	/**
	 * Record an outcome. A failed write leaves the row queued, and the claim's 15-minute lease offers
	 * it again, so it is logged (ids only) rather than thrown.
	 */
	static async #record(
		deps: DispatchDeps,
		deliveryId: string,
		outcome: TransportOutcome,
	): Promise<void> {
		try {
			await deps.db.record(deliveryId, outcome);
		} catch (error) {
			console.error("[comms:dispatch]", deliveryId, errorCode(error));
		}
	}
}
// #endregion
