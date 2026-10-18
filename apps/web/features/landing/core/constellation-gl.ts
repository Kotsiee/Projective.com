/// <reference lib="dom" />

/**
 * constellation-gl.ts — the B1 constellation on raw WebGL2 (Decision #280: no dependency). Loaded
 * only through `import()` once the background gate says `webgl`, so none of it is in the island's
 * initial chunk (`flows/LANDING.md` §7).
 *
 * It owns one canvas inside the background: the context, two instanced programs (links, then nodes),
 * the frame loop, the pointer, the size, the palette read back from the `--lp-*` tokens and the frame
 * watchdog. The world itself is `constellation.ts`; the gate, the observers and the fallback are the
 * island's. The loop draws only while the world moves: once it settles (WCAG 2.2.2) nothing runs
 * until the pointer moves, the box resizes, the zones or the theme change.
 *
 * Failure never throws and leaks nothing. A context that cannot be created, a program that does not
 * link or tokens that do not resolve make {@link mountConstellation} return a reason instead of a
 * handle, after deleting whatever GL objects were made and releasing the context; a lost context
 * hides the canvas and waits {@link RESTORE_TIMEOUT_MS} for a restore before giving up; a frame that
 * throws or a slow device (the watchdog) ends the canvas through `onFail`.
 */
import {
	type ConstellationPalette,
	type ConstellationState,
	createConstellation,
	frameSeconds,
	MAX_LINKS,
	MAX_ZONES,
	percentile,
	type Pointer,
	pokeConstellation,
	resizeConstellation,
	type Rgb,
	stepConstellation,
	WATCHDOG_P95_BUDGET_MS,
	WATCHDOG_SAMPLE_FRAMES,
	WATCHDOG_WARMUP_FRAMES,
	type Zone,
	type ZoneCaps,
	zoneCaps,
} from "./constellation.ts";
import type { BackgroundFailure } from "./background-gate.ts";
import { LINK_ATTRIBUTES, LINK_FRAGMENT, LINK_VERTEX } from "./shaders/links.ts";
import { NODE_ATTRIBUTES, NODE_FRAGMENT, NODE_VERTEX } from "./shaders/nodes.ts";

// #region Contract
/** The canvas backing store never exceeds this many device pixels per CSS px. */
export const MAX_DEVICE_PIXEL_RATIO = 1.5;

/** How long a lost context may take to come back before the canvas is given up (ms). */
export const RESTORE_TIMEOUT_MS = 5000;

/** The feather (CSS px) outside each quiet zone over which the cap eases in. */
export const ZONE_FEATHER_PX = 12;

/** What the island hears from a mounted constellation. */
export interface ConstellationCallbacks {
	/** The first frame (or the first after a restore) is on screen: crossfade the fallback out. */
	onLive(): void;
	/** The context was lost: show the fallback while a restore may still come. */
	onLost(): void;
	/** The canvas is done for this page view; the island tears it down. */
	onFail(reason: BackgroundFailure): void;
}

/** Options for {@link mountConstellation}. */
export interface ConstellationOptions extends ConstellationCallbacks {
	/** The quiet zones measured so far (copy, then halo boxes). */
	zones: readonly Zone[];
	/** Accept a software rasteriser (the developer forced WebGL); otherwise one is refused. */
	allowSoftware: boolean;
}

/** A mounted constellation. */
export interface ConstellationHandle {
	/** Replace the quiet zones (the island re-measures on resize and on copy changes). */
	setZones(zones: readonly Zone[]): void;
	/** Draw (`true`) or hold the current frame (`false`: tab hidden, hero offscreen). */
	setRunning(running: boolean): void;
	/** Re-read the palette from the tokens (theme, contrast or motion attribute changed). */
	refreshPalette(): void;
	/** Stop, release the context, remove the canvas and every listener. Idempotent. */
	destroy(): void;
}

/** {@link mountConstellation}'s result. */
export type MountResult =
	| { ok: true; handle: ConstellationHandle }
	| { ok: false; reason: "no-webgl" | "no-tokens" };
// #endregion

// #region Tokens
let scratch: CanvasRenderingContext2D | null | undefined;

/** Parse the computed colour forms browsers return (`rgb()`, `rgba()`, `color(srgb …)`). */
function parseComputedColor(value: string): Rgb | null {
	const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
	if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
	const srgb = value.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
	if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
	return null;
}

