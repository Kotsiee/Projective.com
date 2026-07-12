import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/chips.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

export interface ChipsProps extends BaseFieldProps {
	/** Bound list of chip strings — raw `string[]` or `Signal<string[]>`. */
	value?: Bindable<string[]>;
	/** Fired whenever the chip list changes. */
	onValueChange?: ValueChange<string[]>;
	/** Placeholder shown in the inline input when empty. */
	placeholder?: string;
	/** Extra key that commits the pending chip (default `Enter`; `Enter` and `,` always commit). */
	separator?: string;
	/** Maximum number of chips. */
	max?: number;
	/** Allow duplicate chip values (default false). */
	allowDuplicate?: boolean;
	/** Commit the pending text as a chip when the input loses focus. */
	addOnBlur?: boolean;
	class?: string;
}

/**
 * Chips — free-form tag entry. Renders the committed chips as removable tokens followed by an inline
 * text input; `Enter` or the configured `separator` (and `,`) commits the pending text, and
 * `Backspace` on an empty input removes the last chip. Enforces `max` and optional de-duplication,
 * exposes each token's remove control with an `aria-label`, and announces additions/removals through
 * a polite `aria-live` region.
 */
export function Chips(props: ChipsProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		separator = "Enter",
		max,
		allowDuplicate,
		addOnBlur,
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

	const ctrl = useControllable<string[]>(value, [], onValueChange);
	const inputId = useId(id, "chips");
	const inputRef = useRef<HTMLInputElement>(null);

	const query = useMemo(() => signal(""), []);
	const announcement = useMemo(() => signal(""), []);

	// #region Mutations
	const isFull = () => max !== undefined && ctrl.get().length >= max;

	const commit = (raw: string) => {
		const val = raw.trim();
		if (val === "" || isFull()) return;
		const cur = ctrl.get();
		if (!allowDuplicate && cur.includes(val)) {
			announcement.value = `${val} is already added`;
			return;
		}
		ctrl.set([...cur, val]);
		announcement.value = `${val} added`;
		query.value = "";
		if (inputRef.current) inputRef.current.value = "";
	};

	const removeAt = (index: number) => {
		const cur = ctrl.get();
		const removed = cur[index];
		ctrl.set(cur.filter((_, i) => i !== index));
		if (removed !== undefined) announcement.value = `${removed} removed`;
		inputRef.current?.focus();
	};
	// #endregion

	// #region Keyboard / input
	const isCommitKey = (key: string) => key === "Enter" || key === "," || key === separator;

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (isCommitKey(e.key)) {
			e.preventDefault();
			commit(query.peek());
			return;
		}
		if (e.key === "Backspace" && query.peek() === "") {
			const cur = ctrl.get();
			if (cur.length > 0) {
				e.preventDefault();
				removeAt(cur.length - 1);
			}
		}
	};
	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		query.value = e.currentTarget.value;
	};
	const onBlur = () => {
		if (addOnBlur) commit(query.peek());
	};
	// #endregion

	const chips = ctrl.signal.value;

	return (
		<div
			role="group"
			aria-label={aria["aria-label"]}
			aria-describedby={aria["aria-describedby"]}
			class={cx(
				"ui-field",
				"ui-chips",
				...fieldModifiers("ui-field", { size, status, fluid, disabled, readOnly }),
				className,
			)}
			onClick={() => inputRef.current?.focus()}
		>
			{chips.map((chip, i) => (
				<span key={`${chip}-${i}`} class="ui-chips__token">
					<span class="ui-chips__token-label">{chip}</span>
					<button
						type="button"
						class="ui-chips__token-remove"
						aria-label={`Remove ${chip}`}
						disabled={disabled}
						onClick={(e) => {
							e.stopPropagation();
							removeAt(i);
						}}
					>
						<span aria-hidden="true">×</span>
					</button>
				</span>
			))}
			<input
				ref={inputRef}
				id={inputId}
				name={name}
				type="text"
				class="ui-field__input ui-chips__input"
				value={query.value}
				placeholder={chips.length === 0 ? placeholder : undefined}
				disabled={disabled}
				readOnly={readOnly}
				required={required && chips.length === 0}
				autoComplete="off"
				aria-invalid={ariaInvalid(status)}
				onInput={onInput}
				onKeyDown={onKeyDown}
				onBlur={onBlur}
			/>
			<span class="ui-chips__sr" aria-live="polite" aria-atomic="true">{announcement.value}</span>
		</div>
	);
}
