import {
	type AlertClaim,
	AlertClaimSchema,
	type AlertSample,
	type AlertsRead,
	AlertsReadSchema,
	type AlertSweepTally,
	type ClaimedAlert,
	ClaimedAlertSchema,
} from "@projective/types/ops";
import { serverEnv } from "../../core/env.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import {
	getServiceClient,
	getUserClient,
	isSupabaseConfigured,
	useMocks,
} from "../../core/supabase.ts";
import { configuredTransport, type MailMessage, type MailTransport } from "../mail/transport.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * OpsAlertService — money, job and webhook alerts reach a person (MR4, Decision #461; OPS5). The
 * `ops-deliver-alerts` job (every 5 minutes) calls {@link OpsAlertService.deliver} through
 * `POST /api/ops/cron/alerts`: the database groups every new row a rule matches (a money error, a
 * scheduler failure or skip, a stale job, a webhook burst, a drill) into one alert per scope and
 * fingerprint per dedupe window, raises the dead-man switch for a silent nightly check and leases what
 * is due (`ops.fn_claim_alerts`); this sends each alert on its channel and records the outcome
 * (`ops.fn_record_alert_delivery`). Three channels that fail apart: an incoming webhook
 * (Slack-compatible JSON) per alert and one email digest per sweep through the Resend transport
 * (#461 (A)), and an in-app notice to every operator (`ops.fn_deliver_alert_in_app`, OPS5). A failed or
 * unconfigured channel leaves its alerts pending, the database backs the retry off, and the other
 * channels still send.
 *
 * What leaves carries figures, short ids, codes and a link to `/admin/ledger`, never a name, an email
 * or a bank detail: the database keeps only those in a delivery's sample, and {@link safeSample}
 * checks again here (MR4 step 5, #461 flag (d)).
 */

// #region Ports
/** The definer doors the sweep drives. */
export interface AlertDb {
	claim(limit: number): Promise<unknown>;
	record(deliveryId: string, ok: boolean, error: string | null): Promise<void>;
	/**
	 * Send one in-app alert to every operator and record it, in one step
	 * (`ops.fn_deliver_alert_in_app`). `sent: false` when there was no operator to tell (the database has
	 * already recorded that failure).
	 */
	deliverInApp(deliveryId: string, title: string, body: string): Promise<{ sent: boolean }>;
}

/** Where a webhook alert is posted. Throws (naming a status or `timeout`) when it was not accepted. */
export interface WebhookPort {
	post(body: { text: string }): Promise<void>;
}

/** Everything a sweep reads from its surroundings, injectable for tests. */
export interface AlertDeps {
	/** A live database is configured (not `USE_MOCKS`). */
	live: boolean;
	db: AlertDb;
	/** `null` while `OPS_ALERT_WEBHOOK_URL` is not a usable URL. */
	webhook: WebhookPort | null;
	/** `null` while `OPS_ALERT_EMAIL` is unset or no mail transport is configured. */
	mail: { transport: MailTransport; to: string } | null;
	/** The origin the `/admin/ledger` link points at. */
	appUrl: string;
}

const SEND_TIMEOUT_MS = 10_000;

function opsDb() {
	return getServiceClient().schema("ops");
}

/** The live doors, as the service role. */
export const liveAlertDb: AlertDb = {
	async claim(limit) {
		const { data, error } = await opsDb().rpc("fn_claim_alerts", { p_limit: limit });
		if (error) throw new Error(`ops.fn_claim_alerts failed (${error.code ?? "no code"})`);
		return data;
	},
	async record(deliveryId, sent, err) {
		const { error } = await opsDb().rpc("fn_record_alert_delivery", {
			p_delivery: deliveryId,
			p_ok: sent,
			p_error: err,
		});
		if (error) throw new Error(`ops.fn_record_alert_delivery failed (${error.code ?? "no code"})`);
	},
	async deliverInApp(deliveryId, title, body) {
		const { data, error } = await opsDb().rpc("fn_deliver_alert_in_app", {
			p_delivery: deliveryId,
			p_title: title,
			p_body: body,
		});
		if (error) throw new Error(`ops.fn_deliver_alert_in_app failed (${error.code ?? "no code"})`);
		return { sent: (data as { status?: string } | null)?.status === "sent" };
	},
};

/**
 * The webhook at `url`, or `null` when it is not one this environment may post to: `https://`, or in
 * development an `http://localhost` / `127.0.0.1` receiver. The `XXXX-XXXX` placeholder is not a URL.
 */
export function webhookPort(
	url: string | undefined,
	appEnv: string,
	send: typeof fetch = fetch,
): WebhookPort | null {
	let parsed: URL;
	try {
		parsed = new URL(url ?? "");
	} catch {
		return null;
	}
	const local = parsed.protocol === "http:" &&
		(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
	if (parsed.protocol !== "https:" && !(local && appEnv !== "production")) return null;
	return {
		async post(body) {
			const res = await send(parsed.href, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			});
			await res.body?.cancel();
			if (!res.ok) throw new Error(`webhook answered ${res.status}`);
		},
	};
}

function liveDeps(): AlertDeps {
	const env = serverEnv();
	const transport = configuredTransport();
	const to = env.opsAlertEmail?.trim() ?? "";
	return {
		live: isSupabaseConfigured() && !useMocks(),
		db: liveAlertDb,
		webhook: webhookPort(env.opsAlertWebhookUrl, env.appEnv),
		mail: transport && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) ? { transport, to } : null,
		appUrl: env.appUrl,
	};
}
// #endregion

// #region Mapping and the payload
interface RawClaimed {
	id: string;
	channel: string;
	scope: string;
	fingerprint: string;
	level: string;
	count: number;
	first_seen: string;
	last_seen: string;
	attempts: number;
	sample: Record<string, unknown> | null;
}

/** A code the payload may carry: a currency, a job name, a reason. Never an address. */
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** An id as the database cuts it for a payload: its first 8 hex characters. */
const SHORT_ID = /^[0-9a-f]{8}$/i;

/** The only keys whose string values are vocabulary rather than content (`ops.fn_alert_sample`). */
const LABEL_KEYS = new Set([
	"currency",
	"job",
	"provider",
	"reason",
	"kind",
	"problem",
	"owner_type",
	"status",
	"outcome",
]);

/**
 * Keep only what a payload may carry of a sample, as `ops.fn_alert_sample` does: finite numbers, a
 * short id, and a code under one of the vocabulary keys. Anything else (a sentence, an address, an
 * IBAN, an object) is dropped, so even a sample the database should never have written cannot leave
 * as text. Pure.
 */
export function safeSample(sample: Record<string, unknown> | null | undefined): AlertSample {
	const out: AlertSample = {};
	for (const [key, value] of Object.entries(sample ?? {})) {
		if (!CODE.test(key)) continue;
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
		else if (typeof value === "string" && SHORT_ID.test(value)) out[key] = value;
		else if (typeof value === "string" && LABEL_KEYS.has(key) && CODE.test(value)) out[key] = value;
	}
	return out;
}

/** `ops.fn_claim_alerts`' jsonb onto {@link AlertClaim}; an alert that does not parse is dropped. Pure. */
export function toAlertClaim(raw: unknown): AlertClaim {
	const r = (raw ?? {}) as {
		folded?: number;
		opened?: number;
		silent?: number;
		deliveries?: RawClaimed[];
	};
	const deliveries: ClaimedAlert[] = [];
	for (const d of r.deliveries ?? []) {
		const parsed = ClaimedAlertSchema.safeParse({
			id: d.id,
			channel: d.channel,
			scope: d.scope,
			fingerprint: CODE.test(d.fingerprint ?? "") ? d.fingerprint : "",
			level: d.level,
			count: d.count,
			firstSeen: d.first_seen,
			lastSeen: d.last_seen,
			attempts: d.attempts,
			sample: safeSample(d.sample),
		});
		if (parsed.success) deliveries.push(parsed.data);
	}
	return AlertClaimSchema.parse({
		folded: r.folded ?? 0,
		opened: r.opened ?? 0,
		silent: r.silent ?? 0,
		deliveries,
	});
}

function utc(at: string): string {
	const d = new Date(at);
	return Number.isNaN(d.getTime()) ? at : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * One alert as text: what, how bad, how often, when, its figures and the link. A dead-man alert says
 * which check has gone silent and for how long. Plain text, so a webhook shows it as written and the
 * digest needs no markup. Pure.
 */
export function alertText(alert: ClaimedAlert, appUrl: string): string {
	const link = `${appUrl.replace(/\/$/, "")}/admin/ledger`;
	if (alert.fingerprint === "silence") {
		const minutes = typeof alert.sample.silent_minutes === "number"
			? alert.sample.silent_minutes
			: null;
		const hours = minutes === null ? "over a day" : `${Math.floor(minutes / 60)} hours`;
		return [
			`[Projective] ${alert.scope} has written nothing for ${hours}: the check that writes it may not be running.`,
			`Dead-man switch · since ${utc(alert.firstSeen)}`,
			link,
		].join("\n");
	}
	const figures = Object.entries(alert.sample)
		.map(([key, value]) =>
			`${key} ${typeof value === "number" ? value.toLocaleString("en-GB") : value}`
		)
		.join(" · ");
	return [
		`[Projective] ${alert.scope} · ${alert.level} · ${alert.count} ${
			alert.count === 1 ? "row" : "rows"
		}`,
		`${alert.fingerprint ? `Group ${alert.fingerprint} · ` : ""}first ${
			utc(alert.firstSeen)
		} · last ${utc(alert.lastSeen)}`,
		...(figures ? [figures] : []),
		link,
	].join("\n");
}

/**
 * One alert as an operator's in-app notice: the first line of {@link alertText} as the title, the rest
 * as the body. The notice itself links to `/admin/ledger`, so the body leaves the link out. Pure.
 */
export function alertNotice(alert: ClaimedAlert, appUrl: string): { title: string; body: string } {
	const link = `${appUrl.replace(/\/$/, "")}/admin/ledger`;
	const [title, ...rest] = alertText(alert, appUrl).split("\n");
	return {
		title: title.replace(/^\[Projective\] /, ""),
		body: rest.filter((line) => line !== link).join("\n") || title,
	};
}

/** The sweep's email: every email alert it leased, in one message. Pure. */
export function digestMessage(
	alerts: readonly ClaimedAlert[],
	appUrl: string,
	to: string,
): MailMessage {
	return {
		to,
		subject: `Projective alerts: ${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"}`,
		text: [
			"These money, job and webhook checks need a look. Nothing was corrected automatically.",
			"",
			...alerts.map((a) => alertText(a, appUrl)).join("\n\n").split("\n"),
		].join("\n"),
	};
}

/** A failure's code for the record: a status, `timeout` or `error`. Never a body. */
export function failureCode(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (
		error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
	) {
		return "timeout";
	}
	const status = message.match(/\b([1-5]\d\d)\b/);
	return status ? status[1] : "error";
}
// #endregion

// #region The sweep
const NOT_LIVE = "Alerts need the live database.";
const UNREACHABLE = "Alerts couldn't be claimed just now. The next sweep will retry.";

/** The most alerts one sweep leases. */
export const MAX_ALERT_LIMIT = 500;
export const DEFAULT_ALERT_LIMIT = 50;

/**
 * One sweep: claim, send each alert on its channel, record every outcome. A channel that is not
 * configured records `not_configured`, so its alerts wait with backoff until it is. A record that fails
 * is logged and left to the lease, which lapses after 5 minutes and claims it again. Never throws.
 */
export async function deliverAlerts(
	limit: number,
	deps: AlertDeps = liveDeps(),
): Promise<ServiceResult<AlertSweepTally>> {
	if (!deps.live) return fail(503, { message: NOT_LIVE });
	let claim: AlertClaim;
	try {
		claim = toAlertClaim(
			await deps.db.claim(Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_ALERT_LIMIT)),
		);
	} catch (error) {
		console.error("[ops:alerts]", error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE });
	}
	const tally: AlertSweepTally = {
		folded: claim.folded,
		opened: claim.opened,
		silent: claim.silent,
		claimed: claim.deliveries.length,
		sent: 0,
		failed: 0,
	};
	const record = async (alert: ClaimedAlert, sent: boolean, error: string | null) => {
		if (sent) tally.sent += 1;
		else tally.failed += 1;
		try {
			await deps.db.record(alert.id, sent, error);
		} catch (err) {
			console.error("[ops:alerts]", err instanceof Error ? err.message : err);
		}
	};

	for (const alert of claim.deliveries.filter((a) => a.channel === "webhook")) {
		if (!deps.webhook) {
			await record(alert, false, "not_configured");
			continue;
		}
		try {
			await deps.webhook.post({ text: alertText(alert, deps.appUrl) });
			await record(alert, true, null);
		} catch (error) {
			await record(alert, false, failureCode(error));
		}
	}

	const emails = claim.deliveries.filter((a) => a.channel === "email");
	if (emails.length > 0) {
		let outcome: { sent: boolean; error: string | null };
		if (!deps.mail) {
			outcome = { sent: false, error: "not_configured" };
		} else {
			try {
				await deps.mail.transport.send(digestMessage(emails, deps.appUrl, deps.mail.to));
				outcome = { sent: true, error: null };
			} catch (error) {
				outcome = { sent: false, error: failureCode(error) };
			}
		}
		for (const alert of emails) await record(alert, outcome.sent, outcome.error);
	}

	// The in-app door records its own send in the same transaction as the notices; only a door that
	// could not run is recorded here, so it backs off like any other failed send.
	for (const alert of claim.deliveries.filter((a) => a.channel === "in_app")) {
		const notice = alertNotice(alert, deps.appUrl);
		try {
			const outcome = await deps.db.deliverInApp(alert.id, notice.title, notice.body);
			if (outcome.sent) tally.sent += 1;
			else tally.failed += 1;
		} catch (error) {
			console.error("[ops:alerts]", error instanceof Error ? error.message : error);
			await record(alert, false, failureCode(error));
		}
	}
	return ok(tally);
}
// #endregion

