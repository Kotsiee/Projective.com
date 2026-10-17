import type { JSX } from "preact";
import "../styles/permission-matrix.css";
import { cx } from "../../core/cx.ts";
import { ScrollArea } from "../../utils/islands/ScrollArea.tsx";
import { PermissionMatrixGrid, type PermissionMatrixProps } from "./PermissionMatrixGrid.tsx";

export type { PermissionMatrixGlyphs, PermissionMatrixProps } from "./PermissionMatrixGrid.tsx";

// #region PermissionMatrix
/**
 * PermissionMatrix — capabilities (rows) × roles (columns), each cell one of four states: allowed ·
 * conditional · locked · off. A `<table role="grid">` with one tab stop and arrow-key roving focus;
 * toggleable when `onToggle` is passed, read-only otherwise.
 *
 * The state is carried by an opaque tint AND a consumer-supplied glyph, so it survives the
 * colour-blind overlays. The header row and the capability column stay pinned while the grid
 * scrolls inside a `ScrollArea` on narrow widths; bound the root's block size (via `class`) for
 * the header to pin vertically too.
 *
 * Interactive — mount it inside an island. DESIGN_SYSTEM.md §B.13, §C.1.
 */
export function PermissionMatrix(props: PermissionMatrixProps): JSX.Element {
	const { class: className, ...rest } = props;
	return (
		<div class={cx("ui-permission-matrix", className)}>
			<ScrollArea
				orientation="both"
				type="auto"
				focusable={false}
				aria-label={props.caption}
				class="ui-permission-matrix__scroll"
			>
				<PermissionMatrixGrid {...rest} />
			</ScrollArea>
		</div>
	);
}
// #endregion
