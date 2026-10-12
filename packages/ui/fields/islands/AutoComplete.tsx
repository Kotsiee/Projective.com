import type { JSX, RefObject, VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/autocomplete.css";
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
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Types
/** A single suggestion — either a bare string or a rich {@link Option}. */
export type Suggestion = string | Option;

/**
 * Bound value shape: a `string` in single mode, or an array of strings / {@link Option}s in
 * `multiple` mode (one entry per selected token).
 */
export type AutoCompleteValue = string | Suggestion[];

/** A titled block of suggestions, rendered as a labelled `role="group"` inside the listbox. */
export interface AutoCompleteSection {
	/** Stable key; also seeds the group label's id. */
	id: string;
	label: string;
	items: Suggestion[];
	/**
	 * Rows here can be forgotten: Delete on the active row, or the row's remove control. A predicate
	 * narrows it to some rows (an action row in the same group stays permanent).
	 */
	removable?: boolean | ((item: Option) => boolean);
}

export interface AutoCompleteProps extends BaseFieldProps {
	/** Bound value — `string` (single) or `Suggestion[]` (multiple). Raw or `Signal`. */
	value?: Bindable<AutoCompleteValue>;
	/** The filtered results the consumer supplies in response to {@link onComplete}. */
	suggestions?: Suggestion[];
	/** Grouped results; takes precedence over {@link suggestions}. Arrow keys run across groups. */
	sections?: AutoCompleteSection[];
	/** Fires (debounced by `delay`) as the user types so the consumer can update `suggestions`. */
	onComplete?: (query: string) => void;
	/** Fired whenever the committed value changes. */
	onValueChange?: ValueChange<AutoCompleteValue>;
	/**
	 * Replaces the default commit: choosing a row calls this and leaves the value alone, so a search
	 * box can navigate or re-query instead of writing the row into the field. Return `true` to keep
	 * the panel open (an in-panel action such as Retry).
	 */
	onSelect?: (item: Option) => boolean | void;
	/** Forget a row from a `removable` section. */
	onRemove?: (item: Option) => void;
	/** Accessible name of a row's remove control (default `Remove {label}`). */
	removeLabel?: (item: Option) => string;
	/** Placeholder for the text input. */
	placeholder?: string;
	/** Token/chip multi-selection mode. */
	multiple?: boolean;
	/** Show a trailing trigger button that opens the full list (fires `onComplete("")`). */
	dropdown?: boolean;
	/** Only accept a value matching a suggestion; clear the query on blur otherwise. */
	forceSelection?: boolean;
	/**
	 * The bound `value` is the text itself (single mode): typing writes it, the input always shows it,
	 * and Escape on a closed panel clears it.
	 */
	freeText?: boolean;
	/** Open the panel on focus, before anything is typed. */
	openOnFocus?: boolean;
	/** Fired each time the panel opens. */
	onOpen?: () => void;
	/** Minimum query length before `onComplete` fires / the panel opens (default 1). */
	minLength?: number;
	/** Debounce for `onComplete`, ms (default 300). */
	delay?: number;
	/** Placeholder rows drawn while `loading` with nothing to show yet (default 3). */
	skeletonRows?: number;
	/** Text for an open panel with no rows (default "No results"); `null` keeps the panel shut. */
	emptyMessage?: string | null;
	/** Property name used as the display label on object suggestions (default `label`). */
	field?: string;
	/** Alias of {@link field} (PrimeNG `optionLabel`). */
	optionLabel?: string;
	/** Custom renderer for a suggestion row. */
	itemTemplate?: (opt: Option) => VNode;
	/**
	 * Drop the field chrome: the wrapper and control render as `display: contents`, so the input sits
	 * directly in a host's own search pill. Pair with {@link inputClass} and {@link anchorRef}.
	 */
	bare?: boolean;
	/** Class for the `<input>` itself (the host's field class in `bare` mode). */
	inputClass?: string;
	/** The element the panel aligns to and matches the width of (default: the control). */
	anchorRef?: RefObject<HTMLElement>;
	class?: string;
}
// #endregion

/** One rendered row: the suggestion, its normalised option, and the section it came from. */
interface Row {
	item: Suggestion;
	opt: Option;
	section: AutoCompleteSection | null;
}

/**
 * AutoComplete — a text input with a floating suggestion listbox (PrimeNG parity). The consumer owns
 * filtering: {@link onComplete} fires as the user types and the consumer feeds back `suggestions` or
 * grouped `sections`. Supports single, `freeText` or `multiple` (chip tokens) modes, an optional
 * `dropdown` trigger, `forceSelection`, a `minLength` threshold, a debounced query, skeleton rows
 * while `loading`, and removable rows. Implements the WAI-ARIA combobox pattern (`role="combobox"` +
 * active-descendant over a `role="listbox"` panel of `role="group"` sections): Up/Down move the
 * active row, Alt+Down opens and Alt+Up closes, Home/End stay with the caret, Enter chooses (or, with
 * no active row, closes and lets the form submit), Delete forgets a removable row, Escape closes,
 * and a polite status line announces loading and the row count.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) — the trap a Dialog panel
 * sets. The control stays in place and the id-based ARIA wiring survives the move.
 */
export function AutoComplete(props: AutoCompleteProps): JSX.Element {
	const {
		value,
		suggestions = [],
		sections,
		onComplete,
		onValueChange,
		onSelect,
		onRemove,
		removeLabel = (opt: Option) => `Remove ${opt.label}`,
		placeholder,
		multiple,
		dropdown,
		forceSelection,
		freeText,
		openOnFocus,
		onOpen,
		minLength = 1,
		delay = 300,
		skeletonRows = 3,
		emptyMessage = "No results",
		field,
		optionLabel,
		itemTemplate,
		bare,
		inputClass,
		anchorRef,
		id,
		name,
		disabled,
		readOnly,
		loading,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		...aria
	} = props;

	const labelKey = field ?? optionLabel ?? "label";
	const ctrl = useControllable<AutoCompleteValue>(
		value,
		(multiple ? [] : "") as AutoCompleteValue,
		onValueChange,
	);

	const inputId = useId(id, "autocomplete");
	const listId = `${inputId}-list`;
	const hintId = `${inputId}-remove-hint`;

	const controlRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const timer = useRef<number | undefined>(undefined);

	// #region Local UI state (signals)
	const open = useMemo(() => signal(false), []);
	const query = useMemo(() => signal(""), []);
	// #endregion

	// #region Label + key helpers
	const labelOf = (item: Suggestion): string => {
		if (typeof item === "string") return item;
		const raw = (item as unknown as Record<string, unknown>)[labelKey];
		return typeof raw === "string" ? raw : item.label;
	};
	const keyOf = (
		item: Suggestion,
	): string => (typeof item === "string" ? item : String(item.value));
	const toOption = (item: Suggestion): Option =>
		typeof item === "string" ? { label: item, value: item } : item;
	// #endregion

	const rows: Row[] = sections
		? sections.flatMap((s) => s.items.map((item) => ({ item, opt: toOption(item), section: s })))
		: suggestions.map((item) => ({ item, opt: toOption(item), section: null }));
	const rowsKey = rows.map((r) => keyOf(r.item)).join("\u0000");

	// Live mirror of the rows so the memoized list-nav handlers read fresh data.
	const rowsRef = useRef<Row[]>(rows);
	rowsRef.current = rows;
	const nav = useListNavigation(
		() => rowsRef.current.length,
		(i) => !!rowsRef.current[i]?.opt.disabled,
	);

	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const float = useFloating({
		open: open.value,
		triggerRef: anchorRef ?? controlRef,
		panelRef,
		placement: "bottom-start",
	});
	// `enabled` gates the ESCAPE channel only, and that channel is exclusive (its handler calls
	// `stopImmediatePropagation`). Every listener registers on `document` in the capture phase, so
	// they run in registration order, not stacking order — without this an open suggestion list under
	// a later overlay eats that overlay's Escape. Outside-pointer dismissal is governed by containment
	// and stays live regardless.
	useDismiss({
		open: open.value,
		enabled: stack.isTop,
		onDismiss: () => close(),
		panelRef,
		triggerRef: controlRef,
	});

	// A new row set invalidates the active index: it would point at a different row, or past the end.
	useEffect(() => nav.reset(-1), [rowsKey]);

	const activeIndex = nav.active.value;
	const activeId = activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;

	useEffect(() => {
		if (!activeId) return;
		panelRef.current?.querySelector(`[id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeId]);

	// #region Open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		const was = open.peek();
		nav.reset(-1);
		open.value = true;
		if (!was) onOpen?.();
	};
	const close = () => {
		open.value = false;
		nav.reset(-1);
	};
	// #endregion

	// #region Selection
	const commitSingle = (item: Suggestion) => {
		ctrl.set(typeof item === "string" ? item : String(item.value));
		query.value = labelOf(item);
		close();
		inputRef.current?.focus();
	};
	const commitToken = (item: Suggestion) => {
		const cur = ctrl.get();
		const arr = Array.isArray(cur) ? cur.slice() : [];
		if (arr.some((t) => keyOf(t) === keyOf(item))) return;
		ctrl.set([...arr, item]);
		query.value = "";
		if (inputRef.current) inputRef.current.value = "";
		onComplete?.("");
	};
	const selectSuggestion = (item: Suggestion) => {
		if (onSelect) {
			if (onSelect(toOption(item)) !== true) close();
			return;
		}
		if (multiple) commitToken(item);
		else commitSingle(item);
	};
	const canRemoveRow = (row: Row | undefined): row is Row => {
		const rule = row?.section?.removable;
		return !!onRemove && !!row && (typeof rule === "function" ? rule(row.opt) : !!rule);
	};
	const removeRow = (row: Row) => {
		if (!onRemove || !canRemoveRow(row)) return;
		onRemove(row.opt);
		inputRef.current?.focus();
	};
	const removeToken = (index: number) => {
		const cur = ctrl.get();
		if (!Array.isArray(cur)) return;
		ctrl.set(cur.filter((_, i) => i !== index));
		inputRef.current?.focus();
	};
	// #endregion

	// #region Query input
	const scheduleComplete = (q: string) => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		timer.current = setTimeout(() => onComplete?.(q), delay) as unknown as number;
	};
	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const q = e.currentTarget.value;
		query.value = q;
		if (freeText && !multiple) ctrl.set(q);
		if (q.length >= minLength) {
			openPanel();
			scheduleComplete(q);
		} else if (openOnFocus) {
			scheduleComplete(q);
		} else {
			close();
		}
	};
	const onFocus = () => {
		if (openOnFocus) openPanel();
	};
	const onDropdownClick = () => {
		if (open.value) {
			close();
			return;
		}
		openPanel();
		onComplete?.(query.peek());
		inputRef.current?.focus();
	};
	const onBlur = () => {
		if (!forceSelection || multiple || freeText) return;
		const q = query.peek();
		const match = rowsRef.current.some((r) => labelOf(r.item) === q);
		if (!match) {
			query.value = "";
			ctrl.set("");
		}
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		const native = e as unknown as KeyboardEvent;
		if (e.key === "Backspace" && multiple && query.peek() === "") {
			const cur = ctrl.get();
			if (Array.isArray(cur) && cur.length > 0) removeToken(cur.length - 1);
			return;
		}
		if (!open.value) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				openPanel();
			} else if (e.key === "Escape" && freeText && !multiple && e.currentTarget.value) {
				e.preventDefault();
				query.value = "";
				ctrl.set("");
				onComplete?.("");
			}
			return;
		}
		if (e.altKey && e.key === "ArrowUp") {
			e.preventDefault();
			close();
			return;
		}
		if (e.altKey && e.key === "ArrowDown") {
			e.preventDefault();
			return;
		}
		if ((e.key === "ArrowDown" || e.key === "ArrowUp") && nav.onKeyDown(native)) return;
		if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(e.key)) {
			nav.reset(-1);
			return;
		}
		const row = rowsRef.current[nav.active.peek()];
		if (e.key === "Enter") {
			if (row) {
				e.preventDefault();
				if (!row.opt.disabled) selectSuggestion(row.item);
			} else {
				close();
			}
		} else if (e.key === "Delete" && canRemoveRow(row)) {
			e.preventDefault();
			removeRow(row);
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		} else if (e.key === "Tab") {
			close();
		}
	};
	// #endregion

	const rawValue = ctrl.signal.value;
	const tokens: Suggestion[] = multiple && Array.isArray(rawValue) ? rawValue : [];
	const shown = multiple
		? query.value
		: freeText
		? (typeof rawValue === "string" ? rawValue : "")
		: (typeof rawValue === "string" ? rawValue || query.value : query.value);

	const busy = !!loading && rows.length === 0;
	const empty = !loading && rows.length === 0;
	const panelVisible = open.value && !(empty && emptyMessage === null);
	const removable = rows.some(canRemoveRow);
	const announcement = !panelVisible
		? ""
		: busy
		? "Loading suggestions"
		: empty
		? emptyMessage ?? ""
		: `${rows.length} ${rows.length === 1 ? "suggestion" : "suggestions"} available`;

	const renderRow = (row: Row, i: number) => {
		const { item, opt } = row;
		const canRemove = canRemoveRow(row);
		return (
			<div
				key={keyOf(item)}
				id={`${listId}-opt-${i}`}
				role="option"
				aria-selected={i === activeIndex}
				aria-disabled={opt.disabled || undefined}
				aria-describedby={canRemove ? hintId : undefined}
				class={cx(
					"ui-autocomplete__option",
					i === activeIndex && "ui-autocomplete__option--active",
					opt.disabled && "ui-autocomplete__option--disabled",
				)}
				onPointerDown={(e) => {
					e.preventDefault();
					if (!opt.disabled) selectSuggestion(item);
				}}
				onPointerEnter={() => nav.reset(i)}
			>
				<span class="ui-autocomplete__option-body">
					{itemTemplate ? itemTemplate(opt) : labelOf(item)}
				</span>
				{canRemove && (
					<button
						type="button"
						class="ui-autocomplete__remove"
						tabIndex={-1}
						aria-hidden="true"
						title={removeLabel(opt)}
						onPointerDown={(e) => {
							e.preventDefault();
							e.stopPropagation();
							removeRow(row);
						}}
					>
						<Icon name="close" size="2xs" />
					</button>
				)}
			</div>
		);
	};

	const renderRows = () => {
		if (!sections) return rows.map(renderRow);
		let offset = 0;
		return sections.filter((s) => s.items.length > 0).map((s) => {
			const start = rows.findIndex((r) => r.section === s, offset);
			offset = start + s.items.length;
			const labelId = `${listId}-grp-${s.id}`;
			return (
				<div key={s.id} role="group" aria-labelledby={labelId} class="ui-autocomplete__group">
					<div id={labelId} class="ui-autocomplete__group-label" aria-hidden="true">
						{s.label}
					</div>
					{s.items.map((_, j) => renderRow(rows[start + j], start + j))}
				</div>
			);
		});
	};

	return (
		<div
			class={cx(
				"ui-autocomplete",
				multiple && "ui-autocomplete--multiple",
				fluid && "ui-autocomplete--fluid",
				bare && "ui-autocomplete--bare",
				className,
			)}
		>
			<div
				ref={controlRef}
				class={bare ? "ui-autocomplete__control ui-autocomplete__control--bare" : cx(
					"ui-field",
					"ui-autocomplete__control",
					...fieldModifiers("ui-field", {
						size,
						status,
						fluid,
						disabled,
						readOnly,
						open: open.value,
					}),
				)}
			>
				{multiple && tokens.map((t, i) => (
					<span key={keyOf(t)} class="ui-autocomplete__token">
						<span class="ui-autocomplete__token-label">{labelOf(t)}</span>
						<button
							type="button"
							class="ui-autocomplete__token-remove"
							aria-label={`Remove ${labelOf(t)}`}
							disabled={disabled}
							onClick={() => removeToken(i)}
						>
							<Icon name="close" />
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					id={inputId}
					name={name}
					type="text"
					role="combobox"
					class={cx(!bare && "ui-field__input", "ui-autocomplete__input", inputClass)}
					value={shown}
					placeholder={tokens.length === 0 ? placeholder : undefined}
					disabled={disabled}
					readOnly={readOnly}
					required={required}
					autoComplete="off"
					aria-autocomplete="list"
					aria-expanded={panelVisible}
					aria-controls={listId}
					aria-haspopup="listbox"
					aria-activedescendant={panelVisible ? activeId : undefined}
					aria-busy={loading || undefined}
					aria-invalid={ariaInvalid(status)}
					aria-required={required || undefined}
					onInput={onInput}
					onFocus={onFocus}
					onClick={onFocus}
					onKeyDown={onKeyDown}
					onBlur={onBlur}
					{...aria}
				/>
				{dropdown && (
					<button
						type="button"
						class="ui-autocomplete__trigger"
						aria-label="Show suggestions"
						aria-expanded={panelVisible}
						aria-controls={listId}
						tabIndex={-1}
						disabled={disabled}
						onClick={onDropdownClick}
					>
						<span class="ui-autocomplete__chevron" aria-hidden="true" />
					</button>
				)}
				<span class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
					{announcement}
				</span>
				{removable && <span id={hintId} class="ui-visually-hidden">Press Delete to remove</span>}
			</div>

			{panelVisible && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={listId}
						role="listbox"
						aria-busy={loading || undefined}
						aria-label={aria["aria-label"]}
						class="ui-autocomplete__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--ac-top": float ? `${float.top}px` : undefined,
							"--ac-left": float ? `${float.left}px` : undefined,
							"--ac-width": float ? `${float.width}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{empty
							? <div class="ui-autocomplete__empty" role="presentation">{emptyMessage}</div>
							: renderRows()}
						{loading &&
							Array.from(
								{ length: skeletonRows },
								(_, i) => (
									<div key={`sk-${i}`} class="ui-autocomplete__skeleton" aria-hidden="true">
										<span class="ui-autocomplete__skeleton-mark" />
										<span class="ui-autocomplete__skeleton-line" />
									</div>
								),
							)}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
