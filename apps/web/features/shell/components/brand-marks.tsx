import type { JSX } from "preact";

/**
 * brand-marks — every third-party brand mark the product draws, in one module.
 *
 * Brand marks are NOT `@projective/ui/icons` glyphs (DESIGN_SYSTEM.md §B.7): the registry is the
 * product's own stroked vocabulary at one weight, and a third party's mark cannot be re-weighted or
 * recoloured without ceasing to be the mark, so none of these inherits `--icon-stroke`. They were
 * spread over six feature modules, with Google's "G" drawn twice; each provider is now drawn once,
 * here, and the feature modules (`auth/components/icons.tsx`, `settings/…/provider-glyphs.tsx`,
 * `calendar/components/provider-marks.tsx`, `share/components/share-brand-icons.tsx`,
 * `marketing/components/footer-icons.tsx`) import or re-export from this file.
 *
 * Every mark is a hand-authored inline `<svg>`, never a hotlinked favicon: `SYSTEM_ARCHITECTURE.md`
 * §Runtime & API Security serves a strict CSP with no external origins, and a hotlinked favicon sends
 * every viewer's IP to the brand's host (the calendar draws one per synced event).
 *
 * Every export is a COMPONENT returning a fresh VNode rather than a shared constant: the same mark is
 * drawn many times in one tree and a shared VNode trips the Preact reuse hazard. Each is
 * `aria-hidden` — the wrapping control or the adjacent text carries the provider's name.
 */

// #region Props
/** Props for a mark sized by its container's CSS. */
export interface MarkProps {
	class?: string;
}

/** Props for a calendar provider mark, sized on the SVG box (a mark has no stroke ramp). */
export interface SizedMarkProps extends MarkProps {
	/** Pixel size. */
	size?: number;
}
// #endregion

// #region Sign-in providers — full colour, 18-unit box
/** Google — the full-colour "G", for every Google sign-in affordance (never `currentColor`). */
export function GoogleMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path
				fill="#4285F4"
				d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
			/>
			<path
				fill="#34A853"
				d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
			/>
			<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z" />
			<path
				fill="#EA4335"
				d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
			/>
		</svg>
	);
}

/** Apple — drawn in the current ink, as Apple asks. */
export function AppleSignInMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path
				fill="currentColor"
				d="M12.2 9.6c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2.1-.3 5.2.9 6.9.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.2-.5s1.3.5 2.2.5c.9 0 1.5-.9 2-1.7.6-.9.9-1.8.9-1.8s-1.8-.7-1.8-2.8zM10.6 4.6c.4-.6.8-1.3.7-2.1-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-1z"
			/>
		</svg>
	);
}

/** Facebook — the blue roundel, for a sign-in row. */
export function FacebookSignInMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<circle cx="9" cy="9" r="9" fill="#1877F2" />
			<path
				fill="#FFFFFF"
				d="M12.5 11.6l.4-2.6h-2.5V7.3c0-.7.3-1.4 1.5-1.4h1.1V3.7s-1-.2-2-.2c-2.1 0-3.4 1.2-3.4 3.5V9H5.3v2.6h2.3V18h2.8v-6.4h2.1z"
			/>
		</svg>
	);
}

/** LinkedIn — the blue tile, for a sign-in row. */
export function LinkedInSignInMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<rect width="18" height="18" rx="3" fill="#0A66C2" />
			<path
				fill="#FFFFFF"
				d="M5.3 7.1H3V15h2.3V7.1zM4.2 3.3C3.4 3.3 2.8 3.9 2.8 4.6S3.4 6 4.2 6s1.3-.6 1.3-1.4-.6-1.3-1.3-1.3zM15.2 10.5c0-2.2-1.2-3.5-3-3.5-1 0-1.7.5-2 1.1V7.1H7.9V15h2.3v-4.1c0-1.1.2-2 1.5-2s1.3 1.2 1.3 2.1v4h2.3l-.1-4.5z"
			/>
		</svg>
	);
}

/** Microsoft — the four-pane window. */
export function MicrosoftMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
			<rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
			<rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
			<rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
		</svg>
	);
}