/** Any other colour syntax is painted into a 1 × 1 canvas and read back as sRGB. */
function sampleColor(value: string): Rgb | null {
	if (scratch === undefined) {
		const c = document.createElement("canvas");
		c.width = 1;
		c.height = 1;
		scratch = c.getContext("2d", { willReadFrequently: true });
	}
	if (!scratch) return null;
	scratch.clearRect(0, 0, 1, 1);
	scratch.fillStyle = value;
	scratch.fillRect(0, 0, 1, 1);
	const d = scratch.getImageData(0, 0, 1, 1).data;
	return [d[0] / 255, d[1] / 255, d[2] / 255];
}

/**
 * Resolve colour tokens through the CSS engine: each is assigned to a hidden, never-painted probe
 * inside `host` (so the theme and contrast overlays apply), its computed `color` read, the probe
 * removed in the same task. An undeclared token resolves to `null`.
 */
function readColors(host: HTMLElement, tokens: readonly string[]): (Rgb | null)[] {
	const declared = getComputedStyle(host);
	const probe = document.createElement("span");
	probe.hidden = true;
	host.append(probe);
	try {
		const computed = getComputedStyle(probe);
		return tokens.map((token) => {
			if (!declared.getPropertyValue(token).trim()) return null;
			probe.style.setProperty("color", `var(${token})`);
			return parseComputedColor(computed.color) ?? sampleColor(computed.color);
		});
	} finally {
		probe.remove();
	}
}

function readNumber(style: CSSStyleDeclaration, token: string): number {
	const raw = style.getPropertyValue(token).trim();
	return raw ? Number.parseFloat(raw) : Number.NaN;
}

/** The constellation's palette as the cascade resolves it at `host`, or `null` if a token is missing. */
export function readPalette(host: HTMLElement): ConstellationPalette | null {
	const [node, bg] = readColors(host, ["--lp-node", "--lp-bg"]);
	if (!node || !bg) return null;
	const style = getComputedStyle(host);
	const alpha = readNumber(style, "--lp-node-alpha");
	const quietAlpha = readNumber(style, "--lp-node-alpha-quiet");
	const haloAlpha = readNumber(style, "--lp-node-alpha-halo");
	const lumLimit = readNumber(style, "--lp-bg-lum-max");
	if (![alpha, quietAlpha, haloAlpha, lumLimit].every(Number.isFinite)) return null;
	return { node, bg, alpha, quietAlpha, haloAlpha, lumLimit };
}
// #endregion

// #region Pipeline
interface Program {
	program: WebGLProgram;
	vao: WebGLVertexArrayObject;
	instances: WebGLBuffer;
	corners: WebGLBuffer;
	u: Record<
		"resolution" | "color" | "cap" | "zones" | "zoneCap" | "zoneCount" | "feather",
		WebGLUniformLocation | null
	>;
}

interface Pipeline {
	nodes: Program;
	links: Program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	gl.deleteShader(shader);
	return null;
}

/**
 * Link one instanced program: a static four-corner strip at location 0 and an instance buffer whose
 * `layout` lists each per-instance attribute's location and float count, in buffer order.
 */
function buildProgram(
	gl: WebGL2RenderingContext,
	vertex: string,
	fragment: string,
	corners: readonly number[],
	layout: readonly { location: number; size: number }[],
	instanceFloats: number,
): Program | null {
	const vs = compile(gl, gl.VERTEX_SHADER, vertex);
	const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
	const program = gl.createProgram();
	if (!vs || !fs || !program) {
		if (vs) gl.deleteShader(vs);
		if (fs) gl.deleteShader(fs);
		if (program) gl.deleteProgram(program);
		return null;
	}
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}
	const vao = gl.createVertexArray();
	const cornerBuffer = gl.createBuffer();
	const instances = gl.createBuffer();
	if (!vao || !cornerBuffer || !instances) {
		if (vao) gl.deleteVertexArray(vao);
		if (cornerBuffer) gl.deleteBuffer(cornerBuffer);
		if (instances) gl.deleteBuffer(instances);
		gl.deleteProgram(program);
		return null;
	}
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, instances);
	gl.bufferData(gl.ARRAY_BUFFER, instanceFloats * 4, gl.DYNAMIC_DRAW);
	const stride = layout.reduce((sum, a) => sum + a.size, 0) * 4;
	let offset = 0;
	for (const attr of layout) {
		gl.enableVertexAttribArray(attr.location);
		gl.vertexAttribPointer(attr.location, attr.size, gl.FLOAT, false, stride, offset);
		gl.vertexAttribDivisor(attr.location, 1);
		offset += attr.size * 4;
	}
	gl.bindVertexArray(null);
	const at = (name: string) => gl.getUniformLocation(program, name);
	return {
		program,
		vao,
		instances,
		corners: cornerBuffer,
		u: {
			resolution: at("u_resolution"),
			color: at("u_color"),
			cap: at("u_cap"),
			zones: at("u_zones"),
			zoneCap: at("u_zoneCap"),
			zoneCount: at("u_zoneCount"),
			feather: at("u_feather"),
		},
	};
}

