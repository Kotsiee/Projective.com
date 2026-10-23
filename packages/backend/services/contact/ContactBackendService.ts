import {
	CONTACT_ATTACHMENT_MAX_FILES,
	type ContactAttachment,
	type ContactAttachmentDiscarded,
	type ContactAttachmentInit,
	ContactAttachmentInitSchema,
	type ContactAttachmentSweep,
	type ContactAttachmentTicket,
	type ContactEngagementOption,
	type ContactEngagementRef,
	type ContactIntent,
	type ContactReceipt,
	type ContactSubmission,
	ContactSubmissionSchema,
	intentTakesAttachments,
	isAnonymousSubmission,
	replyAddressOf,
} from "@projective/types/contact";
import type { ProjectFeedParams, ProjectSummary } from "@projective/types/projects";
import { fail, type FieldErrors, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient, isContactBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { type RateLimitRule, SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { ANONYMOUS_READER, canReadLive, type ReadActor } from "../read-actor.ts";
import { ProjectBackendService } from "../projects/ProjectBackendService.ts";
import { LogBackendService } from "../logging/LogBackendService.ts";
import {
	localReceipt,
	receiptFromRpc,
	receiptResult,
	submitRefusal,
	type SubmitRpcArgs,
	submitRpcArgs,
} from "./contact-rpc.ts";
import {
	completeContactUpload,
	discardContactUpload,
	initContactUpload,
	sweepContactUploads,
} from "./live-attachments.ts";

/**
 * ContactBackendService — the FAT `/contact` intake (Decision #276).
 *
 * It owns everything between a parsed request and a stored one: re-validating against the Zod SSOT
 * (the route validates too), the per-process rate limits, the honeypot, resolving a signed-in
 * dispute's engagement against the caller's OWN engagements, the attachment handshake, and the write
 * through `ops.submit_contact_request` — the one door into `ops.contact_requests`, which re-checks
 * every field and holds the durable ceilings. Thin routes call it; islands never reach it.
 *
 * **Who the write runs as.** A guest's request is written with the anon client, a signed-in sender's
 * with their own JWT, so the writer stamps `auth.uid()` itself and nothing here can claim an account.
 * An anonymous security report is ALWAYS written with the anon client, signed in or not: the writer
 * discards the identity anyway, but the reporter's token never reaches PostgREST or Postgres either,
 * which is what "nothing identifies you" promises — and a lapsed token cannot refuse it. Any other
 * request from a signed-in identity whose access token has lapsed is told to sign in again rather
 * than being silently filed as a guest.
 *
 * **Rate limits.** Per process, per caller address and per reply address — a first line against a
 * double press or a scripted burst. The durable ceilings (5 per address, 10 per account, 60 guest
 * requests and 30 anonymous reports platform-wide per hour, `CONTACT_DB_CEILINGS`) are the writer's,
 * so they hold when this layer is bypassed.
 *
 * **The honeypot** (`ctc_hp`). A filled one is answered with a receipt exactly like a real request's
 * and nothing is stored, so a script learns nothing from the response; the hit is logged (the
 * intent, never the body), so a real person caught by it is visible to operators.
 *
 * **Attachments that are never sent** are taken back by Remove ({@link ContactBackendService.discardAttachment})
 * and, for a form left with files on it, by the hourly sweep ({@link ContactBackendService.sweepAttachments}).
 *
 * **Masking.** Stored messages are NOT passed through `comms.mask_pii`: the only readers of
 * `ops.contact_requests` are operators (Decision #147 masks copies shown to non-operators, and there
 * are none today). A future surface that shows a request to anyone else masks its copy first.
 *
 * **The gate.** `CONTACT_BACKEND_LIVE` on: the writer and the attachment pipeline. Off: in
 * development every rule above still runs and a receipt is answered with nothing stored (attachments
 * are checked against their declaration and remembered in-process for the submission that cites
 * them); in production the intake answers 503, because acknowledging a request nobody will ever read
 * is worse than refusing it.
 */

// #region Limits
/** Requests per caller address (IP) per ten minutes. Generous: several people may share one address. */
export const CONTACT_IP_RULE: RateLimitRule = { max: 10, windowMs: 10 * 60_000 };
/** Requests per reply address per ten minutes. */
export const CONTACT_EMAIL_RULE: RateLimitRule = { max: 3, windowMs: 10 * 60_000 };
/** Attachment declarations per account per ten minutes (five files a request, a few retries). */
export const CONTACT_ATTACHMENT_RULE: RateLimitRule = { max: 20, windowMs: 10 * 60_000 };

const ipLimiter = new SlidingWindowLimiter(CONTACT_IP_RULE);
const emailLimiter = new SlidingWindowLimiter(CONTACT_EMAIL_RULE);
const attachmentLimiter = new SlidingWindowLimiter(CONTACT_ATTACHMENT_RULE);
// #endregion

// #region Seams
/** The writer call; injectable so tests run without a database. */
export type ContactSubmitRpc = (
	args: SubmitRpcArgs,
	actor: ReadActor,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

/** Overrides for {@link ContactBackendService} — tests pass them; the routes pass none. */
export interface ContactDeps {
	/** Force the live or the stub path instead of reading the gate. */
	live?: boolean;
	/** Force production behaviour of the stub path (`DENO_ENV`). */
	production?: boolean;
	/** The writer call; defaults to `ops.submit_contact_request` as the caller. */
	rpc?: ContactSubmitRpc;
	/** The signed-in reader's open engagements; defaults to the projects feed. */
	engagements?: (actor: ReadActor) => Promise<ContactEngagementOption[]>;
	/** Where a honeypot hit is recorded; defaults to the logging service. */
	logHoneypot?: (intent: ContactIntent) => Promise<void> | void;
	/** The limiters; default to the process-wide ones. */
	limiters?: {
		ip?: SlidingWindowLimiter;
		email?: SlidingWindowLimiter;
		attachments?: SlidingWindowLimiter;
	};
	now?: () => Date;
}

/** Request facts the route knows and the service cannot (never part of the body). */
export interface ContactRequestMeta {
	/** The caller's transport address, the per-IP limiter key. */
	clientKey: string;
}

const defaultRpc: ContactSubmitRpc = (args, actor) => {
	const client = canReadLive(actor) ? getUserClient(actor.accessToken) : getAnonClient();
	return client.schema("ops").rpc("submit_contact_request", args);
};

/** A honeypot hit, as one `warn` log entry: which intent, never what was sent. */
async function logHoneypotHit(intent: ContactIntent): Promise<void> {
	await LogBackendService.ingest({
		entries: [{
			id: crypto.randomUUID(),
			level: "warn",
			message: "contact: honeypot filled — answered with a receipt, nothing stored",
			at: Date.now(),
			source: "server",
			scope: "contact",
			data: { intent, honeypot: true },
		}],
		meta: { path: "/api/contact" },
	}, ANONYMOUS_READER).catch(() => {});
}

function isProduction(deps: ContactDeps): boolean {
	return deps.production ?? serverEnv().appEnv === "production";
}

const UNAVAILABLE = "Contact requests can't be sent from here right now. Please try again later.";
// #endregion

// #region Development stub memory
/**
 * The development stub's attachments: what each declaration said, for the submission that cites it.
 * In-process and bounded by age; the stub never runs in production.
 */
interface StubAttachment {
	owner: string;
	attachment: ContactAttachment;
	completed: boolean;
	at: number;
}
const STUB_TTL_MS = 60 * 60_000;
const stubAttachments = new Map<string, StubAttachment>();

function pruneStub(now: number): void {
	for (const [id, entry] of stubAttachments) {
		if (now - entry.at > STUB_TTL_MS) stubAttachments.delete(id);
	}
}
// #endregion

// #region Helpers
/** Zod issues → `{ field: first message }`, keyed by the first path segment (`attachmentIds.0` → `attachmentIds`). */
function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): FieldErrors {
	const out: FieldErrors = {};
	for (const issue of issues) {
		const key = String(issue.path[0] ?? "form");
		if (!(key in out)) out[key] = issue.message;
	}
	return out;
}

function rateLimited(retryAfterMs: number, now: Date): ServiceResult<never> {
	return fail(429, {
		message: "That's a lot of requests in a short time. Please wait a few minutes and try again.",
		details: { retryAt: new Date(now.getTime() + retryAfterMs).toISOString() },
	});
}

/** The two feed queries the dispute picker reads: open projects, then open client engagements. */
function openFeed(view: ProjectFeedParams["view"]): ProjectFeedParams {
	return {
		q: "",
		view,
		involvement: "all",
		sort: "recent",
		dir: "desc",
		scope: "global",
		scopeType: null,
		scopeId: "",
		workspaces: [],
		roles: [],
		formats: [],
		kinds: [],
		statuses: ["active", "on_hold"],
		quick: [],
		requests: [],
		serviceId: "",
	};
}

/** A feed row as a picker option (personal projects carry no money, so no dispute). */
export function engagementOption(row: ProjectSummary): ContactEngagementOption | null {
	if (row.personal) return null;
	if (row.status !== "active" && row.status !== "on_hold") return null;
	return {
		slug: row.slug,
		title: row.title,
		format: row.format,
		status: row.status,
		counterparty: row.counterparty?.name ?? null,
	};
}

/** The signed-in reader's open engagements, newest activity first, at most 50. */
async function feedEngagements(actor: ReadActor): Promise<ContactEngagementOption[]> {
	if (!actor.userId) return [];
	const [projects, engagements] = await Promise.all([
		ProjectBackendService.list(openFeed("projects"), actor),
		ProjectBackendService.list(openFeed("engagements"), actor),
	]);
	const rows = [...(projects.data?.items ?? []), ...(engagements.data?.items ?? [])]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const seen = new Set<string>();
	const out: ContactEngagementOption[] = [];
	for (const row of rows) {
		const option = engagementOption(row);
		if (!option || seen.has(option.slug)) continue;
		seen.add(option.slug);
		out.push(option);
		if (out.length >= 50) break;
	}
	return out;
}
// #endregion

export class ContactBackendService {
	/**
	 * The dispute intent's picker: a signed-in reader's open engagements (active or on hold, never a
	 * personal project). A guest has none and is asked to sign in.
	 */
	static async disputeEngagements(
		actor: ReadActor,
		deps: ContactDeps = {},
	): Promise<ContactEngagementOption[]> {
		if (!actor.userId) return [];
		try {
			return await (deps.engagements ?? feedEngagements)(actor);
		} catch (error) {
			console.warn(
				"[ContactBackendService.disputeEngagements]",
				error instanceof Error ? error.message : error,
			);
			return [];
		}
	}

	/**
	 * File a contact request. Answers a {@link ContactReceipt} (201) — the reference the sender quotes —
	 * or a refusal: 422 with field errors, 401 when attachments or an engagement need a session, 429
	 * on a rate limit, 503 when the intake is unavailable.
	 */
	static async submit(
		input: unknown,
		actor: ReadActor,
		meta: ContactRequestMeta,
		deps: ContactDeps = {},
	): Promise<ServiceResult<ContactReceipt>> {
		const now = (deps.now ?? (() => new Date()))();
		const parsed = ContactSubmissionSchema.safeParse(input);
		if (!parsed.success) {
			return fail(422, {
				message: "Check the highlighted fields.",
				errors: fieldErrors(parsed.error.issues),
			});
		}
		const submission: ContactSubmission = parsed.data;

		// #region Rate limits (per process)
		const ip = (deps.limiters?.ip ?? ipLimiter).take(meta.clientKey || "unknown", now.getTime());
		if (!ip.allowed) return rateLimited(ip.retryAfterMs, now);
		const address = replyAddressOf(submission);
		if (address) {
			const byEmail = (deps.limiters?.email ?? emailLimiter).take(address, now.getTime());
			if (!byEmail.allowed) return rateLimited(byEmail.retryAfterMs, now);
		}
		// #endregion

		if (submission.ctc_hp.trim() !== "") {
			await (deps.logHoneypot ?? logHoneypotHit)(submission.intent);
			return receiptResult(localReceipt(submission.intent, now));
		}

		// #region Session-bound parts
		const anonymous = isAnonymousSubmission(submission);
		const attachments = submission.intent === "sales" || anonymous ? [] : submission.attachmentIds;
		const wantsEngagement = submission.intent === "dispute" && submission.engagementSlug !== "";
		if ((attachments.length > 0 || wantsEngagement) && !actor.userId) {
			return fail(401, {
				message: "Sign in to attach files or name one of your engagements.",
				errors: attachments.length > 0 ? { attachmentIds: "Sign in to attach files." } : undefined,
			});
		}
		if (actor.userId && !canReadLive(actor) && !anonymous) {
			return fail(401, { message: "Your session expired. Sign in again to send this request." });
		}
		if (attachments.length > 0 && !intentTakesAttachments(submission.intent)) {
			return fail(422, {
				errors: { attachmentIds: "This kind of request doesn't take attachments." },
			});
		}

		let engagement: ContactEngagementRef | null = null;
		if (wantsEngagement && submission.intent === "dispute") {
			const mine = await ContactBackendService.disputeEngagements(actor, deps);
			const found = mine.find((e) => e.slug === submission.engagementSlug);
			if (!found) {
				return fail(422, {
					message: "Check the highlighted field.",
					errors: { engagementSlug: "Choose one of your open engagements." },
				});
			}
			engagement = { slug: found.slug, title: found.title, format: found.format };
		}
		// #endregion

		const live = deps.live ?? isContactBackendLive();
		if (!live) {
			if (isProduction(deps)) return fail(503, { message: UNAVAILABLE });
			pruneStub(now.getTime());
			for (const id of attachments) {
				const entry = stubAttachments.get(id);
				if (!entry || entry.owner !== actor.userId || !entry.completed) {
					return fail(422, {
						message: "Check the highlighted field.",
						errors: {
							attachmentIds:
								"One of the attachments can't be sent — remove it and attach it again.",
						},
					});
				}
			}
			for (const id of attachments) stubAttachments.delete(id);
			return receiptResult(localReceipt(submission.intent, now));
		}

		// An anonymous report is written as `anon` whoever sends it (see the class notes).
		const { data, error } = await (deps.rpc ?? defaultRpc)(
			submitRpcArgs(submission, engagement),
			anonymous ? ANONYMOUS_READER : actor,
		);
		if (error) return submitRefusal(error);
		const receipt = receiptFromRpc(data);
		if (!receipt) {
			return fail(502, { message: "We couldn't confirm your request. Please try again shortly." });
		}
		return receiptResult(receipt);
	}

	/**
	 * Step 1 of an attachment: declare it. Signed-in senders only (a file belongs to an account); the
	 * declaration is checked against the `contact` bucket's limits before a byte moves.
	 */
	static async initAttachment(
		input: unknown,
		actor: ReadActor,
		deps: ContactDeps = {},
	): Promise<ServiceResult<ContactAttachmentTicket>> {
		if (!actor.userId) return fail(401, { message: "Sign in to attach files." });
		if (!canReadLive(actor)) {
			return fail(401, { message: "Your session expired. Sign in again to attach files." });
		}
		const parsed = ContactAttachmentInitSchema.safeParse(input);
		if (!parsed.success) {
			return fail(422, {
				message: parsed.error.issues[0]?.message ?? "That file can't be attached.",
				errors: fieldErrors(parsed.error.issues),
			});
		}
		const now = (deps.now ?? (() => new Date()))();
		const taken = (deps.limiters?.attachments ?? attachmentLimiter).take(
			actor.userId,
			now.getTime(),
		);
		if (!taken.allowed) return rateLimited(taken.retryAfterMs, now);

		const init: ContactAttachmentInit = parsed.data;
		const live = deps.live ?? isContactBackendLive();
		if (!live) {
			if (isProduction(deps)) return fail(503, { message: UNAVAILABLE });
			pruneStub(now.getTime());
			const owned = [...stubAttachments.values()].filter((e) => e.owner === actor.userId).length;
			if (owned >= CONTACT_ATTACHMENT_MAX_FILES * 4) return rateLimited(60_000, now);
			const id = crypto.randomUUID();
			stubAttachments.set(id, {
				owner: actor.userId,
				attachment: { id, name: init.name, mimeType: init.mimeType, sizeBytes: init.sizeBytes },
				completed: false,
				at: now.getTime(),
			});
			return ok({
				attachmentId: id,
				signedUrl: null,
				headers: {},
				expiresAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
			}, { status: 201 });
		}
		return await initContactUpload({ userId: actor.userId, accessToken: actor.accessToken }, init);
	}

	/** Step 3 of an attachment: the bytes landed — inspect and admit them (or refuse them). */
	static async completeAttachment(
		attachmentId: string,
		actor: ReadActor,
		deps: ContactDeps = {},
	): Promise<ServiceResult<ContactAttachment>> {
		if (!actor.userId) return fail(401, { message: "Sign in to attach files." });
		if (!canReadLive(actor)) {
			return fail(401, { message: "Your session expired. Sign in again to attach files." });
		}
		const live = deps.live ?? isContactBackendLive();
		if (!live) {
			if (isProduction(deps)) return fail(503, { message: UNAVAILABLE });
			const entry = stubAttachments.get(attachmentId);
			if (!entry || entry.owner !== actor.userId) {
				return fail(404, { message: "That attachment could not be found. Attach the file again." });
			}
			entry.completed = true;
			return ok(entry.attachment, { message: "Attachment ready." });
		}
		return await completeContactUpload(
			{ userId: actor.userId, accessToken: actor.accessToken },
			attachmentId,
		);
	}

	/**
	 * Remove: take back an attachment that has not been sent — still uploading, or checked and ready.
	 * Its row is soft-deleted and its bytes deleted, so a file someone took back is not kept; one
	 * mid-check is refused for a moment (409), one already sent for good (404).
	 */
	static async discardAttachment(
		attachmentId: string,
		actor: ReadActor,
		deps: ContactDeps = {},
	): Promise<ServiceResult<ContactAttachmentDiscarded>> {
		if (!actor.userId) return fail(401, { message: "Sign in to remove an attachment." });
		if (!canReadLive(actor)) {
			return fail(401, { message: "Your session expired. Sign in again to remove this file." });
		}
		const live = deps.live ?? isContactBackendLive();
		if (!live) {
			if (isProduction(deps)) return fail(503, { message: UNAVAILABLE });
			const entry = stubAttachments.get(attachmentId);
			if (!entry || entry.owner !== actor.userId) {
				return fail(404, {
					message: "That attachment is already gone, or was sent with a request.",
				});
			}
			stubAttachments.delete(attachmentId);
			return ok({ id: attachmentId }, { message: "Attachment removed." });
		}
		return await discardContactUpload(
			{ userId: actor.userId, accessToken: actor.accessToken },
			attachmentId,
		);
	}

	/**
	 * The hourly `contact-attachment-sweep`: every contact upload older than six hours that no request
	 * links is soft-deleted and its bytes deleted, so a form closed with files on it leaves nothing
	 * behind. The development stub only forgets its own expired declarations.
	 */
	static async sweepAttachments(
		limit: number,
		deps: ContactDeps = {},
	): Promise<ServiceResult<ContactAttachmentSweep>> {
		const live = deps.live ?? isContactBackendLive();
		if (!live) {
			const before = stubAttachments.size;
			pruneStub((deps.now ?? (() => new Date()))().getTime());
			return ok({ claimed: before - stubAttachments.size, failed: 0 });
		}
		return await sweepContactUploads(Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000));
	}

	/** Whether a request carries the scheduler's bearer token (`CONTACT_CRON_SECRET`). */
	static isCronAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().contactCronSecret);
	}

	/** Forget the development stub's attachments (tests). */
	static resetStub(): void {
		stubAttachments.clear();
	}
}
