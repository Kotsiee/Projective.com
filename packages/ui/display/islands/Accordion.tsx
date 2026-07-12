import type { ComponentChildren, JSX, VNode } from "preact";
import { toChildArray } from "preact";
import { useMemo, useRef } from "preact/hooks";
import "../styles/accordion.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

// #region AccordionTab
export interface AccordionTabProps {
	/** Header content (clickable trigger label). */
	header: string | VNode;
	disabled?: boolean;
	children?: ComponentChildren;
}

/**
 * AccordionTab — a declarative panel descriptor, used only as a child of {@link Accordion}.
 * `Accordion` reads `header`/`disabled`/`children` directly off each `AccordionTab` element before
 * rendering its own header-button + panel markup, so this component is never rendered on its own and
 * always returns `null`.
 */
export function AccordionTab(_props: AccordionTabProps): VNode | null {
	return null;
}
// #endregion

// #region Model
/** Imperative alternative to `AccordionTab` children — pass a pre-built array of tab descriptors. */
export interface AccordionTabModel {
	header: string | VNode;
	disabled?: boolean;
	content: ComponentChildren;
}

function tabsFromChildren(children: ComponentChildren): AccordionTabModel[] {
	return toChildArray(children)
		.filter((c): c is VNode<AccordionTabProps> =>
			typeof c === "object" && c !== null && "props" in c
		)
		.map((c) => ({
			header: c.props.header,
			disabled: c.props.disabled,
			content: c.props.children,
		}));
}
// #endregion

export interface AccordionProps {
	/** {@link AccordionTab} elements. Ignored when `tabs` is supplied. */
	children?: ComponentChildren;
	/** Imperative tab list — an alternative to `AccordionTab` children. */
	tabs?: AccordionTabModel[];
	/** Allow more than one panel open at a time (default `false` — single/exclusive). */
	multiple?: boolean;
	/**
	 * Open panel index (single mode, `-1` = none) or indices (`multiple` mode). Raw value
	 * (uncontrolled) or a `Signal` (controlled) — signal-first per the value-binding contract.
	 */
	activeIndex?: Bindable<number | number[]>;
	onTabChange?: ValueChange<number | number[]>;
	id?: string;
	class?: string;
}

/**
 * Accordion — vertical expand/collapse panels. `multiple` toggles between exclusive (one open panel)
 * and independent (many open) modes; `activeIndex` is signal-first via {@link useControllable}.
 * Panels animate open/closed with a CSS grid-rows transition (no JS height measurement); the global
 * reduced-motion rule collapses this to an instant jump-to-final. Full APG accordion keyboard model:
 * ArrowUp/Down move focus between headers (wrapping), Home/End jump to the first/last header, and
 * Enter/Space (native button activation) toggles the focused panel. Each header is a `button` with
 * `aria-expanded`/`aria-controls`; each panel is `role="region"` `aria-labelledby` its header and
 * `inert` while collapsed so its content leaves the tab order without being removed from the DOM.
 */
export function Accordion(props: AccordionProps): JSX.Element {
	const { children, tabs, multiple = false, activeIndex, onTabChange, id, class: className } = props;

	const rootId = useId(id, "accordion");
	const model = useMemo(() => tabs ?? tabsFromChildren(children), [tabs, children]);

	const fallback = useMemo<number | number[]>(() => (multiple ? [] : -1), [multiple]);
	const ctrl = useControllable<number | number[]>(activeIndex, fallback, onTabChange);
	const headerRefs = useRef<Array<HTMLButtonElement | null>>([]);

	// #region Open state
	const isOpen = (i: number): boolean => {
		const v = ctrl.signal.value;
		return Array.isArray(v) ? v.includes(i) : v === i;
	};

	const toggle = (i: number) => {
		if (model[i]?.disabled) return;
		const v = ctrl.get();
		if (Array.isArray(v)) {
			ctrl.set(v.includes(i) ? v.filter((x) => x !== i) : [...v, i]);
		} else {
			ctrl.set(v === i ? -1 : i);
		}
	};
	// #endregion

	// #region Keyboard — APG accordion: Up/Down/Home/End move focus between headers
	const focusHeader = (i: number) => headerRefs.current[i]?.focus();

	const onHeaderKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number) => {
		const n = model.length;
		if (n === 0) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				focusHeader((i + 1) % n);
				break;
			case "ArrowUp":
				e.preventDefault();
				focusHeader((i - 1 + n) % n);
				break;
			case "Home":
				e.preventDefault();
				focusHeader(0);
				break;
			case "End":
				e.preventDefault();
				focusHeader(n - 1);
				break;
		}
	};
	// #endregion

	return (
		<div class={cx("ui-accordion", className)} id={rootId}>
			{model.map((tab, i) => {
				const headerId = `${rootId}-header-${i}`;
				const panelId = `${rootId}-panel-${i}`;
				const open = isOpen(i);
				return (
					<div
						class={cx("ui-accordion__tab", open && "ui-accordion__tab--open")}
						key={i}
					>
						<h3 class="ui-accordion__heading">
							<button
								ref={(el) => {
									headerRefs.current[i] = el;
								}}
								id={headerId}
								type="button"
								class={cx(
									"ui-accordion__header",
									tab.disabled && "ui-accordion__header--disabled",
								)}
								aria-expanded={open}
								aria-controls={panelId}
								disabled={tab.disabled}
								onClick={() => toggle(i)}
								onKeyDown={(e) => onHeaderKeyDown(e, i)}
							>
								<span class="ui-accordion__header-label">{tab.header}</span>
								<span class="ui-accordion__chevron" aria-hidden="true">▾</span>
							</button>
						</h3>
						<div
							id={panelId}
							role="region"
							aria-labelledby={headerId}
							class={cx("ui-accordion__panel", open && "ui-accordion__panel--open")}
							inert={!open || undefined}
						>
							<div class="ui-accordion__panel-inner">{tab.content}</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
