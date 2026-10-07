/**
 * aurora-field.ts — the wallet hero's aurora field, written twice: once in TypeScript for the CPU
 * renderer and once in GLSL ES 3.00 for the WebGL2 renderer. The two are line-for-line mirrors and
 * share every constant below, so both paths paint the same picture.
 *
 * The field is the static hero gradient (wallet-hero.css) brought to life. Its five layers — base,
 * a 155° wash of deep indigo, a cobalt bridge, a violet glow and a cyan corner — are composited with
 * the same anchors, radii, stops and alphas as the CSS, in the same gamma-encoded space, so with no
 * warp and no sheen the canvas reproduces the resting gradient. 3D simplex noise over (x, y, time),
 * gently domain-warped twice, then drifts those anchors and lays long silk folds across them — bands
 * running on a fixed diagonal, bent by the warped noise, with a narrow sheen on their crests. The warps
 * are deliberately weak: warp gain compounds, and a strong one turns the folds into high-frequency
 * marbling that aliases at the small backing stores both renderers use. Last, every pixel's relative
 * luminance is clamped (hue-preserving) to the contrast ceiling the hero's inks allow.
 *
 * The simplex noise is the public-domain/MIT `snoise(vec3)` by Ian McEwan and Stefan Gustavson
 * (Ashima Arts, webgl-noise), ported to scalar TypeScript for the CPU path.
 */

import { type AuroraPalette, LUMA, type Rgb } from "./aurora-engine.ts";

// #region Shared constants
/** Animation speed: field time units per second of visible animation. */
export const AURORA_SPEED = 0.045;
/** Noise frequency: noise units per hero height. */
const NOISE_SCALE = 0.8;
/** First warp: how far the first noise pair displaces the second lookup. */
const WARP_Q = 0.55;
/** Second warp: how far the second noise pair displaces the fold lookup. */
const WARP_R = 0.6;
/** The fold lookup's own frequency, relative to the warp's. */
const FOLD_SCALE = 0.75;
/** How far (in hero widths/heights) the warp drifts the gradient's anchors. */
const DRIFT = 0.12;
/** Silk folds: bands per noise unit along the fold diagonal, and the diagonal's angle from the x axis. */
const SILK_BAND = 3.8;
const SILK_BAND_X = Math.cos((30 * Math.PI) / 180);
const SILK_BAND_Y = Math.sin((30 * Math.PI) / 180);
/** How far the fold field and the warp bend the bands (radians per unit). */
const SILK_FREQ = 2.3;
const SILK_TWIST = 0.5;
/** The sheen: crest sharpness, then troughs at the floor and crests at floor + range. */
const SHEEN_POW = 2.3;
const GAIN_FLOOR = 0.6;
const GAIN_RANGE = 1.05;
/** The 155° wash: its direction in screen space (y down) and the stop where it reaches full strength. */
const WASH_DX = Math.sin((155 * Math.PI) / 180);
const WASH_DY = -Math.cos((155 * Math.PI) / 180);
const WASH_STOP = 0.75;

/** One radial layer, as the CSS declares it: anchor, ellipse radii (box fractions), fade stop, alpha. */
interface RadialLayer {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	stop: number;
	alpha: number;
}

const COBALT: RadialLayer = { cx: 0.45, cy: 0.55, rx: 0.9, ry: 0.7, stop: 0.65, alpha: 0.6 };
const VIOLET: RadialLayer = { cx: 0.98, cy: 1.0, rx: 1.2, ry: 0.95, stop: 0.65, alpha: 0.7 };
const CYAN: RadialLayer = { cx: 0.02, cy: 0.0, rx: 1.1, ry: 0.9, stop: 0.6, alpha: 0.85 };

/** Format a constant as a GLSL float literal. */
function f(n: number): string {
	const s = String(Number(n.toFixed(8)));
	return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}
// #endregion

// #region Simplex noise (CPU)
const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number) => mod289((x * 34 + 10) * x);
const taylorInvSqrt = (r: number) => 1.79284291400159 - 0.85373472095314 * r;
const NS_X = 2 / 7;
const NS_Y = 0.5 / 7 - 1;
const NS_Z = 1 / 7;

