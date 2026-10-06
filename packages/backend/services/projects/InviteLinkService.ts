import type {
	InviteLinkActionInput,
	InviteLinkRedeemed,
	InviteLinkResult,
	InviteLinkView,
	MemberRosterPage,
	ProjectParty,
	RedeemInviteLink,
} from "@projective/types/projects";
import { maskPii } from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { WriteOutcome } from "./live-writes.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import {
	actOnStageInviteLink,
	fetchStageInviteLink,
	redeemInviteLinkLive,
	resolveInviteLinkLive,
} from "./live-invite-links.ts";
import {
	recordStubLinkRequest,
	stubActiveLink,
	stubEnsureLink,
	stubHasLinkRequest,
	stubLinkByToken,
	stubRevokeLink,
} from "./invite-link-store.ts";

/**
 * InviteLinkService — a stage's shareable invite link (Decision #145): the share bar's read and its
 * three acts (mint-or-read · reset · revoke), and the holder's landing read and "Ask to join".
 *
 * Live: the RLS read and definer doors in `live-invite-links.ts`; the database decides who may share
 * a link (`can_manage_project_members`) and what a link means to its holder (`fn_invite_link_state`).
 * Stub: `invite-link-store.ts`, gated on the roster's own `viewerCaps.canInvite` so the share bar and
 * the Members tab agree about who manages the project.
 */
export class InviteLinkService {
	/** The stage's active link — `GET /api/projects/[id]/stages/[stageId]/invite-link`. Never mints. */
	static async stageLink(
		projectId: string,
		stageId: string,
		actor: ReadActor,
	): Promise<ServiceResult<InviteLinkResult>> {
		const denied = requireIdentity<InviteLinkResult>(actor, "share an invite link");
		if (denied) return denied;
		const live = await runLive(
			"stageLink",
			actor,
			(a) => fetchStageInviteLink(a, projectId, stageId),
		);
		if (live !== undefined) return mapLink(live, stageId, "Invite link.");

		const read = await managedRoster(projectId, stageId, actor);
		if (!read.ok) return fail(read.status, { message: read.message });
		return ok({ link: stubActiveLink(projectId, stageId) });
	}

	/** Mint-or-read, reset or turn off the stage's link — `POST …/invite-link`. */
	static async act(
		input: InviteLinkActionInput,
		actor: ReadActor,
	): Promise<ServiceResult<InviteLinkResult>> {
		const denied = requireIdentity<InviteLinkResult>(actor, "share an invite link");
		if (denied) return denied;
		const message = ACTION_MESSAGE[input.action];
		const live = await runLive(
			"act",
			actor,
			(a) => actOnStageInviteLink(a, input.projectId, input.stageId, input.action),
		);
		if (live !== undefined) return mapLink(live, input.stageId, message);

		const read = await managedRoster(input.projectId, input.stageId, actor);
		if (!read.ok || !read.data) return fail(read.status, { message: read.message });
		const { page, stageName } = read.data;
		if (input.action === "revoke") {
			stubRevokeLink(input.projectId, input.stageId);
			return ok({ link: null }, { message });
		}
		const viewer = page.members.find((row) => row.id === page.viewerId);
		const link = stubEnsureLink(
			{
				projectSlug: input.projectId,
				projectTitle: page.projectTitle,
				stageId: input.stageId,
				stageName,
				sharedBy: viewer?.party.name ?? "A project manager",
				sharedByHandle: viewer?.party.handle ?? null,
				sharedById: actor.userId,
			},
			input.action === "reset",
			Date.now(),
		);
		return ok({ link }, { message });
	}

	/** What a link means to the signed-in holder — the `/invite/[token]` landing page. */
	static async resolve(token: string, actor: ReadActor): Promise<ServiceResult<InviteLinkView>> {
		const denied = requireIdentity<InviteLinkView>(actor, "open an invite link");
		if (denied) return denied;
		const live = await runLive("resolve", actor, async (a) => ({
			data: await resolveInviteLinkLive(a, token),
		}));
		if (live !== undefined) {
			if (live === null || "refusal" in live) {
				return fail(502, { message: "This invite link could not be opened — please try again." });
			}
			return ok(live.data);
		}

		const link = stubLinkByToken(token);
		if (!link) return ok(INVALID_VIEW);
		let state: InviteLinkView["state"] = "open";
		if (link.revoked) state = "revoked";
		else if (link.sharedById === actor.userId) state = "manager";
		else if (stubHasLinkRequest(link.projectSlug, link.stageId, actor.userId)) state = "requested";
		const stageSlug = findProjectDetail(link.projectSlug)?.channels.stages
			.find((stage) => stage.stageId === link.stageId || stage.id === link.stageId)?.slug ?? null;
		return ok({
			state,
			projectSlug: link.projectSlug,
			projectTitle: link.projectTitle,
			stageSlug,
			stageName: link.stageName,
			sharedByName: link.sharedBy,
			sharedByHandle: link.sharedByHandle,
		});
	}

