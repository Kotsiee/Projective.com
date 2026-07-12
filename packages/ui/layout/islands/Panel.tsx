import type { ComponentChildren, CSSProperties, JSX, VNode } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/panel.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

// #region Props
export interface PanelProps {
	/** Panel title — plain text or a custom node (icon + label composition, etc.). */
	header: string | VNode;
	/** Extra header actions rendered as siblings of the toggle control (never nested inside it). */
	icons?: VNode;
	/** Footer content, visually separated from the body by a hairline. */
	footer?: ComponentChildren;
	/** Renders a collapse/expand toggle in the header (default `false`, always expanded). */
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
 * Panel — a titled content region, optionally collapsible. The header is a single hairline below
 * the title row (§B.4 separation hierarchy); the body sits on a tonal `--surface-1` tint rather than
 * a boxed border. Collapse animates via a CSS grid `0fr → 1fr` track (no JS height measuring), so
 * reduced-motion users get an instant jump (global token durations collapse to `0ms`). While
 * collapsed the body is removed from the accessibility tree and tab order once the collapse
 * transition settles (`visibility: hidden`), and restored the instant expansion begins.
 *
 * Keyboard/aria: the header toggle is a real `<button>` with `aria-expanded` + `aria-controls`; the
 * body is `role="region"` labelled by the header.
 */
export function Panel(props: PanelProps): JSX.Element {
	const {
		header,
		icons,
		footer,
		toggleable = false,
		collapsed,
		onCollapsedChange,
		id,
		class: className,
		style,
		children,
	} = props;

	const ctrl = useControllable<boolean>(collapsed, false, onCollapsedChange);
	const rootId = useId(id, "panel");
	const headerId = `${rootId}-header`;
	const bodyId = `${rootId}-body`;

	const isCollapsed = toggleable && ctrl.signal.value;
	// #region Settle-after-collapse (removes the body from the a11y tree/tab order once hidden)
	const settled = useSignal(isCollapsed);
	useEffect(() => {
		if (!isCollapsed) settled.value = false;
	}, [isCollapsed]);
	// #endregion

	const toggle = () => ctrl.set(!ctrl.get());

	return (
		<section id={rootId} class={cx("ui-panel", className)} style={style}>
			<div class="ui-panel__header">
				{toggleable
					? (
						<button
							type="button"
							id={headerId}
							class="ui-panel__toggle"
							aria-expanded={!isCollapsed}
							aria-controls={bodyId}
							onClick={toggle}
						>
							<span
								class="ui-panel__chevron"
								data-collapsed={isCollapsed ? "true" : "false"}
								aria-hidden="true"
							/>
							<span class="ui-panel__title">{header}</span>
						</button>
					)
					: (
						<div id={headerId} class="ui-panel__title-row">
							<span class="ui-panel__title">{header}</span>
						</div>
					)}
				{icons && <div class="ui-panel__icons">{icons}</div>}
			</div>

			<div
				class="ui-panel__collapse"
				data-collapsed={isCollapsed ? "true" : "false"}
				onTransitionEnd={(e) => {
					if (isCollapsed && e.propertyName === "grid-template-rows") settled.value = true;
				}}
			>
				<div
					id={bodyId}
					class={cx("ui-panel__body", settled.value && "ui-panel__body--settled")}
					role="region"
					aria-labelledby={headerId}
				>
					{children}
				</div>
			</div>

			{footer && <div class="ui-panel__footer">{footer}</div>}
		</section>
	);
}
