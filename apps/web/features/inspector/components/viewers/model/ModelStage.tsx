import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ViewerProps } from "../viewer.ts";
import { loadThree, warmThree } from "../../../core/three-loader.ts";
import { missingGeometryReason, MODEL_BYTES_LIMIT } from "../../../core/model-scene.ts";
import { FREE_ORBIT, type ModelTools } from "./model-tools.ts";
import { SWATCHES } from "./model-theme.ts";
import { MissingResourcesError, type ParsedModel, parseModel } from "./model-parse.ts";
import { disposeObject } from "./model-inspect.ts";
import {
	createModelEngine,
	EmptyModelError,
	type ModelEngine,
	WebGLUnavailableError,
} from "./model-engine.ts";

class FetchFailure extends Error {
	readonly status: number;

	constructor(status: number) {
		super(`Model request failed with ${status}`);
		this.name = "FetchFailure";
		this.status = status;
	}
}

async function fetchModel(src: string, signal: AbortSignal): Promise<ArrayBuffer> {
	const response = await fetch(src, { signal, credentials: "same-origin" });
	if (!response.ok) {
		await response.body?.cancel();
		throw new FetchFailure(response.status);
	}
	return await response.arrayBuffer();
}

function loadFailure(error: unknown): string {
	if (error instanceof FetchFailure && error.status === 429) {
		return "Too many previews were opened at once. Wait a minute, then reload the page.";
	}
	if (error instanceof FetchFailure) return "This file couldn't be loaded.";
	return "The 3D preview couldn't start. Check your connection and reload the page.";
}

function parseFailure(error: unknown): string {
	if (error instanceof MissingResourcesError) return missingGeometryReason(error.names);
	if (error instanceof EmptyModelError) return "This 3D file doesn't contain anything to show.";
	return "This 3D file couldn't be read. It may be damaged, or use features the preview doesn't support.";
}

/** The WebGL canvas: loads the engine and the file, then hands both to the model engine. */
export function ModelStage({ shell, tools }: ViewerProps<ModelTools>): JSX.Element {
	const hostRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	warmThree();

	useEffect(() => {
		const host = hostRef.current;
		const canvas = canvasRef.current;
		if (!host || !canvas) return;
		const abort = new AbortController();
		const { signal } = abort;
		let engine: ModelEngine | null = null;

		const run = async (): Promise<void> => {
			const { asset } = shell;
			const format = asset.modelFormat;
			if (!format) {
				shell.fail("This 3D format can't be previewed.");
				return;
			}
			if (asset.sizeBytes > MODEL_BYTES_LIMIT) {
				shell.fail("This model is too large to preview here. Download it to open it in a 3D app.");
				return;
			}
			let loaded: Awaited<ReturnType<typeof loadThree>>;
			let buffer: ArrayBuffer;
			try {
				[loaded, buffer] = await Promise.all([loadThree(), fetchModel(asset.src, signal)]);
			} catch (error) {
				if (!signal.aborted) shell.fail(loadFailure(error));
				return;
			}
			if (signal.aborted) return;
			try {
				engine = createModelEngine({ rt: loaded, canvas, host, tools, shell, format });
			} catch (error) {
				shell.fail(
					error instanceof WebGLUnavailableError
						? "3D preview needs WebGL, which isn't available in this browser."
						: "The 3D preview couldn't start.",
				);
				return;
			}
			tools.attach(engine);
			let model: ParsedModel;
			try {
				model = await parseModel(loaded, engine.renderer, format, buffer);
			} catch (error) {
				if (!signal.aborted) shell.fail(parseFailure(error));
				return;
			}
			if (signal.aborted) {
				disposeObject(model.root);
				model.release();
				return;
			}
			try {
				engine.show(model);
			} catch (error) {
				shell.fail(parseFailure(error));
				return;
			}
			shell.status.value = "ready";
		};
		void run();

		const stage = host.closest<HTMLElement>(".ins-stage") ?? host;
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || (event.repeat && event.key === " ")) return;
			if (engine?.handleKey(event)) event.preventDefault();
		};
		stage.addEventListener("keydown", onKey);

		return () => {
			abort.abort();
			stage.removeEventListener("keydown", onKey);
			tools.attach(null);
			tools.ready.value = false;
			engine?.dispose();
			engine = null;
		};
	}, []);

	const cameraValue = tools.camera.value;
	const lookingThrough = cameraValue === FREE_ORBIT
		? null
		: tools.cameras.value.find((c) => c.value === cameraValue) ?? null;
	const notice = tools.notice.value;
	const environmentBackdrop = tools.environmentBackground.value &&
		tools.environment.value !== "none";

	return (
		<div
			ref={hostRef}
			class="ins-model"
			data-background={environmentBackdrop ? "environment" : tools.background.value}
		>
			<canvas
				ref={canvasRef}
				class="ins-model__canvas"
				role="img"
				aria-label={`3D view of ${shell.asset.name}. Drag to orbit, right-drag or Shift-drag to pan, scroll or pinch to zoom.`}
			/>
			<div class="ins-model__swatches" aria-hidden="true">
				{SWATCHES.map((name) => (
					<span
						key={name}
						class={`ins-model__swatch ins-model__swatch--${name}`}
						data-swatch={name}
					/>
				))}
			</div>
			{notice
				? (
					<div class="ins-model__notice" role="status">
						<Icon name="info" size="sm" />
						<p class="ins-model__notice-text">{notice}</p>
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							icon={<Icon name="close" size="sm" />}
							aria-label="Dismiss notice"
							onClick={() => (tools.notice.value = null)}
						/>
					</div>
				)
				: null}
			{lookingThrough
				? (
					<div class="ins-model__lens">
						<span class="ins-model__lens-text">
							<span class="ins-model__lens-label">Camera</span>
							{lookingThrough.label}
						</span>
						<Button
							size="sm"
							variant="text"
							severity="secondary"
							icon={<Icon name="orbit-rotate" size="sm" />}
							label="Free orbit"
							onClick={() => (tools.camera.value = FREE_ORBIT)}
						/>
					</div>
				)
				: null}
		</div>
	);
}
