import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { ProgressSpinner } from "@projective/ui/feedback";
import { Ripple } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import type { CtaPhase } from "../core/cta-feedback.ts";

/**
 * CtaButton — a conversion control with the platform's calm positive-feedback cycle.
 *
 * `idle → pending → settled → idle`, driven by {@link useCtaFeedback}. The press gets a Material
 * ripple; the write shows a `ProgressSpinner` in the icon slot; the resolve shows a check for a beat
 * and then returns. Nothing bursts, nothing bounces, nothing celebrates — §B.5, and because an arcade
 * flourish on a control that has just moved somebody's money reads as a slot machine.
 *
 * # Three implementation notes worth keeping
 *
 * **`Ripple` wraps, it does not replace.** It renders a positioned, overflow-clipped host span around
 * its child and attaches the press effect to it; the wrapped `<button>` keeps its own role, focus ring
 * and keyboard behaviour, and the ripple spans are `aria-hidden`. So the control is still exactly a
 * button as far as assistive tech and the keyboard are concerned.
 *
 * **`Button`'s own `loading` is deliberately NOT used.** It swaps the icon for a bare
 * `.ui-button__spinner` span, which is a CSS animation with no `role` — fine as decoration, but this
 * surface wants the design system's real `ProgressSpinner`, which carries `role="progressbar"` and
 * `aria-busy`. `disabled` is passed explicitly instead, so activation is still blocked while a write
 * is in flight.
 *
 * **The settled label is a swap, not an overlay.** Two absolutely-positioned labels cross-fading is
 * how a button ends up announcing both of them to a screen reader; one label whose TEXT changes
 * announces once, and the `--dur-fast` transition on the icon carries the visual softness.
 */
export interface CtaButtonProps {
	label: string;
	/** Overrides the accessible name when the visible label is not the whole fact. */
	ariaLabel?: string;
	phase: CtaPhase;
	onClick: () => void;
	disabled?: boolean;
	/** The label shown while `settled`. Defaults to a neutral confirmation. */
	settledLabel?: string;
	/** The leading icon at rest. Replaced by the spinner while pending and by a check while settled. */
	icon?: JSX.Element;
	/** `inverted` is the ranked PRIMARY (§D.7.7); `brand` is the secondary. */
	tone?: "inverted" | "brand";
	/**
	 * The `Button` variant.
	 *
	 * Exposed because the secondary is `outlined` while the primary is `filled`, and that is a
	 * STRUCTURAL difference rather than a colour one — `outlined` drops the background entirely, which
	 * no amount of `--btn-accent` juggling can express. Defaults to `filled`, so every existing caller
	 * is unchanged.
	 */
	variant?: "filled" | "outlined";
	fluid?: boolean;
	class?: string;
}

export function CtaButton(props: CtaButtonProps): JSX.Element {
	const {
		label,
		ariaLabel,
		phase,
		onClick,
		disabled,
		settledLabel = "Done",
		icon,
		tone = "inverted",
		variant = "filled",
		fluid = true,
		class: className,
	} = props;

	const pending = phase === "pending";
	const settled = phase === "settled";

	const leading = pending
		? (
			<ProgressSpinner
				size={16}
				strokeWidth={2}
				aria-label="Working"
				class="evp-cta__spinner"
			/>
		)
		: settled
		? <Icon name="check" size="sm" class="evp-cta__check" aria-hidden />
		: icon;

	return (
		<Ripple disabled={disabled || pending} class="evp-cta__ripple">
			<Button
				label={settled ? settledLabel : label}
				aria-label={settled ? settledLabel : ariaLabel}
				size="sm"
				variant={variant}
				fluid={fluid}
				rounded
				icon={leading}
				// A settled control is momentarily inert on purpose: the write has landed, and a second
				// press in that window is a buyer who did not see the first one land.
				disabled={disabled || pending || settled}
				aria-busy={pending ? "true" : undefined}
				onClick={onClick}
				data-phase={phase}
				class={cls("evp-cta__btn", `evp-cta__btn--${tone}`, className)}
			/>
		</Ripple>
	);
}

/**
 * A conversion control that NAVIGATES rather than writing.
 *
 * It runs no feedback cycle, and that is correct rather than an omission: the navigation IS the
 * feedback, and a check mark shown for 1.4 seconds before the page changes underneath it would be a
 * confirmation of something that has not finished. Kept beside {@link CtaButton} so the two share one
 * set of classes and a listing's primary looks identical whichever kind it resolves to.
 */
export function CtaLink(
	props: {
		label: string;
		ariaLabel?: string;
		href: string;
		icon?: JSX.Element;
		tone?: "inverted" | "brand";
	},
): JSX.Element {
	const { label, ariaLabel, href, icon, tone = "inverted" } = props;
	return (
		<Ripple class="evp-cta__ripple">
			<a
				class={cls("evp-cta__link", "evp-cta__btn", `evp-cta__btn--${tone}`)}
				href={href}
				aria-label={ariaLabel}
			>
				{icon}
				<span class="evp-cta__linklabel">{label}</span>
			</a>
		</Ripple>
	);
}

function cls(...parts: Array<string | false | undefined>): string {
	return parts.filter(Boolean).join(" ");
}
