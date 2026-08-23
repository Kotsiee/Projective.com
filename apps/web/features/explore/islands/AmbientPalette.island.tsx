import { useEffect } from "preact/hooks";

/**
 * AmbientPalette — the discovery grid's dominant-colour extractor.
 *
 * The card family's hover state warms toward the colour of the card's OWN media (the YouTube ambient
 * treatment). That needs the pixels, so this is the one place in the feature that touches a canvas.
 *
 * ## Why one island for the whole page, not one per card
 * A grid paints 20-40 cards. Hydrating an island per card would ship 40 component instances, 40
 * effects and 40 observers to compute a single custom property each. The cards stay SERVER components
 * with no client bundle of their own; this island renders nothing, finds them by attribute, and writes
 * `--ex-ambient` onto each. It is the same shape as `CardStyleAnchor` — a zero-UI page-level worker.
 *
 * ## Degradation is the resting state, not an error path
 * SSR paints the card with `--ex-ambient` UNSET, and `explore.css` falls back to the deterministic
 * per-card accent token (`core/accent.ts`). So no-JS, a CORS refusal, a decode failure and a 404 all
 * land on a wash that already looks finished. Extraction only ever UPGRADES an already-correct card;
 * it is never the thing that makes one correct.
 *
 * ## Why `new Image()` and not the rendered `<img>`
 * Reading pixels back out of a canvas taints it unless the image was fetched in CORS mode. Setting
 * `crossOrigin` on the RENDERED element would change its fetch mode for every host — and a host that
 * does not send `Access-Control-Allow-Origin` would then fail to display at all. A separate off-DOM
 * `Image()` isolates that risk: worst case the extraction fails and the visible thumbnail is untouched.
 */

/** `--ex-ambient` is written as space-separated channels so CSS can vary the alpha per use. */
const AMBIENT_PROP = "--ex-ambient";
/** The attribute a card publishes its extraction source on. */
const SRC_ATTR = "data-ambient-src";
/** Marks an element as already handled (resolved or failed) so observers never re-queue it. */
const DONE_ATTR = "data-ambient";
/** Pre-built selector for "publishes a source, not yet handled". */
const PENDING_SELECTOR = "[data-ambient-src]:not([data-ambient])";

/** Square sample size. 24² = 576 pixels is ample for a dominant hue and decodes in ~nothing. */
const SAMPLE = 24;
/** Quantisation shift: 3 bits dropped per channel → 32 levels, coarse enough to pool a gradient. */
const BITS = 3;

/**
 * Resolved swatches, keyed by source URL and shared across every card on the page.
 *
 * Avatars repeat (the same seller owns several listings) and the search feed re-mounts cards as it
 * pages, so without this a re-render would re-decode work already done. `null` is a cached FAILURE —
 * a URL that could not be read must not be retried on every scroll.
 */
const CACHE = new Map<string, string | null>();

/** One quantised colour bucket: accumulated weight plus the true channel sums of its members. */
interface Bucket {
	w: number;
	r: number;
	g: number;
	b: number;
	n: number;
}

/** Rewrites a sizing query (`?w=900&h=500`) down to the sample size — a thumbnail is all we read. */
function sampleUrl(src: string): string {
	try {
		const base = globalThis.location?.href ?? "http://localhost";
		const u = new URL(src, base);
		if (!u.searchParams.has("w") && !u.searchParams.has("h")) return src;
		u.searchParams.set("w", String(SAMPLE * 2));
		u.searchParams.set("h", String(SAMPLE * 2));
		return u.toString();
	} catch {
		return src;
	}
}

/**
 * Clamps a swatch into a range that actually reads as an ambient tint, preserving its HUE.
 *
 * The extracted colour is usually a dark, muted mid-tone — most photography is — and a dark tint at
 * 12% over a dark surface is invisible, so the hover would silently do nothing on exactly the cards
 * with the moodiest thumbnails. Hue is the part a viewer recognises as "that image's colour"; the
 * exact luminance is not, so lightness and saturation are pulled into a usable band and the hue is
 * left untouched.
 *
 * A genuinely monochrome image (chroma under the threshold) keeps its neutrality rather than being
 * given an invented hue — its wash stays a grey lift, which is the honest answer.
 */
