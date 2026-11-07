import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { styleVars } from "@ui/core/style.ts";
import { type Deck, openDeck } from "../../../core/pptx-model.ts";
import { paintSlide } from "../../../core/pptx-paint.ts";
import { createSceneImages, type SceneImages } from "../../../core/pptx-images.ts";
import { openRemoteZip } from "../../../core/remote-zip.ts";
import { ToolButton, ToolReadout } from "../../controls/mod.ts";
import { plainKey, useStageKeys } from "../document/stage-keys.ts";
import type { ViewerProps } from "../viewer.ts";
import { deckFacts, goToSlide, type PresentationTools } from "./presentation-tools.ts";

const MAX_PIXEL_RATIO = 2;

/** The slide counter and its arrows: on the canvas of the page, in the host's chips when embedded. */
export function PresentationChips({ tools }: ViewerProps<PresentationTools>): JSX.Element | null {
	const deck = tools.deck.value;
	if (!deck) return null;
	const slide = tools.slide.value;
	return (
		<div class="ins-chips" role="toolbar" aria-label="Slides">
			<ToolButton
				icon="chevron-left"
				label="Previous slide"
				shortcut="ArrowLeft"
				disabled={slide === 0}
				onClick={() => goToSlide(tools, slide - 1)}
			/>
			<span class="ins-chips__readout">
				<ToolReadout value={`${slide + 1} / ${deck.slideCount}`} label="Slide" />
			</span>
			<ToolButton
				icon="chevron-right"
				label="Next slide"
				shortcut="ArrowRight"
				disabled={slide >= deck.slideCount - 1}
				onClick={() => goToSlide(tools, slide + 1)}
			/>
		</div>
	);
}

/**
 * The slide canvas: one slide at a time, fitted to the stage and redrawn at its real pixel size, so
 * text stays sharp at any window size. The slide's text sits inside the canvas element, where
 * assistive technology reads it and nothing paints it.
 */
export function PresentationStage(props: ViewerProps<PresentationTools>): JSX.Element {
	const { shell, tools } = props;
	const { asset } = shell;
	const host = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const images = useRef<SceneImages | null>(null);
	const paints = useRef(0);
	const area = useSignal({ width: 0, height: 0 });

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			const zip = await openRemoteZip(asset.src, asset.sizeBytes, controller.signal);
			const deck = await openDeck(zip);
			if (controller.signal.aborted) return;
			images.current = createSceneImages(deck);
			shell.facts.value = deckFacts(deck);
			tools.deck.value = deck;
		})().catch(() => {
			if (controller.signal.aborted) return;
			shell.fail("This presentation couldn't be read. It may be damaged or password-protected.");
		});
		return () => {
			controller.abort();
			tools.deck.value = null;
			images.current?.dispose();
			images.current = null;
		};
	}, [shell, tools]);

	useLayoutEffect(() => {
		const node = host.current;
		if (!node) return;
		const measure = () => {
			area.value = { width: node.clientWidth, height: node.clientHeight };
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	async function paint(deck: Deck, index: number, turn: number): Promise<void> {
		const scene = await deck.slide(index);
		const loaded = await images.current?.load(scene);
		const target = canvas.current;
		const ctx = target?.getContext("2d");
		if (turn !== paints.current || !target || !ctx || !loaded) return;
		const { width, height } = area.peek();
		const fit = Math.min(width / deck.width, height / deck.height);
		const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		target.width = Math.max(1, Math.round(deck.width * fit * ratio));
		target.height = Math.max(1, Math.round(deck.height * fit * ratio));
		paintSlide(ctx, scene, loaded, target.width);
		tools.text.value = scene.text;
		if (shell.status.peek() === "loading") shell.status.value = "ready";
		if (index + 1 < deck.slideCount) deck.slide(index + 1).catch(() => undefined);
	}

	useSignalEffect(() => {
		const deck = tools.deck.value;
		const index = tools.slide.value;
		const { width, height } = area.value;
		if (!deck || width === 0 || height === 0) return;
		paints.current += 1;
		paint(deck, index, paints.current).catch(() => {
			if (shell.status.peek() === "loading") {
				shell.fail("This presentation couldn't be read. It may be damaged or password-protected.");
			} else shell.announce("That slide couldn't be drawn.");
		});
	});

	useStageKeys(host, (event) => {
		if (!plainKey(event)) return false;
		const slide = tools.slide.peek();
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
			case "PageDown":
			case " ":
				goToSlide(tools, slide + 1);
				return true;
			case "ArrowLeft":
			case "ArrowUp":
			case "PageUp":
				goToSlide(tools, slide - 1);
				return true;
			case "Home":
				goToSlide(tools, 0);
				return true;
			case "End":
				goToSlide(tools, Number.MAX_SAFE_INTEGER);
				return true;
			default:
				return false;
		}
	});

	const deck = tools.deck.value;
	const count = deck?.slideCount ?? 0;
	return (
		<div class="ins-slides">
			<div ref={host} class="ins-slides__stage">
				<canvas
					ref={canvas}
					class="ins-slides__canvas"
					role="img"
					aria-label={`Slide ${tools.slide.value + 1} of ${count}`}
					style={styleVars({ "--ins-slide-ratio": deck ? deck.width / deck.height : undefined })}
				>
					{tools.text.value.map((line, i) => <p key={i}>{line}</p>)}
				</canvas>
			</div>
			{shell.options.embedded ? null : <PresentationChips {...props} />}
		</div>
	);
}