function corner(p: number, dx: number, dy: number, dz: number): number {
	const m = 0.5 - (dx * dx + dy * dy + dz * dz);
	if (m <= 0) return 0;
	const j = p - 49 * Math.floor(p * NS_Z * NS_Z);
	const xi = Math.floor(j * NS_Z);
	const yi = Math.floor(j - 7 * xi);
	let gx = xi * NS_X + NS_Y;
	let gy = yi * NS_X + NS_Y;
	const h = 1 - Math.abs(gx) - Math.abs(gy);
	if (h <= 0) {
		gx -= Math.floor(gx) * 2 + 1;
		gy -= Math.floor(gy) * 2 + 1;
	}
	const norm = taylorInvSqrt(gx * gx + gy * gy + h * h);
	const m2 = m * m;
	return m2 * m2 * norm * (gx * dx + gy * dy + h * dz);
}

/** 3D simplex noise in roughly [-1, 1] — the scalar port of webgl-noise's `snoise(vec3)`. */
export function snoise3(vx: number, vy: number, vz: number): number {
	const s = (vx + vy + vz) / 3;
	let ix = Math.floor(vx + s);
	let iy = Math.floor(vy + s);
	let iz = Math.floor(vz + s);
	const t = (ix + iy + iz) / 6;
	const x0 = vx - ix + t;
	const y0 = vy - iy + t;
	const z0 = vz - iz + t;

	const gx = x0 >= y0 ? 1 : 0;
	const gy = y0 >= z0 ? 1 : 0;
	const gz = z0 >= x0 ? 1 : 0;
	const lx = 1 - gx;
	const ly = 1 - gy;
	const lz = 1 - gz;
	const i1x = Math.min(gx, lz);
	const i1y = Math.min(gy, lx);
	const i1z = Math.min(gz, ly);
	const i2x = Math.max(gx, lz);
	const i2y = Math.max(gy, lx);
	const i2z = Math.max(gz, ly);

	ix = mod289(ix);
	iy = mod289(iy);
	iz = mod289(iz);
	const p0 = permute(permute(permute(iz) + iy) + ix);
	const p1 = permute(permute(permute(iz + i1z) + iy + i1y) + ix + i1x);
	const p2 = permute(permute(permute(iz + i2z) + iy + i2y) + ix + i2x);
	const p3 = permute(permute(permute(iz + 1) + iy + 1) + ix + 1);

	return 105 * (
		corner(p0, x0, y0, z0) +
		corner(p1, x0 - i1x + 1 / 6, y0 - i1y + 1 / 6, z0 - i1z + 1 / 6) +
		corner(p2, x0 - i2x + 1 / 3, y0 - i2y + 1 / 3, z0 - i2z + 1 / 3) +
		corner(p3, x0 - 0.5, y0 - 0.5, z0 - 0.5)
	);
}
// #endregion

