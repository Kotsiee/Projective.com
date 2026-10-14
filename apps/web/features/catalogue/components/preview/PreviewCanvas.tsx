import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { SelectButton } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import "../../styles/preview.css";
import { PreviewDevice } from "@projective/types/catalogue";
import { saveState, setWorkspaceUrl } from "../../core/workspace-store.ts";
import { simulateHref } from "../../core/simulate-path.ts";
import {
	PREVIEW_RELOAD_DEBOUNCE_MS,
	previewScale,
	readScrollMessage,
	savedTransition,
	scrollMessage,
} from "../../core/preview-model.ts";

/** Props for {@link PreviewCanvas}. */
export interface PreviewCanvasProps {
	/** The listing's `svc-` / `prd-` slug — the simulation's address. */
	slug: string;
	/** The listing title, which names the frame for assistive tech. */
	title: string;
	/** The device the frame is drawn as (`?device=`). */
	device: PreviewDevice;
}

const DEVICE_OPTIONS = [
	{ label: "Desktop", value: "desktop" },
	{ label: "Mobile", value: "mobile" },
];

/**
 * PreviewCanvas — the item workspace's Preview tab (plan §4.6 item 3, Decision #217 (j)): the real
 * `/view` page, as a buyer meets it, rendered by `/catalogue/[id]/simulate` inside an `<iframe>` so the
 * page's own breakpoints apply to the chosen device.
 *
 * - **Device** (`?device=`): Desktop is laid out 1280px wide and scaled to the canvas; Mobile is a
 *   390 × 844 phone in a token-drawn bezel. The scale is written to `--cat-preview-scale` from a
 *   ResizeObserver; the rule is the pure `previewScale`.
 * - **Stored truth.** The frame reloads 1.5 s after the workspace's save state goes from `saving` to
 *   `saved` (each save restarts the wait), so the preview always shows what is stored, never the
 *   unsaved draft.
 * - **Scroll survives the reload.** The simulation reports its scroll position as the reader scrolls
 *   and asks for it back once it has loaded (`pj:preview-scroll`, same-origin frames only).
 * - **Open in a new tab** opens the same simulation full-window.
 */
export function PreviewCanvas(props: PreviewCanvasProps): JSX.Element {
	const stage = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const lastY = useRef(0);
	const src = simulateHref(props.slug);

	// #region Scale
	useEffect(() => {
		const el = stage.current;
		if (!el) return;
		const apply = () => {
			const box = el.getBoundingClientRect();
			const scale = previewScale(props.device, { width: box.width, height: box.height });
			el.style.setProperty("--cat-preview-scale", String(scale));
			el.style.setProperty("--cat-preview-h", `${Math.round(box.height)}px`);
		};
		apply();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(apply);
		observer.observe(el);
		return () => observer.disconnect();
	}, [props.device]);
	// #endregion

	// #region Scroll hand-off
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const target = frame.current?.contentWindow;
			if (!target || event.source !== target || event.origin !== globalThis.location.origin) return;
			const message = readScrollMessage(event.data);
			if (!message) return;
			if (message.phase === "report") lastY.current = message.y;
			else if (message.phase === "ready") {
				target.postMessage(scrollMessage("restore", lastY.current), globalThis.location.origin);
			}
		};
		globalThis.addEventListener("message", onMessage);
		return () => globalThis.removeEventListener("message", onMessage);
	}, []);
	// #endregion

	// #region Reload on save
	useEffect(() => {
		let previous = saveState.peek();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const reload = () => {
			const el = frame.current;
			if (!el) return;
			try {
				el.contentWindow?.location.reload();
			} catch {
				el.src = src;
			}
		};
		const dispose = saveState.subscribe((next) => {
			if (savedTransition(previous, next)) {
				clearTimeout(timer);
				timer = setTimeout(reload, PREVIEW_RELOAD_DEBOUNCE_MS);
			}
			previous = next;
		});
		return () => {
			dispose();
			clearTimeout(timer);
		};
	}, [src]);
	// #endregion

	return (
		<section class="cat-preview" aria-label="Buyer preview">
			<div class="cat-preview__bar">
				<SelectButton
					aria-label="Preview device"
					size="sm"
					options={DEVICE_OPTIONS}
					value={props.device}
					onValueChange={(v) => {
						const next = PreviewDevice.safeParse(v);
						if (next.success && next.data !== props.device) {
							setWorkspaceUrl({ device: next.data }, "replace");
						}
					}}
				/>
				<a class="cat-preview__open" href={src} target="_blank" rel="noopener">
					<span>Open in a new tab</span>
					<Icon name="external-link" size="sm" aria-hidden />
				</a>
			</div>

			<div ref={stage} class="cat-preview__stage" data-device={props.device}>
				<div class={`cat-preview__device cat-preview__device--${props.device}`}>
					<div class="cat-preview__shell">
						<iframe
							ref={frame}
							class="cat-preview__frame"
							title={`Buyer preview of ${props.title}`}
							src={src}
						/>
					</div>
				</div>
			</div>
		</section>
	);
}
