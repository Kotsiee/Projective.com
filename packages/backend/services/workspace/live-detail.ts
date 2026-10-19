import {
	ProposalAllowanceRowSchema,
	type ProposalAllowanceStatus,
	resolveProposalAllowance,
} from "@projective/types/finance";
import type { MediaRef } from "@projective/types/files";
import {
	type ArchiveBlocker,
	ArchiveBlockerSchema,
	canOpenFinance,
	effectivePermissions,
	RestoreTarget,
	type WorkspaceDetail,
	type WorkspaceFinance,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRoleDef,
	type WorkspaceSeats,
	WorkspaceSeatsSchema,
	type WorkspaceStatus,
	WorkspaceVisibility,
} from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { fetchPartyCards, type PartyCard } from "../profile/party-cards.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { isPaymentsLive } from "../../core/stripe.ts";
import { clamp, clampOr } from "../../core/text.ts";
import { callRpc, clientFor, type LiveActor } from "./live-support.ts";
import {
	buildPayoutPolicy,
	buildSpendPolicy,
	businessSpendPeople,
	contributedBy,
	envelopeFor,
	type MoneyMember,
	readFinanceTiles,
	teamMoneyFacts,
	toKyb,
	toMoneyTile,
	toViewerCan,
} from "./live-money.ts";
import {
	availabilityOf,
	avatarOf,
	isoOf,
	memberPreset,
	parseCapabilities,
	parseStatus,
	parseVerification,
	type Person,
	publishedFact,
	type RawDetail,
	type RawDetailAnswer,
	type RawDirectoryFace,
	type RawMember,
	type RawProject,
	setupSteps,
	toActivity,
	toEngagement,
	toOutgoingInvite,
	toProject,
	toRoleDef,
	verificationPrompt,
	visibleActivity,
	wiCapOf,
	wiOf,
	workloadPercent,
} from "./mappers.ts";

/**
 * live-detail — one entity's full console projection, read live.
 *
 * `org.get_workspace_detail` is the console's ONE read of the entity (Decision #233): under the caller's
 * session it answers the roster, roles, invitations, activity, every member's live W_i and stake, each
 * project's counterparty face, and — for a team — the payout block (`manage_finances` holders only), the
 * live engagements and the proposal allowance; for a business (BB9) the spend block, the per-currency
 * money tiles, the KYB picture and the viewer's server-decided flags; for either kind the archive
 * blockers and, while archived, where a restore lands (Teams C6) — each narrowed in SQL to what the
 * viewer may see. A non-member is `forbidden`, an unknown reference
 * `not_found`. This module then resolves only what the facts point at through the platform's shared
 * resolvers: the people (ONE `org.get_party_cards` batch), the entity's marks, and the finance tiles
 * (the `/wallet` projection, reused so the console and the wallet cannot disagree).
 *
 * A request-scoped memo ({@link memoised}) collapses the several reads one page render makes (the
 * layout, its header and lane slots, the page) onto one, provided they share the request's actor
 * object. Every write clears it, so a write never answers with the projection from before it.
 */

// #region I/O seam

/**
 * Everything the detail read reaches outside this module. Live by default; a unit test swaps a member
 * (`stub(detailIo, "rpc", …)`) to count the calls one read makes without a database.
 */
export interface DetailIo {
	rpc: typeof callRpc;
	financeTiles: (actor: LiveActor, kind: WorkspaceKind, id: string) => Promise<WorkspaceFinance>;
	publicMedia: (
		actor: LiveActor,
		ids: readonly (string | null | undefined)[],
	) => Promise<Map<string, MediaRef>>;
	partyCards: (actor: LiveActor, ids: readonly string[]) => Promise<Map<string, PartyCard>>;
}

/** The live implementations of {@link DetailIo}. */
export const detailIo: DetailIo = {
	rpc: callRpc,
	financeTiles: readFinanceTiles,
	publicMedia: (actor, ids) => fetchPublicMedia(clientFor(actor), ids),
	partyCards: (actor, ids) => fetchPartyCards(clientFor(actor), ids),
};

// #endregion

// #region Request memo

/**
 * The detail memo, scoped to ONE request by keying on the {@link ReadActor} OBJECT a route or page
 * resolved for it (a `WeakMap`, so the scope dies with the request). A page render that threads one
 * actor through its layout, slots and page reads each entity once; two requests never share an entry,
 * so a write made elsewhere (the `/wallet` spend request, another member's edit) can never be answered
 * with a projection from before it. Every write through this service clears its actor's scope and
 * stores the fresh re-read in its place.
 */
