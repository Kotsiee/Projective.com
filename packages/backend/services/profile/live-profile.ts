import type { SupabaseClient } from "supabaseClient";
import {
	type CertificationEntry,
	DEFAULT_PROFILE_SETTINGS,
	type DepartmentEntry,
	type EducationEntry,
	type ExperienceEntry,
	type LanguageLevel,
	type MemberEntry,
	type ProfileEditModel,
	type ProfileKind,
	type ProfileLanguage,
	type ProfileOwnerType,
	type ProfileSettings,
	type ProfileShowcase,
	type ProfileShowcaseItem,
	type ProfileView,
	ProfileVisibility,
	type ReviewEntry,
	type ShowcaseSlot,
	SHOWCASE_EXTRA_MAX,
	type VerificationTier,
	type WorkPiece,
} from "@projective/types/profile";
import { IntakeFieldSchema } from "@projective/types/services";
import type { MediaRef } from "@projective/types/files";
import type { ExploreOwner, ProjectItem } from "@projective/types/explore";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { resolveSkill } from "../explore/skills.ts";
import { displayPrice } from "../explore/live-catalog.ts";
import { flattenRichText, type RichTextInput } from "@projective/types/richtext";
import {
	isVideoMedia,
	mediaAspect,
	mediaPlaceholder,
	mediaSrcset,
	mediaUrl,
	parseMediaRef,
} from "../files/public-media.ts";

/**
 * live-profile — the LIVE read of a public profile: the `org.get_profile_*` definer RPCs, mapped
 * onto the `ProfileView` / tab-payload Zod SSOT.
 *
 * The RPCs return raw facts (a bio document, skill labels, language codes, storage refs); every
 * presentational decision — URLs, tiers, labels, the trust ladder — is made here, once. They also
 * decide VISIBILITY themselves (a private profile is null to everyone but its owner) and the
 * viewer's relationship to the profile, under the viewer's own verified session.
 *
 * Every function returns `undefined` when the live path could not answer (the database is down, the
 * RPC failed) and `null` when the database answered "no such profile" — the service keeps the two
 * apart, because the first is a 503 and the second a real 404.
 */

// #region Client + call

/**
 * The client a read runs as: the viewer's own (so the RPCs see who is asking) or the anonymous one.
 * A read is never made with the service role — the RPCs' visibility rules must see the real caller.
 */
function clientFor(actor: ReadActor): SupabaseClient {
	return canReadLive(actor) ? getUserClient(actor.accessToken) : getAnonClient();
}

/** An expired or rejected session token. The public read then retries as a guest. */
function isAuthFailure(error: { code?: string; message?: string } | null): boolean {
	if (!error) return false;
	return error.code === "PGRST301" || error.code === "PGRST302" ||
		/jwt|token|expired|unauthori[sz]ed/i.test(error.message ?? "");
}

/**
 * Call an `org` RPC as the actor, falling back to an anonymous call when their session token is
 * refused — a stale cookie must not turn a public profile into an error page. Returns `undefined`
 * on failure, else the RPC's data (which may be `null`).
 */
