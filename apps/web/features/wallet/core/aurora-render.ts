/**
 * aurora-render.ts — the two ways the wallet hero's aurora reaches its canvas, and the DOM read of the
 * colours it paints with.
 *
 * - WebGL2 draws the field ({@link AURORA_FRAGMENT_SHADER}) as one full-screen triangle into a small
 *   backing store (never device-pixel-ratio sized) that CSS stretches over the hero.
 * - Canvas 2D computes the same field on the CPU into ~96 × 54 pixels of `ImageData`, which CSS
 *   upscales smoothly — soft gradients survive it. The noise half is sampled on a half-resolution
 *   lattice and interpolated ({@link WarpLattice}), since it is smooth at that scale and costs most of
 *   the frame; the colour half ({@link shadeWarped}) runs per pixel.
 *
 * Both are created against a canvas the runtime hands them and own nothing else; `dispose()` releases
 * the context for good (the WebGL one through `WEBGL_lose_context`).
 */

import {
	AURORA_INK_TOKENS,
	AURORA_PALETTE_TOKENS,
	type AuroraPalette,
	type AuroraRendererKind,
	cpuResolution,
	parseCssColor,
	type Rgb,
	type Rgba,
	webglResolution,
} from "./aurora-engine.ts";
import {
	AURORA_FRAGMENT_SHADER,
	AURORA_VERTEX_SHADER,
	ditherAt,
	shadeWarped,
	WarpLattice,
} from "./aurora-field.ts";

// #region Renderer contract
/** A live aurora renderer bound to one canvas. */
export interface AuroraRenderer {
	readonly kind: AuroraRendererKind;
	/** Size the backing store for a hero of `cssWidth` × `cssHeight` CSS pixels. */
	resize(cssWidth: number, cssHeight: number): void;
	/** Set the five colours and the luminance ceiling every pixel is clamped to. */
	setPalette(palette: AuroraPalette, ceiling: number): void;
	/** Paint one frame at animation time `time` (seconds). */
	draw(time: number): void;
	/** Release the context for good. */
	dispose(): void;
}

/**
 * The outcome of asking for a WebGL2 renderer: the renderer; `unavailable` when no context was
 * created (the canvas is untouched and can still take a 2D context); or `tainted` when a context was
 * created but the program could not be built — that canvas is bound to WebGL for life, so a 2D
 * fallback needs a fresh element.
 */
export type WebGL2Outcome =
	| { ok: true; renderer: AuroraRenderer }
	| { ok: false; reason: "unavailable" | "tainted" };
// #endregion

// #region WebGL2
function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function loseContext(gl: WebGL2RenderingContext): void {
	try {
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	} catch {
		// Losing an already-lost context throws in some engines; there is nothing left to release.
	}
}

/**
 * Create the WebGL2 renderer on `canvas`. `allowSoftware` lifts `failIfMajorPerformanceCaveat`, so a
 * software rasteriser (which would cost more than the CPU path) is refused unless the developer
 * forced the shader on. `onLost` fires once if the browser takes the context away.
 */
