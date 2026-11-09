import type { JSX, Ref } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { TabStrip } from "@projective/ui/navigation";
import {
	choosePanelTab,
	PANEL_TABS,
	panelTab,
	restorePanelTab,
	tabWithin,
} from "@features/inspector/core/panel-tab.ts";
import { Button, ResizeFrame } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import {
	InspectorEmbedControls,
	InspectorEmbedFacts,
} from "@features/inspector/components/embed/mod.ts";
import type { InspectorHost } from "@features/inspector/components/embed/mod.ts";
import { Fact } from "@features/inspector/components/panel/facts.tsx";
import { ShortcutsDisclosure } from "@features/inspector/components/panel/ShortcutsDisclosure.tsx";
import type { ViewerShortcut } from "@features/inspector/components/viewers/viewer.ts";
import { type AssetItem, sourceLabel, visibilityLabel } from "../../types/projects-types.ts";
import { fileDateLabel, kindLabel } from "../../core/file-model.ts";
import type { SourcePaint } from "./preview-model.ts";
import { SourceMessage } from "./SourceMessage.tsx";

/** The review-notes state a Submissions preview carries for the open file. */
export interface PreviewNotesState {
	draft: Signal<string>;
	saved: readonly string[];
	onSave: () => void;
}

/** Props for {@link PreviewAside}. */
export interface PreviewAsideProps {
	file: AssetItem;
	/** The inspector for the file, once its DTO has loaded; null for the row's own facts. */
	host: InspectorHost | null;
	source: SourcePaint | null;
	onGoToMessage?: () => void;
	notes: PreviewNotesState | null;
	shortcuts: readonly ViewerShortcut[];
	shortcutsOpen: Signal<boolean>;
}

function RowFacts({ file }: { file: AssetItem }): JSX.Element {
	const ext = file.ext.trim().toUpperCase();
	const posted = file.messageId !== null && file.sender !== null;
	return (
		<dl class="ins-facts">
			<Fact label="Type">{ext ? `${kindLabel(file.kind)} · ${ext}` : kindLabel(file.kind)}</Fact>
			{file.sizeBytes > 0 ? <Fact label="Size">{file.sizeLabel}</Fact> : null}
			{file.width !== null && file.height !== null
				? <Fact label="Dimensions">{`${file.width} × ${file.height} px`}</Fact>
				: null}
			{file.durationLabel ? <Fact label="Duration">{file.durationLabel}</Fact> : null}
			<Fact label={posted ? "Shared" : "Added"}>
				<time class="ins-facts__text" dateTime={file.createdAt}>{fileDateLabel(file)}</time>
			</Fact>
			{posted ? null : (
				<>
					<Fact label="Location">
						{file.folderPath.length > 0 ? file.folderPath.join(" / ") : "Library root"}
					</Fact>
					<Fact label="Source">{sourceLabel(file.source)}</Fact>
					<Fact label="Visibility">{visibilityLabel(file.visibility)}</Fact>
				</>
			)}
		</dl>
	);
}

function Notes({ notes }: { notes: PreviewNotesState }): JSX.Element {
	const fieldId = useId(undefined, "fx-note");
	const { draft, saved, onSave } = notes;
	return (
		<section class="fx-aside__section fx-notes" aria-labelledby={`${fieldId}-title`}>
			<h3 id={`${fieldId}-title`} class="fx-aside__title">Notes for review</h3>
			{saved.length > 0
				? (
					<ul class="fx-notes__list">
						{saved.map((note, i) => <li key={i} class="fx-notes__item">{note}</li>)}
					</ul>
				)
				: null}
			<label class="ui-visually-hidden" for={fieldId}>Note for the upcoming review</label>
			<ResizeFrame>
				<textarea
					id={fieldId}
					class="fx-notes__input"
					rows={3}
					placeholder="Leave a note for the upcoming review…"
					value={draft.value}
					onInput={(e) => (draft.value = e.currentTarget.value)}
					onKeyDown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
							e.preventDefault();
							onSave();
						}
					}}
				/>
			</ResizeFrame>
			<div class="fx-notes__actions">
				<Button
					size="sm"
					severity="primary"
					label="Save note"
					aria-keyshortcuts="Control+Enter"
					disabled={draft.value.trim().length === 0}
					onClick={onSave}
				/>
			</div>
		</section>
	);
}

/**
 * The preview's side panel (a bottom sheet on mobile), two tabs (Decision #400): View (the canvas's
 * own controls and the keyboard shortcuts) and Details (the file's facts, the message it was shared
 * in, and review notes on Submissions). The tab is the inspector's remembered one (`panel-tab.ts`).
 */
export function PreviewAside(props: PreviewAsideProps): JSX.Element {
	const { file, host, source, onGoToMessage, notes, shortcuts, shortcutsOpen } = props;
	const ids = useId(undefined, "fx-aside");
	const shortcutsRef: Ref<HTMLElement> = useRef<HTMLElement>(null);
	const controls = host && host.viewer.Controls && host.shell.status.value !== "error"
		? <InspectorEmbedControls key={host.shell.asset.id} host={host} />
		: null;
	const panel = `${ids}-panel`;
	const tab = tabWithin(panelTab.value, PANEL_TABS);
	useEffect(() => restorePanelTab(), []);
	return (
		<div class="fx-aside">
			<TabStrip
				label="File panel"
				tone="lane"
				items={PANEL_TABS}
				activeKey={tab}
				onSelect={choosePanelTab}
				panelId={panel}
			/>
			<div
				id={panel}
				class="fx-aside__body"
				role="tabpanel"
				aria-labelledby={`${panel}-tab-${tab}`}
			>
				{tab === "view"
					? (
						<>
							{controls ? <section class="fx-aside__section">{controls}</section> : null}
							<div class="fx-aside__section">
								<ShortcutsDisclosure
									shortcuts={shortcuts}
									open={shortcutsOpen}
									summaryRef={shortcutsRef}
								/>
							</div>
						</>
					)
					: (
						<>
							<section class="fx-aside__section" aria-labelledby={`${ids}-details`}>
								<h3 id={`${ids}-details`} class="fx-aside__title">Details</h3>
								{host ? <InspectorEmbedFacts host={host} /> : <RowFacts file={file} />}
							</section>
							{source
								? <SourceMessage source={source} titleId={`${ids}-source`} onGo={onGoToMessage} />
								: null}
							{notes ? <Notes notes={notes} /> : null}
						</>
					)}
			</div>
		</div>
	);
}
