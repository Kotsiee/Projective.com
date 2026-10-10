import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { PdfEngine } from "./pdf-engine.ts";
import { releaseCanvas } from "./pdf-page-view.ts";
import type { PdfTools } from "./pdf-tools.ts";

/** Props for {@link PdfThumbnails}. */
export interface PdfThumbnailsProps {
	tools: PdfTools;
	engine: PdfEngine;
}

const KEEP_RENDERED = 80;

/**
 * The thumbnail rail on the stage's start edge. Every page has a correctly shaped frame; a frame is
 * only drawn into once it nears the rail's viewport, and the oldest off-screen drawings are freed
 * so a long document never holds more than {@link KEEP_RENDERED} small canvases.
 */
export function PdfThumbnails({ tools, engine }: PdfThumbnailsProps): JSX.Element {
	const railRef = useRef<HTMLElement>(null);
	const count = tools.pageCount.value;
	const current = tools.page.value;
	const rotation = tools.rotation.value;
	void tools.layoutVersion.value;

	useEffect(() => {
		const rail = railRef.current;
		if (!rail) return;
		const rendered = new Map<number, HTMLCanvasElement>();
		const pending = new Set<number>();
		const visible = new Set<number>();
		let alive = true;

		const evict = () => {
			for (const [index, canvas] of rendered) {
				if (rendered.size <= KEEP_RENDERED) return;
				if (visible.has(index)) continue;
				releaseCanvas(canvas);
				canvas.remove();
				rendered.delete(index);
			}
		};

		const draw = (index: number, frame: HTMLElement) => {
			if (pending.has(index) || rendered.has(index)) return;
			pending.add(index);
			void engine.renderThumbnail(index, frame.clientWidth).then((canvas) => {
				pending.delete(index);
				if (!canvas) return;
				if (!alive || !frame.isConnected) {
					releaseCanvas(canvas);
					return;
				}
				frame.replaceChildren(canvas);
				rendered.set(index, canvas);
				evict();
			});
		};

		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const frame = entry.target;
				if (!(frame instanceof HTMLElement)) continue;
				const index = Number(frame.dataset.thumb);
				if (!Number.isInteger(index)) continue;
				if (entry.isIntersecting) {
					visible.add(index);
					draw(index, frame);
				} else {
					visible.delete(index);
				}
			}
		}, { root: rail, rootMargin: "240px 0px" });

		rail.querySelectorAll<HTMLElement>("[data-thumb]").forEach((frame) => {
			frame.replaceChildren();
			observer.observe(frame);
		});

		return () => {
			alive = false;
			observer.disconnect();
			for (const canvas of rendered.values()) {
				releaseCanvas(canvas);
				canvas.remove();
			}
			rendered.clear();
		};
	}, [engine, rotation, count]);

	useEffect(() => {
		const rail = railRef.current;
		const active = rail?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!rail || !active) return;
		const top = active.offsetTop;
		const bottom = top + active.offsetHeight;
		if (top < rail.scrollTop) rail.scrollTop = top;
		else if (bottom > rail.scrollTop + rail.clientHeight) {
			rail.scrollTop = bottom - rail.clientHeight;
		}
	}, [current]);

	return (
		<nav ref={railRef} class="ins-pdf-rail" aria-label="Page thumbnails">
			<ol class="ins-pdf-rail__list">
				{Array.from({ length: count }, (_, i) => (
					<li key={i} class="ins-pdf-rail__item">
						<button
							type="button"
							class="ins-pdf-thumb"
							aria-label={`Page ${i + 1}`}
							aria-current={current === i + 1 ? "page" : undefined}
							onClick={() => engine.goToPage(i + 1)}
						>
							<span
								class="ins-pdf-thumb__frame"
								data-thumb={i}
								style={{ "--ins-pdf-thumb-ratio": String(engine.pageRatio(i)) }}
							/>
							<span class="ins-pdf-thumb__label" aria-hidden="true">{i + 1}</span>
						</button>
					</li>
				))}
			</ol>
		</nav>
	);
}
