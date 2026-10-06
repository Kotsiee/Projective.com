import {
	type InviteLinkAction,
	inviteLinkPath,
	type InviteLinkRedeemed,
	InviteLinkState,
	type InviteLinkView,
	type RedeemInviteLink,
	type StageInviteLink,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { clampOr, projectsDb, resolveProjectRef, UUID_RE } from "./live-support.ts";
import type { WriteOutcome } from "./live-writes.ts";
import { handshakeRefusal } from "./live-applications.ts";

/**
 * live-invite-links — a stage's shareable invite link on the live path (Decision #145).
 *
 * The manager side reads the active link under the caller's RLS (`Managers view stage invite links`)
 * and changes it through the definer doors `projects.get_stage_invite_link` (mint · reset) and
 * `projects.revoke_stage_invite_link`, which check staffing authority themselves. The holder side is
 * `projects.resolve_invite_link` (the landing page) and `projects.redeem_invite_link`, which files a
 * pending request and seats nobody.
 */

// #region Row shapes
interface LinkRow {
	id: string;
	token: string;
	project_stage_id: string;
	created_at: string;
}

interface LinkJson {
	id: string;
	token: string;
	stageId: string;
	createdAt: string;
}

interface ProjectKeyRow {
	id: string;
}

interface ResolvedJson {
	state: string;
	projectSlug?: string | null;
	projectTitle?: string | null;
	stageSlug?: string | null;
	stageName?: string | null;
	sharedByName?: string | null;
	sharedByHandle?: string | null;
}
// #endregion

function toLink(row: LinkJson): StageInviteLink {
	return {
		id: row.id,
		token: row.token,
		stageId: row.stageId,
		path: inviteLinkPath(row.token),
		createdAt: row.createdAt,
	};
}

/**
 * The project's id when `stageId` is one of its stages under the caller's RLS, else `null` — so a
 * link is never read or changed through a URL that pairs one project with another's stage.
 */
async function stageProject(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	stageId: string,
): Promise<string | null> {
	if (!UUID_RE.test(stageId)) return null;
	const db = projectsDb(actor);
	const project = await resolveProjectRef<ProjectKeyRow>(db, "id", projectSlug);
	if (!project) return null;
	const { data, error } = await db
		.from("project_stages")
		.select("id")
		.eq("id", stageId)
		.eq("project_id", project.id)
		.maybeSingle();
	if (error) throw new Error(`projects.project_stages read failed: ${error.message}`);
	return data ? project.id : null;
}

// #region Manager side
/** The stage's active link as the caller may read it; `null` data when it has none. */
export async function fetchStageInviteLink(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	stageId: string,
): Promise<WriteOutcome<StageInviteLink | null>> {
	if (!(await stageProject(actor, projectSlug, stageId))) return null;
	const { data, error } = await projectsDb(actor)
		.from("stage_invite_links")
		.select("id, token, project_stage_id, created_at")
		.eq("project_stage_id", stageId)
		.eq("status", "active")
		.maybeSingle();
	if (error) throw new Error(`projects.stage_invite_links read failed: ${error.message}`);
	const row = data as LinkRow | null;
	return {
		data: row
			? toLink({
				id: row.id,
				token: row.token,
				stageId: row.project_stage_id,
				createdAt: row.created_at,
			})
			: null,
	};
}

/** Mint-or-read, reset, or revoke the stage's link. */
export async function actOnStageInviteLink(
	actor: ReadActor & { accessToken: string },
	projectSlug: string,
	stageId: string,
	action: InviteLinkAction,
): Promise<WriteOutcome<StageInviteLink | null>> {
	if (!(await stageProject(actor, projectSlug, stageId))) return null;
	const db = projectsDb(actor);
	if (action === "revoke") {
		const { error } = await db.rpc("revoke_stage_invite_link", { p_stage_id: stageId });
		if (error) return { refusal: handshakeRefusal(error, "stageId") };
		return { data: null };
	}
	const { data, error } = await db.rpc("get_stage_invite_link", {
		p_stage_id: stageId,
		p_rotate: action === "reset",
	});
	if (error) return { refusal: handshakeRefusal(error, "stageId") };
	return { data: toLink(data as LinkJson) };
}
// #endregion

// #region Holder side
/** What a token means to the signed-in caller. */
export async function resolveInviteLinkLive(
	actor: ReadActor & { accessToken: string },
	token: string,
): Promise<InviteLinkView> {
	const { data, error } = await projectsDb(actor).rpc("resolve_invite_link", { p_token: token });
	if (error) throw new Error(`projects.resolve_invite_link failed: ${error.message}`);
	const row = data as ResolvedJson;
	const state = InviteLinkState.safeParse(row.state);
	const text = (value: string | null | undefined, max: number) =>
		value ? clampOr(value, max, "") || null : null;
	return {
		state: state.success ? state.data : "invalid",
		projectSlug: text(row.projectSlug, 120),
		projectTitle: text(row.projectTitle, 160),
		stageSlug: text(row.stageSlug, 120),
		stageName: text(row.stageName, 120),
		sharedByName: text(row.sharedByName, 160),
		sharedByHandle: text(row.sharedByHandle, 60),
	};
}

/** Ask to join the link's stage as the caller. */
export async function redeemInviteLinkLive(
	actor: ReadActor & { accessToken: string },
	input: RedeemInviteLink,
): Promise<WriteOutcome<InviteLinkRedeemed>> {
	const { data, error } = await projectsDb(actor).rpc("redeem_invite_link", {
		p_token: input.token,
		p_message: input.message.trim() || null,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: handshakeRefusal(error, "token") };
	}
	const row = data as InviteLinkRedeemed;
	return {
		data: { id: row.id, projectSlug: row.projectSlug, stageId: row.stageId, status: "pending" },
	};
}
// #endregion
