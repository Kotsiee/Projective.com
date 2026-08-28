import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { ENTITY_META, ProfileIcon, TIER_META } from "./profile-glyphs.tsx";
import type { ProfileKind, VerificationTier } from "../types/profile-types.ts";

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
						<Icon name="verified" class="pf-tier__mark" filled />
						<span class="pf-tier__label">{TIER_META[tier].label}</span>
					</span>
				</Tooltip>
			))}
		</div>
	);
}

/**
 * EntityBadge — the explicit profile-entity-type mark (root CLAUDE.md — Part 1): a distinct
 * icon + label per {@link ProfileKind} (Freelancer · Client · Team · Business · Organisation) so a
 * visitor can immediately tell the profile type. Sits beside the `@handle` / verification badge in the
 * header. Non-interactive, so it is a tonal chip (not a bordered box, §B.4); the `data-kind` hook lets
 * CSS give each type its own subtle accent tint.
 */
export function EntityBadge(
	{ kind, class: className }: { kind: ProfileKind; class?: string },
): JSX.Element {
	const meta = ENTITY_META[kind];
	return (
		<span
			class={`pf-entity${className ? ` ${className}` : ""}`}
			data-kind={kind}
			aria-label={`Entity type: ${meta.label}`}
		>
			<ProfileIcon name={meta.glyph} class="pf-entity__icon" />
			<span class="pf-entity__label">{meta.label}</span>
		</span>
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
