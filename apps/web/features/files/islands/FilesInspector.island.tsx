import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-hub.css";
import { Drawer } from "@projective/ui/feedback";
import { useMediaQuery } from "@projective/ui/navigation";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextPanelInflow,
	selectionPanelOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { InspectPanel } from "../components/InspectPanel.tsx";
import { download, openInNewTab, removeRows, setVisibility } from "../core/files-actions.ts";
import { busy, inspected, inspectId, previewId } from "../core/files-state.ts";

/**
 * FilesInspector — the selected item's preview and facts, in the middle-nav frame's right panel. The
 * panel's body on every file drive: from 1280px it docks in the frame and the canvas gives it its
 * width; below that the same body slides over in a right-hand `Drawer`, where the frame has no column
 * to give (the member inspector's arrangement, Decision #322).
 *
 * Its open state follows {@link inspectId}, which the body writes as the selection changes. Closing it
 * any way, the panel's Close, Escape, the drawer's dismissal or dragging the docked panel shut, clears
 * that one fact and leaves the selection alone: inspecting and selecting are separate questions.
 */
export default function FilesInspector(): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const sheetOpen = useSignal(false);
	const asset = inspected.value;
	const shown = useRef(asset);
	if (asset) shown.current = asset;

	useEffect(() => {
		selectionPanelOpen.value = asset !== null && inflow;
		sheetOpen.value = asset !== null && !inflow;
	}, [asset?.id ?? null, inflow]);

	const wasDocked = useRef(false);
	useSignalEffect(() => {
		const open = selectionPanelOpen.value;
		const before = wasDocked.current;
		wasDocked.current = open;
		// The drag-to-close path: the frame shut the panel, so the selection it showed is over.
		if (before && !open && inspectId.peek() !== null && contextPanelInflow()) {
			inspectId.value = null;
		}
	});

	function body(): JSX.Element | null {
		return (
			<InspectPanel
				asset={asset ?? shown.current}
				busy={busy.value}
				onClose={() => (inspectId.value = null)}
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
			<div class="fh-inspector">{inflow && asset ? body() : null}</div>
			{!inflow && shown.current && (
				<Drawer
					visible={sheetOpen}
					position="right"
					header="Details"
					class="fh-inspector"
					onVisibleChange={(open) => {
						if (!open && inspectId.peek() !== null) inspectId.value = null;
					}}
				>
					{body()}
				</Drawer>
			)}
		</>
	);
}
