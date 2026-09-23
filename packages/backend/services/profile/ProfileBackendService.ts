import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { ANONYMOUS_READER, canReadLive, type ReadActor } from "../read-actor.ts";
import { ExploreBackendService } from "../explore/ExploreBackendService.ts";
import {
	fetchEditModel,
	fetchExperience,
	fetchPastProjects,
	fetchPortfolio,
	fetchProfileView,
	fetchReviews,
	fetchRoster,
} from "./live-profile.ts";
import {
	applyProfileMedia,
	type ProfileMediaState,
	type ProfileOwner,
	refusalFrom,
	saveProfile,
	saveShowcaseGrid,
	setFollow,
} from "./live-profile-writes.ts";
import { fetchOwnerAvailability, saveOwnerAvailability } from "../scheduling/live-owner-availability.ts";
import { readPublicCallOffer } from "../scheduling/live-call-offer.ts";
import {
	type ApplyMedia,
	isReservedHandle,
	type ProfileEditModel,
	type ProfileSavePatch,
	type ProfileTab,
	type ProfileTabPayload,
	type ProfileView,
	type SaveShowcase,
} from "@projective/types/profile";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import type { OwnerAvailability, PublicCallOffer } from "@projective/types/scheduling";

/**
 * ProfileBackendService — the FAT server-side service behind the `/[handle]` public profile and its
 * owner surfaces.
 *
 * Every read is LIVE: the profile is one definer read (`org.get_profile_view`) made under the
 * VIEWER's own session, so the database decides what they may see (a private profile is invisible to
 * everyone but its owner, and the answer for "does not exist" and "may not see" is the same 404) and
 * what their relationship to it is (`viewer.isOwner`, `viewer.follows`). There is no fixture
 * fallback: a database that cannot be reached answers `503`, which the page renders as an error
 * state — never a stand-in profile that looks real and is not.
 *
 * Owner writes go through the definer RPCs under the caller's session; the service resolves the
 * profile from the HANDLE (never from the request body) and refuses early when the database says the
 * caller does not manage it, but the RPCs re-check authority themselves — the service is a courtesy,
 * the database is the gate.
 *
 * Thin routes under `apps/web/routes/api/profile/*` do HTTP parsing + Zod validation and delegate
 * here; the `[handle]` layout and pages call it directly for SSR. Islands never reach it.
 */

// #region Shared

const UNAVAILABLE = "Profiles are unavailable right now. Try again in a moment.";

function reserved(handle: string): ServiceResult<never> {
	return fail(404, { message: `"${handle}" is a reserved route, not a profile.` });
}

function notFound(handle: string): ServiceResult<never> {
	return fail(404, { message: `No profile found for "${handle}".` });
}

function unavailable(): ServiceResult<never> {
	return fail(503, { message: UNAVAILABLE });
}

/** The canonical `@handle` for a raw route segment. */
function atHandle(handle: string): string {
	return `@${handle.replace(/^@+/, "")}`;
}

/**
 * Resolve the profile a write is addressed to, as the caller: its owner, and whether the database
 * says the caller manages it. A profile the caller cannot see is a 404, one they can see but do not
 * manage is a 403.
 */
async function ownedProfile(
	handle: string,
	actor: ReadActor,
): Promise<ServiceResult<{ profile: ProfileView; owner: ProfileOwner }>> {
	if (isReservedHandle(handle)) return reserved(handle);
	if (!canReadLive(actor)) return fail(401, { message: "Sign in to edit your profile." });
	const profile = await fetchProfileView(handle, actor);
	if (profile === undefined) return unavailable();
	if (profile === null || !profile.owner) return notFound(handle);
	if (!profile.viewer?.isOwner) return fail(403, { message: "You can't edit this profile." });
	return ok({ profile, owner: profile.owner });
}

// #endregion

export class ProfileBackendService {
	// #region Reads

	/**
	 * The public profile header + overview projection for a `@handle`, as the actor may see it.
	 * `404` for a reserved, unknown or hidden handle; `503` when the database cannot be reached.
	 */
	static async overview(
		handle: string,
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<{ profile: ProfileView }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		const profile = await fetchProfileView(handle, actor);
		if (profile === undefined) return unavailable();
		if (profile === null) return notFound(handle);
		return ok({ profile });
	}