// #region The operator read
interface RawRead {
	as_of: string;
	pending: number;
	rules:
		| Array<{
			kind: string;
			scope: string;
			min_level: string | null;
			max_silence_minutes: number | null;
			channel: string;
			dedupe_window_minutes: number;
			enabled: boolean;
		}>
		| null;
	silence: Array<{ scope: string; last_row_at: string | null }> | null;
	deliveries:
		| Array<{
			id: string;
			channel: string;
			scope: string;
			fingerprint: string;
			level: string;
			count: number;
			first_seen: string;
			last_seen: string;
			status: string;
			attempts: number;
			next_attempt_at: string;
			sent_at: string | null;
			last_error: string | null;
		}>
		| null;
}

/** `ops.read_alert_deliveries()`' jsonb onto {@link AlertsRead}. Pure; pinned by the tests. */
export function toAlertsRead(raw: RawRead | null): AlertsRead {
	return AlertsReadSchema.parse({
		asOf: raw?.as_of ?? new Date(0).toISOString(),
		pending: raw?.pending ?? 0,
		rules: (raw?.rules ?? []).map((r) => ({
			kind: r.kind,
			scope: r.scope,
			minLevel: r.min_level,
			maxSilenceMinutes: r.max_silence_minutes,
			channel: r.channel,
			dedupeWindowMinutes: r.dedupe_window_minutes,
			enabled: r.enabled,
		})),
		silence: (raw?.silence ?? []).map((s) => ({ scope: s.scope, lastRowAt: s.last_row_at })),
		deliveries: (raw?.deliveries ?? []).map((d) => ({
			id: d.id,
			channel: d.channel,
			scope: d.scope,
			fingerprint: d.fingerprint,
			level: d.level,
			count: d.count,
			firstSeen: d.first_seen,
			lastSeen: d.last_seen,
			status: d.status,
			attempts: d.attempts,
			nextAttemptAt: d.next_attempt_at,
			sentAt: d.sent_at,
			lastError: d.last_error,
		})),
	});
}

/**
 * The Alerts section's read for an operator. 403 for anyone else (the definer's 42501), 401 with no
 * session, 503 without the live database. Never throws into the route.
 */
export async function readAlerts(actor: ReadActor): Promise<ServiceResult<AlertsRead>> {
	if (!isSupabaseConfigured() || useMocks()) return fail(503, { message: NOT_LIVE });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	try {
		const { data, error } = await getUserClient(actor.accessToken).schema("ops").rpc(
			"read_alert_deliveries",
		);
		if (error) {
			if (error.code === "42501") return fail(403, { message: error.message });
			return fail(502, { message: "That couldn't be read just now. Please try again." });
		}
		return ok(toAlertsRead(data as RawRead | null));
	} catch (error) {
		console.error("[ops:alerts]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach the alerts just now. Try again in a moment." });
	}
}
// #endregion

/** The alert sweep's doors, as the cron route and `/admin/ledger` reach them. */
export const OpsAlertService = {
	/** Whether a request carries the sweep's bearer (`OPS_CRON_SECRET`), in constant time. */
	isCronAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().opsCronSecret);
	},
	deliver: (limit: number) => deliverAlerts(limit),
	read: (actor: ReadActor) => readAlerts(actor),
};
