import type { ComponentChildren, CSSProperties, JSX, VNode } from "preact";
import { toChildArray } from "preact";
import { useRef } from "preact/hooks";
import "../styles/stepper.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

export type StepperOrientation = "horizontal" | "vertical";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// #region StepperPanel
export interface StepperPanelProps {
	/** Step label shown on the track — plain text or a custom node. */
	header: string | VNode;
	/** Disallow navigating to this step (marker renders muted, click/keyboard skip it). */
	disabled?: boolean;
	children?: ComponentChildren;
}

/**
 * StepperPanel — declares one step's track label and content. Rendered only when it is the active
 * step; the parent {@link Stepper} reads `header`/`disabled` directly off this child's `VNode`.
 */
export function StepperPanel(props: StepperPanelProps): JSX.Element {
	return <>{props.children}</>;
}
// #endregion

// #region Stepper
export interface StepperRenderContext {
	activeStep: number;
	stepCount: number;
	isFirst: boolean;
	isLast: boolean;
	next: () => void;
	prev: () => void;
	goTo: (index: number) => void;
}

export interface StepperProps {
	/** Active step index — raw number (uncontrolled) or a `Signal<number>` (controlled). */
	activeStep?: Bindable<number>;
	onActiveStepChange?: ValueChange<number>;
	/** Track axis (default `horizontal`). */
	orientation?: StepperOrientation;
	/** Block skipping ahead of the furthest step visited (default `false`). */
	linear?: boolean;
	/** Custom prev/next controls; defaults to a Back/Next button pair when omitted. */
	controls?: (ctx: StepperRenderContext) => VNode;
	id?: string;
	class?: string;
	style?: CSSProperties;
	/** {@link StepperPanel} elements, one per step. */
	children: ComponentChildren;
}

/**
 * Stepper — a linear workflow track. Renders a header row of step markers (number, done-check, or
 * disabled) and the active step's content below/beside it. In `linear` mode a step is only reachable
 * once every prior step has been visited. Keyboard: Arrow keys move focus between step markers (roving
 * `tabIndex`), Home/End jump to the first/last enabled marker; `aria-current="step"` marks the active
 * one.
 */
export function Stepper(props: StepperProps): JSX.Element {
	const {
		activeStep,
		onActiveStepChange,
		orientation = "horizontal",
		linear = false,
		controls,
		id,
		class: className,
		style,
		children,
	} = props;

	const panels = toChildArray(children) as VNode<StepperPanelProps>[];
	const count = panels.length;
	const ctrl = useControllable<number>(activeStep, 0, onActiveStepChange);
	const rootId = useId(id, "stepper");
	const maxVisited = useRef(ctrl.get());
	const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const active = clamp(ctrl.signal.value, 0, Math.max(0, count - 1));
	if (active > maxVisited.current) maxVisited.current = active;

	const isReachable = (index: number) =>
		!panels[index]?.props.disabled && (!linear || index <= maxVisited.current + 1);

	const goTo = (index: number) => {
		const target = clamp(index, 0, count - 1);
		if (!isReachable(target)) return;
		ctrl.set(target);
	};
	const next = () => goTo(active + 1);
	const prev = () => goTo(active - 1);

	const onStepKeyDown = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		const horiz = orientation === "horizontal";
		const forwardKey = horiz ? "ArrowRight" : "ArrowDown";
		const backwardKey = horiz ? "ArrowLeft" : "ArrowUp";
		let target = -1;
		if (e.key === forwardKey) target = Math.min(count - 1, index + 1);
		else if (e.key === backwardKey) target = Math.max(0, index - 1);
		else if (e.key === "Home") target = 0;
		else if (e.key === "End") target = count - 1;
		else return;
		e.preventDefault();
		stepRefs.current[target]?.focus();
	};

	const ctx: StepperRenderContext = {
		activeStep: active,
		stepCount: count,
		isFirst: active === 0,
		isLast: active === count - 1,
		next,
		prev,
		goTo,
	};

	return (
		<div
			id={rootId}
			class={cx("ui-stepper", `ui-stepper--${orientation}`, className)}
			style={style}
		>
			<ol class="ui-stepper__track" aria-label="Progress">
				{panels.map((panel, i) => {
					const done = i < active;
					const isActive = i === active;
					const disabled = !isReachable(i);
					return (
						<li key={i} class="ui-stepper__item">
							<button
								ref={(el) => {
									stepRefs.current[i] = el;
								}}
								type="button"
								class={cx(
									"ui-stepper__step",
									isActive && "ui-stepper__step--active",
									done && "ui-stepper__step--done",
									disabled && "ui-stepper__step--disabled",
								)}
								aria-current={isActive ? "step" : undefined}
								aria-disabled={disabled || undefined}
								tabIndex={isActive ? 0 : -1}
								onClick={() => goTo(i)}
								onKeyDown={onStepKeyDown(i)}
							>
								<span class="ui-stepper__marker" aria-hidden="true">
									{done ? <span class="ui-stepper__check" /> : i + 1}
								</span>
								<span class="ui-stepper__label">{panel.props.header}</span>
							</button>
							{i < count - 1 && <span class="ui-stepper__connector" aria-hidden="true" />}
						</li>
					);
				})}
			</ol>

			<div
				class="ui-stepper__content"
				role="group"
				aria-label={typeof panels[active]?.props.header === "string"
					? panels[active].props.header as string
					: undefined}
			>
				{panels[active]}
			</div>

			<div class="ui-stepper__nav">
				{controls ? controls(ctx) : (
					<>
						<button
							type="button"
							class="ui-stepper__nav-btn"
							disabled={ctx.isFirst}
							onClick={prev}
						>
							Back
						</button>
						<button
							type="button"
							class="ui-stepper__nav-btn ui-stepper__nav-btn--primary"
							disabled={ctx.isLast}
							onClick={next}
						>
							Next
						</button>
					</>
				)}
			</div>
		</div>
	);
}
// #endregion