function buildPipeline(gl: WebGL2RenderingContext, nodeCount: number): Pipeline | null {
	const nodes = buildProgram(
		gl,
		NODE_VERTEX,
		NODE_FRAGMENT,
		[-1, -1, 1, -1, -1, 1, 1, 1],
		[
			{ location: NODE_ATTRIBUTES.node, size: 4 },
			{ location: NODE_ATTRIBUTES.lit, size: 1 },
		],
		nodeCount * 5,
	);
	const links = buildProgram(
		gl,
		LINK_VERTEX,
		LINK_FRAGMENT,
		[0, -1, 1, -1, 0, 1, 1, 1],
		[
			{ location: LINK_ATTRIBUTES.segment, size: 4 },
			{ location: LINK_ATTRIBUTES.alpha, size: 1 },
		],
		MAX_LINKS * 5,
	);
	if (!nodes || !links) {
		if (nodes) releaseProgram(gl, nodes);
		if (links) releaseProgram(gl, links);
		return null;
	}
	return { nodes, links };
}

function releaseProgram(gl: WebGL2RenderingContext, prog: Program): void {
	gl.deleteVertexArray(prog.vao);
	gl.deleteBuffer(prog.instances);
	gl.deleteBuffer(prog.corners);
	gl.deleteProgram(prog.program);
}

function releasePipeline(gl: WebGL2RenderingContext, p: Pipeline): void {
	releaseProgram(gl, p.nodes);
	releaseProgram(gl, p.links);
}
// #endregion

// #region Mount
/**
 * Mount the live constellation in `host` (the `.lp-bg` element; the canvas goes into its
 * `.lp-bg__gl` slot). Returns a handle, or why it could not start; on failure nothing is left behind.
 */
