import type { JSX } from "preact";
import { Button, InputText } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { MediaPickConfig } from "../../core/media/media-pick.ts";
import type { MediaPickState } from "../../hooks/use-media-pick.ts";
import { CropControls } from "./CropControls.tsx";
import { CropStage, stageRatioFor } from "./CropStage.tsx";

/**
 * MediaCropWorkspace — the File Picker's Crop & Adjust stage: the fixed-size stage (a drop zone
 * until a source is chosen), ghost chevrons that cycle circularly through several choices, the
 * controls bar beneath it, and — for a showcase slot — the alternative text. A chosen video is
 * previewed in the stage's place; videos are published as uploaded, so the controls stay disabled.
 */
export interface MediaCropWorkspaceProps {
	config: MediaPickConfig;
	state: MediaPickState;
	/** Open the device file chooser. */
	onBrowse: () => void;
}

export function MediaCropWorkspace(
	{ config, state, onBrowse }: MediaCropWorkspaceProps,
): JSX.Element {
	const pick = state.candidate.value;
	const still = pick?.kind === "image" ? pick : null;
	const count = state.items.value.length;
	const carousel = pick !== null && count > 1;

	const stage = pick?.kind === "video"
		? (
			<div
				class={`pf-media__stage pf-media__stage--${config.target} pf-media__stage--video`}
				style={`--pf-stage-ratio:${stageRatioFor(config.target)}`}
			>
				<video
					key={pick.id}
					class="pf-media__videoel"
					src={pick.src}
					poster={pick.poster ?? undefined}
					controls
					muted
					playsInline
					preload="metadata"
				/>
			</div>
		)
		: (
			<CropStage
				key={pick?.id ?? "empty"}
				target={config.target}
				image={still}
				crop={state.crop}
				onChange={state.update}
				label={config.title}
				onFiles={(files) => void state.stageFiles(Array.from(files))}
				onBrowse={onBrowse}
				emptyTitle={config.max > 1
					? `Add up to ${config.max} pictures${config.allowVideo ? " or videos" : ""}`
					: config.allowVideo
					? "Add a picture or a video"
					: "Add a picture"}
				status={state.status.value}
				adjusting={state.adjusting.value}
			/>
		);

	return (
		<div class="pf-media" data-target={config.target}>
			<div class="pf-media__canvas" data-multi={carousel ? "true" : undefined}>
				<div class="pf-media__frame">
					{carousel && <NavButton dir={-1} state={state} />}
					{stage}
					{carousel && <NavButton dir={1} state={state} />}
				</div>
			</div>
			<p class="pf-media__hint">
				{pick?.kind === "video"
					? "Videos are shown as uploaded — no cropping."
					: still
					? `${carousel ? `${state.active.value + 1} of ${count} · ` : ""}Drag to move · ` +
						"Ctrl + scroll to zoom · two fingers to pinch and turn"
					: "Drop pictures on the frame, or choose them from your library."}
			</p>
			<CropControls state={state} disabled={!still} />
			{config.target === "showcase" && pick && (
				<label class="pf-media__alt">
					<span class="pf-media__label">Description</span>
					<InputText
						value={state.alt}
						maxLength={200}
						placeholder="What does this show? (for people who can't see it)"
						fluid
						size="sm"
						onValueChange={(v) => (state.alt.value = v)}
					/>
				</label>
			)}
			{state.error.value && <p class="pf-media__error" role="alert">{state.error.value}</p>}
		</div>
	);
}

function NavButton({ dir, state }: { dir: 1 | -1; state: MediaPickState }): JSX.Element {
	const label = dir < 0 ? "Previous picture" : "Next picture";
	return (
		<Tooltip content={label}>
			<Button
				iconOnly
				rounded
				size="sm"
				variant="text"
				severity="secondary"
				class="pf-media__iconbtn pf-media__nav ui-hit"
				icon={<Icon name={dir < 0 ? "chevron-left" : "chevron-right"} size="sm" />}
				aria-label={label}
				onClick={() => state.step(dir)}
			/>
		</Tooltip>
	);
}