export function createWebGL2Renderer(
	canvas: HTMLCanvasElement,
	options: { allowSoftware: boolean; onLost: () => void },
): WebGL2Outcome {
	let gl: WebGL2RenderingContext | null = null;
	try {
		gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: true,
			preserveDrawingBuffer: false,
			powerPreference: "low-power",
			failIfMajorPerformanceCaveat: !options.allowSoftware,
		});
	} catch {
		gl = null;
	}
	if (!gl) return { ok: false, reason: "unavailable" };

	const vs = compile(gl, gl.VERTEX_SHADER, AURORA_VERTEX_SHADER);
	const fs = compile(gl, gl.FRAGMENT_SHADER, AURORA_FRAGMENT_SHADER);
	const program = gl.createProgram();
	const vao = gl.createVertexArray();
	if (!vs || !fs || !program || !vao) {
		loseContext(gl);
		return { ok: false, reason: "tainted" };
	}
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		loseContext(gl);
		return { ok: false, reason: "tainted" };
	}

	const ctx = gl;
	const at = (name: string) => ctx.getUniformLocation(program, name);
	const uniforms = {
		resolution: at("uResolution"),
		aspect: at("uAspect"),
		time: at("uTime"),
		ceiling: at("uCeiling"),
		base: at("uBase"),
		deep: at("uDeep"),
		cobalt: at("uCobalt"),
		violet: at("uViolet"),
		cyan: at("uCyan"),
	};
	ctx.useProgram(program);
	ctx.bindVertexArray(vao);
	ctx.disable(ctx.DEPTH_TEST);
	ctx.disable(ctx.BLEND);

	let disposed = false;
	let aspect = 1;
	const onLost = () => {
		if (disposed) return;
		disposed = true;
		options.onLost();
	};
	canvas.addEventListener("webglcontextlost", onLost);

	const rgb = (loc: WebGLUniformLocation | null, c: Rgb) => ctx.uniform3f(loc, c[0], c[1], c[2]);

	return {
		ok: true,
		renderer: {
			kind: "webgl2",
			resize(cssWidth, cssHeight) {
				if (disposed) return;
				const size = webglResolution(cssWidth, cssHeight);
				aspect = Math.max(cssWidth, 1) / Math.max(cssHeight, 1);
				if (canvas.width !== size.width) canvas.width = size.width;
				if (canvas.height !== size.height) canvas.height = size.height;
				ctx.viewport(0, 0, size.width, size.height);
				ctx.uniform2f(uniforms.resolution, size.width, size.height);
				ctx.uniform1f(uniforms.aspect, aspect);
			},
			setPalette(palette, ceiling) {
				if (disposed) return;
				rgb(uniforms.base, palette.base);
				rgb(uniforms.deep, palette.deep);
				rgb(uniforms.cobalt, palette.cobalt);
				rgb(uniforms.violet, palette.violet);
				rgb(uniforms.cyan, palette.cyan);
				ctx.uniform1f(uniforms.ceiling, ceiling);
			},
			draw(time) {
				if (disposed || ctx.isContextLost()) return;
				ctx.uniform1f(uniforms.time, time);
				ctx.drawArrays(ctx.TRIANGLES, 0, 3);
			},
			dispose() {
				if (disposed) return;
				disposed = true;
				canvas.removeEventListener("webglcontextlost", onLost);
				if (!ctx.isContextLost()) {
					ctx.deleteVertexArray(vao);
					ctx.deleteProgram(program);
					ctx.deleteShader(vs);
					ctx.deleteShader(fs);
				}
				loseContext(ctx);
			},
		},
	};
}
// #endregion

// #region Canvas 2D
/** Create the CPU renderer on `canvas`, or `null` when the canvas cannot give a 2D context. */
export function createCanvas2DRenderer(canvas: HTMLCanvasElement): AuroraRenderer | null {
	let ctx: CanvasRenderingContext2D | null = null;
	try {
		ctx = canvas.getContext("2d", { alpha: false });
	} catch {
		ctx = null;
	}
	if (!ctx) return null;
	const c2d = ctx;

	let image: ImageData | null = null;
	let aspect = 1;
	let palette: AuroraPalette | null = null;
	let ceiling = 0;
	let disposed = false;
	const px = [0, 0, 0];
	const warp = [0, 0, 0];
	const lattice = new WarpLattice();

	return {
		kind: "canvas2d",
		resize(cssWidth, cssHeight) {
			if (disposed) return;
			const size = cpuResolution(cssWidth, cssHeight);
			aspect = Math.max(cssWidth, 1) / Math.max(cssHeight, 1);
			if (canvas.width !== size.width) canvas.width = size.width;
			if (canvas.height !== size.height) canvas.height = size.height;
			if (!image || image.width !== size.width || image.height !== size.height) {
				image = c2d.createImageData(size.width, size.height);
			}
		},
		setPalette(next, nextCeiling) {
			palette = next;
			ceiling = nextCeiling;
		},
		draw(time) {
			if (disposed || !image || !palette) return;
			const { width, height, data } = image;
			lattice.sample(width, height, aspect, time);
			let i = 0;
			for (let y = 0; y < height; y++) {
				const v = (y + 0.5) / height;
				for (let x = 0; x < width; x++) {
					lattice.at(x, y, warp);
					shadeWarped(
						(x + 0.5) / width,
						v,
						aspect,
						warp[0],
						warp[1],
						warp[2],
						palette,
						ceiling,
						px,
					);
					const d = ditherAt(x, y);
					data[i] = px[0] * 255 + d;
					data[i + 1] = px[1] * 255 + d;
					data[i + 2] = px[2] * 255 + d;
					data[i + 3] = 255;
					i += 4;
				}
			}
			c2d.putImageData(image, 0, 0);
		},
		dispose() {
			disposed = true;
			image = null;
			canvas.width = 0;
			canvas.height = 0;
		},
	};
}
// #endregion

