/**
 * @projective/ui/layout — structural primitives (DESIGN_SYSTEM.md §C.1).
 *
 * Box · Container · Grid · Row · Column · Stack · AspectRatio · Divider · Separator.
 *
 * Zero client JS: pure server components. Styling is Pure CSS + BEM, token-only — components pass
 * `--*` token references as inline custom properties; the co-located `styles/*.css` files hold the
 * real declarations. Full four-sided borders are reserved for interactive elements (§B.4); Divider is
 * the single-hairline separator. Shared helpers/types live in the package `core/` and `types/`.
 */
export { Box, type BoxProps, type RadiusToken, type SurfaceLevel } from "./components/Box.tsx";
export { Container, type ContainerProps, type ContainerSize } from "./components/Container.tsx";
export { Grid, type GridPlacement, type GridProps } from "./components/Grid.tsx";
export { Stack, type StackDirection, type StackProps } from "./components/Stack.tsx";
export { Row } from "./components/Row.tsx";
export { Column } from "./components/Column.tsx";
export {
	AspectRatio,
	type AspectRatioPreset,
	type AspectRatioProps,
} from "./components/AspectRatio.tsx";
export { Divider, type DividerProps, type Orientation } from "./components/Divider.tsx";
export { Separator } from "./components/Separator.tsx";

// #region Panels & containers (PrimeNG parity)
export { Panel, type PanelProps } from "./islands/Panel.tsx";
export { Fieldset, type FieldsetProps } from "./islands/Fieldset.tsx";
export { Toolbar, type ToolbarOrientation, type ToolbarProps } from "./components/Toolbar.tsx";
export { ScrollPanel, type ScrollPanelProps } from "./islands/ScrollPanel.tsx";
export {
	Splitter,
	type SplitterLayout,
	SplitterPanel,
	type SplitterPanelProps,
	type SplitterProps,
} from "./islands/Splitter.tsx";
export {
	Stepper,
	type StepperOrientation,
	StepperPanel,
	type StepperPanelProps,
	type StepperProps,
	type StepperRenderContext,
} from "./islands/Stepper.tsx";
export {
	MeterGroup,
	type MeterGroupOrientation,
	type MeterGroupProps,
	type MeterItem,
} from "./components/MeterGroup.tsx";
// #endregion