// #region The field (CPU)
function decode(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function encode(c: number): number {
	const v = Math.min(Math.max(c, 0), 1);
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function radial(layer: RadialLayer, wx: number, wy: number): number {
	const ex = (wx - layer.cx) / layer.rx;
	const ey = (wy - layer.cy) / layer.ry;
	return layer.alpha * Math.min(Math.max(1 - Math.hypot(ex, ey) / layer.stop, 0), 1);
}

function mixInto(out: number[], c: Rgb, a: number): void {
	out[0] += (c[0] - out[0]) * a;
	out[1] += (c[1] - out[1]) * a;
	out[2] += (c[2] - out[2]) * a;
}

/**
 * The noise half of the field at one point: the domain-warped pair `r` and the silk bands' phase (the
 * diagonal plus the bent fold noise), written as `[r.x, r.y, phase]` into `out`. All five simplex
 * lookups live here, and the result is smooth at the scale of a few backing-store pixels — the phase is
 * kept unwrapped, so its linear part interpolates exactly — so the CPU renderer samples it on a coarser
 * lattice and interpolates ({@link WarpLattice}).
 */
export function warpAurora(
	u: number,
	v: number,
	aspect: number,
	time: number,
	out: number[] = [0, 0, 0],
): number[] {
	const t = time * AURORA_SPEED;
	const px = u * aspect * NOISE_SCALE;
	const py = v * NOISE_SCALE;

	const qx = snoise3(px, py, t);
	const qy = snoise3(px + 5.2, py + 1.3, t);
	const sx = px + WARP_Q * qx;
	const sy = py + WARP_Q * qy;
	const rx = snoise3(sx + 1.7, sy + 9.2, t * 1.3);
	const ry = snoise3(sx + 8.3, sy + 2.8, t * 1.3);
	const fold = snoise3(px * FOLD_SCALE + WARP_R * rx, py * FOLD_SCALE + WARP_R * ry, t * 0.7);
	out[0] = rx;
	out[1] = ry;
	out[2] = SILK_BAND * (px * SILK_BAND_X + py * SILK_BAND_Y) + SILK_FREQ * fold + SILK_TWIST * rx;
	return out;
}

/** The CPU renderer's warp lattice spacing, in backing-store pixels. */
export const AURORA_CPU_WARP_STEP = 2;

/**
 * {@link warpAurora} sampled on a uniform lattice every {@link AURORA_CPU_WARP_STEP} pixels of a
 * backing store and read back bilinearly — roughly a quarter of the simplex lookups of a per-pixel
 * pass. The difference from the exact field is a few 8-bit steps for nearly every pixel (p99 ≈ 3/255
 * at 16:9); only isolated pixels on the sharpest sheen crests stray further, and CSS's upscale of the
 * backing store softens those. The last row and column may sit just past the edge, where the noise is
 * equally defined.
 */
export class WarpLattice {
	private values = new Float32Array(0);
	private cols = 0;
	private rows = 0;
	private readonly scratch = [0, 0, 0];

	/** Sample the lattice for a `width` × `height` backing store at animation time `time`. */
	sample(width: number, height: number, aspect: number, time: number): void {
		const step = AURORA_CPU_WARP_STEP;
		this.cols = Math.ceil((width - 1) / step) + 1;
		this.rows = Math.ceil((height - 1) / step) + 1;
		const size = this.cols * this.rows * 3;
		if (this.values.length !== size) this.values = new Float32Array(size);
		let k = 0;
		for (let j = 0; j < this.rows; j++) {
			const v = (j * step + 0.5) / height;
			for (let i = 0; i < this.cols; i++) {
				warpAurora((i * step + 0.5) / width, v, aspect, time, this.scratch);
				this.values[k++] = this.scratch[0];
				this.values[k++] = this.scratch[1];
				this.values[k++] = this.scratch[2];
			}
		}
	}

	/** Interpolate `[r.x, r.y, phase]` at backing-store pixel (x, y) into `out`. */
	at(x: number, y: number, out: number[]): number[] {
		const { cols, rows, values } = this;
		const gx = x / AURORA_CPU_WARP_STEP;
		const gy = y / AURORA_CPU_WARP_STEP;
		const i0 = Math.min(Math.floor(gx), cols - 1);
		const j0 = Math.min(Math.floor(gy), rows - 1);
		const i1 = Math.min(i0 + 1, cols - 1);
		const j1 = Math.min(j0 + 1, rows - 1);
		const fx = gx - i0;
		const fy = gy - j0;
		const a = (j0 * cols + i0) * 3;
		const b = (j0 * cols + i1) * 3;
		const c = (j1 * cols + i0) * 3;
		const d = (j1 * cols + i1) * 3;
		for (let n = 0; n < 3; n++) {
			const top = values[a + n] + (values[b + n] - values[a + n]) * fx;
			const bottom = values[c + n] + (values[d + n] - values[c + n]) * fx;
			out[n] = top + (bottom - top) * fy;
		}
		return out;
	}
}

/**
 * The colour half of the field: composite the five layers at the warped position, lay the silk sheen
 * over them, and clamp the luminance. Writes gamma-encoded sRGB (0–1) into `out` and returns it.
 */
export function shadeWarped(
	u: number,
	v: number,
	aspect: number,
	rx: number,
	ry: number,
	phase: number,
	palette: AuroraPalette,
	ceiling: number,
	out: number[] = [0, 0, 0],
): number[] {
	const wx = u + DRIFT * rx;
	const wy = v + DRIFT * ry;
	const along = ((wx - 0.5) * aspect * WASH_DX + (wy - 0.5) * WASH_DY) /
			(Math.abs(WASH_DX) * aspect + Math.abs(WASH_DY)) + 0.5;

	out[0] = palette.base[0];
	out[1] = palette.base[1];
	out[2] = palette.base[2];
	mixInto(out, palette.deep, Math.min(Math.max(along / WASH_STOP, 0), 1));
	mixInto(out, palette.cobalt, radial(COBALT, wx, wy));
	mixInto(out, palette.violet, radial(VIOLET, wx, wy));
	mixInto(out, palette.cyan, radial(CYAN, wx, wy));

	const ridge = Math.max(0.5 + 0.5 * Math.sin(phase), 0) ** SHEEN_POW;
	const gain = GAIN_FLOOR + GAIN_RANGE * ridge * ridge * (3 - 2 * ridge);
	let lr = Math.min(decode(out[0]) * gain, 1);
	let lg = Math.min(decode(out[1]) * gain, 1);
	let lb = Math.min(decode(out[2]) * gain, 1);
	const lum = LUMA[0] * lr + LUMA[1] * lg + LUMA[2] * lb;
	if (lum > ceiling && lum > 0) {
		const k = Math.max(ceiling, 0) / lum;
		lr *= k;
		lg *= k;
		lb *= k;
	}
	out[0] = encode(lr);
	out[1] = encode(lg);
	out[2] = encode(lb);
	return out;
}

/**
 * Shade one point of the field exactly — {@link warpAurora} then {@link shadeWarped}, as the shader
 * does per pixel. `u`/`v` are 0–1 across/down the hero, `aspect` its CSS width ÷ height, `time` the
 * animation clock in seconds. The output's relative luminance never exceeds `ceiling`.
 */
export function shadeAurora(
	u: number,
	v: number,
	aspect: number,
	time: number,
	palette: AuroraPalette,
	ceiling: number,
	out: number[] = [0, 0, 0],
): number[] {
	const w = warpAurora(u, v, aspect, time, out);
	return shadeWarped(u, v, aspect, w[0], w[1], w[2], palette, ceiling, out);
}
// #endregion

// #region The field (GPU)
function radialGlsl(layer: RadialLayer): string {
	return `${f(layer.alpha)} * clamp(1.0 - length((w - vec2(${f(layer.cx)}, ${
		f(layer.cy)
	})) / vec2(${f(layer.rx)}, ${f(layer.ry)})) / ${f(layer.stop)}, 0.0, 1.0)`;
}

/** The full-screen triangle: three vertices from `gl_VertexID`, no buffers. */
export const AURORA_VERTEX_SHADER = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The field, mirrored from {@link shadeAurora}, plus an interleaved-gradient dither of ±½ LSB. */
export const AURORA_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uAspect;
uniform float uTime;
uniform float uCeiling;
uniform vec3 uBase;
uniform vec3 uDeep;
uniform vec3 uCobalt;
uniform vec3 uViolet;
uniform vec3 uCyan;

out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
	const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
	const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
	vec3 i = floor(v + dot(v, C.yyy));
	vec3 x0 = v - i + dot(i, C.xxx);
	vec3 g = step(x0.yzx, x0.xyz);
	vec3 l = 1.0 - g;
	vec3 i1 = min(g.xyz, l.zxy);
	vec3 i2 = max(g.xyz, l.zxy);
	vec3 x1 = x0 - i1 + C.xxx;
	vec3 x2 = x0 - i2 + C.yyy;
	vec3 x3 = x0 - D.yyy;
	i = mod289(i);
	vec4 p = permute(permute(permute(
		i.z + vec4(0.0, i1.z, i2.z, 1.0))
		+ i.y + vec4(0.0, i1.y, i2.y, 1.0))
		+ i.x + vec4(0.0, i1.x, i2.x, 1.0));
	float n_ = 0.142857142857;
	vec3 ns = n_ * D.wyz - D.xzx;
	vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
	vec4 x_ = floor(j * ns.z);
	vec4 y_ = floor(j - 7.0 * x_);
	vec4 x = x_ * ns.x + ns.yyyy;
	vec4 y = y_ * ns.x + ns.yyyy;
	vec4 h = 1.0 - abs(x) - abs(y);
	vec4 b0 = vec4(x.xy, y.xy);
	vec4 b1 = vec4(x.zw, y.zw);
	vec4 s0 = floor(b0) * 2.0 + 1.0;
	vec4 s1 = floor(b1) * 2.0 + 1.0;
	vec4 sh = -step(h, vec4(0.0));
	vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
	vec3 p0 = vec3(a0.xy, h.x);
	vec3 p1 = vec3(a0.zw, h.y);
	vec3 p2 = vec3(a1.xy, h.z);
	vec3 p3 = vec3(a1.zw, h.w);
	vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 *= norm.x;
	p1 *= norm.y;
	p2 *= norm.z;
	p3 *= norm.w;
	vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
	m = m * m;
	return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 decode(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 encode(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
	vec2 uv = vec2(gl_FragCoord.x / uResolution.x, 1.0 - gl_FragCoord.y / uResolution.y);
	float t = uTime * ${f(AURORA_SPEED)};
	vec2 pp = vec2(uv.x * uAspect, uv.y) * ${f(NOISE_SCALE)};

	vec2 q = vec2(snoise(vec3(pp, t)), snoise(vec3(pp + vec2(5.2, 1.3), t)));
	vec2 s = pp + ${f(WARP_Q)} * q;
	vec2 r = vec2(
		snoise(vec3(s + vec2(1.7, 9.2), t * 1.3)),
		snoise(vec3(s + vec2(8.3, 2.8), t * 1.3)));
	float fold = snoise(vec3(pp * ${f(FOLD_SCALE)} + ${f(WARP_R)} * r, t * 0.7));
	float phase = ${f(SILK_BAND)} * dot(pp, vec2(${f(SILK_BAND_X)}, ${f(SILK_BAND_Y)}))
		+ ${f(SILK_FREQ)} * fold + ${f(SILK_TWIST)} * r.x;

	vec2 w = uv + ${f(DRIFT)} * r;
	float along = dot(vec2((w.x - 0.5) * uAspect, w.y - 0.5), vec2(${f(WASH_DX)}, ${f(WASH_DY)}))
		/ (${f(Math.abs(WASH_DX))} * uAspect + ${f(Math.abs(WASH_DY))}) + 0.5;

	vec3 col = uBase;
	col = mix(col, uDeep, clamp(along / ${f(WASH_STOP)}, 0.0, 1.0));
	col = mix(col, uCobalt, ${radialGlsl(COBALT)});
	col = mix(col, uViolet, ${radialGlsl(VIOLET)});
	col = mix(col, uCyan, ${radialGlsl(CYAN)});

	float ridge = pow(max(0.5 + 0.5 * sin(phase), 0.0), ${f(SHEEN_POW)});
	float gain = ${f(GAIN_FLOOR)} + ${f(GAIN_RANGE)} * ridge * ridge * (3.0 - 2.0 * ridge);
	vec3 lin = min(decode(col) * gain, vec3(1.0));
	float lum = dot(lin, vec3(${f(LUMA[0])}, ${f(LUMA[1])}, ${f(LUMA[2])}));
	if (lum > uCeiling && lum > 0.0) lin *= max(uCeiling, 0.0) / lum;

	float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	fragColor = vec4(encode(lin) + (dither - 0.5) / 255.0, 1.0);
}
`;

/** The CPU path's dither for pixel (x, y): the same interleaved-gradient noise, ±½ LSB in 0–255 units. */
export function ditherAt(x: number, y: number): number {
	const inner = (x + 0.5) * 0.06711056 + (y + 0.5) * 0.00583715;
	const n = 52.9829189 * (inner - Math.floor(inner));
	return n - Math.floor(n) - 0.5;
}
// #endregion
