import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { INSPECT_TEXT_LIMITS } from "@projective/types/files";
import { looksBinary, normalizeNewlines } from "@features/inspector/core/code-lines.ts";

/** Lines {@link FilePreview}'s code view draws before it stops and says so. */
export const LEGACY_TEXT_LINES = 2000;

/** Where a text read stands. */
export type LegacyTextRead =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; text: string }
	| { status: "error"; message: string };

class LegacyTextError extends Error {}

async function readText(src: string, signal: AbortSignal): Promise<string> {
	const res = await fetch(src, { signal, credentials: "same-origin" });
	if (!res.ok) {
		await res.body?.cancel();
		throw new LegacyTextError(
			res.status === 404 ? "This file is no longer available." : "This file couldn't be loaded.",
		);
	}
	const text = await res.text();
	if (looksBinary(text)) throw new LegacyTextError("This file isn't plain text.");
	return normalizeNewlines(text);
}

/**
 * A file's text, read once through the proxy (`src`); idle when there is nothing to read. A file
 * past the inspector's highlight ceiling is not fetched. Unmounting aborts the request.
 */
export function useLegacyText(src: string | null, sizeBytes: number): LegacyTextRead {
	const read = useSignal<LegacyTextRead>({ status: src ? "loading" : "idle" });

	useEffect(() => {
		if (!src) {
			read.value = { status: "idle" };
			return;
		}
		if (sizeBytes > INSPECT_TEXT_LIMITS.highlightBytes) {
			read.value = {
				status: "error",
				message: "This file is too large to show here. Download it to read it in full.",
			};
			return;
		}
		read.value = { status: "loading" };
		const controller = new AbortController();
		readText(src, controller.signal)
			.then((text) => {
				read.value = { status: "ready", text };
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				read.value = {
					status: "error",
					message: error instanceof LegacyTextError
						? error.message
						: "This file couldn't be loaded.",
				};
			});
		return () => controller.abort();
	}, [src, sizeBytes]);

	return read.value;
}
