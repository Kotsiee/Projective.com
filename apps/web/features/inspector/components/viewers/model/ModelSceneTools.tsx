import type { JSX } from "preact";
import { ToolChoice, ToolGroup, ToolSlider, ToolToggle } from "../../controls/mod.ts";
import type { ModelBackground, ModelEnvironment, ModelTools } from "./model-tools.ts";

const ENVIRONMENTS: readonly { value: ModelEnvironment; label: string }[] = [
	{ value: "room", label: "Room" },
	{ value: "neutral", label: "Neutral" },
	{ value: "none", label: "None" },
];

const BACKGROUNDS: readonly { value: ModelBackground; label: string }[] = [
	{ value: "theme", label: "Theme" },
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
	{ value: "transparent", label: "None" },
];

/** Lighting and environment: studio rig, the file's own lights, exposure, shadows, backdrop. */
export function ModelSceneTools({ tools }: { tools: ModelTools }): JSX.Element {
	const hasEnvironment = tools.environment.value !== "none";
	const environmentShown = hasEnvironment && tools.environmentBackground.value;
	return (
		<>
			<ToolGroup title="Lighting">
				<ToolToggle label="Studio lights" value={tools.studioLights} />
				{tools.modelLightCount.value > 0
					? <ToolToggle label="Lights in the file" value={tools.modelLights} />
					: null}
				{tools.studioLights.value ? <ToolToggle label="Shadows" value={tools.shadows} /> : null}
				<ToolSlider
					label="Exposure"
					value={tools.exposure}
					min={0.2}
					max={3}
					step={0.05}
					formatValue={(v) => v.toFixed(2)}
				/>
			</ToolGroup>
			<ToolGroup title="Environment">
				<ToolChoice label="Reflections" options={ENVIRONMENTS} value={tools.environment} />
				{hasEnvironment
					? <ToolToggle label="Show as background" value={tools.environmentBackground} />
					: null}
				{environmentShown
					? null
					: <ToolChoice label="Background" options={BACKGROUNDS} value={tools.background} />}
			</ToolGroup>
		</>
	);
}
