import type { JSX } from "preact";
import {
	ToolButton,
	ToolButtonGroup,
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
import type { AudioTools } from "./media-tools.ts";

const formatPercent = (value: number): string => `${Math.round(value)}%`;

/** The audio canvas's panel controls: skipping, speed, loop, volume and mute. */
export function AudioControls({ tools }: ViewerProps<AudioTools>): JSX.Element {
	const ready = tools.element.value !== null;
	return (
		<>
			<ToolGroup title="Playback">
				<ToolButtonGroup label="Skip">
					<ToolButton
						icon="chevrons-left"
						label={`Back ${SKIP_SECONDS} seconds`}
						shortcut="J"
						disabled={!ready}
						onClick={() => tools.seekBy(-SKIP_SECONDS)}
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
			<ToolGroup title="Sound">
				<ToolSlider
					label="Volume"
					value={tools.volume}
					min={0}
					max={100}
					step={5}
					formatValue={formatPercent}
				/>
				<ToolToggle label="Mute" value={tools.muted} />
			</ToolGroup>
		</>
	);
}
