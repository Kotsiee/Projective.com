import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { InputText } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import { ToolButton } from "../../controls/mod.ts";
import { matchSummary, normalizeQuery } from "./pdf-find.ts";
import type { PdfTools } from "./pdf-tools.ts";

/** Props for {@link PdfFindBar}. */
export interface PdfFindBarProps {
	tools: PdfTools;
}

/** The floating find-in-document bar: query, match count, previous/next and close. */
export function PdfFindBar({ tools }: PdfFindBarProps): JSX.Element {
	const { find } = tools;
	const inputId = useId(undefined, "ins-pdf-find");
	const barRef = useRef<HTMLDivElement>(null);
	const focusRequest = find.focusRequest.value;
	const engine = tools.engine.value;
	const total = find.matches.value.length;
	const hasQuery = normalizeQuery(find.query.value).length > 0;
	const summary = hasQuery ? matchSummary(find.active.value, total, find.searching.value) : "";

	useEffect(() => {
		const timer = setTimeout(() => {
			const input = document.getElementById(inputId);
			if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
			input.focus();
			input.select();
		}, 0);
		return () => clearTimeout(timer);
	}, [focusRequest, inputId]);

	const close = () => {
		const stage = barRef.current?.closest<HTMLElement>(".ins-stage") ?? null;
		find.open.value = false;
		setTimeout(() => {
			if (stage && stage.isConnected && document.activeElement !== stage) stage.focus();
		}, 0);
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			engine?.stepMatch(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	return (
		<div ref={barRef} class="ins-pdf-find" role="search" aria-label="Find in document">
			<InputText
				id={inputId}
				class="ins-pdf-find__input"
				size="sm"
				value={find.query}
				placeholder="Find in document"
				aria-label="Find in document"
				autoComplete="off"
				spellcheck={false}
				enterKeyHint="search"
				onKeyDown={onKeyDown}
			/>
			<span class="ins-pdf-find__count">{summary}</span>
			<ToolButton
				icon="chevron-up"
				label="Previous match"
				shortcut="Shift+Enter"
				disabled={total === 0 || !engine}
				onClick={() => engine?.stepMatch(-1)}
			/>
			<ToolButton
				icon="chevron-down"
				label="Next match"
				shortcut="Enter"
				disabled={total === 0 || !engine}
				onClick={() => engine?.stepMatch(1)}
			/>
			<ToolButton icon="close" label="Close find" shortcut="Esc" onClick={close} />
		</div>
	);
}
