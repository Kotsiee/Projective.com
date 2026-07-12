import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/steps.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useListNavigation } from "../../hooks/useListNavigation.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";

// #region Props
/** Props for {@link Steps}. */
export interface StepsProps {
	/** Ordered wizard steps. */
	model: MenuItem[];
	/** Bound active step index (0-based) — raw number (uncontrolled) or `Signal<number>` (controlled). */
	activeIndex: Bindable<number>;
	/** Fired whenever the active step changes (click or keyboard activation). */
	onActiveIndexChange?: ValueChange<number>;
	/** Block navigation entirely — steps render but neither click nor keyboard can activate one. */
	readonly?: boolean;
	/** Custom renderer for a step's inner content (marker + label). */
	itemTemplate?: (item: MenuItem, index: number) => VNode;
	/** Accessible label for the `nav` landmark (default `"Progress"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * Steps — a horizontal wizard step indicator (the nav-only sibling of the layout Stepper; it does
 * not render content panels). Each step is a numbered (or `icon`) marker joined by a connector line,
 * coloured by completion state (`complete` / `current` / `upcoming`). The current step carries
 * `aria-current="step"`. Keyboard: roving tabindex across enabled steps, Left/Up and Right/Down move
 * (and activate, unless `readonly`), Home/End jump to the ends, Enter/Space activate the focused
 * step. `readonly` renders the same markup but blocks both click and keyboard activation.
 */
export function Steps(props: StepsProps): JSX.Element {
	const {
		model,
		activeIndex,
		onActiveIndexChange,
		readonly = false,
		itemTemplate,
		"aria-label": ariaLabel = "Progress",
		class: className,
	} = props;

	const ctrl = useControllable<number>(activeIndex, 0, onActiveIndexChange);
	const rootId = useId(undefined, "steps");
	const active = ctrl.signal.value;

	const isDisabled = (i: number) => !!model[i]?.disabled;
	const nav = useListNavigation(() => model.length, isDisabled);

	const stepRefs = useRef<Map<number, HTMLElement>>(new Map());

	useEffect(() => {
		nav.reset(active);
	}, [active, model.length]);

	// #region Activation
	const canActivate = (i: number) => !readonly && !isDisabled(i);

	const goTo = (i: number) => {
		if (!canActivate(i)) return;
		ctrl.set(i);
	};

	const focusStep = (i: number) => stepRefs.current.get(i)?.focus();
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		let moved = true;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") nav.move(1);
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nav.move(-1);
		else if (e.key === "Home") nav.toEdge("first");
		else if (e.key === "End") nav.toEdge("last");
		else moved = false;

		if (moved) {
			e.preventDefault();
			focusStep(nav.active.peek());
			return;
		}
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			goTo(i);
		}
	};
	// #endregion

	return (
		<nav class={cx("ui-steps", className)} aria-label={ariaLabel}>
			<ol class="ui-steps__list">
				{model.map((item, i) => {
					const state = i < active ? "complete" : i === active ? "current" : "upcoming";
					const disabled = isDisabled(i);
					const clickable = canActivate(i);
					const content = itemTemplate ? itemTemplate(item, i) : (
						<>
							<span class="ui-steps__marker" aria-hidden="true">
								{item.icon ? item.icon : i + 1}
							</span>
							{item.label && <span class="ui-steps__label">{item.label}</span>}
						</>
					);

					const shared = {
						id: `${rootId}-step-${i}`,
						class: cx(
							"ui-steps__trigger",
							`ui-steps__trigger--${state}`,
							disabled && "ui-steps__trigger--disabled",
						),
						"aria-current": i === active ? ("step" as const) : undefined,
						"aria-disabled": disabled || undefined,
						tabIndex: i === nav.active.value ? 0 : -1,
						onFocus: () => nav.reset(i),
						onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onKeyDown(e, i),
						ref: (el: HTMLElement | null) => {
							if (el) stepRefs.current.set(i, el);
							else stepRefs.current.delete(i);
						},
					};

					return (
						<li
							key={item.key ?? item.label ?? i}
							class={cx("ui-steps__item", `ui-steps__item--${state}`)}
						>
							{item.url && !disabled
								? (
									<a
										{...shared}
										href={item.url}
										onClick={(e: Event) => {
											if (!clickable) {
												e.preventDefault();
												return;
											}
											goTo(i);
										}}
									>
										{content}
									</a>
								)
								: (
									<button
										{...shared}
										type="button"
										disabled={disabled}
										onClick={() => goTo(i)}
									>
										{content}
									</button>
								)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
