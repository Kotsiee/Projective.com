import type * as THREE from "three";
import { type DrawableSample, triangleCount } from "../../../core/model-scene.ts";

/**
 * model-inspect — walks a parsed scene graph: the drawables and their statistics, the cameras and
 * lights the file brought with it, and full GPU disposal. Type guards read three's `is*` brand
 * flags, so the walk needs no runtime import of three.
 */

// #region Guards
/** Whether an object is a mesh (including skinned and instanced meshes). */
export function isMesh(o: THREE.Object3D): o is THREE.Mesh {
	return "isMesh" in o && o.isMesh === true;
}

function isInstanced(o: THREE.Mesh): o is THREE.InstancedMesh {
	return "isInstancedMesh" in o && o.isInstancedMesh === true;
}

function isPoints(o: THREE.Object3D): o is THREE.Points {
	return "isPoints" in o && o.isPoints === true;
}

function isLine(o: THREE.Object3D): o is THREE.Line {
	return "isLine" in o && o.isLine === true;
}

function isSkinned(o: THREE.Object3D): o is THREE.SkinnedMesh {
	return "isSkinnedMesh" in o && o.isSkinnedMesh === true;
}

/** Whether an object is a camera. */
export function isCamera(o: THREE.Object3D): o is THREE.Camera {
	return "isCamera" in o && o.isCamera === true;
}

/** Whether an object is a light. */
export function isLight(o: THREE.Object3D): o is THREE.Light {
	return "isLight" in o && o.isLight === true;
}

/** Whether a value is a three texture. */
export function isTexture(value: unknown): value is THREE.Texture {
	return typeof value === "object" && value !== null && "isTexture" in value &&
		value.isTexture === true;
}
// #endregion

// #region Survey
/** Anything with geometry and material(s) the canvas counts and restyles. */
export type Drawable = THREE.Mesh | THREE.Points | THREE.Line;

/** What a scene contains. */
export interface SceneSurvey {
	meshes: THREE.Mesh[];
	drawables: Drawable[];
	samples: DrawableSample[];
	cameras: THREE.Camera[];
	lights: THREE.Light[];
}

/** Every material an object draws with, as a flat list. */
export function materialsOf(o: Drawable): THREE.Material[] {
	return Array.isArray(o.material) ? o.material : [o.material];
}

/** Every texture a material samples. */
export function texturesOf(material: THREE.Material): THREE.Texture[] {
	const values: unknown[] = Object.values(material);
	return values.filter(isTexture);
}

function sample(o: Drawable): DrawableSample {
	const geometry = o.geometry;
	const vertexCount = geometry.getAttribute("position")?.count ?? 0;
	const instances = isMesh(o) && isInstanced(o) ? o.count : 1;
	const materials = materialsOf(o);
	return {
		vertices: vertexCount * instances,
		triangles: isMesh(o) ? triangleCount(geometry.index?.count ?? null, vertexCount, instances) : 0,
		materials: materials.map((m) => m.uuid),
		textures: materials.flatMap((m) => texturesOf(m).map((t) => t.uuid)),
	};
}

/** Walk the model once and collect what the panel and the display modes need. */
export function surveyScene(
	root: THREE.Object3D,
	fileCameras: readonly THREE.Camera[],
): SceneSurvey {
	const meshes: THREE.Mesh[] = [];
	const drawables: Drawable[] = [];
	const cameras = new Set<THREE.Camera>(fileCameras);
	const lights: THREE.Light[] = [];
	root.traverse((o) => {
		if (isMesh(o)) {
			meshes.push(o);
			drawables.push(o);
		} else if (isPoints(o) || isLine(o)) {
			drawables.push(o);
		} else if (isCamera(o)) {
			cameras.add(o);
		} else if (isLight(o)) {
			lights.push(o);
		}
	});
	return { meshes, drawables, samples: drawables.map(sample), cameras: [...cameras], lights };
}
// #endregion

// #region Disposal
/** Release every geometry, material, texture and skeleton under `root`. */
export function disposeObject(root: THREE.Object3D): void {
	const textures = new Set<THREE.Texture>();
	const materials = new Set<THREE.Material>();
	root.traverse((o) => {
		if (isMesh(o) || isPoints(o) || isLine(o)) {
			o.geometry.dispose();
			for (const m of materialsOf(o)) materials.add(m);
		}
		if (isSkinned(o)) o.skeleton.dispose();
	});
	for (const m of materials) {
		for (const t of texturesOf(m)) textures.add(t);
		m.dispose();
	}
	for (const t of textures) t.dispose();
}
// #endregion
