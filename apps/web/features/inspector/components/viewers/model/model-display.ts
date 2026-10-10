import type * as THREE from "three";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import type { ModelShading } from "./model-tools.ts";
import { materialsOf } from "./model-inspect.ts";

/**
 * model-display — the shading and wireframe modes. Clay and Normals swap every mesh onto a shared
 * override material (a flat-shaded twin for geometry without normals, as glTF prescribes); Standard
 * puts the file's own materials back. Wireframe applies to whichever set is showing, and the
 * file's original wireframe flags are restored when it is off.
 */

/** Display state the canvas applies to the model. */
export interface DisplayMode {
	shading: ModelShading;
	wireframe: boolean;
}

/** Drives the model's display modes. */
export interface DisplayController {
	apply(mode: DisplayMode): void;
	/** The override materials, so the canvas can recompile them when the shadow map toggles. */
	materials(): THREE.Material[];
	dispose(): void;
}

function setWireframe(material: THREE.Material, on: boolean): void {
	if ("wireframe" in material && typeof material.wireframe === "boolean") {
		material.wireframe = on;
	}
}

function wireframeOf(material: THREE.Material): boolean {
	return "wireframe" in material && material.wireframe === true;
}

/** Bind display modes to the model's meshes. */
export function createDisplay(rt: ThreeRuntime, meshes: readonly THREE.Mesh[]): DisplayController {
	const T = rt.THREE;
	const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
	const originalWire = new Map<THREE.Material, boolean>();
	for (const mesh of meshes) {
		originals.set(mesh, mesh.material);
		for (const m of materialsOf(mesh)) originalWire.set(m, wireframeOf(m));
	}
	const overrides = {
		clay: {
			smooth: new T.MeshMatcapMaterial({ side: T.DoubleSide }),
			flat: new T.MeshMatcapMaterial({ side: T.DoubleSide, flatShading: true }),
		},
		normals: {
			smooth: new T.MeshNormalMaterial({ side: T.DoubleSide }),
			flat: new T.MeshNormalMaterial({ side: T.DoubleSide, flatShading: true }),
		},
	};
	const all: THREE.Material[] = Object.values(overrides).flatMap((
		pair,
	) => [pair.smooth, pair.flat]);

	return {
		apply({ shading, wireframe }: DisplayMode): void {
			for (const m of all) setWireframe(m, wireframe);
			for (const [mesh, material] of originals) {
				if (shading === "standard") {
					mesh.material = material;
					continue;
				}
				const pair = overrides[shading];
				mesh.material = mesh.geometry.getAttribute("normal") === undefined
					? pair.flat
					: pair.smooth;
			}
			for (const [material, wire] of originalWire) setWireframe(material, wireframe || wire);
		},
		materials(): THREE.Material[] {
			return all;
		},
		dispose(): void {
			for (const [mesh, material] of originals) mesh.material = material;
			for (const [material, wire] of originalWire) setWireframe(material, wire);
			for (const m of all) m.dispose();
		},
	};
}
