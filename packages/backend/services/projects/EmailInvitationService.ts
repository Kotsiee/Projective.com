import {
	type AnswerEmailInvitation,
	type EmailInvitationAnswered,
	EmailInvitationState,
	EmailInvitationTokenSchema,
	type EmailInvitationView,
} from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { getServiceClient, isMocksForced, isProjectsBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	invitationLink,
	type InvitationMailRow,
	invitationMessage,
} from "../mail/invitation-mailer.ts";
import { deliverMail } from "../mail/transport.ts";
import { handshakeRefusal } from "./live-applications.ts";
import { clampOr, projectsDb } from "./live-support.ts";

/**
 * EmailInvitationService — an email invitation reached by its link (PROJECTS NO1).
 *
 * The link is `/invite/{token}`, mailed to an address no verified account holds (while the ⚖️ switch
 * `project_invite_mail_enabled` is on) or carried by a verified holder's `stage.invite`. This service
 * holds no rule of its own: `projects.email_invitation` says what the link means to the signed-in
 * reader and `projects.answer_email_invitation` refuses anyone but the addressee, so a token is only
 * shape-checked here, before any read.
 *
 * The sender, {@link EmailInvitationService.sendDue}, runs as the service role: straight after an
 * invitation is issued, and every minute from the `projects-invitation-mail` job for whatever could
 * not go at once.
 *
 * The stub path has no email invitations to answer, so it reads every token `invalid`.
 */

/** A door call, as supabase-js answers it. Tests pass their own, so nothing here needs a database. */
type Door = (
	name: string,
	args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** The sender's surroundings, injectable for tests. */
export interface InvitationMailDeps {
	door: Door;
	deliver: typeof deliverMail;
	appUrl: string;
}

const serviceDoor: Door = (name, args) => {
	try {
		return getServiceClient().schema("projects").rpc(name, args);
	} catch (error) {
		if (!isMocksForced(error)) throw error;
		return Promise.resolve({ data: null, error: { message: error.message } });
	}
};

/** How many waiting mails an invite sends on its way out; the job takes the rest. */
const SENT_WHILE_WAITING = 10;

/** The landing read for a token that names no invitation. */
export const EMAIL_INVITATION_INVALID: EmailInvitationView = {
	state: "invalid",
	projectSlug: null,
	projectTitle: null,
	stageName: null,
	inviterName: null,
	role: null,
	addressHint: null,
	expiresAt: null,
};

const TRY_AGAIN = "This invitation could not be opened just now. Try again in a moment.";

/** `projects.email_invitation`'s answer, as it comes back over PostgREST. */
interface LandingJson {
	state?: unknown;
	project_slug?: string | null;
	project_title?: string | null;
	stage_name?: string | null;
	inviter_name?: string | null;
	role?: string | null;
	address_hint?: string | null;
	expires_at?: string | null;
}

function text(value: string | null | undefined, max: number): string | null {
	return value ? clampOr(value, max, "") || null : null;
}

export class EmailInvitationService {
	/** What the link means to the signed-in reader: the `/invite/[token]` landing read. */
	static async resolve(
		token: string,
		actor: ReadActor,
	): Promise<ServiceResult<EmailInvitationView>> {
		if (!EmailInvitationTokenSchema.safeParse(token).success) return ok(EMAIL_INVITATION_INVALID);
		if (!isProjectsBackendLive()) return ok(EMAIL_INVITATION_INVALID);
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to open this invitation." });
		const { data, error } = await projectsDb(actor).rpc("email_invitation", { p_token: token });
		if (error) {
			console.warn(`[EmailInvitationService.resolve] ${error.message}`);
			return fail(502, { message: TRY_AGAIN });
		}
		const row = (data ?? {}) as LandingJson;
		const state = EmailInvitationState.safeParse(row.state);
		return ok({
			state: state.success ? state.data : "invalid",
			projectSlug: text(row.project_slug, 120),
			projectTitle: text(row.project_title, 160),
			stageName: text(row.stage_name, 120),
			inviterName: text(row.inviter_name, 160),
			role: text(row.role, 20),
			addressHint: text(row.address_hint, 170),
			expiresAt: row.expires_at ?? null,
		});
	}

	/** The addressee accepts or declines — `POST /api/projects/invites/email`. */
	static async answer(
		input: AnswerEmailInvitation,
		actor: ReadActor,
	): Promise<ServiceResult<EmailInvitationAnswered>> {
		if (!isProjectsBackendLive()) {
			return fail(404, { message: "This invitation link is not valid." });
		}
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to answer this invitation." });
		const { error } = await projectsDb(actor).rpc("answer_email_invitation", {
			p_token: input.token,
			p_accept: input.accept,
		});
		if (error) {
			if (error.code === "P0002") {
				return fail(404, { message: "This invitation link is not valid." });
			}
			const refusal = handshakeRefusal(error, "token");
			return fail(refusal.status, {
				message: refusal.message,
				errors: refusal.errors,
				details: refusal.details,
			});
		}
		const view = await this.resolve(input.token, actor);
		return ok(
			{
				state: input.accept ? "accepted" : "declined",
				projectSlug: view.ok ? view.data?.projectSlug ?? null : null,
			},
			{ message: input.accept ? "You joined the project." : "Invitation declined." },
		);
	}

	/**
	 * Send what is waiting: straight after an invitation (a few), and from the
	 * `projects-invitation-mail` job (`POST /api/projects/cron/invitation-mail`). Never throws, because
	 * an invitation that was issued stands whether or not its email has gone yet: what could not go is
	 * left to the next sweep, and stops after its fifth refusal.
	 */
	static async sendDue(
		limit = SENT_WHILE_WAITING,
		deps: InvitationMailDeps = {
			door: serviceDoor,
			deliver: deliverMail,
			appUrl: serverEnv().appUrl,
		},
	): Promise<ServiceResult<{ sent: number; failed: number }>> {
		const { data, error } = await deps.door("claim_invitation_mail", { p_limit: limit });
		if (error) {
			console.error("[invitations:send]", error.message);
			return fail(503, { message: "Invitation mail could not be claimed." });
		}
		let sent = 0;
		let failed = 0;
		for (const row of (data ?? []) as InvitationMailRow[]) {
			const message = invitationMessage(row, deps.appUrl);
			const outcome = await deps.deliver(
				message,
				"project invitation email",
				`[dev mail] ${message.subject} to ${row.email} -> ${
					invitationLink(deps.appUrl, row.token)
				}`,
			);
			const delivered = outcome !== "unavailable";
			const finished = await deps.door("finish_invitation_mail", {
				p_mail: row.mail_id,
				p_sent: delivered,
			});
			if (finished.error) console.error("[invitations:send]", finished.error.message);
			if (delivered) sent++;
			else failed++;
		}
		return ok({ sent, failed });
	}
}
