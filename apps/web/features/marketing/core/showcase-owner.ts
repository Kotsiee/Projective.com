import { PROFILES } from "./landing-data.ts";
import type { ExploreOwner } from "@features/explore/types/explore-types.ts";

/**
 * showcase-owner — resolves a landing fixture's `providerHandle` / `makerHandle` into the
 * {@link ExploreOwner} attribution shape the canonical discovery cards render.
 *
 * The landing fixtures were always relationally consistent and never wired up: every `providerHandle`
 * on a {@link ServiceShowcase} and every `makerHandle` on a {@link ProductShowcase} is the `handle` of
 * a real {@link ProfileShowcase}, complete with its display name, avatar and kind. The old
 * `.lp-service` / `.lp-product` cards ignored that and printed the provider as bare, unlinked text —
 * no face, no route to the profile. Resolving the join here means the landing cards show the same
 * linked, avatar-bearing attribution as the search feed from data that already existed, with nothing
 * invented.
 *
 * An unmatched handle degrades to the handle itself rather than throwing: a fixture can gain a service
 * before it gains a profile, and a missing face must never take down the landing page.
 */
export function ownerForHandle(handle: string): ExploreOwner {
	const profile = PROFILES.find((p) => p.handle === handle);
	return {
		handle,
		name: profile?.name ?? handle,
		avatar: profile?.avatar ?? "",
		kind: profile?.kind === "team" ? "team" : "freelancer",
	};
}
