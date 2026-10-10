/// <reference lib="dom" />
import { effect } from "@preact/signals";
import type * as THREE from "three";
import type { ModelFormat } from "@projective/types/files";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import {
	clipPlanes,
	DOLLY_STEP,
	easeOutCubic,
	fitDistance,
	HOME_DIRECTION,
	lerp,
	normalize,
	ORBIT_STEP,
	orthoHalfExtents,
	presetDirection,
	presetForKey,
	slerpDirection,
	type Vec3,
	VIEW_TRANSITION_MS,
	type ViewPreset,
} from "../../../core/model-camera.ts";
import {
	aggregateStats,
	type Bounds,
	boundsCenter,
	boundsRadius,
	boundsSize,
	formatDimensions,
	itemLabel,
	missingNotice,
	modelFacts,
	modelUnit,
	usableBounds,
} from "../../../core/model-scene.ts";
import {
	FREE_ORBIT,
	type ModelBackground,
	type ModelCommands,
	type ModelEnvironment,
	type ModelTools,
} from "./model-tools.ts";
import type { ParsedModel } from "./model-parse.ts";
import { disposeObject, materialsOf, type SceneSurvey, surveyScene } from "./model-inspect.ts";
import { createDisplay, type DisplayController } from "./model-display.ts";
import { createStaging, type Staging, type StagingColors } from "./model-staging.ts";
import { type Animator, createAnimator } from "./model-animation.ts";
import {
	FALLBACK_PALETTE,
	mixRgba,
	type ModelPalette,
	readPalette,
	type Rgba,
} from "./model-theme.ts";

/**
 * model-engine — the live 3D canvas: one WebGL renderer, a perspective and an orthographic camera
 * under OrbitControls, environment lighting, the staging helpers, display modes and animation, all
 * driven by the viewer's signals. It renders on demand: a frame is drawn only when something
 * changed or is still moving (damping, a view transition, auto-rotate, a playing clip).
 */

// #region Contract
/** What the engine needs from the page. */
export interface ModelEngineOptions {
	rt: ThreeRuntime;
	canvas: HTMLCanvasElement;
	/** The stage element that holds the canvas and the colour swatches; observed for size. */
	host: HTMLElement;
	tools: ModelTools;
	shell: InspectorShell;
	format: ModelFormat | null;
}

/** A live canvas. */
export interface ModelEngine extends ModelCommands {
	readonly renderer: THREE.WebGLRenderer;
	/** Place a parsed model; the engine owns and disposes it from here on. */
	show(model: ParsedModel): void;
	/** Handle a key pressed on the stage; returns whether it was used. */
	handleKey(event: KeyboardEvent): boolean;
	dispose(): void;
}

/** Thrown when the browser cannot give the canvas a WebGL context. */
export class WebGLUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super("WebGL is not available.", options);
		this.name = "WebGLUnavailableError";
	}
}

/** Thrown when a parsed file contains nothing that can be drawn. */
export class EmptyModelError extends Error {
	constructor() {
		super("The model contains nothing to draw.");
		this.name = "EmptyModelError";
	}
}
// #endregion

// #region Internals
interface Placed {
	parsed: ParsedModel;
	survey: SceneSurvey;
	center: THREE.Vector3;
	radius: number;
	staging: Staging;
	display: DisplayController;
	animator: Animator;
}

interface Tween {
	start: number;
	fromDir: Vec3;
	toDir: Vec3;
	fromDist: number;
	toDist: number;
	fromTarget: THREE.Vector3;
	toTarget: THREE.Vector3;
	fromZoom: number;
	toZoom: number;
}

const TIME_SYNC_MS = 100;
const MAX_PIXEL_RATIO = 2;
const THEME_ATTRIBUTES = [
	"style",
	"class",
	"data-theme",
	"data-contrast",
	"data-cvd",
	"data-motion",
];

