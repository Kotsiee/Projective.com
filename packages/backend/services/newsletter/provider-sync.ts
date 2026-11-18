import {
	NEWSLETTER_TOPICS,
	type NewsletterProviderConfig,
	NewsletterProviderConfigSchema,
	type NewsletterSyncBatch,
	NewsletterSyncBatchSchema,
	type NewsletterSyncRecordAction,
	NewsletterSyncRecordOutcome,
	type NewsletterSyncReport,
	type NewsletterSyncRow,
	type NewsletterTopic,
} from "@projective/types/community";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, isNewsletterBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { communityRpc } from "../community/community-source.ts";
import {
	type ContactCall,
	type ContactsClient,
	pacedContacts,
	resendContacts,
	type TopicSubscription,
} from "./resend-contacts.ts";

/**
 * NewsletterProviderSync — keeps the mail provider's copy of the newsletter list in step with
 * Postgres, the record (Decision #480 Q1 A, CD1 step 5; PRD-E11).
 *
 * The `newsletter-provider-sync` http job posts to `/api/newsletter/cron/sync` every 5 minutes with
 * the dispatcher's own bearer, `COMMS_DISPATCH_SECRET` (one Vault entry for outbound mail). One pass
 * reads `community.newsletter_sync_batch`: the send-eligible rows the provider has not received, and
 * the ineligible rows it still holds a contact for. For the first it creates the contact (subscribed,
 * in the segment, every topic set) or, for a known one, sets the segment and the topics, lifting the
 * contact's own provider-side opt-out only when the row was confirmed since; for the second it
 * deletes the contact. Each call's result is stamped with `community.record_newsletter_sync` against
 * the version the batch read, so a change made meanwhile goes out on the next pass.
 *
 * The address and its topics are the only data sent. The pass never puts anyone on the provider's
 * list who has not confirmed through Projective, and never re-subscribes a contact the provider shows
 * as unsubscribed unless its owner has just confirmed again.
 *
 * It does nothing while `NEWSLETTER_BACKEND_LIVE` is off (`stub`), while `RESEND_API_KEY` is not a
 * `re_…` key or the segment or a topic id is unset (`unconfigured`), or while the
 * `newsletter.provider_sync` flag is off (`off`). A 429 or a provider outage ends the pass early, to
 * be resumed by the next one. A refusal is recorded (so the row is not retried until it changes) only
 * in a pass where the provider accepted another address: a pass where every call was refused is a
 * configuration error, not an address the provider will not take. Logs carry counts and status codes,
 * never an address.
 */

// #region Limits
/** Rows one pass reads by default (the job's `?limit=`). */
export const DEFAULT_SYNC_LIMIT = 50;
/** The most rows one pass may read. */
export const MAX_SYNC_LIMIT = 200;
/** How long one pass may run; the scheduler's http call waits 120 seconds. */
export const SYNC_BUDGET_MS = 60_000;
/** The least time between two provider calls: 5 a second, half Resend's team-wide limit. */
export const SYNC_CALL_GAP_MS = 200;
// #endregion

