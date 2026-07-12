import type { ComponentChildren, CSSProperties, JSX, VNode } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/fieldset.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

// #region Props
export interface FieldsetProps {
	/** Legend text — plain string or a custom node. */
	legend: string | VNode;
	/** Renders the legend as a collapse/expand toggle (default `false`). */
	toggleable?: boolean;
	/** Collapsed state — raw boolean (uncontrolled) or a `Signal<boolean>` (controlled). */
	collapsed?: Bindable<boolean>;
	/** Fired whenever the collapsed state changes (user toggle only). */
	onCollapsedChange?: ValueChange<boolean>;
	id?: string;
	class?: string;
	style?: CSSProperties;
	children?: ComponentChildren;
}
// #endregion

/**
 * Fieldset — a semantic `<fieldset>`/`<legend>` grouping for related controls, optionally
 * collapsible. Uses the same grid `0fr -> 1fr` collapse technique as {@link Panel} (reduced-motion
 * jumps to the final state via the global token override). The legend hairline outline is the one
 * exception to "no full borders on non-interactive content" — a `<fieldset>` groups interactive
 * controls itself, so a subtle 1px outline is the semantically-correct affordance here.
 */
export function Fieldset(props: FieldsetProps): JSX.Element {
	const {
		legend,
		toggleable = false,
		collapsed,
		onCollapsedChange,
		id,
		class: className,
		style,
		children,
	} = props;

	const ctrl = useControllable<boolean>(collapsed, false, onCollapsedChange);
	const rootId = useId(id, "fieldset");
	const bodyId = `${rootId}-body`;

	const isCollapsed = toggleable && ctrl.signal.value;
	const settled = useSignal(isCollapsed);
	useEffect(() => {
		if (!isCollapsed) settled.value = false;
	}, [isCollapsed]);

	const toggle = () => ctrl.set(!ctrl.get());

	return (
		<fieldset id={rootId} class={cx("ui-fieldset", className)} style={style}>
			<legend class="ui-fieldset__legend">
				{toggleable
					? (
						<button
							type="button"
							class="ui-fieldset__toggle"
							aria-expanded={!isCollapsed}
							aria-controls={bodyId}
							onClick={toggle}
						>
							<span
								class="ui-fieldset__chevron"
								data-collapsed={isCollapsed ? "true" : "false"}
								aria-hidden="true"
							/>
							<span>{legend}</span>
						</button>
					)
					: legend}
			</legend>

			<div
				class="ui-fieldset__collapse"
				data-collapsed={isCollapsed ? "true" : "false"}
				onTransitionEnd={(e) => {
					if (isCollapsed && e.propertyName === "grid-template-rows") settled.value = true;
				}}
			>
				<div
					id={bodyId}
					class={cx("ui-fieldset__body", settled.value && "ui-fieldset__body--settled")}
				>
					{children}
				</div>
			</div>
		</fieldset>
	);
}
