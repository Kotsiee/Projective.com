import { batch, type Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { looksBinary, normalizeNewlines } from "../../../core/code-lines.ts";

class TextLoadError extends Error {}

async function readText(src: string, signal: AbortSignal): Promise<string> {
	const res = await fetch(src, { signal, credentials: "same-origin" });
	if (!res.ok) {
		await res.body?.cancel();
		throw new TextLoadError(
			res.status === 404 ? "This file is no longer available." : "This file couldn't be loaded.",
		);
	}
	return await res.text();
}

/**
 * Fetch the file once through the proxy into `text` (newlines normalised), letting `derive` fill
 * the canvas's own state in the same batch. A failed read, or bytes that are not text, hand the
 * stage to the fallback; unmounting aborts the request.
 */
export function useTextSource(
	shell: InspectorShell,
	text: Signal<string | null>,
	derive: (text: string) => void,
): void {
	useEffect(() => {
		if (text.peek() !== null || shell.status.peek() === "error") return;
		const controller = new AbortController();
		readText(shell.asset.src, controller.signal)
			.then((body) => {
				if (looksBinary(body)) {
					shell.fail("This file isn't plain text, so it can't be previewed here.");
					return;
				}
				const normalised = normalizeNewlines(body);
				batch(() => {
					derive(normalised);
					text.value = normalised;
				});
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				shell.fail(
					error instanceof TextLoadError ? error.message : "This file couldn't be loaded.",
				);
			});
		return () => controller.abort();
	}, [shell, text]);
}
