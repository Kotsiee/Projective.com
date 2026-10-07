import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { AuroraMode } from "../core/aurora-engine.ts";
import { type AuroraRuntime, createAuroraRuntime } from "../core/aurora-runtime.ts";

/** Props for {@link HeroAurora}. */
export interface HeroAuroraProps {
	/** The hero the aurora paints: its attribute host, token source and visibility target. */
	host: RefObject<HTMLElement>;
}

/** The developer's `walletAurora` choice; always `auto` in production, where the seam is inert. */
function devMode(): AuroraMode {
	return readDevSeam()?.walletAurora ?? "auto";
}

/**
 * The wallet hero's live aurora: a procedural silk-gradient canvas laid under the hero's content.
 * Renders nothing on the server and nothing until `aurora-runtime.ts` decides the device, the page and
 * the reader's motion preference allow it, so the hero's static CSS gradient is the resting state and
 * the whole picture without JavaScript. The canvas is decorative (`aria-hidden`) and inert to the
 * pointer; the runtime reflects what ran, and why, on the hero's `data-aurora*` attributes.
 *
 * Each canvas the runtime asks for carries its own key, so a context that failed is never reused.
 */
export function HeroAurora({ host }: HeroAuroraProps): JSX.Element | null {
	const canvasKey = useSignal(0);
	const runtime = useRef<AuroraRuntime | null>(null);
	const attach = useRef((el: HTMLCanvasElement | null) => runtime.current?.attach(el)).current;

	// A canvas animation loop is an external DOM resource: the effect owns its lifetime.
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		const rt = createAuroraRuntime({
			host: el,
			mode: devMode(),
			setCanvasKey: (key) => {
				canvasKey.value = key;
			},
		});
		runtime.current = rt;
		const unsubscribe = subscribeDevSeam((seam) => rt.setMode(seam?.walletAurora ?? "auto"));
		return () => {
			unsubscribe();
			rt.destroy();
			runtime.current = null;
		};
	}, []);

	const key = canvasKey.value;
	if (key === 0) return null;
	return <canvas key={key} ref={attach} class="wlt-hero__canvas" aria-hidden="true" />;
}
