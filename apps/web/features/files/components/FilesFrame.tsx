import type { ComponentChildren, JSX } from "preact";
import "../styles/files-frame.css";

/**
 * FilesFrame — the one body layout every file surface draws in: the folder panel on the left inside
 * the canvas, the listing beside it (with its toolbar, where the header band belongs to someone
 * else), and an optional trailing column.
 *
 * The team and business drive, the project · stage · conversation File Explorer and the Submissions
 * explorer all render it, so the panel's width, its sticky pin, the single hairline seam and the
 * mobile fold (the panel stacks above the listing, capped in height) are written once. A scope with
 * no hierarchy passes no `aside` and the listing takes the whole width — the frame never draws an
 * empty panel.
 *
 * The panel pins below `--fx-chrome`, which the host sets to the chrome above it (the top bar, plus
 * the middle-nav header band where one is mounted). Dumb: layout only.
 */
export interface FilesFrameProps {
	/** The folder panel — a directory tree — or nothing for a scope with no hierarchy. */
	aside?: ComponentChildren;
	/** The panel's accessible name ("Folders", "Submission navigator"). */
	asideLabel?: string;
	/** A column after the listing (the Submissions explorer's Tasks panel), or nothing. */
	trailing?: ComponentChildren;
	/** The listing column: the toolbar fallback, the bars above the grid, the grid ⁄ list. */
	children: ComponentChildren;
	class?: string;
}

export function FilesFrame(props: FilesFrameProps): JSX.Element {
	const hasAside = props.aside !== undefined && props.aside !== null && props.aside !== false;
	const hasTrailing = props.trailing !== undefined && props.trailing !== null &&
		props.trailing !== false;
	return (
		<div
			class={`ffr${props.class ? ` ${props.class}` : ""}`}
			data-aside={hasAside ? "true" : undefined}
			data-trailing={hasTrailing ? "true" : undefined}
		>
			{hasAside && (
				<aside class="ffr__aside" aria-label={props.asideLabel ?? "Folders"}>
					{props.aside}
				</aside>
			)}
			<div class="ffr__main">{props.children}</div>
			{hasTrailing && props.trailing}
		</div>
	);
}
