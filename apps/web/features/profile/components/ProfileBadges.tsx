import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { ProfileIcon, TIER_META } from "./profile-glyphs.tsx";
import type { VerificationTier } from "../types/profile-types.ts";

/**
 * ProfileBadges — the verification-tier marks + online-status pill shared by the meta rail and the
 * header. Tier badges are icon-led with a portal {@link Tooltip} carrying the full title (§B.6
 * icon-first: the explaining words live in the tooltip, not inline). The online dot is a non-color
 * status channel paired with a visible label (§B.4).
 */

/** The attained verification tiers, rendered in ladder order (L1 → Architect). */
export function TierBadges(
	{ tiers, size = "md" }: { tiers: VerificationTier[]; size?: "sm" | "md" },
): JSX.Element | null {
	if (!tiers.length) return null;
	return (
		<div class="pf-tiers" role="list" aria-label="Verification tiers" data-size={size}>
			{tiers.map((tier) => (
				<Tooltip key={tier} content={TIER_META[tier].title} placement="top">
					<span
						class="pf-tier"
						role="listitem"
						data-tier={tier}
						aria-label={TIER_META[tier].title}
					>
						<ProfileIcon name="verified" class="pf-tier__mark" />
						<span class="pf-tier__label">{TIER_META[tier].label}</span>
					</span>
				</Tooltip>
			))}
		</div>
	);
}

/** Live online-status pill — dot (non-color channel) + a visible label. */
export function OnlineStatus(
	{ online, label }: { online: boolean; label?: string },
): JSX.Element {
	return (
		<span class="pf-online" data-online={online ? "true" : "false"}>
			<span class="pf-online__dot" aria-hidden="true" />
			<span class="pf-online__label">{label ?? (online ? "Online now" : "Offline")}</span>
		</span>
	);
}
