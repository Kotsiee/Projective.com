import type { JSX } from "preact";
import { Button, Select } from "@projective/ui/fields";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	ToolGroup,
	ToolSlider,
	ToolToggle,
} from "../../controls/mod.ts";
import { VIEW_PRESETS } from "../../../core/model-camera.ts";
import { FREE_ORBIT, type ModelProjection, type ModelTools } from "./model-tools.ts";

const PROJECTIONS: readonly { value: ModelProjection; label: string }[] = [
	{ value: "perspective", label: "Perspective" },
	{ value: "orthographic", label: "Orthographic" },
];

/** Camera and navigation: projection, named views, framing, field of view, built-in cameras. */
export function ModelCameraTools({ tools }: { tools: ModelTools }): JSX.Element {
	const cameras = tools.cameras.value;
	const free = tools.camera.value === FREE_ORBIT;
	const perspective = tools.projection.value === "perspective";
	const reduced = tools.reducedMotion.value;
	const cameraOptions = [
		{ value: FREE_ORBIT, label: "Free orbit" },
		...cameras.map((c) => ({ value: c.value, label: c.label })),
	];

	return (
		<>
			<ToolGroup title="Camera">
				<ToolChoice label="Projection" options={PROJECTIONS} value={tools.projection} />
				<div class="ins-model-views" role="group" aria-label="Views">
					{VIEW_PRESETS.map((preset) => (
						<Button
							key={preset.id}
							size="sm"
							variant="text"
							severity="secondary"
							class="ins-model-views__view"
							label={preset.label}
							aria-keyshortcuts={preset.key}
							onClick={() => tools.view(preset.id)}
						/>
					))}
				</div>
				<ToolButtonGroup label="Framing">
					<ToolButton
						icon="zoom-fit"
						label="Frame model"
						shortcut="0"
						onClick={() => tools.frame()}
					/>
					<ToolButton
						icon="refresh"
						label="Reset view"
						shortcut="R"
						onClick={() => tools.reset()}
					/>
				</ToolButtonGroup>
				{perspective && free
					? (
						<ToolSlider
							label="Field of view"
							value={tools.fov}
							min={15}
							max={90}
							step={1}
							formatValue={(v) => `${Math.round(v)}°`}
						/>
					)
					: null}
				{cameras.length > 0
					? (
						<div class="ins-model-field">
							<span class="ins-model-field__label" aria-hidden="true">Look through</span>
							<Select
								size="sm"
								fluid
								aria-label="Look through camera"
								options={cameraOptions}
								value={tools.camera}
							/>
						</div>
					)
					: null}
			</ToolGroup>
			<ToolGroup title="Navigation">
				<p class="ins-model-hint">
					Drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom
				</p>
				{reduced || !free ? null : <ToolToggle label="Auto-rotate" value={tools.autoRotate} />}
			</ToolGroup>
		</>
	);
}