const MEMO = new WeakMap<object, Map<string, Promise<ServiceResult<WorkspaceDetail>>>>();

/** Drop every memoised detail this request has read (after a write). */
export function forgetDetails(actor: LiveActor): void {
	MEMO.delete(actor);
}

/** The request's memo for one key, loading (and remembering) it on a miss. */
function memoised(
	actor: LiveActor,
	key: string,
	load: () => Promise<ServiceResult<WorkspaceDetail>>,
): Promise<ServiceResult<WorkspaceDetail>> {
	let scope = MEMO.get(actor);
	if (!scope) {
		scope = new Map();
		MEMO.set(actor, scope);
	}
	const hit = scope.get(key);
	if (hit) return hit;
	const value = load();
	const owner = scope;
	owner.set(key, value);
	// A refusal or a failure is not remembered: the next read in the render asks again.
	value.then((res) => {
		if (!res.ok) owner.delete(key);
	}, () => owner.delete(key));
	return value;
}

// #endregion

// #region Counterparties

/** A counterparty as a project row shows it. */
interface Counterparty {
	name: string;
	avatar: string;
}

/** A directory face the read embedded (`org.profiles_index` name + mark), or `null` without a name. */
function faceOf(raw: RawDirectoryFace | null | undefined): Counterparty | null {
	if (!raw?.name) return null;
	return {
		name: raw.name,
		avatar: raw.avatar_bucket && raw.avatar_path
			? publicObjectUrl(raw.avatar_bucket, raw.avatar_path) ?? ""
			: "",
	};
}

/** A list of names as one line: "Juno Park", or "Juno Park +2". */
function namesLine(names: readonly Counterparty[]): Counterparty | null {
	if (names.length === 0) return null;
	const [first, ...rest] = names;
	return {
		name: rest.length > 0 ? `${first.name} +${rest.length}` : first.name,
		avatar: first.avatar,
	};
}

// #endregion

// #region The read

/**
 * The detail of one entity, addressed by handle or row id — memoised for the request (see
 * {@link memoised}). `fresh` clears the request's memo first; every write re-reads that way.
 */
export function readDetail(
	kind: WorkspaceKind,
	ref: string,
	actor: LiveActor,
	opts: { fresh?: boolean; nowMs?: number } = {},
): Promise<ServiceResult<WorkspaceDetail>> {
	const trimmed = ref.trim();
	if (opts.fresh) forgetDetails(actor);
	return memoised(
		actor,
		`${kind}|${trimmed.toLowerCase()}`,
		() => loadDetail(kind, trimmed, actor, opts.nowMs ?? Date.now()),
	);
}

async function loadDetail(
	kind: WorkspaceKind,
	ref: string,
	actor: LiveActor,
	nowMs: number,
): Promise<ServiceResult<WorkspaceDetail>> {
	const noun = kind === "team" ? "team" : "business";
	const res = await detailIo.rpc<RawDetailAnswer>(actor, "org", "get_workspace_detail", {
		p_kind: kind,
		p_handle: ref,
	});
	if (!res.ok) return res.refusal;
	const answer = res.data;
	if (!answer || answer.status === "not_found") {
		return fail(404, { message: `No ${noun} found for "${ref}".` });
	}
	if (answer.status === "forbidden") {
		return fail(403, { message: `You're not a member of this ${noun}.` });
	}
	return ok(await assemble(kind, answer, actor, nowMs));
}

/**
 * A team's proposal allowance from the read's embedded `finance.get_proposal_allowance` answer, or
 * `null` (a business, or an answer whose shape drifted — never a plausible meter that is not the team's).
 */
function allowanceOf(raw: unknown): ProposalAllowanceStatus | null {
	if (raw === null || raw === undefined) return null;
	const parsed = ProposalAllowanceRowSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("[workspace:detail] allowance shape drifted:", parsed.error.message);
		return null;
	}
	return resolveProposalAllowance(parsed.data);
}

/**
 * A team's seats from the read, or `null` (a business, or an answer whose shape drifted — never a
 * seat count the database did not give).
 */
export function seatsOf(raw: unknown): WorkspaceSeats | null {
	if (raw === null || raw === undefined) return null;
	const parsed = WorkspaceSeatsSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("[workspace:detail] seats shape drifted:", parsed.error.message);
		return null;
	}
	return parsed.data;
}