// #region Seams
/** A database call the pass makes; injectable so tests run without Postgres. */
export type SyncRpc = (
	args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Everything one pass reads from its surroundings. */
export interface ProviderSyncDeps {
	/** `NEWSLETTER_BACKEND_LIVE` (and the service role configured). */
	live: boolean;
	/** `RESEND_API_KEY`. */
	apiKey: string | undefined;
	/** `community.newsletter_sync_batch`. */
	batch: SyncRpc;
	/** `community.record_newsletter_sync`. */
	record: SyncRpc;
	/** The contacts client for a key (paced in production). */
	contacts: (apiKey: string) => ContactsClient;
	/** The pass's time budget. */
	budgetMs: number;
	now: () => number;
	/** Where the pass's one summary line, and any error code, are written. */
	log: (line: string) => void;
}

const liveDeps = (): ProviderSyncDeps => ({
	live: isNewsletterBackendLive(),
	apiKey: serverEnv().resendApiKey,
	batch: (args) => communityRpc(getServiceClient(), "newsletter_sync_batch", args),
	record: (args) => communityRpc(getServiceClient(), "record_newsletter_sync", args),
	contacts: (apiKey) => pacedContacts(resendContacts(apiKey), SYNC_CALL_GAP_MS),
	budgetMs: SYNC_BUDGET_MS,
	now: Date.now,
	log: (line) => console.info(line),
});
// #endregion

// #region One row
/** Every topic's subscription for a row: opted in to what it holds, out of the rest. */
export function topicSubscriptions(
	config: NewsletterProviderConfig,
	topics: readonly NewsletterTopic[],
): TopicSubscription[] {
	return NEWSLETTER_TOPICS.map((topic) => ({
		id: config.topicIds[topic],
		subscription: topics.includes(topic) ? "opt_in" : "opt_out",
	}));
}

/** What one row came to with the provider. */
type RowResult =
	| { kind: "upserted"; id: string }
	| { kind: "removed" }
	| { kind: "refused"; status: number }
	| { kind: "stop"; why: "rate_limited" | "unavailable" }
	| { kind: "retry"; status: number };

/** A failed call as a row result: stop the pass, or this row only. */
function failed(call: Extract<ContactCall, { ok: false }>): RowResult {
	if (call.kind === "rate_limited" || call.kind === "unavailable") {
		return { kind: "stop", why: call.kind };
	}
	return { kind: "refused", status: call.status };
}

/** Create the row's contact, or find the one the provider already holds for the address. */
async function createOrFind(
	client: ContactsClient,
	config: NewsletterProviderConfig,
	row: NewsletterSyncRow,
	topics: TopicSubscription[],
): Promise<RowResult | { kind: "found"; id: string }> {
	const created = await client.create(row.email, config.segmentId, topics);
	if (created.ok && created.id) return { kind: "upserted", id: created.id };
	if (!created.ok && (created.kind === "rate_limited" || created.kind === "unavailable")) {
		return failed(created);
	}
	// It exists already (a 409, or a refusal that may mean the same), or the create answered no id.
	const found = await client.find(row.email);
	if (found.ok && found.id) return { kind: "found", id: found.id };
	if (!found.ok && (found.kind === "rate_limited" || found.kind === "unavailable")) {
		return failed(found);
	}
	return { kind: "refused", status: created.ok ? 200 : created.status };
}

/** Bring the provider's contact for an eligible row to this version. */
export async function upsertRow(
	client: ContactsClient,
	config: NewsletterProviderConfig,
	row: NewsletterSyncRow,
): Promise<RowResult> {
	const topics = topicSubscriptions(config, row.topics);
	let id = row.contact_ref;
	let reconfirmed = row.reconfirmed;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (!id) {
			const made = await createOrFind(client, config, row, topics);
			if (made.kind !== "found") return made;
			id = made.id;
		}
		let vanished = false;
		const steps: Array<() => Promise<ContactCall>> = [
			...(reconfirmed ? [() => client.resubscribe(id!)] : []),
			() => client.addToSegment(id!, config.segmentId),
			() => client.setTopics(id!, topics),
		];
		for (const step of steps) {
			const call = await step();
			if (call.ok) continue;
			if (call.kind === "not_found" && attempt === 0) {
				vanished = true;
				break;
			}
			return failed(call);
		}
		if (!vanished) return { kind: "upserted", id };
		// The known contact was deleted at the provider and its event has not reached us yet: start
		// again from a create. A fresh contact is created subscribed, so there is nothing to lift.
		id = null;
		reconfirmed = false;
	}
	return { kind: "retry", status: 404 };
}

/** Delete the provider's contact for an ineligible row. */
export async function removeRow(
	client: ContactsClient,
	row: NewsletterSyncRow,
): Promise<RowResult> {
	if (!row.contact_ref) return { kind: "removed" };
	const call = await client.remove(row.contact_ref);
	if (call.ok) return { kind: "removed" };
	const result = failed(call);
	// A delete the provider refuses is not the address's fault: try it again next pass.
	return result.kind === "refused" ? { kind: "retry", status: result.status } : result;
}
// #endregion

