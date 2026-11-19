import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { ProgressSpinner } from "@projective/ui/feedback";
import { Ripple } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import type { CtaPhase } from "../core/cta-feedback.ts";

/**
 * A conversion control's tier (§B.8.1): `inverted` is the default teal + white primary (§D.7.7),
 * `brand` the teal secondary, `accent` the tier-1 money verb (the monochrome inverted pill, filled) and
 * `neutral` the tier-4 outlined pill the commerce rig's Add to basket takes (Decision #424).
 */
export type CtaTone = "inverted" | "brand" | "accent" | "neutral";

/**
 * CtaButton — a conversion control with the platform's calm positive-feedback cycle.
 *
 * `idle → pending → settled → idle`, driven by {@link useCtaFeedback}. The press gets a Material
 * ripple; the write shows a `ProgressSpinner` in the icon slot; the resolve shows a check for a beat
 * and then returns. A money verb never bursts or bounces — an arcade flourish on a control that has
 * just moved somebody's money reads as a slot machine. The opt-in `spark` adornment is for the
 * commitment verbs that move none (Apply to project, Add to projects; Decision #520).
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
	/** The fill ramp: {@link CtaTone}. */
	tone?: CtaTone;
	/** The `Button` variant for the teal tones. `accent` is always filled and `neutral` always outlined. */
	variant?: "filled" | "outlined";
	fluid?: boolean;
	class?: string;
	/**
	 * Plays a one-shot adornment on press: a few sparks off the control and a nudge of its icon. For
	 * commitment verbs that move no money (Apply to project, Add to projects). Decorative only — the
	 * outcome is still the phase cycle — and removed under both reduced-motion channels.
	 */
	spark?: boolean;
}

const SPARK_COUNT = 6;

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
		spark = false,
	} = props;
	const burst = useSignal(0);

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

	const shared = {
		label: settled ? settledLabel : label,
		"aria-label": settled ? settledLabel : ariaLabel,
		size: "sm",
		fluid,
		rounded: true,
		icon: leading,
		// A settled control is momentarily inert on purpose: the write has landed, and a second press in
		// that window is a buyer who did not see the first one land.
		disabled: disabled || pending || settled,
		"aria-busy": pending ? "true" : undefined,
		onClick: spark
			? () => {
				burst.value++;
				onClick();
			}
			: onClick,
		"data-phase": phase,
		class: cls("evp-cta__btn", `evp-cta__btn--${tone}`, className),
	} as const;

	const control = (
		<Ripple disabled={disabled || pending} class="evp-cta__ripple">
			{tone === "accent"
				? <Button {...shared} severity="accent" variant="filled" />
				: tone === "neutral"
				? <Button {...shared} severity="neutral" variant="outlined" />
				: <Button {...shared} variant={variant} />}
		</Ripple>
	);
	if (!spark) return control;

	return (
		<span
			class={cls("evp-cta__sparkhost", fluid && "evp-cta__sparkhost--fluid")}
			data-burst={burst.value === 0 ? undefined : burst.value % 2 === 0 ? "even" : "odd"}
		>
			{control}
			{burst.value > 0 && (
				<span class="evp-cta__sparks" key={burst.value} aria-hidden="true">
					{Array.from({ length: SPARK_COUNT }, (_, i) => <span class="evp-cta__spark" key={i} />)}
				</span>
			)}
		</span>
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
		tone?: CtaTone;
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
