import type { JSX } from "preact";
import "../styles/verification-stamp.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import type { IconSize } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { VERIFICATION_STAMP_META, type VerificationStamp } from "@projective/types/org";
import type { Placement } from "../../types/mod.ts";

// #region Props
/** Props for {@link VerificationStampBadge}. */
export interface VerificationStampBadgeProps {
	/** The verification authority to show; `none` renders nothing. */
	stamp: VerificationStamp;
	/** Glyph size (default `sm`). */
	size?: IconSize;
	/**
	 * `explained` (default) — a focusable crest whose portal `Tooltip` names the claim and who checked
	 * it. `decorative` — no tooltip and hidden from assistive tech, for a crest beside a name that is
	 * already explained elsewhere on the same surface (a sticky header repeating the hero).
	 */
	mode?: "explained" | "decorative";
	/** Tooltip placement (default `top`). */
	placement?: Placement;
	/** Plays the one-shot stamp animation — set while a milestone is being celebrated. */
	celebrate?: boolean;
	class?: string;
}
// #endregion

/**
 * VerificationStampBadge — the verification crest beside a name (DESIGN_SYSTEM §B.7.8, §B.11.4). One
 * crest per authority — `seal-check` identity · `shield-check` payout · `keystone-check` corporate —
 * filled, its check knocked out to the ground the CALL SITE sets as `--icon-knockout`. A glyph, never
 * a pill. Shape tells the authorities apart, so colour is never the only channel.
 */
export function VerificationStampBadge(
	{
		stamp,
		size = "sm",
		mode = "explained",
		placement = "top",
		celebrate = false,
		class: className,
	}: VerificationStampBadgeProps,
): JSX.Element | null {
	if (stamp === "none") return null;
	const meta = VERIFICATION_STAMP_META[stamp];
	const decorative = mode === "decorative";

	const crest = (
		<span
			class={cx("ui-stamp", className)}
			data-stamp={stamp}
			data-celebrate={celebrate ? "true" : undefined}
			role={decorative ? undefined : "img"}
			aria-label={decorative ? undefined : meta.label}
			aria-hidden={decorative ? "true" : undefined}
			tabIndex={decorative ? undefined : 0}
		>
			<Icon name={meta.glyph} size={size} filled />
		</span>
	);
	if (decorative) return crest;

	return (
		<Tooltip
			placement={placement}
			content={
				<span class="ui-stamp__tip">
					<span class="ui-stamp__tip-label">{meta.label}</span>
					<span>{meta.authority}</span>
				</span>
			}
		>
			{crest}
		</Tooltip>
	);
}
