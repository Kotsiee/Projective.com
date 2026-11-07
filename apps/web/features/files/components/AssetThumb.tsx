import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { FileTypeIcon } from "@web/features/projects/components/FileTypeIcon.tsx";
import "@web/features/projects/styles/file-card.css";
import { peekThumb, type ThumbResult } from "../core/thumbs/thumb-cache.ts";
import { type ThumbPlan, wavePath } from "../core/thumbs/thumb-plan.ts";
import { loadThumb } from "../core/thumbs/thumb-store.ts";
import type { AssetItem } from "../types/file-types.ts";

// #region Near the viewport
type NearListener = (near: boolean) => void;

/** How far ahead a card starts: far enough that a normal scroll meets finished previews. */
const NEAR_MARGIN = "320px";

let observer: IntersectionObserver | null = null;
const listeners = new WeakMap<Element, NearListener>();

/** One observer for every card on the page, rather than one each. */
function watchNear(element: Element, listener: NearListener): () => void {
	observer ??= new IntersectionObserver((entries) => {
		for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
	}, { rootMargin: NEAR_MARGIN });
	listeners.set(element, listener);
	observer.observe(element);
	return () => {
		observer?.unobserve(element);
		listeners.delete(element);
	};
}
// #endregion

/** Props for {@link AssetThumb}. */
export interface AssetThumbProps {
	asset: AssetItem;
	plan: Exclude<ThumbPlan, { kind: "none" }>;
}

/**
 * AssetThumb — a card's lazy preview. The file's tile paints at once and stays until something better
 * is ready, so a card is never blank and never changes size. Work starts when the card comes near the
 * viewport and is cancelled if it leaves first: a card the person scrolled past never costs a byte,
 * and everything on screen shares one queue and one cache (`core/thumbs/`).
 *
 * Decorative: the file's name and type are the card's own label, so nothing here is announced.
 */
export function AssetThumb({ asset, plan }: AssetThumbProps): JSX.Element {
	const host = useRef<HTMLSpanElement>(null);
	const job = plan.kind === "render" ? plan : null;
	const result = useSignal<ThumbResult | null>(job ? peekThumb(job.key) : null);

	useEffect(() => {
		if (!job) return;
		const ready = peekThumb(job.key);
		result.value = ready;
		if (ready || !host.current) return;
		let running: AbortController | null = null;
		const stop = watchNear(host.current, (near) => {
			running?.abort();
			running = null;
			if (!near) return;
			const controller = new AbortController();
			running = controller;
			loadThumb(job, controller.signal).then((loaded) => {
				if (!loaded) return;
				result.value = loaded;
				stop();
			}).catch(() => undefined);
		});
		return () => {
			stop();
			running?.abort();
		};
	}, [job?.key]);

	const shown = result.value;
	const picture = plan.kind === "picture" ? plan.src : shown?.type === "image" ? shown.url : null;
	const lines = shown?.type === "lines" ? shown.lines : null;

	return (
		<span ref={host} class="fx-thumb" aria-hidden="true">
			{picture
				? <img class="fx-thumb__img" src={picture} alt="" decoding="async" draggable={false} />
				: null}
			{lines
				? (
					<span class="fx-thumb__code">
						{lines.map((line, i) => (
							<span key={i} class="fx-thumb__line">
								<span class="fx-thumb__ln">{i + 1}</span>
								<span class="fx-thumb__src">{line}</span>
							</span>
						))}
					</span>
				)
				: null}
			{plan.kind === "wave"
				? (
					<svg
						class="fx-thumb__wave"
						viewBox={`0 0 ${Math.min(56, plan.peaks.length)} 1`}
						preserveAspectRatio="none"
					>
						<path d={wavePath(plan.peaks)} vector-effect="non-scaling-stroke" />
					</svg>
				)
				: null}
			{picture || lines || plan.kind === "wave"
				? <FileTypeIcon file={asset} size={22} class="fx-card__family" />
				: (
					<span class="fx-card__glyph">
						<FileTypeIcon file={asset} />
					</span>
				)}
		</span>
	);
}
