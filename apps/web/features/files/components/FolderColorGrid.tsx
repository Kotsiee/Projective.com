import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { styleVars } from "@ui/core/style.ts";
import { Icon } from "@projective/ui/icons";
import type { MenuItem } from "@projective/ui/navigation";
import "../styles/files-hub.css";
import { paintFolder } from "../core/files-actions.ts";
import { askFolderColor, type FolderColorTarget } from "../core/files-state.ts";
import { colorName, folderPalette, paletteFor, SWATCH_COLUMNS } from "../core/folder-colors.ts";

export interface FolderColorGridProps {
	target: FolderColorTarget;
	/** Close the menu the grid sits in. */
	onDone: () => void;
}

/**
 * FolderColorGrid — two rows of six in a folder's menu: the last colour picked first, the rest of the
 * set after it, and a `+` for any other from the wheel. Picking the folder's own colour clears it,
 * which is how a folder goes back to the default, because the grid has no room for a seventh control.
 *
 * It keeps the menu's keyboard model: Up and Down leave the grid from its edges and arrows move inside
 * it, so a swatch is reached and left like any row. Each is a `menuitemradio`, its name spoken.
 */
export function FolderColorGrid({ target, onDone }: FolderColorGridProps): JSX.Element {
	const grid = useRef<HTMLDivElement>(null);
	const colors = paletteFor(folderPalette.value, target.color);

	function pick(hex: string): void {
		onDone();
		void paintFolder(target.folderId, hex === target.color ? null : hex);
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLElement>, index: number): void {
		if (e.key === "Enter" || e.key === " ") {
			e.stopPropagation();
			return;
		}
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const steps: Record<string, number> = {
			ArrowLeft: rtl ? 1 : -1,
			ArrowRight: rtl ? -1 : 1,
			ArrowUp: -SWATCH_COLUMNS,
			ArrowDown: SWATCH_COLUMNS,
		};
		const step = steps[e.key];
		const cells = grid.current?.querySelectorAll<HTMLElement>("button");
		const next = step === undefined ? undefined : cells?.[index + step];
		// Past an edge it bubbles to the menu, which moves to the row above or below.
		if (!next) return;
		e.preventDefault();
		e.stopPropagation();
		next.focus();
	}

	return (
		<div class="fh-swatches" ref={grid}>
			{colors.map((hex, index) => (
				<button
					key={hex}
					type="button"
					class="fh-swatch"
					role="menuitemradio"
					aria-checked={hex === target.color}
					aria-label={colorName(hex)}
					tabIndex={-1}
					style={styleVars({ "--fh-swatch": hex })}
					onClick={() => pick(hex)}
					onKeyDown={(e) => onKeyDown(e, index)}
				/>
			))}
			<button
				type="button"
				class="fh-swatch fh-swatch--add"
				role="menuitem"
				aria-label="Choose a custom colour"
				tabIndex={-1}
				onClick={() => {
					onDone();
					askFolderColor(target);
				}}
				onKeyDown={(e) => onKeyDown(e, colors.length)}
			>
				<Icon name="plus" size="xs" />
			</button>
		</div>
	);
}

/** A folder's colour grid as a menu row, for any menu that belongs to the folder. */
export function folderColorRow(target: FolderColorTarget): MenuItem {
	return {
		key: "folder-color",
		label: "Folder colour",
		content: (close) => <FolderColorGrid target={target} onDone={close} />,
	};
}
