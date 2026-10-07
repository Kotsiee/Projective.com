import type { JSX } from "preact";
import { VerificationStampBadge } from "@projective/ui/display";
import type { IconSize } from "@projective/ui/icons";
import { stampForVerifiedOwner, type VerificationStamp } from "@projective/types/org";

/**
 * VerifiedBadge — the verification crest beside a verified owner's name on discovery and listing
 * surfaces, sized to the explore ramp.
 *
 * A thin wrapper over {@link VerificationStampBadge} (Decision #155): the crest is the one for the
 * owner's verification AUTHORITY. A surface that has the profile read's stamp passes it; one that
 * knows only `verified` and the owner's kind gets {@link stampForVerifiedOwner} — corporate for a
 * business, identity for anyone else — and never a payout claim it cannot see.
 */
export function VerifiedBadge(
	{ size = "sm", kind = "user", stamp }: {
		size?: "sm" | "md" | "lg";
		/** The owner's kind (`freelancer`, `team`, `business`, …) when no stamp is known. */
		kind?: string;
		/** The owner's stamp, when the surface has it. */
		stamp?: VerificationStamp;
	},
): JSX.Element | null {
	const iconSize: IconSize = size === "lg" ? "lg" : size === "md" ? "md" : "sm";
	return (
		<VerificationStampBadge
			stamp={stamp ?? stampForVerifiedOwner(true, kind)}
			size={iconSize}
			class={`ex-verified ex-verified--${size}`}
		/>
	);
}
