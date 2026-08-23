import type { JSX, VNode } from "preact";
import { Icon } from "@projective/ui/icons";
import { integrationLabel } from "@projective/types/scheduling";

/**
 * provider-marks — the calendar's external-provider brand marks.
 *
 * **Every mark is a hand-authored inline `<svg>`, not a remote favicon, and that is a decision
 * rather than an omission.**
 *
 * The application emits no `Content-Security-Policy` today (`routes/_middleware.ts` sets only
 * `x-frame-options`, `x-content-type-options` and a defaulted `referrer-policy`), so hotlinking
 * `google.com/s2/favicons` WOULD render. Two documented rules say not to anyway, and they are the
 * real constraint: `SYSTEM_ARCHITECTURE.md` §Runtime & API Security states that a strict CSP with no
 * external origins is served — code across the repo already writes to that assumption — and its
 * §link-ingest rule is explicit that a favicon is RE-HOSTED rather than hotlinked, "because a
 * hotlinked favicon sends every viewer's IP to a host the link's author chose". A calendar grid
 * draws one of these per synced event, so hotlinking would broadcast a request to Google for every
 * block on screen, on every paint, for every viewer.
 *
 * They are also quarantined out of the shared `@projective/ui/icons` registry, per §B.7: a brand
 * mark is not an icon in the design system's sense — it cannot be re-weighted or recoloured without
 * ceasing to be the mark — so it must never inherit `--icon-stroke`. Each is a plain filled `<svg>`
 * inheriting `currentColor` only, exactly like `features/files/components/file-hub-glyphs.tsx`,
 * which set this precedent for the storage connectors.
 *
 * Every export is a COMPONENT returning a fresh VNode rather than a shared constant: the same mark
 * is drawn across every block of a week and a shared VNode trips the Preact reuse hazard.
 *
 * Nothing here is ever the accessible name of a control — each mark is `aria-hidden`, and the name
 * lives on the wrapping control plus its portal `Tooltip` (§B.6).
 */

// #region Brand marks (quarantined — NOT registry icons)
interface MarkProps {
	/** Pixel size. Sized on the SVG box, never through `--icon-stroke` (a mark has no stroke ramp). */
	size?: number;
	class?: string;
}

/** Google Calendar — the notched square with a date well. */
export function GoogleCalendarMark({ size = 14, class: c }: MarkProps): JSX.Element {
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
export function OutlookMark({ size = 14, class: c }: MarkProps): JSX.Element {
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
export function AppleMark({ size = 14, class: c }: MarkProps): JSX.Element {
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
export function SamsungMark({ size = 14, class: c }: MarkProps): JSX.Element {
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
export function NotionMark({ size = 14, class: c }: MarkProps): JSX.Element {
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
export function CalendlyMark({ size = 14, class: c }: MarkProps): JSX.Element {
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

// #region Dispatcher
/**
 * The mark for one source slug, as a PLAIN FUNCTION returning `VNode | null`.
 *
 * A function rather than a component, and that distinction is the whole point: a caller has to be
 * able to ask "is there a mark for this?" and get `null` back. Rendering `<ProviderMark …/>` instead
 * yields a VNode that RENDERS to nothing but is not nothing — so a caller filtering on `!== null`
 * keeps it, and the stack draws an empty circular pip on every single event. That is exactly what
 * shipped and was caught by reading the SSR output rather than the source.
 *
 * `projective` returns `null` deliberately: the platform's own copy is the default place every event
 * lives, so a mark on all of them would spend the block's one overlay slot saying nothing. A mark
 * appears exactly when the occurrence is ALSO somewhere the reader might not expect — the same rule
 * `SourceMark` follows in `/files` for `supabase`.
 *
 * A slug the product carries no artwork for still gets a mark: the connector catalogue is DATA, so a
 * provider nobody wrote a brand mark for is an ordinary row and falls back to the registry's generic
 * calendar glyph rather than disappearing from the stack.
 */
export function providerMarkFor(
	source: string,
	size = 14,
	className?: string,
): VNode | null {
	switch (source) {
		case "projective":
			return null;
		case "google":
			return <GoogleCalendarMark size={size} class={className} />;
		case "outlook":
			return <OutlookMark size={size} class={className} />;
		case "apple":
			return <AppleMark size={size} class={className} />;
		case "samsung":
			return <SamsungMark size={size} class={className} />;
		case "notion":
			return <NotionMark size={size} class={className} />;
		case "calendly":
			return <CalendlyMark size={size} class={className} />;
		case "ics":
			return <Icon name="document" class={className} aria-hidden="true" />;
		default:
			return <Icon name="calendar" class={className} aria-hidden="true" />;
	}
}

/**
 * The mark for one source slug, ALWAYS drawn.
 *
 * Where {@link providerMarkFor} withholds a mark for the platform's own copy, this one falls back to
 * the registry's calendar glyph — because in a list that NAMES each calendar (the filter panel, the
 * connect dialog) an empty box beside "Projective" reads as a missing icon rather than as a
 * deliberate omission. The suppression is only right where the mark is the whole signal.
 */
export function ProviderMark(
	{ source, size = 14, class: c }: { source: string; size?: number; class?: string },
): VNode {
	return providerMarkFor(source, size, c) ??
		<Icon name="calendar" class={c} aria-hidden="true" />;
}

/**
 * The `renderSource` callback the `@projective/ui/calendar` engine takes.
 *
 * A named function rather than an inline arrow at each call site, so all four calendar surfaces draw
 * one stack the same way and a change lands in one place.
 */
export function renderCalendarSource(source: string): VNode | null {
	return providerMarkFor(source, 12);
}

/** The human label for a source slug — the SSOT's own, never re-written here. */
export function providerLabel(source: string): string {
	return integrationLabel(source);
}
// #endregion
