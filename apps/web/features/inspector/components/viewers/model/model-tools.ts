import { type Signal, signal } from "@preact/signals";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import type { ViewPreset } from "../../../core/model-camera.ts";

// #region Choices
/** Camera projection. */
export type ModelProjection = "perspective" | "orthographic";

/** Image-based lighting around the model. */
export type ModelEnvironment = "room" | "neutral" | "none";

/** What fills the canvas behind the model. */
export type ModelBackground = "theme" | "dark" | "light" | "transparent";

/** How surfaces are shaded. */
export type ModelShading = "standard" | "clay" | "normals";

/** One built-in camera or animation clip, addressed by its index in the file. */
export interface ModelOption {
	value: string;
	label: string;
}

/** The camera value that means "orbit freely" rather than looking through a built-in camera. */
export const FREE_ORBIT = "free";
// #endregion

// #region Tools
/** Imperative actions the panel and keyboard ask of the live canvas. */
export interface ModelCommands {
	frame(): void;
	view(preset: ViewPreset): void;
	reset(): void;
}

/** The model canvas's state, shared by the stage and the panel. */
export interface ModelTools extends ModelCommands {
	readonly ready: Signal<boolean>;
	readonly reducedMotion: Signal<boolean>;
	readonly projection: Signal<ModelProjection>;
	readonly fov: Signal<number>;
	readonly cameras: Signal<readonly ModelOption[]>;
	readonly camera: Signal<string>;
	readonly autoRotate: Signal<boolean>;
	readonly studioLights: Signal<boolean>;
	readonly modelLights: Signal<boolean>;
	readonly modelLightCount: Signal<number>;
	readonly exposure: Signal<number>;
	readonly shadows: Signal<boolean>;
	readonly environment: Signal<ModelEnvironment>;
	readonly environmentBackground: Signal<boolean>;
	readonly background: Signal<ModelBackground>;
	readonly wireframe: Signal<boolean>;
	readonly grid: Signal<boolean>;
	readonly axes: Signal<boolean>;
	readonly bounds: Signal<boolean>;
	readonly shading: Signal<ModelShading>;
	readonly clips: Signal<readonly ModelOption[]>;
	readonly clip: Signal<string>;
	readonly playing: Signal<boolean>;
	readonly speed: Signal<number>;
	/** Playhead in seconds; written by the canvas while playing, read back when scrubbed. */
	readonly time: Signal<number>;
	readonly duration: Signal<number>;
	/** Bounding size readout, `W × H × D unit`. */
	readonly dimensions: Signal<string | null>;
	/** Non-fatal notice, e.g. referenced files that weren't uploaded. */
	readonly notice: Signal<string | null>;
	/** Bind the live canvas (or unbind it with `null`). */
	attach(commands: ModelCommands | null): void;
}

/** Default vertical field of view, in degrees. */
export const DEFAULT_FOV = 45;

/** Default tone-mapping exposure. */
export const DEFAULT_EXPOSURE = 1;

/** Create the model canvas's state. Pure signals, so it is safe during SSR. */
export function createModelTools(_shell: InspectorShell): ModelTools {
	let live: ModelCommands | null = null;
	return {
		ready: signal(false),
		reducedMotion: signal(false),
		projection: signal<ModelProjection>("perspective"),
		fov: signal(DEFAULT_FOV),
		cameras: signal<readonly ModelOption[]>([]),
		camera: signal(FREE_ORBIT),
		autoRotate: signal(false),
		studioLights: signal(true),
		modelLights: signal(true),
		modelLightCount: signal(0),
		exposure: signal(DEFAULT_EXPOSURE),
		shadows: signal(false),
		environment: signal<ModelEnvironment>("room"),
		environmentBackground: signal(false),
		background: signal<ModelBackground>("theme"),
		wireframe: signal(false),
		grid: signal(false),
		axes: signal(false),
		bounds: signal(false),
		shading: signal<ModelShading>("standard"),
		clips: signal<readonly ModelOption[]>([]),
		clip: signal(""),
		playing: signal(false),
		speed: signal(1),
		time: signal(0),
		duration: signal(0),
		dimensions: signal<string | null>(null),
		notice: signal<string | null>(null),
		attach(commands: ModelCommands | null): void {
			live = commands;
		},
		frame(): void {
			live?.frame();
		},
		view(preset: ViewPreset): void {
			live?.view(preset);
		},
		reset(): void {
			live?.reset();
		},
	};
}
// #endregion
