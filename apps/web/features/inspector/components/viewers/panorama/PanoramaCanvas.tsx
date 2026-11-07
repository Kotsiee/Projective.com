import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type * as THREE from "three";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { loadThree, type ThreeRuntime } from "../../../core/three-loader.ts";
import { ToolButton, ToolButtonGroup, ToolGroup, ToolSlider } from "../../controls/mod.ts";
import {
	createPanorama,
	PANORAMA_FOV,
	type PanoramaEngine,
	type PanoramaView,
} from "./panorama-engine.ts";

const KEY_STEP_DEGREES = 8;
const ZOOM_STEP_DEGREES = 8;

/** Props for {@link PanoramaCanvas}. */
export interface PanoramaCanvasProps {
	shell: InspectorShell;
	view: PanoramaView;
	/** Whether the picture is high dynamic range, so it is tone-mapped and exposure applies. */
	hdr: boolean;
	/** Produce the picture, once WebGL is up and its size limit is known. */
	load: (
		rt: ThreeRuntime,
		maxTextureSize: number,
		signal: AbortSignal,
	) => Promise<THREE.Texture>;
}

/** A 360° stage: drag to look around, wheel or pinch to zoom, arrows on the keyboard. */
export function PanoramaCanvas({ shell, view, hdr, load }: PanoramaCanvasProps): JSX.Element {
	const host = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const node = host.current;
		const surface = canvas.current;
		if (!node || !surface) return;
		const controller = new AbortController();
		let engine: PanoramaEngine | null = null;

		const failure = () => {
			if (!controller.signal.aborted) {
				shell.fail("This picture couldn't be shown in 360°. You can still download it.");
			}
		};
		(async () => {
			const rt = await loadThree();
			if (controller.signal.aborted) return;
			engine = createPanorama({
				rt,
				canvas: surface,
				host: node,
				onFov: (fov) => (view.fov.value = fov),
			});
			const texture = await load(rt, engine.maxTextureSize, controller.signal);
			if (controller.signal.aborted) return texture.dispose();
			engine.show(texture, hdr);
			view.engine.value = engine;
			if (shell.status.peek() === "loading") shell.status.value = "ready";
		})().catch(failure);

		const onKey = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const live = view.engine.peek();
			if (!live) return;
			const turns: Record<string, [number, number]> = {
				ArrowLeft: [-KEY_STEP_DEGREES, 0],
				ArrowRight: [KEY_STEP_DEGREES, 0],
				ArrowUp: [0, KEY_STEP_DEGREES],
				ArrowDown: [0, -KEY_STEP_DEGREES],
			};
			const turn = turns[event.key];
			if (turn) live.look(turn[0], turn[1]);
			else if (event.key === "+" || event.key === "=") {
				view.fov.value = view.fov.peek() - ZOOM_STEP_DEGREES;
			} else if (event.key === "-") view.fov.value = view.fov.peek() + ZOOM_STEP_DEGREES;
			else if (event.key === "0") live.reset();
			else return;
			event.preventDefault();
		};
		const stage = node.closest<HTMLElement>(".ins-stage");
		stage?.addEventListener("keydown", onKey);

		return () => {
			controller.abort();
			stage?.removeEventListener("keydown", onKey);
			view.engine.value = null;
			engine?.dispose();
		};
	}, [shell, view]);

	useSignalEffect(() => {
		const engine = view.engine.value;
		if (!engine) return;
		engine.setFov(view.fov.value);
		engine.setExposure(view.exposure.value);
	});

	return (
		<div ref={host} class="ins-pano">
			<canvas
				ref={canvas}
				class="ins-pano__canvas"
				role="img"
				aria-label={`360° view of ${shell.asset.name}. Drag or use the arrow keys to look around.`}
			/>
		</div>
	);
}

/** The panorama's panel group: zoom, exposure for an HDR picture, and the way back. */
export function PanoramaTools({ view, hdr }: { view: PanoramaView; hdr: boolean }): JSX.Element {
	const engine = view.engine.value;
	return (
		<ToolGroup title="360° view">
			<ToolSlider
				label="Field of view"
				value={view.fov}
				min={PANORAMA_FOV.min}
				max={PANORAMA_FOV.max}
				formatValue={(value) => `${Math.round(value)}°`}
				disabled={!engine}
			/>
			{hdr
				? (
					<ToolSlider
						label="Exposure"
						value={view.exposure}
						min={0.1}
						max={4}
						step={0.1}
						formatValue={(value) => value.toFixed(1)}
						disabled={!engine}
					/>
				)
				: null}
			<ToolButtonGroup label="View">
				<ToolButton
					icon="refresh"
					label="Reset the view"
					shortcut="0"
					disabled={!engine}
					onClick={() => engine?.reset()}
				/>
			</ToolButtonGroup>
		</ToolGroup>
	);
}