// #region Colour sampling
let scratch: CanvasRenderingContext2D | null | undefined;

/**
 * Normalise any colour the browser understands to straight-alpha sRGB: the common computed forms are
 * parsed directly, and anything else (`oklab()`, `lab()`, `color(display-p3 …)`, …) is painted into a
 * 1 × 1 canvas and read back, which converts it into the canvas's sRGB space.
 */
export function normalizeColor(value: string): Rgba | null {
	const parsed = parseCssColor(value);
	if (parsed) return parsed;
	if (scratch === undefined) {
		const c = document.createElement("canvas");
		c.width = 1;
		c.height = 1;
		scratch = c.getContext("2d", { willReadFrequently: true });
	}
	if (!scratch) return null;
	scratch.fillStyle = "transparent";
	const sentinel = scratch.fillStyle;
	scratch.fillStyle = value;
	if (scratch.fillStyle === sentinel) return null;
	scratch.clearRect(0, 0, 1, 1);
	scratch.fillRect(0, 0, 1, 1);
	const d = scratch.getImageData(0, 0, 1, 1).data;
	return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
}

/**
 * Resolve custom-property colour tokens to sRGB through the CSS engine, so every syntax resolves —
 * `var()` chains, `color-mix()`, relative colours, wide-gamut spaces. Each token is assigned to a
 * hidden, never-painted probe span inside `host` (so it inherits the host's cascade, theme overlays
 * included), its computed `color` is read, and the probe is removed in the same task. A token the
 * cascade does not define resolves to `null` rather than to the inherited colour.
 */
export function readTokenColors(host: HTMLElement, tokens: readonly string[]): (Rgba | null)[] {
	const declared = getComputedStyle(host);
	const probe = document.createElement("span");
	probe.hidden = true;
	host.append(probe);
	try {
		const computed = getComputedStyle(probe);
		return tokens.map((token) => {
			if (!declared.getPropertyValue(token).trim()) return null;
			probe.style.setProperty("color", `var(${token})`);
			return normalizeColor(computed.color);
		});
	} finally {
		probe.remove();
	}
}

/** The aurora's palette and the hero's inks, as the cascade currently resolves them. */
export interface AuroraColors {
	palette: AuroraPalette;
	ink: Rgba;
	softInk: Rgba;
	/** The resting glass fill under the hero's controls, when the cascade defines it. */
	glassFill: Rgba | null;
}

/** Read {@link AuroraColors} from `host`, or `null` when a palette colour or an ink does not resolve. */
export function readAuroraColors(host: HTMLElement): AuroraColors | null {
	const roles = Object.keys(AURORA_PALETTE_TOKENS) as (keyof AuroraPalette)[];
	const resolved = readTokenColors(host, [
		...roles.map((role) => AURORA_PALETTE_TOKENS[role]),
		AURORA_INK_TOKENS.ink,
		AURORA_INK_TOKENS.soft,
		AURORA_INK_TOKENS.glass,
	]);
	const [ink, softInk, glassFill] = resolved.slice(roles.length);
	if (!ink || !softInk || resolved.slice(0, roles.length).some((c) => !c)) return null;
	const palette = Object.fromEntries(
		roles.map((role, i) => {
			const c = resolved[i]!;
			return [role, [c[0], c[1], c[2]] as Rgb];
		}),
	) as unknown as AuroraPalette;
	return { palette, ink, softInk, glassFill };
}
// #endregion