function isPerspective(camera: THREE.Camera): camera is THREE.PerspectiveCamera {
	return "isPerspectiveCamera" in camera && camera.isPerspectiveCamera === true;
}

function toVec3(v: THREE.Vector3): Vec3 {
	return [v.x, v.y, v.z];
}

function measure(rt: ThreeRuntime, root: THREE.Object3D): Bounds | null {
	root.updateMatrixWorld(true);
	const box = new rt.THREE.Box3().setFromObject(root);
	const bounds: Bounds = { min: toVec3(box.min), max: toVec3(box.max) };
	return usableBounds(bounds) ? bounds : null;
}
// #endregion

/** Create the canvas. Throws {@link WebGLUnavailableError} when WebGL is missing. */
export function createModelEngine(options: ModelEngineOptions): ModelEngine {
	const { rt, canvas, host, tools, shell, format } = options;
	const T = rt.THREE;

	// #region Renderer
	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new T.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			powerPreference: "high-performance",
		});
	} catch (error) {
		throw new WebGLUnavailableError({ cause: error });
	}
	renderer.outputColorSpace = T.SRGBColorSpace;
	renderer.toneMapping = T.ACESFilmicToneMapping;
	renderer.shadowMap.enabled = false;
	renderer.shadowMap.type = T.PCFShadowMap;

	const scene = new T.Scene();
	const pmrem = new T.PMREMGenerator(renderer);
	const environments = new Map<Exclude<ModelEnvironment, "none">, THREE.WebGLRenderTarget>();
	const perspective = new T.PerspectiveCamera(tools.fov.peek(), 1, 0.01, 1000);
	const ortho = new T.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
	const controls = new rt.OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
		perspective,
		canvas,
	);
	controls.dampingFactor = 0.12;
	controls.screenSpacePanning = true;
	controls.autoRotateSpeed = 1.5;
	controls.minZoom = 0.02;
	controls.maxZoom = 200;
	// #endregion

	// #region State
	const stops: (() => void)[] = [];
	let placed: Placed | null = null;
	let palette: ModelPalette | null = readPalette(host);
	let builtIn: THREE.Camera | null = null;
	let tween: Tween | null = null;
	let aspect = 1;
	let frame = 0;
	let last = 0;
	let lastTimeSync = 0;
	let writingTime = false;
	let disposed = false;
	let lost = false;
	// #endregion

	// #region Frame loop
	const orbitCamera = (): THREE.PerspectiveCamera | THREE.OrthographicCamera =>
		controls.object === ortho ? ortho : perspective;

	const invalidate = (): void => {
		if (frame === 0 && !disposed && !lost) frame = requestAnimationFrame(tick);
	};

	const applyTween = (t: number): void => {
		if (!tween) return;
		const e = easeOutCubic(t);
		const dir = slerpDirection(tween.fromDir, tween.toDir, e);
		const dist = lerp(tween.fromDist, tween.toDist, e);
		const target = tween.fromTarget.clone().lerp(tween.toTarget, e);
		for (const cam of [perspective, ortho]) {
			cam.position.set(
				target.x + dir[0] * dist,
				target.y + dir[1] * dist,
				target.z + dir[2] * dist,
			);
			cam.lookAt(target);
		}
		ortho.zoom = lerp(tween.fromZoom, tween.toZoom, e);
		ortho.updateProjectionMatrix();
		controls.target.copy(target);
	};

	function tick(now: number): void {
		frame = 0;
		if (disposed || lost) return;
		const dt = last === 0 ? 0 : Math.min(0.1, (now - last) / 1000);
		last = now;
		let again = false;
		if (tween) {
			const t = (now - tween.start) / VIEW_TRANSITION_MS;
			applyTween(Math.min(1, t));
			if (t >= 1) {
				tween = null;
				controls.update();
			} else {
				again = true;
			}
		} else if (builtIn === null) {
			if (controls.update(dt) || controls.autoRotate) again = true;
		}
		if (placed?.animator.advance(dt)) {
			again = true;
			if (now - lastTimeSync >= TIME_SYNC_MS) {
				lastTimeSync = now;
				writingTime = true;
				tools.time.value = placed.animator.time();
				writingTime = false;
			}
		}
		renderer.render(scene, builtIn ?? orbitCamera());
		if (again) invalidate();
		else last = 0;
	}

	controls.addEventListener("change", invalidate);
	controls.addEventListener("start", () => (tween = null));
	// #endregion

	// #region Size
	const resize = (): void => {
		const width = Math.max(1, host.clientWidth);
		const height = Math.max(1, host.clientHeight);
		renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
		renderer.setSize(width, height, false);
		aspect = width / height;
		perspective.aspect = aspect;
		perspective.updateProjectionMatrix();
		const half = (ortho.top - ortho.bottom) / 2;
		ortho.left = -half * aspect;
		ortho.right = half * aspect;
		ortho.updateProjectionMatrix();
		if (builtIn && isPerspective(builtIn)) {
			builtIn.aspect = aspect;
			builtIn.updateProjectionMatrix();
		}
		invalidate();
	};
	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(host);
	stops.push(() => resizeObserver.disconnect());
	resize();
	// #endregion

	// #region Context loss
	const onContextLost = (): void => {
		lost = true;
		shell.fail("The graphics device stopped responding. Reload the page to try again.");
	};
	canvas.addEventListener("webglcontextlost", onContextLost);
	stops.push(() => canvas.removeEventListener("webglcontextlost", onContextLost));
	// #endregion

	// #region Theme and motion
	const color = (rgba: Rgba): THREE.Color =>
		new T.Color().setRGB(rgba[0], rgba[1], rgba[2], T.SRGBColorSpace);

	const backgroundRgba = (kind: ModelBackground, from: ModelPalette): Rgba =>
		kind === "dark" ? from.dark : kind === "light" ? from.light : from.theme;

	const stagingColors = (kind: ModelBackground = tools.background.peek()): StagingColors => {
		const from = palette ?? FALLBACK_PALETTE;
		const base = backgroundRgba(kind, from);
		const ink = kind === "dark" ? from.light : kind === "light" ? from.dark : from.ink;
		return {
			grid: mixRgba(base, ink, 0.34),
			gridMinor: mixRgba(base, ink, 0.14),
			accent: from.accent,
		};
	};

	const paintBackground = (kind: ModelBackground = tools.background.peek()): void => {
		if (!palette || kind === "transparent") {
			renderer.setClearColor(color(FALLBACK_PALETTE.theme), 0);
			return;
		}
		renderer.setClearColor(color(backgroundRgba(kind, palette)), 1);
	};

	const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
	const syncMotion = (): void => {
		tools.reducedMotion.value = (motionQuery?.matches ?? false) ||
			document.documentElement.dataset.motion === "reduced";
	};
	let themeFrame = 0;
	const onThemeChange = (): void => {
		syncMotion();
		if (themeFrame !== 0) return;
		themeFrame = requestAnimationFrame(() => {
			themeFrame = 0;
			palette = readPalette(host);
			paintBackground();
			placed?.staging.recolor(stagingColors());
			invalidate();
		});
	};
	const themeObserver = new MutationObserver(onThemeChange);
	themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: THEME_ATTRIBUTES,
	});
	motionQuery?.addEventListener("change", syncMotion);
	stops.push(() => {
		themeObserver.disconnect();
		motionQuery?.removeEventListener("change", syncMotion);
		if (themeFrame !== 0) cancelAnimationFrame(themeFrame);
	});
	syncMotion();
	// #endregion

	// #region Camera moves
	const orthoFitZoom = (radius: number): number => {
		const fit = orthoHalfExtents(radius, aspect).halfHeight;
		return fit > 0 ? ortho.top / fit : 1;
	};

	const leaveBuiltIn = (): void => {
		if (tools.camera.peek() !== FREE_ORBIT) tools.camera.value = FREE_ORBIT;
	};

	const goTo = (direction: Vec3): void => {
		if (!placed) return;
		leaveBuiltIn();
		const cam = orbitCamera();
		const offset = cam.position.clone().sub(controls.target);
		const fromDist = offset.length();
		tween = {
			start: performance.now(),
			fromDir: fromDist > 0 ? normalize(toVec3(offset)) : direction,
			toDir: normalize(direction),
			fromDist: fromDist > 0 ? fromDist : 1,
			toDist: fitDistance(placed.radius, perspective.fov, aspect),
			fromTarget: controls.target.clone(),
			toTarget: placed.center.clone(),
			fromZoom: ortho.zoom,
			toZoom: orthoFitZoom(placed.radius),
		};
		if (tools.reducedMotion.peek()) {
			applyTween(1);
			tween = null;
			controls.update();
		}
		invalidate();
	};

	const currentDirection = (): Vec3 => {
		const offset = orbitCamera().position.clone().sub(controls.target);
		return offset.lengthSq() > 0 ? normalize(toVec3(offset)) : HOME_DIRECTION;
	};

	const switchProjection = (orthographic: boolean): void => {
		const target = controls.target;
		const halfFov = (perspective.fov * Math.PI) / 360;
		if (orthographic && controls.object !== ortho) {
			const d = perspective.position.distanceTo(target);
			const hh = Math.max(1e-6, d * Math.tan(halfFov));
			ortho.top = hh;
			ortho.bottom = -hh;
			ortho.left = -hh * aspect;
			ortho.right = hh * aspect;
			ortho.zoom = 1;
			ortho.position.copy(perspective.position);
			ortho.quaternion.copy(perspective.quaternion);
			ortho.updateProjectionMatrix();
			controls.object = ortho;
		} else if (!orthographic && controls.object !== perspective) {
			const hh = ortho.top / ortho.zoom;
			const d = hh / Math.tan(halfFov);
			const dir = ortho.position.clone().sub(target).normalize();
			perspective.position.copy(target).addScaledVector(dir, d);
			perspective.quaternion.copy(ortho.quaternion);
			controls.object = perspective;
		}
		controls.update();
		invalidate();
	};
	// #endregion

	// #region Signals → scene
	const environmentTexture = (kind: ModelEnvironment): THREE.Texture | null => {
		if (kind === "none") return null;
		let target = environments.get(kind);
		if (!target) {
			const source = kind === "room"
				? new rt.RoomEnvironment()
				: new rt.ColorEnvironment(new T.Color().setScalar(0.55));
			target = pmrem.fromScene(source, kind === "room" ? 0.04 : 0);
			source.dispose();
			environments.set(kind, target);
		}
		return target.texture;
	};

	const markMaterialsDirty = (): void => {
		if (!placed) return;
		for (const drawable of placed.survey.drawables) {
			for (const m of materialsOf(drawable)) m.needsUpdate = true;
		}
		for (const m of placed.display.materials()) m.needsUpdate = true;
	};

	const bindSignals = (model: Placed): void => {
		const { survey, staging, display, animator } = model;
		stops.push(
			effect(() => {
				renderer.toneMappingExposure = tools.exposure.value;
				invalidate();
			}),
			effect(() => {
				const texture = environmentTexture(tools.environment.value);
				const asBackground = tools.environmentBackground.value && texture !== null;
				const backdrop = tools.background.value;
				scene.environment = texture;
				scene.background = asBackground ? texture : null;
				scene.backgroundBlurriness = asBackground ? 0.35 : 0;
				paintBackground(backdrop);
				staging.recolor(stagingColors(backdrop));
				invalidate();
			}),
			effect(() => {
				const state = {
					studio: tools.studioLights.value,
					shadows: tools.shadows.value,
					grid: tools.grid.value,
					axes: tools.axes.value,
					bounds: tools.bounds.value,
				};
				const shadowsOn = state.shadows && state.studio;
				if (renderer.shadowMap.enabled !== shadowsOn) {
					renderer.shadowMap.enabled = shadowsOn;
					markMaterialsDirty();
				}
				staging.apply(state);
				invalidate();
			}),
			effect(() => {
				const visible = tools.modelLights.value;
				for (const light of survey.lights) light.visible = visible;
				invalidate();
			}),
			effect(() => {
				display.apply({ shading: tools.shading.value, wireframe: tools.wireframe.value });
				invalidate();
			}),
			effect(() => {
				perspective.fov = tools.fov.value;
				perspective.updateProjectionMatrix();
				invalidate();
			}),
			effect(() => {
				switchProjection(tools.projection.value === "orthographic");
			}),
			effect(() => {
				const reduced = tools.reducedMotion.value;
				controls.enableDamping = !reduced;
				controls.autoRotate = tools.autoRotate.value && !reduced;
				invalidate();
			}),
			effect(() => {
				const value = tools.camera.value;
				const index = value === FREE_ORBIT ? -1 : Number.parseInt(value, 10);
				const camera = Number.isInteger(index) && index >= 0 ? survey.cameras[index] ?? null : null;
				builtIn = camera;
				controls.enabled = camera === null;
				if (camera) tween = null;
				resize();
			}),
			effect(() => {
				const index = Number.parseInt(tools.clip.value, 10);
				animator.select(Number.isInteger(index) ? index : null);
				tools.duration.value = animator.duration();
				writingTime = true;
				tools.time.value = 0;
				writingTime = false;
				invalidate();
			}),
			effect(() => {
				animator.setPlaying(tools.playing.value);
				last = 0;
				invalidate();
			}),
			effect(() => {
				animator.setSpeed(tools.speed.value);
			}),
			effect(() => {
				const seconds = tools.time.value;
				if (writingTime) return;
				animator.seek(seconds);
				invalidate();
			}),
		);
	};
	// #endregion

	// #region Placement
	const show = (parsed: ParsedModel): void => {
		if (placed || disposed) {
			disposeObject(parsed.root);
			parsed.release();
			return;
		}
		const bounds = measure(rt, parsed.root);
		const survey = surveyScene(parsed.root, parsed.cameras);
		if (!bounds || survey.drawables.length === 0) {
			disposeObject(parsed.root);
			parsed.release();
			throw new EmptyModelError();
		}
		scene.add(parsed.root);
		const radius = boundsRadius(bounds);
		const center = new T.Vector3(...boundsCenter(bounds));
		placed = {
			parsed,
			survey,
			center,
			radius,
			staging: createStaging(rt, scene, bounds, survey.meshes, stagingColors()),
			display: createDisplay(rt, survey.meshes),
			animator: createAnimator(rt, parsed.root, parsed.clips),
		};

		const distance = fitDistance(radius, perspective.fov, aspect);
		const { near, far } = clipPlanes(distance, radius);
		perspective.near = near;
		perspective.far = far;
		const extents = orthoHalfExtents(radius, aspect);
		ortho.top = extents.halfHeight;
		ortho.bottom = -extents.halfHeight;
		ortho.left = -extents.halfHeight * aspect;
		ortho.right = extents.halfHeight * aspect;
		ortho.near = -far;
		ortho.far = far;
		controls.minDistance = radius * 0.02;
		controls.maxDistance = radius * 60;
		controls.target.copy(center);
		for (const cam of [perspective, ortho]) {
			cam.position.copy(center).addScaledVector(new T.Vector3(...HOME_DIRECTION), distance);
			cam.lookAt(center);
			cam.updateProjectionMatrix();
		}
		controls.update();

		const unit = modelUnit(format);
		const size = boundsSize(bounds);
		const stats = aggregateStats(survey.samples, {
			animations: parsed.clips.length,
			cameras: survey.cameras.length,
			lights: survey.lights.length,
		});
		shell.facts.value = modelFacts(format, stats, size, unit);
		tools.dimensions.value = formatDimensions(size, unit);
		tools.notice.value = missingNotice(parsed.missing);
		tools.modelLightCount.value = survey.lights.length;
		tools.cameras.value = survey.cameras.map((camera, i) => ({
			value: String(i),
			label: itemLabel(camera.name || camera.parent?.name, "Camera", i),
		}));
		tools.clips.value = parsed.clips.map((clip, i) => ({
			value: String(i),
			label: itemLabel(clip.name, "Clip", i),
		}));
		tools.clip.value = parsed.clips.length > 0 ? "0" : "";
		bindSignals(placed);
		tools.ready.value = true;
		invalidate();
	};
	// #endregion

	// #region Keyboard
	const handleKey = (event: KeyboardEvent): boolean => {
		if (!placed || event.ctrlKey || event.metaKey || event.altKey) return false;
		const preset = presetForKey(event.key);
		if (preset) {
			goTo(presetDirection(preset));
			return true;
		}
		const navigating = builtIn === null;
		switch (event.key) {
			case "0":
				goTo(currentDirection());
				return true;
			case "r":
			case "R":
				goTo(HOME_DIRECTION);
				return true;
			case "o":
			case "O":
				tools.projection.value = tools.projection.peek() === "orthographic"
					? "perspective"
					: "orthographic";
				return true;
			case "w":
			case "W":
				tools.wireframe.value = !tools.wireframe.peek();
				return true;
			case "g":
			case "G":
				tools.grid.value = !tools.grid.peek();
				return true;
			case " ":
				if (tools.clips.peek().length === 0) return false;
				tools.playing.value = !tools.playing.peek();
				return true;
			case "+":
			case "=":
				if (!navigating) return false;
				controls.dollyIn(1 / DOLLY_STEP);
				return true;
			case "-":
			case "_":
				if (!navigating) return false;
				controls.dollyOut(1 / DOLLY_STEP);
				return true;
			case "ArrowLeft":
			case "ArrowRight":
			case "ArrowUp":
			case "ArrowDown":
				if (!navigating) return false;
				nudge(event.key, event.shiftKey);
				return true;
			default:
				return false;
		}
	};

	const nudge = (key: string, pan: boolean): void => {
		tween = null;
		const sign = key === "ArrowLeft" || key === "ArrowUp" ? 1 : -1;
		const horizontal = key === "ArrowLeft" || key === "ArrowRight";
		if (pan) {
			const step = Math.max(8, canvas.clientHeight * 0.06);
			if (horizontal) controls.pan(sign * step, 0);
			else controls.pan(0, sign * step);
		} else if (horizontal) {
			controls.rotateLeft(sign * ORBIT_STEP);
		} else {
			controls.rotateUp(sign * ORBIT_STEP);
		}
		invalidate();
	};
	// #endregion

	// #region Disposal
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (frame !== 0) cancelAnimationFrame(frame);
		frame = 0;
		for (const stop of stops.splice(0)) stop();
		controls.dispose();
		if (placed) {
			placed.animator.dispose();
			placed.display.dispose();
			placed.staging.dispose();
			scene.remove(placed.parsed.root);
			disposeObject(placed.parsed.root);
			placed.parsed.release();
			placed = null;
		}
		scene.environment = null;
		scene.background = null;
		for (const target of environments.values()) target.dispose();
		environments.clear();
		pmrem.dispose();
		renderer.renderLists.dispose();
		renderer.dispose();
		if (!lost) renderer.forceContextLoss();
	};
	// #endregion

	return {
		renderer,
		show,
		handleKey,
		dispose,
		frame: () => goTo(currentDirection()),
		view: (preset: ViewPreset) => goTo(presetDirection(preset)),
		reset: () => goTo(HOME_DIRECTION),
	};
}
