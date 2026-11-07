/// <reference lib="dom" />
import type * as THREE from "three";
import { fitDistance, HOME_DIRECTION } from "@features/inspector/core/model-camera.ts";
import { loadThree, type ThreeRuntime } from "@features/inspector/core/three-loader.ts";
import { parseModel } from "@features/inspector/components/viewers/model/model-parse.ts";
import { disposeObject } from "@features/inspector/components/viewers/model/model-inspect.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { THUMB_PX } from "./thumb-canvas.ts";

/**
 * model-thumb — a model rendered once, from the inspector's own home angle. One hidden WebGL context
 * serves every thumbnail on the `gpu` lane, one at a time, because a page gets only a handful of
 * contexts, and it is released once the queue goes quiet so the GPU memory comes back. Reuses the
 * inspector's parser, so a card and the viewer read a file the same way.
 */

const FOV = 35;
const IDLE_RELEASE_MS = 20_000;
const KEY_LIGHT = 2.4;
const FILL_LIGHT = 1.4;

let renderer: THREE.WebGLRenderer | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function sharedRenderer(rt: ThreeRuntime): THREE.WebGLRenderer {
	clearTimeout(releaseTimer);
	if (!renderer) {
		renderer = new rt.THREE.WebGLRenderer({
			antialias: true,
			alpha: true,
			preserveDrawingBuffer: true,
		});
		renderer.setSize(THUMB_PX, THUMB_PX, false);
	}
	return renderer;
}

function releaseLater(): void {
	clearTimeout(releaseTimer);
	releaseTimer = setTimeout(() => {
		renderer?.dispose();
		renderer?.forceContextLoss();
		renderer = null;
	}, IDLE_RELEASE_MS);
}

function stage(rt: ThreeRuntime, root: THREE.Object3D): {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
} | null {
	const { THREE: T } = rt;
	const box = new T.Box3().setFromObject(root);
	if (box.isEmpty()) return null;
	const sphere = box.getBoundingSphere(new T.Sphere());
	const scene = new T.Scene();
	scene.add(root);
	scene.add(new T.HemisphereLight(0xffffff, 0x8a8f98, FILL_LIGHT));
	const key = new T.DirectionalLight(0xffffff, KEY_LIGHT);
	key.position.set(1, 2, 1.5);
	scene.add(key);

	const camera = new T.PerspectiveCamera(FOV, 1, sphere.radius / 100, sphere.radius * 100);
	const distance = fitDistance(sphere.radius, FOV, 1);
	const [x, y, z] = HOME_DIRECTION;
	camera.position.copy(sphere.center).add(new T.Vector3(x, y, z).multiplyScalar(distance));
	camera.lookAt(sphere.center);
	return { scene, camera };
}

/** Render a model to a picture. */
export async function renderModel(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	if (!job.modelFormat) return null;
	const [rt, res] = await Promise.all([
		loadThree(),
		fetch(job.src, { credentials: "same-origin", signal }),
	]);
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const bytes = await res.arrayBuffer();
	const gl = sharedRenderer(rt);
	const model = await parseModel(rt, gl, job.modelFormat, bytes);
	try {
		if (signal.aborted) return null;
		const framed = stage(rt, model.root);
		if (!framed) return null;
		gl.render(framed.scene, framed.camera);
		const blob = await new Promise<Blob | null>((resolve) =>
			gl.domElement.toBlob(resolve, "image/webp", 0.85)
		);
		return blob ? { blob } : null;
	} finally {
		disposeObject(model.root);
		model.release();
		releaseLater();
	}
}
