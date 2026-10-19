import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";
import type { PermissionMatrixGlyphs } from "@projective/ui/display";

/**
 * role-glyphs — the three state marks the Roles `PermissionMatrix` draws (DESIGN_SYSTEM §B.13: the
 * glyphs are the consumer's, on the `IconShell` contract) and its legend repeats.
 *
 * SHAPE carries the state next to the fill, so the matrix reads under every colour-vision overlay and
 * in greyscale: a bare tick (allowed), a tick standing on a rule (allowed under a written rule — never
 * drawn as a plain tick, which would over-promise), and a closed padlock (fixed: a preset column).
 * Function components rather than shared VNode constants, so every cell and the legend mount their
 * own. All `aria-hidden` (the `IconShell` default): each cell is named by its own words.
 */

// #region Glyphs
/** A bare tick — `allowed`. */
export function AllowedGlyph(): JSX.Element {
	return (
		<IconShell focusable="false">
			<path d="M5 12.5l4.5 4.5L19 7" />
		</IconShell>
	);
}

/** A tick standing on a rule — `conditional`: allowed, inside a rule the entity configured. */
export function ConditionalGlyph(): JSX.Element {
	return (
		<IconShell focusable="false">
			<path d="M5.5 10.5l4 4L18.5 5" />
			<path d="M6 19h12" />
		</IconShell>
	);
}

/** A closed padlock — `locked`, and the mark beside a preset column's name. */
export function LockedGlyph(): JSX.Element {
	return (
		<IconShell focusable="false">
			<rect x="5" y="10.5" width="14" height="9.5" rx="2" />
			<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
		</IconShell>
	);
}
// #endregion

// #region The matrix's set
/** The glyph set the Roles matrix hands its `PermissionMatrix` — fresh elements per call. */
export function roleMatrixGlyphs(): PermissionMatrixGlyphs {
	return {
		allowed: <AllowedGlyph />,
		conditional: <ConditionalGlyph />,
		locked: <LockedGlyph />,
	};
}
// #endregion