	/**
	 * The payload for one profile section. Each collection is its own read, in parallel; the Work
	 * section's listings come from the public catalogue (the same corpus `/explore` renders, so a
	 * profile and the card that linked to it agree), everything else from the profile RPCs.
	 */
	static async tab(
		handle: string,
		tab: ProfileTab,
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<{ payload: ProfileTabPayload }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		const at = atHandle(handle);
		const base: ProfileTabPayload = {
			handle: at,
			tab,
			services: [],
			openProjects: [],
			pastProjects: [],
			pieces: [],
			members: [],
			departments: [],
			experience: [],
			education: [],
			certifications: [],
			reviews: [],
			articles: [],
		};

		if (tab === "work") {
			const [listings, pieces, past, roster] = await Promise.all([
				ExploreBackendService.listingsByOwner(at),
				fetchPortfolio(handle, actor),
				fetchPastProjects(handle, actor),
				fetchRoster(handle, actor),
			]);
			if (pieces === null || past === null || roster === null) return notFound(handle);
			if (!listings.ok || !listings.data || pieces === undefined || past === undefined || roster === undefined) {
				return unavailable();
			}
			return ok({
				payload: {
					...base,
					services: listings.data.services,
					openProjects: listings.data.projects.open,
					pastProjects: past,
					pieces,
					members: roster.members,
					departments: roster.departments,
				},
			});
		}

		if (tab === "experience") {
			const exp = await fetchExperience(handle, actor);
			if (exp === undefined) return unavailable();
			if (exp === null) return notFound(handle);
			return ok({
				payload: {
					...base,
					experience: exp.experience,
					education: exp.education,
					certifications: exp.certifications,
				},
			});
		}

		if (tab === "reviews") {
			const [reviews, profile] = await Promise.all([
				fetchReviews(handle, actor),
				fetchProfileView(handle, actor),
			]);
			if (reviews === undefined || profile === undefined) return unavailable();
			if (reviews === null || profile === null) return notFound(handle);
			const helper = profile.rating.asHelper;
			const client = profile.rating.asClient;
			return ok({
				payload: {
					...base,
					reviews,
					reviewSummary: {
						...(helper && helper.count > 0 ? { asHelper: helper } : {}),
						...(client && client.count > 0 ? { asClient: client } : {}),
					},
				},
			});
		}

		// Posts — the profile's published articles, from the public catalogue.
		const listings = await ExploreBackendService.listingsByOwner(at);
		if (!listings.ok || !listings.data) return unavailable();
		return ok({ payload: { ...base, articles: listings.data.articles } });
	}

