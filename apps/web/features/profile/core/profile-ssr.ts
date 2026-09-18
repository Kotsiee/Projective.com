import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ProfileTab, ProfileTabPayload, ProfileView } from "@projective/types/profile";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import { DEFAULT_PROJECT_PARAMS } from "@features/projects/core/projects-state.ts";
import { type HireProject, hireProjectsFrom } from "./profile-model.ts";

/**
 * profile-ssr — the SERVER-ONLY bootstrap the `[handle]` middleware + sub-routes use to paint the
 * profile's first byte straight from the fat {@link ProfileBackendService} (no HTTP hop — exactly as
 * the projects feed / detail SSR their first paint). Never imported by an island (it reaches
 * `@server/services`); islands refine via the thin `ProfileService`.
 */

/** Resolve the profile header/overview projection for a `@handle`, or `null` (reserved/unresolved). */
export function resolveProfile(handle: string): ProfileView | null {
	const res = ProfileBackendService.overview(handle);
	return res.ok && res.data ? res.data.profile : null;
}

/** Resolve one profile tab's payload for SSR, or `null` when the handle didn't resolve. */
export function resolveProfileTab(handle: string, tab: ProfileTab): ProfileTabPayload | null {
	const res = ProfileBackendService.tab(handle, tab);
	return res.ok && res.data ? res.data.payload : null;
}

/**
 * Resolve the profile's active service listings for SSR — the Services row above the section tabs
 * and the context bar's spend floor. `[]` when the handle didn't resolve or the entity sells nothing.
 */
export function resolveProfileServices(handle: string): ServiceItem[] {
	const res = ProfileBackendService.services(handle);
	return res.ok && res.data ? res.data.services : [];
}

/**
 * Resolve a profile's digital products for the layout's Products masonry — the region directly
 * beneath Services, on every section. Empty for a buyer entity or an unresolved handle (the layout
 * already 404s the latter through the overview read).
 */
export function resolveProfileProducts(handle: string): ProductItem[] {
	const res = ProfileBackendService.products(handle);
	return res.ok && res.data ? res.data.products : [];
}

/**
 * Resolve the VIEWER's open projects for the hero's Hire control — the engagements they own or
 * administer, across every workspace they belong to, still open to new members. Resolved server-side
 * so the first byte already knows which of the three Hire shapes to paint (§3 gate 11: a control that
 * changes what it does after hydration is a control that was wrong for the first second).
 *
 * Reads the SAME feed the `/projects` lane renders (`ProjectBackendService.list`) under the actor's
 * own JWT, so what the popover offers is exactly what the client would find in their own feed. A
 * guest resolves to `[]` without a read — there is nothing to hire from.
 */
export async function resolveHireProjects(actor: ReadActor): Promise<HireProject[]> {
	if (!actor.userId) return [];
	const res = await ProjectBackendService.list({
		...DEFAULT_PROJECT_PARAMS,
		view: "projects",
		involvement: "owner",
		scope: "global",
		statuses: ["draft", "active", "on_hold"],
	}, actor);
	return res.ok && res.data ? hireProjectsFrom(res.data.items) : [];
}
