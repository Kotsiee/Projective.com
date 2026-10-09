import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Slider } from "@projective/ui/fields";
import { dsConfig } from "@projective/ui/system";
import {
	DEV_THEME_RANGES,
	devThemeKnobs,
	type DevThemeScaleKey,
	isDevThemeDefault,
	patchDevTheme,
	resetDevTheme,
} from "../core/dev-theme.ts";

type ColourKey = "seed" | "accentSeed";

function ColourRow(props: { knob: ColourKey; label: string; value: string }): JSX.Element {
	const id = `dev-theme-${props.knob}`;
	return (
		<div class="dev-ctx__field">
			<div class="dev-ctx__label">
				<label for={id}>{props.label}</label>
				<output for={id} class="dev-ctx__value">{props.value.toUpperCase()}</output>
			</div>
			<input
				id={id}
				type="color"
				class="dev-ctx__swatch"
				value={props.value.toLowerCase()}
				onInput={(e) => patchDevTheme({ [props.knob]: e.currentTarget.value })}
			/>
		</div>
	);
}

function ScaleRow(props: { knob: DevThemeScaleKey; label: string }): JSX.Element {
	const range = DEV_THEME_RANGES[props.knob];
	const value = useSignal(dsConfig.peek()[props.knob]);
	useSignalEffect(() => {
		value.value = dsConfig.value[props.knob];
	});
	return (
		<div class="dev-ctx__field">
			<div class="dev-ctx__label">
				<span>{props.label}</span>
				<span class="dev-ctx__value" aria-hidden="true">{value.value.toFixed(2)}×</span>
			</div>
			<Slider
				size="sm"
				value={value}
				min={range.min}
				max={range.max}
				step={range.step}
				aria-label={props.label}
				formatValue={(v) => `${v.toFixed(2)}×`}
				onValueChange={(v) => {
					if (typeof v === "number") patchDevTheme({ [props.knob]: v });
				}}
			/>
		</div>
	);
}

/**
 * DevThemeControls — the Context Switcher's Theme group: live brand and accent seeds, radius scale
 * and shadow intensity, each written through `updateConfig`, plus a Reset to `DEFAULT_CONFIG`.
 * Independent of the simulation master switch.
 */
export function DevThemeControls(): JSX.Element {
	const knobs = devThemeKnobs();
	return (
		<div class="dev-ctx__group">
			<div class="dev-ctx__grouphead">Theme</div>
			<ColourRow knob="seed" label="Primary seed" value={knobs.seed} />
			<ColourRow knob="accentSeed" label="Accent seed" value={knobs.accentSeed} />
			<ScaleRow knob="radiusScale" label="Radius scale" />
			<ScaleRow knob="shadowIntensity" label="Shadow intensity" />
			<div class="dev-ctx__actions">
				<button
					type="button"
					class="dev-ctx__reset"
					disabled={isDevThemeDefault(knobs)}
					onClick={resetDevTheme}
				>
					Reset theme
				</button>
			</div>
		</div>
	);
}
