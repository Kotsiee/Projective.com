import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Drawer, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { cx } from "@ui/core/cx.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { DetailActions } from "./DetailActions.tsx";
import { stepFromKey, type StepPosition, stepPosition } from "../core/detail-nav.ts";
import type { DetailRoute } from "../hooks/useDetailRoute.ts";
import type { HrefContext } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/** The drawer panel's class — also how a key press is known to come from inside it. */
const PANEL_CLASS = "ex-detail-drawer";
const TITLE_ID = "ex-detail-title";

/**
 * ResultDetailDrawer — the Search Results detail drawer: the item's {@link DetailPanel} in the body,
 * a previous/next stepper through the visible results in the header, and the actions pinned in the
 * footer slot (§B.10.8). A right drawer at `--drawer-w` from `--bp-md` up, a bottom sheet below it.
 * The panel's own title names the dialog (`labelledBy`), so the header carries controls only and the
 * title is never printed twice. URL ownership lives in {@link DetailRoute}.
 */
export function ResultDetailDrawer(
	{ route, order, ctx, authed, sheet }: {
		route: DetailRoute;
		/** The visible results in reading order (`resultOrder`). */
		order: readonly ExploreItem[];
		ctx: HrefContext;
		authed: boolean;
		/** Below `--bp-md`: dock to the bottom edge as a sheet. */
		sheet: boolean;
	},
): JSX.Element {
	const item = route.item.value;
	const position = item ? stepPosition(order, item.id) : null;
	const announcement = useSignal("");
	const positionRef = useRef(position);
	positionRef.current = position;

	function step(dir: -1 | 1): void {
		const pos = positionRef.current;
		const target = dir === 1 ? pos?.next : pos?.prev;
		if (!pos || !target) return;
		route.open(target);
		announcement.value = `${target.title}, result ${pos.index + dir + 1} of ${pos.total}`;
	}

	useEffect(() => {
		if (!route.visible.value) return;
		function onKey(e: KeyboardEvent): void {
			const target = e.target instanceof Element ? e.target : null;
			if (!target?.closest(`.${PANEL_CLASS}`) || isEditable(target)) return;
			const dir = stepFromKey(e, document.documentElement.dir === "rtl" ? "rtl" : "ltr");
			if (dir === null) return;
			e.preventDefault();
			step(dir);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [route.visible.value]);

	useEffect(() => {
		document.querySelector(`.${PANEL_CLASS} .ui-drawer__body`)?.scrollTo({ top: 0 });
	}, [item?.id]);

	return (
		<Drawer
			visible={route.visible}
			position={sheet ? "bottom" : "right"}
			size={sheet ? "var(--overlay-h-md)" : undefined}
			labelledBy={TITLE_ID}
			class={cx(PANEL_CLASS, sheet && `${PANEL_CLASS}--sheet`)}
			actions={position && position.total > 1
				? <Stepper position={position} onStep={step} announcement={announcement.value} />
				: null}
			footer={item ? <DetailActions item={item} ctx={ctx} authed={authed} /> : null}
			onVisibleChange={(v) => {
				if (!v) route.close();
			}}
		>
			{item && <DetailPanel item={item} titleId={TITLE_ID} />}
		</Drawer>
	);
}

function isEditable(el: Element): boolean {
	return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
		el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * The header stepper. `aria-disabled` rather than `disabled` at either end, so the button a reader
 * just pressed to reach the last result keeps focus instead of dropping it to the document.
 */
function Stepper(
	{ position, onStep, announcement }: {
		position: StepPosition;
		onStep: (dir: -1 | 1) => void;
		announcement: string;
	},
): JSX.Element {
	return (
		<div class="ex-detail-step" role="group" aria-label="Browse results">
			<Tooltip content="Previous result">
				<button
					type="button"
					class="ex-detail-step__btn"
					aria-label="Previous result"
					aria-keyshortcuts="ArrowLeft"
					aria-disabled={!position.prev}
					onClick={() => onStep(-1)}
				>
					<Icon name="chevron-left" class="ex-detail-step__icon" aria-hidden />
				</button>
			</Tooltip>
			<Tooltip content="Next result">
				<button
					type="button"
					class="ex-detail-step__btn"
					aria-label="Next result"
					aria-keyshortcuts="ArrowRight"
					aria-disabled={!position.next}
					onClick={() => onStep(1)}
				>
					<Icon name="chevron-right" class="ex-detail-step__icon" aria-hidden />
				</button>
			</Tooltip>
			<span class="ex-detail-step__count">
				{position.index + 1} of {position.total}
			</span>
			<span class="ui-visually-hidden" aria-live="polite">{announcement}</span>
		</div>
	);
}
