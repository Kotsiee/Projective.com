import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { getServiceClient, isIntegrationsBackendLive } from "../../core/supabase.ts";
import {
	type BusyChange,
	type BusyRead,
	CALENDAR_ADAPTERS,
	type CalendarAdapter,
	CalendarGone,
	CalendarRefusal,
	type MirrorEvent,
	type MirrorWrite,
	type SyncWindow,
} from "./calendar-adapters.ts";
import { openChannel } from "./channels.ts";
import {
	type ConnectionSweep,
	inChunks,
	IntegrationsBackendService,
	tally,
} from "./IntegrationsBackendService.ts";
import { randomToken } from "./oauth.ts";

/**
 * CalendarSyncBackendService — a connected calendar's two one-way flows (Decision #383, ruling R3), run
 * by two pg_cron `http` jobs. The calendar read and the calendar written never overlap, so there is no
 * echo to suppress and no conflict to resolve, and an edit made at a provider never moves a Projective
 * event.
 *
 * **Busy time in** ({@link CalendarSyncBackendService.syncDue}): a full read of the window, then
 * incremental reads on the provider's cursor. Spans land in `scheduling.events` as masked rows, which
 * `get_free_busy` and both booking gates already read, and only their owner can read what they say
 * (`connected_event_details`, Decision #387). A lapsed cursor (410) starts over from a
 * full read. A verified push only marks the calendar due, so no webhook ever calls a provider, and an
 * hourly read catches a push that never came.
 *
 * **Projective events out** ({@link CalendarSyncBackendService.pushDue}): triggers mark rows of
 * `scheduling.event_mirrors` dirty, and this writes or removes each copy on a separate Projective
 * calendar, made the first time a connection has something to put there. An agreed discovery call is
 * a row like any other: its claim says what its copy says, so nothing here tells the two apart.
 *
 * No token leaves this layer. What goes to `last_error` is a provider's status and nothing else.
 */

/**
 * How far a read looks ahead: past `call_settings.max_advance_days` at its longest (365), by the week
 * a read can be old. The day behind keeps something running now in view.
 */
const LOOK_AHEAD_DAYS = 372;
const LOOK_BEHIND_DAYS = 1;
const DAY_MS = 86_400_000;

const UNREACHABLE = "We couldn't reach the calendars just now. Try again in a moment.";
const NOT_LIVE = "Connections aren't live in this environment.";

// #region Claims
/** What `integrations.fn_claim_calendar_syncs` answers per row. */
interface SyncClaim {
	connection_id: string;
	provider_slug: string;
	resource: string;
	claimed_at: string;
	/** `null` means read the whole window. */
	cursor: string | null;
	has_channel: boolean;
}

/** What `scheduling.claim_event_mirrors` answers per row. */
interface MirrorClaim extends Omit<MirrorWrite, "event"> {
	connection_id: string;
	provider_slug: string;
	calendar_id: string | null;
	dirty_at: string;
	claimed_at: string;
	/** What the copy should say, or `null` when it should not exist. */
	event: MirrorEvent | null;
}

type Outcome = "done" | "failed";

const integrationsDb = () => getServiceClient().schema("integrations");
const schedulingDb = () => getServiceClient().schema("scheduling");

/** What a failure may say where its owner reads it. */
const detailOf = (error: unknown, fallback: string) =>
	error instanceof CalendarRefusal ? error.message : fallback;
// #endregion

// #region Busy time in
/** The window a full read covers, from `now`. */
export function syncWindow(now: number): SyncWindow {
	return {
		from: new Date(now - LOOK_BEHIND_DAYS * DAY_MS).toISOString(),
		to: new Date(now + LOOK_AHEAD_DAYS * DAY_MS).toISOString(),
	};
}

/** The last word on each event: a read can report one twice, and the door takes each id once. */
export function settle(changes: BusyChange[]): { busy: BusyChange[]; gone: string[] } {
	const busy: BusyChange[] = [];
	const gone: string[] = [];
	for (const change of new Map(changes.map((c) => [c.id, c])).values()) {
		if ("gone" in change) gone.push(change.id);
		else busy.push(change);
	}
	return { busy, gone };
}

