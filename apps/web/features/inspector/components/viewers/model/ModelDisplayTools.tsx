import type { JSX } from "preact";
import {
	ToolButton,
	ToolButtonGroup,
	ToolChoice,
	ToolGroup,
	ToolReadout,
	ToolRow,
} from "../../controls/mod.ts";
import type { ModelShading, ModelTools } from "./model-tools.ts";

const SHADINGS: readonly { value: ModelShading; label: string }[] = [
	{ value: "standard", label: "Materials" },
	{ value: "clay", label: "Clay" },
	{ value: "normals", label: "Normals" },
];

/** Display: shading mode, wireframe and the grid, axes and bounding-box helpers, plus the size readout. */
export function ModelDisplayTools({ tools }: { tools: ModelTools }): JSX.Element {
	const dimensions = tools.dimensions.value;
	return (
		<ToolGroup title="Display">
			<ToolChoice label="Shading" options={SHADINGS} value={tools.shading} />
			<ToolButtonGroup label="Overlays">
				<ToolButton
					icon="wireframe"
					label="Wireframe"
					shortcut="W"
					pressed={tools.wireframe.value}
					onClick={() => (tools.wireframe.value = !tools.wireframe.peek())}
				/>
				<ToolButton
					icon="grid-floor"
					label="Grid floor"
					shortcut="G"
					pressed={tools.grid.value}
					onClick={() => (tools.grid.value = !tools.grid.peek())}
				/>
				<ToolButton
					icon="axes-3d"
					label="Axes"
					pressed={tools.axes.value}
					onClick={() => (tools.axes.value = !tools.axes.peek())}
				/>
				<ToolButton
					icon="cube-3d"
					label="Bounding box"
					pressed={tools.bounds.value}
					onClick={() => (tools.bounds.value = !tools.bounds.peek())}
				/>
			</ToolButtonGroup>
			{dimensions
				? (
					<ToolRow label="Size">
						<ToolReadout value={dimensions} label="Bounding size" />
					</ToolRow>
				)
				: null}
		</ToolGroup>
	);
}
