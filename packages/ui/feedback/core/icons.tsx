/**
 * Shared severity/close glyphs for the feedback taxonomy (Message, Messages, Toast, Alert).
 *
 * Rendered through the one icon contract ({@link IconShell}, DESIGN_SYSTEM.md §B.7) rather than as
 * hand-rolled `<svg>`, which fixes two defects at once: these were the only glyphs in the product
 * shipping WITHOUT `aria-hidden`, so every alert announced its decorative mark to a screen reader
 * before its own text; and they were drawn on a 20-unit grid at `stroke-width: 1.5`, which rendered
 * at 1.80px inside a 24px Alert — the heaviest icon anywhere in the tree against a 0.93px lightest.
 *
 * The 20-unit grid is preserved (redrawing to 24 is a separate, purely optical job) because
 * `vector-effect: non-scaling-stroke` decouples the rendered weight from the grid.
 */
import type { VNode } from "preact";
import { IconShell } from "../../icons/mod.ts";
import type { Severity } from "../../fields/types/mod.ts";

/** The authoring grid these glyphs were drawn on. */
const BOX = "0 0 20 20";

// #region Severity glyphs
/** Resolve the default glyph for a {@link Severity}, used when a component's `icon` prop is omitted. */
export function severityIcon(severity: Severity): VNode {
	switch (severity) {
		case "success":
			return (
				<IconShell viewBox={BOX}>
					<circle cx="10" cy="10" r="8.25" />
					<path d="M6.5 10.25 8.75 12.5 13.5 7.5" />
				</IconShell>
			);
		case "warning":
			return (
				<IconShell viewBox={BOX}>
					<path d="M10 2.5 18 16.5H2L10 2.5Z" />
					<path d="M10 8v3.75" />
					<circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
				</IconShell>
			);
		case "danger":
			return (
				<IconShell viewBox={BOX}>
					<circle cx="10" cy="10" r="8.25" />
					<path d="M7.25 7.25 12.75 12.75M12.75 7.25 7.25 12.75" />
				</IconShell>
			);
		case "help":
			return (
				<IconShell viewBox={BOX}>
					<circle cx="10" cy="10" r="8.25" />
					<path d="M7.8 8a2.2 2.2 0 1 1 3.2 1.96c-.62.34-1 .9-1 1.54v.3" />
					<circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
				</IconShell>
			);
		case "secondary":
		case "primary":
		case "info":
		default:
			return (
				<IconShell viewBox={BOX}>
					<circle cx="10" cy="10" r="8.25" />
					<path d="M10 9v4.25" />
					<circle cx="10" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
				</IconShell>
			);
	}
}
// #endregion

// #region Dismiss glyph
/** The small close glyph used by every dismissible feedback surface. */
export function closeIcon(): VNode {
	return (
		<IconShell viewBox={BOX}>
			<path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
		</IconShell>
	);
}
// #endregion
