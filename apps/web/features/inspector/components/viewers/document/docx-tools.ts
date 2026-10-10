import { type Signal, signal } from "@preact/signals";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import type { ParsedDocx } from "../../../core/docx-runtime.ts";
import type { DocxPrinter } from "./docx-print.ts";
import { type DocxZoomMode, formatDocxZoom, stepDocxZoom } from "./docx-model.ts";

/** The Word canvas's state, shared by its stage and its panel controls. */
export interface DocxTools {
	readonly zoom: Signal<number>;
	readonly mode: Signal<DocxZoomMode>;
	readonly breakPages: Signal<boolean>;
	readonly headersFooters: Signal<boolean>;
	readonly notes: Signal<boolean>;
	readonly changes: Signal<boolean>;
	/** The parsed document once it has loaded. */
	readonly document: Signal<ParsedDocx | null>;
	/** Pages drawn by the last render. */
	readonly pageCount: Signal<number | null>;
	readonly printing: Signal<boolean>;
	/** Bound by the stage while it is mounted. */
	printer: DocxPrinter | null;
	zoomBy(direction: 1 | -1): void;
	/** Set a free zoom (Ctrl + wheel); quiet, so a gesture does not flood the live region. */
	zoomTo(zoom: number): void;
	fitWidth(): void;
	actualSize(): void;
	print(): void;
}

/** Create the Word canvas state. Signals only, so it is safe during SSR. */
export function createDocxTools(shell: InspectorShell): DocxTools {
	const zoom = signal(1);
	const mode = signal<DocxZoomMode>("auto");
	const printing = signal(false);

	const tools: DocxTools = {
		zoom,
		mode,
		breakPages: signal(true),
		headersFooters: signal(true),
		notes: signal(true),
		changes: signal(false),
		document: signal<ParsedDocx | null>(null),
		pageCount: signal<number | null>(null),
		printing,
		printer: null,
		zoomBy(direction) {
			mode.value = "manual";
			zoom.value = stepDocxZoom(zoom.peek(), direction);
			shell.announce(`Zoom ${formatDocxZoom(zoom.peek())}`);
		},
		zoomTo(next) {
			mode.value = "manual";
			zoom.value = next;
		},
		fitWidth() {
			mode.value = "fit";
			shell.announce("Fit to width");
		},
		actualSize() {
			mode.value = "manual";
			zoom.value = 1;
			shell.announce("Actual size");
		},
		print() {
			const printer = tools.printer;
			if (!printer || printing.peek()) return;
			printing.value = true;
			printer.print()
				.then((printed) => {
					if (!printed) shell.announce("There's nothing to print yet.");
				})
				.catch(() => shell.announce("Printing isn't available right now."))
				.finally(() => (printing.value = false));
		},
	};
	return tools;
}
