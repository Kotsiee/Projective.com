/// <reference lib="dom" />
import type { RefObject } from "preact";
import { effect, type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { isApplePlatform } from "@features/projects/core/chat-keyboard.ts";
import { shortcutOn } from "@features/shortcuts/core/shortcut-registry.ts";
import { NO_DRAG } from "../components/FilesDragSurface.tsx";
import { pasteRows } from "../core/files-actions.ts";
import { canGoBack } from "../core/files-history.ts";
import {
	cellId,
	cellsOf,
	type ExplorerCell,
	type FilesKeyAction,
	gridColumns,
	isActionKey,
	keyAction,
	managesCell,
	pasteTarget,
	rowsOf,
	stepIndex,
	SWITCHABLE_ACTIONS,
	zoneOf,
} from "../core/files-keyboard.ts";
import {
	anchorId,
	busy,
	clearSelection,
	clipboard,
	currentPath,
	filesSearchFocus,
	folderId,
	folders,
	inspectId,
	inspectSelection,
	items,
	previewId,
	rangeSelect,
	renaming,
	selectAll,
	selection,
	toggleSelect,
} from "../core/files-state.ts";
import type { AssetFolder } from "../types/file-types.ts";
import { viewMode } from "@web/features/projects/core/view-state.ts";

/**
 * useFileExplorerKeyboardShortcuts — the desktop keyboard of the `/files` canvas, and its modified
 * clicks, which have to agree with it about what a range is.
 *
 * ## One listener on the document, in the capture phase
 *
 * Not on the hub, for two reasons. Focus falls to `<body>` when a focused row leaves the DOM, as a
 * virtualized one does, or after a click on empty canvas; and `Cmd/Ctrl+F` must reach a search field
 * that lives in another hydration root. {@link zoneOf} is the strict check that buys this: a field and
 * a modal keep every key, Esc and Enter included, because their own handlers answer those; the side
 * tree keeps its own keys. Capture, because a `DataTable` body answers the same keys for its own rows
 * alone, and the list view is two tables: folders above files.
 *
 * ## Focus and selection are separate questions
 *
 * `activeFocusedIndex` is where the keyboard is, and DOM focus follows it; `selection` is what is
 * chosen, and arrows leave it alone. So a person can walk the list and press Space on what they want.
 * It is an index into the painted cells, not an id, so it survives the row it named being deleted.
 *
 * ## A target out of the DOM
 *
 * The grid and the table window their rows, so Home and End can name a cell nothing renders. The page
 * scrolls to where it would be, by its share of the list's full height, and focus follows when it
 * mounts.
 *
 * A drag on the keyboard (`M`) owns the arrows, Enter and Escape while it runs.
 */

// #region Options
export interface FileExplorerKeyboardOptions {
	/** The explorer's root: what counts as the canvas, and what takes a modified click. */
	containerRef: RefObject<HTMLElement>;
	/** Whether a paste may land here: a read-only location takes nothing. */
	takesPaste: () => boolean;
	onOpenFolder: (folder: AssetFolder) => void;
	/** Climb to the parent folder. */
	onUp: () => void;
	/** Raise the delete confirmation for these cells. */
	onRemove: (cells: ExplorerCell[]) => void;
}

export interface FileExplorerKeyboard {
	/** Return focus to the canvas: the active item, or the explorer itself when there is none. */
	focusCanvas: () => void;
	/** The last thing done, for a `role="status"` region. */
	note: ReadonlySignal<string>;
}
// #endregion

// #region DOM
const CARD = ".fx-card, .subm-card";
const ROW = ".ui-dt__row";
const ITEM = `.fh-cell[data-key], ${ROW}[data-key]`;
/** The shell's mobile menu stays mounted, closed and `aria-hidden`: only an open modal takes the keys. */
const MODAL = "[aria-modal='true']:not([aria-hidden='true'])";
const INTERACTIVE = "a, button, [role='button'], [role='checkbox'], [role='menuitem'], summary";

/** How long a scrolled-to row gets to mount: a window scroll settles within a few frames. */
const MOUNT_TRIES = 12;
const MOUNT_WAIT_MS = 32;

function itemEl(hub: HTMLElement | null, id: string): HTMLElement | null {
	const key = CSS.escape(id);
	return hub?.querySelector<HTMLElement>(`.fh-cell[data-key="${key}"], ${ROW}[data-key="${key}"]`) ?? null;
}

/** Focus an item's own control, and bring it into view. Rows sit under sticky chrome: see the CSS. */
function reveal(el: HTMLElement): void {
	const control = el.matches(ROW) ? el : el.querySelector<HTMLElement>(CARD) ?? el;
	control.focus({ preventScroll: true });
	el.scrollIntoView({ block: "nearest" });
}

/** How many columns the canvas shows: a list is one. */
function columnsOf(hub: HTMLElement | null): number {
	const grid = viewMode.peek() === "grid" ? hub?.querySelector<HTMLElement>(".ui-vgrid") : null;
	if (!grid) return 1;
	const style = getComputedStyle(grid);
	return gridColumns(
		grid.clientWidth,
		parseFloat(style.getPropertyValue("--vgrid-cell-w")),
		parseFloat(style.getPropertyValue("--vgrid-gap")),
	);
}

/** Scroll the page to where a windowed row would be, so that it mounts. */
function scrollToward(hub: HTMLElement | null, index: number, count: number, columns: number): void {
	const grid = hub?.querySelector<HTMLElement>(".ui-vgrid__sizer");
	const sizers = hub?.querySelectorAll<HTMLElement>(".ui-dt__sizer");
	const lead = folders.peek().length;
	const list = grid ?? sizers?.[sizers.length - 1];
	if (!list) return;
	const share = grid
		? Math.floor(index / columns) / Math.ceil(count / columns)
		: (index - lead) / Math.max(1, count - lead);
	const y = list.getBoundingClientRect().top + globalThis.scrollY + share * list.offsetHeight;
	globalThis.scrollTo({ top: y - globalThis.innerHeight / 2 });
}

/** Whether Enter, Space and the arrows are the canvas's here, not a control's of its own. */
function ownsKeys(target: Element | null, hub: HTMLElement | null): boolean {
	if (!target || target === hub) return true;
	return target.matches(`${CARD}, ${ROW}`) || !target.closest(INTERACTIVE);
}

/** Whether the arrows should run the other way: a right-to-left grid mirrors its columns. */
function flipped(key: string, hub: HTMLElement | null): string {
	if (!hub || getComputedStyle(hub).direction !== "rtl") return key;
	return key === "ArrowLeft" ? "ArrowRight" : key === "ArrowRight" ? "ArrowLeft" : key;
}

function take(e: Event): void {
	e.preventDefault();
	e.stopPropagation();
}

function selectedText(): boolean {
	return globalThis.getSelection()?.isCollapsed === false;
}

function plural(n: number): string {
	return `${n} ${n === 1 ? "item" : "items"}`;
}
// #endregion

export function useFileExplorerKeyboardShortcuts(
	options: FileExplorerKeyboardOptions,
): FileExplorerKeyboard {
	const latest = useRef(options);
	latest.current = options;
	const activeFocusedIndex = useRef(-1);
	const note = useSignal("");
	/** A Space this hook took: some browsers still click a button on its keyup. */
	const spaceTaken = useRef(false);

	const api = useMemo(() => {
		const hub = () => latest.current.containerRef.current;
		const cells = () => cellsOf(folders.peek(), items.peek());

		function focusIndex(index: number, all: readonly ExplorerCell[], columns: number): void {
			activeFocusedIndex.current = index;
			const id = cellId(all[index]);
			const el = itemEl(hub(), id);
			if (el) {
				reveal(el);
				return;
			}
			scrollToward(hub(), index, all.length, columns);
			const whenMounted = (tries: number) => {
				const mounted = itemEl(hub(), id);
				if (mounted) reveal(mounted);
				else if (tries > 0) setTimeout(() => whenMounted(tries - 1), MOUNT_WAIT_MS);
			};
			setTimeout(() => whenMounted(MOUNT_TRIES), MOUNT_WAIT_MS);
		}

		function focusCanvas(): void {
			const all = cells();
			const index = activeFocusedIndex.current;
			if (all[index]) focusIndex(index, all, columnsOf(hub()));
			else hub()?.focus({ preventScroll: true });
		}

		/** Walk or extend. Shift grows the run from the anchor, or from here when nothing is chosen. */
		function move(key: string, extend: boolean, all: readonly ExplorerCell[], e: Event): void {
			const columns = columnsOf(hub());
			const from = Math.min(activeFocusedIndex.current, all.length - 1);
			const next = stepIndex(flipped(key, hub()), from, all.length, columns);
			if (next === null) return;
			take(e);
			if (extend) {
				const ids = all.map(cellId);
				const anchor = anchorId.peek();
				if (selection.peek().length === 0 || anchor === null || !ids.includes(anchor)) {
					anchorId.value = ids[Math.max(from, 0)];
				}
				rangeSelect(ids[next], ids);
				inspectSelection();
				note.value = `${selection.peek().length} selected`;
			}
			focusIndex(next, all, columns);
		}

		function holdClipboard(mode: "copy" | "cut", chosen: ExplorerCell[], e: Event): void {
			if (selectedText()) return;
			const rows = rowsOf(chosen);
			const count = rows.assetIds.length + rows.folderIds.length;
			if (count === 0) return;
			take(e);
			clipboard.value = { mode, ...rows, from: folderId.peek() };
			note.value = `${plural(count)} ${mode === "copy" ? "copied" : "cut"}`;
		}

		function dismiss(e: Event): void {
			if (selection.peek().length > 0) {
				clearSelection();
				inspectSelection();
				note.value = "Selection cleared";
			} else if (inspectId.peek() !== null) inspectId.value = null;
			else if (clipboard.peek()?.mode === "cut") clipboard.value = null;
			else return;
			take(e);
		}

		function act(action: FilesKeyAction, e: KeyboardEvent, target: Element | null): void {
			const all = cells();
			const own = target?.closest<HTMLElement>(ITEM);
			const index = own ? all.findIndex((c) => cellId(c) === own.dataset.key) : -1;
			if (index >= 0) activeFocusedIndex.current = index;
			const focused = index >= 0 ? all[index] : null;
			const picked = all.filter((c) => selection.peek().includes(cellId(c)));
			const chosen = picked.length > 0 ? picked : focused ? [focused] : [];
			const active = focused ?? all[activeFocusedIndex.current] ?? null;

			switch (action) {
				case "select-all":
					take(e);
					selectAll(all.map(cellId));
					inspectSelection();
					note.value = `${all.length} selected`;
					return;
				case "copy":
				case "cut":
					holdClipboard(action, chosen, e);
					return;
				case "paste": {
					if (!clipboard.peek() || busy.peek()) return;
					take(e);
					if (!latest.current.takesPaste()) {
						note.value = "This location is read-only.";
						return;
					}
					void pasteRows(pasteTarget(selection.peek(), folders.peek(), folderId.peek()));
					return;
				}
				case "delete":
					if (chosen.some(managesCell)) {
						take(e);
						latest.current.onRemove(chosen);
					}
					return;
				case "rename": {
					const cell = picked.length === 1 ? picked[0] : focused;
					if (!cell || !managesCell(cell)) return;
					take(e);
					renaming.value = cell;
					return;
				}
				case "up":
				case "back": {
					const nested = currentPath.peek().length > 0;
					const previous = canGoBack.peek();
					const climb = action === "up" ? nested : nested && !previous;
					if (!nested && !previous) return;
					take(e);
					if (climb) latest.current.onUp();
					else history.back();
					return;
				}
				case "open":
					if (!active || !ownsKeys(target, hub())) return;
					take(e);
					if (active.kind === "folder") latest.current.onOpenFolder(active.folder);
					else previewId.value = active.asset.id;
					return;
				case "toggle":
					if (!active || !ownsKeys(target, hub())) return;
					take(e);
					spaceTaken.current = true;
					toggleSelect(cellId(active));
					inspectSelection();
					note.value = `${selection.peek().length} selected`;
					return;
				case "dismiss":
					dismiss(e);
					return;
				case "move":
					if (ownsKeys(target, hub())) move(e.key, e.shiftKey, all, e);
					return;
			}
		}

		function onKeyDown(e: KeyboardEvent): void {
			// `M`'s keyboard drag answers the arrows, Enter and Escape for as long as it runs.
			if (e.defaultPrevented || document.querySelector("[data-dragging]")) return;
			const action = keyAction(e, isApplePlatform());
			if (!action || (e.repeat && action !== "move")) return;
			const switchable = SWITCHABLE_ACTIONS[action];
			if (switchable && !shortcutOn(switchable)) return;

			const target = e.target instanceof Element ? e.target : null;
			const zone = zoneOf(target, hub(), document.querySelector(MODAL) !== null);
			if (action === "find") {
				const focus = filesSearchFocus.peek();
				if (!focus || zone === "typing" || zone === "modal") return;
				take(e);
				focus();
				return;
			}
			if (zone === "canvas") act(action, e, target);
		}

		function onKeyUp(e: KeyboardEvent): void {
			if (e.key !== " " || !spaceTaken.current) return;
			spaceTaken.current = false;
			take(e);
		}

		/** A modified click selects rather than opens, on any item in either view. */
		function onClick(e: MouseEvent): void {
			const target = e.target as Element;
			const own = target.closest<HTMLElement>(ITEM);
			if (!own || target.closest(NO_DRAG)) return;
			const ids = cells().map(cellId);
			const id = own.dataset.key ?? "";
			activeFocusedIndex.current = ids.indexOf(id);
			const toggle = isActionKey(e, isApplePlatform());
			if (!toggle && !e.shiftKey) return;
			take(e);
			if (e.shiftKey) rangeSelect(id, ids);
			else toggleSelect(id);
			inspectSelection();
		}

		return { focusCanvas, onKeyDown, onKeyUp, onClick };
	}, []);

	useEffect(() => {
		const root = latest.current.containerRef.current;
		document.addEventListener("keydown", api.onKeyDown, true);
		document.addEventListener("keyup", api.onKeyUp, true);
		root?.addEventListener("click", api.onClick, true);
		// A new location is a new list: an index into the old one means nothing there.
		const stop = effect(() => {
			void currentPath.value;
			activeFocusedIndex.current = -1;
		});
		return () => {
			stop();
			document.removeEventListener("keydown", api.onKeyDown, true);
			document.removeEventListener("keyup", api.onKeyUp, true);
			root?.removeEventListener("click", api.onClick, true);
		};
	}, []);

	return { focusCanvas: api.focusCanvas, note };
}
