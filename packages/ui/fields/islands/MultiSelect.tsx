import type { JSX, VNode } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "../styles/field.css";
import "../styles/multiselect.css";
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
/** How selected values are represented on the trigger. */
export type MultiSelectDisplay = "comma" | "chip";

/** Props for {@link MultiSelect}. */
export interface MultiSelectProps extends BaseFieldProps {
	/** Flat options, or option groups (rendered with headers when `grouping`). */
	options: Option[] | OptionGroup[];
	/** Bound values — raw `string[]` (uncontrolled) or `Signal<string[]>` (controlled). */
	value?: Bindable<string[]>;
	/** Fired whenever the selection set changes. */
	onValueChange?: ValueChange<string[]>;
	/** Text shown when nothing is selected. */
	placeholder?: string;
	/** Render an in-panel search box that filters options by label. */
	filter?: boolean;
	/** Placeholder for the filter search box. */
	filterPlaceholder?: string;
	/** Show a clear (×) control on the trigger when values are selected. */
	showClear?: boolean;
	/** Trigger representation of selected values. */
	display?: MultiSelectDisplay;
	/** Render a select-all control that toggles every (filtered) option. */
	selectAll?: boolean;
	/** Render `OptionGroup` headers for grouped input (or by `Option.group` on flat input). */
	grouping?: boolean;
	/** Windowed rendering for large flat lists (renders only visible rows). */
	virtualScroll?: boolean;
	/** Row height in px used by the windowed renderer. */
	virtualItemSize?: number;
	/** Collapse the trigger to a count summary once more than this many are selected. */
	maxSelectedLabels?: number;
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

/** Check-mark glyph shared by the option/select-all checkboxes. */
function CheckGlyph(): VNode {
	return (
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M3.5 8.5l3 3 6-6.5"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/**
 * MultiSelect — multi-select dropdown (WAI-ARIA listbox popup, `aria-multiselectable`). Options carry
 * a checkbox and toggle without closing; selection renders on the trigger as comma text or removable
 * chips. Optional in-panel filter + select-all header, grouped rendering, and windowed
 * (`virtualScroll`) rendering. Keyboard mirrors {@link Select} but Enter/Space toggles.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) — the trap a Dialog panel
 * sets. The trigger stays in place and the id-based ARIA wiring survives the move.
 */
export function MultiSelect(props: MultiSelectProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		placeholder = "Select",
		filter = false,
		filterPlaceholder = "Search",
		showClear = false,
		display = "comma",
		selectAll = false,
		grouping = false,
		virtualScroll = false,
		virtualItemSize = 40,
		maxSelectedLabels,
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

	const ctrl = useControllable<string[]>(value, [], onValueChange);
	const rootId = useId(id, "multiselect");
	const listId = `${rootId}-list`;

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);

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
	const isSelected = (v: string) => selected.includes(v);
	const selectedOptions = allFlat.filter((o) => isSelected(o.value));

	const nav = useListNavigation(() => flat.length, (i) => !!flat[i]?.disabled);
	const stack = useOverlayStack({ active: open, layer: "popover" });
	const floating = useFloating({ open, triggerRef, panelRef, placement: "bottom-start" });
	useDismiss({ open, onDismiss: () => close(), panelRef, triggerRef });

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

	useEffect(() => {
		if (!open) return;
		nav.reset(flat.length > 0 ? 0 : -1);
		if (filter) filterRef.current?.focus();
	}, [open]);
	// #endregion

	// #region Selection
	const toggleValue = (v: string) => {
		const set = new Set(selected);
		if (set.has(v)) set.delete(v);
		else set.add(v);
		ctrl.set([...set]);
	};
	const toggleAt = (index: number) => {
		const opt = flat[index];
		if (!opt || opt.disabled) return;
		toggleValue(opt.value);
	};
	const removeChip = (e: JSX.TargetedMouseEvent<HTMLButtonElement>, v: string) => {
		e.stopPropagation();
		ctrl.set(selected.filter((x) => x !== v));
	};
	const clearAll = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		ctrl.set([]);
	};

	const enabledFiltered = flat.filter((o) => !o.disabled);
	const allSelected = enabledFiltered.length > 0 &&
		enabledFiltered.every((o) => isSelected(o.value));
	const someSelected = enabledFiltered.some((o) => isSelected(o.value));
	const toggleSelectAll = () => {
		if (allSelected) {
			const remove = new Set(enabledFiltered.map((o) => o.value));
			ctrl.set(selected.filter((v) => !remove.has(v)));
		} else {
			const set = new Set(selected);
			for (const o of enabledFiltered) set.add(o.value);
			ctrl.set([...set]);
		}
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
		if (e.key === "Enter" || e.key === " ") {
			if (e.key === " " && filter) return; // allow space in the filter box
			e.preventDefault();
			if (nav.active.peek() >= 0) toggleAt(nav.active.peek());
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			triggerRef.current?.focus();
			return;
		}
		if (e.key === "Tab") close();
	};
	// #endregion

