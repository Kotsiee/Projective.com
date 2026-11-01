import type { JSX } from "preact";

/**
 * Footer icon set — small, self-contained inline SVGs for the public footer (social row, newsletter
 * submit, accordion chevron). Each inherits `currentColor` and is `aria-hidden` (the
 * accessible name lives on the wrapping control), so they carry zero dependency and theme with the
 * surrounding text. Kept beside `PublicFooter` as feature-local presentation, not a `@projective/ui`
 * primitive. The brand mark itself is NOT here — it is shared across the shell, the guest header and
 * the auth aside, so it lives in `@web/components/Logo.tsx`.
 */

type IconProps = { class?: string };

/** The social row's brand marks, drawn once in `brand-marks.tsx` and named here for the footer. */
export {
	InstagramMark as InstagramIcon,
	LinkedInMark as LinkedInIcon,
	TikTokMark as TikTokIcon,
	XMark as XIcon,
	YouTubeMark as YouTubeIcon,
} from "@features/shell/components/brand-marks.tsx";

/** Icon-only submit affordance for the newsletter field (an outward arrow). */
export function ArrowIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/** Small chevron for the mobile accordion `<summary>` disclosure. */
export function ChevronIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="m6 9 6 6 6-6"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}
