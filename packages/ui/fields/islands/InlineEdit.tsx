import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import "../styles/field.css";
import "../styles/inline-edit.css";
import { cx } from "../../core/cx.ts";
import { useId } from "../hooks/useId.ts";
import { Icon } from "../../icons/mod.ts";

// #region Types
/** What {@link InlineEditProps.renderField} draws with. */
export interface InlineEditField {
	/** The working value, seeded from `value` as the edit starts. Nothing is saved until {@link commit}. */
	draft: Signal<string>;
	/** Finish: fire `onCommit` if the value changed, and return to rest. */
	commit: () => void;
}

/** Props for {@link InlineEdit}. */
export interface InlineEditProps {
	/** The committed value. The control is fully controlled — commit writes through `onCommit`. */
	value: string;
	/** Called with the trimmed next value when the edit is committed. Not called when unchanged. */
	onCommit: (next: string) => void;
	/**
	 * `false` renders the value as static text with no edit affordance at all. A permission the
	 * viewer does not hold should be invisible, not disabled — a greyed-out control still tells them
	 * a thing exists and then refuses it.
	 */
	editable?: boolean;
	/** `line` commits on Enter; `block` keeps Enter for newlines and commits on blur or ⌘/Ctrl+Enter. */
	as?: "line" | "block";
	/** Shown when the value is empty. Doubles as the placeholder once editing starts. */
	placeholder?: string;
	/** Tag used for the resting display element, so the value keeps its semantics (`h2`, `p`, …). */
	displayAs?: keyof JSX.IntrinsicElements;
	maxLength?: number;
	/** Accessible name for the edit affordance ("Edit ticket title"). */
	label: string;
	/**
	 * Rich resting content in place of the plain `value`: sanitized HTML, a formatted instant. It is
	 * drawn BESIDE a stretched edit button rather than inside one, because a button's name replaces
	 * its content for assistive tech, so an agenda inside one could not be read at all.
	 */
	display?: ComponentChildren;
	/**
	 * Draw the active control yourself, for a value a text input would damage: rich text, an instant.
	 * The field works on `draft` and calls `commit` when it is finished; Escape still cancels here. It
	 * takes on this primitive's one duty: the words must not move when the mode does.
	 */
	renderField?: (field: InlineEditField) => ComponentChildren;
	class?: string;
}
// #endregion

/**
 * InlineEdit — text that becomes its own input where it sits.
 *
 * A title and a description belong to the reading layout, not to a form: routing an owner through a
 * separate edit mode to change four words costs a mode switch, a re-render and a lost reading
 * position. Clicking the text swaps in a field at the SAME metrics — identical font, size, weight
 * and box — so the words do not move when the mode does. That equality is the whole trick, and it
 * is why this is a primitive rather than a per-surface pattern: any drift in padding or line-height
 * shows up as a jump at the exact moment the user is reading.
 *
 * Commit rules follow the shape of the content: a single line commits on Enter and cancels on
 * Escape; a block keeps Enter for paragraphs and commits on blur or ⌘/Ctrl+Enter. Escape always
 * cancels and restores. The control is idle-first — it renders no chrome until hovered or focused,
 * so a page full of editable text does not read as a page full of inputs.
 *
 * Leaving the edit puts focus back on the resting control when the field took it away with it, so a
 * keyboard reader stays where they were rather than landing on the document.
 */
