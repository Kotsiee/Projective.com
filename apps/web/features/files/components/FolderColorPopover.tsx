import type { JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Popover, type PopoverProps, type PopoverTriggerApi } from "@projective/ui/feedback";
import { Button, ColorPicker } from "@projective/ui/fields";
import "../styles/files-hub.css";
import { folderColorPreview } from "../core/files-state.ts";
import { folderPalette } from "../core/folder-colors.ts";
import { FolderMark } from "./FolderMark.tsx";

/**
 * FolderColorPopover — any colour from the wheel, anchored to what opened it: the `+` of a folder's
 * colour grid (Decision #407). The folder drawn at its top follows the wheel as it is dragged, and so
 * does the folder itself wherever it shows (`folderColorPreview`, read by every {@link FolderMark}
 * given its id) until the popover closes; only Use colour keeps it, so a drag is one write rather than
 * a hundred, and Escape or a press outside puts the folder back.
 */

// #region Props
export interface FolderColorPopoverProps {
	open: Signal<boolean>;
	/** What it stands on — the `+`, or a point where a menu was pressed. */
	trigger: (api: PopoverTriggerApi) => VNode;
	placement: PopoverProps["placement"];
	/** The colour the wheel starts on; the last one picked when there is none. */
	initial: string | null;
	/** The folder being coloured, when it exists yet: its marks show the wheel's colour live. */
	folderId?: string | null;
	/** The folder's name, for the wheel's accessible name. */
	name: string;
	onCommit: (hex: string) => void;
}
// #endregion

export function FolderColorPopover(props: FolderColorPopoverProps): JSX.Element {
	const draft = useSignal("");
	const isOpen = props.open.value;
	const folderId = props.folderId ?? null;

	function preview(color: string): void {
		if (folderId) folderColorPreview.value = { folderId, color };
	}

	useEffect(() => {
		if (!isOpen) return;
		draft.value = props.initial ?? folderPalette.peek()[0];
		preview(draft.peek());
		return () => {
			if (folderColorPreview.peek()?.folderId === folderId) folderColorPreview.value = null;
		};
	}, [isOpen, folderId]);

	function commit(): void {
		const hex = draft.peek();
		props.open.value = false;
		if (hex) props.onCommit(hex);
	}

	return (
		<Popover
			open={props.open}
			trigger={props.trigger}
			label="Custom colour"
			placement={props.placement}
			class="fh-colorpop"
			avoid={[".ui-app-shell__sidebar"]}
		>
			<div class="fh-colorpop__body">
				{draft.value && (
					<ColorPicker
						inline
						variant="wheel"
						value={draft}
						onValueChange={preview}
						aria-label={`Colour for ${props.name}`}
					/>
				)}
				<div class="fh-colorpop__foot">
					<FolderMark color={draft.value || null} class="fh-colorpop__preview" />
					<Button size="sm" label="Use colour" onClick={commit} />
				</div>
			</div>
		</Popover>
	);
}
