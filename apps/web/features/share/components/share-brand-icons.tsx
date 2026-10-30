import type { JSX } from "preact";
import type { ExternalShareTarget } from "../core/share-targets.ts";
import {
	FacebookMark,
	InstagramMark,
	LinkedInMark,
	SnapchatMark,
	TelegramMark,
	WhatsAppMark,
	XMark,
} from "@features/shell/components/brand-marks.tsx";

/**
 * share-brand-icons — the external destinations' marks for the share modal's quick actions.
 *
 * Brand marks are NOT `@projective/ui/icons` glyphs: the registry is the product's own stroked
 * vocabulary at one weight, and a third party's logotype is neither ours to restyle nor drawn to
 * that contract (Decision #62). Every brand mark is drawn once in `shell/components/brand-marks.tsx`;
 * this module maps a target to its mark. Each is a 24×24 `currentColor` SVG, `aria-hidden` — the
 * control's label carries the name — so the row themes with the surrounding ink.
 */

type IconProps = { class?: string };

function Email(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" />
			<path
				d="m4 7 8 6 8-6"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

const MARKS: Record<ExternalShareTarget, (props: IconProps) => JSX.Element> = {
	snapchat: SnapchatMark,
	whatsapp: WhatsAppMark,
	facebook: FacebookMark,
	instagram: InstagramMark,
	x: XMark,
	telegram: TelegramMark,
	linkedin: LinkedInMark,
	email: Email,
};

/** The mark for a target — a fresh VNode per call (no shared constants, per the reuse hazard). */
export function ShareBrandIcon(
	{ target, class: cls }: { target: ExternalShareTarget; class?: string },
): JSX.Element {
	const Mark = MARKS[target];
	return <Mark class={cls} />;
}