async function orgRpc<T>(
	actor: ReadActor,
	fn: string,
	args: Record<string, unknown>,
): Promise<T | null | undefined> {
	try {
		const first = await clientFor(actor).schema("org").rpc(fn, args);
		if (!first.error) return first.data as T | null;
		if (canReadLive(actor) && isAuthFailure(first.error)) {
			const retry = await getAnonClient().schema("org").rpc(fn, args);
			if (!retry.error) return retry.data as T | null;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

// #endregion

// #region Raw shapes (the RPC's own document)

interface RawRating {
	value: number | string;
	count: number | string;
}

interface RawShowcaseSlot {
	position: number;
	alt: string;
	media: unknown;
}

interface RawProfile {
	owner_type: ProfileOwnerType;
	owner_id: string;
	kind: ProfileKind;
	handle: string;
	name: string | null;
	first_name?: string | null;
	last_name?: string | null;
	headline: string;
	bio: unknown;
	visibility: string;
	city: string | null;
	country: string | null;
	timezone: string | null;
	language_names: string[] | null;
	languages: Array<{ code: string; level: string }>;
	skills: string[];
	avatar: unknown;
	banner: unknown;
	member_since: string;
	rating: { as_helper: RawRating; as_client: RawRating };
	verified: boolean;
	hire_intake: unknown;
	viewer_is_owner: boolean;
	viewer_follows: boolean;
	followers: number;
	following: number;
	showcase: RawShowcaseSlot[];
	settings: { allow_avatar_expand: boolean; show_location: boolean; show_local_time: boolean } | null;
	completed_stages: number;
	standing: { level: number; label: string } | null;
	architect: boolean;
	hours: {
		timezone: string;
		published: boolean;
		rules: Array<{ weekday: number; start_minute: number; end_minute: number; kind: string }>;
	} | null;
	free_consultation: boolean;
}

// #endregion

// #region Small mappers

const LANGUAGE_NAMES = (() => {
	try {
		return new Intl.DisplayNames(["en"], { type: "language" });
	} catch {
		return null;
	}
})();

/** A language code's display name ("fr" → "French"), falling back to the code itself. */
export function languageLabel(code: string): string {
	try {
		return LANGUAGE_NAMES?.of(code.toLowerCase()) ?? code.toUpperCase();
	} catch {
		return code.toUpperCase();
	}
}

const LEVELS: readonly LanguageLevel[] = ["native", "fluent", "professional", "conversational", "basic"];

function toLanguage(row: { code: string; level: string }): ProfileLanguage | null {
	const level = LEVELS.find((l) => l === row.level);
	if (!level || !row.code) return null;
	return { code: row.code.toUpperCase(), label: languageLabel(row.code), level };
}

/**
 * The plain story from a bio document. Three shapes exist: `{ text }` (what `org.save_profile` and
 * the seed write), a Quill Delta `{ ops }`, and `{ html }`. Anything else reads as empty.
 */
export function bioText(bio: unknown): string {
	if (!bio || typeof bio !== "object") return typeof bio === "string" ? bio : "";
	const doc = bio as { text?: unknown; ops?: Array<{ insert?: unknown }>; html?: unknown };
	if (typeof doc.text === "string") return doc.text;
	// The one canonical flattener for the two rich shapes — a hand-rolled tag strip splits a word at
	// every formatting change.
	if (Array.isArray(doc.ops)) return flattenRichText({ ops: doc.ops } as RichTextInput);
	if (typeof doc.html === "string") return flattenRichText(doc.html);
	return "";
}

function num(v: number | string | null | undefined): number {
	const n = typeof v === "string" ? Number(v) : v ?? 0;
	return Number.isFinite(n) ? n : 0;
}

/** The trust ladder the profile has climbed, in ladder order. */
function tiersOf(raw: RawProfile): { tier: VerificationTier; verifications: VerificationTier[] } {
	const ladder: VerificationTier[] = ["L1"];
	const entity = raw.owner_type === "business" || raw.owner_type === "organisation";
	if (raw.verified) ladder.push(entity ? "L3" : "L2");
	if (raw.architect) ladder.push("architect");
	return { tier: ladder[ladder.length - 1], verifications: ladder };
}

function settingsOf(raw: RawProfile["settings"]): ProfileSettings {
	if (!raw) return DEFAULT_PROFILE_SETTINGS;
	return {
		allowAvatarExpand: !!raw.allow_avatar_expand,
		showLocation: raw.show_location !== false,
		showLocalTime: raw.show_local_time !== false,
	};
}

function visibilityOf(raw: string): ProfileView["visibility"] {
	const parsed = ProfileVisibility.safeParse(raw);
	return parsed.success ? parsed.data : "public";
}

// #endregion

// #region Showcase

/** One showcase slide from a stored slot — a still at hero size, or a video with its poster. */
function slideOf(slot: RawShowcaseSlot, ref: MediaRef, name: string): ProfileShowcaseItem {
	const alt = slot.alt?.trim() || `${name} — work`;
	if (isVideoMedia(ref)) {
		return {
			kind: "video",
			src: mediaUrl(ref, null) ?? "",
			poster: mediaUrl(ref, "lg") ?? undefined,
			alt,
			placeholder: mediaPlaceholder(ref),
		};
	}
	return {
		kind: "image",
		src: mediaUrl(ref, "md") ?? "",
		srcset: mediaSrcset(ref),
		alt,
		placeholder: mediaPlaceholder(ref),
	};
}

/**
 * The hero showcase from the stored slots. Slot 1 is the primary; if it is empty (the owner cleared
 * it) the lowest-positioned STILL leads instead, and with no still at all there is nothing a card
 * could lead with, so the showcase is `null` and the hero collapses to one column.
 */
export function showcaseOf(slots: readonly RawShowcaseSlot[], name: string): ProfileShowcase | null {
	const filled = slots
		.map((slot) => ({ slot, ref: parseMediaRef(slot.media) }))
		.filter((s): s is { slot: RawShowcaseSlot; ref: MediaRef } => s.ref !== null)
		.sort((a, b) => a.slot.position - b.slot.position);
	const lead = filled.find((s) => !isVideoMedia(s.ref));
	if (!lead) return null;
	const primary = slideOf(lead.slot, lead.ref, name);
	if (primary.kind !== "image") return null;
	const extras = filled.filter((s) => s !== lead).map((s) => slideOf(s.slot, s.ref, name));
	return { primary: { ...primary, kind: "image" }, extras: extras.slice(0, SHOWCASE_EXTRA_MAX) };
}

/** The editor's grid: every filled slot with its rendition id, thumbnail and playable source. */
export function showcaseSlotsOf(slots: readonly RawShowcaseSlot[]): ShowcaseSlot[] {
	const out: ShowcaseSlot[] = [];
	for (const slot of slots) {
		const ref = parseMediaRef(slot.media);
		if (!ref) continue;
		const video = isVideoMedia(ref);
		out.push({
			position: slot.position,
			fileId: ref.id,
			kind: video ? "video" : "image",
			thumb: mediaUrl(ref, video ? "md" : "sm") ?? "",
			src: video ? mediaUrl(ref, null) ?? "" : mediaUrl(ref, "md") ?? "",
			alt: slot.alt ?? "",
			placeholder: mediaPlaceholder(ref),
		});
	}
	return out.sort((a, b) => a.position - b.position);
}

// #endregion

// #region The profile projection

/** Map the RPC's document onto the `ProfileView` SSOT. Pure — exported for tests. */
export function mapProfileView(raw: RawProfile): ProfileView {
	const name = raw.name?.trim() || raw.handle;
	const avatarRef = parseMediaRef(raw.avatar);
	const bannerRef = parseMediaRef(raw.banner);
	const showcase = showcaseOf(raw.showcase ?? [], name);
	const settings = settingsOf(raw.settings);
	const seller = raw.kind === "freelancer" || raw.kind === "team";
	const helper = { value: num(raw.rating?.as_helper?.value), count: num(raw.rating?.as_helper?.count) };
	const client = { value: num(raw.rating?.as_client?.value), count: num(raw.rating?.as_client?.count) };
	const { tier, verifications } = tiersOf(raw);
	const intake = Array.isArray(raw.hire_intake)
		? raw.hire_intake.map((f) => IntakeFieldSchema.safeParse(f)).filter((r) => r.success).map((r) => r.data!)
		: [];
	const workingHours = (raw.hours?.rules ?? [])
		.filter((r) => r.kind === "working_hours")
		.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute, kind: "working_hours" as const }));
	const timezone = raw.timezone ?? raw.hours?.timezone ?? "";

	return {
		handle: `@${raw.handle}`,
		name,
		kind: raw.kind,
		avatar: mediaUrl(avatarRef, "md") ?? "",
		avatarPlaceholder: mediaPlaceholder(avatarRef),
		avatarFull: mediaUrl(avatarRef, "lg") ?? undefined,
		banner: mediaUrl(bannerRef, "lg") ?? showcase?.primary.src ?? "",
		showcase,
		stats: {
			completedStages: Math.max(0, Math.trunc(num(raw.completed_stages))),
			// Delivered volume is a financial fact with no disclosure setting behind it yet, so it is
			// withheld rather than published by default; the strip renders its absence.
			volumeLabel: null,
			standing: seller && raw.standing ? { level: raw.standing.level, label: raw.standing.label } : null,
		},
		headline: raw.headline ?? "",
		story: bioText(raw.bio),
		skills: (raw.skills ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => resolveSkill(s.trim())),
		languages: (raw.languages ?? []).map(toLanguage).filter((l): l is ProfileLanguage => l !== null),
		// No engagement-derived "worked with" list exists on the live path yet; absent, not invented.
		notableClients: [],
		location: { city: raw.city ?? "", country: raw.country ?? "", timezone },
		// Presence is not tracked; the badge derives from the published hours and the clock instead.
		online: false,
		availabilityLabel: "",
		hasAvailability: !!raw.hours?.published,
		hours: raw.hours && workingHours.length > 0 ? { timezone: raw.hours.timezone, rules: workingHours } : null,
		responseTime: "",
		responseMinutes: null,
		freeConsultation: !!raw.free_consultation,
		hireIntake: seller ? intake : [],
		rating: {
			...(helper.count > 0 || seller ? { asHelper: helper } : {}),
			...(client.count > 0 || !seller ? { asClient: client } : {}),
		},
		verified: !!raw.verified,
		tier,
		verifications,
		followers: num(raw.followers),
		following: num(raw.following),
		memberSince: raw.member_since,
		userId: raw.owner_type === "user" ? raw.owner_id : "",
		metrics: { reviews: helper.count + client.count },
		settings,
		visibility: visibilityOf(raw.visibility),
		owner: { type: raw.owner_type, id: raw.owner_id },
		viewer: { isOwner: !!raw.viewer_is_owner, follows: !!raw.viewer_follows },
	};
}

