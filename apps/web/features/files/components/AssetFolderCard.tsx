import type { JSX } from "preact";
import { SubmissionCard } from "@web/features/projects/components/SubmissionCard.tsx";
import "@web/features/projects/styles/submission-card.css";
import "../styles/files-hub.css";
import { shapeFolderAsNode } from "../core/asset-model.ts";
import type { AssetFolder } from "../types/file-types.ts";
import { SourceMark, VisibilityMark } from "./file-hub-glyphs.tsx";

/**
 * AssetFolderCard — one folder cell in the `/files` hub grid.
 *
 * Like {@link AssetCard} this is an ADAPTER, not a second card family: the cell is the shared
 * {@link SubmissionCard} rendered verbatim, fed through `shapeFolderAsNode` — the seam in
 * `core/asset-model.ts` that maps an {@link AssetFolder} onto the `SubmissionTreeNode` those
 * components read. `SubmissionCard` is hard-typed to that node and its props are deliberately NOT
 * generalised; shaping the data is what keeps one card family instead of two.
 *
 * The geometry is the reason this matters rather than merely being tidy: `.subm-card__meta` and
 * `.fx-card__meta` are both exactly 62px, which is what lets ONE grid whose `rowHeight` is
 * `cellWidth + 62 + gap` hold folders and files in the same rows without the virtualizer's maths
 * drifting from what is painted.
 *
 * ## A folder is opened, not selected
 *
 * The hub's `selection` signal holds ASSET ids — `pruneSelection` reconciles it against `items`, and
 * every bulk action (`move` · `remove` · `setVisibility`) takes asset ids. A folder therefore cannot
 * enter that selection, so a single click on a folder navigates into it rather than pretending to
 * select something the rest of the surface has no vocabulary for. That also matches the Submissions
 * explorer, whose card family this is.
 *
 * ## Drop target
 *
 * A folder card is a drop target for a drag of the current asset selection. The wrapper carries the
 * `data-drop-over` hook the enclosing `Droppable` sets, so the highlight is drawn on the card's own
 * box rather than a ring floating around it.
 *
 * Dumb: no data access, no state.
 */
export interface AssetFolderCardProps {
	folder: AssetFolder;
	/** Navigate into this folder. */
	onOpen: (folder: AssetFolder) => void;
	/** Whether a compatible drag is currently hovering this card. */
	dropOver?: boolean;
}

export function AssetFolderCard(props: AssetFolderCardProps): JSX.Element {
	const { folder, onOpen, dropOver = false } = props;
	// Children are not passed: the grid shows the folder's own item count, and a child-folder count
	// resolved here would disagree with the tree, which counts the whole subtree.
	const node = shapeFolderAsNode(folder);

	return (
		<div
			class="fh-folder"
			data-drop-over={dropOver || undefined}
			data-source={folder.source}
			data-readonly={folder.source !== "supabase" || undefined}
		>
			<SubmissionCard node={node} onOpen={() => onOpen(folder)} />

			<span class="fh-asset__flags" aria-hidden="true">
				{folder.source !== "supabase"
					? (
						<span class="fh-asset__flag fh-asset__flag--source">
							<SourceMark source={folder.source} size={13} />
						</span>
					)
					: null}
				<span class="fh-asset__flag fh-asset__flag--scope" data-scope={folder.visibility}>
					<VisibilityMark visibility={folder.visibility} />
				</span>
			</span>
		</div>
	);
}
