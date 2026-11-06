import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import "@web/features/projects/styles/submission-card.css";
import "../styles/files-hub.css";
import { type AssetFolder, sourceLabel } from "../types/file-types.ts";
import { FolderMark } from "./FolderMark.tsx";
import { SourceMark, VisibilityMark } from "./file-hub-glyphs.tsx";

/**
 * AssetFolderCard — one folder cell in the `/files` hub grid: the folder's own drawing in its colour
 * ({@link FolderMark}), where a file has a framed thumbnail, so the two kinds read apart at a glance.
 *
 * Only the art is its own. The card and its caption are `.subm-card`'s, because `.subm-card__meta` and
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
 * The Asset Picker's folder card is a drop target through `dropOver`, so the highlight is drawn on the
 * card's own box rather than a ring floating around it. The hub's marks its cell instead (`files-dnd`).
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
	// The folder's own item count: a child-folder count here would disagree with the tree, which
	// counts the whole subtree.
	const count = `${folder.itemCount} file${folder.itemCount === 1 ? "" : "s"}`;
	const sub = folder.source === "supabase" ? "Folder" : sourceLabel(folder.source);

	return (
		<div
			class="fh-folder"
			data-drop-over={dropOver || undefined}
			data-source={folder.source}
			data-readonly={folder.source !== "supabase" || undefined}
		>
			<button
				type="button"
				class="subm-card"
				onClick={() => onOpen(folder)}
				aria-label={`${folder.name} — ${sub}, ${count}`}
			>
				<span class="fh-folder__art">
					<FolderMark color={folder.color} />
				</span>
				<span class="subm-card__meta">
					<Tooltip content={folder.name} whenTruncated>
						<span class="subm-card__name">{folder.name}</span>
					</Tooltip>
					<span class="subm-card__sub">{sub}</span>
					<span class="subm-card__count">{count}</span>
				</span>
			</button>

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
