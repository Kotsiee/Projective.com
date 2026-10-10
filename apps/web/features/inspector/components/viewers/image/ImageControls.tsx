import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	type ToolChoiceOption,
	ToolGroup,
	ToolReadout,
	ToolSlider,
	ToolToggle,
} from "../../controls/mod.ts";
import {
	isFitted,
	quarterTurn,
	sliderPosition,
	sliderZoom,
	VIEWPORT_IDENTITY,
	ZOOM_SLIDER_STEPS,
	zoomPercent,
} from "../../../core/viewport.ts";
import type { ViewerProps } from "../viewer.ts";
import type { ImageBackground, ImageTools } from "./image-tools.ts";

const BACKGROUNDS: readonly ToolChoiceOption<ImageBackground>[] = [
	{ value: "checker", label: "Checker" },
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
];

/** The image canvas's panel controls: zoom, orientation, background and the rule-of-thirds guide. */
export function ImageControls({ tools }: ViewerProps<ImageTools>): JSX.Element {
	const ready = tools.ready.value;
	const view = tools.view.value;
	const limits = tools.limits.value;
	const fitZoom = tools.fitZoom.value;
	const fitted = isFitted(view, fitZoom);
	const actual = Math.abs(view.zoom - 1) < 1e-4;
	const turn = quarterTurn(view.rotation);
	const pristine = fitted && turn === 0 && view.flipX === VIEWPORT_IDENTITY.flipX &&
		view.flipY === VIEWPORT_IDENTITY.flipY;

	return (
		<>
			<ToolGroup title="Zoom">
				<div class="ins-image-tools__zoom">
					<ToolButtonGroup label="Zoom">
						<ToolButton
							icon="zoom-out"
							label="Zoom out"
							shortcut="-"
							disabled={!ready || view.zoom <= limits.min * 1.0001}
							onClick={() => tools.zoomStep(-1)}
						/>
						<ToolButton
							icon="zoom-in"
							label="Zoom in"
							shortcut="+"
							disabled={!ready || view.zoom >= limits.max * 0.9999}
							onClick={() => tools.zoomStep(1)}
						/>
					</ToolButtonGroup>
					<ToolReadout value={zoomPercent(view.zoom)} label="Zoom" />
				</div>
				<ToolSlider
					label="Zoom level"
					value={tools.zoomSlider}
					min={0}
					max={ZOOM_SLIDER_STEPS}
					step={1}
					formatValue={(position) =>
						zoomPercent(
							position === sliderPosition(view.zoom, limits)
								? view.zoom
								: sliderZoom(position, limits),
						)}
					disabled={!ready}
				/>
				<div class="ins-image-tools__presets" role="group" aria-label="Zoom presets">
					<Button
						size="sm"
						variant="text"
						severity="secondary"
						icon={<Icon name="zoom-fit" size="sm" />}
						class="ins-image-tools__preset"
						label="Fit"
						aria-label="Fit to screen"
						aria-keyshortcuts="0"
						aria-pressed={fitted}
						disabled={!ready}
						onClick={tools.fitToStage}
					/>
					<Button
						size="sm"
						variant="text"
						severity="secondary"
						class="ins-image-tools__preset"
						label="100%"
						aria-label="Actual size"
						aria-keyshortcuts="1"
						aria-pressed={actual}
						disabled={!ready}
						onClick={() => tools.actualSize()}
					/>
				</div>
			</ToolGroup>
			<ToolGroup title="Orientation">
				<div class="ins-image-tools__zoom">
					<ToolButtonGroup label="Rotate and flip">
						<ToolButton
							icon="rotate-ccw"
							label="Rotate left"
							shortcut="Shift+R"
							disabled={!ready}
							onClick={() => tools.rotate(-1)}
						/>
						<ToolButton
							icon="rotate-cw"
							label="Rotate right"
							shortcut="R"
							disabled={!ready}
							onClick={() => tools.rotate(1)}
						/>
						<ToolButton
							icon="flip-horizontal"
							label="Flip horizontally"
							shortcut="H"
							pressed={view.flipX}
							disabled={!ready}
							onClick={() => tools.flipAxis("horizontal")}
						/>
						<ToolButton
							icon="flip-vertical"
							label="Flip vertically"
							shortcut="V"
							pressed={view.flipY}
							disabled={!ready}
							onClick={() => tools.flipAxis("vertical")}
						/>
					</ToolButtonGroup>
					<ToolReadout value={`${turn}°`} label="Rotation" />
				</div>
				<div class="ins-image-tools__presets">
					<Button
						size="sm"
						variant="text"
						severity="secondary"
						icon={<Icon name="refresh" size="sm" />}
						label="Reset view"
						disabled={!ready || pristine}
						onClick={tools.reset}
					/>
				</div>
			</ToolGroup>
			<ToolGroup title="Canvas">
				<ToolChoice label="Background" options={BACKGROUNDS} value={tools.background} />
				<ToolToggle label="Rule of thirds" value={tools.grid} disabled={!ready} />
			</ToolGroup>
		</>
	);
}
