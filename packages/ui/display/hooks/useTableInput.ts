/**
 * `useTableInput` — the `DataTable` body's pointer and keyboard model, delegated from the body so a
 * virtualized list binds four listeners however many rows it shows. Owns the selection anchor and
 * the roving row focus; the handlers are stable across renders and read the latest rows through a ref.
 */
import type { JSX, RefObject } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useMemo, useRef } from "preact/hooks";
import type { SelectionMode } from "../types/data-table.ts";
import { applySelection, type SelectionGesture } from "../core/table-selection.ts";

const CONTROL =
	"a,button,input,select,textarea,label,[contenteditable],[role=button],[role=checkbox]";

/** Options for {@link useTableInput}. */
export interface TableInputOptions<T> {
	rows: readonly T[];
	keys: readonly string[];
	bodyRef: RefObject<HTMLElement>;
	selectionMode: SelectionMode;
	getSelection: () => ReadonlySet<string>;
	setSelection: (next: ReadonlySet<string>) => void;
	/** Where the Shift anchor lives when it must outlast the table (a layout that remounts it). */
	anchor?: Signal<string | null>;
	onRowActivate?: (row: T, event: MouseEvent | KeyboardEvent) => void;
	/** The rendered range, so exactly one rendered row is in the tab order. */
	range: { start: number; end: number };
	scrollIntoView: (index: number) => void;
	pageRows: () => number;
	announce: (message: string) => void;
}

/** What {@link useTableInput} returns. */
export interface TableInput {
	select: (gesture: SelectionGesture) => void;
	/** The row that takes Tab focus (roving tabindex). */
	tabKey: string | null;
	onClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
	onMouseDown: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
	onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
	onFocusIn: (e: JSX.TargetedFocusEvent<HTMLDivElement>) => void;
}

interface Hit<T> {
	el: HTMLElement;
	index: number;
	row: T;
	key: string;
}

export function useTableInput<T>(opts: TableInputOptions<T>): TableInput {
	const focusKey = useSignal<string | null>(null);
	const ownAnchor = useSignal<string | null>(null);
	const latest = useRef(opts);
	latest.current = opts;
	const anchor = opts.anchor ?? ownAnchor;
	const anchorRef = useRef(anchor);
	anchorRef.current = anchor;

	const handlers = useMemo(() => {
		const select = (gesture: SelectionGesture) => {
			const o = latest.current;
			const next = applySelection(
				{ selected: o.getSelection(), anchor: anchorRef.current.peek() },
				gesture,
				o.selectionMode,
				o.keys,
			);
			anchorRef.current.value = next.anchor;
			o.setSelection(next.selected);
			o.announce(next.selected.size === 0 ? "Selection cleared" : `${next.selected.size} selected`);
		};

		const rowAt = (target: EventTarget | null): Hit<T> | null => {
			const o = latest.current;
			const el = (target as Element | null)?.closest<HTMLElement>(".ui-dt__row[data-key]");
			if (!el || !o.bodyRef.current?.contains(el)) return null;
			const index = Number(el.dataset.index);
			const row = o.rows[index];
			const key = o.keys[index];
			return row === undefined || key === undefined ? null : { el, index, row, key };
		};

		const focusRow = (index: number): string | undefined => {
			const o = latest.current;
			const i = Math.max(0, Math.min(o.keys.length - 1, index));
			const key = o.keys[i];
			if (key === undefined) return undefined;
			focusKey.value = key;
			o.scrollIntoView(i);
			setTimeout(() => {
				const el = o.bodyRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
				if (el && document.activeElement !== el) el.focus({ preventScroll: true });
			}, 0);
			return key;
		};

		const onMouseDown = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
			if (latest.current.selectionMode !== "none" && e.shiftKey && rowAt(e.target)) {
				e.preventDefault();
			}
		};

		const onClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
			const o = latest.current;
			const hit = rowAt(e.target);
			if (!hit) return;
			const target = e.target as Element;
			const selectable = o.selectionMode !== "none";
			if (target.closest("[data-dt-check]")) {
				select({ kind: "check", id: hit.key, shift: e.shiftKey });
				return;
			}
			if (target.closest(".ui-dt__tail")) return;
			const link = target.closest("[data-dt-link]");
			if (!link && target.closest(CONTROL)) return;
			const mods = e.ctrlKey || e.metaKey;
			if (selectable && (mods || e.shiftKey)) {
				e.preventDefault();
				select({ kind: "row", id: hit.key, ctrl: mods, shift: e.shiftKey });
				return;
			}
			if (link) return;
			const rowLink = hit.el.querySelector<HTMLAnchorElement>("[data-dt-link]");
			if (rowLink) rowLink.click();
			else if (o.onRowActivate) o.onRowActivate(hit.row, e);
			else if (selectable) select({ kind: "row", id: hit.key, ctrl: false, shift: false });
		};

		const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
			const o = latest.current;
			const target = e.target as HTMLElement;
			if (target.matches("input,textarea,select,[contenteditable]")) return;
			const hit = rowAt(target);
			if (!hit) return;
			const onRow = target === hit.el;
			const selectable = o.selectionMode !== "none";
			const multiple = o.selectionMode === "multiple";
			const go = (to: number) => {
				e.preventDefault();
				const key = focusRow(to);
				if (key && e.shiftKey && multiple) select({ kind: "extend", id: key, from: hit.key });
			};
			switch (e.key) {
				case "ArrowDown":
					return go(hit.index + 1);
				case "ArrowUp":
					return go(hit.index - 1);
				case "Home":
					return go(0);
				case "End":
					return go(o.keys.length - 1);
				case "PageDown":
					return go(hit.index + o.pageRows());
				case "PageUp":
					return go(hit.index - o.pageRows());
				case " ":
					if (!selectable || !onRow) return;
					e.preventDefault();
					select({ kind: "toggle", id: hit.key });
					return;
				case "Enter": {
					if (!onRow) return;
					const link = hit.el.querySelector<HTMLAnchorElement>("[data-dt-link]");
					if (link) {
						e.preventDefault();
						link.click();
					} else if (o.onRowActivate) {
						e.preventDefault();
						o.onRowActivate(hit.row, e);
					}
					return;
				}
				case "a":
				case "A":
					if ((e.ctrlKey || e.metaKey) && multiple) {
						e.preventDefault();
						select({ kind: "all" });
					}
					return;
				case "Escape":
					if (selectable && o.getSelection().size > 0) {
						e.preventDefault();
						e.stopPropagation();
						select({ kind: "none" });
					}
					return;
			}
		};

		const onFocusIn = (e: JSX.TargetedFocusEvent<HTMLDivElement>) => {
			const hit = rowAt(e.target);
			if (hit && focusKey.peek() !== hit.key) focusKey.value = hit.key;
		};

		return { select, onClick, onMouseDown, onKeyDown, onFocusIn };
	}, []);

	const { keys, range } = opts;
	const focusIndex = focusKey.value ? keys.indexOf(focusKey.value) : -1;
	const tabKey = focusIndex >= range.start && focusIndex <= range.end
		? focusKey.value
		: keys[range.start] ?? null;

	return { ...handlers, tabKey };
}