function normalise(r: number, g: number, b: number): string {
	const rf = r / 255, gf = g / 255, bf = b / 255;
	const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
	const l = (max + min) / 2;
	const d = max - min;

	let h = 0;
	if (d > 0) {
		if (max === rf) h = ((gf - bf) / d) % 6;
		else if (max === gf) h = (bf - rf) / d + 2;
		else h = (rf - gf) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

	// Near-greyscale: lift the lightness only, invent no hue.
	const outS = s < 0.06 ? s : Math.min(0.85, Math.max(0.4, s));
	const outL = Math.min(0.68, Math.max(0.46, l));

	const c = (1 - Math.abs(2 * outL - 1)) * outS;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = outL - c / 2;
	let rr = 0, gg = 0, bb = 0;
	if (h < 60) [rr, gg, bb] = [c, x, 0];
	else if (h < 120) [rr, gg, bb] = [x, c, 0];
	else if (h < 180) [rr, gg, bb] = [0, c, x];
	else if (h < 240) [rr, gg, bb] = [0, x, c];
	else if (h < 300) [rr, gg, bb] = [x, 0, c];
	else [rr, gg, bb] = [c, 0, x];

	return `${Math.round((rr + m) * 255)} ${Math.round((gg + m) * 255)} ${
		Math.round((bb + m) * 255)
	}`;
}

/**
 * The dominant colour of an already-decoded image, as a normalised `"r g b"`.
 *
 * A plain mean is the obvious implementation and it is why so many ambient effects look like mud:
 * average a photograph and you get grey. So pixels are pooled into quantised buckets and each is
 * weighted, letting a small vivid region outvote a large flat one.
 *
 * The weight is ABSOLUTE chroma (`max - min`) biased toward mid-tones, NOT the usual relative
 * saturation `(max - min) / max`. Relative saturation is the trap: `rgb(0, 10, 20)` scores a perfect
 * 1.0 while being indistinguishable from black, so shadow detail with a faint colour cast wins every
 * vote. Measured against this corpus, relative saturation returned near-black for 7 of the first 8
 * thumbnails; chroma-times-midtone returns their actual subject colour.
 *
 * Returns `null` when the canvas is unavailable or the read is refused, which the caller treats as
 * "keep the token fallback".
 */
function dominantColour(img: HTMLImageElement): string | null {
	const canvas = document.createElement("canvas");
	canvas.width = SAMPLE;
	canvas.height = SAMPLE;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;

	let data: Uint8ClampedArray;
	try {
		ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
		data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
	} catch {
		// SecurityError — the image was not served with CORS headers, so the canvas is tainted.
		return null;
	}

	const buckets = new Map<number, Bucket>();
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	let seen = 0;

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 128) continue;
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		sumR += r;
		sumG += g;
		sumB += b;
		seen++;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		// Drop the extremes: they carry no usable hue and dominate photographs by area.
		if (max < 40 || min > 226) continue;

		const chroma = (max - min) / 255;
		const lum = (max + min) / 510;
		// Peaks at mid-lightness and falls off toward both ends, floored so a dark-but-genuinely-colourful
		// region still competes instead of being excluded outright.
		const midness = Math.max(0.15, 1 - Math.abs(lum - 0.5) * 1.6);
		// The constant floor keeps a flat monochrome image from scoring zero everywhere and falling through
		// to the mean branch, which would be a worse answer than its own most common tone.
		const weight = 0.02 + chroma * midness;

		const key = ((r >> BITS) << 10) | ((g >> BITS) << 5) | (b >> BITS);
		const cell = buckets.get(key);
		if (cell) {
			cell.w += weight;
			cell.r += r;
			cell.g += g;
			cell.b += b;
			cell.n++;
		} else {
			buckets.set(key, { w: weight, r, g, b, n: 1 });
		}
	}

	if (!seen) return null;

	let best: Bucket | null = null;
	for (const cell of buckets.values()) {
		if (!best || cell.w > best.w) best = cell;
	}

	// Every pixel was an extreme (a pure black or blown-out thumbnail): fall back to the plain mean,
	// which is the honest answer for an image that genuinely has no dominant hue.
	if (!best) return normalise(sumR / seen, sumG / seen, sumB / seen);
	return normalise(best.r / best.n, best.g / best.n, best.b / best.n);
}

/** Decodes `src` in CORS mode and resolves its dominant colour, or `null` on any failure. */
function extract(src: string): Promise<string | null> {
	const cached = CACHE.get(src);
	if (cached !== undefined) return Promise.resolve(cached);
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		const settle = (value: string | null) => {
			CACHE.set(src, value);
			resolve(value);
		};
		img.onload = () => settle(dominantColour(img));
		img.onerror = () => settle(null);
		img.src = sampleUrl(src);
	});
}

/** Resolves one card: reads its source, writes the swatch, and marks it done either way. */
async function paint(el: HTMLElement): Promise<void> {
	if (el.hasAttribute(DONE_ATTR)) return;
	const src = el.getAttribute(SRC_ATTR);
	// Mark BEFORE awaiting: a scroll during the decode would otherwise queue the same card again.
	el.setAttribute(DONE_ATTR, "pending");
	if (!src) {
		el.setAttribute(DONE_ATTR, "none");
		return;
	}
	const swatch = await extract(src);
	if (swatch) {
		el.style.setProperty(AMBIENT_PROP, swatch);
		el.setAttribute(DONE_ATTR, "on");
	} else {
		el.setAttribute(DONE_ATTR, "none");
	}
}

/**
 * Mounted once per surface that renders discovery cards. Renders nothing and owns no state — it is a
 * page-level worker, not a component.
 */
export default function AmbientPalette() {
	useEffect(() => {
		if (typeof document === "undefined") return;

		let live = true;

		// Decode only what the reader is about to see — a 40-card feed otherwise fetches 40 thumbnails
		// the moment it mounts, competing with the images actually on screen.
		const io = "IntersectionObserver" in globalThis
			? new IntersectionObserver((entries, obs) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					obs.unobserve(e.target);
					if (live) void paint(e.target as HTMLElement);
				}
			}, { rootMargin: "300px" })
			: null;

		const enqueue = (el: HTMLElement) => {
			if (io) io.observe(el);
			else void paint(el);
		};

		const scan = (root: ParentNode) => {
			for (const el of root.querySelectorAll<HTMLElement>(PENDING_SELECTOR)) enqueue(el);
		};

		scan(document);

		// The search feed appends pages and swaps entity layouts in place, so cards arrive after mount.
		const mo = new MutationObserver((records) => {
			for (const rec of records) {
				for (const node of rec.addedNodes) {
					if (node.nodeType !== 1) continue;
					const el = node as HTMLElement;
					if (el.matches?.(PENDING_SELECTOR)) enqueue(el);
					scan(el);
				}
			}
		});
		mo.observe(document.body, { childList: true, subtree: true });

		return () => {
			live = false;
			io?.disconnect();
			mo.disconnect();
		};
	}, []);

	return null;
}
