import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	ToolGroup,
	ToolSlider,
	ToolToggle,
} from "../../controls/mod.ts";
import {
	formatRate,
	RATE_MAX,
	RATE_MIN,
	RATE_STEP,
	SKIP_SECONDS,
} from "../../../core/media-model.ts";
import type { ViewerProps } from "../viewer.ts";
import type { VideoFit, VideoTools } from "./media-tools.ts";

const FIT_OPTIONS: readonly { value: VideoFit; label: string }[] = [
	{ value: "contain", label: "Fit" },
	{ value: "cover", label: "Fill" },
];

/** The video canvas's panel controls: stepping, speed, loop, picture size and orientation, capture. */
export function VideoControls({ tools }: ViewerProps<VideoTools>): JSX.Element {
	const ready = tools.video.value !== null;
	const pip = tools.pip.value;
	return (
		<>
			<ToolGroup title="Playback">
				<ToolButtonGroup label="Step through the video">
					<ToolButton
						icon="chevrons-left"
						label={`Back ${SKIP_SECONDS} seconds`}
						shortcut="J"
						disabled={!ready}
						onClick={() => tools.seekBy(-SKIP_SECONDS)}
					/>
					<ToolButton
						icon="chevron-left"
						label="Previous frame"
						shortcut=","
						disabled={!ready}
						onClick={() => tools.stepFrame(-1)}
					/>
					<ToolButton
						icon="chevron-right"
						label="Next frame"
						shortcut="."
						disabled={!ready}
						onClick={() => tools.stepFrame(1)}
					/>
					<ToolButton
						icon="chevrons-right"
						label={`Forward ${SKIP_SECONDS} seconds`}
						shortcut="L"
						disabled={!ready}
						onClick={() => tools.seekBy(SKIP_SECONDS)}
					/>
				</ToolButtonGroup>
				<ToolSlider
					label="Speed"
					value={tools.speed}
					min={RATE_MIN}
					max={RATE_MAX}
					step={RATE_STEP}
					formatValue={formatRate}
				/>
				<ToolToggle label="Loop" value={tools.loop} />
			</ToolGroup>
			<ToolGroup title="Picture">
				<ToolChoice label="Size" options={FIT_OPTIONS} value={tools.fit} />
				<ToolButtonGroup label="Orientation">
					<ToolButton
						icon="rotate-ccw"
						label="Rotate anticlockwise"
						shortcut="Shift+R"
						onClick={() => tools.rotate(-1)}
					/>
					<ToolButton
						icon="rotate-cw"
						label="Rotate clockwise"
						shortcut="R"
						onClick={() => tools.rotate(1)}
					/>
					<ToolButton
						icon="flip-horizontal"
						label="Flip horizontally"
						shortcut="H"
						pressed={tools.flipped.value}
						onClick={() => tools.toggleFlip()}
					/>
				</ToolButtonGroup>
				<div class="ins-media-actions">
					{tools.pipSupported.value
						? (
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								icon={<Icon name="video" size="sm" />}
								label={pip ? "Exit picture in picture" : "Picture in picture"}
								aria-pressed={pip}
								onClick={() => tools.togglePip()}
							/>
						)
						: null}
					<Button
						size="sm"
						variant="text"
						severity="secondary"
						icon={<Icon name="image" size="sm" />}
						label="Save frame as PNG"
						disabled={!tools.hasFrame.value}
						onClick={() => tools.saveFrame()}
					/>
				</div>
			</ToolGroup>
		</>
	);
}
