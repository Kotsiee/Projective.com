import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/field.css";
import "../styles/tag-combobox.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import {
	initialTagCombo,
	reduceTagCombo,
	type TagComboAction,
	type TagComboState,
	tagCount,
} from "../core/tag-combobox.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

/** Props for {@link TagCombobox}. */
export interface TagComboboxProps extends BaseFieldProps {
	/** The committed tags — raw (uncontrolled) or a `Signal<string[]>` (controlled). */
	value?: Bindable<string[]>;
	/** Fired with the whole new tag list on every add or remove. */
	onValueChange?: ValueChange<string[]>;
	/** Suggestions for a query (e.g. `/api/search/suggest-tags`). A rejection shows no suggestions. */
	suggest: (query: string) => Promise<string[]>;
	/** The most tags (default 10). */
	max?: number;
	/** The longest tag (default 40). */
	maxLength?: number;
	placeholder?: string;
	/** Debounce before `suggest` runs, ms (default 200). */
	delay?: number;
	class?: string;
}

/**
 * TagCombobox — an ARIA 1.2 combobox that commits free text or a suggestion as a tag.
 *
 * The input is `role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant`
 * over a body-portalled `role="listbox"` of suggestions from the injected `suggest`. Enter or comma
 * commits, Backspace on an empty query removes the last tag, ↑/↓ move the active suggestion, Escape
 * closes then clears. Committed tags are removable controls; the "7 of 10" count is inline meta text,
 * not a chip. Additions, removals and refusals are announced politely. Keys are a pure reducer
 * (`core/tag-combobox.ts`).
 */
export function TagCombobox(props: TagComboboxProps): JSX.Element {
	const {
		value,
		onValueChange,
		suggest,
		max = 10,
		maxLength = 40,
		placeholder,
		delay = 200,
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
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<string[]>(value, [], onValueChange);
	const inputId = useId(id, "tagbox");
	const listId = `${inputId}-list`;
	const countId = `${inputId}-count`;
	const state = useMemo(
		() => signal<TagComboState>(initialTagCombo(ctrl.get(), max, maxLength)),
		[],
	);
	const controlRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const seq = useRef(0);

	const s: TagComboState = { ...state.value, tags: ctrl.signal.value };

	const dispatch = (action: TagComboAction): boolean => {
		const before = { ...state.peek(), tags: ctrl.get() };
		const { state: next, handled } = reduceTagCombo({ ...before, max, maxLength }, action);
		state.value = next;
		if (next.tags !== before.tags) ctrl.set(next.tags);
		if (next.query !== before.query) schedule(next.query);
		return handled;
	};

	const schedule = (q: string) => {
		if (timer.current !== undefined) clearTimeout(timer.current);
		const ticket = ++seq.current;
		if (q.trim() === "") {
			dispatch({ type: "options", options: [] });
			return;
		}
		timer.current = setTimeout(() => {
			suggest(q.trim()).then(
				(options) => {
					if (ticket === seq.current) dispatch({ type: "options", options });
				},
				() => {
					if (ticket !== seq.current) return;
					dispatch({ type: "options", options: [] });
					state.value = { ...state.peek(), notice: "Suggestions aren't available right now." };
				},
			);
		}, delay) as unknown as number;
	};

	useEffect(() => () => {
		if (timer.current !== undefined) clearTimeout(timer.current);
	}, []);

	const open = s.open && s.options.length > 0 && !disabled && !readOnly;
	const stack = useOverlayStack({ active: open, layer: "popover" });
	const float = useFloating({ open, triggerRef: controlRef, panelRef, placement: "bottom-start" });
	useDismiss({
		open,
		enabled: stack.isTop,
		onDismiss: () => dispatch({ type: "close" }),
		panelRef,
		triggerRef: controlRef,
	});

	const activeId = open && s.active >= 0 ? `${listId}-opt-${s.active}` : undefined;

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (disabled || readOnly) return;
		if (dispatch({ type: "key", key: e.key })) e.preventDefault();
	};

	return (
		<div class={cx("ui-tagbox", fluid && "ui-tagbox--fluid", className)}>
			<div
				ref={controlRef}
				class={cx(
					"ui-field",
					"ui-tagbox__control",
					...fieldModifiers("ui-field", { size, status, fluid, disabled, readOnly, open }),
				)}
				onClick={() => inputRef.current?.focus()}
			>
				<ul class="ui-tagbox__tags" aria-label="Tags">
					{s.tags.map((tag, i) => (
						<li key={tag} class="ui-tagbox__token">
							<span class="ui-tagbox__token-label">{tag}</span>
							<button
								type="button"
								class="ui-tagbox__token-remove"
								aria-label={`Remove ${tag}`}
								disabled={disabled || readOnly}
								onClick={(e) => {
									e.stopPropagation();
									dispatch({ type: "remove", index: i });
									inputRef.current?.focus();
								}}
							>
								<Icon name="close" />
							</button>
						</li>
					))}
				</ul>
				<input
					ref={inputRef}
					id={inputId}
					name={name}
					type="text"
					role="combobox"
					class="ui-field__input ui-tagbox__input"
					value={s.query}
					placeholder={s.tags.length === 0 ? placeholder : undefined}
					disabled={disabled}
					readOnly={readOnly}
					required={required && s.tags.length === 0}
					autoComplete="off"
					maxLength={maxLength + 1}
					aria-label={ariaLabel}
					aria-describedby={cx(countId, describedBy) || undefined}
					aria-autocomplete="list"
					aria-expanded={open}
					aria-controls={listId}
					aria-haspopup="listbox"
					aria-activedescendant={activeId}
					aria-invalid={ariaInvalid(status)}
					aria-required={required || undefined}
					onInput={(e) => dispatch({ type: "input", value: e.currentTarget.value })}
					onKeyDown={onKeyDown}
				/>
			</div>
			<span id={countId} class="ui-tagbox__count">{tagCount(s)}</span>
			<span class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				{s.notice}
			</span>
			{open && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={listId}
						role="listbox"
						aria-label="Suggested tags"
						class="ui-tagbox__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--tagbox-top": float ? `${float.top}px` : undefined,
							"--tagbox-left": float ? `${float.left}px` : undefined,
							"--tagbox-width": float ? `${float.width}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{s.options.map((option, i) => (
							<div
								key={option}
								id={`${listId}-opt-${i}`}
								role="option"
								aria-selected={i === s.active}
								class={cx("ui-tagbox__option", i === s.active && "ui-tagbox__option--active")}
								onPointerDown={(e) => {
									e.preventDefault();
									dispatch({ type: "pick", index: i });
								}}
							>
								{option}
							</div>
						))}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
