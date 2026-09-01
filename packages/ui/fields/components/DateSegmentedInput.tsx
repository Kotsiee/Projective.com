import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import {
	adjacentSegment,
	type DateParts,
	type DateSegmentKind,
	type DateSegmentPart,
	normalizeYear,
	parsePastedDate,
	reconcile,
	SEGMENT_LABEL,
	SEGMENT_PLACEHOLDER,
	segmentBounds,
	segmentOrder,
	segmentText,
	stepSegment,
	typeDigit,
} from "../core/date-segments.ts";
import { MONTH_NAMES } from "../core/datetime.ts";

// #region Types

export interface DateSegmentedInputProps {
	/** Ordered segments and separators, derived from the caller's `dateFormat`. */
	layout: DateSegmentPart[];
	/** The date under construction. Shared with the calendar, which highlights whatever it names. */
	parts: DateParts;
	/** Per-segment raw typing buffers — what a segment shows while it is being typed into. */
	buffers: Record<DateSegmentKind, string>;
	/** Is the calendar popover open? Decides what Enter means and nothing else. */
	open: boolean;
	/** `id` of the popover, for `aria-controls`. */
	panelId: string;
	/** `id` the caller's `<label for>` points at. Lands on the first segment. */
	inputId: string;
	disabled?: boolean;
	readOnly?: boolean;
	required?: boolean;
	/** The segments name a whole date the calendar refuses (out of range, or explicitly disabled). */
	outOfRange?: boolean;
	"aria-label"?: string;
	"aria-describedby"?: string;
	"aria-invalid"?: boolean | undefined;
	/** A settled edit, with the segment the reader actually moved so the caller can reconcile. */
	onEdit: (next: DateParts, edited: DateSegmentKind) => void;
	/** A segment's raw buffer changed. */
	onBuffer: (kind: DateSegmentKind, buffer: string) => void;
	/** A segment took or lost focus. `null` means the control no longer owns focus. */
	onActivate: (kind: DateSegmentKind | null) => void;
	/**
	 * The reader asked for the calendar, and where focus should go once it is there.
	 *
	 * A CLICK keeps focus on the segment (`"segments"`), because a reader who clicked a box is about
	 * to type in it. Enter and Space hand focus to the grid (`"grid"`), which is what makes the second
	 * Enter select a day rather than needing a Tab in between.
	 */
	onRequestOpen: (focus: "segments" | "grid") => void;
	/** The reader is finished (Enter while open). */
	onRequestClose: () => void;
}

// #endregion

// #region Helpers

/** Characters that mean "next segment" — every separator a date is conventionally written with. */
const SEPARATOR_KEYS = /^[\/\-.,\s]$/;

/**
 * Is `el` laid out right-to-left?
 *
 * The arrow keys are PHYSICAL — ArrowLeft means the segment drawn to the left — while
 * {@link adjacentSegment} steps in reading order. Under `dir="rtl"` the two run opposite ways, so
 * without this the arrows walk the segments backwards on exactly the surfaces §A.6 requires to
 * mirror. Read from the computed style rather than from a prop, because the direction is inherited
 * from an ancestor the control cannot see.
 */
function isRtl(el: HTMLElement | null): boolean {
	if (!el || typeof globalThis.getComputedStyle !== "function") return false;
	return globalThis.getComputedStyle(el).direction === "rtl";
}

// #endregion

/**
 * The `DD` / `MM` / `YYYY` typing surface inside the DatePicker's field.
 *
 * Three `role="spinbutton"` inputs with the literal separators of the caller's own `dateFormat`
 * between them, so a form that PRINTS `dd/mm/yyyy` also asks for it in that order. Every decision
 * about what a keystroke means lives in `core/date-segments.ts` and is unit-tested there; this
 * component owns the DOM consequences — which element has focus, and when — and nothing else.
 *
 * They are real `<input>` elements rather than focusable spans for three reasons that are each
 * independently sufficient: a `<label for>` only targets a labelable element, so the caller's field
 * label would otherwise focus nothing; `inputMode="numeric"` is what raises a numeric keypad on a
 * phone, and a segmented date input that cannot be typed into on a phone is a read-only one; and
 * `beforeinput` fires for virtual keyboards and IMEs that never dispatch a usable `keydown`.
 *
 * Both text-entry channels are default-prevented and routed through the same
 * {@link typeDigit}/{@link parsePastedDate}, so the element's own value can never drift from the
 * value the state machine believes in.
 */
