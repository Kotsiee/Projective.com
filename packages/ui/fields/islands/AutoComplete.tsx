import type { JSX, VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
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

export interface AutoCompleteProps extends BaseFieldProps {
	/** Bound value — `string` (single) or `Suggestion[]` (multiple). Raw or `Signal`. */
	value?: Bindable<AutoCompleteValue>;
	/** The filtered results the consumer supplies in response to {@link onComplete}. */
	suggestions?: Suggestion[];
	/** Fires (debounced by `delay`) as the user types so the consumer can update `suggestions`. */
	onComplete?: (query: string) => void;
	/** Fired whenever the committed value changes. */
	onValueChange?: ValueChange<AutoCompleteValue>;
	/** Placeholder for the text input. */
	placeholder?: string;
	/** Token/chip multi-selection mode. */
	multiple?: boolean;
	/** Show a trailing trigger button that opens the full list (fires `onComplete("")`). */
	dropdown?: boolean;
	/** Only accept a value matching a suggestion; clear the query on blur otherwise. */
	forceSelection?: boolean;
	/** Minimum query length before `onComplete` fires / the panel opens (default 1). */
	minLength?: number;
	/** Debounce for `onComplete`, ms (default 300). */
	delay?: number;
	/** Property name used as the display label on object suggestions (default `label`). */
	field?: string;
	/** Alias of {@link field} (PrimeNG `optionLabel`). */
	optionLabel?: string;
	/** Custom renderer for a suggestion row. */
	itemTemplate?: (opt: Option) => VNode;
	class?: string;
}
// #endregion

/**
 * AutoComplete — a text input with a floating suggestion listbox (PrimeNG parity). The consumer owns
 * filtering: {@link onComplete} fires as the user types and the consumer feeds back `suggestions`.
 * Supports single or `multiple` (chip tokens) selection, an optional `dropdown` trigger,
 * `forceSelection`, a `minLength` threshold and a debounced query. Implements the WAI-ARIA combobox
 * pattern (`role="combobox"` + active-descendant over a `role="listbox"` panel) with full keyboard
 * operation and outside/Escape dismissal.
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
		onComplete,
		onValueChange,
		placeholder,
		multiple,
		dropdown,
		forceSelection,
		minLength = 1,
		delay = 300,
		field,
		optionLabel,
		itemTemplate,
		id,
		name,
		disabled,
		readOnly,
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

	const controlRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const timer = useRef<number | undefined>(undefined);

	// #region Local UI state (signals)
	const open = useMemo(() => signal(false), []);
	const query = useMemo(() => signal(""), []);
	// #endregion

	// Live mirror of the suggestion list so the memoized list-nav handlers read fresh data.
	const suggRef = useRef<Suggestion[]>(suggestions);
	suggRef.current = suggestions;
	const nav = useListNavigation(
		() => suggRef.current.length,
		(i) => {
			const s = suggRef.current[i];
			return typeof s === "object" && !!s.disabled;
		},
	);

	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const float = useFloating({
		open: open.value,
		triggerRef: controlRef,
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

	// #region Label + key helpers
	const labelOf = (item: Suggestion): string => {
		if (typeof item === "string") return item;
		const raw = (item as unknown as Record<string, unknown>)[labelKey];
		return typeof raw === "string" ? raw : item.label;
	};
	const keyOf = (
		item: Suggestion,
	): string => (typeof item === "string" ? item : String(item.value));
	// #endregion

	// #region Open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		nav.reset(-1);
		open.value = true;
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
	const selectSuggestion = (
		item: Suggestion,
	) => (multiple ? commitToken(item) : commitSingle(item));
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
		if (q.length >= minLength) {
			openPanel();
			scheduleComplete(q);
		} else {
			close();
		}
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
		if (!forceSelection || multiple) return;
		const q = query.peek();
		const match = suggRef.current.some((s) => labelOf(s) === q);
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
			}
			return;
		}
		if (nav.onKeyDown(native)) return;
		if (e.key === "Enter") {
			const i = nav.active.peek();
			const item = suggRef.current[i];
			if (i >= 0 && item !== undefined) {
				e.preventDefault();
				selectSuggestion(item);
			}
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
	const activeIndex = nav.active.value;
	const activeId = activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;

	return (
		<div
			class={cx(
				"ui-autocomplete",
				multiple && "ui-autocomplete--multiple",
				fluid && "ui-autocomplete--fluid",
				className,
			)}
		>
			<div
				ref={controlRef}
				class={cx(
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
					class="ui-field__input ui-autocomplete__input"
					value={multiple
						? query.value
						: (typeof rawValue === "string" ? rawValue || query.value : query.value)}
					placeholder={tokens.length === 0 ? placeholder : undefined}
					disabled={disabled}
					readOnly={readOnly}
					required={required}
					autoComplete="off"
					aria-autocomplete="list"
					aria-expanded={open.value}
					aria-controls={listId}
					aria-haspopup="listbox"
					aria-activedescendant={activeId}
					aria-invalid={ariaInvalid(status)}
					aria-required={required || undefined}
					onInput={onInput}
					onKeyDown={onKeyDown}
					onBlur={onBlur}
					{...aria}
				/>
				{dropdown && (
					<button
						type="button"
						class="ui-autocomplete__trigger"
						aria-label="Show suggestions"
						aria-expanded={open.value}
						aria-controls={listId}
						tabIndex={-1}
						disabled={disabled}
						onClick={onDropdownClick}
					>
						<span class="ui-autocomplete__chevron" aria-hidden="true" />
					</button>
				)}
			</div>

			{open.value && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={listId}
						role="listbox"
						class="ui-autocomplete__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--ac-top": float ? `${float.top}px` : undefined,
							"--ac-left": float ? `${float.left}px` : undefined,
							"--ac-width": float ? `${float.width}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{suggestions.length === 0
							? <div class="ui-autocomplete__empty" role="presentation">No results</div>
							: suggestions.map((s, i) => {
								const opt: Option = typeof s === "string" ? { label: s, value: s } : s;
								return (
									<div
										key={keyOf(s)}
										id={`${listId}-opt-${i}`}
										role="option"
										aria-selected={i === activeIndex}
										aria-disabled={opt.disabled || undefined}
										class={cx(
											"ui-autocomplete__option",
											i === activeIndex && "ui-autocomplete__option--active",
											opt.disabled && "ui-autocomplete__option--disabled",
										)}
										onPointerDown={(e) => {
											e.preventDefault();
											if (!opt.disabled) selectSuggestion(s);
										}}
										onPointerEnter={() => nav.reset(i)}
									>
										{itemTemplate ? itemTemplate(opt) : labelOf(s)}
									</div>
								);
							})}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
