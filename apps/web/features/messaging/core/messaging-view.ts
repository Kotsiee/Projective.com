import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { MessagingRole } from "../types/messaging-types.ts";

/**
 * messaging-view — the shipping-safe consumer of the Dev-Tools context seam for the `/messages` inbox
 * view (`messagingRole`). It imports ONLY from `@web/utils/dev-seam.ts` (never `features/devtools/*`),
 * so the build-excluded dev code never leaks into the production bundle (mirrors `session-model.ts` /
 * `submission-access.ts`). In production the seam is always absent, so every read returns the SSR
 * baseline unchanged.
 *
 * The dev override lets a developer flip the inbox between the freelancer-side and client/business-side
 * advanced-filter sets (+ the auto-response offer) without re-authenticating (task §4).
 */

/** The effective inbox view: the dev override when present, else the SSR baseline. */
export function liveMessagingRole(base: MessagingRole, seam: DevSeamState | null): MessagingRole {
	return seam?.messagingRole ?? base;
}

export { readDevSeam, subscribeDevSeam };
export type { DevSeamState };
