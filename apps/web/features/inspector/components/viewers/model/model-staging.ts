import type * as THREE from "three";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import {
	type Bounds,
	boundsCenter,
	boundsRadius,
	boundsSize,
	gridStep,
} from "../../../core/model-scene.ts";
import type { Rgba } from "./model-theme.ts";

/**
 * model-staging — everything the canvas adds around the model: the studio light rig (hemisphere,
 * key, fill, rim), the shadow-catching floor, and the grid, axes and bounding-box helpers. All of it
 * is sized from the model's bounds; helper colours come from the token palette.
 */

/** Helper colours, already resolved against the current background. */
export interface StagingColors {
	grid: Rgba;
	gridMinor: Rgba;
	accent: Rgba;
}

/** What is switched on around the model. */
export interface StagingState {
	studio: boolean;
	shadows: boolean;
	grid: boolean;
	axes: boolean;
	bounds: boolean;
}

/** The staging around one model. */
export interface Staging {
	apply(state: StagingState): void;
	recolor(colors: StagingColors): void;
	dispose(): void;
}

function toColor(rt: ThreeRuntime, rgba: Rgba): THREE.Color {
	return new rt.THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], rt.THREE.SRGBColorSpace);
}

function flatLines(material: THREE.Material | THREE.Material[]): void {
	for (const m of Array.isArray(material) ? material : [material]) {
		m.toneMapped = false;
		m.depthWrite = false;
	}
}

function disposeLines(object: THREE.LineSegments): void {
	object.geometry.dispose();
	const material = object.material;
	for (const m of Array.isArray(material) ? material : [material]) m.dispose();
}

/** Build the staging for a model with the given bounds and add it to `scene`. */
export function createStaging(
	rt: ThreeRuntime,
	scene: THREE.Scene,
	bounds: Bounds,
	meshes: readonly THREE.Mesh[],
	colors: StagingColors,
): Staging {
	const T = rt.THREE;
	const center = new T.Vector3(...boundsCenter(bounds));
	const radius = boundsRadius(bounds);
	const [sx, , sz] = boundsSize(bounds);
	const floorY = bounds.min[1];

	const studio = new T.Group();
	studio.name = "inspector-studio";
	const white = new T.Color(1, 1, 1);
	const ground = new T.Color().setScalar(0.3);
	studio.add(new T.HemisphereLight(white, ground, 0.25));
	const key = new T.DirectionalLight(white, 1.4);
	key.position.set(center.x + radius * 2, center.y + radius * 3, center.z + radius * 2.4);
	const fill = new T.DirectionalLight(white, 0.3);
	fill.position.set(center.x - radius * 2.5, center.y + radius, center.z + radius * 1.5);
	const rim = new T.DirectionalLight(white, 0.6);
	rim.position.set(center.x - radius * 0.8, center.y + radius * 2, center.z - radius * 3);
	for (const light of [key, fill, rim]) {
		light.target.position.copy(center);
		studio.add(light, light.target);
	}
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.radius = 4;
	key.shadow.bias = -0.0005;
	key.shadow.normalBias = radius * 0.002;
	const shadowCam = key.shadow.camera;
	shadowCam.left = -radius * 1.6;
	shadowCam.right = radius * 1.6;
	shadowCam.top = radius * 1.6;
	shadowCam.bottom = -radius * 1.6;
	shadowCam.near = radius * 0.1;
	shadowCam.far = radius * 10;
	shadowCam.updateProjectionMatrix();
	scene.add(studio);

	const floorMaterial = new T.ShadowMaterial({ opacity: 0.22 });
	const floor = new T.Mesh(new T.PlaneGeometry(radius * 12, radius * 12), floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.position.set(center.x, floorY - radius * 0.0005, center.z);
	floor.receiveShadow = true;
	floor.visible = false;
	scene.add(floor);

	const axes = new T.AxesHelper(Math.max(radius * 1.2, 1e-3));
	flatLines(axes.material);
	axes.visible = false;
	scene.add(axes);

	const box = new T.Box3(new T.Vector3(...bounds.min), new T.Vector3(...bounds.max));
	let grid: THREE.GridHelper | null = null;
	let boxHelper: THREE.Box3Helper | null = null;
	let state: StagingState = {
		studio: true,
		shadows: false,
		grid: false,
		axes: false,
		bounds: false,
	};

	const build = (palette: StagingColors) => {
		if (grid) {
			scene.remove(grid);
			disposeLines(grid);
		}
		if (boxHelper) {
			scene.remove(boxHelper);
			disposeLines(boxHelper);
		}
		const span = Math.max(sx, sz, radius) * 3;
		const step = gridStep(span, 20);
		const divisions = Math.max(2, Math.round(span / step / 2) * 2);
		grid = new T.GridHelper(
			divisions * step,
			divisions,
			toColor(rt, palette.grid),
			toColor(rt, palette.gridMinor),
		);
		flatLines(grid.material);
		grid.position.set(center.x, floorY, center.z);
		grid.visible = state.grid;
		scene.add(grid);
		boxHelper = new T.Box3Helper(box, toColor(rt, palette.accent));
		flatLines(boxHelper.material);
		boxHelper.visible = state.bounds;
		scene.add(boxHelper);
	};
	build(colors);

	return {
		apply(next: StagingState): void {
			state = next;
			studio.visible = next.studio;
			const shadows = next.shadows && next.studio;
			key.castShadow = shadows;
			floor.visible = shadows;
			for (const mesh of meshes) {
				mesh.castShadow = shadows;
				mesh.receiveShadow = shadows;
			}
			axes.visible = next.axes;
			if (grid) grid.visible = next.grid;
			if (boxHelper) boxHelper.visible = next.bounds;
		},
		recolor(palette: StagingColors): void {
			build(palette);
		},
		dispose(): void {
			if (grid) {
				scene.remove(grid);
				disposeLines(grid);
			}
			if (boxHelper) {
				scene.remove(boxHelper);
				disposeLines(boxHelper);
			}
			scene.remove(studio, floor, axes);
			key.shadow.dispose();
			floor.geometry.dispose();
			floorMaterial.dispose();
			disposeLines(axes);
		},
	};
}
