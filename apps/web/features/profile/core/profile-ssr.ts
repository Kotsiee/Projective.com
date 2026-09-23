import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type {
	ProfileEditModel,
	ProfileTab,
	ProfileTabPayload,
	ProfileView,
} from "@projective/types/profile";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import type { OwnerAvailability, PublicCallOffer } from "@projective/types/scheduling";
import { DEFAULT_PROJECT_PARAMS } from "@features/projects/core/projects-state.ts";
import { type HireProject, hireProjectsFrom } from "./profile-model.ts";

/**
 * profile-ssr — the SERVER-ONLY bootstrap the `[handle]` middleware + sub-routes use to paint the
 * profile's first byte straight from the fat {@link ProfileBackendService} (no HTTP hop — exactly as
 * the projects feed / detail SSR their first paint). Never imported by an island (it reaches
 * `@server/services`); islands refine via the thin `ProfileService`.
 *
 * Every read is made AS the viewer ({@link ReadActor}): the database decides what they may see and
 * whether they own the profile, so the owner chrome is unlocked by the database's answer, never by
 * the unverified chrome token.
 */

/** A profile read's outcome: the projection, or why there is none. */
export interface ProfileResolution {
	profile: ProfileView | null;
	/** `404` for a handle that names nothing the viewer may see; `503` when it could not be read. */
	status: 200 | 404 | 503;
}

/** Resolve the profile header/overview projection for a `@handle`, as the viewer may see it. */
export async function resolveProfile(handle: string, actor: ReadActor): Promise<ProfileResolution> {
	const res = await ProfileBackendService.overview(handle, actor);
	if (res.ok && res.data) return { profile: res.data.profile, status: 200 };
	return { profile: null, status: res.status === 503 ? 503 : 404 };
}

/** Resolve one profile section's payload for SSR, or `null` when it could not be read. */
export async function resolveProfileTab(
	handle: string,
	tab: ProfileTab,
	actor: ReadActor,
): Promise<ProfileTabPayload | null> {
	const res = await ProfileBackendService.tab(handle, tab, actor);
	return res.ok && res.data ? res.data.payload : null;
}

/**
 * Resolve the profile's active service listings for SSR — the Services row above the section tabs
 * and the context bar's spend floor. `[]` when the entity sells nothing or they could not be read.
 */
export async function resolveProfileServices(handle: string): Promise<ServiceItem[]> {
	const res = await ProfileBackendService.services(handle);
	return res.ok && res.data ? res.data.services : [];
}

/**
 * Resolve a profile's digital products for the layout's Products masonry — the region directly
 * beneath Services, on every section.
 */
export async function resolveProfileProducts(handle: string): Promise<ProductItem[]> {
	const res = await ProfileBackendService.products(handle);
	return res.ok && res.data ? res.data.products : [];
}

/**
 * Resolve a seller's public call offer for SSR — the Hire popover's "Book consultation" row and the
 * consultation modal it opens. Read live from the owner's published schedule, the SAME reader the
 * listing Contact menu and the slot grid use, so the three cannot disagree. `null` when they take no
 * calls (the row is then absent, never disabled).
 */
export async function resolveConsultationOffer(
	profile: ProfileView,
	actor: ReadActor,
): Promise<PublicCallOffer | null> {
	const res = await ProfileBackendService.callOffer(profile, actor);
	return res.ok && res.data ? res.data.callOffer : null;
}

/**
 * Resolve the VIEWER's open projects for the hero's Add-to-project control — the engagements they
 * own or administer, across every workspace they belong to, still open to new members, published
 * first. Resolved server-side so the first byte already paints the popover's rows (§3 gate 11: a
 * control that changes what it does after hydration is a control that was wrong for the first
 * second).
 *
 * Reads the SAME feed the `/projects` lane renders (`ProjectBackendService.list`) under the actor's
 * own JWT — `involvement: "owner"` is the feed's own "engagements I own, commission or administer"
 * axis, which is exactly "projects I may hire into" — so what the popover offers is what the client
 * would find in their own feed. A guest resolves to `[]` without a read.
 *
 * `handle` is the seller on whose page the rows render: their re-invitation cooldowns (a declined
 * invitation inside the last 48 days, per project) ride the rows so a locked project paints
 * disabled in the first byte rather than refusing on press.
 */
export async function resolveHireProjects(
	actor: ReadActor,
	handle: string,
): Promise<HireProject[]> {
	if (!actor.userId) return [];
	const [res, cooldowns] = await Promise.all([
		ProjectBackendService.list({
			...DEFAULT_PROJECT_PARAMS,
			view: "projects",
			involvement: "owner",
			scope: "global",
			statuses: ["draft", "active", "on_hold"],
		}, actor),
		ProjectBackendService.hireCooldowns(handle, actor),
	]);
	return res.ok && res.data ? hireProjectsFrom(res.data.items, cooldowns) : [];
}

/** The owner editor's seed — `null` with the status when the viewer may not edit this profile. */
export async function resolveEditModel(
	handle: string,
	actor: ReadActor,
): Promise<{ model: ProfileEditModel | null; status: number }> {
	const res = await ProfileBackendService.editModel(handle, actor);
	return res.ok && res.data ? { model: res.data.model, status: 200 } : { model: null, status: res.status };
}

/** The owner's schedule + call settings for the Availability editor. */
export async function resolveOwnerAvailability(
	handle: string,
	actor: ReadActor,
): Promise<{ availability: OwnerAvailability | null; takesCalls: boolean; status: number }> {
	const res = await ProfileBackendService.availability(handle, actor);
	return res.ok && res.data
		? { availability: res.data.availability, takesCalls: res.data.takesCalls, status: 200 }
		: { availability: null, takesCalls: false, status: res.status };
}