	const activeIdx = nav.active.value;
	const activeDescendant = open && activeIdx >= 0 ? `${rootId}-opt-${activeIdx}` : undefined;

	// #region Trigger content
	const renderTriggerValue = (): VNode | string => {
		if (selectedOptions.length === 0) {
			return <span class="ui-multiselect__placeholder">{placeholder}</span>;
		}
		const overCap = maxSelectedLabels !== undefined && selectedOptions.length > maxSelectedLabels;
		if (overCap || display === "comma") {
			if (overCap) {
				return <span class="ui-multiselect__summary">{`${selectedOptions.length} selected`}</span>;
			}
			return (
				<span class="ui-multiselect__summary">
					{selectedOptions.map((o) => o.label).join(", ")}
				</span>
			);
		}
		return (
			<>
				{selectedOptions.map((o) => (
					<span class="ui-multiselect__chip" key={o.value}>
						<span class="ui-multiselect__chip-label">{o.label}</span>
						{!disabled && !readOnly && (
							<button
								type="button"
								class="ui-multiselect__chip-remove"
								aria-label={`Remove ${o.label}`}
								onClick={(e) => removeChip(e, o.value)}
							>
								<Icon name="close" />
							</button>
						)}
					</span>
				))}
			</>
		);
	};
	// #endregion

	// #region Row renderer
	const renderOption = (opt: Option, index: number, virtual: boolean) => {
		const checked = isSelected(opt.value);
		return (
			<li
				id={`${rootId}-opt-${index}`}
				key={opt.value}
				role="option"
				aria-selected={checked}
				aria-disabled={opt.disabled || undefined}
				class={cx(
					"ui-multiselect__option",
					virtual && "ui-multiselect__option--virtual",
					index === activeIdx && "ui-multiselect__option--active",
					opt.disabled && "ui-multiselect__option--disabled",
				)}
				style={virtual
					? styleVars({
						"--v-top": `${index * virtualItemSize}px`,
						"--v-size": `${virtualItemSize}px`,
					})
					: undefined}
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => toggleAt(index)}
				onPointerMove={() => nav.reset(index)}
			>
				<span
					class="ui-multiselect__checkbox"
					role="checkbox"
					aria-checked={checked}
					aria-hidden="true"
				>
					{checked && <CheckGlyph />}
				</span>
				<span class="ui-multiselect__option-label">{opt.label}</span>
			</li>
		);
	};
	// #endregion

	return (
		<span
			class={cx(
				"ui-multiselect",
				"ui-field",
				...fieldModifiers("ui-field", { size, status, fluid, disabled, readOnly, open }),
				className,
			)}
		>
			<button
				ref={triggerRef}
				id={rootId}
				type="button"
				class="ui-multiselect__trigger"
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
				<span class="ui-multiselect__value">{renderTriggerValue()}</span>
			</button>
			{name && <input type="hidden" name={name} value={selected.join(",")} />}
			{showClear && selectedOptions.length > 0 && !disabled && !readOnly && (
				<button
					type="button"
					class="ui-multiselect__clear"
					aria-label="Clear selection"
					onClick={clearAll}
				>
					<Icon name="close" />
				</button>
			)}
			<Icon name="chevron-down" class="ui-multiselect__chevron" />

			{open && (
				<BodyPortal>
					<div
						ref={panelRef}
						class="ui-multiselect__panel"
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
							"--float-width": floating ? `${floating.width}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{(filter || selectAll) && (
							<div class="ui-multiselect__header">
								{selectAll && (
									<button
										type="button"
										class="ui-multiselect__select-all"
										onClick={toggleSelectAll}
									>
										<span
											class="ui-multiselect__checkbox"
											role="checkbox"
											aria-checked={allSelected ? true : someSelected ? "mixed" : false}
											aria-hidden="true"
										>
											{(allSelected || someSelected) && <CheckGlyph />}
										</span>
										<span>Select all</span>
									</button>
								)}
								{filter && (
									<input
										ref={filterRef}
										type="text"
										class="ui-multiselect__filter-input"
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
								)}
							</div>
						)}
						<ul
							ref={listRef}
							id={listId}
							role="listbox"
							aria-multiselectable="true"
							class={cx("ui-multiselect__list", useVirtual && "ui-multiselect__list--virtual")}
							aria-label={ariaLabel ?? placeholder}
							onScroll={useVirtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
						>
							{flat.length === 0 && (
								<li class="ui-multiselect__empty" role="presentation">No results</li>
							)}
							{useVirtual
								? (
									<div
										class="ui-multiselect__sizer"
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
												<div class="ui-multiselect__group-label" role="presentation">{g.label}</div>
											)}
											<ul role="presentation" class="ui-multiselect__group-items">
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