	/**
	 * The profile's active service listings — the row the layout paints above the section tabs, the
	 * Hire popover's rows and the spend floor. Public catalogue data, so it is read as anyone.
	 */
	static async services(handle: string): Promise<ServiceResult<{ services: ServiceItem[] }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		const res = await ExploreBackendService.listingsByOwner(atHandle(handle));
		if (!res.ok || !res.data) return unavailable();
		return ok({ services: res.data.services });
	}

	/** The profile's digital products — the masonry beneath the Services row. */
	static async products(handle: string): Promise<ServiceResult<{ products: ProductItem[] }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		const res = await ExploreBackendService.listingsByOwner(atHandle(handle));
		if (!res.ok || !res.data) return unavailable();
		return ok({ products: res.data.products });
	}

	/**
	 * The profile's public discovery-call offer, from its owner's published schedule — `null` when
	 * they take no calls (the consultation row is then absent, never disabled).
	 */
	static async callOffer(
		profile: Pick<ProfileView, "owner">,
		actor: ReadActor = ANONYMOUS_READER,
	): Promise<ServiceResult<{ callOffer: PublicCallOffer | null }>> {
		if (!profile.owner) return ok({ callOffer: null });
		const client = canReadLive(actor) ? getUserClient(actor.accessToken) : getAnonClient();
		const offer = await readPublicCallOffer(client, profile.owner);
		if (offer === undefined) return unavailable();
		return ok({ callOffer: offer });
	}

	// #endregion

	// #region The owner's surfaces

	/** Everything the owner's editor is seeded with. `403` for anyone who does not manage it. */
	static async editModel(
		handle: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ model: ProfileEditModel }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to edit your profile." });
		const model = await fetchEditModel(handle, actor);
		if (model === undefined) return unavailable();
		if (model === null) return fail(403, { message: "You can't edit this profile." });
		return ok({ model });
	}

	/**
	 * Save the owner-editable fields. Only the sections in `patch` are written. Answers with the edit
	 * model as now STORED, so the editor adopts the ids new rows were given (and any value the
	 * database normalised) rather than guessing.
	 */
	static async save(
		handle: string,
		patch: ProfileSavePatch,
		actor: ReadActor,
	): Promise<ServiceResult<{ model: ProfileEditModel }>> {
		const target = await ownedProfile(handle, actor);
		if (!target.ok || !target.data) return fail(target.status, { message: target.message });
		const saved = await saveProfile(target.data.owner, patch, actor);
		if (!saved.ok) return fail(saved.status, { message: saved.message, errors: saved.errors });
		const model = await fetchEditModel(handle, actor);
		if (!model) return unavailable();
		return ok({ model }, { message: "Profile saved." });
	}

	/** Put a library asset on the profile as its photo or into a showcase slot. */
	static async applyMedia(
		handle: string,
		input: ApplyMedia,
		actor: ReadActor,
	): Promise<ServiceResult<ProfileMediaState>> {
		const target = await ownedProfile(handle, actor);
		if (!target.ok || !target.data) return fail(target.status, { message: target.message });
		return await applyProfileMedia(target.data.owner, handle, input, actor);
	}

	/** Save the whole showcase grid (empty a slot, move items, edit alt text). */
	static async saveShowcase(
		handle: string,
		input: SaveShowcase,
		actor: ReadActor,
	): Promise<ServiceResult<ProfileMediaState>> {
		const target = await ownedProfile(handle, actor);
		if (!target.ok || !target.data) return fail(target.status, { message: target.message });
		return await saveShowcaseGrid(target.data.owner, handle, input, actor);
	}

	/** The owner's schedule + call settings, for the Availability editor. */
	static async availability(
		handle: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ availability: OwnerAvailability; takesCalls: boolean }>> {
		const target = await ownedProfile(handle, actor);
		if (!target.ok || !target.data || !canReadLive(actor)) {
			return fail(target.status, { message: target.message });
		}
		const { profile, owner } = target.data;
		const takesCalls = profile.kind === "freelancer" || profile.kind === "team";
		const value = await fetchOwnerAvailability(getUserClient(actor.accessToken), owner, {
			takesCalls,
			fallbackTimezone: profile.location.timezone || "Europe/London",
		});
		if (!value) return unavailable();
		return ok({ availability: value, takesCalls });
	}

	/** Save the owner's schedule + call settings in one transaction. */
	static async saveAvailability(
		handle: string,
		value: OwnerAvailability,
		actor: ReadActor,
	): Promise<ServiceResult<{ availability: OwnerAvailability; takesCalls: boolean }>> {
		const target = await ownedProfile(handle, actor);
		if (!target.ok || !target.data || !canReadLive(actor)) {
			return fail(target.status, { message: target.message });
		}
		const { profile, owner } = target.data;
		const takesCalls = profile.kind === "freelancer" || profile.kind === "team";
		if (!takesCalls && value.call) {
			return fail(422, { message: "This profile doesn't take calls.", errors: { call: "not_offered" } });
		}
		const client = getUserClient(actor.accessToken);
		const { error } = await saveOwnerAvailability(client, owner, value);
		if (error) return refusalFrom(error);
		const saved = await fetchOwnerAvailability(client, owner, {
			takesCalls,
			fallbackTimezone: value.timezone,
		});
		if (!saved) return unavailable();
		return ok({ availability: saved, takesCalls }, { message: "Availability saved." });
	}

	/** Follow or unfollow the profile as the caller. */
	static async follow(
		handle: string,
		follow: boolean,
		actor: ReadActor,
	): Promise<ServiceResult<{ follows: boolean; followers: number }>> {
		if (isReservedHandle(handle)) return reserved(handle);
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to follow." });
		const profile = await fetchProfileView(handle, actor);
		if (profile === undefined) return unavailable();
		if (profile === null || !profile.owner) return notFound(handle);
		return await setFollow(profile.owner, follow, actor);
	}

	// #endregion
}
