import type { SupabaseClient } from "supabaseClient";
import {
	type ClaimedDigestRow,
	ClaimedDigestRowSchema,
	type DispatchTally,
	NotificationCategory,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { getServiceClient, isAuthBackendLive } from "../../core/supabase.ts";
import { configuredTransport, type MailMessage, type MailTransport } from "../mail/transport.ts";
import { deepLink, INBOX_PATH } from "./dispatch-payload.ts";
import { PREFERENCES_PATH } from "./email-transport.ts";
import { inChunks } from "./NotificationDispatchService.ts";
import { signUnsubscribeToken, unsubscribeUrl } from "./unsubscribe-token.ts";

/**
 * DigestMailService — mails the daily and weekly notification digests (PROJECTS NO2; PRD-E15).
 *
 * `comms.fn_build_digests` rolls a person's digestible notices into one `comms.notification_digests`
 * row at their local digest hour. The `comms-digest-send` job (`POST /api/comms/cron/digests`, on the
 * dispatcher's bearer) runs {@link DigestMailService.send}: `comms.fn_claim_digests` leases each
 * pending digest to one sender while `comms.dispatch_webhook` is on, after deciding it again against
 * the person's preferences, snooze and suppression; this mails it through the dispatcher's Resend
 * transport and records the outcome (`comms.fn_record_digest_result`): sent once, or retried after
 * 2^attempts minutes and failed at the fifth try.
 *
 * The mail lists counts by category, then each notice's title and an absolute link into the app.
 * Never a body or a payload: the claim does not return them (EPI §3.5 rule 4). The digest id is the
 * Idempotency-Key, so a retried send is one message. A digest listing a Marketing notice carries the
 * RFC 8058 one-click pair, and is not sent without it. The address is used for the send and nothing
 * else; logs carry ids and codes only.
 */

// #region Seams
/** The database half of a pass, behind a seam so a unit test can run one without Postgres. */
export interface DigestDb {
	/** Lease up to `limit` due digests. Raw rows, as Postgres sends them. */
	claim(limit: number): Promise<unknown[]>;
	/** Record one send's outcome. */
	record(
		digestId: string,
		sent: boolean,
		providerRef: string | null,
		error: string | null,
	): Promise<void>;
}

/** What one pass runs against. */
export interface DigestDeps {
	/** Whether this environment sends at all (Supabase live). */
	live: boolean;
	db: DigestDb;
	/** The mail transport, or null while none is configured (no well-formed Resend key and sender). */
	mail: () => MailTransport | null;
	/** The public origin links are built on (`APP_URL`). */
	appUrl: string;
	signUnsubscribe: (userId: string) => Promise<string | null>;
}

const commsDb = () => getServiceClient().schema("comms") as unknown as SupabaseClient;

/** The live database: the comms RPCs, under the service role. Errors name the RPC and code only. */
export const liveDigestDb: DigestDb = {
	async claim(limit) {
		const { data, error } = await commsDb().rpc("fn_claim_digests", { p_limit: limit });
		if (error) throw new Error(`comms.fn_claim_digests failed (${error.code ?? "no code"})`);
		return (data ?? []) as unknown[];
	},
	async record(digestId, sent, providerRef, error) {
		const { error: failure } = await commsDb().rpc("fn_record_digest_result", {
			p_digest: digestId,
			p_ok: sent,
			p_provider_ref: providerRef,
			p_error: error,
		});
		if (failure) {
			throw new Error(`comms.fn_record_digest_result failed (${failure.code ?? "no code"})`);
		}
	},
};

function liveDeps(): DigestDeps {
	return {
		live: isAuthBackendLive(),
		db: liveDigestDb,
		mail: () => configuredTransport(),
		appUrl: serverEnv().appUrl,
		signUnsubscribe: (userId) => signUnsubscribeToken(userId),
	};
}
// #endregion

// #region Message
/** How a category is named in the mail. */
const CATEGORY_LABEL: Readonly<Record<NotificationCategory, string>> = {
	money: "Money",
	work: "Work",
	messages: "Messages",
	schedule: "Schedule",
	discovery: "Discovery",
	account: "Account",
	system: "Notices",
	marketing: "News from Projective",
};

/**
 * The mail for one leased digest: a count by category in the catalog's order, then each listed
 * notice's title and absolute link, a line for any not listed, and the inbox and email-settings
 * links. `unsubscribe` is the one-click URL, owed only when a Marketing notice is listed.
 */
export function buildDigestEmail(
	digest: Pick<ClaimedDigestRow, "digest_id" | "period" | "total" | "counts" | "items">,
	address: string,
	appUrl: string,
	unsubscribe: string | null,
): MailMessage {
	const origin = new URL(appUrl).origin;
	const total = digest.total ?? 0;
	const updates = `${total} update${total === 1 ? "" : "s"}`;
	const items = digest.items ?? [];
	const counts = NotificationCategory.options
		.filter((category) => (digest.counts?.[category] ?? 0) > 0)
		.map((category) => `${CATEGORY_LABEL[category]}: ${digest.counts?.[category]}`);

	const lines = [`Your ${digest.period} Projective digest: ${updates}.`, "", ...counts, ""];
	for (const item of items) lines.push(`- ${item.title}`, `  ${deepLink(item.action_url, appUrl)}`);
	if (total > items.length) lines.push(`…and ${total - items.length} more in your inbox.`);
	lines.push(
		"",
		`Open your inbox: ${new URL(INBOX_PATH, origin).href}`,
		"",
		`Choose which emails you get: ${new URL(PREFERENCES_PATH, origin).href}`,
	);
	if (unsubscribe) lines.push(`Unsubscribe from marketing email: ${unsubscribe}`);

	return {
		to: address,
		subject: `Your ${digest.period} digest: ${updates} on Projective`,
		text: lines.join("\n"),
		idempotencyKey: digest.digest_id,
		...(unsubscribe
			? {
				headers: {
					"List-Unsubscribe": `<${unsubscribe}>`,
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				},
			}
			: {}),
	};
}
// #endregion

// #region Service
/** The most digests one pass claims, and the job's default. */
export const MAX_DIGEST_LIMIT = 500;
export const DEFAULT_DIGEST_LIMIT = 50;

const EMPTY_TALLY: DispatchTally = { claimed: 0, sent: 0, failed: 0, skipped: 0, suppressed: 0 };
const NOT_LIVE = "Digest email isn't connected in this environment.";
const UNREACHABLE = "Digests couldn't be sent just now. The next run will retry.";

/** A throw, as a digest row may record it: its message cut short. A transport never puts an address in one. */
const errorCode = (error: unknown) =>
	(error instanceof Error ? error.message : "send_failed").slice(0, 200) || "send_failed";

export class DigestMailService {
	/**
	 * One pass: lease up to `limit` due digests, mail each, record each outcome. With no mail
	 * transport configured nothing is claimed, so digests wait (a day at most). Answers counts by
	 * outcome; a hard-bounced address counts as suppressed, every other closed digest as skipped.
	 */
	static async send(
		limit: number = DEFAULT_DIGEST_LIMIT,
		deps: DigestDeps = liveDeps(),
	): Promise<ServiceResult<DispatchTally>> {
		if (!deps.live) return fail(503, { message: NOT_LIVE });
		const mail = deps.mail();
		if (!mail) return ok({ ...EMPTY_TALLY });

		const bounded = Math.min(
			Math.max(Math.trunc(limit) || DEFAULT_DIGEST_LIMIT, 1),
			MAX_DIGEST_LIMIT,
		);
		let rows: unknown[];
		try {
			rows = await deps.db.claim(bounded);
		} catch (error) {
			console.error("[comms:digests]", errorCode(error));
			return fail(503, { message: UNREACHABLE });
		}

		const tally: DispatchTally = { ...EMPTY_TALLY, claimed: rows.length };
		const outcomes = await inChunks(rows, async (raw) => {
			const parsed = ClaimedDigestRowSchema.safeParse(raw);
			if (!parsed.success) {
				const id = (raw as { digest_id?: unknown } | null)?.digest_id;
				if (typeof id === "string") {
					await DigestMailService.#record(deps, id, false, null, "unreadable_claim");
				}
				return "failed" as const;
			}
			const digest = parsed.data;
			if (digest.status === "failed") return "failed" as const;
			if (digest.status === "skipped") {
				return digest.reason === "suppressed_destination"
					? "suppressed" as const
					: "skipped" as const;
			}
			if (!digest.address) {
				await DigestMailService.#record(deps, digest.digest_id, false, null, "no_address");
				return "failed" as const;
			}

			let unsubscribe: string | null = null;
			if (digest.marketing) {
				const token = await deps.signUnsubscribe(digest.user_id);
				if (!token) {
					await DigestMailService.#record(
						deps,
						digest.digest_id,
						false,
						null,
						"no_unsubscribe_link",
					);
					return "failed" as const;
				}
				unsubscribe = unsubscribeUrl(token, deps.appUrl);
			}

			try {
				const receipt = await mail.send(
					buildDigestEmail(digest, digest.address, deps.appUrl, unsubscribe),
				);
				await DigestMailService.#record(deps, digest.digest_id, true, receipt?.id ?? null, null);
				return "sent" as const;
			} catch (error) {
				await DigestMailService.#record(deps, digest.digest_id, false, null, errorCode(error));
				return "failed" as const;
			}
		});

		for (const outcome of outcomes) tally[outcome] += 1;
		return ok(tally);
	}

	/**
	 * Record an outcome. A failed write leaves the digest leased, and the claim offers it again when
	 * the 15-minute lease lapses (Resend's Idempotency-Key keeps a resend one message), so it is
	 * logged (the id and code only) rather than thrown.
	 */
	static async #record(
		deps: DigestDeps,
		digestId: string,
		sent: boolean,
		providerRef: string | null,
		error: string | null,
	): Promise<void> {
		try {
			await deps.db.record(digestId, sent, providerRef, error);
		} catch (failure) {
			console.error("[comms:digests]", digestId, errorCode(failure));
		}
	}
}
// #endregion
