import type { JSX } from "preact";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import type { PresenceTone } from "@web/features/shell/core/account-setup.ts";

// #region Geometry
/**
 * The ring's SVG geometry per avatar size, in the avatar's own pixel grid at the base type scale: the
 * box is the avatar plus `--space-1` on every side (a 2-unit gap and a 2-unit stroke), so the ring
 * scales with the avatar under text zoom rather than drifting onto its face.
 */
const RING = {
	sm: { box: 36, stroke: 2 },
	md: { box: 48, stroke: 2 },
} as const;
// #endregion

/** Props for {@link ProfileProgressAvatar}. */
export interface ProfileProgressAvatarProps {
	/** The person's display name (the avatar's accessible name and initials). */
	label: string;
	/** The profile photo URL, if any. */
	image?: string;
	/** `sm` for the header trigger, `md` for the popover's identity block. */
	size: "sm" | "md";
	/**
	 * Profile completeness, `0`–`100`; `null` draws NO ring — an unmeasured profile is not a 0% one.
	 */
	percent: number | null;
	/** The derived presence pip; `null` draws none (no published hours, nothing to say). */
	presence: PresenceTone | null;
}

/**
 * ProfileProgressAvatar — the person's avatar inside a profile-completion ring, with a presence pip.
 *
 * The ring is two concentric circles on a `pathLength` of 100, so `stroke-dashoffset` IS the missing
 * percentage: the track in a quiet neutral, the arc in `--primary`, turning `--success` once complete.
 * Its offset transitions on `--ease-standard`, collapsed to a jump under both reduced-motion channels.
 *
 * Wholly decorative (`aria-hidden`): the percentage and the presence are SPOKEN by the control that
 * hosts this — the header trigger folds them into its label, the popover's nudge is a real
 * `progressbar` — because a second progressbar inside a button announces twice and nests badly.
 */
export function ProfileProgressAvatar(props: ProfileProgressAvatarProps): JSX.Element {
	const { label, image, size, percent, presence } = props;
	const { box, stroke } = RING[size];
	const r = (box - stroke) / 2;
	const pct = percent === null ? null : Math.min(100, Math.max(0, percent));

	return (
		<span
			class="shell-ring"
			data-size={size}
			data-ring={pct === null
				? undefined
				: pct >= 100
				? "complete"
				: pct <= 0
				? "empty"
				: "partial"}
		>
			{pct !== null && (
				<svg
					class="shell-ring__svg"
					viewBox={`0 0 ${box} ${box}`}
					aria-hidden="true"
					focusable="false"
				>
					<circle
						class="shell-ring__track"
						cx={box / 2}
						cy={box / 2}
						r={r}
						fill="none"
						stroke-width={stroke}
						pathLength={100}
					/>
					<circle
						class="shell-ring__arc"
						cx={box / 2}
						cy={box / 2}
						r={r}
						fill="none"
						stroke-width={stroke}
						pathLength={100}
						stroke-dasharray={100}
						stroke-dashoffset={100 - pct}
					/>
				</svg>
			)}
			<UserAvatar label={label} image={image} size={size} />
			{presence && <span class="shell-ring__pip" data-presence={presence} aria-hidden="true" />}
		</span>
	);
}
