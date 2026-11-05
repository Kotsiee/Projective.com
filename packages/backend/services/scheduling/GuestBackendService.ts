import {
	type GuestAnswer,
	GuestCodeSchema,
	type GuestInvitation,
	GuestInvitationSchema,
	GuestTokenSchema,
} from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	guestCodeMessage,
	guestLink,
	type GuestMailRow,
	guestMessage,
} from "../mail/guest-mailer.ts";
import { deliverMail } from "../mail/transport.ts";
import { writeRefusal } from "./live-entries.ts";

/**
 * GuestBackendService — everything somebody with no account does (Decision #391).
 *
 * A guest has no session, so their link is the whole of their authority, and each door here runs as
 * the service role, which is why this service holds no rule of its own: a door judges the link. A
 * token is shape-checked before any read, and a bad one is simply a dead link. Two doors run as the
 * signed-in person instead, because a claim is about who they are.
 *
 * The raw link and the code exist only in the message that carries them. Neither is logged in
 * production (`logging/log-rows.ts` `scrubPath` takes the token out of a path), and neither reaches a
 * host.
 */

const TRY_AGAIN = "We couldn't reach this invitation just now. Try again in a moment.";
const GONE = "This invitation is no longer active.";

/** A door call, as supabase-js answers it. Tests pass their own, so nothing here needs a database. */
type Door = (
	name: string,
	args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const serviceDoor: Door = (name, args) => getServiceClient().schema("scheduling").rpc(name, args);

/** What {@link GuestBackendService.sendDue} reads from its surroundings. */
export interface GuestMailDeps {
	door: Door;
	deliver: typeof deliverMail;
	appUrl: string;
}

/** A first line against a script working a link, per client. A person presses a few times a minute. */
const PRESSES = new SlidingWindowLimiter({ max: 30, windowMs: 60_000 });

/** May this client press anything on a guest page right now? */
export function guestPressAllowed(client: string): boolean {
	return PRESSES.take(client).allowed;
}

/** What a device key is made from. It is salted by the link, so it means nothing anywhere else. */
export async function guestDeviceKey(
	token: string,
	client: string,
	userAgent: string,
): Promise<string> {
	const bytes = new TextEncoder().encode(`${token}:${client}:${userAgent}`);
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

export class GuestBackendService {
	/** What a link says. Anything that is not a live link's token is a dead link. */
	static async invitation(token: string): Promise<ServiceResult<GuestInvitation>> {
		if (!GuestTokenSchema.safeParse(token).success) return ok({ state: "dead" });
		const { data, error } = await serviceDoor("guest_invitation", { p_token: token });
		if (error) {
			console.error("[guests:invitation]", error.message);
			return fail(503, { message: TRY_AGAIN });
		}
		const parsed = GuestInvitationSchema.safeParse(data);
		if (parsed.success) return ok(parsed.data);
		// Never a guest's fault, and telling them their link is dead would be untrue.
		console.error("[guests:invitation] an answer failed its schema", parsed.error.message);
		return fail(503, { message: TRY_AGAIN });
	}

	/** A guest's answer. The link alone is enough. */
	static async answer(token: string, response: GuestAnswer): Promise<ServiceResult<null>> {
		if (!GuestTokenSchema.safeParse(token).success) return fail(404, { message: GONE });
		const { data, error } = await serviceDoor("guest_answer", {
			p_token: token,
			p_response: response,
		});
		if (error) {
			console.error("[guests:answer]", error.message);
			return fail(503, { message: TRY_AGAIN });
		}
		return data === true ? ok(null) : fail(404, { message: GONE });
	}

	/** Mail the code that proves this guest reads the invited inbox. */
	static async sendCode(token: string): Promise<ServiceResult<null>> {
		if (!GuestTokenSchema.safeParse(token).success) return fail(404, { message: GONE });
		const { data, error } = await serviceDoor("guest_request_code", { p_token: token });
		if (error) {
			console.error("[guests:code]", error.message);
			return fail(503, { message: TRY_AGAIN });
		}
		const answer = data as { state: string; code?: string; email?: string; title?: string };
		if (answer.state === "wait") {
			return fail(429, {
				message: "A code is on its way. Give it a minute before asking again.",
			});
		}
		if (answer.state === "limit") {
			return fail(429, {
				message: "That's too many codes for this link. Ask your host to invite you again.",
			});
		}
		if (answer.state !== "sent" || !answer.code || !answer.email) {
			return fail(409, { message: "This room isn't open to you yet." });
		}
		const outcome = await deliverMail(
			guestCodeMessage(answer.email, answer.title ?? "your event", answer.code),
			"guest join code",
			`[dev mail] Join code for ${answer.email}: ${answer.code}`,
		);
		return outcome === "unavailable"
			? fail(503, { message: "We couldn't email your code. Try again in a moment." })
			: ok(null);
	}

	/** A guest asking for no more invitations, from anybody. Says the same whatever the token was. */
	static async optOut(token: string): Promise<ServiceResult<null>> {
		if (!GuestTokenSchema.safeParse(token).success) return ok(null);
		const { error } = await serviceDoor("guest_opt_out", { p_token: token });
		if (error) {
			console.error("[guests:opt-out]", error.message);
			return fail(503, { message: TRY_AGAIN });
		}
		return ok(null);
	}

	/** Does the signed-in reader hold this link's address, verified? Offered a claim only if so. */
	static async isMine(token: string, actor: ReadActor): Promise<boolean> {
		if (!canReadLive(actor) || !GuestTokenSchema.safeParse(token).success) return false;
		const { data, error } = await getUserClient(actor.accessToken).schema("scheduling")
			.rpc("guest_seat_is_mine", { p_token: token });
		if (error) console.error("[guests:mine]", error.message);
		return data === true;
	}

	/** Take this seat onto the signed-in account. Answers the entry, for the calendar to open on. */
	static async claim(
		token: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ eventId: string }>> {
		if (!canReadLive(actor)) {
			return fail(401, { message: "Sign in to add this to your calendar." });
		}
		if (!GuestTokenSchema.safeParse(token).success) return fail(404, { message: GONE });
		const { data, error } = await getUserClient(actor.accessToken).schema("scheduling")
			.rpc("claim_guest_seat", { p_token: token });
		return error ? writeRefusal(error) : ok({ eventId: data as string });
	}

	/**
	 * Send what is waiting (job `scheduling-guest-mail`, and straight after an invitation). Never
	 * throws, because an invitation that was saved stands whether or not its email has gone yet: what
	 * could not go stays queued for the next sweep, and a host is told if it never does.
	 */
	static async sendDue(
		limit = 50,
		deps: GuestMailDeps = {
			door: serviceDoor,
			deliver: deliverMail,
			appUrl: serverEnv().appUrl,
		},
	): Promise<ServiceResult<{ sent: number; failed: number }>> {
		const { data, error } = await deps.door("claim_guest_mail", { p_limit: limit });
		if (error) {
			console.error("[guests:send]", error.message);
			return fail(503, { message: TRY_AGAIN });
		}
		let sent = 0;
		let failed = 0;
		for (const row of (data ?? []) as GuestMailRow[]) {
			const message = guestMessage(row, deps.appUrl);
			const outcome = await deps.deliver(
				message,
				"guest email",
				`[dev mail] ${message.subject} to ${row.email} -> ${guestLink(deps.appUrl, row.token)}`,
			);
			const delivered = outcome !== "unavailable";
			const finished = await deps.door("finish_guest_mail", {
				p_mail: row.mail_id,
				p_sent: delivered,
			});
			if (finished.error) console.error("[guests:send]", finished.error.message);
			if (delivered) sent++;
			else failed++;
		}
		return ok({ sent, failed });
	}
}

/** A typed code, or `null` for anything that is not one. */
export function parseGuestCode(value: unknown): string | null {
	const parsed = GuestCodeSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