/**
 * The live profile for a handle: the projection, `null` for an unknown or hidden profile, or
 * `undefined` when the live path could not answer.
 */
export async function fetchProfileView(handle: string, actor: ReadActor): Promise<ProfileView | null | undefined> {
	const raw = await orgRpc<RawProfile>(actor, "get_profile_view", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	return mapProfileView(raw);
}

// #endregion

// #region Section reads

interface RawExperience {
	experience: Array<{
		id: string;
		org_name: string;
		role: string;
		start_year: string;
		end_year: string | null;
		is_current: boolean;
		summary: string;
		logo: unknown;
	}>;
	education: Array<{
		id: string;
		school: string;
		credential: string;
		field: string;
		start_year: string;
		end_year: string | null;
		logo: unknown;
	}>;
	certifications: Array<{
		id: string;
		name: string;
		issuer: string;
		issued_year: string;
		expires_year: string | null;
		credential_url: string | null;
		verified: boolean;
		logo: unknown;
	}>;
}

/** The Experience section — roles, education and certifications as the owner ordered them. */
export async function fetchExperience(
	handle: string,
	actor: ReadActor,
): Promise<
	{ experience: ExperienceEntry[]; education: EducationEntry[]; certifications: CertificationEntry[]; raw: RawExperience } | null | undefined
> {
	const raw = await orgRpc<RawExperience>(actor, "get_profile_experience", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	const logo = (v: unknown) => mediaUrl(parseMediaRef(v), "sm") ?? undefined;
	return {
		raw,
		experience: (raw.experience ?? []).map((e) => ({
			id: e.id,
			org: e.org_name,
			role: e.role,
			start: e.start_year,
			end: e.end_year ?? undefined,
			current: e.is_current,
			summary: e.summary ?? "",
			logo: logo(e.logo),
		})),
		education: (raw.education ?? []).map((d) => ({
			id: d.id,
			school: d.school,
			credential: d.credential,
			field: d.field ?? "",
			start: d.start_year,
			end: d.end_year ?? undefined,
			logo: logo(d.logo),
		})),
		certifications: (raw.certifications ?? []).map((c) => ({
			id: c.id,
			name: c.name,
			issuer: c.issuer,
			issued: c.issued_year,
			expires: c.expires_year ?? undefined,
			verified: !!c.verified,
			logo: logo(c.logo),
			credentialUrl: c.credential_url ?? undefined,
		})),
	};
}

interface RawReview {
	id: string;
	rating: number | string;
	title: string | null;
	comment: string;
	created_at: string;
	author_role: "client" | "freelancer";
	author_handle: string | null;
	author_name: string | null;
	author_avatar: unknown;
	context_title: string | null;
}

/** The reviews the profile received, newest first. */
export async function fetchReviews(handle: string, actor: ReadActor): Promise<ReviewEntry[] | null | undefined> {
	const raw = await orgRpc<RawReview[]>(actor, "get_profile_reviews", { p_handle: handle, p_limit: 60 });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	return raw.map((r) => ({
		id: r.id,
		authorName: r.author_name?.trim() || (r.author_handle ?? "A Projective member"),
		authorHandle: r.author_handle ? `@${r.author_handle}` : "",
		authorAvatar: mediaUrl(parseMediaRef(r.author_avatar), "sm") ?? "",
		role: r.author_role === "client" ? "client" : "freelancer",
		rating: num(r.rating),
		date: r.created_at,
		body: r.comment,
		contextTitle: r.context_title ?? undefined,
	}));
}

interface RawRoster {
	departments: Array<{ name: string; member_count: number }>;
	members: Array<{
		handle: string;
		name: string | null;
		avatar: unknown;
		role: string | null;
		is_freelancer: boolean;
		departments: string[];
	}>;
}

/** Department ids are derived from their names — the catalogue is a name list, not a table. */
export function departmentId(name: string): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "department";
}

/** The roster of a team / business / organisation (empty for an individual). */
export async function fetchRoster(
	handle: string,
	actor: ReadActor,
): Promise<{ members: MemberEntry[]; departments: DepartmentEntry[] } | null | undefined> {
	const raw = await orgRpc<RawRoster>(actor, "get_profile_roster", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	const members: MemberEntry[] = (raw.members ?? []).map((m) => ({
		handle: `@${m.handle}`,
		name: m.name?.trim() || m.handle,
		avatar: mediaUrl(parseMediaRef(m.avatar), "sm") ?? "",
		role: m.role?.trim() || "Member",
		kind: m.is_freelancer ? "freelancer" : "user",
		departments: (m.departments ?? []).map(departmentId),
	}));
	const departments: DepartmentEntry[] = (raw.departments ?? []).map((d) => {
		const id = departmentId(d.name);
		const lead = members.find((m) => m.departments.includes(id) && /lead|head|director/i.test(m.role));
		return { id, name: d.name, memberCount: num(d.member_count), leadHandle: lead?.handle };
	});
	return { members, departments };
}

interface RawPiece {
	id: string;
	title: string;
	client: string | null;
	category: string | null;
	media: unknown;
}

/**
 * The "Selected work" masonry — the owner's own public portfolio pieces.
 *
 * A piece has no page of its own, so its tile opens the piece itself at full size: the largest
 * rendition of a still, or the video. That is a real destination with no script behind it, where a
 * link back to the profile the reader is already on would be a control that does nothing.
 */
export async function fetchPortfolio(handle: string, actor: ReadActor): Promise<WorkPiece[] | null | undefined> {
	const raw = await orgRpc<RawPiece[]>(actor, "get_profile_portfolio", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	const out: WorkPiece[] = [];
	for (const p of raw) {
		const ref = parseMediaRef(p.media);
		if (!ref) continue;
		const video = isVideoMedia(ref);
		const full = video ? mediaUrl(ref, null) : mediaUrl(ref, "lg");
		if (!full) continue;
		out.push({
			id: p.id,
			title: p.title,
			client: p.client ?? undefined,
			category: p.category?.trim() || "Work",
			media: {
				kind: video ? "video" : "image",
				src: video ? full : mediaUrl(ref, "md") ?? full,
				poster: video ? mediaUrl(ref, "md") ?? undefined : undefined,
				placeholder: mediaPlaceholder(ref),
				aspect: mediaAspect(ref) ?? 4 / 3,
				alt: p.title,
			},
			href: full,
		});
	}
	return out;
}

interface RawPastProject {
	slug: string;
	title: string;
	summary: string;
	format: string;
	currency: string;
	budget_amount_cents: number | null;
	created_at: string;
	phases: string[];
	roles: string[];
	skills: string[];
	poster: {
		handle: string;
		name: string;
		kind: ExploreOwner["kind"];
		avatar: unknown;
		verified: boolean;
	} | null;
}

/**
 * The "Completed projects" list: finished, public engagements whose client allows portfolio display,
 * which the profile posted or delivered on. Mapped onto the same `ProjectItem` shape the explore
 * project card renders, so the list reuses the card.
 */
export async function fetchPastProjects(handle: string, actor: ReadActor): Promise<ProjectItem[] | null | undefined> {
	const raw = await orgRpc<RawPastProject[]>(actor, "get_profile_past_projects", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null) return null;
	return raw.flatMap((p): ProjectItem[] => {
		if (!p.poster) return [];
		const owner: ExploreOwner = {
			handle: `@${p.poster.handle}`,
			name: p.poster.name,
			avatar: mediaUrl(parseMediaRef(p.poster.avatar), "sm") ?? "",
			kind: p.poster.kind,
			verified: p.poster.verified,
		};
		return [{
			id: p.slug,
			type: "projects",
			title: p.title,
			owner,
			skills: (p.skills ?? []).slice(0, 8).map(resolveSkill),
			summary: p.summary,
			createdAt: p.created_at,
			org: owner.name,
			stage: "Completed",
			budget: p.budget_amount_cents !== null ? displayPrice(p.budget_amount_cents, p.currency) : "",
			classification: p.format === "pipeline" ? "pipeline" : "one-off",
			roles: p.roles ?? [],
			phases: p.phases ?? [],
		}];
	});
}

// #endregion

// #region The owner's edit model

/**
 * Everything the owner's editor is seeded with. `null` when the profile is unknown, hidden, or the
 * viewer does not manage it — the edit surface never renders someone else's data in a form.
 */
export async function fetchEditModel(
	handle: string,
	actor: ReadActor,
): Promise<ProfileEditModel | null | undefined> {
	const raw = await orgRpc<RawProfile>(actor, "get_profile_view", { p_handle: handle });
	if (raw === undefined) return undefined;
	if (raw === null || !raw.viewer_is_owner) return null;
	const individual = raw.owner_type === "user";
	const exp = individual ? await fetchExperience(handle, actor) : null;
	if (individual && exp === undefined) return undefined;
	const avatarRef = parseMediaRef(raw.avatar);

	return {
		handle: `@${raw.handle}`,
		kind: raw.kind,
		ownerType: raw.owner_type,
		firstName: raw.first_name ?? "",
		lastName: raw.last_name ?? "",
		name: raw.name ?? "",
		headline: raw.headline ?? "",
		story: bioText(raw.bio),
		city: raw.city ?? "",
		country: raw.country ?? "",
		timezone: raw.timezone ?? "",
		visibility: visibilityOf(raw.visibility) ?? "public",
		languages: (raw.languages ?? []).flatMap((l) => {
			const lang = toLanguage(l);
			return lang ? [{ code: lang.code, level: lang.level }] : [];
		}),
		skills: raw.skills ?? [],
		experience: (exp?.raw.experience ?? []).map((e) => ({
			id: e.id,
			orgName: e.org_name,
			role: e.role,
			startYear: e.start_year,
			endYear: e.end_year,
			isCurrent: e.is_current,
			summary: e.summary ?? "",
		})),
		education: (exp?.raw.education ?? []).map((d) => ({
			id: d.id,
			school: d.school,
			credential: d.credential,
			field: d.field ?? "",
			startYear: d.start_year,
			endYear: d.end_year,
		})),
		certifications: (exp?.raw.certifications ?? []).map((c) => ({
			id: c.id,
			name: c.name,
			issuer: c.issuer,
			issuedYear: c.issued_year,
			expiresYear: c.expires_year,
			credentialUrl: c.credential_url,
			verified: c.verified,
		})),
		settings: settingsOf(raw.settings),
		avatar: avatarRef
			? { url: mediaUrl(avatarRef, "md") ?? "", placeholder: mediaPlaceholder(avatarRef) }
			: null,
		showcase: showcaseSlotsOf(raw.showcase ?? []),
		sections: {
			identity: true,
			about: raw.owner_type !== "organisation",
			languages: individual,
			skills: individual && raw.kind === "freelancer",
			experience: individual,
			location: raw.owner_type !== "team",
			// Only a person's profile has the three-way public / unlisted / private reach the editor offers;
			// a team's visibility is a membership question and is managed with the team.
			visibility: individual,
		},
	};
}

// #endregion
