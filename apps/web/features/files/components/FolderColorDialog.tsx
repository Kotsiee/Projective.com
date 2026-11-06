import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, ColorPicker } from "@projective/ui/fields";
import "../styles/files-hub.css";
import { paintFolder } from "../core/files-actions.ts";
import { folderColorOpen, folderColorTarget } from "../core/files-state.ts";
import { folderPalette } from "../core/folder-colors.ts";
import { FolderMark } from "./FolderMark.tsx";

/**
 * FolderColorDialog — the `+` of a folder's colour grid: any colour from the wheel, previewed on the
 * folder before it is kept, so dragging across the wheel is one write rather than a hundred.
 */
export function FolderColorDialog(): JSX.Element {
	const draft = useSignal("");

	// Starts on the folder's own colour, or the last one picked, so the wheel opens somewhere useful.
	useSignalEffect(() => {
		if (!folderColorOpen.value) return;
		draft.value = folderColorTarget.peek()?.color ?? folderPalette.peek()[0];
	});

	return (
		<Dialog
			visible={folderColorOpen}
			header="Custom colour"
			width="20rem"
			footer={
				<div class="fh-rig__dialogfoot">
					<Button variant="text" label="Cancel" onClick={() => (folderColorOpen.value = false)} />
					<Button
						label="Use colour"
						onClick={() => {
							const target = folderColorTarget.peek();
							folderColorOpen.value = false;
							if (target) void paintFolder(target.folderId, draft.peek());
						}}
					/>
				</div>
			}
		>
			<div class="fh-colordialog">
				<FolderMark color={draft.value} class="fh-colordialog__preview" />
				{folderColorOpen.value && draft.value && (
					<ColorPicker
						inline
						variant="wheel"
						value={draft}
						aria-label={`Colour for ${folderColorTarget.value?.name ?? "this folder"}`}
					/>
				)}
			</div>
		</Dialog>
	);
}
