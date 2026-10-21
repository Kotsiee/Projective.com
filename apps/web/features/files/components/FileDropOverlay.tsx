import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";

/** Props for {@link FileDropOverlay}. */
export interface FileDropOverlayProps {
	/** Where a drop lands, named for the reader ("Brand assets", "your library"). */
	destination: string;
}

/**
 * FileDropOverlay — the hub body's "drop to upload" highlight. Absolutely positioned inside the hub,
 * so it can never paint over the shell sidebar or the middle-nav lane, and `pointer-events: none`, so
 * the drag keeps landing on the hub beneath it. The card is sticky to the visible part of the overlay,
 * so a long library still shows it in view. Decorative: the drop itself is the pointer path, and the
 * footer's Upload is the equivalent for everyone else.
 */
export function FileDropOverlay({ destination }: FileDropOverlayProps): JSX.Element {
	return (
		<div class="fh-drop" aria-hidden="true">
			<div class="fh-drop__card">
				<Icon name="upload" size="lg" />
				<p class="fh-drop__title">Drop to upload</p>
				<p class="fh-drop__note">{`Files go into ${destination}.`}</p>
			</div>
		</div>
	);
}