/**
 * The archive blockers from the read (a team's or a business's), dropping any row whose shape drifted
 * rather than inventing a blocker the database did not name.
 */
export function archiveBlockersOf(raw: unknown): ArchiveBlocker[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((row) => {
		const parsed = ArchiveBlockerSchema.safeParse(row);
		return parsed.success ? [parsed.data] : [];
	});
}

/**
 * Where a restore would land, from the read — only while the entity is archived; `null` otherwise, and
 * for an answer that is neither target (never a guess at which way a restore goes).
 */
export function restoreTargetOf(status: WorkspaceStatus, raw: unknown): RestoreTarget | null {
	if (status !== "archived") return null;
	const parsed = RestoreTarget.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/** The raw detail, resolved and mapped onto the SSOT projection. */
async function assemble(
	kind: WorkspaceKind,
	raw: RawDetail,
	actor: LiveActor,
	nowMs: number,
): Promise<WorkspaceDetail> {
	const verification = parseVerification(raw.verification);
	const roles: WorkspaceRoleDef[] = (raw.roles ?? []).map(toRoleDef);
	const members = raw.members ?? [];
	const projects = raw.projects ?? [];
	const engagements = kind === "team" ? raw.engagements ?? [] : [];
	const teamMoney = kind === "team" && raw.payout ? teamMoneyFacts(raw.payout, members) : null;
	const spend = kind === "business" ? raw.spend ?? null : null;

	// Wave 1 — the wallet-page tiles and the marks, in parallel.
	const [finance, media] = await Promise.all([
		detailIo.financeTiles(actor, kind, raw.id),
		detailIo.publicMedia(actor, [raw.avatar_file_id, raw.banner_file_id]),
	]);

	// Wave 2 — every person the page names, in one batch.
	const userIds = [
		...members.map((m) => m.user_id),
		...(raw.invites ?? []).map((i) => i.target_user_id ?? ""),
		...(raw.activity ?? []).map((a) => a.actor_user_id ?? ""),
		...projects.map((p) => p.owner_user_id ?? ""),
		...projects.flatMap((p) => p.provider_user_ids ?? []),
		...businessSpendPeople(spend),
	].filter((id) => id.length > 0);
	const cards = await detailIo.partyCards(actor, userIds);
	const people = new Map<string, Person>();
	for (const [id, card] of cards) {
		people.set(id, { username: card.username, name: card.name, avatar: card.avatar });
	}

	// Members, with their effective capabilities resolved once for every money rule below.
	const mapped: WorkspaceMember[] = [];
	const moneyMembers: MoneyMember[] = [];
	const byUser = new Map<string, RawMember>();
	/** Whether the viewer's own row is the owner's — a team's verification step is theirs alone. */
	let viewerIsOwner = false;
	for (const m of members) {
		byUser.set(m.user_id, m);
		const person = people.get(m.user_id);
		const preset = memberPreset(m, roles);
		const overrides = {
			granted: parseCapabilities(m.granted),
			revoked: parseCapabilities(m.revoked),
		};
		const capabilities = effectivePermissions(
			{ rolePreset: preset, overrides },
			kind,
			roles,
			m.role_id,
		);
		const isOwner = m.user_id === raw.owner_user_id;
		if (isOwner && m.is_self) viewerIsOwner = true;
		moneyMembers.push({ memberId: m.id, userId: m.user_id, isOwner, person, capabilities });
		// Only an envelope the viewer may read (their own, unless they read the wallet's) is shown.
		const envelope = envelopeFor(spend, m.user_id);
		const wi = wiOf(m.wi);
		const wiCap = wiCapOf(m.wi_cap);
		mapped.push({
			id: m.id,
			handle: clamp(person?.username, 40),
			name: clampOr(person?.name, 120, "Member"),
			avatar: avatarOf(person?.avatar),
			email: m.is_self && m.email ? clamp(m.email, 160) : null,
			roleId: m.role_id,
			rolePreset: preset,
			state: "active",
			overrides,
			joinedAt: isoOf(m.joined_at),
			title: m.title ? clamp(m.title, 80) : null,
			workload: workloadPercent(wi, wiCap),
			wi,
			wiCap,
			availability: availabilityOf(m.availability),
			isSelf: !!m.is_self,
			spendLimitMinor:
				envelope && envelope.limit_minor !== null && envelope.limit_minor !== undefined
					? Math.max(0, Math.trunc(Number(envelope.limit_minor) || 0))
					: null,
			contributedMinor: contributedBy(spend, m.user_id),
			shareBp: Math.max(0, Math.min(10_000, Number(m.share_bp) || 0)),
			shareHeld: !!m.share_held,
			reportsTo: m.reports_to ?? null,
		});
	}

	const counterpartyOf = (project: RawProject): Counterparty => {
		const owner = project.owner_user_id ? people.get(project.owner_user_id) : undefined;
		const fromOwner = { name: owner?.name ?? "", avatar: avatarOf(owner?.avatar) };
		if (kind === "team") return faceOf(project.client) ?? fromOwner;
		const faces: Counterparty[] = [
			...(project.provider_teams ?? []).map(faceOf).filter((f): f is Counterparty => !!f),
			...(project.provider_user_ids ?? []).map((id) => people.get(id)).filter((p): p is Person =>
				!!p
			).map((p) => ({ name: p.name, avatar: avatarOf(p.avatar) })),
		];
		return namesLine(faces) ?? fromOwner;
	};

	const viewerCaps = parseCapabilities(raw.viewer?.capabilities);
	const viewerCan = toViewerCan(raw.viewer_can);
	const active = mapped.length;
	const status = parseStatus(raw.entity_status);
	const restoreTarget = restoreTargetOf(status, raw.restore_target);
	const avatarRef = raw.avatar_file_id ? media.get(raw.avatar_file_id) : undefined;
	const bannerRef = raw.banner_file_id ? media.get(raw.banner_file_id) : undefined;

	return {
		id: raw.id,
		kind,
		name: clampOr(raw.name, 120, kind === "team" ? "Team" : "Business"),
		handle: clamp(raw.handle, 40),
		avatar: avatarOf(mediaUrl(avatarRef, "md")),
		banner: avatarOf(mediaUrl(bannerRef, "lg")),
		tagline: clamp(raw.headline, 160),
		status,
		visibility: WorkspaceVisibility.catch("invite_only").parse(raw.visibility),
		verification,
		verificationPrompt: verificationPrompt(kind, verification),
		createdAt: isoOf(raw.created_at),
		viewerRoleId: raw.viewer?.role_id ?? "",
		viewerMemberId: raw.viewer?.member_id ?? "",
		viewerCapabilities: viewerCaps,
		isActing: actor.contextType === kind && actor.contextId === raw.id,
		members: mapped,
		roles,
		invites: (raw.invites ?? []).map((i) =>
			toOutgoingInvite(i, i.target_user_id ? people.get(i.target_user_id) : undefined, nowMs)
		),
		seats: kind === "team" ? seatsOf(raw.seats) : null,
		payout: teamMoney ? buildPayoutPolicy(moneyMembers, teamMoney) : null,
		spend: spend
			? buildSpendPolicy(spend, moneyMembers, people, verification, nowMs, {
				businessId: raw.id,
				handle: clamp(raw.handle, 40),
			})
			: null,
		finance,
		moneyTiles: kind === "business" ? (raw.money_tiles ?? []).map(toMoneyTile) : [],
		viewerCan: kind === "business" ? viewerCan : null,
		kyb: kind === "business" ? toKyb(raw.kyb, raw.id, viewerCan.startKyb, isPaymentsLive()) : null,
		projects: projects.map((p) => toProject(p, counterpartyOf(p), nowMs)),
		engagements: engagements.map((e) => toEngagement(e, people, byUser)),
		allowance: kind === "team" ? allowanceOf(raw.allowance) : null,
		archiveBlockers: archiveBlockersOf(raw.archive_blockers),
		restoreTarget,
		activity: visibleActivity(raw.activity ?? [], canOpenFinance(kind, viewerCaps)).map((a, i) =>
			toActivity(a, i, a.actor_user_id ? people.get(a.actor_user_id) : undefined, nowMs)
		),
		setup: setupSteps(kind, raw.handle, {
			entityId: raw.id,
			logo: !!raw.setup?.logo,
			bio: !!raw.setup?.bio,
			activeMembers: active,
			// The read's `invite` fact is "more than one active member OR an invitation pending", so
			// below two members it can only be true for a pending invitation.
			invitePending: active < 2 && !!raw.setup?.invite,
			money: !!raw.setup?.money,
			funded: !!raw.setup?.funded,
			limitsOffered: !!raw.setup?.limits_offered,
			verification,
			published: publishedFact(status),
			viewer: viewerCaps,
			viewerIsOwner,
		}),
		standing: raw.standing ? clamp(raw.standing, 40) : null,
		canPropose: kind === "business" || active >= 2,
	};
}

// #endregion
