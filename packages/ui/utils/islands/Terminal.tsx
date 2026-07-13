import type { JSX, VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/terminal.css";
import { cx } from "../../core/cx.ts";
import { useId } from "../../hooks/useId.ts";

// #region Types
/** A rendered scrollback line — either the echoed command or a handler's response. */
export interface TerminalLine {
	kind: "command" | "response";
	content: string | VNode;
}

/** Value a command handler may return: text, rich markup, or a promise of either. */
export type TerminalResult = string | VNode | null | Promise<string | VNode | null>;

/** Props for {@link Terminal}. */
export interface TerminalProps {
	/** Prompt glyph shown before the input (default `"$"`). */
	prompt?: string;
	/** Banner printed above the first prompt. */
	welcome?: string | VNode;
	/** Map of `command name → handler(args)`; consulted before `onCommand`. */
	commandHandlers?: Record<string, (args: string[]) => TerminalResult>;
	/** Fallback handler for any command (receives the raw line). */
	onCommand?: (command: string) => TerminalResult;
	/** Accessible label for the terminal region (default `"Terminal"`). */
	"aria-label"?: string;
	id?: string;
	class?: string;
}
// #endregion

/**
 * Terminal — an interactive web command line. Type a command and press Enter to echo it and print the
 * handler's response (text, markup, or an awaited promise); ArrowUp/ArrowDown recall previous
 * commands. The scrollback is a signal-driven `log` region that auto-scrolls to the newest line;
 * clicking anywhere focuses the input. Monospace, token-styled. Resolution order: an exact match in
 * `commandHandlers`, else `onCommand`, else an "unknown command" notice.
 */
export function Terminal(props: TerminalProps): JSX.Element {
	const {
		prompt = "$",
		welcome,
		commandHandlers,
		onCommand,
		"aria-label": ariaLabel = "Terminal",
		id,
		class: className,
	} = props;

	const rootId = useId(id, "terminal");
	const lines = useMemo(() => signal<TerminalLine[]>([]), []);
	const input = useMemo(() => signal(""), []);
	const history = useRef<string[]>([]);
	const cursor = useRef(-1);

	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const push = (line: TerminalLine) => {
		lines.value = [...lines.value, line];
		queueMicrotask(() => {
			const el = scrollRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	};

	// #region Command execution
	const run = async (raw: string) => {
		const command = raw.trim();
		push({ kind: "command", content: `${prompt} ${command}` });
		if (command === "") return;

		history.current = [...history.current, command];
		cursor.current = history.current.length;

		const [name, ...args] = command.split(/\s+/);
		const handler = commandHandlers?.[name];
		try {
			const result = handler
				? await handler(args)
				: onCommand
				? await onCommand(command)
				: `Unknown command: ${name}`;
			if (result != null) push({ kind: "response", content: result });
		} catch (err) {
			push({ kind: "response", content: err instanceof Error ? err.message : String(err) });
		}
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const value = input.value;
			input.value = "";
			run(value);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (history.current.length === 0) return;
			cursor.current = Math.max(0, cursor.current - 1);
			input.value = history.current[cursor.current] ?? "";
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			if (history.current.length === 0) return;
			cursor.current = Math.min(history.current.length, cursor.current + 1);
			input.value = history.current[cursor.current] ?? "";
		}
	};
	// #endregion

	return (
		<div
			class={cx("ui-terminal", className)}
			onClick={() => inputRef.current?.focus()}
		>
			<div
				ref={scrollRef}
				class="ui-terminal__scroll"
				role="log"
				aria-live="polite"
				aria-label={ariaLabel}
			>
				{welcome && <div class="ui-terminal__welcome">{welcome}</div>}
				{lines.value.map((line, i) => (
					<div
						key={i}
						class={cx("ui-terminal__line", `ui-terminal__line--${line.kind}`)}
					>
						{line.content}
					</div>
				))}
				<div class="ui-terminal__prompt-row">
					<span class="ui-terminal__prompt" aria-hidden="true">{prompt}</span>
					<input
						ref={inputRef}
						class="ui-terminal__input"
						type="text"
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						aria-label={`${ariaLabel} input`}
						aria-controls={rootId}
						value={input}
						onInput={(e) => (input.value = e.currentTarget.value)}
						onKeyDown={onKeyDown}
					/>
				</div>
			</div>
		</div>
	);
}