// #region Pass
/** An empty report, `skipped` for the reason given. */
function report(skipped: NewsletterSyncReport["skipped"] = null): NewsletterSyncReport {
	return { skipped, read: 0, upserted: 0, removed: 0, refused: 0, failed: 0, stopped: null };
}

export class NewsletterProviderSync {
	/** Whether `authorization` carries the dispatcher's bearer (constant time; ≥ 32 characters). */
	static isAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().commsDispatchSecret);
	}

	/** One pass over at most `limit` rows (see the module doc). Answers counts, never an address. */
	static async run(
		limit: number = DEFAULT_SYNC_LIMIT,
		overrides: Partial<ProviderSyncDeps> = {},
	): Promise<ServiceResult<NewsletterSyncReport>> {
		const d = { ...liveDeps(), ...overrides };
		const bounded = Math.min(Math.max(Math.trunc(limit) || DEFAULT_SYNC_LIMIT, 1), MAX_SYNC_LIMIT);

		if (!d.live) return ok(report("stub"));
		const apiKey = d.apiKey?.trim();
		if (!apiKey?.startsWith("re_")) return ok(report("unconfigured"));

		const { data, error } = await d.batch({ p_limit: bounded });
		if (error) {
			d.log(`[newsletter:sync] the batch read failed (${error.code ?? "no code"})`);
			return fail(503, { message: "The newsletter list couldn't be read just now." });
		}
		const parsed = NewsletterSyncBatchSchema.safeParse(data);
		if (!parsed.success) {
			return fail(502, { message: "The newsletter list answered an unknown shape." });
		}
		const batch: NewsletterSyncBatch = parsed.data;
		if (!batch.enabled) return ok(report("off"));
		const config = NewsletterProviderConfigSchema.safeParse({
			segmentId: batch.segment_id,
			topicIds: batch.topic_ids,
		});
		if (!config.success) return ok(report("unconfigured"));

		const out = report();
		out.read = batch.rows.length;
		const client = d.contacts(apiKey);
		const deadline = d.now() + d.budgetMs;
		const held: NewsletterSyncRow[] = [];
		let accepted = false;

		const stamp = async (
			row: NewsletterSyncRow,
			action: NewsletterSyncRecordAction,
			ref?: string,
		) => {
			const { data: answer, error: recordError } = await d.record({
				p_id: row.id,
				p_version: row.version,
				p_action: action,
				p_contact_ref: ref ?? null,
				p_topics: action === "upserted" ? row.topics : null,
			});
			if (recordError || !NewsletterSyncRecordOutcome.safeParse(answer).success) {
				out.failed++;
				d.log(`[newsletter:sync] a record failed (${recordError?.code ?? "unknown answer"})`);
				return false;
			}
			return true;
		};

		for (const row of batch.rows) {
			if (d.now() > deadline) {
				out.stopped = "budget";
				break;
			}
			const result = row.action === "upsert"
				? await upsertRow(client, config.data, row)
				: await removeRow(client, row);
			if (result.kind === "stop") {
				out.stopped = result.why;
				break;
			}
			if (result.kind === "upserted") {
				accepted = true;
				if (await stamp(row, "upserted", result.id)) out.upserted++;
			} else if (result.kind === "removed") {
				accepted = true;
				if (await stamp(row, "removed", row.contact_ref ?? undefined)) out.removed++;
			} else if (result.kind === "refused") {
				held.push(row);
				d.log(`[newsletter:sync] the provider refused a contact call (${result.status})`);
			} else {
				out.failed++;
				d.log(`[newsletter:sync] a contact call will be retried (${result.status})`);
			}
		}

		// Refusals count against an address only when the provider took another one in this pass.
		if (accepted) {
			for (const row of held) if (await stamp(row, "refused")) out.refused++;
		} else {
			out.failed += held.length;
		}

		d.log(
			`[newsletter:sync] read=${out.read} upserted=${out.upserted} removed=${out.removed} ` +
				`refused=${out.refused} failed=${out.failed} stopped=${out.stopped ?? "no"}`,
		);
		return ok(out);
	}
}
// #endregion
