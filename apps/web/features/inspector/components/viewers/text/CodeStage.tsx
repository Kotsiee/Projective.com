import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { splitLines, textStats } from "../../../core/code-lines.ts";
import type { ViewerProps } from "../viewer.ts";
import { CodeControls } from "./CodeControls.tsx";
import { CodeView } from "./CodeView.tsx";
import { codeFacts, type CodeTools } from "./text-tools.ts";
import { useTextSource } from "./use-text-source.ts";

/** The code and plain-text canvas: the file, read once, in a line-numbered source view. */
export function CodeStage({ shell, tools }: ViewerProps<CodeTools>): JSX.Element {
	const { view } = tools;
	useTextSource(shell, tools.text, (text) => {
		view.lines.value = splitLines(text);
	});

	useSignalEffect(() => {
		const text = tools.text.value;
		if (text === null) return;
		shell.facts.value = codeFacts(textStats(text), view.languageName.value);
	});

	if (tools.text.value === null) return <div class="ins-code" aria-hidden="true" />;
	return <CodeView shell={shell} view={view} followHash={shell.options.urlSync} />;
}

/** The code and plain-text canvas's panel controls. */
export function CodeStageControls({ shell, tools }: ViewerProps<CodeTools>): JSX.Element {
	return <CodeControls shell={shell} view={tools.view} text={tools.text.value} />;
}