export function InlineEdit(props: InlineEditProps): JSX.Element {
	const {
		value,
		onCommit,
		editable = true,
		as = "line",
		placeholder = "",
		displayAs,
		maxLength,
		label,
		display,
		renderField,
		class: className,
	} = props;

	const editing = useSignal(false);
	const draft = useSignal(value);
	const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
	const restRef = useRef<HTMLButtonElement>(null);
	const wasEditing = useRef(false);
	const fieldId = useId(undefined, "inline-edit");

	// Focus and select on entry; a caret parked at index 0 makes the field feel like a different
	// element than the text it replaced.
	useEffect(() => {
		if (!editing.value) return;
		const el = ref.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		if (as === "block") el.scrollTop = el.scrollHeight;
	}, [editing.value]);

	// The field that held focus is gone. A press elsewhere has already put focus where it belongs,
	// so only a focus that fell to the document is brought back.
	useEffect(() => {
		const left = wasEditing.current && !editing.value;
		wasEditing.current = editing.value;
		if (left && document.activeElement === document.body) restRef.current?.focus();
	}, [editing.value]);

	/*
	 * Escape must cancel the EDIT, not the dialog the edit sits in.
	 *
	 * `useDismiss` binds Escape on `document` in the capture phase specifically so an inner handler
	 * cannot swallow it — which is right for a dropdown and wrong for a transient text edit, where
	 * the user is unambiguously addressing the field. Bubbling loses that race by construction and
	 * `stopPropagation` on the field's own handler is already too late.
	 *
	 * `window` precedes `document` in the capture path, so a capture listener here runs strictly
	 * first and `stopImmediatePropagation` keeps the dialog from ever seeing the key. Registered
	 * only while editing, so the overlay's own Escape works normally the rest of the time.
	 */
	useEffect(() => {
		if (!editing.value || typeof globalThis.addEventListener !== "function") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopImmediatePropagation();
			e.preventDefault();
			draft.value = value;
			editing.value = false;
		};
		globalThis.addEventListener("keydown", onKey, true);
		return () => globalThis.removeEventListener("keydown", onKey, true);
	}, [editing.value, value]);

	const Display =
		(displayAs ?? (display !== undefined ? "div" : as === "line" ? "span" : "p")) as "span";

	if (!editable) {
		return (
			<Display class={cx("ui-inline-edit__value", className)}>
				{display ?? (value || <span class="ui-inline-edit__empty">{placeholder}</span>)}
			</Display>
		);
	}

	const start = () => {
		draft.value = value;
		editing.value = true;
	};
	const commit = () => {
		editing.value = false;
		const next = draft.value.trim();
		if (next !== value.trim()) onCommit(next);
	};

	if (editing.value && renderField) return <>{renderField({ draft, commit })}</>;

	if (editing.value) {
		const shared = {
			id: fieldId,
			ref: ref as never,
			class: cx("ui-inline-edit__input", className),
			value: draft.value,
			placeholder,
			maxLength,
			"aria-label": label,
			onInput: (e: Event) => {
				draft.value = (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
			},
			onBlur: commit,
			// Escape is handled by the window-capture listener above, which has to win the race
			// against the enclosing overlay's own capture handler.
			onKeyDown: (e: KeyboardEvent) => {
				const submit = as === "line"
					? e.key === "Enter"
					: e.key === "Enter" && (e.metaKey || e.ctrlKey);
				if (submit) {
					e.preventDefault();
					commit();
				}
			},
		};
		return as === "line" ? <input type="text" {...shared} /> : (
			<textarea
				{...shared}
				rows={4}
				onInput={(e: Event) => {
					const el = e.currentTarget as HTMLTextAreaElement;
					draft.value = el.value;
					el.style.height = "auto";
					el.style.height = `${el.scrollHeight}px`;
				}}
			/>
		);
	}

	if (display !== undefined) {
		return (
			<div class={cx("ui-inline-edit", "ui-inline-edit--rich", className)} data-block="true">
				<Display class="ui-inline-edit__value">{display}</Display>
				<button
					ref={restRef}
					type="button"
					class="ui-inline-edit__hit"
					aria-label={label}
					onClick={start}
				>
					<Icon name="edit" size="2xs" class="ui-inline-edit__mark" />
				</button>
			</div>
		);
	}

	return (
		<button
			ref={restRef}
			type="button"
			class={cx("ui-inline-edit", className)}
			data-block={as === "block" ? "true" : undefined}
			aria-label={`${label}. Currently: ${value || "empty"}`}
			onClick={start}
		>
			<Display class="ui-inline-edit__value">
				{value || <span class="ui-inline-edit__empty">{placeholder}</span>}
			</Display>
			<Icon name="edit" size="2xs" class="ui-inline-edit__mark" />
		</button>
	);
}
