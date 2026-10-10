import type { JSX, RefObject } from "preact";
import { Button } from "@projective/ui/fields";
import { Loader } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	InspectorChipBar,
	InspectorEmbedStage,
	type InspectorHost,
} from "@features/inspector/components/embed/mod.ts";
import type { AssetItem } from "../../types/projects-types.ts";
import { FilePreview } from "../FilePreview.tsx";
import type { InspectLoad } from "./use-preview-data.ts";
import { PreviewAction } from "./PreviewAction.tsx";

/** Props for {@link PreviewStage}. */
export interface PreviewStageProps {
	file: AssetItem;
	/** The inspector for the file once its DTO has loaded; null draws the row's own preview. */
	host: InspectorHost | null;
	/** The DTO read for a stored file; null for a row with no stored bytes. */
	load: InspectLoad | null;
	onRetry: () => void;
	stageRef: RefObject<HTMLDivElement>;
	/** The floating Info control that opens the details sheet (mobile); null hides it. */
	info: { open: boolean; controls: string; onOpen: () => void } | null;
}

function Unavailable(
	{ title, reason, onRetry }: { title: string; reason: string; onRetry?: () => void },
): JSX.Element {
	return (
		<div class="fx-modal__fault" role="status">
			<span class="fx-modal__faultglyph" aria-hidden="true">
				<Icon name="eye-off" size="xl" />
			</span>
			<p class="fx-modal__faulttitle">{title}</p>
			<p class="fx-modal__faultreason">{reason}</p>
			{onRetry
				? (
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						icon={<Icon name="refresh" size="sm" />}
						label="Try again"
						onClick={onRetry}
					/>
				)
				: null}
		</div>
	);
}

/**
 * The canvas: the inspector's viewer for a stored file (with its on-canvas chips), a loader while
 * its DTO arrives, an honest fault when it cannot, and the row's own preview for everything else.
 */
export function PreviewStage(props: PreviewStageProps): JSX.Element {
	const { file, host, load, onRetry, stageRef, info } = props;
	let body: JSX.Element;
	let legacy = false;
	if (host) {
		body = (
			<InspectorEmbedStage key={host.shell.asset.id} host={host} class="fx-modal__canvas">
				<InspectorChipBar host={host} />
			</InspectorEmbedStage>
		);
	} else if (load?.status === "loading") {
		body = (
			<div class="fx-modal__wait">
				<Loader label="Loading preview…" />
			</div>
		);
	} else if (load?.status === "missing") {
		body = (
			<Unavailable
				title="This file isn't available"
				reason="It may have been removed, or you no longer have access to it."
			/>
		);
	} else if (load?.status === "error") {
		body = <Unavailable title="The preview didn't load" reason={load.message} onRetry={onRetry} />;
	} else {
		legacy = true;
		body = (
			<div class="fx-modal__legacy">
				<FilePreview file={file} active />
			</div>
		);
	}

	return (
		<div
			ref={stageRef}
			class="fx-modal__stage"
			tabIndex={-1}
			role={legacy ? "group" : undefined}
			aria-label={legacy ? `${file.name} preview` : undefined}
		>
			{body}
			{info
				? (
					<div class="fx-modal__info">
						<PreviewAction
							icon="info"
							label="File details"
							class="fx-modal__infobtn"
							controls={info.controls}
							expanded={info.open}
							onClick={info.onOpen}
						/>
					</div>
				)
				: null}
		</div>
	);
}
