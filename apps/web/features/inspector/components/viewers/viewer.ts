import { type FunctionComponent, h } from "preact";
import type { InspectorShell } from "../../core/inspector-shell.ts";

// #region Contract
/** Props every viewer component receives: the shell and the viewer's own tool state. */
export interface ViewerProps<T> {
	shell: InspectorShell;
	tools: T;
}

/** One keyboard shortcut a canvas honours, listed in the panel. */
export interface ViewerShortcut {
	keys: string[];
	label: string;
}

/**
 * A canvas for one family of files.
 *
 * `createTools` runs once per workspace and returns the viewer's signal state; `Stage` draws the
 * file, `Controls` (rendered in the panel's View section) drives it through the same `tools`, and
 * `Chips` is the compact on-canvas bar an embedding host floats over the stage.
 */
export interface ViewerDefinition<T> {
	createTools(shell: InspectorShell): T;
	Stage: FunctionComponent<ViewerProps<T>>;
	Controls: FunctionComponent<ViewerProps<T>> | null;
	/** Compact on-canvas controls for an embedding host; omit when the canvas has none. */
	Chips?: FunctionComponent<ViewerProps<T>> | null;
	/** Keyboard shortcuts this canvas honours, listed in the panel; a function may drop gated ones. */
	shortcuts: readonly ViewerShortcut[] | ((shell: InspectorShell) => readonly ViewerShortcut[]);
}

/** A viewer bound to one shell: prop-less components the workspace renders as-is. */
export interface MountedViewer {
	Stage: FunctionComponent;
	Controls: FunctionComponent | null;
	Chips: FunctionComponent | null;
	shortcuts: readonly ViewerShortcut[];
}
// #endregion

/**
 * Declare a viewer. The returned mount function creates the tools once and binds `Stage`/`Controls`
 * /`Chips` to them; call it once per workspace so the component identities stay stable across renders.
 */
export function defineViewer<T>(
	def: ViewerDefinition<T>,
): (shell: InspectorShell) => MountedViewer {
	return (shell: InspectorShell): MountedViewer => {
		const tools = def.createTools(shell);
		const Stage: FunctionComponent = () => h(def.Stage, { shell, tools });
		const DefControls = def.Controls;
		const Controls: FunctionComponent | null = DefControls
			? () => h(DefControls, { shell, tools })
			: null;
		const DefChips = def.Chips ?? null;
		const Chips: FunctionComponent | null = DefChips ? () => h(DefChips, { shell, tools }) : null;
		const shortcuts = typeof def.shortcuts === "function" ? def.shortcuts(shell) : def.shortcuts;
		return { Stage, Controls, Chips, shortcuts };
	};
}

/** The shortcuts a canvas offers once printing is gated: without the print command when it is off. */
export function printGated(
	shell: InspectorShell,
	shortcuts: readonly ViewerShortcut[],
): readonly ViewerShortcut[] {
	return shell.options.print ? shortcuts : shortcuts.filter((s) => s.label !== "Print");
}
