import type { JSX, VNode } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import "../styles/listbox.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useListNavigation } from "../hooks/useListNavigation.ts";
import { ariaInvalid } from "../core/field.ts";
import type { BaseFieldProps, Bindable, Option, OptionGroup, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link Listbox} — an always-open inline listbox (no popup). */
export interface ListboxProps extends BaseFieldProps {
	/** Flat options, or option groups (rendered with headers when `grouping`). */
	options: Option[] | OptionGroup[];
	/** Bound value — a single `string` (single mode) or `string[]` (multiple). Signal or raw. */
	value?: Bindable<string | string[]>;
	/** Fired whenever the selection changes. */
	onValueChange?: ValueChange<string | string[]>;
	/** Allow selecting multiple options (`aria-multiselectable`). */
	multiple?: boolean;
	/** Render a checkbox on each row (only meaningful with `multiple`). */
	checkbox?: boolean;
	/** Render an inline search box above the list. */
	filter?: boolean;
	/** Placeholder for the inline filter box. */
	filterPlaceholder?: string;
	/** Render `OptionGroup` headers for grouped input (or by `Option.group` on flat input). */
	grouping?: boolean;
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

/** Check-mark glyph for the multiple/checkbox mode. */
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
 * Listbox — an always-open, inline `role="listbox"` (no dropdown). The container is the single tab
 * stop and owns `aria-activedescendant`; rows are `role="option"`. Supports single or `multiple`
 * selection (with optional row `checkbox`), inline `filter`, and grouped rendering. Keyboard:
 * Arrow/Home/End move the active row; Enter/Space toggles it.
 */
export function Listbox(props: ListboxProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		multiple = false,
		checkbox = false,
		filter = false,
		filterPlaceholder = "Search",
		grouping = false,
		id,
		disabled,
		status = "default",
		size = "md",
		fluid,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": ariaDescribedby,
	} = props;

	const fallback: string | string[] = multiple ? [] : "";
	const ctrl = useControllable<string | string[]>(value, fallback, onValueChange);
	const rootId = useId(id, "listbox");
	const listId = `${rootId}-list`;

	const [query, setQuery] = useState("");
	const listRef = useRef<HTMLUListElement>(null);

	const groups = useMemo(() => toRenderGroups(options, grouping, filter ? query : ""), [
		options,
		grouping,
		filter,
		query,
	]);
	const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

	const raw = ctrl.signal.value;
	const selectedSet = useMemo(() => new Set(Array.isArray(raw) ? raw : raw ? [raw] : []), [raw]);
	const isSelected = (v: string) => selectedSet.has(v);

	const nav = useListNavigation(() => flat.length, (i) => !!flat[i]?.disabled);

	// #region Selection
	const toggleAt = (index: number) => {
		const opt = flat[index];
		if (!opt || opt.disabled || disabled) return;
		if (multiple) {
			const set = new Set(Array.isArray(raw) ? raw : []);
			if (set.has(opt.value)) set.delete(opt.value);
			else set.add(opt.value);
			ctrl.set([...set]);
		} else {
			ctrl.set(opt.value);
		}
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
		if (disabled) return;
		if (nav.onKeyDown(e as unknown as KeyboardEvent)) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (nav.active.peek() >= 0) toggleAt(nav.active.peek());
		}
	};
	// #endregion

	const activeIdx = nav.active.value;
	const activeDescendant = activeIdx >= 0 ? `${rootId}-opt-${activeIdx}` : undefined;
	const showCheckbox = multiple && checkbox;

	// #region Row renderer
	const renderOption = (opt: Option, index: number) => {
		const checked = isSelected(opt.value);
		return (
			<li
				id={`${rootId}-opt-${index}`}
				key={opt.value}
				role="option"
				aria-selected={checked}
				aria-disabled={opt.disabled || undefined}
				class={cx(
					"ui-listbox__option",
					index === activeIdx && "ui-listbox__option--active",
					opt.disabled && "ui-listbox__option--disabled",
				)}
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => {
					nav.reset(index);
					toggleAt(index);
				}}
				onPointerMove={() => nav.reset(index)}
			>
				{showCheckbox
					? (
						<span
							class="ui-listbox__checkbox"
							role="checkbox"
							aria-checked={checked}
							aria-hidden="true"
						>
							{checked && <CheckGlyph />}
						</span>
					)
					: (
						<span class="ui-listbox__option-check" aria-hidden="true">
							{checked && <Icon name="check" />}
						</span>
					)}
				<span class="ui-listbox__option-label">{opt.label}</span>
			</li>
		);
	};
	// #endregion

	return (
		<div
			class={cx(
				"ui-listbox",
				size !== "md" && `ui-listbox--size-${size}`,
				fluid && "ui-listbox--fluid",
				disabled && "ui-listbox--disabled",
				className,
			)}
		>
			{filter && (
				<div class="ui-listbox__filter">
					<input
						type="text"
						class="ui-listbox__filter-input"
						placeholder={filterPlaceholder}
						value={query}
						aria-label={filterPlaceholder}
						aria-controls={listId}
						disabled={disabled}
						onInput={(e) => {
							setQuery(e.currentTarget.value);
							nav.reset(-1);
						}}
					/>
				</div>
			)}
			<ul
				ref={listRef}
				id={listId}
				role="listbox"
				class="ui-listbox__list"
				tabIndex={disabled ? -1 : 0}
				aria-multiselectable={multiple || undefined}
				aria-activedescendant={activeDescendant}
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedby}
				aria-disabled={disabled || undefined}
				aria-invalid={ariaInvalid(status)}
				onKeyDown={onKeyDown}
			>
				{flat.length === 0 && <li class="ui-listbox__empty" role="presentation">No results</li>}
				{groups.map((g, gi) => {
					const base = groups.slice(0, gi).reduce((n, gg) => n + gg.items.length, 0);
					return (
						<li key={g.label ?? gi} role="presentation">
							{grouping && g.label && (
								<div class="ui-listbox__group-label" role="presentation">{g.label}</div>
							)}
							<ul role="presentation" class="ui-listbox__group-items">
								{g.items.map((opt, oi) => renderOption(opt, base + oi))}
							</ul>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
