/**
 * Messages — a stateful stack of dismissible {@link Message} rows driven by a `Bindable<MessageItem[]>`
 * (signal-first: push/splice the caller's signal to add/remove entries). Each row optionally
 * auto-dismisses after `life` ms, animates out before removal, and can be paused mid-flight by an
 * explicit close. The stack region is `aria-live="polite"`; individual rows escalate to
 * `role="alert"`/assertive for `warning`/`danger` severities, matching {@link Message}.
 */
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/message.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { closeIcon, severityIcon } from "../core/icons.tsx";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";
import type { MessageItem } from "../types/mod.ts";

// #region Props
export interface MessagesProps {
	/** The live stack. Uncontrolled (raw array) or controlled (`Signal<MessageItem[]>`). */
	messages?: Bindable<MessageItem[]>;
	/** Fired whenever the stack changes (item added, auto-dismissed, or closed). */
	onMessagesChange?: ValueChange<MessageItem[]>;
	id?: string;
	class?: string;
}
// #endregion

// #region Row
interface RowProps {
	item: MessageItem;
	onDismiss: (id: string) => void;
}

/** A single animated, optionally auto-dismissing row. Kept local — never used outside the stack. */
function MessagesRow({ item, onDismiss }: RowProps): JSX.Element {
	const closing = useSignal(false);
	const rowRef = useRef<HTMLDivElement>(null);

	const requestClose = () => {
		closing.value = true;
	};

	useEffect(() => {
		if (!item.life) return;
		const t = setTimeout(requestClose, item.life);
		return () => clearTimeout(t);
	}, [item.life]);

	useEffect(() => {
		if (!closing.value) return;
		const el = rowRef.current;
		const durationMs = el ? parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0 : 0;
		const t = setTimeout(() => onDismiss(item.id), durationMs);
		return () => clearTimeout(t);
	}, [closing.value]);

	const severity = item.severity ?? "info";
	const assertive = severity === "warning" || severity === "danger";
	const icon = item.icon === null ? null : item.icon ?? severityIcon(severity);

	return (
		<div
			ref={rowRef}
			class={cx(
				"ui-message",
				`ui-message--${severity}`,
				"ui-message--filled",
				"ui-messages__item",
				closing.value && "ui-messages__item--exit",
			)}
			role={assertive ? "alert" : "status"}
		>
			{icon && <span class="ui-message__icon" aria-hidden="true">{icon}</span>}
			<span class="ui-message__text">
				{item.summary && <span class="ui-message__summary">{item.summary}</span>}
				{item.detail && <span class="ui-message__detail">{item.detail}</span>}
			</span>
			{item.closable !== false && (
				<button
					type="button"
					class="ui-message__close"
					aria-label="Dismiss message"
					onClick={requestClose}
				>
					{closeIcon()}
				</button>
			)}
		</div>
	);
}
// #endregion

export function Messages(props: MessagesProps): JSX.Element {
	const { messages, onMessagesChange, id, class: className } = props;
	const ctrl = useControllable<MessageItem[]>(messages, [], onMessagesChange);

	const dismiss = (msgId: string) => {
		ctrl.set(ctrl.get().filter((m) => m.id !== msgId));
	};

	return (
		<div id={id} class={cx("ui-messages", className)} aria-live="polite" aria-atomic="false">
			{ctrl.signal.value.map((item) => (
				<MessagesRow
					key={item.id}
					item={item}
					onDismiss={dismiss}
				/>
			))}
		</div>
	);
}
