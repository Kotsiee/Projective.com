import type { VNode } from "preact";
import { Icon } from "@projective/ui/icons";
import { integrationLabel } from "@projective/types/scheduling";
import {
	AppleCalendarMark,
	CalendlyMark,
	GoogleCalendarMark,
	NotionMark,
	OutlookMark,
	SamsungMark,
} from "@features/shell/components/brand-marks.tsx";

/**
 * provider-marks — which brand mark the calendar draws for an event's source.
 *
 * The marks themselves are hand-authored inline `<svg>`s in `shell/components/brand-marks.tsx`, never
 * hotlinked favicons (a calendar grid draws one per synced event, so hotlinking would broadcast a
 * request to the provider for every block on screen) and never registry icons (§B.7: a brand mark
 * cannot be re-weighted, so it must not inherit `--icon-stroke`). This module only maps a source slug
 * to its mark.
 *
 * Nothing here is ever the accessible name of a control — each mark is `aria-hidden`, and the name
 * lives on the wrapping control plus its portal `Tooltip` (§B.6).
 */

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
			return <AppleCalendarMark size={size} class={className} />;
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