/** One read, from the cursor if it still works. A 410 means it lapsed: start over from the window. */
async function readCalendar(
	adapter: CalendarAdapter,
	accessToken: string,
	cursor: string | null,
): Promise<BusyRead & { full: boolean }> {
	const window = syncWindow(Date.now());
	if (!cursor) return { ...await adapter.readBusy(accessToken, null, window), full: true };
	try {
		return { ...await adapter.readBusy(accessToken, cursor, window), full: false };
	} catch (error) {
		if (!(error instanceof CalendarRefusal) || error.status !== 410) throw error;
		return { ...await adapter.readBusy(accessToken, null, window), full: true };
	}
}

/**
 * Open the push channel a calendar lacks. Polling covers a calendar with none, so a refusal is logged
 * and the next read tries again. Neither provider calls a plain http address, so a local stack polls.
 */
async function openPush(claim: SyncClaim, accessToken: string): Promise<void> {
	const { appUrl } = serverEnv();
	if (!appUrl.startsWith("https://")) return;
	try {
		const verificationToken = randomToken();
		const callbackUrl = `${appUrl}/api/integrations/webhooks/${claim.provider_slug}`;
		const opened = await openChannel(claim.provider_slug, {
			resource: claim.resource,
			callback_url: callbackUrl,
			verification_token: verificationToken,
		}, accessToken);
		const { error } = await integrationsDb().rpc("fn_register_channel", {
			p_connection_id: claim.connection_id,
			p_resource: claim.resource,
			p_external_channel_id: opened.externalChannelId,
			p_external_resource_id: opened.externalResourceId,
			p_verification_token: verificationToken,
			p_callback_url: callbackUrl,
			p_expires_at: opened.expiresAt,
		});
		if (error) throw new Error(`integrations.fn_register_channel failed: ${error.message}`);
	} catch (error) {
		console.error(
			"[integrations:channels] not opened:",
			error instanceof Error ? error.message : error,
		);
	}
}

async function syncOne(claim: SyncClaim): Promise<Outcome> {
	const release = async (detail: string | null) => {
		const { error } = await integrationsDb().rpc("fn_release_calendar_sync", {
			p_connection_id: claim.connection_id,
			p_resource: claim.resource,
			p_claimed_at: claim.claimed_at,
			p_error: detail,
		});
		if (error) console.error("[integrations:calendar] claim not released:", error.message);
	};
	try {
		const adapter = CALENDAR_ADAPTERS[claim.provider_slug];
		if (!adapter) throw new Error(`${claim.provider_slug} has no calendar adapter.`);
		const accessToken = await IntegrationsBackendService.accessToken(claim.connection_id);
		if (!accessToken) {
			await release(null);
			return "failed";
		}
		const read = await readCalendar(adapter, accessToken, claim.cursor);
		const { busy, gone } = settle(read.changes);
		const { error } = await integrationsDb().rpc("fn_apply_busy_sync", {
			p_connection_id: claim.connection_id,
			p_resource: claim.resource,
			p_claimed_at: claim.claimed_at,
			p_full: read.full,
			p_busy: busy,
			p_gone: gone,
			p_cursor: read.cursor,
		});
		if (error) throw new Error(`integrations.fn_apply_busy_sync failed: ${error.message}`);
		if (!claim.has_channel) await openPush(claim, accessToken);
		return "done";
	} catch (error) {
		if (!(error instanceof CalendarRefusal)) {
			console.error(
				"[integrations:calendar]",
				claim.connection_id,
				error instanceof Error ? error.message : error,
			);
		}
		await release(detailOf(error, "The calendar could not be read."));
		return "failed";
	}
}
// #endregion

// #region Projective events out
async function finish(mirror: MirrorClaim, externalId: string | null, version: string | null) {
	const { error } = await schedulingDb().rpc("finish_event_mirror", {
		p_mirror: mirror.mirror_id,
		p_claimed_at: mirror.claimed_at,
		p_dirty_at: mirror.dirty_at,
		p_external_event_id: externalId,
		p_version: version,
	});
	if (error) throw new Error(`scheduling.finish_event_mirror failed: ${error.message}`);
}

/** Make a connection's Projective calendar, answering the id that stuck. */
async function openOutbound(
	adapter: CalendarAdapter,
	accessToken: string,
	connectionId: string,
): Promise<string> {
	const { data, error } = await integrationsDb().rpc("fn_set_outbound_calendar", {
		p_connection_id: connectionId,
		p_calendar_id: await adapter.openCalendar(accessToken),
	});
	if (error) throw new Error(`integrations.fn_set_outbound_calendar failed: ${error.message}`);
	return data as string;
}

