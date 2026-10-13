import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Drawer, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { cx } from "@ui/core/cx.ts";
import { searchScopeLabel } from "@features/marketing/core/landing-data.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { DetailActions } from "./DetailActions.tsx";
import { DetailTools } from "./DetailTools.tsx";
import {
	scopeOf,
	sectionJumpTarget,
	stepIndex,
	type StepPosition,
	stepPosition,
} from "../core/detail-nav.ts";
import { type HrefContext, itemHref } from "../core/routing.ts";
import type { DetailRoute } from "../hooks/useDetailRoute.ts";
import { useDetailKeys } from "../hooks/useDetailKeys.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/** The drawer panel's class — also how a key press is known to come from inside it. */
const PANEL_CLASS = "ex-detail-drawer";
const TITLE_ID = "ex-detail-title";

/**
 * ResultDetailDrawer — the Search Results detail drawer: the item's {@link DetailPanel} preview in the
 * body, a previous/next stepper and the Save/Share tools in the header, and "Open full page" alone in
 * the footer slot (§B.10.8). A right drawer at `--drawer-w` from `--bp-md` up, a bottom sheet below
 * it. The panel's own title names the dialog (`labelledBy`), so the header carries controls only.
 * URL ownership lives in {@link DetailRoute}; the keyboard in {@link useDetailKeys}. `onSwitchScope`
 * is asked to change the page's entity scope when Ctrl/Cmd + arrow finds no other section to visit;
 * it returns `null` when it declines, else resolves to the item it opened (`null` for none).
 */
export function ResultDetailDrawer(
	{ route, order, ctx, authed, sheet, onSwitchScope }: {
		route: DetailRoute;
		/** The visible results in reading order (`resultOrder`). */
		order: readonly ExploreItem[];
		ctx: HrefContext;
		authed: boolean;
		/** Below `--bp-md`: dock to the bottom edge as a sheet. */
		sheet: boolean;
		onSwitchScope?: (dir: -1 | 1) => Promise<ExploreItem | null> | null;
	},
): JSX.Element {
	const item = route.item.value;
	const position = item ? stepPosition(order, item.id) : null;
	const announcement = useSignal("");
	const regionRef = useRef<HTMLDivElement>(null);
	const latest = useRef({ order, position, item });
	latest.current = { order, position, item };

	function show(target: ExploreItem, index: number, total: number, lead?: string): void {
		route.open(target);
		announcement.value = `${lead ? `${lead}: ` : ""}${target.title}, result ${
			index + 1
		} of ${total}`;
	}

	function step(delta: number): void {
		const { order, position } = latest.current;
		if (!position) return;
		const next = stepIndex(position.index, delta, position.total);
		if (next !== null) show(order[next], next, position.total);
	}

	function section(dir: -1 | 1): void {
		const { order, position } = latest.current;
		const target = position ? sectionJumpTarget(order, position.index, dir) : null;
		if (target) {
			show(target, order.indexOf(target), order.length, searchScopeLabel(scopeOf(target.type)));
			return;
		}
		const switching = onSwitchScope?.(dir);
		if (!switching) return;
		void switching.then((opened) => {
			announcement.value = opened
				? `${searchScopeLabel(scopeOf(opened.type))}: ${opened.title}`
				: "No other category has results";
		});
	}

	function open(): void {
		const current = latest.current.item;
		if (current) globalThis.location.assign(itemHref(current, ctx));
	}

	useDetailKeys({
		active: route.visible.value,
		panelClass: PANEL_CLASS,
		regionRef,
		actions: { step, section, open },
	});

	useEffect(() => {
		regionRef.current?.closest(".ui-drawer__body")?.scrollTo({ top: 0 });
	}, [item?.id]);

	return (
		<Drawer
			visible={route.visible}
			position={sheet ? "bottom" : "right"}
			size={sheet ? "var(--overlay-h-md)" : undefined}
			labelledBy={TITLE_ID}
			initialFocusRef={regionRef}
			class={cx(PANEL_CLASS, sheet && `${PANEL_CLASS}--sheet`)}
			actions={
				<>
					{position && position.total > 1 && <Stepper position={position} onStep={step} />}
					<span class="ui-visually-hidden" aria-live="polite">{announcement.value}</span>
				</>
			}
			tools={item ? <DetailTools item={item} ctx={ctx} authed={authed} /> : null}
			footer={item ? <DetailActions href={itemHref(item, ctx)} /> : null}
			onVisibleChange={(v) => {
				if (!v) route.close();
			}}
		>
			{item && <DetailPanel item={item} titleId={TITLE_ID} regionRef={regionRef} />}
		</Drawer>
	);
}

/**
 * The header stepper. `aria-disabled` rather than `disabled` at either end, so the button a reader
 * just pressed to reach the last result keeps focus instead of dropping it to the document.
 */
function Stepper(
	{ position, onStep }: { position: StepPosition; onStep: (delta: number) => void },
): JSX.Element {
	return (
		<div class="ex-detail-step" role="group" aria-label="Browse results">
			<Tooltip content="Previous result" placement="bottom">
				<Button
					iconOnly
					rounded
					size="sm"
					variant="text"
					severity="secondary"
					class="ex-detail-step__btn ui-hit"
					icon={<Icon name="chevron-left" size="sm" />}
					aria-label="Previous result"
					aria-keyshortcuts="ArrowLeft Shift+ArrowLeft"
					aria-disabled={!position.prev}
					onClick={() => onStep(-1)}
				/>
			</Tooltip>
			<span class="ex-detail-step__count">
				{position.index + 1} of {position.total}
			</span>
			<Tooltip content="Next result" placement="bottom">
				<Button
					iconOnly
					rounded
					size="sm"
					variant="text"
					severity="secondary"
					class="ex-detail-step__btn ui-hit"
					icon={<Icon name="chevron-right" size="sm" />}
					aria-label="Next result"
					aria-keyshortcuts="ArrowRight Shift+ArrowRight"
					aria-disabled={!position.next}
					onClick={() => onStep(1)}
				/>
			</Tooltip>
		</div>
	);
}
