import type { JSX } from "preact";
import type { ExternalShareTarget } from "../core/share-targets.ts";

/**
 * share-brand-icons — the external destinations' marks for the share modal's quick actions.
 *
 * Brand marks are NOT `@projective/ui/icons` glyphs: the registry is the product's own stroked
 * vocabulary at one weight, and a third party's logotype is neither ours to restyle nor drawn to
 * that contract (Decision #62 quarantines them in `footer-icons.tsx` for the same reason). Each is
 * a self-contained 24×24 `currentColor` SVG, `aria-hidden` — the control's label carries the name —
 * so the row themes with the surrounding ink and reads as one set of buttons.
 */

type IconProps = { class?: string };

function Snapchat(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2c3.2 0 5.4 2.4 5.4 5.6v2.2c.5.3 1.3-.1 1.7 0 .5.2.4.7 0 .9-.5.3-1.4.4-1.6.9-.1.4 1.4 3 4 3.5.4.1.4.5.1.7-.6.4-1.9.5-2.1.8-.2.3-.1 1-.6 1.1-.6.1-1.6-.2-2.4.1-1 .3-2 1.9-4.5 1.9s-3.5-1.6-4.5-1.9c-.8-.3-1.8 0-2.4-.1-.5-.1-.4-.8-.6-1.1-.2-.3-1.5-.4-2.1-.8-.3-.2-.3-.6.1-.7 2.6-.5 4.1-3.1 4-3.5-.2-.5-1.1-.6-1.6-.9-.4-.2-.5-.7 0-.9.4-.1 1.2.3 1.7 0V7.6C6.6 4.4 8.8 2 12 2Z" />
		</svg>
	);
}

function WhatsApp(props: IconProps): JSX.Element {
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

function Facebook(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.4V14h2.8v8h3.3Z" />
		</svg>
	);
}

function Instagram(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.8" />
			<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
			<circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" />
		</svg>
	);
}

function XMark(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z" />
		</svg>
	);
}

function Telegram(props: IconProps): JSX.Element {
	return (
		<svg class={props.class} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.5-.6-.2L6.2 13.1 1.4 11.6c-1-.3-1-1 .2-1.5l18.9-7.3c.9-.3 1.6.2 1.4 1.8Z" />
		</svg>
	);
}

const MARKS: Record<ExternalShareTarget, (props: IconProps) => JSX.Element> = {
	snapchat: Snapchat,
	whatsapp: WhatsApp,
	facebook: Facebook,
	instagram: Instagram,
	x: XMark,
	telegram: Telegram,
};

/** The mark for a target — a fresh VNode per call (no shared constants, per the reuse hazard). */
export function ShareBrandIcon(
	{ target, class: cls }: { target: ExternalShareTarget; class?: string },
): JSX.Element {
	const Mark = MARKS[target];
	return <Mark class={cls} />;
}