export function mountConstellation(host: HTMLElement, options: ConstellationOptions): MountResult {
	const palette0 = readPalette(host);
	if (!palette0) return { ok: false, reason: "no-tokens" };

	const canvas = document.createElement("canvas");
	canvas.className = "lp-bg__canvas";
	canvas.setAttribute("aria-hidden", "true");
	(host.querySelector(".lp-bg__gl") ?? host).append(canvas);

	let gl: WebGL2RenderingContext | null = null;
	try {
		gl = canvas.getContext("webgl2", {
			alpha: true,
			premultipliedAlpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: false,
			powerPreference: "low-power",
			failIfMajorPerformanceCaveat: !options.allowSoftware,
		});
	} catch {
		gl = null;
	}
	const width0 = Math.max(1, host.clientWidth);
	const height0 = Math.max(1, host.clientHeight);
	const sim: ConstellationState = createConstellation(width0, height0);
	let pipeline = gl ? buildPipeline(gl, sim.count) : null;
	if (!gl || !pipeline) {
		gl?.getExtension("WEBGL_lose_context")?.loseContext();
		canvas.remove();
		return { ok: false, reason: "no-webgl" };
	}
	const ctx: WebGL2RenderingContext = gl;

	let palette: ConstellationPalette = palette0;
	let caps: ZoneCaps = zoneCaps(palette);
	let zones: readonly Zone[] = options.zones;
	const zoneData = new Float32Array(MAX_ZONES * 4);
	const zoneCapData = new Float32Array(MAX_ZONES);
	let zoneCount = 0;

	let disposed = false;
	let running = false;
	let lost = false;
	let live = false;
	let raf = 0;
	let last: number | null = null;
	let sizeDirty = true;
	let paletteDirty = false;
	let zonesDirty = true;
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;

	let warmup = WATCHDOG_WARMUP_FRAMES;
	const samples: number[] = [];
	let judged = false;

	let clientX = 0;
	let clientY = 0;
	let hasPointer = false;
	let pointerPending = false;
	let current: Pointer | null = null;
	const hit: Pointer = { x: 0, y: 0 };
	let needsRender = true;
	let dprQuery: MediaQueryList | null = null;

	// #region Uploads
	function applySize(): void {
		const w = Math.max(1, host.clientWidth);
		const h = Math.max(1, host.clientHeight);
		const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
		const bw = Math.max(1, Math.round(w * dpr));
		const bh = Math.max(1, Math.round(h * dpr));
		if (canvas.width !== bw) canvas.width = bw;
		if (canvas.height !== bh) canvas.height = bh;
		ctx.viewport(0, 0, bw, bh);
		if (w !== sim.width || h !== sim.height) resizeConstellation(sim, w, h);
		sizeDirty = false;
		needsRender = true;
	}

	function applyZones(): void {
		zoneCount = Math.min(MAX_ZONES, zones.length);
		zoneData.fill(0);
		zoneCapData.fill(0);
		for (let i = 0; i < zoneCount; i++) {
			const z = zones[i];
			zoneData.set([z.x0, z.y0, z.x1, z.y1], i * 4);
			zoneCapData[i] = z.kind === "halo" ? caps.halo : caps.copy;
		}
		zonesDirty = false;
		needsRender = true;
	}

	function applyPalette(): void {
		const next = readPalette(host);
		if (next) {
			palette = next;
			caps = zoneCaps(palette);
			zonesDirty = true;
		}
		paletteDirty = false;
	}

	function uniforms(prog: Program): void {
		ctx.useProgram(prog.program);
		ctx.uniform2f(prog.u.resolution, sim.width, sim.height);
		ctx.uniform3f(prog.u.color, palette.node[0], palette.node[1], palette.node[2]);
		ctx.uniform1f(prog.u.cap, caps.full);
		ctx.uniform4fv(prog.u.zones, zoneData);
		ctx.uniform1fv(prog.u.zoneCap, zoneCapData);
		ctx.uniform1i(prog.u.zoneCount, zoneCount);
		ctx.uniform1f(prog.u.feather, ZONE_FEATHER_PX);
	}
	// #endregion

	// #region Draw
	function render(p: Pipeline): void {
		ctx.clearColor(0, 0, 0, 0);
		ctx.clear(ctx.COLOR_BUFFER_BIT);
		ctx.enable(ctx.BLEND);
		ctx.blendEquation(ctx.MAX);
		ctx.blendFunc(ctx.ONE, ctx.ONE);

		if (sim.linkCount > 0) {
			uniforms(p.links);
			ctx.bindBuffer(ctx.ARRAY_BUFFER, p.links.instances);
			ctx.bufferSubData(ctx.ARRAY_BUFFER, 0, sim.linkData, 0, sim.linkCount * 5);
			ctx.bindVertexArray(p.links.vao);
			ctx.drawArraysInstanced(ctx.TRIANGLE_STRIP, 0, 4, sim.linkCount);
		}
		uniforms(p.nodes);
		ctx.bindBuffer(ctx.ARRAY_BUFFER, p.nodes.instances);
		ctx.bufferSubData(ctx.ARRAY_BUFFER, 0, sim.nodeData);
		ctx.bindVertexArray(p.nodes.vao);
		ctx.drawArraysInstanced(ctx.TRIANGLE_STRIP, 0, 4, sim.count);
		ctx.bindVertexArray(null);
	}

	/** The pointer in the background's px, written into one reused object, or `null` off the box. */
	function pointer(): Pointer | null {
		if (!hasPointer) return null;
		const r = host.getBoundingClientRect();
		const x = clientX - r.left;
		const y = clientY - r.top;
		if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
		hit.x = x;
		hit.y = y;
		return hit;
	}

	function watch(interval: number): void {
		if (judged) return;
		if (warmup > 0) {
			warmup -= 1;
			return;
		}
		samples.push(interval);
		if (samples.length < WATCHDOG_SAMPLE_FRAMES) return;
		judged = true;
		if (!options.allowSoftware && percentile(samples, 0.95) > WATCHDOG_P95_BUDGET_MS) {
			fail("watchdog");
		}
	}

	/** Read the pointer once per frame; only movement over the hero (or leaving it) restarts motion. */
	function takePointer(): void {
		if (!pointerPending) return;
		pointerPending = false;
		const next = pointer();
		if (next || current) pokeConstellation(sim);
		current = next;
	}

	const frame = (now: number) => {
		raf = 0;
		if (disposed || lost || !running || !pipeline) return;
		const dt = frameSeconds(last, now);
		if (last !== null) watch(now - last);
		if (disposed) return;
		try {
			if (sizeDirty) applySize();
			if (paletteDirty) applyPalette();
			if (zonesDirty) applyZones();
			takePointer();
			const wasSettled = sim.settled;
			const moving = stepConstellation(sim, dt, current);
			if (moving || !wasSettled || needsRender || !live) {
				render(pipeline);
				needsRender = false;
			}
			if (!live) {
				live = true;
				options.onLive();
			}
			if (moving) {
				last = now;
				schedule();
			} else {
				last = null;
			}
		} catch {
			fail("render-error");
		}
	};

	function schedule(): void {
		if (!raf && running && !lost && !disposed) raf = requestAnimationFrame(frame);
	}

	function stop(): void {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		last = null;
	}

	function fail(reason: BackgroundFailure): void {
		if (disposed) return;
		stop();
		options.onFail(reason);
	}
	// #endregion

	// #region Listeners
	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerType === "touch") return;
		clientX = event.clientX;
		clientY = event.clientY;
		hasPointer = true;
		pointerPending = true;
		schedule();
	};
	const onPointerLeave = () => {
		if (!hasPointer) return;
		hasPointer = false;
		pointerPending = true;
		schedule();
	};
	const onResize = () => {
		sizeDirty = true;
		schedule();
	};
	/** The backing store follows the device pixel ratio too (a window moved to another screen). */
	const onPixelRatio = () => {
		watchPixelRatio();
		onResize();
	};
	function watchPixelRatio(): void {
		dprQuery?.removeEventListener("change", onPixelRatio);
		const dpr = globalThis.devicePixelRatio || 1;
		dprQuery = globalThis.matchMedia?.(`(resolution: ${dpr}dppx)`) ?? null;
		dprQuery?.addEventListener("change", onPixelRatio);
	}
	const onLost = (event: Event) => {
		event.preventDefault();
		lost = true;
		live = false;
		stop();
		options.onLost();
		restoreTimer = setTimeout(() => fail("context-lost"), RESTORE_TIMEOUT_MS);
	};
	const onRestored = () => {
		if (restoreTimer !== null) clearTimeout(restoreTimer);
		restoreTimer = null;
		pipeline = buildPipeline(ctx, sim.count);
		if (!pipeline) {
			fail("context-lost");
			return;
		}
		lost = false;
		sizeDirty = true;
		zonesDirty = true;
		needsRender = true;
		schedule();
	};

	globalThis.addEventListener("pointermove", onPointerMove, { passive: true });
	document.documentElement.addEventListener("pointerleave", onPointerLeave);
	canvas.addEventListener("webglcontextlost", onLost);
	canvas.addEventListener("webglcontextrestored", onRestored);
	const sizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
	sizeObserver?.observe(host);
	watchPixelRatio();
	// #endregion

	return {
		ok: true,
		handle: {
			setZones(next) {
				zones = next;
				zonesDirty = true;
				schedule();
			},
			setRunning(next) {
				if (next === running) return;
				running = next;
				if (running) schedule();
				else stop();
			},
			refreshPalette() {
				paletteDirty = true;
				schedule();
			},
			destroy() {
				if (disposed) return;
				disposed = true;
				stop();
				if (restoreTimer !== null) clearTimeout(restoreTimer);
				globalThis.removeEventListener("pointermove", onPointerMove);
				document.documentElement.removeEventListener("pointerleave", onPointerLeave);
				canvas.removeEventListener("webglcontextlost", onLost);
				canvas.removeEventListener("webglcontextrestored", onRestored);
				sizeObserver?.disconnect();
				dprQuery?.removeEventListener("change", onPixelRatio);
				dprQuery = null;
				if (!lost && !ctx.isContextLost() && pipeline) releasePipeline(ctx, pipeline);
				pipeline = null;
				ctx.getExtension("WEBGL_lose_context")?.loseContext();
				canvas.remove();
			},
		},
	};
}
// #endregion
