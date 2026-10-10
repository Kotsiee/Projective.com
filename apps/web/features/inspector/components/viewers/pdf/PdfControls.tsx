import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN, type PdfFit, zoomPercent } from "../../../core/pdf-zoom.ts";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	type ToolChoiceOption,
	ToolGroup,
	ToolReadout,
	ToolRow,
	ToolToggle,
} from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import type { PdfEngine } from "./pdf-engine.ts";
import { PdfOutline } from "./PdfOutline.tsx";
import { openFind } from "./PdfStageBar.tsx";
import type { PdfTools } from "./pdf-tools.ts";

const FIT_OPTIONS: readonly ToolChoiceOption<PdfFit>[] = [
	{ value: "width", label: "Width" },
	{ value: "page", label: "Page" },
	{ value: "actual", label: "Actual" },
];

/** The PDF canvas's panel controls: page, zoom and fit, rotation, thumbnails, find, print, outline. */
export function PdfControls({ shell, tools }: ViewerProps<PdfTools>): JSX.Element | null {
	const engine = tools.engine.value;
	if (!engine) return null;
	const zoom = tools.zoom.value;
	const rotation = tools.rotation.value;
	const outline = tools.outline.value;
	return (
		<>
			<ToolGroup title="Page">
				<PdfPager tools={tools} engine={engine} announce={(m) => shell.announce(m)} />
			</ToolGroup>
			<ToolGroup title="Zoom">
				<ToolButtonGroup label="Zoom">
					<ToolButton
						icon="zoom-out"
						label="Zoom out"
						shortcut="-"
						disabled={zoom <= PDF_ZOOM_MIN}
						onClick={() => engine.stepZoom(-1)}
					/>
					<ToolReadout value={zoomPercent(zoom)} label="Zoom level" />
					<ToolButton
						icon="zoom-in"
						label="Zoom in"
						shortcut="+"
						disabled={zoom >= PDF_ZOOM_MAX}
						onClick={() => engine.stepZoom(1)}
					/>
				</ToolButtonGroup>
				<ToolChoice label="Fit" options={FIT_OPTIONS} value={tools.fit} />
			</ToolGroup>
			<ToolGroup title="Layout">
				<ToolRow label="Rotate">
					<ToolButtonGroup label="Rotate">
						<ToolButton
							icon="rotate-ccw"
							label="Rotate counter-clockwise"
							shortcut="Shift+R"
							onClick={() => engine.rotate(-1)}
						/>
						<ToolReadout value={`${rotation}°`} label="Rotation" />
						<ToolButton
							icon="rotate-cw"
							label="Rotate clockwise"
							shortcut="R"
							onClick={() => engine.rotate(1)}
						/>
					</ToolButtonGroup>
				</ToolRow>
				<ToolToggle label="Thumbnails" value={tools.thumbnails} />
			</ToolGroup>
			<ToolGroup title="Document">
				<div class="ins-pdf-actions">
					<Button
						size="sm"
						variant="text"
						severity="secondary"
						icon={<Icon name="search" size="sm" />}
						label="Find in document"
						aria-keyshortcuts="Control+F"
						onClick={() => openFind(tools)}
					/>
					{shell.options.print
						? (
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="print" size="sm" />}
								label="Print…"
								aria-keyshortcuts="Control+P"
								onClick={() => (tools.printOpen.value = true)}
							/>
						)
						: null}
				</div>
			</ToolGroup>
			{outline.length > 0
				? (
					<ToolGroup title="Outline">
						<PdfOutline items={outline} engine={engine} />
					</ToolGroup>
				)
				: null}
		</>
	);
}

interface PdfPagerProps {
	tools: PdfTools;
	engine: PdfEngine;
	announce: (message: string) => void;
}

function PdfPager({ tools, engine, announce }: PdfPagerProps): JSX.Element {
	const inputId = useId(undefined, "ins-pdf-page");
	const draft = useSignal(String(tools.page.peek()));
	const editing = useSignal(false);
	const page = tools.page.value;
	const count = tools.pageCount.value;

	useSignalEffect(() => {
		const current = tools.page.value;
		if (!editing.peek()) draft.value = String(current);
	});

	const commit = () => {
		if (!editing.peek()) return;
		editing.value = false;
		const wanted = Number.parseInt(draft.value.trim(), 10);
		if (Number.isInteger(wanted) && wanted >= 1 && wanted <= count) {
			engine.goToPage(wanted);
		} else if (draft.value.trim() !== String(tools.page.peek())) {
			announce(`Enter a page from 1 to ${count}.`);
		}
		draft.value = String(tools.page.peek());
	};

	return (
		<div class="ins-pdf-pager">
			<ToolButton
				icon="chevron-left"
				label="Previous page"
				shortcut="PageUp"
				disabled={page <= 1}
				onClick={() => engine.stepPage(-1)}
			/>
			<InputText
				id={inputId}
				class="ins-pdf-pager__input"
				size="sm"
				value={draft}
				autoComplete="off"
				spellcheck={false}
				enterKeyHint="go"
				aria-label={`Page number, 1 to ${count}`}
				onValueChange={() => (editing.value = true)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						editing.value = false;
						draft.value = String(tools.page.peek());
					}
				}}
			/>
			<span class="ins-pdf-pager__total">of {count}</span>
			<ToolButton
				icon="chevron-right"
				label="Next page"
				shortcut="PageDown"
				disabled={page >= count}
				onClick={() => engine.stepPage(1)}
			/>
		</div>
	);
}
