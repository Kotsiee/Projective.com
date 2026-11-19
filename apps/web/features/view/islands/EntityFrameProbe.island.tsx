import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { pastFrame } from "../core/cta-mirror.ts";

/**
 * EntityFrameProbe — a zero-UI island inside `.evp-frame` that sets {@link pastFrame} once the frame's
 * foot has scrolled up behind the header band, the point the conversion lane (which rests on that
 * foot) has left the screen. Listens to every scroll (the authed shell scrolls an inner canvas, not
 * the window) and measures at most once a frame.
 */
export default function EntityFrameProbe(): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const frame = ref.current?.closest<HTMLElement>(".evp-frame");
		if (!frame) return;
		let raf = 0;
		const measure = () => {
			raf = 0;
			const band = document.querySelector<HTMLElement>(".evp-stickyhead");
			const line = Math.max(0, band?.getBoundingClientRect().bottom ?? 0);
			pastFrame.value = frame.getBoundingClientRect().bottom <= line + 1;
		};
		const schedule = () => {
			if (raf === 0) raf = requestAnimationFrame(measure);
		};
		measure();
		document.addEventListener("scroll", schedule, { capture: true, passive: true });
		globalThis.addEventListener("resize", schedule, { passive: true });
		return () => {
			if (raf !== 0) cancelAnimationFrame(raf);
			document.removeEventListener("scroll", schedule, { capture: true });
			globalThis.removeEventListener("resize", schedule);
			pastFrame.value = false;
		};
	}, []);

	return <div ref={ref} class="evp-frame__probe" aria-hidden="true" />;
}