/** Amazon — the smile on the ink tile. */
export function AmazonMark(p?: MarkProps): JSX.Element {
	return (
		<svg class={p?.class} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<rect width="18" height="18" rx="3" fill="#232F3E" />
			<path
				fill="none"
				stroke="#FF9900"
				stroke-width="1.4"
				stroke-linecap="round"
				d="M4 11.5c3 2 7 2 10 0M12.6 10.6l1.6.8-.6 1.6"
			/>
		</svg>
	);
}
// #endregion

// #region Social & messaging — `currentColor`, 24-unit box
/** X (formerly Twitter). */
export function XMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z" />
		</svg>
	);
}

/** LinkedIn — the monochrome "in". */
export function LinkedInMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.8v1.6h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1v6.36h-4v-5.64c0-1.35-.02-3.08-1.88-3.08-1.88 0-2.17 1.47-2.17 2.98v5.74h-4v-11Z" />
		</svg>
	);
}

/** Facebook — the monochrome "f". */
export function FacebookMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.4V14h2.8v8h3.3Z" />
		</svg>
	);
}

/** Instagram — the rounded camera. */
export function InstagramMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.8" />
			<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
			<circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" />
		</svg>
	);
}

/** Snapchat — the ghost. */
export function SnapchatMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2c3.2 0 5.4 2.4 5.4 5.6v2.2c.5.3 1.3-.1 1.7 0 .5.2.4.7 0 .9-.5.3-1.4.4-1.6.9-.1.4 1.4 3 4 3.5.4.1.4.5.1.7-.6.4-1.9.5-2.1.8-.2.3-.1 1-.6 1.1-.6.1-1.6-.2-2.4.1-1 .3-2 1.9-4.5 1.9s-3.5-1.6-4.5-1.9c-.8-.3-1.8 0-2.4-.1-.5-.1-.4-.8-.6-1.1-.2-.3-1.5-.4-2.1-.8-.3-.2-.3-.6.1-.7 2.6-.5 4.1-3.1 4-3.5-.2-.5-1.1-.6-1.6-.9-.4-.2-.5-.7 0-.9.4-.1 1.2.3 1.7 0V7.6C6.6 4.4 8.8 2 12 2Z" />
		</svg>
	);
}

/** WhatsApp — the phone in a speech bubble. */
export function WhatsAppMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5Z"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linejoin="round"
			/>
			<path
				d="M9.4 7.7c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.5 2.6 1 3.1.8 3.6.8.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4l-2.2-1c-.3-.1-.5-.2-.7.2l-1 1.3c-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.5l-.9-2.4Z"
				fill="currentColor"
			/>
		</svg>
	);
}

/** Telegram — the paper plane. */
export function TelegramMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.5-.6-.2L6.2 13.1 1.4 11.6c-1-.3-1-1 .2-1.5l18.9-7.3c.9-.3 1.6.2 1.4 1.8Z" />
		</svg>
	);
}

/** Dribbble — the seamed ball. */
export function DribbbleMark(props: MarkProps): JSX.Element {
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

/** GitHub — the octocat. */
export function GitHubMark(props: MarkProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2.2A9.8 9.8 0 0 0 8.9 21.3c.49.09.67-.21.67-.47v-1.8c-2.73.6-3.3-1.16-3.3-1.16-.45-1.13-1.1-1.43-1.1-1.43-.9-.61.07-.6.07-.6 1 .07 1.52 1.02 1.52 1.02.88 1.52 2.32 1.08 2.89.83.09-.64.35-1.08.63-1.33-2.18-.25-4.47-1.09-4.47-4.85 0-1.07.38-1.95 1.02-2.64-.1-.25-.44-1.25.1-2.6 0 0 .83-.27 2.73 1a9.4 9.4 0 0 1 4.98 0c1.9-1.27 2.73-1 2.73-1 .54 1.35.2 2.35.1 2.6.63.69 1.02 1.57 1.02 2.64 0 3.77-2.3 4.6-4.49 4.84.36.31.68.92.68 1.85v2.74c0 .27.18.57.68.47A9.8 9.8 0 0 0 12 2.2Z" />
		</svg>
	);
}
// #endregion

