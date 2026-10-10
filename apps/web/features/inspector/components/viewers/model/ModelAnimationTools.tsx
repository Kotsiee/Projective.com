import type { JSX } from "preact";
import { Select } from "@projective/ui/fields";
import { ToolButton, ToolGroup, ToolReadout, ToolRow, ToolSlider } from "../../controls/mod.ts";
import { formatClipTime } from "../../../core/model-scene.ts";
import type { ModelTools } from "./model-tools.ts";

/** Animation clips: pick one, play or pause it, change its speed and scrub through it. */
export function ModelAnimationTools({ tools }: { tools: ModelTools }): JSX.Element | null {
	const clips = tools.clips.value;
	if (clips.length === 0) return null;
	const playing = tools.playing.value;
	const duration = tools.duration.value;
	const current = clips.find((c) => c.value === tools.clip.value) ?? null;
	return (
		<ToolGroup title="Animation">
			{clips.length > 1
				? (
					<div class="ins-model-field">
						<span class="ins-model-field__label" aria-hidden="true">Clip</span>
						<Select
							size="sm"
							fluid
							aria-label="Animation clip"
							options={[...clips]}
							value={tools.clip}
						/>
					</div>
				)
				: (
					<ToolRow label="Clip">
						<ToolReadout value={current?.label ?? ""} />
					</ToolRow>
				)}
			<ToolRow label={playing ? "Playing" : "Paused"}>
				<ToolButton
					icon={playing ? "pause" : "play"}
					label={playing ? "Pause" : "Play"}
					shortcut="Space"
					pressed={playing}
					onClick={() => (tools.playing.value = !tools.playing.peek())}
				/>
			</ToolRow>
			{duration > 0
				? (
					<ToolSlider
						label="Time"
						value={tools.time}
						min={0}
						max={duration}
						step={Math.min(0.01, duration / 100)}
						formatValue={formatClipTime}
					/>
				)
				: null}
			<ToolSlider
				label="Speed"
				value={tools.speed}
				min={0.1}
				max={2}
				step={0.05}
				formatValue={(v) => `${v.toFixed(2)}×`}
			/>
		</ToolGroup>
	);
}