	/**
	 * The holder asks to join the link's stage — `POST /api/projects/invite-links/redeem`. Files a
	 * pending request; never a seat. `requester` is the caller as the stub's Requests list names them.
	 */
	static async redeem(
		input: RedeemInviteLink,
		actor: ReadActor,
		requester: ProjectParty,
	): Promise<ServiceResult<InviteLinkRedeemed>> {
		const denied = requireIdentity<InviteLinkRedeemed>(actor, "ask to join a stage");
		if (denied) return denied;
		const message = "Request sent — the project's managers will answer it.";
		const live = await runLive("redeem", actor, (a) => redeemInviteLinkLive(a, input));
		if (live !== undefined) {
			if (live === null) return fail(404, { message: "This invite link doesn't work." });
			if ("refusal" in live) {
				return fail(live.refusal.status, {
					message: live.refusal.message,
					errors: live.refusal.errors,
				});
			}
			return ok(live.data, { message, status: 201 });
		}

		const view = await this.resolve(input.token, actor);
		if (!view.ok || !view.data) return fail(view.status, { message: view.message });
		const refusal = STATE_REFUSAL[view.data.state];
		if (refusal) {
			return fail(refusal.status, { message: refusal.message, errors: { token: view.data.state } });
		}
		const link = stubLinkByToken(input.token);
		if (!link) return fail(404, { message: "This invite link doesn't work." });
		const note = input.message.trim();
		const nowMs = Date.now();
		const id = `linkreq-${link.projectSlug}-${nowMs}`;
		recordStubLinkRequest(link.projectSlug, actor.userId, {
			id,
			applicant: requester,
			applicantKind: "freelancer",
			stageId: link.stageId,
			stageName: link.stageName,
			roleName: null,
			message: note ? maskPii(note).masked : null,
			appliedAt: new Date(nowMs).toISOString(),
			appliedLabel: "Just now",
			viaInviteLink: true,
		});
		return ok(
			{ id, projectSlug: link.projectSlug, stageId: link.stageId, status: "pending" },
			{ message, status: 201 },
		);
	}
}

// #region Plumbing
const ACTION_MESSAGE: Record<InviteLinkActionInput["action"], string> = {
	ensure: "Invite link ready.",
	reset: "Invite link reset — the old link no longer works.",
	revoke: "Invite link turned off.",
};

const INVALID_VIEW: InviteLinkView = {
	state: "invalid",
	projectSlug: null,
	projectTitle: null,
	stageSlug: null,
	stageName: null,
	sharedByName: null,
	sharedByHandle: null,
};

/** The stub's refusal for every state but `open` — the sentences `redeem_invite_link` raises. */
const STATE_REFUSAL: Partial<Record<InviteLinkView["state"], { status: number; message: string }>> =
	{
		invalid: { status: 404, message: "This invite link doesn't work." },
		revoked: { status: 422, message: "This invite link has been turned off." },
		closed: { status: 422, message: "This stage is no longer taking new people." },
		manager: { status: 409, message: "You already manage this project." },
		member: { status: 409, message: "You are already on this stage." },
		invited: {
			status: 409,
			message: "You already have an invitation to this stage — answer it from your inbox.",
		},
		requested: { status: 409, message: "You have already asked to join this stage." },
		no_profile: { status: 422, message: "Set up your freelancer profile before asking to join." },
	};

function requireIdentity<T>(actor: ReadActor, action: string): ServiceResult<T> | null {
	return actor.userId.length > 0 ? null : fail<T>(401, { message: `Sign in to ${action}.` });
}

/**
 * Run the live branch, or `undefined` for the stub. A thrown live call is logged and surfaced as a
 * 502 refusal, never answered from memory.
 */
async function runLive<T>(
	method: string,
	actor: ReadActor,
	run: (actor: ReadActor & { accessToken: string }) => Promise<WriteOutcome<T>>,
): Promise<WriteOutcome<T> | undefined> {
	if (!isProjectsBackendLive()) return undefined;
	if (!canReadLive(actor)) {
		return { refusal: { status: 401, message: "Your session has expired — sign in again." } };
	}
	try {
		return await run(actor);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(`[InviteLinkService.${method}] live call failed: ${reason}`);
		return {
			refusal: { status: 502, message: "The invite link could not be reached — please try again." },
		};
	}
}

function mapLink(
	outcome: WriteOutcome<InviteLinkResult["link"]>,
	stageId: string,
	message: string,
): ServiceResult<InviteLinkResult> {
	if (outcome === null) return fail(404, { message: `No stage found for "${stageId}".` });
	if ("refusal" in outcome) {
		return fail(outcome.refusal.status, {
			message: outcome.refusal.message,
			errors: outcome.refusal.errors,
		});
	}
	return ok({ link: outcome.data }, { message });
}

/** The stub roster when the caller manages it and the stage is one of its stages. */
async function managedRoster(
	projectId: string,
	stageId: string,
	actor: ReadActor,
): Promise<ServiceResult<{ page: MemberRosterPage; stageName: string }>> {
	const read = await ProjectBackendService.members({ projectId }, actor);
	if (!read.ok || !read.data) return fail(read.status, { message: read.message });
	const page = read.data.page;
	if (!page.viewerCaps.canInvite) {
		return fail(403, {
			message: "Only the project owner, an admin or a manager may share an invite link.",
		});
	}
	const stage = page.stages.find((candidate) => candidate.id === stageId);
	if (!stage) return fail(404, { message: `No stage found for "${stageId}".` });
	return ok({ page, stageName: stage.name });
}
// #endregion
