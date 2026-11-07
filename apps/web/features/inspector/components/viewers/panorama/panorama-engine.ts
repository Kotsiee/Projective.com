/// <reference lib="dom" />
import { type Signal, signal } from "@preact/signals";
import type * as THREE from "three";
import type { ThreeRuntime } from "../../../core/three-loader.ts";

/**
 * panorama-engine — a 360° view: the camera at the centre of a sphere with the picture on its inside,
 * looked around by dragging. It draws only when something changed, so a still view costs nothing.
 */

// #region Contract
/** Where the view starts and how far it may zoom. */
export const PANORAMA_FOV = Object.freeze({ home: 75, min: 25, max: 110 });

/** The heading of the picture's centre: a sphere's UV seam puts it on the −X axis. */
const HOME_YAW = -90;
const SPHERE_RADIUS = 50;
const WIDTH_SEGMENTS = 96;
const HEIGHT_SEGMENTS = 64;
const MAX_PITCH = 88;
const DRAG_DEGREES_PER_PX = 0.15;
const WHEEL_FOV_PER_PX = 0.04;
const MAX_PIXEL_RATIO = 2;

/** A live panorama. */
export interface PanoramaEngine {
	/** The largest texture edge this GPU holds. */
	readonly maxTextureSize: number;
	/** Put a picture on the sphere; the engine owns and disposes it from here on. */
	show(texture: THREE.Texture, hdr: boolean): void;
	setExposure(exposure: number): void;
	setFov(fov: number): void;
	/** Turn the view right and up, by degrees. */
	look(right: number, up: number): void;
	/** Back to the first view. */
	reset(): void;
	dispose(): void;
}

/** The view controls a panorama shares with its panel, wherever it is hosted. */
export interface PanoramaView {
	readonly fov: Signal<number>;
	readonly exposure: Signal<number>;
	readonly engine: Signal<PanoramaEngine | null>;
}

/** Fresh view state. */
export function createPanoramaView(): PanoramaView {
	return {
		fov: signal<number>(PANORAMA_FOV.home),
		exposure: signal(1),
		engine: signal<PanoramaEngine | null>(null),
	};
}

/** Options for {@link createPanorama}. */
export interface PanoramaOptions {
	rt: ThreeRuntime;
	canvas: HTMLCanvasElement;
	/** The element sized by the stage; observed. */
	host: HTMLElement;
	/** Told when a wheel or pinch changes the zoom, so the panel's slider follows. */
	onFov: (fov: number) => void;
}

/** Thrown when the browser cannot give the canvas a WebGL context. */
export class PanoramaUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super("WebGL is not available.", options);
		this.name = "PanoramaUnavailableError";
	}
}
// #endregion

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Start a panorama on a canvas. Throws {@link PanoramaUnavailableError} without WebGL. */
export function createPanorama(
	{ rt, canvas, host, onFov }: PanoramaOptions,
): PanoramaEngine {
	const { THREE: T } = rt;
	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new T.WebGLRenderer({ canvas, antialias: false });
	} catch (error) {
		throw new PanoramaUnavailableError({ cause: error });
	}
	renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));

	const scene = new T.Scene();
	const camera = new T.PerspectiveCamera(PANORAMA_FOV.home, 1, 0.1, SPHERE_RADIUS * 2);
	const geometry = new T.SphereGeometry(SPHERE_RADIUS, WIDTH_SEGMENTS, HEIGHT_SEGMENTS);
	geometry.scale(-1, 1, 1);
	const material = new T.MeshBasicMaterial({ toneMapped: true });
	scene.add(new T.Mesh(geometry, material));

	let yaw = HOME_YAW;
	let pitch = 0;
	let frame = 0;
	let disposed = false;
	const target = new T.Vector3();

	const draw = () => {
		frame = 0;
		if (disposed) return;
		const up = T.MathUtils.degToRad(90 - pitch);
		const around = T.MathUtils.degToRad(yaw);
		target.setFromSphericalCoords(1, up, around);
		camera.lookAt(target);
		renderer.render(scene, camera);
	};
	const invalidate = () => {
		if (frame === 0 && !disposed) frame = requestAnimationFrame(draw);
	};

	const resize = () => {
		const width = host.clientWidth;
		const height = host.clientHeight;
		if (width === 0 || height === 0) return;
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		invalidate();
	};
	const observer = new ResizeObserver(resize);
	observer.observe(host);
	resize();

	const setFov = (fov: number) => {
		camera.fov = clamp(fov, PANORAMA_FOV.min, PANORAMA_FOV.max);
		camera.updateProjectionMatrix();
		invalidate();
	};

	// #region Pointer
	const presses = new Map<number, { x: number; y: number }>();
	let pinch = 0;
	const spread = () => {
		const [a, b] = [...presses.values()];
		return Math.hypot(a.x - b.x, a.y - b.y);
	};
	const onDown = (event: PointerEvent) => {
		canvas.setPointerCapture(event.pointerId);
		presses.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (presses.size === 2) pinch = spread();
	};
	const onMove = (event: PointerEvent) => {
		const last = presses.get(event.pointerId);
		if (!last) return;
		const dx = event.clientX - last.x;
		const dy = event.clientY - last.y;
		presses.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (presses.size === 2) {
			const now = spread();
			setFov(camera.fov * (pinch / Math.max(now, 1)));
			pinch = now;
			onFov(camera.fov);
			return;
		}
		// Slower when zoomed in, so a drag keeps moving the picture with the pointer.
		const rate = DRAG_DEGREES_PER_PX * (camera.fov / PANORAMA_FOV.home);
		engine.look(-dx * rate, dy * rate);
	};
	const onUp = (event: PointerEvent) => presses.delete(event.pointerId);
	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		setFov(camera.fov + event.deltaY * WHEEL_FOV_PER_PX);
		onFov(camera.fov);
	};
	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointermove", onMove);
	canvas.addEventListener("pointerup", onUp);
	canvas.addEventListener("pointercancel", onUp);
	canvas.addEventListener("wheel", onWheel, { passive: false });
	// #endregion

	const engine: PanoramaEngine = {
		maxTextureSize: renderer.capabilities.maxTextureSize,
		show(texture, hdr) {
			material.map?.dispose();
			material.map = texture;
			material.needsUpdate = true;
			renderer.toneMapping = hdr ? T.ACESFilmicToneMapping : T.NoToneMapping;
			invalidate();
		},
		setExposure(exposure) {
			renderer.toneMappingExposure = exposure;
			invalidate();
		},
		setFov,
		look(right, up) {
			// Heading runs anticlockwise seen from above, so turning right lowers it.
			yaw = (yaw - right) % 360;
			pitch = clamp(pitch + up, -MAX_PITCH, MAX_PITCH);
			invalidate();
		},
		reset() {
			yaw = HOME_YAW;
			pitch = 0;
			setFov(PANORAMA_FOV.home);
			onFov(PANORAMA_FOV.home);
		},
		dispose() {
			disposed = true;
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
			canvas.removeEventListener("wheel", onWheel);
			material.map?.dispose();
			material.dispose();
			geometry.dispose();
			renderer.dispose();
		},
	};
	return engine;
}
