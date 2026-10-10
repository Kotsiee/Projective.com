import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	HEADING_ID_PREFIX,
	lineFromHash,
	splitLines,
	textStats,
} from "../../../core/code-lines.ts";
import { loadMarkdown } from "../../../core/markdown-loader.ts";
import type { ViewerProps } from "../viewer.ts";
import { CodeView } from "./CodeView.tsx";
import { markdownFacts, type MarkdownTools } from "./text-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";
import { useTextSource } from "./use-text-source.ts";

/** Switch between the rendered document and its source, announcing the change. */
export function toggleMarkdownMode(shell: InspectorShell, tools: MarkdownTools): void {
	tools.mode.value = tools.mode.peek() === "rendered" ? "source" : "rendered";
	shell.announce(
		tools.mode.peek() === "rendered" ? "Showing the rendered document" : "Showing the source",
	);
}

/** Scroll the heading with this id (or author anchor) into view; returns whether it exists. */
export function revealHeading(root: ParentNode, anchor: string): boolean {
	const id = anchor.startsWith(HEADING_ID_PREFIX) ? anchor : `${HEADING_ID_PREFIX}${anchor}`;
	const target = root.querySelector(`[id="${CSS.escape(id)}"]`);
	if (!(target instanceof HTMLElement)) return false;
	target.scrollIntoView({ block: "start" });
	return true;
}

function decodeAnchor(anchor: string): string {
	try {
		return decodeURIComponent(anchor);
	} catch {
		return anchor;
	}
}

interface RenderedViewProps {
	shell: InspectorShell;
	tools: MarkdownTools;
	text: string;
}

function RenderedView({ shell, tools, text }: RenderedViewProps): JSX.Element {
	const scroller = useRef<HTMLDivElement>(null);
	const rendered = tools.rendered.value;

	useEffect(() => {
		if (tools.rendered.peek() !== null) {
			if (shell.status.peek() === "loading") shell.status.value = "ready";
			return;
		}
		let live = true;
		loadMarkdown()
			.then((runtime) => runtime.renderMarkdown(text))
			.then((result) => {
				if (!live) return;
				tools.rendered.value = result;
				if (shell.status.peek() === "loading") shell.status.value = "ready";
			})
			.catch(() => {
				if (!live) return;
				tools.mode.value = "source";
				shell.announce("The document couldn't be rendered, so its source is shown instead.");
			});
		return () => {
			live = false;
		};
	}, [shell, tools, text]);

	useStageKeys(scroller, scroller, (event) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return false;
		if (event.key !== "s" && event.key !== "S") return false;
		toggleMarkdownMode(shell, tools);
		return true;
	});

	const onClick = (event: MouseEvent) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const link = target.closest("a[data-anchor]");
		const anchor = link?.getAttribute("data-anchor");
		if (!anchor || !scroller.current) return;
		if (revealHeading(scroller.current, decodeAnchor(anchor).toLowerCase())) {
			event.preventDefault();
		}
	};

	return (
		<div ref={scroller} class="ins-md">
			{rendered
				? (
					<article
						class="ins-md__doc"
						onClick={onClick}
						dangerouslySetInnerHTML={{ __html: rendered.html }}
					/>
				)
				: null}
		</div>
	);
}

/** The markdown canvas: the rendered document, or its line-numbered source. */
export function MarkdownStage({ shell, tools }: ViewerProps<MarkdownTools>): JSX.Element {
	const { view } = tools;
	useTextSource(shell, tools.text, (text) => {
		view.lines.value = splitLines(text);
		if (
			shell.options.urlSync && typeof location !== "undefined" &&
			lineFromHash(location.hash) !== null
		) {
			tools.mode.value = "source";
		}
	});

	useSignalEffect(() => {
		const text = tools.text.value;
		if (text !== null) shell.facts.value = markdownFacts(textStats(text));
	});

	const text = tools.text.value;
	if (text === null) return <div class="ins-md" aria-hidden="true" />;
	if (tools.mode.value === "source") {
		return (
			<CodeView
				shell={shell}
				view={view}
				followHash={shell.options.urlSync}
				onKey={(event) => {
					if (event.ctrlKey || event.metaKey || event.altKey) return false;
					if (event.key !== "s" && event.key !== "S") return false;
					toggleMarkdownMode(shell, tools);
					return true;
				}}
			/>
		);
	}
	return <RenderedView shell={shell} tools={tools} text={text} />;
}
