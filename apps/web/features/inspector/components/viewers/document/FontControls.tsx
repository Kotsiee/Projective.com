import type { JSX } from "preact";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	type ToolChoiceOption,
	ToolGroup,
	ToolSlider,
} from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import { type FontTools, SAMPLE_SIZE, type SamplePreset } from "./font-tools.ts";

const PRESETS: readonly ToolChoiceOption<SamplePreset>[] = [
	{ value: "pangram", label: "Pangram" },
	{ value: "alphabet", label: "A–z" },
	{ value: "numerals", label: "0–9" },
	{ value: "paragraph", label: "Text" },
];

/** The font canvas's panel controls: sample text preset and size. */
export function FontControls({ shell, tools }: ViewerProps<FontTools>): JSX.Element {
	const ready = shell.status.value === "ready";
	const size = tools.size.value;
	return (
		<ToolGroup title="Sample">
			<ToolChoice label="Sample text" options={PRESETS} value={tools.preset} disabled={!ready} />
			<ToolSlider
				label="Size"
				value={tools.size}
				min={SAMPLE_SIZE.min}
				max={SAMPLE_SIZE.max}
				formatValue={(v) => `${Math.round(v)} px`}
				disabled={!ready}
			/>
			<ToolButtonGroup label="Sample actions">
				<ToolButton
					icon="minus"
					label="Smaller sample"
					shortcut="-"
					disabled={!ready || size <= SAMPLE_SIZE.min}
					onClick={() => tools.resize(-1)}
				/>
				<ToolButton
					icon="plus"
					label="Larger sample"
					shortcut="+"
					disabled={!ready || size >= SAMPLE_SIZE.max}
					onClick={() => tools.resize(1)}
				/>
				<ToolButton
					icon="refresh"
					label="Reset sample text"
					disabled={!ready}
					onClick={() => tools.resetSample()}
				/>
			</ToolButtonGroup>
		</ToolGroup>
	);
}
