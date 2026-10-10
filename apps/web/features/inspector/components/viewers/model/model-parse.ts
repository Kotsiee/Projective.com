/// <reference lib="dom" />
import type * as THREE from "three";
import type { ModelFormat } from "@projective/types/files";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import { BASIS_VENDOR, DRACO_VENDOR } from "../../../core/vendor-paths.ts";
import { decodeDataUrl, objMaterialLibraries, resourceName } from "../../../core/model-scene.ts";

/**
 * model-parse — turns the downloaded bytes into a three.js scene graph with the loader for each
 * format. A single uploaded file cannot carry its siblings, so every URL a loader asks for goes
 * through a resource gate: embedded `data:` payloads are re-served as `blob:` URLs (the page's
 * `connect-src` admits `blob:` only), and anything else is recorded as missing and answered with
 * an empty blob so the loader fails fast instead of requesting a path the server would 404.
 */

// #region Result
/** A parsed model, ready to place in a scene. */
export interface ParsedModel {
	root: THREE.Group;
	clips: THREE.AnimationClip[];
	cameras: THREE.Camera[];
	/** Referenced files that weren't part of the upload. */
	missing: string[];
	/** Revoke the `blob:` URLs issued for embedded resources; call once the model is disposed. */
	release(): void;
}

/** Thrown when the model's geometry lives in files that weren't uploaded with it. */
export class MissingResourcesError extends Error {
	readonly names: readonly string[];

	constructor(names: readonly string[], options?: ErrorOptions) {
		super(`Missing referenced files: ${names.join(", ")}`, options);
		this.name = "MissingResourcesError";
		this.names = names;
	}
}
// #endregion

// #region Resource gate
interface ResourceGate {
	manager: THREE.LoadingManager;
	missing: Set<string>;
	release(): void;
}

function createResourceGate(rt: ThreeRuntime): ResourceGate {
	const missing = new Set<string>();
	const issued: string[] = [];
	let empty: string | null = null;
	const issue = (blob: Blob): string => {
		const url = URL.createObjectURL(blob);
		issued.push(url);
		return url;
	};
	const manager = new rt.THREE.LoadingManager();
	manager.setURLModifier((url: string): string => {
		if (url.startsWith("blob:")) return url;
		if (url.startsWith("data:")) {
			const payload = decodeDataUrl(url);
			if (payload) return issue(new Blob([payload.bytes], { type: payload.type }));
		}
		missing.add(url.startsWith("data:") ? "an embedded resource" : resourceName(url));
		empty ??= issue(new Blob([]));
		return empty;
	});
	return {
		manager,
		missing,
		release: () => {
			for (const url of issued) URL.revokeObjectURL(url);
			issued.length = 0;
		},
	};
}
// #endregion

// #region Geometry-only formats
const NEUTRAL_GREY = 0.6;

function surfaceMaterial(rt: ThreeRuntime, vertexColors: boolean): THREE.MeshStandardMaterial {
	const material = new rt.THREE.MeshStandardMaterial({
		roughness: 0.6,
		metalness: 0.05,
		vertexColors,
		side: rt.THREE.DoubleSide,
	});
	if (!vertexColors) {
		material.color.setRGB(NEUTRAL_GREY, NEUTRAL_GREY, NEUTRAL_GREY, rt.THREE.SRGBColorSpace);
	}
	return material;
}

function meshObject(rt: ThreeRuntime, geometry: THREE.BufferGeometry): THREE.Mesh {
	if (geometry.getAttribute("normal") === undefined) geometry.computeVertexNormals();
	const hasColor = geometry.getAttribute("color") !== undefined;
	return new rt.THREE.Mesh(geometry, surfaceMaterial(rt, hasColor));
}

function plyObject(rt: ThreeRuntime, geometry: THREE.BufferGeometry): THREE.Object3D {
	if (geometry.index !== null) return meshObject(rt, geometry);
	geometry.computeBoundingSphere();
	const hasColor = geometry.getAttribute("color") !== undefined;
	const radius = geometry.boundingSphere?.radius ?? 1;
	const material = new rt.THREE.PointsMaterial({ size: radius / 250, vertexColors: hasColor });
	if (!hasColor) {
		material.color.setRGB(NEUTRAL_GREY, NEUTRAL_GREY, NEUTRAL_GREY, rt.THREE.SRGBColorSpace);
	}
	return new rt.THREE.Points(geometry, material);
}
// #endregion

