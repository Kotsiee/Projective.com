import {
	effectivePermissions,
	type WorkspaceDetail,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { fetchPartyCards } from "../profile/party-cards.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { clamp, clampOr } from "../../core/text.ts";
import { callRpc, clientFor, type LiveActor } from "./live-support.ts";
import {
	buildPayoutPolicy,
	buildSpendPolicy,
	type BusinessMoneyFacts,
	businessMoneyPeople,
	contributedBy,
	limitFor,
	type MoneyMember,
	readBusinessMoney,
	readFinanceTiles,
	readTeamMoney,
	type TeamMoneyFacts,
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
	type RawDetail,
	type RawDetailAnswer,
	type RawProject,
	setupSteps,
	toActivity,
	toOutgoingInvite,
	toProject,
	toRoleDef,
	verificationPrompt,
	workloadPercent,
} from "./mappers.ts";

/**
 * live-detail — one entity's full console projection, read live.
 *
 * `org.get_workspace_detail` answers the raw facts under the caller's session (a non-member is
 * `forbidden`, an unknown reference `not_found`); this module then resolves, in two parallel waves,
 * everything the facts only point at: the money policy and tiles, the entity's marks, the
 * counterparties of its projects, and — in ONE `org.get_party_cards` batch — every person named
 * anywhere on the page.
 *
 * A request-scoped memo ({@link memoised}) collapses the several reads one page render makes (the
 * layout, its header and lane slots, the page) onto one, provided they share the request's actor
 * object. Every write clears it, so a write never answers with the projection from before it.
 */

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

/** Public directory rows (`org.profiles_index`) for a set of entity ids — name and mark. */
async function directoryFaces(
	actor: LiveActor,
	entityIds: readonly string[],
): Promise<Map<string, Counterparty>> {
	const out = new Map<string, Counterparty>();
	const ids = [...new Set(entityIds.filter((id) => id.length > 0))];
	if (ids.length === 0) return out;
	const { data, error } = await clientFor(actor).schema("org").from("profiles_index")
		.select("entity_id, name, avatar_bucket, avatar_path").in("entity_id", ids);
	if (error) return out;
	for (
		const row of (data ?? []) as {
			entity_id: string;
			name: string | null;
			avatar_bucket: string | null;
			avatar_path: string | null;
		}[]
	) {
		if (!row.name) continue;
		out.set(row.entity_id, {
			name: row.name,
			avatar: row.avatar_bucket && row.avatar_path
				? publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? ""
				: "",
		});
	}
	return out;
}

/** The providers staffing a business's projects, by project slug — as far as the caller may see them. */
interface ProviderRefs {
	bySlug: Map<string, { userIds: string[]; teamIds: string[] }>;
}

const DEAD_ASSIGNMENT = new Set(["declined", "cancelled", "released"]);

async function providerRefs(
	actor: LiveActor,
	projects: readonly RawProject[],
): Promise<ProviderRefs> {
	const bySlug = new Map<string, { userIds: string[]; teamIds: string[] }>();
	const slugs = projects.map((p) => p.slug).filter((s) => !!s);
	if (slugs.length === 0) return { bySlug };
	const { data, error } = await clientFor(actor).schema("projects").from("projects")
		.select(
			"slug, project_stages(stage_assignments(assignee_type, freelancer_profile_id, team_id, status))",
		)
		.in("slug", slugs);
	if (error) return { bySlug };
	type Row = {
		slug: string;
		project_stages: {
			stage_assignments: {
				assignee_type: string;
				freelancer_profile_id: string | null;
				team_id: string | null;
				status: string;
			}[];
		}[];
	};
	for (const row of (data ?? []) as Row[]) {
		const userIds = new Set<string>();
		const teamIds = new Set<string>();
		for (const stage of row.project_stages ?? []) {
			for (const a of stage.stage_assignments ?? []) {
				if (DEAD_ASSIGNMENT.has(a.status)) continue;
				if (a.team_id) teamIds.add(a.team_id);
				else if (a.freelancer_profile_id) userIds.add(a.freelancer_profile_id);
			}
		}
		bySlug.set(row.slug, { userIds: [...userIds], teamIds: [...teamIds] });
	}
	return { bySlug };
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
	const res = await callRpc<RawDetailAnswer>(actor, "org", "get_workspace_detail", {
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

	// Wave 1 — everything the raw facts point at, in parallel.
	const [teamMoney, businessMoney, finance, media, clients, providers] = await Promise.all([
		kind === "team" ? readTeamMoney(actor, raw.id) : Promise.resolve<TeamMoneyFacts | null>(null),
		kind === "business"
			? readBusinessMoney(actor, raw.id)
			: Promise.resolve<BusinessMoneyFacts | null>(null),
		readFinanceTiles(actor, kind, raw.id),
		fetchPublicMedia(clientFor(actor), [raw.avatar_file_id, raw.banner_file_id]),
		kind === "team"
			? directoryFaces(actor, projects.map((p) => p.client_business_id ?? ""))
			: Promise.resolve(new Map<string, Counterparty>()),
		kind === "business"
			? providerRefs(actor, projects)
			: Promise.resolve<ProviderRefs>({ bySlug: new Map() }),
	]);

	// Wave 2 — every person the page names, in one batch, plus any provider teams.
	const providerTeamIds = [...providers.bySlug.values()].flatMap((p) => p.teamIds);
	const userIds = [
		...members.map((m) => m.user_id),
		...(raw.invites ?? []).map((i) => i.target_user_id ?? ""),
		...(raw.activity ?? []).map((a) => a.actor_user_id ?? ""),
		...projects.map((p) => p.owner_user_id ?? ""),
		...[...providers.bySlug.values()].flatMap((p) => p.userIds),
		...(businessMoney ? businessMoneyPeople(businessMoney) : []),
	];
	const [cards, providerTeams] = await Promise.all([
		fetchPartyCards(clientFor(actor), userIds),
		directoryFaces(actor, providerTeamIds),
	]);
	const people = new Map<string, Person>();
	for (const [id, card] of cards) {
		people.set(id, { username: card.username, name: card.name, avatar: card.avatar });
	}

	// Members, with their effective capabilities resolved once for every money rule below.
	const mapped: WorkspaceMember[] = [];
	const moneyMembers: MoneyMember[] = [];
	for (const m of members) {
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
		moneyMembers.push({ memberId: m.id, userId: m.user_id, isOwner, person, capabilities });
		const agreement = teamMoney?.agreements.get(m.user_id);
		const limit = businessMoney ? limitFor(businessMoney, m.user_id) : undefined;
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
			workload: workloadPercent(m.workload_current, m.workload_max),
			availability: availabilityOf(m.availability),
			isSelf: !!m.is_self,
			spendLimitMinor: limit && limit.cap_cents !== null && limit.cap_cents !== undefined
				? Number(limit.cap_cents)
				: null,
			contributedMinor: businessMoney ? contributedBy(businessMoney, m.user_id) : 0,
			shareBp: Math.max(0, Math.min(10_000, agreement?.bp ?? 0)),
			shareHeld: agreement?.held ?? false,
			reportsTo: m.reports_to ?? null,
		});
	}

	const counterpartyOf = (project: RawProject): { name: string; avatar: string } => {
		const owner = project.owner_user_id ? people.get(project.owner_user_id) : undefined;
		const fromOwner = { name: owner?.name ?? "", avatar: avatarOf(owner?.avatar) };
		if (kind === "team") {
			const client = project.client_business_id
				? clients.get(project.client_business_id)
				: undefined;
			return client ?? fromOwner;
		}
		const refs = providers.bySlug.get(project.slug);
		const faces: Counterparty[] = [
			...(refs?.teamIds ?? []).map((id) => providerTeams.get(id)).filter((f): f is Counterparty =>
				!!f
			),
			...(refs?.userIds ?? []).map((id) => people.get(id)).filter((p): p is Person => !!p)
				.map((p) => ({ name: p.name, avatar: avatarOf(p.avatar) })),
		];
		return namesLine(faces) ?? fromOwner;
	};

	const viewerCaps = parseCapabilities(raw.viewer?.capabilities);
	const active = mapped.length;
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
		status: parseStatus(raw.entity_status),
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
		payout: teamMoney ? buildPayoutPolicy(moneyMembers, teamMoney) : null,
		spend: businessMoney
			? buildSpendPolicy(moneyMembers, businessMoney, people, verification, nowMs)
			: null,
		finance,
		projects: projects.map((p) => toProject(p, counterpartyOf(p), nowMs)),
		activity: (raw.activity ?? []).map((a, i) =>
			toActivity(a, i, a.actor_user_id ? people.get(a.actor_user_id) : undefined, nowMs)
		),
		setup: setupSteps(kind, raw.handle, {
			logo: !!raw.setup?.logo,
			bio: !!raw.setup?.bio,
			invite: !!raw.setup?.invite,
			money: !!raw.setup?.money,
			verified: verification === "verified",
		}),
		standing: raw.standing ? clamp(raw.standing, 40) : null,
		canPropose: kind === "business" || active >= 2,
	};
}

// #endregion
