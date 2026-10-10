import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Dialog, Message, ProgressBar } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import {
	PRINT_DPI,
	type PrintFit,
	printPages,
	type PrintQuality,
	type PrintRange,
} from "../../../core/pdf-print.ts";
import { ToolChoice, type ToolChoiceOption } from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import { isAbort, type PreparedPrint, preparePrint, printPrepared } from "./pdf-print-job.ts";
import type { PdfTools } from "./pdf-tools.ts";

const RANGE_OPTIONS: readonly ToolChoiceOption<PrintRange>[] = [
	{ value: "all", label: "All" },
	{ value: "current", label: "Current" },
	{ value: "custom", label: "Custom" },
];

const QUALITY_OPTIONS: readonly ToolChoiceOption<PrintQuality>[] = [
	{ value: "draft", label: `Draft · ${PRINT_DPI.draft}` },
	{ value: "standard", label: `Standard · ${PRINT_DPI.standard}` },
	{ value: "high", label: `High · ${PRINT_DPI.high}` },
];

const FIT_OPTIONS: readonly ToolChoiceOption<PrintFit>[] = [
	{ value: "page", label: "Fit to page" },
	{ value: "actual", label: "Actual size" },
];

const MANY_PAGES = 60;

interface Progress {
	done: number;
	total: number;
}

/**
 * The print dialog: which pages, how sharp, and whether pages fit the sheet. Each sheet follows its
 * page's orientation. Pages are rasterised here, then the browser's own print dialog takes over.
 */
export function PdfPrintDialog({ shell, tools }: ViewerProps<PdfTools>): JSX.Element {
	const range = useSignal<PrintRange>("all");
	const custom = useSignal("");
	const quality = useSignal<PrintQuality>("standard");
	const fit = useSignal<PrintFit>("page");
	const progress = useSignal<Progress | null>(null);
	const error = useSignal<string | null>(null);
	const customId = useId(undefined, "ins-pdf-print-pages");
	const customHintId = useId(undefined, "ins-pdf-print-hint");
	const job = useRef<AbortController | null>(null);
	const prepared = useRef<PreparedPrint | null>(null);

	useEffect(() => () => {
		job.current?.abort();
		prepared.current?.dispose();
	}, []);

	const engine = tools.engine.value;
	const count = tools.pageCount.value;
	const selection = printPages(range.value, custom.value, tools.page.value, count);
	const busy = progress.value !== null;
	const customInvalid = range.value === "custom" && custom.value.trim().length > 0 &&
		!selection.ok;

	const cancel = () => {
		job.current?.abort();
		job.current = null;
		progress.value = null;
	};

	const close = () => {
		cancel();
		error.value = null;
		tools.printOpen.value = false;
	};

	const print = async () => {
		if (!engine || busy) return;
		if (!selection.ok) {
			error.value = selection.error;
			return;
		}
		error.value = null;
		prepared.current?.dispose();
		prepared.current = null;
		const controller = new AbortController();
		job.current = controller;
		progress.value = { done: 0, total: selection.pages.length };
		try {
			const ready = await preparePrint(engine.doc, {
				pages: selection.pages,
				dpi: PRINT_DPI[quality.value],
				fit: fit.value,
				signal: controller.signal,
				onProgress: (done, total) => {
					if (job.current === controller) progress.value = { done, total };
				},
			});
			if (job.current !== controller) {
				ready.dispose();
				return;
			}
			job.current = null;
			progress.value = null;
			prepared.current = ready;
			tools.printOpen.value = false;
			await printPrepared(ready);
			if (prepared.current === ready) prepared.current = null;
		} catch (failure) {
			if (job.current === controller) {
				job.current = null;
				progress.value = null;
			}
			if (isAbort(failure)) return;
			error.value =
				"The pages couldn't be prepared for printing. Try Draft quality or fewer pages.";
			shell.announce("Printing failed.");
		}
	};

	const current = progress.value;
	const pagesLabel = selection.ok
		? `${selection.pages.length} ${selection.pages.length === 1 ? "page" : "pages"}`
		: "";

	return (
		<Dialog
			visible={tools.printOpen}
			header="Print"
			width="28rem"
			blockScroll={false}
			dismissableMask={!busy}
			onVisibleChange={(open) => {
				if (!open) {
					cancel();
					error.value = null;
				}
			}}
			footer={
				<div class="ins-pdf-print__foot">
					{busy
						? (
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								label="Cancel"
								onClick={cancel}
							/>
						)
						: (
							<>
								<Button
									size="sm"
									variant="text"
									severity="secondary"
									label="Close"
									onClick={close}
								/>
								<Button
									size="sm"
									variant="filled"
									label={pagesLabel ? `Print ${pagesLabel}` : "Print"}
									disabled={!engine || !selection.ok}
									onClick={() => void print()}
								/>
							</>
						)}
				</div>
			}
		>
			<div class="ins-pdf-print">
				{current
					? (
						<div class="ins-pdf-print__progress" role="status">
							<p class="ins-pdf-print__status">
								{current.done < current.total
									? `Preparing page ${current.done + 1} of ${current.total}…`
									: "Opening the print dialog…"}
							</p>
							<ProgressBar
								value={current.total > 0 ? (current.done / current.total) * 100 : 0}
								aria-label="Preparing pages"
							/>
						</div>
					)
					: (
						<>
							<ToolChoice label="Pages" options={RANGE_OPTIONS} value={range} />
							{range.value === "custom"
								? (
									<div class="ins-pdf-print__range">
										<InputText
											id={customId}
											size="sm"
											block
											value={custom}
											placeholder="e.g. 1-3, 7"
											autoComplete="off"
											spellcheck={false}
											aria-label="Pages to print"
											aria-describedby={customHintId}
											status={customInvalid ? "invalid" : "default"}
										/>
										<p id={customHintId} class="ins-pdf-print__hint">
											{customInvalid && !selection.ok
												? selection.error
												: `Pages and ranges from 1 to ${count}, separated by commas.`}
										</p>
									</div>
								)
								: null}
							<ToolChoice label="Quality (dpi)" options={QUALITY_OPTIONS} value={quality} />
							<ToolChoice label="Scale" options={FIT_OPTIONS} value={fit} />
							<p class="ins-pdf-print__hint">Each sheet follows its page's orientation.</p>
							{selection.ok && selection.pages.length > MANY_PAGES && quality.value !== "draft"
								? (
									<p class="ins-pdf-print__hint">
										Many pages at this quality can take a while to prepare.
									</p>
								)
								: null}
						</>
					)}
				{error.value ? <Message severity="danger" size="sm">{error.value}</Message> : null}
			</div>
		</Dialog>
	);
}
