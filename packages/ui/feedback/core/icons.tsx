/**
 * Shared inline severity/close glyphs for the feedback taxonomy (Message, Messages, Toast, Alert).
 * Kept as plain inline SVG (stroke = `currentColor`) so every consumer inherits the surrounding text
 * colour with no icon-library dependency, matching the "copy-paste-portable" package constraint.
 */
import type { VNode } from "preact";
import type { Severity } from "../../fields/types/mod.ts";

// #region Severity glyphs
/** Resolve the default glyph for a {@link Severity}, used when a component's `icon` prop is omitted. */
export function severityIcon(severity: Severity): VNode {
	switch (severity) {
		case "success":
			return (
				<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M6.5 10.25 8.75 12.5 13.5 7.5"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			);
		case "warning":
			return (
				<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path
						d="M10 2.5 18 16.5H2L10 2.5Z"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linejoin="round"
					/>
					<path d="M10 8v3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					<circle cx="10" cy="14" r="0.9" fill="currentColor" />
				</svg>
			);
		case "danger":
			return (
				<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M7.25 7.25 12.75 12.75M12.75 7.25 7.25 12.75"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			);
		case "help":
			return (
				<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M7.8 8a2.2 2.2 0 1 1 3.2 1.96c-.62.34-1 .9-1 1.54v.3"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<circle cx="10" cy="14" r="0.9" fill="currentColor" />
				</svg>
			);
		case "secondary":
		case "primary":
		case "info":
		default:
			return (
				<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="10" cy="10" r="8.25" stroke="currentColor" stroke-width="1.5" />
					<path d="M10 9v4.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					<circle cx="10" cy="6.5" r="0.9" fill="currentColor" />
				</svg>
			);
	}
}
// #endregion

// #region Dismiss glyph
/** The small "×" close glyph used by every dismissible feedback surface. */
export function closeIcon(): VNode {
	return (
		<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		</svg>
	);
}
// #endregion