/**
 * Work one connection's claimed copies, in turn, on one token. With no token the claims are left to
 * lapse, and a later run takes them with no failure counted against any copy. A calendar the person
 * deleted is forgotten and everything queued again, and that took the rest of this batch with it.
 */
async function pushConnection(mirrors: MirrorClaim[]): Promise<Outcome[]> {
	const [{ connection_id: connectionId, provider_slug: slug }] = mirrors;
	const adapter = CALENDAR_ADAPTERS[slug];
	const accessToken = adapter
		? await IntegrationsBackendService.accessToken(connectionId).catch((error) => {
			console.error("[integrations:outbound]", connectionId, error.message);
			return null;
		})
		: null;
	if (!adapter || !accessToken) return mirrors.map(() => "failed");

	const { appUrl } = serverEnv();
	let calendarId = mirrors[0].calendar_id;
	const outcomes: Outcome[] = [];
	for (const mirror of mirrors) {
		try {
			if (mirror.event) {
				calendarId ??= await openOutbound(adapter, accessToken, connectionId);
				const copy = await adapter.writeEvent(
					accessToken,
					calendarId,
					{ ...mirror, event: mirror.event },
					appUrl,
				);
				await finish(mirror, copy.externalId, copy.version);
			} else {
				if (calendarId && mirror.external_event_id) {
					await adapter.removeEvent(accessToken, calendarId, mirror.external_event_id);
				}
				await finish(mirror, null, null);
			}
			outcomes.push("done");
		} catch (error) {
			outcomes.push("failed");
			if (error instanceof CalendarGone) {
				const { error: unset } = await integrationsDb().rpc("fn_reset_outbound_calendar", {
					p_connection_id: connectionId,
				});
				if (unset) console.error("[integrations:outbound] calendar not reset:", unset.message);
				break;
			}
			if (!(error instanceof CalendarRefusal)) {
				console.error(
					"[integrations:outbound]",
					mirror.mirror_id,
					error instanceof Error ? error.message : error,
				);
			}
			const { error: unrecorded } = await schedulingDb().rpc("fail_event_mirror", {
				p_mirror: mirror.mirror_id,
				p_claimed_at: mirror.claimed_at,
				p_error: detailOf(error, "The copy could not be written."),
			});
			if (unrecorded) {
				console.error("[integrations:outbound] failure not recorded:", unrecorded.message);
			}
		}
	}
	return outcomes;
}
// #endregion

export class CalendarSyncBackendService {
	/**
	 * Read every calendar due (job `integrations-calendar-sync`, providers spec §7.6). A failure on one
	 * calendar is recorded on it and never stops the rest.
	 */
	static async syncDue(limit = 50): Promise<ServiceResult<ConnectionSweep>> {
		if (!isIntegrationsBackendLive()) return fail(503, { message: NOT_LIVE });
		try {
			const { data, error } = await integrationsDb().rpc("fn_claim_calendar_syncs", {
				p_limit: limit,
			});
			if (error) throw new Error(`integrations.fn_claim_calendar_syncs failed: ${error.message}`);
			return ok(tally(await inChunks(data as SyncClaim[], syncOne)));
		} catch (error) {
			console.error("[integrations:calendar]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * Write or remove every dirty copy (job `integrations-outbound-sync`, providers spec §7.6), a
	 * connection's copies one after another so a large batch does not trip a provider's rate limit.
	 */
	static async pushDue(limit = 100): Promise<ServiceResult<ConnectionSweep>> {
		if (!isIntegrationsBackendLive()) return fail(503, { message: NOT_LIVE });
		try {
			const { data, error } = await schedulingDb().rpc("claim_event_mirrors", { p_limit: limit });
			if (error) throw new Error(`scheduling.claim_event_mirrors failed: ${error.message}`);
			const connections = Map.groupBy(data as MirrorClaim[], (mirror) => mirror.connection_id);
			return ok(tally((await inChunks([...connections.values()], pushConnection)).flat()));
		} catch (error) {
			console.error("[integrations:outbound]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}
}
