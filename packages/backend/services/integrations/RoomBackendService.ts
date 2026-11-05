import {
	GUEST_JOIN_REFUSAL,
	type RoomJoinAnswer,
	RoomJoinAnswerSchema,
} from "@projective/types/scheduling";
import { isSlug } from "@projective/types/slugs";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, isIntegrationsBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { IntegrationsBackendService } from "./IntegrationsBackendService.ts";
import { ROOM_ADAPTERS, type RoomFacts, RoomProviderError } from "./rooms/adapters.ts";

/**
 * RoomBackendService — meetings at a provider (Decision #343, ruling C4; Decision #383).
 *
 * A person joins through Projective's own address, `/meet/rom-…`, and the door decides everything: who
 * may hold a link, when, and whether it is theirs alone. So a provider's link is handed out at the
 * moment of joining and never sits in a calendar, an email or a client payload.
 *
 * Three sweeps keep the rooms true: {@link RoomBackendService.mintDue} makes what the queue asks for,
 * {@link RoomBackendService.syncDue} follows moves and cancellations as a best effort that never blocks
 * a booking, and {@link RoomBackendService.reconcileDue} reads each provider's own record after a
 * meeting. The sweeps act through service-role doors in `00001510`, and a token never leaves this layer.
 */

const NOT_YOURS: RoomJoinAnswer = { state: "not_party", url: null };
const NOT_LIVE = "Rooms aren't switched on here.";
const UNREACHABLE = "Rooms couldn't be reached just now.";
const NO_WAY_IN = "We couldn't get your link from the meeting provider. Try again in a moment.";

// #region Shapes
/** What each sweep answers its cron route. */
export interface RoomSweep {
	claimed: number;
	done: number;
	failed: number;
}

interface RoomClaim {
	room_id: string;
	provider: string;
	connection_id: string | null;
	host_account?: string | null;
	provider_meeting_id?: string | null;
	closing?: boolean;
	title: string;
	starts_at: string;
	ends_at: string;
	paid?: boolean;
	granted_scopes?: string[] | null;
}

/** What `room_join` says beyond the answer a person gets. These never leave the service. */
interface RawJoin {
	role?: string | null;
	provider?: string;
	connection_id?: string | null;
	provider_meeting_id?: string | null;
	register?: {
		room_id: string;
		/** Somebody with an account, or a guest's seat: one of the two. */
		user_id?: string;
		attendee_id?: string;
		email: string;
		first_name: string;
		approve?: boolean;
	} | null;
	/** This room's plain link is no way in, so it can never be what a failed link falls back on. */
	link_required?: boolean;
}
// #endregion

// #region Plumbing
const scheduling = () => getServiceClient().schema("scheduling");

const factsOf = (room: RoomClaim): RoomFacts => ({
	roomId: room.room_id,
	title: room.title,
	startsAt: room.starts_at,
	endsAt: room.ends_at,
	hostAccount: room.host_account ?? null,
	paid: room.paid === true,
	grantedScopes: room.granted_scopes ?? [],
});

const reasonOf = (error: unknown) => error instanceof RoomProviderError ? error.code : "unreachable";

async function door(name: string, args: Record<string, unknown>): Promise<unknown> {
	const { data, error } = await scheduling().rpc(name, args);
	if (error) throw new Error(`scheduling.${name} failed: ${error.message}`);
	return data;
}

/** A token for this connection. A busy or dead connection is a failed try, never a thrown sweep. */
async function tokenFor(connectionId: string | null | undefined): Promise<string> {
	const token = connectionId ? await IntegrationsBackendService.accessToken(connectionId) : null;
	if (!token) throw new RoomProviderError(0, "no_token", false);
	return token;
}

