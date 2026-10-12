import type { JSX } from "preact";
import { VerificationStampBadge } from "@projective/ui/display";
import type { IconSize } from "@projective/ui/icons";
import { ownerVerificationStamp, type VerifiableOwner } from "@projective/types/org";

/**
 * VerifiedBadge — the verification crest beside an owner's name on discovery and listing surfaces
 * (explore cards, owner bylines, review authors, article bylines, the landing profile cards), sized to
 * the explore ramp.
 *
 * A thin wrapper over {@link VerificationStampBadge} (Decision #155), the one crest component the
 * profile hero and its sticky band render too. It takes the OWNER, not a boolean, and resolves the
 * crest through {@link ownerVerificationStamp}: the owner's projected stamp (the authority its profile
 * hero draws) when the producer read one, else the identity ⁄ corporate fallback. An unverified owner
 * renders nothing, so a call site never guards it.
 *
 * Colour is the shared stamp ink (`--primary` identity · `--tertiary` payout · `--on-surface-variant`
 * corporate) — a call site sets only the knockout ground, never the ink, so a crest reads the same on
 * `/explore` as on `/[handle]`.
 */
export function VerifiedBadge(
	{ owner, size = "sm" }: {
		/** The owner attribution — its `verified` flag, kind and (when known) verification stamp. */
		owner: VerifiableOwner;
		size?: "sm" | "md" | "lg";
	},
): JSX.Element | null {
	const iconSize: IconSize = size === "lg" ? "lg" : size === "md" ? "md" : "sm";
	return (
		<VerificationStampBadge
			stamp={ownerVerificationStamp(owner)}
			size={iconSize}
			class={`ex-verified ex-verified--${size}`}
		/>
	);
}
