import type { UserContext } from "@projective/types/auth";
import { normalizeHandle } from "@projective/types/profile";
import { profileHandleOf } from "@features/explore/core/routing.ts";

/**
 * explore-surface — the ONE answer to "is the reader on Explore's territory", read by the desktop
 * rail (`nav-model.ts`) and the mobile bottom bar (`bottom-nav-model.tsx`) so the two can never
 * light Explore on different pages. Kept apart from both because both build glyph VNodes, which
 * puts a CSS import in their graph; this module is pure, so it is the one a test can reach.
 */

/** True when `path` is `base` or a descendant of it. */
function under(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/**
 * Whether `path` is a profile in the `/[handle]` namespace that the acting context does NOT own —
 * i.e. somebody else's page, which the navigation counts as Explore territory. The viewer's OWN
 * profile (`/@me`) is not a discovery destination and lights nothing.
 *
 * Ownership is decided on the chrome context's `handle` alone. It is the one identity fact the
 * navigation has (the JWT stamps it; `resolveUserContext` falls back to the username), and a
 * skeleton token that carries none resolves every profile as somebody else's — a lit Explore item
 * on your own page, which is a cosmetic miss, where the reverse (an unlit rail on every stranger's
 * page) is the defect this exists to close.
 */
export function isForeignProfilePath(
	path: string,
	context: Pick<UserContext, "handle">,
): boolean {
	const handle = profileHandleOf(path);
	if (handle === null) return false;
	return !context.handle || normalizeHandle(context.handle) !== handle;
}

/**
 * Whether `path` belongs to the Explore tree as the navigation sees it: `/explore` itself, the
 * entity viewer it opens into (`/view/[id]` — every card on `/explore` links there and it carries no
 * rail entry of its own), or another entity's profile (the other thing a card opens).
 */
export function isExploreSurface(path: string, context: Pick<UserContext, "handle">): boolean {
	return under(path, "/explore") || under(path, "/view") || isForeignProfilePath(path, context);
}
