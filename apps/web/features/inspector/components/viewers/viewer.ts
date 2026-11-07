import { type FunctionComponent, h } from "preact";
import type { MenuItem } from "@projective/ui/navigation";
import type { InspectorShell } from "../../core/inspector-shell.ts";
import type { InspectorActions } from "../InspectorContext.ts";

// #region Contract
/** Props every viewer component receives: the shell and the viewer's own tool state. */
export interface ViewerProps<T> {
	shell: InspectorShell;
	tools: T;
}

/** What a canvas's menu rows may reach when the menu opens. */
export interface StageMenuContext {
	/** The canvas region the menu opened on. */
	stage: HTMLElement | null;
	actions: InspectorActions;
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
	/**
	 * The canvas's own rows of its right-click menu, built when the menu opens, so a label may name
	 * the state it changes (Decision #400). The rows every file has are `StageMenu`'s.
	 */
	menu?: (props: ViewerProps<T> & StageMenuContext) => MenuItem[];
}

/** A viewer bound to one shell: prop-less components the workspace renders as-is. */
export interface MountedViewer {
	Stage: FunctionComponent;
	Controls: FunctionComponent | null;
	Chips: FunctionComponent | null;
	shortcuts: readonly ViewerShortcut[];
	menu: ((context: StageMenuContext) => MenuItem[]) | null;
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
		const rows = def.menu;
		const menu = rows ? (context: StageMenuContext) => rows({ shell, tools, ...context }) : null;
		return { Stage, Controls, Chips, shortcuts, menu };
	};
}

/** The shortcuts a canvas offers once printing is gated: without the print command when it is off. */
export function printGated(
	shell: InspectorShell,
	shortcuts: readonly ViewerShortcut[],
): readonly ViewerShortcut[] {
	return shell.options.print ? shortcuts : shortcuts.filter((s) => s.label !== "Print");
}
