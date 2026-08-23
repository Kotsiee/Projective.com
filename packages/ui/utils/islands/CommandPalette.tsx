import type { JSX, VNode } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "../styles/command-palette.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useListNavigation } from "../../hooks/useListNavigation.ts";
import type { Bindable } from "../../fields/types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";

// #region Props
/** A labelled group of commands in the palette model. */
export interface CommandGroup {
	label?: string;
	items: MenuItem[];
}

/** Props for {@link CommandPalette}. */
export interface CommandPaletteProps {
	/** Open state — raw boolean (uncontrolled) or a `Signal<boolean>` (controlled). */
	open: Bindable<boolean>;
	/** Commands to search: a flat `MenuItem[]` or grouped `CommandGroup[]`. */
	commands: MenuItem[] | CommandGroup[];
	/** Filter input placeholder (default `"Type a command or search…"`). */
	placeholder?: string;
	/** Commands surfaced under a "Recent" heading when the query is empty. */
	recent?: MenuItem[];
	/** Copy shown when the query matches nothing (default `"No results"`). */
	emptyMessage?: string;
	/**
	 * Global hotkey that toggles the palette, e.g. `"mod+k"` (mod = ⌘ on macOS, Ctrl elsewhere).
	 * Bound on `document` while mounted.
	 */
	hotkey?: string;
	/** Render override for a single result row. */
	itemTemplate?: (item: MenuItem, active: boolean) => VNode;
	/** Fired when a command is chosen (before its own `command`/`url` runs). */
	onSelect?: (item: MenuItem) => void;
	/** Fired whenever the open state changes. */
	onOpenChange?: (open: boolean) => void;
	id?: string;
	class?: string;
}

interface FlatGroup {
	label: string | null;
	items: MenuItem[];
}
// #endregion

// #region Fuzzy matching
/** Subsequence fuzzy score — lower is better, `null` when `q` is not a subsequence of `text`. */
function fuzzyScore(text: string, q: string): number | null {
	const t = text.toLowerCase();
	const query = q.toLowerCase();
	let from = 0;
	let score = 0;
	let prev = -1;
	for (const ch of query) {
		const idx = t.indexOf(ch, from);
		if (idx === -1) return null;
		score += idx - from;
		if (prev >= 0 && idx === prev + 1) score -= 1;
		prev = idx;
		from = idx + 1;
	}
	return score;
}

function isGrouped(model: MenuItem[] | CommandGroup[]): model is CommandGroup[] {
	return model.length > 0 && Array.isArray((model[0] as CommandGroup).items);
}
// #endregion