async function sweep(
	label: string,
	claimDoor: string,
	limit: number,
	run: (room: RoomClaim) => Promise<boolean>,
): Promise<ServiceResult<RoomSweep>> {
	if (!isIntegrationsBackendLive()) return fail(503, { message: NOT_LIVE });
	try {
		const rooms = (await door(claimDoor, { p_limit: limit }) ?? []) as RoomClaim[];
		let done = 0;
		for (const room of rooms) if (await run(room)) done++;
		return ok({ claimed: rooms.length, done, failed: rooms.length - done });
	} catch (error) {
		console.error(`[rooms:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE });
	}
}
// #endregion

// #region One room
async function mintOne(room: RoomClaim): Promise<boolean> {
	const adapter = ROOM_ADAPTERS[room.provider];
	if (!adapter || !room.connection_id) {
		await door("fail_room", { p_room: room.room_id, p_error: "no_connection", p_final: true });
		return false;
	}
	try {
		const minted = await adapter.create(await tokenFor(room.connection_id), factsOf(room));
		await door("attach_room", {
			p_room: room.room_id,
			p_connection: room.connection_id,
			p_meeting_id: minted.meetingId,
			p_host_id: minted.hostId,
			p_join_url: minted.joinUrl,
			p_passcode: minted.passcode,
			p_registration: minted.registration,
			p_guarded: minted.guarded,
		});
		return true;
	} catch (error) {
		await door("fail_room", {
			p_room: room.room_id,
			p_error: reasonOf(error),
			p_final: error instanceof RoomProviderError && error.final,
		});
		return false;
	}
}

async function syncOne(room: RoomClaim): Promise<boolean> {
	const adapter = ROOM_ADAPTERS[room.provider];
	try {
		if (room.provider_meeting_id && (room.closing ? adapter?.close : adapter?.move)) {
			const token = await tokenFor(room.connection_id);
			if (room.closing) await adapter.close?.(token, room.provider_meeting_id);
			else await adapter.move?.(token, room.provider_meeting_id, factsOf(room));
		}
		await door("room_synced", { p_room: room.room_id });
		return true;
	} catch (error) {
		await door("room_synced", { p_room: room.room_id, p_error: reasonOf(error) });
		return false;
	}
}

/** Read the provider's own record. A failed read stamps nothing, so the sitting holds (ruling R5). */
async function reconcileOne(room: RoomClaim): Promise<boolean> {
	const adapter = ROOM_ADAPTERS[room.provider];
	try {
		if (!adapter || !room.provider_meeting_id) throw new RoomProviderError(0, "no_meeting", true);
		const token = await tokenFor(room.connection_id);
		for (const person of await adapter.attendance(token, room.provider_meeting_id)) {
			for (const [action, at] of [["joined", person.joinedAt], ["left", person.leftAt]]) {
				if (!at) continue;
				await door("record_presence", {
					p_provider: room.provider,
					p_meeting_id: room.provider_meeting_id,
					p_action: action,
					p_at: at,
					p_event_key: `reconcile:${person.key}:${action}:${at}`.slice(0, 240),
					p_participant_key: person.key,
					p_email: person.email,
					p_registrant_id: person.registrantId,
					p_account_id: person.accountId,
					p_source: "reconcile",
				});
			}
		}
		await door("room_reconciled", { p_room: room.room_id });
		return true;
	} catch (error) {
		await door("room_reconciled", { p_room: room.room_id, p_error: reasonOf(error) });
		return false;
	}
}
// #endregion

// #region Joining
/**
 * A better link than the room's, or `null`: a host's fresh one, where a stored one would be an expiring
 * credential, or an attendee's own, made the first time they join so that only people who come are
 * sent to the provider. `register` comes from the door as the signed-in caller, never from an actor's
 * claim, and on a paid room this is the moment Projective approves them (Decision #392). A provider
 * being down stops nobody on a room whose own link works; {@link RoomBackendService.join} answers for
 * the rooms where it does not.
 */
async function betterLink(raw: RawJoin): Promise<string | null> {
	const adapter = raw.provider ? ROOM_ADAPTERS[raw.provider] : undefined;
	const meetingId = raw.provider_meeting_id;
	if (!adapter || !meetingId) return null;
	try {
		if (raw.role === "host" && adapter.hostLink) {
			return await adapter.hostLink(await tokenFor(raw.connection_id), meetingId);
		}
		if (raw.register && adapter.register) {
			const { room_id, user_id, attendee_id, email, first_name, approve } = raw.register;
			const token = await tokenFor(raw.connection_id);
			const added = await adapter.register(token, meetingId, {
				email,
				firstName: first_name,
				approve: approve === true,
			});
			await door("save_room_registrant", {
				p_room: room_id,
				p_user: user_id ?? null,
				p_registrant_id: added.registrantId,
				p_join_url: added.joinUrl,
				p_attendee: attendee_id ?? null,
			});
			return added.joinUrl;
		}
	} catch (error) {
		console.error("[rooms:join]", reasonOf(error));
	}
	return null;
}
// #endregion

export class RoomBackendService {
	/** Into a room, as the signed-in person. The door records the press when the room is open. */
	static async join(slug: string, actor: ReadActor): Promise<ServiceResult<RoomJoinAnswer>> {
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to join this meeting." });
		if (!isSlug(slug, "room")) return ok(NOT_YOURS);
		const { data, error } = await getUserClient(actor.accessToken).schema("scheduling")
			.rpc("room_join", { p_slug: slug });
		if (error) {
			console.error("[rooms:join]", error.message);
			return fail(503, { message: "We couldn't reach this meeting just now. Try again in a moment." });
		}
		const parsed = RoomJoinAnswerSchema.safeParse(data);
		if (!parsed.success) return ok(NOT_YOURS);
		if (parsed.data.state !== "open" || !isIntegrationsBackendLive()) return ok(parsed.data);
		const raw = data as RawJoin;
		const link = await betterLink(raw);
		// The door has recorded the press by now, so a failure here leaves their evidence intact.
		if (!link && raw.link_required) return fail(503, { message: NO_WAY_IN });
		return ok({ ...parsed.data, url: link ?? parsed.data.url });
	}

	/**
	 * Into a room, as a guest. There is no session, so the door judges the link and its code and records
	 * the press, and a guest's own link is made here the first time, as an attendee's is.
	 */
	static async joinAsGuest(
		token: string,
		code: string,
		device: string,
	): Promise<ServiceResult<{ url: string }>> {
		let raw: RawJoin & { state?: string; url?: string };
		try {
			raw = await door("guest_room_join", {
				p_token: token,
				p_code: code,
				p_device: device,
			}) as typeof raw;
		} catch (error) {
			console.error("[rooms:guest]", error instanceof Error ? error.message : error);
			return fail(503, {
				message: "We couldn't reach this meeting just now. Try again in a moment.",
			});
		}
		if (raw.state !== "open" || !raw.url) {
			return fail(409, {
				message: GUEST_JOIN_REFUSAL[raw.state ?? ""] ?? "This room isn't open to you yet.",
			});
		}
		const better = isIntegrationsBackendLive() ? await betterLink(raw) : null;
		return ok({ url: better ?? raw.url });
	}

	/** Make every room the queue is waiting for (job `integrations-mint-rooms`). */
	static mintDue(limit = 25): Promise<ServiceResult<RoomSweep>> {
		return sweep("mint", "claim_rooms_to_mint", limit, mintOne);
	}

	/** Follow moved and cancelled rooms at their providers (same job). */
	static syncDue(limit = 25): Promise<ServiceResult<RoomSweep>> {
		return sweep("sync", "claim_rooms_to_sync", limit, syncOne);
	}

	/** Read each ended meeting's record from its provider (job `integrations-presence-reconcile`). */
	static reconcileDue(limit = 25): Promise<ServiceResult<RoomSweep>> {
		return sweep("reconcile", "claim_rooms_to_reconcile", limit, reconcileOne);
	}
}
