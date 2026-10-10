import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	ToolButton,
	ToolButtonGroup,
	ToolGroup,
	ToolReadout,
	ToolToggle,
} from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import type { DocxTools } from "./docx-tools.ts";
import { DOCX_ZOOM_MAX, DOCX_ZOOM_MIN, formatDocxZoom } from "./docx-model.ts";

/** The Word canvas's panel controls: zoom, the optional layers the document has, and Print. */
export function DocxControls({ shell, tools }: ViewerProps<DocxTools>): JSX.Element {
	const ready = shell.status.value === "ready";
	const zoom = tools.zoom.value;
	const mode = tools.mode.value;
	const features = tools.document.value?.features ?? null;
	const pages = tools.pageCount.value;
	const printing = tools.printing.value;

	return (
		<>
			<ToolGroup title="Zoom">
				<ToolButtonGroup label="Zoom">
					<ToolButton
						icon="zoom-out"
						label="Zoom out"
						shortcut="-"
						disabled={!ready || zoom <= DOCX_ZOOM_MIN}
						onClick={() => tools.zoomBy(-1)}
					/>
					<ToolReadout label="Zoom level" value={formatDocxZoom(zoom)} />
					<ToolButton
						icon="zoom-in"
						label="Zoom in"
						shortcut="+"
						disabled={!ready || zoom >= DOCX_ZOOM_MAX}
						onClick={() => tools.zoomBy(1)}
					/>
					<ToolButton
						icon="zoom-fit"
						label="Fit to width"
						shortcut="0"
						pressed={mode === "fit"}
						disabled={!ready}
						onClick={() => tools.fitWidth()}
					/>
					<ToolButton
						icon="page-single"
						label="Actual size"
						shortcut="1"
						pressed={mode !== "fit" && zoom === 1}
						disabled={!ready}
						onClick={() => tools.actualSize()}
					/>
				</ToolButtonGroup>
				{pages !== null
					? <ToolReadout value={pages === 1 ? "1 page shown" : `${pages} pages shown`} />
					: null}
			</ToolGroup>
			<ToolGroup title="Layout">
				{!tools.breakPages.value || (pages ?? 0) > 1
					? <ToolToggle label="Page breaks" value={tools.breakPages} disabled={!ready} />
					: null}
				{features?.headersFooters
					? (
						<ToolToggle
							label="Headers and footers"
							value={tools.headersFooters}
							disabled={!ready}
						/>
					)
					: null}
				{features?.notes
					? <ToolToggle label="Footnotes and endnotes" value={tools.notes} disabled={!ready} />
					: null}
				{features?.changes
					? <ToolToggle label="Tracked changes" value={tools.changes} disabled={!ready} />
					: null}
			</ToolGroup>
			{shell.options.print
				? (
					<div class="ins-docx-actions">
						<Button
							size="sm"
							variant="text"
							severity="secondary"
							icon={<Icon name="print" size="sm" />}
							label={printing ? "Preparing…" : "Print"}
							aria-keyshortcuts="Control+P"
							disabled={!ready || printing}
							onClick={() => tools.print()}
						/>
					</div>
				)
				: null}
		</>
	);
}