/**
 * CommandPalette — a ⌘K-style modal command launcher. It opens a centred overlay (backdrop + focus
 * trap + `--z-overlay` via {@link useOverlayStack}) containing a combobox input that fuzzy-filters the
 * `commands` model into grouped listbox results; an empty query shows `recent` (or everything). The
 * keyboard model is full WAI-ARIA combobox/listbox: typing filters, ArrowUp/Down (roving via
 * {@link useListNavigation}) + Home/End move the active row, Enter runs it, Escape/outside-click
 * closes. An optional global `hotkey` toggles it. Choosing a command fires `onSelect`, then its own
 * `command`/`url`.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element | null {
	const {
		open,
		commands,
		placeholder = "Type a command or search…",
		recent,
		emptyMessage = "No results",
		hotkey,
		itemTemplate,
		onSelect,
		onOpenChange,
		id,
		class: className,
	} = props;

	const ctrl = useControllable<boolean>(open, false, onOpenChange);
	const isOpen = ctrl.signal.value;
	const rootId = useId(id, "cmdk");
	const listId = `${rootId}-list`;
	const inputId = `${rootId}-input`;

	const [query, setQuery] = useState("");

	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const stack = useOverlayStack({ active: isOpen, lockScroll: true });
	useFocusTrap({ active: isOpen, containerRef: panelRef, initialFocusRef: inputRef });

	const close = () => ctrl.set(false);
	// `enabled` gates the listener itself: the palette registers on `document` in the capture phase, so
	// merely no-oping inside the callback would still consume Escape from anything it launched above it.
	useDismiss({ open: isOpen, enabled: stack.isTop, onDismiss: close, panelRef });

	// #region Model → filtered groups
	const baseGroups = useMemo<FlatGroup[]>(() => {
		if (isGrouped(commands)) {
			return commands.map((g) => ({
				label: g.label ?? null,
				items: g.items.filter((i) => !i.separator),
			}));
		}
		return [{ label: null, items: commands.filter((i) => !i.separator) }];
	}, [commands]);

	const groups = useMemo<FlatGroup[]>(() => {
		const q = query.trim();
		if (q === "") {
			if (recent && recent.length > 0) return [{ label: "Recent", items: recent }, ...baseGroups];
			return baseGroups;
		}
		return baseGroups
			.map((g) => ({
				label: g.label,
				items: g.items
					.map((item) => ({ item, score: fuzzyScore(item.label ?? "", q) }))
					.filter((r) => r.score !== null)
					.sort((a, b) => (a.score! - b.score!))
					.map((r) => r.item),
			}))
			.filter((g) => g.items.length > 0);
	}, [baseGroups, recent, query]);

	const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
	// #endregion

	const nav = useListNavigation(() => flat.length, (i) => !!flat[i]?.disabled);

	// Reset the active row + query whenever the palette (re)opens or the result set changes.
	useEffect(() => {
		if (isOpen) {
			nav.reset(flat.length > 0 ? 0 : -1);
		} else {
			setQuery("");
			nav.reset(-1);
		}
	}, [isOpen]);
	useEffect(() => {
		nav.reset(flat.length > 0 ? 0 : -1);
	}, [query]);

	// #region Global hotkey
	useEffect(() => {
		if (!hotkey || typeof document === "undefined") return;
		const parts = hotkey.toLowerCase().split("+").map((p) => p.trim());
		const key = parts[parts.length - 1];
		const needMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("meta") ||
			parts.includes("cmd");
		const needShift = parts.includes("shift");
		const needAlt = parts.includes("alt");
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (e.key.toLowerCase() !== key) return;
			if (needMod && !mod) return;
			if (needShift && !e.shiftKey) return;
			if (needAlt && !e.altKey) return;
			e.preventDefault();
			ctrl.set(!ctrl.get());
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [hotkey]);
	// #endregion

	// #region Selection
	const selectAt = (index: number) => {
		const item = flat[index];
		if (!item || item.disabled) return;
		onSelect?.(item);
		item.command?.({ item, originalEvent: new Event("command") });
		if (item.url) globalThis.location.assign(item.url);
		close();
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (nav.onKeyDown(e as unknown as KeyboardEvent)) return;
		if (e.key === "Enter") {
			e.preventDefault();
			if (nav.active.peek() >= 0) selectAt(nav.active.peek());
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	};
	// #endregion

	if (!isOpen) return null;

	const activeIdx = nav.active.value;
	const activeDescendant = activeIdx >= 0 ? `${rootId}-opt-${activeIdx}` : undefined;

	// #region Row renderer
	const renderRow = (item: MenuItem, index: number) => {
		const active = index === activeIdx;
		return (
			<li
				id={`${rootId}-opt-${index}`}
				key={item.key ?? item.label ?? index}
				role="option"
				aria-selected={active}
				aria-disabled={item.disabled || undefined}
				class={cx(
					"ui-cmdk__option",
					active && "ui-cmdk__option--active",
					item.disabled && "ui-cmdk__option--disabled",
				)}
				onPointerMove={() => nav.reset(index)}
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => selectAt(index)}
			>
				{itemTemplate ? itemTemplate(item, active) : (
					<>
						{item.icon && <span class="ui-cmdk__option-icon" aria-hidden="true">{item.icon}</span>}
						<span class="ui-cmdk__option-label">{item.label}</span>
						{item.badge !== undefined && <span class="ui-cmdk__option-badge">{item.badge}</span>}
						{item.shortcut && <kbd class="ui-cmdk__option-shortcut">{item.shortcut}</kbd>}
					</>
				)}
			</li>
		);
	};
	// #endregion

	return (
		<div class={cx("ui-cmdk", className)} style={styleVars({ "--cmdk-z": stack.zIndex })}>
			<div class="ui-cmdk__backdrop" aria-hidden="true" onClick={close} />
			<div
				ref={panelRef}
				class="ui-cmdk__panel"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
			>
				<div class="ui-cmdk__search">
					<span class="ui-cmdk__search-icon" aria-hidden="true">⌕</span>
					<input
						ref={inputRef}
						id={inputId}
						type="text"
						class="ui-cmdk__input"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={activeDescendant}
						aria-autocomplete="list"
						aria-label={placeholder}
						placeholder={placeholder}
						autocomplete="off"
						spellcheck={false}
						value={query}
						onInput={(e) => setQuery(e.currentTarget.value)}
						onKeyDown={onKeyDown}
					/>
				</div>

				<ul id={listId} role="listbox" class="ui-cmdk__list" aria-label="Commands">
					{flat.length === 0 && <li class="ui-cmdk__empty" role="presentation">{emptyMessage}</li>}
					{groups.map((g, gi) => {
						const base = groups.slice(0, gi).reduce((n, gg) => n + gg.items.length, 0);
						return (
							<li key={g.label ?? gi} role="presentation" class="ui-cmdk__group">
								{g.label && <div class="ui-cmdk__group-label" role="presentation">{g.label}</div>}
								<ul role="presentation" class="ui-cmdk__group-items">
									{g.items.map((item, oi) => renderRow(item, base + oi))}
								</ul>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
