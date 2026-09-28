import type { WorkspaceKind, WorkspaceRoster, WorkspaceSummary } from "@projective/types/workspace";
import { fetchPartyCards } from "../profile/party-cards.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import { clamp, clampOr } from "../../core/text.ts";
import { callRpc, clientFor, type LiveActor, type RpcOutcome } from "./live-support.ts";
import {
	avatarOf,
	canCreateMore,
	createBlockedReason,
	faceOf,
	parseRole,
	parseStatus,
	parseVerification,
	type Person,
	type RawRoster,
	type RawRosterItem,
	rosterStats,
	setupCompletion,
	setupSteps,
	toIncomingInvite,
} from "./mappers.ts";

/**
 * live-roster — the `/teams` · `/businesses` index, read live.
 *
 * One definer read (`org.get_workspace_roster`) returns every entity of the kind the caller is an
 * active member of, the invitations addressed to them, and the plan's create allowance — as raw facts.
 * This module then resolves the faces (one `org.get_party_cards` batch) and the marks (one
 * `files.get_public_media` batch) and maps the rest through the pure {@link ./mappers.ts}.
 */

// #region People & marks

/** The people a roster names, resolved in one batch — faces and invitation senders. */
async function peopleFor(actor: LiveActor, raw: RawRoster): Promise<Map<string, Person>> {
	const ids = [
		...raw.items.flatMap((item) => item.face_user_ids ?? []),
		...raw.invitations.map((inv) => inv.from_user_id),
	];
	const cards = await fetchPartyCards(clientFor(actor), ids);
	const out = new Map<string, Person>();
	for (const [id, card] of cards) {
		out.set(id, { username: card.username, name: card.name, avatar: card.avatar });
	}
	return out;
}

/** Entity marks (file id → `sm` URL) for every entity the roster shows. */
async function marksFor(actor: LiveActor, raw: RawRoster): Promise<Map<string, string>> {
	const ids = [
		...raw.items.map((item) => item.avatar_file_id),
		...raw.invitations.map((inv) => inv.entity_avatar_file_id),
	];
	const media = await fetchPublicMedia(clientFor(actor), ids);
	const out = new Map<string, string>();
	for (const [fileId, ref] of media) {
		const url = mediaUrl(ref, "sm");
		if (url) out.set(fileId, url);
	}
	return out;
}

// #endregion

// #region Mapping

/** One roster card. */
function toSummary(
	kind: WorkspaceKind,
	item: RawRosterItem,
	people: ReadonlyMap<string, Person>,
	marks: ReadonlyMap<string, string>,
	actor: LiveActor,
): WorkspaceSummary {
	const verification = parseVerification(item.verification);
	const memberCount = Math.max(0, Number(item.member_count) || 0);
	const steps = setupSteps(kind, item.handle, {
		logo: !!item.setup?.logo,
		bio: !!item.setup?.bio,
		invite: memberCount > 1 || (Number(item.pending_invites) || 0) > 0,
		money: !!item.setup?.money,
		verified: verification === "verified",
	});
	const faces = (item.face_user_ids ?? []).slice(0, 5)
		.map((id) => faceOf(people.get(id)))
		.filter((face): face is NonNullable<typeof face> => face !== null);
	return {
		id: item.id,
		kind,
		name: clampOr(item.name, 120, kind === "team" ? "Team" : "Business"),
		handle: clamp(item.handle, 40),
		avatar: avatarOf(item.avatar_file_id ? marks.get(item.avatar_file_id) : ""),
		status: parseStatus(item.status),
		verification,
		role: parseRole(item.role) ?? "member",
		isOwner: !!item.is_owner,
		memberCount,
		faces,
		stats: rosterStats(kind, item),
		hasUpdate: !!item.has_update,
		isActing: actor.contextType === kind && actor.contextId === item.id,
		tagline: clamp(item.headline, 160),
		setupProgress: setupCompletion(steps),
	};
}

// #endregion

// #region Read

/**
 * The roster for one kind, as the caller. `undefined`-free: a refusal comes back as the RPC's mapped
 * result, and a transport failure throws (the fat service answers 503).
 */
export async function readRoster(
	kind: WorkspaceKind,
	actor: LiveActor,
	nowMs = Date.now(),
): Promise<RpcOutcome<WorkspaceRoster>> {
	const res = await callRpc<RawRoster>(actor, "org", "get_workspace_roster", { p_kind: kind });
	if (!res.ok) return res;
	const raw: RawRoster = {
		items: res.data?.items ?? [],
		invitations: res.data?.invitations ?? [],
		create_limit: res.data?.create_limit ?? null,
		create_used: Number(res.data?.create_used) || 0,
	};
	const [people, marks] = await Promise.all([peopleFor(actor, raw), marksFor(actor, raw)]);
	const items = raw.items.map((item) => toSummary(kind, item, people, marks, actor));
	const acting = actor.contextType === kind && actor.contextId ? actor.contextId : null;
	return {
		ok: true,
		data: {
			kind,
			items,
			invitations: raw.invitations.map((inv) =>
				toIncomingInvite(
					kind,
					inv,
					people.get(inv.from_user_id),
					inv.entity_avatar_file_id ? marks.get(inv.entity_avatar_file_id) ?? "" : "",
					nowMs,
				)
			),
			actingId: acting,
			canCreate: canCreateMore(raw.create_limit, raw.create_used),
			createBlockedReason: createBlockedReason(kind, raw.create_limit, raw.create_used),
		},
	};
}

// #endregion
