import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Button, InputText } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import { findSummary } from "../core/chat-find.ts";
import type { ChatFind } from "../hooks/useChatFind.ts";

/** Props for {@link ChatFindBar}. */
export interface ChatFindBarProps {
	find: ChatFind;
}

function Control(
	{ label, keys, icon, disabled, onClick }: {
		label: string;
		keys: string;
		icon: "chevron-up" | "chevron-down" | "close";
		disabled?: boolean;
		onClick: () => void;
	},
): JSX.Element {
	return (
		<Tooltip content={label} shortcut={keys} placement="bottom">
			<Button
				variant="text"
				severity="secondary"
				size="sm"
				iconOnly
				icon={<Icon name={icon} size="sm" />}
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

/**
 * ChatFindBar — the thread's message finder (Decision #418): one band under the channel header, in
 * the pinned banner's anatomy, holding the query, the match count and older / newer / close. Enter
 * steps older, Shift+Enter newer, Escape closes and hands focus back.
 */
export function ChatFindBar({ find }: ChatFindBarProps): JSX.Element {
	const inputId = useId(undefined, "chat-find");
	const focusRequest = find.focusRequest.value;
	const position = find.position.value;
	const busy = find.searching.value;
	const hasQuery = find.query.value.trim().length > 0;

	useEffect(() => {
		const timer = setTimeout(() => {
			const input = document.getElementById(inputId);
			if (!(input instanceof HTMLInputElement)) return;
			input.focus();
			input.select();
		}, 0);
		return () => clearTimeout(timer);
	}, [focusRequest, inputId]);

	const onBarKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		find.close();
	};

	const onFieldKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter" || event.isComposing) return;
		event.preventDefault();
		void find.step(event.shiftKey ? -1 : 1);
	};

	return (
		<div class="chat-find">
			<div
				class="chat-find__bar"
				role="search"
				aria-label="Find in conversation"
				aria-busy={busy ? "true" : undefined}
				onKeyDown={onBarKeyDown}
			>
				<InputText
					id={inputId}
					class="chat-find__field"
					size="sm"
					variant="bare"
					block
					value={find.query}
					placeholder="Find in conversation"
					aria-label="Find in conversation"
					autoComplete="off"
					spellcheck={false}
					enterKeyHint="search"
					onKeyDown={onFieldKeyDown}
				/>
				<span class="chat-find__count" aria-hidden="true">
					{hasQuery ? (busy ? "Searching…" : findSummary(position)) : ""}
				</span>
				<Control
					label="Older match"
					keys="Enter"
					icon="chevron-up"
					disabled={!hasQuery || busy || (position.total === 0 && !position.more)}
					onClick={() => void find.step(1)}
				/>
				<Control
					label="Newer match"
					keys="Shift+Enter"
					icon="chevron-down"
					disabled={!hasQuery || busy || position.total === 0}
					onClick={() => void find.step(-1)}
				/>
				<Control label="Close find" keys="Esc" icon="close" onClick={find.close} />
			</div>
		</div>
	);
}