export function DateSegmentedInput(props: DateSegmentedInputProps): JSX.Element {
	const {
		layout,
		parts,
		buffers,
		open,
		panelId,
		inputId,
		disabled,
		readOnly,
		required,
		outOfRange,
		onEdit,
		onBuffer,
		onActivate,
		onRequestOpen,
		onRequestClose,
	} = props;

	const hostRef = useRef<HTMLDivElement>(null);
	const order = segmentOrder(layout);
	const editable = !disabled && !readOnly;

	// #region Focus movement
	const focusSegment = (kind: DateSegmentKind) => {
		hostRef.current?.querySelector<HTMLInputElement>(`[data-segment="${kind}"]`)?.focus();
	};

	/** Move to the next segment, or stay put at the end — see {@link adjacentSegment} on why. */
	const advance = (from: DateSegmentKind, delta: number) => {
		const next = adjacentSegment(order, from, delta);
		if (next) focusSegment(next);
	};
	// #endregion

	// #region Editing
	/**
	 * Feed one digit to a segment and decide whether focus moves on.
	 *
	 * The year is committed only once it is four digits wide. A reader on their way to `2026` has
	 * typed `20`, and writing that through would send the calendar to the first century between two
	 * keystrokes; the two-digit widening happens when the segment is left instead.
	 *
	 * An ambiguous buffer (`0`, on its way to `06`) leaves the committed value ALONE rather than
	 * clearing it. Nothing has been decided yet, so the calendar keeps showing the day it was already
	 * on — and Backspace stays the one thing that empties a segment, which is what the reader has
	 * been told it does.
	 */
	const applyDigit = (kind: DateSegmentKind, digit: string) => {
		const typed = typeDigit(kind, buffers[kind], digit);
		onBuffer(kind, typed.buffer);

		const value = kind === "year"
			? (typed.complete ? normalizeYear(typed.value ?? 0) : null)
			: typed.value;
		if (value !== null) onEdit(reconcile({ ...parts, [kind]: value }, kind).parts, kind);
		if (typed.complete) advance(kind, 1);
	};

	const clearSegment = (kind: DateSegmentKind) => {
		onBuffer(kind, "");
		// Written straight through rather than reconciled: an absent segment cannot make a date
		// impossible, so there is nothing for the other two to accommodate.
		onEdit({ ...parts, [kind]: null }, kind);
	};

	const applyPaste = (text: string) => {
		const pasted = parsePastedDate(text, order);
		if (!pasted) return;
		for (const kind of order) onBuffer(kind, "");
		onEdit(pasted, "day");
	};
	// #endregion

	// #region Keyboard
	/**
	 * The closed half of the two-mode keyboard contract.
	 *
	 * Arrows move BETWEEN segments horizontally and step a segment's VALUE vertically; the calendar
	 * grid owns the same four keys with day/week meanings, and which of the two runs is settled by
	 * which element holds focus rather than by a mode flag — there is no third state where both
	 * believe they are active.
	 */
	const onSegmentKeyDown = (
		kind: DateSegmentKind,
		e: JSX.TargetedKeyboardEvent<HTMLInputElement>,
	) => {
		if (e.altKey || e.ctrlKey || e.metaKey) return;

		switch (e.key) {
			case "ArrowLeft":
			case "ArrowRight": {
				e.preventDefault();
				const physical = e.key === "ArrowRight" ? 1 : -1;
				advance(kind, isRtl(hostRef.current) ? -physical : physical);
				return;
			}
			case "ArrowUp":
			case "ArrowDown":
				e.preventDefault();
				if (!editable) return;
				// A step supersedes a half-typed buffer: the reader has stopped spelling a number and
				// started nudging one, and leaving `0` in the buffer would make the next digit extend a
				// value that is no longer on screen.
				onBuffer(kind, "");
				onEdit(stepSegment(parts, kind, e.key === "ArrowUp" ? 1 : -1), kind);
				return;
			case "Backspace":
			case "Delete":
				e.preventDefault();
				if (editable) clearSegment(kind);
				return;
			case "Enter":
				e.preventDefault();
				if (open) onRequestClose();
				else onRequestOpen("grid");
				return;
			case " ":
				e.preventDefault();
				if (!open) onRequestOpen("grid");
				return;
			case "Home":
			case "End":
				e.preventDefault();
				focusSegment(e.key === "Home" ? order[0] : order[order.length - 1]);
				return;
		}

		if (e.key.length !== 1) return;
		if (/[0-9]/.test(e.key)) {
			e.preventDefault();
			if (editable) applyDigit(kind, e.key);
			return;
		}
		// Typing `12/05/2023` straight through works because a separator means "next", exactly as it
		// does in every native date field.
		if (SEPARATOR_KEYS.test(e.key)) {
			e.preventDefault();
			advance(kind, 1);
		}
	};
	// #endregion

	// #region Render
	const renderSegment = (kind: DateSegmentKind, index: number): JSX.Element => {
		const bounds = segmentBounds(kind, parts);
		const value = parts[kind];
		const editing = buffers[kind] !== "";
		const text = segmentText(kind, value, buffers[kind], editing);
		const empty = value === null && !editing;
		const first = index === 0;

		return (
			<input
				key={kind}
				// The first segment carries the control's identity: it is what `<label for>` targets, what
				// a caller's `id` addresses, and the element that answers for the popover.
				id={first ? inputId : undefined}
				data-segment={kind}
				// `__entry` marks the control's primary entry point in BOTH presentations — the first
				// segment here, the read-only input there — so a caller that reaches in to focus or
				// click the field (the ticket meta bar opens its editor that way) has one selector that
				// does not depend on which presentation is in use.
				class={first ? "ui-datepicker__seg ui-datepicker__entry" : "ui-datepicker__seg"}
				type="text"
				inputMode="numeric"
				autocomplete="off"
				autocorrect="off"
				spellcheck={false}
				size={SEGMENT_PLACEHOLDER[kind].length}
				value={text}
				disabled={disabled}
				readOnly={readOnly}
				tabIndex={disabled ? -1 : 0}
				data-empty={empty || undefined}
				role="spinbutton"
				aria-label={SEGMENT_LABEL[kind]}
				aria-valuemin={bounds.min}
				aria-valuemax={bounds.max}
				aria-valuenow={value === null ? undefined : (kind === "month" ? value + 1 : value)}
				// A bare number is the wrong thing to hear for a month, and the wrong thing to hear for
				// an empty segment. `aria-valuetext` is the only channel that can say either.
				aria-valuetext={value === null
					? "Empty"
					: kind === "month"
					? MONTH_NAMES[value]
					: String(value)}
				// A refused date is announced on the segment that owns the field's identity, so it is
				// heard once rather than three times.
				aria-invalid={first ? (outOfRange || props["aria-invalid"]) : undefined}
				aria-required={first && required ? true : undefined}
				aria-describedby={first ? props["aria-describedby"] : undefined}
				aria-haspopup={first ? "dialog" : undefined}
				aria-expanded={first ? open : undefined}
				aria-controls={first ? panelId : undefined}
				onKeyDown={(e) => onSegmentKeyDown(kind, e)}
				onBeforeInput={(e) => {
					// Every text-entry channel is prevented and re-routed, so the element's own value can
					// never diverge from the state machine's. A virtual keyboard that dispatches no usable
					// `keydown` still reaches `typeDigit` through here.
					e.preventDefault();
					if (!editable) return;
					const data = e.data ?? "";
					if (data.length === 1 && /[0-9]/.test(data)) applyDigit(kind, data);
					else if (data.length > 1) applyPaste(data);
				}}
				onPaste={(e) => {
					e.preventDefault();
					if (editable) applyPaste(e.clipboardData?.getData("text") ?? "");
				}}
				onFocus={(e) => {
					onActivate(kind);
					// A fresh buffer on every arrival, so the first digit starts a value rather than
					// extending one the reader typed a minute ago and has since navigated away from.
					onBuffer(kind, "");
					e.currentTarget.select();
				}}
				onBlur={() => {
					// The one place a two-digit year becomes four. Doing it here rather than on the
					// keystroke is what lets `26` stay `26` while it is still being typed.
					const buffer = buffers[kind];
					if (kind === "year" && buffer !== "" && buffer.length < 4) {
						const widened = normalizeYear(Number(buffer));
						onEdit(reconcile({ ...parts, year: widened }, "year").parts, "year");
					}
					onBuffer(kind, "");
					onActivate(null);
				}}
				onClick={() => {
					// Clicking a date field should show the calendar. The segment still takes focus, so
					// typing continues to work; the popover does not steal it (see the picker's focus owner).
					if (!open && editable) onRequestOpen("segments");
				}}
			/>
		);
	};

	let segmentIndex = 0;
	return (
		<div
			ref={hostRef}
			class="ui-datepicker__segments"
			data-out-of-range={outOfRange || undefined}
			role="group"
			aria-label={props["aria-label"] ?? "Date"}
		>
			{layout.map((part, i) =>
				part.kind === "literal"
					? (
						<span class="ui-datepicker__seg-sep" aria-hidden="true" key={`sep-${i}`}>
							{part.text}
						</span>
					)
					: renderSegment(part.kind, segmentIndex++)
			)}
		</div>
	);
	// #endregion
}
