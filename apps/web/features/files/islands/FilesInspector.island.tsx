import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-hub.css";
import { Drawer, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { useMediaQuery } from "@projective/ui/navigation";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextPanelInflow,
	selectionPanelOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { InspectPanel } from "../components/InspectPanel.tsx";
import { download, openInNewTab, removeRows, setVisibility } from "../core/files-actions.ts";
import {
	closeDetailsPanel,
	detailsDocked,
	detailsSheetOpen,
	restoreDetailsPanel,
	setDetailsDocked,
} from "../core/details-panel.ts";
import { busy, folders, inspected, previewId, selection } from "../core/files-state.ts";

/**
 * FilesInspector — the selected item's preview and facts, in the middle-nav frame's right panel. The
 * panel's body on every file drive: from 1280px it docks in the frame and the canvas gives it its
 * width; below that the same body slides over in a right-hand `Drawer`, where the frame has no column
 * to give (the member inspector's arrangement, Decision #322).
 *
 * **The person opens it, not the pick.** Its open state is `core/details-panel.ts`, toggled from the
 * header band's Details control or `Ctrl/⌘+I`. While it is open, a single click streams the picked
 * file into it (`files-state.inspectId` follows the selection); while it is closed, a click only
 * selects and nothing slides in. Closing it any way, the panel's Close, the drawer's dismissal or
 * dragging the docked panel shut, closes the panel and leaves the selection alone.
 *
 * Open with nothing to describe, it says so: nothing picked, a folder, or several items.
 */
export default function FilesInspector(): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const asset = inspected.value;
	const docked = detailsDocked.value;

	useEffect(() => restoreDetailsPanel(), []);

	// The frame's docked panel follows the toggle. A drawer left open by a narrow window does not
	// carry over into a docked panel the person never asked for.
	useEffect(() => {
		selectionPanelOpen.value = inflow && docked;
		if (inflow && detailsSheetOpen.peek()) detailsSheetOpen.value = false;
	}, [inflow, docked]);

	const wasDocked = useRef(false);
	useSignalEffect(() => {
		const open = selectionPanelOpen.value;
		const before = wasDocked.current;
		wasDocked.current = open;
		// The drag-to-close path: the frame shut the panel, so the toggle reads closed too.
		if (before && !open && detailsDocked.peek() && contextPanelInflow()) setDetailsDocked(false);
	});

	function body(): JSX.Element {
		if (!asset) return <DetailsEmpty onClose={closeDetailsPanel} />;
		return (
			<InspectPanel
				asset={asset}
				busy={busy.value}
				onClose={closeDetailsPanel}
				onDownload={(target) => void download(target)}
				onOpenRaw={openInNewTab}
				onPreview={(target) => (previewId.value = target.id)}
				onSetVisibility={(target, visibility) => void setVisibility(target, visibility)}
				onDelete={(target) =>
					void removeRows({ assetIds: [target.id], folderIds: [], name: target.name })}
			/>
		);
	}

	return (
		<>
			<div class="fh-inspector" id="fh-details">{inflow && docked ? body() : null}</div>
			{!inflow && (
				<Drawer
					visible={detailsSheetOpen}
					position="right"
					header="Details"
					class="fh-inspector"
				>
					{body()}
				</Drawer>
			)}
		</>
	);
}

/**
 * DetailsEmpty — the open panel with no file to describe. Names what IS picked, so the panel never
 * reads as broken: a folder by its name and count, several items by how many.
 */
function DetailsEmpty({ onClose }: { onClose: () => void }): JSX.Element {
	const ids = selection.value;
	const folder = ids.length === 1 ? folders.value.find((f) => f.id === ids[0]) : undefined;
	const title = folder
		? folder.name
		: ids.length > 1
		? `${ids.length} items selected`
		: "No file selected";
	const note = folder
		? `Folder · ${folder.itemCount} ${
			folder.itemCount === 1 ? "file" : "files"
		}. Open it to see what's inside.`
		: ids.length > 1
		? "Select one file to see its preview and details."
		: "Select a file to see its preview and details here.";

	return (
		<aside class="fh-inspect fh-inspect--empty" aria-label="Details">
			<header class="fh-inspect__head">
				<h2 class="fh-inspect__title">{title}</h2>
				<Tooltip content="Close details">
					<button
						type="button"
						class="fh-inspect__close"
						onClick={onClose}
						aria-label="Close details"
					>
						<Icon name="close" size="sm" />
					</button>
				</Tooltip>
			</header>
			<p class="fh-inspect__emptynote">{note}</p>
		</aside>
	);
}
