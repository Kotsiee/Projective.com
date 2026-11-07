import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { InputText } from "@projective/ui/fields";
import { styleVars } from "@ui/core/style.ts";
import type { ExplorerCell } from "../core/files-keyboard.ts";
import { cellName } from "../core/files-keyboard.ts";

/**
 * RenameField — F2's inline field, laid over the item's own name.
 *
 * Over it rather than in it: the name belongs to `FileCard`, `.subm-card` or a `DataTable` cell, all
 * shared, and windowed rows remount. It sits in the hub in the hub's own coordinates, so it scrolls
 * with the row it covers. Enter or leaving the field saves, Esc cancels; an unchanged or empty name is
 * a cancel. The stem is selected, because a person edits a name, not a type.
 */
export interface RenameFieldProps {
	cell: ExplorerCell;
	/** The element whose name this covers: its box places the field. */
	anchor: Element;
	hub: Element;
	onRename: (name: string) => void;
	/** The field is done; `byKey` when a key ended it, so focus goes back to the item. */
	onClose: (byKey: boolean) => void;
}

function stemLength(cell: ExplorerCell): number {
	const name = cellName(cell);
	const dot = cell.kind === "asset" && cell.asset.source !== "link" ? name.lastIndexOf(".") : -1;
	return dot > 0 ? dot : name.length;
}

export function RenameField(props: RenameFieldProps): JSX.Element {
	const { cell, anchor, hub, onRename, onClose } = props;
	const name = cellName(cell);
	const value = useSignal(name);
	const closed = useRef(false);

	function close(save: boolean, byKey: boolean): void {
		if (closed.current) return;
		closed.current = true;
		const next = value.value.trim();
		if (save && next && next !== name) onRename(next);
		onClose(byKey);
	}

	const at = anchor.getBoundingClientRect();
	const base = hub.getBoundingClientRect();

	return (
		<div
			class="fh-rename"
			style={styleVars({
				"--fh-rename-x": `${at.left - base.left}px`,
				"--fh-rename-y": `${at.top - base.top}px`,
				"--fh-rename-w": `${at.width}px`,
				"--fh-rename-h": `${at.height}px`,
			})}
		>
			<InputText
				value={value}
				size="sm"
				block
				autoFocus
				autoComplete="off"
				spellcheck={false}
				aria-label={`Rename ${name}`}
				onValueChange={(next) => (value.value = next)}
				onFocus={(e) => e.currentTarget.setSelectionRange(0, stemLength(cell))}
				onBlur={() => close(true, false)}
				onKeyDown={(e) => {
					if (e.key !== "Enter" && e.key !== "Escape") return;
					e.preventDefault();
					e.stopPropagation();
					close(e.key === "Enter", true);
				}}
			/>
		</div>
	);
}