// #region Loaders
interface Loaded {
	scene: THREE.Object3D;
	clips: THREE.AnimationClip[];
	cameras: THREE.Camera[];
}

async function loadGltf(
	rt: ThreeRuntime,
	renderer: THREE.WebGLRenderer,
	manager: THREE.LoadingManager,
	buffer: ArrayBuffer,
): Promise<Loaded> {
	const draco = new rt.DRACOLoader().setDecoderPath(DRACO_VENDOR);
	const ktx2 = new rt.KTX2Loader().setTranscoderPath(BASIS_VENDOR).detectSupport(renderer);
	const loader = new rt.GLTFLoader(manager)
		.setDRACOLoader(draco)
		.setKTX2Loader(ktx2)
		.setMeshoptDecoder(rt.MeshoptDecoder);
	try {
		const gltf = await loader.parseAsync(buffer, "");
		const scene = gltf.scene ?? gltf.scenes[0];
		if (!scene) throw new Error("The glTF file has no scene.");
		return { scene, clips: gltf.animations, cameras: gltf.cameras };
	} finally {
		draco.dispose();
		ktx2.dispose();
	}
}

function loadUsd(
	rt: ThreeRuntime,
	manager: THREE.LoadingManager,
	buffer: ArrayBuffer,
): Promise<Loaded> {
	const loader = new rt.USDLoader(manager);
	return new Promise<Loaded>((resolve, reject) => {
		try {
			loader.parse(
				buffer,
				"",
				(group) => resolve({ scene: group, clips: group.animations, cameras: [] }),
				(error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
			);
		} catch (error) {
			reject(error);
		}
	});
}

async function load(
	rt: ThreeRuntime,
	renderer: THREE.WebGLRenderer,
	gate: ResourceGate,
	format: ModelFormat,
	buffer: ArrayBuffer,
): Promise<Loaded> {
	const { manager } = gate;
	const text = () => new TextDecoder().decode(buffer);
	switch (format) {
		case "glb":
		case "gltf":
			return await loadGltf(rt, renderer, manager, buffer);
		case "obj": {
			const source = text();
			for (const name of objMaterialLibraries(source)) gate.missing.add(name);
			const group = new rt.OBJLoader(manager).parse(source);
			return { scene: group, clips: [], cameras: [] };
		}
		case "stl":
			return {
				scene: meshObject(rt, new rt.STLLoader(manager).parse(buffer)),
				clips: [],
				cameras: [],
			};
		case "ply":
			return {
				scene: plyObject(rt, new rt.PLYLoader(manager).parse(buffer)),
				clips: [],
				cameras: [],
			};
		case "fbx": {
			const group = new rt.FBXLoader(manager).parse(buffer, "");
			return { scene: group, clips: group.animations, cameras: [] };
		}
		case "3mf":
			return { scene: new rt.ThreeMFLoader(manager).parse(buffer), clips: [], cameras: [] };
		case "dae": {
			const result = new rt.ColladaLoader(manager).parse(text(), "");
			if (!result) throw new Error("The COLLADA file has no scene.");
			return { scene: result.scene, clips: result.scene.animations, cameras: [] };
		}
		case "usdz":
			return await loadUsd(rt, manager, buffer);
	}
}
// #endregion

// #region Entry
/**
 * Parse one model file. Rejects with {@link MissingResourcesError} when the load failed and the
 * file referenced siblings that weren't uploaded, otherwise with the loader's own error.
 */
export async function parseModel(
	rt: ThreeRuntime,
	renderer: THREE.WebGLRenderer,
	format: ModelFormat,
	buffer: ArrayBuffer,
): Promise<ParsedModel> {
	const gate = createResourceGate(rt);
	try {
		const loaded = await load(rt, renderer, gate, format, buffer);
		const root = new rt.THREE.Group();
		root.name = "inspector-model";
		root.add(loaded.scene);
		const clips = loaded.clips.filter((clip) => clip.duration > 0 && clip.tracks.length > 0);
		return {
			root,
			clips,
			cameras: loaded.cameras,
			missing: [...gate.missing],
			release: gate.release,
		};
	} catch (error) {
		gate.release();
		if (gate.missing.size > 0) throw new MissingResourcesError([...gate.missing], { cause: error });
		throw error;
	}
}
// #endregion