// #region Calendar providers — `currentColor`, sized on the box
/** Google Calendar — the notched square with a date well. */
export function GoogleCalendarMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M18.5 3H5.5A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 18.5 3Zm0 15.5h-13v-10h13v10Z" />
			<path
				d="M8.4 11.1h2.3v5.2H9.3v-4h-.9v-1.2Zm4.1 0h3.2v1.1l-1.9 4.1h-1.5l1.9-4h-1.7v-1.2Z"
				opacity="0.75"
			/>
		</svg>
	);
}

/** Microsoft Outlook — the four-pane window with the mail block. */
export function OutlookMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M13 4.6 22 3v8.2h-9V4.6Zm0 8.2h9V21l-9-1.6v-6.6Z" opacity="0.55" />
			<path d="M2 5.9 11.6 4v16L2 18.1V5.9Zm4.8 3.4c-1.5 0-2.5 1.1-2.5 2.8s1 2.7 2.5 2.7 2.5-1.1 2.5-2.8-1-2.7-2.5-2.7Zm0 1.3c.7 0 1.1.6 1.1 1.4s-.4 1.4-1.1 1.4-1.1-.6-1.1-1.4.4-1.4 1.1-1.4Z" />
		</svg>
	);
}

/** Apple Calendar — the leaf-and-body apple silhouette. */
export function AppleCalendarMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M16.3 12.5c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2 1-.1 1.4-.6 2.6-.6s1.5.6 2.6.6 1.7-1 2.4-2c.7-1.1 1-2.2 1-2.2s-1.9-.7-2-3.1Z" />
			<path
				d="M14.4 6.4c.5-.7.9-1.6.8-2.6-.8 0-1.8.5-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.8-.4 2.4-1.1Z"
				opacity="0.7"
			/>
		</svg>
	);
}

/** Samsung Calendar — the rounded lozenge wordmark shape. */
export function SamsungMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path
				d="M12 4c5 0 9 1.9 9 4.3v7.4C21 18.1 17 20 12 20s-9-1.9-9-4.3V8.3C3 5.9 7 4 12 4Z"
				opacity="0.35"
			/>
			<path d="M9.6 9.6c0-.6.5-.9 1.3-.9.9 0 1.3.4 1.4 1h1.5c-.1-1.4-1.2-2.2-2.9-2.2-1.8 0-2.9.9-2.9 2.2 0 2.5 4.4 1.7 4.4 3.3 0 .6-.6 1-1.4 1s-1.4-.4-1.5-1.1H7.9c.1 1.5 1.3 2.3 3.1 2.3 1.9 0 3-.9 3-2.3 0-2.6-4.4-1.9-4.4-3.3Z" />
		</svg>
	);
}

/** Notion — the ledger page with its spine. */
export function NotionMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M4.4 4.2 15.8 3a2 2 0 0 1 1.5.4l2.4 1.7a1 1 0 0 1 .4.8v12.4a1.6 1.6 0 0 1-1.4 1.6L7.1 21.3a1.6 1.6 0 0 1-1.3-.4l-1.6-1.7a1.4 1.4 0 0 1-.4-1V5.4c0-.6.4-1.1 1-1.2Zm2.3 3v10.4l8.4-.9V6.4l-8.4.8Z" />
			<path d="M9 8.6v6.6l1.4-.1v-4l2.4 3.8 1.4-.1V8.2l-1.4.1v3.9L10.4 8.5 9 8.6Z" opacity="0.75" />
		</svg>
	);
}

/** Calendly — the open bracket ring. */
export function CalendlyMark({ size = 14, class: c }: SizedMarkProps): JSX.Element {
	return (
		<svg
			class={c}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2.1a6.9 6.9 0 1 1 0 13.8 6.9 6.9 0 0 1 0-13.8Z" />
			<path
				d="M14.6 9.6a3.4 3.4 0 0 0-2.6-1.1c-2 0-3.4 1.5-3.4 3.5s1.4 3.5 3.4 3.5c1 0 2-.4 2.6-1.1l-1.1-1a2 2 0 0 1-1.5.6c-1.1 0-1.9-.8-1.9-2s.8-2 1.9-2c.6 0 1.1.2 1.5.6l1.1-1Z"
				opacity="0.75"
			/>
		</svg>
	);
}
// #endregion
