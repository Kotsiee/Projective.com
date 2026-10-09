import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Button, Slider } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { CROP_ZOOM_MAX, CROP_ZOOM_MIN, INITIAL_CROP } from "@projective/types/files";
import type { MediaPickState } from "../../hooks/use-media-pick.ts";
import { HoldStepButton } from "./HoldStepButton.tsx";
import { RotationRuler } from "./RotationRuler.tsx";
import { ScrubValue } from "./ScrubValue.tsx";

/**
 * CropControls — the bar beneath the crop stage: zoom (− slider + and a scrubbable readout), the
 * infinite rotation ruler (with its own scrubbable readout) and an icon-only Reset that restores
 * 1.0×, 0° and the centred picture. Always rendered, so the stage never shifts; every control is
 * disabled until a still is loaded.
 */
export interface CropControlsProps {
	state: MediaPickState;
	disabled: boolean;
}

/** Zoom per stepper press, and with Ctrl / Cmd held. */
const ZOOM_STEP = 0.1;
const ZOOM_STEP_FINE = 0.01;

export function CropControls({ state, disabled }: CropControlsProps): JSX.Element {
	const zoomCtl = useSignal(INITIAL_CROP.zoom);

	useSignalEffect(() => {
		const zoom = state.crop.value.zoom;
		if (zoomCtl.peek() !== zoom) zoomCtl.value = zoom;
	});

	const { zoom, rotation, cx, cy } = state.crop.value;
	const changed = zoom !== INITIAL_CROP.zoom || rotation !== INITIAL_CROP.rotation || cx !== 0 ||
		cy !== 0;

	function setZoom(next: number): number {
		state.update({ zoom: next });
		return state.crop.peek().zoom;
	}

	function stepZoom(sign: 1 | -1, fine: boolean): boolean {
		const before = state.crop.peek().zoom;
		const step = fine ? ZOOM_STEP_FINE : ZOOM_STEP;
		return setZoom(Math.round((before + sign * step) / step) * step) !== before;
	}

	function setRotation(next: number): number {
		state.update({ rotation: next });
		return state.crop.peek().rotation;
	}

	return (
		<div class="pf-media__controls" data-disabled={disabled ? "true" : undefined}>
			<div class="pf-media__row">
				<span class="pf-media__label">Zoom</span>
				<div class="pf-media__stepped">
					<HoldStepButton
						icon="minus"
						label="Zoom out"
						disabled={disabled || zoom <= CROP_ZOOM_MIN}
						onStep={(fine) => stepZoom(-1, fine)}
					/>
					<Slider
						size="sm"
						class="pf-media__slider"
						value={zoomCtl}
						min={CROP_ZOOM_MIN}
						max={CROP_ZOOM_MAX}
						step={0.01}
						disabled={disabled}
						aria-label="Zoom"
						formatValue={(v) => `${v.toFixed(2)}×`}
						onValueChange={(v) => {
							if (typeof v === "number") state.update({ zoom: v });
						}}
					/>
					<HoldStepButton
						icon="plus"
						label="Zoom in"
						disabled={disabled || zoom >= CROP_ZOOM_MAX}
						onStep={(fine) => stepZoom(1, fine)}
					/>
				</div>
				<ScrubValue
					value={zoom}
					step={0.01}
					fineStep={0.001}
					disabled={disabled}
					format={(v) => `${v.toFixed(2)}×`}
					onChange={setZoom}
				/>
			</div>
			<div class="pf-media__row">
				<span class="pf-media__label">Rotate</span>
				<RotationRuler
					value={rotation}
					disabled={disabled}
					onChange={(deg) => state.update({ rotation: deg })}
					onScrub={(active) => (state.adjusting.value = active)}
				/>
				<div class="pf-media__readout">
					<ScrubValue
						value={rotation}
						step={1}
						fineStep={0.1}
						disabled={disabled}
						format={(v) => `${Math.round(v)}°`}
						onChange={setRotation}
						onScrub={(active) => (state.adjusting.value = active)}
					/>
					<Tooltip content="Reset zoom, rotation and position">
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="pf-media__iconbtn ui-hit"
							icon={<Icon name="refresh" size="sm" />}
							aria-label="Reset zoom, rotation and position"
							disabled={disabled || !changed}
							onClick={() => state.reset()}
						/>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}
