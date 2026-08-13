import type { JSX } from "preact";

/**
 * Footer icon set — small, self-contained inline SVGs for the public footer (social tray, newsletter
 * submit, help affordance, live-status dot). Each inherits `currentColor` and is `aria-hidden` (the
 * accessible name lives on the wrapping control), so they carry zero dependency and theme with the
 * surrounding text. Kept beside `PublicFooter` as feature-local presentation, not a `@projective/ui`
 * primitive. The brand mark itself is NOT here — it is shared across the shell, the guest header and
 * the auth aside, so it lives in `@web/components/Logo.tsx`.
 */

type IconProps = { class?: string };

export function LinkedInIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0-.02-5ZM3 9.5h4v11H3v-11Zm6 0h3.8v1.5h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.75v5.7h-4v-5.05c0-1.2-.02-2.75-1.7-2.75-1.7 0-1.96 1.32-1.96 2.67v5.13H9v-11Z" />
		</svg>
	);
}

export function XIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z" />
		</svg>
	);
}

export function DribbbleIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.6" />
			<path
				d="M5.5 7.3c3.9 4.2 8.9 6.1 13.4 6.2M8.5 3.7c3.3 3.5 5.4 8 5.9 13.9M20 9.8c-6 .3-9.9 2.4-12.4 6.7"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
		</svg>
	);
}

export function GitHubIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2.2A9.8 9.8 0 0 0 8.9 21.3c.49.09.67-.21.67-.47v-1.8c-2.73.6-3.3-1.16-3.3-1.16-.45-1.13-1.1-1.43-1.1-1.43-.9-.61.07-.6.07-.6 1 .07 1.52 1.02 1.52 1.02.88 1.52 2.32 1.08 2.89.83.09-.64.35-1.08.63-1.33-2.18-.25-4.47-1.09-4.47-4.85 0-1.07.38-1.95 1.02-2.64-.1-.25-.44-1.25.1-2.6 0 0 .83-.27 2.73 1a9.4 9.4 0 0 1 4.98 0c1.9-1.27 2.73-1 2.73-1 .54 1.35.2 2.35.1 2.6.63.69 1.02 1.57 1.02 2.64 0 3.77-2.3 4.6-4.49 4.84.36.31.68.92.68 1.85v2.74c0 .27.18.57.68.47A9.8 9.8 0 0 0 12 2.2Z" />
		</svg>
	);
}

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

/** A quiet help/question affordance for the "Contact Help" micro-tooltip. */
export function HelpIcon(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
			<path
				d="M9.6 9.4a2.4 2.4 0 0 1 4.7.7c0 1.6-2.3 2-2.3 3.4"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
			<circle cx="12" cy="16.6" r="1" fill="currentColor" />
		</svg>
	);
}
