import type { SupabaseClient } from "supabaseClient";
import type {
	ApplyMedia,
	ProfileOwnerType,
	ProfileSavePatch,
	SaveShowcase,
	ShowcaseSlot,
} from "@projective/types/profile";
import type { ImagePlaceholder as ProfileImagePlaceholder } from "@projective/types/files";
import { fail, type FieldErrors, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { MediaRejectedError, MediaUnavailableError } from "../media/pipeline.ts";
import { readLibrarySource } from "../media/library.ts";
import {
	cutShowcaseRendition,
	type Rendition,
	retireRendition,
	writeRendition,
} from "../media/showcase-rendition.ts";
import { mediaPlaceholder, mediaUrl, parseMediaRef } from "../files/public-media.ts";
import { showcaseSlotsOf } from "./live-profile.ts";

/**
 * live-profile-writes — every OWNER write to a profile, live.
 *
 * The profile tables carry no client write policy at all: the only doors are the definer RPCs
 * (`org.save_profile`, `org.set_profile_avatar`, `org.save_showcase`), each of which re-checks that
 * the caller MANAGES the profile (`org.fn_profile_manages`) and every hard limit, whatever the route
 * already validated. So every write here is made under the caller's own session and a refusal from
 * the database is the final word, mapped onto a field-keyed {@link ServiceResult} by
 * {@link refusalFrom}.
 *
 * Media is the one two-stage write. The pipeline (service role) cuts a public RENDITION from one of
 * the caller's own library assets and records it (`media/showcase-rendition.ts`, shared with the
 * listing showcase); only then does the definer RPC — under the caller's session — decide whether
 * that rendition may go on this profile. If it refuses, the rendition is retired again, so a refused
 * write never leaves a public object behind.
 */

// #region Types

/** The profile a write is addressed to — resolved from the handle, never taken from the request. */
export interface ProfileOwner {
	type: ProfileOwnerType;
	id: string;
}

/** The profile's media as the editor redraws it after a media write. */
export interface ProfileMediaState {
	avatar: { url: string; full?: string; placeholder?: ProfileImagePlaceholder } | null;
	showcase: ShowcaseSlot[];
}

// #endregion

// #region Refusals

const UNAVAILABLE = "Your changes couldn't be saved right now. Try again in a moment.";

/** `first_name` → `firstName`; a dotted path keeps its index (`experience.2`). */
function camelField(field: string): string {
	const [head, ...rest] = field.split(".");
	const camel = head.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
	return [camel, ...rest].join(".");
}

/**
 * Map a database refusal onto the result a route returns. The definer functions raise `22023` with
 * `<field>: <reason>` and `42501` for authority; anything else is the database being unavailable, and
 * says so rather than blaming the input.
 */
export function refusalFrom(error: { code?: string; message?: string } | null): ServiceResult<never> {
	const message = error?.message ?? "";
	if (error?.code === "PGRST301" || error?.code === "PGRST302" || /jwt/i.test(message)) {
		return fail(401, { message: "Your session has expired. Sign in again to save." });
	}
	const match = /^([a-z_]+(?:\.\d+)?):\s*(.+)$/i.exec(message);
	if (error?.code === "42501") {
		return fail(403, { message: match ? capitalise(match[2]) : "You can't edit this profile." });
	}
	if (error?.code === "22023" || error?.code === "23514" || error?.code === "22P02") {
		if (match) {
			const reason = capitalise(match[2]);
			const errors: FieldErrors = { [camelField(match[1])]: reason };
			return fail(422, { message: reason, errors });
		}
		return fail(422, { message: "Some of these details aren't valid." });
	}
	return fail(503, { message: UNAVAILABLE });
}

function capitalise(s: string): string {
	const trimmed = s.trim();
	return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

function denied(): ServiceResult<never> {
	return fail(401, { message: "Sign in to edit your profile." });
}

// #endregion

// #region Save

/** The snake_case patch `org.save_profile` reads. Only the keys present in `patch` travel. */
export function savePayload(patch: ProfileSavePatch): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const copy = (from: keyof ProfileSavePatch, to: string) => {
		if (patch[from] !== undefined) out[to] = patch[from];
	};
	copy("firstName", "first_name");
	copy("lastName", "last_name");
	copy("name", "name");
	copy("headline", "headline");
	copy("story", "story");
	copy("city", "city");
	copy("country", "country");
	copy("timezone", "timezone");
	copy("visibility", "visibility");
	if (patch.languages) out.languages = patch.languages.map((l) => ({ code: l.code, level: l.level }));
	if (patch.skills) out.skills = patch.skills;
	if (patch.experience) {
		out.experience = patch.experience.map((e) => ({
			id: e.id ?? null,
			org_name: e.orgName,
			role: e.role,
			start_year: e.startYear,
			end_year: e.isCurrent ? null : e.endYear ?? null,
			is_current: e.isCurrent,
			summary: e.summary,
		}));
	}
	if (patch.education) {
		out.education = patch.education.map((d) => ({
			id: d.id ?? null,
			school: d.school,
			credential: d.credential,
			field: d.field,
			start_year: d.startYear,
			end_year: d.endYear ?? null,
		}));
	}
	if (patch.certifications) {
		// `verified` never travels: it is the platform's claim, not the owner's.
		out.certifications = patch.certifications.map((c) => ({
			id: c.id ?? null,
			name: c.name,
			issuer: c.issuer,
			issued_year: c.issuedYear,
			expires_year: c.expiresYear ?? null,
			credential_url: c.credentialUrl ?? null,
		}));
	}
	if (patch.settings) {
		const s = patch.settings;
		out.settings = {
			...(s.allowAvatarExpand !== undefined ? { allow_avatar_expand: s.allowAvatarExpand } : {}),
			...(s.showLocation !== undefined ? { show_location: s.showLocation } : {}),
			...(s.showLocalTime !== undefined ? { show_local_time: s.showLocalTime } : {}),
		};
	}
	return out;
}

/** Save the owner-editable fields in one transaction. */
export async function saveProfile(
	owner: ProfileOwner,
	patch: ProfileSavePatch,
	actor: ReadActor,
): Promise<ServiceResult<{ saved: true }>> {
	if (!canReadLive(actor)) return denied();
	try {
		const { error } = await getUserClient(actor.accessToken).schema("org").rpc("save_profile", {
			p_owner_type: owner.type,
			p_owner_id: owner.id,
			p_patch: savePayload(patch),
		});
		if (error) return refusalFrom(error);
		return ok({ saved: true as const });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion

// #region Media state

interface RawMediaState {
	avatar: unknown;
	showcase: Array<{ position: number; alt: string; media: unknown }>;
}

/** Read back the profile's media as the editor draws it — what is STORED, after a write. */
export async function readMediaState(
	client: SupabaseClient,
	handle: string,
): Promise<ProfileMediaState | undefined> {
	const { data, error } = await client.schema("org").rpc("get_profile_view", { p_handle: handle });
	if (error || !data) return undefined;
	const raw = data as RawMediaState;
	const avatarRef = parseMediaRef(raw.avatar);
	return {
		avatar: avatarRef
			? {
				url: mediaUrl(avatarRef, "md") ?? "",
				full: mediaUrl(avatarRef, "lg") ?? undefined,
				placeholder: mediaPlaceholder(avatarRef),
			}
			: null,
		showcase: showcaseSlotsOf(raw.showcase ?? []),
	};
}

// #endregion

// #region Apply media

/**
 * Put one of the caller's library assets on the profile — as the profile photo, or into one
 * showcase slot (replacing whatever was there). Answers with the profile's media as now stored.
 */
export async function applyProfileMedia(
	owner: ProfileOwner,
	handle: string,
	input: ApplyMedia,
	actor: ReadActor,
): Promise<ServiceResult<ProfileMediaState>> {
	if (!canReadLive(actor)) return denied();
	const source = await readLibrarySource(actor, input.sourceAssetId);
	if (!source) {
		return fail(404, {
			message: "That file isn't in your library any more.",
			errors: { sourceAssetId: "not_found" },
		});
	}
	if (source.kind === "video" && input.target === "avatar") {
		return fail(422, { message: "A profile photo has to be a still image.", errors: { sourceAssetId: "video" } });
	}

	const client = getUserClient(actor.accessToken);
	let rendition: Rendition;
	if (input.target === "avatar") {
		try {
			rendition = await writeRendition(owner, actor, source, input);
		} catch (error) {
			if (error instanceof MediaRejectedError) {
				return fail(422, { message: error.message, errors: { sourceAssetId: "unsupported" } });
			}
			return fail(503, {
				message: error instanceof MediaUnavailableError ? error.message : UNAVAILABLE,
			});
		}
	} else {
		const cut = await cutShowcaseRendition(input.sourceAssetId, input.crop, actor, {
			owner,
			position: input.position ?? 1,
			stillOnly: "The first slot is your profile's thumbnail and has to be a still image.",
		});
		if (!cut.ok || !cut.data) return fail(cut.status, { message: cut.message, errors: cut.errors });
		rendition = cut.data.rendition;
	}

	try {
		if (input.target === "avatar") {
			const { error } = await client.schema("org").rpc("set_profile_avatar", {
				p_owner_type: owner.type,
				p_owner_id: owner.id,
				p_file_id: rendition.id,
			});
			if (error) {
				await retireRendition(rendition);
				return refusalFrom(error);
			}
		} else {
			const current = await client.schema("org").from("profile_showcase_items")
				.select("position, file_id, alt")
				.eq("owner_type", owner.type)
				.eq("owner_id", owner.id);
			if (current.error) {
				await retireRendition(rendition);
				return fail(503, { message: UNAVAILABLE });
			}
			const position = input.position ?? 1;
			const rows = (current.data ?? []) as Array<{ position: number; file_id: string; alt: string }>;
			const previous = rows.find((r) => r.position === position);
			const slots = [
				...rows.filter((r) => r.position !== position).map((r) => ({
					position: r.position,
					file_id: r.file_id,
					alt: r.alt,
				})),
				{ position, file_id: rendition.id, alt: input.alt ?? previous?.alt ?? "" },
			].sort((a, b) => a.position - b.position);
			const { error } = await client.schema("org").rpc("save_showcase", {
				p_owner_type: owner.type,
				p_owner_id: owner.id,
				p_slots: slots,
			});
			if (error) {
				await retireRendition(rendition);
				return refusalFrom(error);
			}
		}
	} catch {
		await retireRendition(rendition);
		return fail(503, { message: UNAVAILABLE });
	}

	const state = await readMediaState(client, handle);
	return state ? ok(state) : fail(503, { message: UNAVAILABLE });
}

// #endregion

// #region Showcase grid

/**
 * Save the whole showcase grid — used to empty a slot, move items between slots or edit alt text.
 * Every file must already be one of this profile's showcase renditions; the database checks it.
 */
export async function saveShowcaseGrid(
	owner: ProfileOwner,
	handle: string,
	input: SaveShowcase,
	actor: ReadActor,
): Promise<ServiceResult<ProfileMediaState>> {
	if (!canReadLive(actor)) return denied();
	try {
		const client = getUserClient(actor.accessToken);
		const { error } = await client.schema("org").rpc("save_showcase", {
			p_owner_type: owner.type,
			p_owner_id: owner.id,
			p_slots: input.slots.map((s) => ({ position: s.position, file_id: s.fileId, alt: s.alt })),
		});
		if (error) return refusalFrom(error);
		const state = await readMediaState(client, handle);
		return state ? ok(state) : fail(503, { message: UNAVAILABLE });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion

// #region Follow

/**
 * Follow or unfollow a profile as the caller. Idempotent both ways: a repeat follow adds no second
 * edge (the table is unique on the pair) and unfollowing somebody not followed is a no-op. Answers
 * with the follower count as it now stands.
 */
export async function setFollow(
	owner: ProfileOwner,
	follow: boolean,
	actor: ReadActor,
): Promise<ServiceResult<{ follows: boolean; followers: number }>> {
	if (!canReadLive(actor)) return fail(401, { message: "Sign in to follow." });
	if (owner.type === "user" && owner.id === actor.userId) {
		return fail(422, { message: "You can't follow yourself." });
	}
	try {
		const client = getUserClient(actor.accessToken);
		const table = client.schema("org").from("profile_follows");
		const write = follow
			? await table.upsert(
				{ follower_user_id: actor.userId, target_entity_type: owner.type, target_entity_id: owner.id },
				{ onConflict: "follower_user_id,target_entity_type,target_entity_id", ignoreDuplicates: true },
			)
			: await table.delete()
				.eq("follower_user_id", actor.userId)
				.eq("target_entity_type", owner.type)
				.eq("target_entity_id", owner.id);
		if (write.error) return refusalFrom(write.error);
		const count = await client.schema("org").from("profile_follows")
			.select("id", { count: "exact", head: true })
			.eq("target_entity_type", owner.type)
			.eq("target_entity_id", owner.id);
		return ok({ follows: follow, followers: count.count ?? 0 });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion
