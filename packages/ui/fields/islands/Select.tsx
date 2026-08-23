import type { JSX, VNode } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import "../styles/field.css";
import "../styles/select.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useListNavigation } from "../hooks/useListNavigation.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, Option, OptionGroup, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link Select} (aliased as {@link Dropdown}). */
export interface SelectProps extends BaseFieldProps {
	/** Flat options, or option groups (rendered with headers when `grouping`). */
	options: Option[] | OptionGroup[];
	/** Bound value — raw string (uncontrolled) or `Signal<string>` (controlled). Empty = no selection. */
	value?: Bindable<string>;
	/** Fired whenever the selection changes. */
	onValueChange?: ValueChange<string>;
	/** Text shown when nothing is selected. */
	placeholder?: string;
	/** Render an in-panel search box that filters options by label. */
	filter?: boolean;
	/** Placeholder for the filter search box. */
	filterPlaceholder?: string;
	/** Show a clear (×) control on the trigger when a value is selected. */
	showClear?: boolean;
	/** Render `OptionGroup` headers for grouped input (or by `Option.group` on flat input). */
	grouping?: boolean;
	/** Windowed rendering for large flat lists (renders only visible rows). */
	virtualScroll?: boolean;
	/** Row height in px used by the windowed renderer (required for accurate `virtualScroll`). */
	virtualItemSize?: number;
	/**
	 * Custom content for one option row, rendered in place of its label.
	 *
	 * For options that carry an identity rather than a word — a person, a workspace, a currency — where
	 * a face or a mark is what the reader actually scans for. The row keeps its own selected-check
	 * channel, its `role="option"` and its `aria-selected`, so the template supplies presentation only
	 * and never has to reconstruct the semantics. Keep `Option.label` truthful regardless: it is what
	 * typeahead matches, what the filter searches, and the fallback name.
	 */
	optionTemplate?: (opt: Option) => VNode | string;
	/**
	 * Custom content for the SELECTED value on the trigger. Defaults to {@link optionTemplate} when
	 * only that is given, so the common case — the same row shape in both places — is one prop.
	 */
	valueTemplate?: (opt: Option) => VNode | string;
	class?: string;
}
// #endregion

// #region Option normalisation
interface RenderGroup {
	label: string | null;
	items: Option[];
}

function isGroupArray(options: Option[] | OptionGroup[]): options is OptionGroup[] {
	return options.length > 0 && Array.isArray((options[0] as OptionGroup).items);
}

/** Collapse flat/grouped input into render groups, honouring `grouping` + a filter query. */
function toRenderGroups(
	options: Option[] | OptionGroup[],
	grouping: boolean,
	query: string,
): RenderGroup[] {
	const q = query.trim().toLowerCase();
	const keep = (o: Option) => q === "" || o.label.toLowerCase().includes(q);

	let groups: RenderGroup[];
	if (isGroupArray(options)) {
		groups = options.map((g) => ({ label: g.label, items: g.items }));
	} else if (grouping) {
		const order: string[] = [];
		const byKey = new Map<string, Option[]>();
		for (const o of options) {
			const key = o.group ?? "";
			if (!byKey.has(key)) {
				byKey.set(key, []);
				order.push(key);
			}
			byKey.get(key)!.push(o);
		}
		groups = order.map((key) => ({ label: key === "" ? null : key, items: byKey.get(key)! }));
	} else {
		groups = [{ label: null, items: options }];
	}

	return groups
		.map((g) => ({ label: g.label, items: g.items.filter(keep) }))
		.filter((g) => g.items.length > 0);
}
// #endregion

/**
 * Select — single-select dropdown (WAI-ARIA combobox + listbox popup). Signal-first value binding,
 * optional in-panel filter, clearable selection, grouped rendering, and windowed (`virtualScroll`)
 * rendering for large lists. Keyboard: Enter/Space/ArrowDown open; typeahead or filter narrows;
 * Arrow/Home/End move the active option; Enter selects; Escape closes. Exported also as `Dropdown`.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} while the trigger stays in place,
 * and claims a live stacking index from {@link useOverlayStack}. A `position: fixed` panel that stays
 * in the tree is not safe: an ancestor with `overflow: hidden` clips it and one with
 * `transform`/`filter`/`backdrop-filter` re-bases it onto that ancestor's box — which is exactly what
 * a Dialog panel is, so a Select opened inside one was clipped to the dialog. The ARIA wiring is
 * id-based (`aria-controls`/`aria-activedescendant`), so it survives the move intact.
 *
 * `optionTemplate`/`valueTemplate` let a row carry an identity rather than a word — a person's face,
 * a workspace mark — without a caller hand-rolling a dropdown to get it. They are presentation only:
 * the row keeps its own selected-check, `role="option"` and `aria-selected`, and `Option.label` stays
 * the name typeahead matches and assistive tech reads.
 */
export function Select(props: SelectProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		placeholder = "Select",
		filter = false,
		filterPlaceholder = "Search",
		showClear = false,
		grouping = false,
		virtualScroll = false,
		virtualItemSize = 40,
		optionTemplate,
		valueTemplate = optionTemplate,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": ariaDescribedby,
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const rootId = useId(id, "select");
	const listId = `${rootId}-list`;

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);
	const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

	// All options flattened (unfiltered) — used for label lookup + typeahead.
	const allFlat = useMemo<Option[]>(() => {
		if (isGroupArray(options)) return options.flatMap((g) => g.items);
		return options;
	}, [options]);

	const groups = useMemo(() => toRenderGroups(options, grouping, filter ? query : ""), [
		options,
		grouping,
		filter,
		query,
	]);
	const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

	const selected = ctrl.signal.value;
	const selectedOption = allFlat.find((o) => o.value === selected);

	const nav = useListNavigation(() => flat.length, (i) => !!flat[i]?.disabled);

	const stack = useOverlayStack({ active: open, layer: "popover" });
	const floating = useFloating({ open, triggerRef, panelRef, placement: "bottom-start" });

	// `enabled` gates the ESCAPE channel only. That channel is exclusive — its handler calls
	// `stopImmediatePropagation`, so exactly one overlay may own the key — and every listener sits on
	// `document` in the capture phase, where they run in registration order rather than stacking
	// order. Without this a Select opened UNDER a later overlay silently eats that overlay's Escape.
	// Outside-pointer dismissal is governed by containment and stays live regardless, so this cannot
	// make the panel undismissable.
	useDismiss({ open, enabled: stack.isTop, onDismiss: () => close(), panelRef, triggerRef });

	// #region Open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		setOpen(true);
	};
	const close = () => {
		setOpen(false);
		setQuery("");
		nav.reset();
	};
	const toggle = () => (open ? close() : openPanel());

	// Seed the active index to the selected row and focus the filter when opening.
	useEffect(() => {
		if (!open) return;
		const idx = flat.findIndex((o) => o.value === ctrl.get());
		nav.reset(idx >= 0 ? idx : -1);
		if (filter) filterRef.current?.focus();
	}, [open]);
	// #endregion

	// #region Selection
	const selectAt = (index: number) => {
		const opt = flat[index];
		if (!opt || opt.disabled) return;
		ctrl.set(opt.value);
		close();
		triggerRef.current?.focus();
	};
	const clear = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		ctrl.set("");
	};
	// #endregion

	// #region Virtual window
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportH, setViewportH] = useState(0);
	const useVirtual = virtualScroll && groups.length <= 1;
	useEffect(() => {
		if (open && useVirtual) setViewportH(listRef.current?.clientHeight ?? 0);
	}, [open, useVirtual, flat.length]);

	const vp = viewportH || virtualItemSize * 8;
	const overscan = 4;
	const winStart = useVirtual ? Math.max(0, Math.floor(scrollTop / virtualItemSize) - overscan) : 0;
	const winEnd = useVirtual
		? Math.min(flat.length, Math.ceil((scrollTop + vp) / virtualItemSize) + overscan)
		: flat.length;
	// #endregion

	// #region Keyboard
	const typeaheadMatch = (key: string) => {
		const now = Date.now();
		const t = typeahead.current;
		t.buffer = now - t.at > 700 ? key : t.buffer + key;
		t.at = now;
		const from = nav.active.peek();
		const n = flat.length;
		for (let step = 1; step <= n; step++) {
			const i = (from + step + n) % n;
			if (!flat[i]?.disabled && flat[i].label.toLowerCase().startsWith(t.buffer.toLowerCase())) {
				nav.reset(i);
				return;
			}
		}
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
		if (disabled || readOnly) return;
		if (!open) {
			if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
				e.preventDefault();
				openPanel();
			}
			return;
		}
		if (nav.onKeyDown(e as unknown as KeyboardEvent)) return;
		if (e.key === "Enter") {
			e.preventDefault();
			if (nav.active.peek() >= 0) selectAt(nav.active.peek());
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			triggerRef.current?.focus();
			return;
		}
		if (e.key === "Tab") {
			close();
			return;
		}
		if (!filter && e.key.length === 1) {
			e.preventDefault();
			typeaheadMatch(e.key);
		}
	};
	// #endregion

	const activeIdx = nav.active.value;
	const activeDescendant = open && activeIdx >= 0 ? `${rootId}-opt-${activeIdx}` : undefined;

	// #region Keeping a row in view
	/**
	 * Scroll row `index` into the list's OWN scroller.
	 *
	 * Written directly rather than via `scrollIntoView`, which walks up and scrolls every ancestor
	 * scroller it finds — and a portalled panel's ancestor is the page, so the document would lurch
	 * behind the open dropdown.
	 *
	 * `centre` is for the moment the panel opens: a long list must open ON the current value, or a
	 * two-hundred-entry year picker asks the reader to hunt for the year they already chose. Keyboard
	 * movement uses the nearest edge instead, so the highlight walks off the end of the viewport
	 * rather than jumping the list under it.
	 */
	const scrollRowIntoView = (index: number, centre: boolean) => {
		const list = listRef.current;
		if (!list || index < 0) return;
		let top: number;
		let size: number;
		if (useVirtual) {
			// The windowed renderer positions rows arithmetically, so the target row need not exist in
			// the DOM yet — which is the whole point of asking for it by index. The sizer those offsets
			// are measured from sits inside the list's own padding, so that pad has to be added back:
			// without it End and typeahead land four pixels short and clip the row they just selected.
			const sizer = list.querySelector<HTMLElement>(".ui-select__sizer");
			const pad = sizer
				? sizer.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
				: 0;
			top = pad + index * virtualItemSize;
			size = virtualItemSize;
		} else {
			const row = typeof document === "undefined"
				? null
				: document.getElementById(`${rootId}-opt-${index}`);
			if (!row) return;
			top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
			size = row.offsetHeight;
		}
		const view = list.clientHeight;
		let next: number;
		if (centre) next = top - (view - size) / 2;
		else if (top < list.scrollTop) next = top;
		else if (top + size > list.scrollTop + view) next = top + size - view;
		else return;
		list.scrollTop = Math.max(0, Math.min(next, list.scrollHeight - view));
		// The scroll event that follows a programmatic write is async; publishing the offset here keeps
		// the windowed range in step with the very first painted frame.
		if (useVirtual) setScrollTop(list.scrollTop);
	};

	/**
	 * The list height the opening centre was computed against, or `-1` while closed.
	 *
	 * Two things make one shot insufficient. The centring runs BEFORE paint — a `useEffect` is
	 * deferred past it, so a hundred-year year picker visibly painted on 1926 and snapped 3,762px to
	 * 2026 — and `--float-available-h` only lands on the commit AFTER open, so on a short viewport the
	 * first pass centres against a list that is about to get shorter. Re-running when the list's own
	 * height actually changes fixes both without re-centring on every reposition, which would fight a
	 * reader who has started scrolling.
	 */
	const centredFor = useRef(-1);

	useLayoutEffect(() => {
		if (!open) {
			centredFor.current = -1;
			return;
		}
		const h = listRef.current?.clientHeight ?? 0;
		if (h === centredFor.current) return;
		centredFor.current = h;
		scrollRowIntoView(flat.findIndex((o) => o.value === ctrl.get()), true);
	}, [open, floating?.availableHeight]);

	useEffect(() => {
		if (!open) return;
		scrollRowIntoView(activeIdx, false);
	}, [open, activeIdx]);
	// #endregion

	// #region Row renderer
	const renderOption = (opt: Option, index: number, virtual: boolean) => (
		<li
			id={`${rootId}-opt-${index}`}
			key={opt.value}
			role="option"
			aria-selected={opt.value === selected}
			aria-disabled={opt.disabled || undefined}
			class={cx(
				"ui-select__option",
				virtual && "ui-select__option--virtual",
				index === activeIdx && "ui-select__option--active",
				opt.disabled && "ui-select__option--disabled",
			)}
			style={virtual
				? styleVars({
					"--v-top": `${index * virtualItemSize}px`,
					"--v-size": `${virtualItemSize}px`,
				})
				: undefined}
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => selectAt(index)}
			onPointerMove={() => nav.reset(index)}
		>
			<span class="ui-select__option-check" aria-hidden="true">
				{opt.value === selected && <Icon name="check" />}
			</span>
			<span
				class={cx(
					"ui-select__option-label",
					optionTemplate && "ui-select__option-label--template",
				)}
			>
				{optionTemplate ? optionTemplate(opt) : opt.label}
			</span>
		</li>
	);
	// #endregion

	return (
		<span
			class={cx(
				"ui-select",
				"ui-field",
				...fieldModifiers("ui-field", { size, status, fluid, disabled, readOnly, open }),
				className,
			)}
		>
			<button
				ref={triggerRef}
				id={rootId}
				type="button"
				class="ui-select__trigger"
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				aria-activedescendant={activeDescendant}
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedby}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-disabled={disabled || undefined}
				disabled={disabled}
				onClick={toggle}
				onKeyDown={onKeyDown}
			>
				<span
					class={cx(
						"ui-select__label",
						!selectedOption && "ui-select__label--placeholder",
						selectedOption && valueTemplate && "ui-select__label--template",
					)}
				>
					{selectedOption
						? valueTemplate ? valueTemplate(selectedOption) : selectedOption.label
						: placeholder}
				</span>
			</button>
			{name && <input type="hidden" name={name} value={selected} />}
			{showClear && selectedOption && !disabled && !readOnly && (
				<button type="button" class="ui-select__clear" aria-label="Clear selection" onClick={clear}>
					<Icon name="close" />
				</button>
			)}
			<Icon name="chevron-down" class="ui-select__chevron" />

			{open && (
				<BodyPortal>
					<div
						ref={panelRef}
						class={cx(
							"ui-select__panel",
							floating?.placement.startsWith("top") && "ui-select__panel--top",
						)}
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
							"--float-width": floating ? `${floating.width}px` : undefined,
							// The panel caps itself to the space actually left on the resolved side, so a long
							// list scrolls internally instead of running off the bottom of the screen. `null`
							// means that side is deliberately unbounded, which is not a length — emit nothing
							// and let `--fld-panel-maxh` stand alone.
							"--float-available-h": floating?.availableHeight != null
								? `${floating.availableHeight}px`
								: undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{filter && (
							<div class="ui-select__filter">
								<input
									ref={filterRef}
									type="text"
									class="ui-select__filter-input"
									placeholder={filterPlaceholder}
									value={query}
									aria-label={filterPlaceholder}
									aria-controls={listId}
									aria-activedescendant={activeDescendant}
									onInput={(e) => {
										setQuery(e.currentTarget.value);
										nav.reset(-1);
									}}
									onKeyDown={onKeyDown}
								/>
							</div>
						)}
						<ul
							ref={listRef}
							id={listId}
							role="listbox"
							class={cx("ui-select__list", useVirtual && "ui-select__list--virtual")}
							aria-label={ariaLabel ?? placeholder}
							onScroll={useVirtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
						>
							{flat.length === 0 && (
								<li class="ui-select__empty" role="presentation">No results</li>
							)}
							{useVirtual
								? (
									<div
										class="ui-select__sizer"
										style={styleVars({ "--v-total": `${flat.length * virtualItemSize}px` })}
									>
										{flat.slice(winStart, winEnd).map((opt, k) =>
											renderOption(opt, winStart + k, true)
										)}
									</div>
								)
								: groups.map((g, gi) => {
									const base = groups.slice(0, gi).reduce((n, gg) => n + gg.items.length, 0);
									return (
										<li key={g.label ?? gi} role="presentation">
											{grouping && g.label && (
												<div class="ui-select__group-label" role="presentation">{g.label}</div>
											)}
											<ul role="presentation" class="ui-select__group-items">
												{g.items.map((opt, oi) => renderOption(opt, base + oi, false))}
											</ul>
										</li>
									);
								})}
						</ul>
					</div>
				</BodyPortal>
			)}
		</span>
	);
}

/** PrimeNG-parity alias for {@link Select}. */
export const Dropdown = Select;
