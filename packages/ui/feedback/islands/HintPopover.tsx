import type { ComponentChildren, JSX, RefObject } from "preact";
import "../styles/hint-popover.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/components/Icon.tsx";
import { Popover } from "./Popover.tsx";
import type { Placement } from "../../types/mod.ts";

// #region Props
/** Props for {@link HintPopover}. */
export interface HintPopoverProps {
	/**
	 * The explanation. Rich content is allowed — prose, a list, and crucially a LINK — which is the
	 * whole reason this is not a Tooltip.
	 */
	children: ComponentChildren;
	/**
	 * The trigger's accessible name and the panel's. Defaults to a generic phrase, but a caller that
	 * knows the field should name it ("About project visibility"): a page of eleven buttons all called
	 * "More information" is a rotor listing eleven identical entries.
	 */
	label?: string;
	/** Preferred side; flips on overflow (default `top`). */
	placement?: Placement;
	/** Extra class(es) merged onto the panel. */
	class?: string;
}
// #endregion

/**
 * HintPopover — the inline "?" affordance that discloses a field's explanation on demand.
 *
 * **It is built on {@link Popover}, and the choice is forced rather than stylistic.** A hint that can
 * carry a link cannot be a `Tooltip`: `.ui-tooltip` is `pointer-events: none`, so the link is
 * unclickable; the panel hides on `pointerleave`/`focusout`, so it is gone before a pointer can travel
 * to it; and `role="tooltip"` may not contain interactive content at all, because a tooltip is a
 * description of its anchor rather than a place to go. Popover is `role="dialog"` with a focus trap,
 * Escape dismissal, and a real tab order, which is what a disclosure holding a link needs.
 *
 * The relationship is `aria-expanded` + `aria-controls`, NOT `aria-describedby`. A body-portalled panel
 * that is not mounted while closed cannot be the target of a description — the IDREF would resolve to
 * nothing and the description would be silently dropped from the accessibility tree for most of the
 * control's life. **A caller must therefore keep the field's own explanation in the DOM** (visually
 * hidden is fine) and point `aria-describedby` at THAT, so the description is always resolvable and
 * this button is a purely visual progressive disclosure of text the field already carries.
 *
 * The trigger is icon-only, so it carries a real `aria-label` (§B.7.5) and `.ui-hit` to reach the 24px
 * target floor (WCAG 2.2 SC 2.5.8) without inflating the 14px glyph. It deliberately carries no
 * `Tooltip` of its own: the panel IS the disclosure, and a hover tip that says "Help" above a panel
 * that says the actual thing is noise on the way to the content.
 *
 * @example
 * ```tsx
 * <span class="ui-visually-hidden" id="vis-hint">Who can find this project once it is published.</span>
 * <Select aria-describedby="vis-hint" … />
 * <HintPopover label="About project visibility">
 *   Who can find this project once it is published. <a href="/help/visibility">Find out more</a>
 * </HintPopover>
 * ```
 */
export function HintPopover(props: HintPopoverProps): JSX.Element {
	const { children, label = "More information", placement = "top", class: className } = props;
	return (
		<Popover
			label={label}
			placement={placement}
			class={cx("ui-hint__panel", className)}
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="ui-hint__trigger ui-hit"
					aria-label={label}
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={api.toggle}
				>
					<Icon name="help" size="xs" />
				</button>
			)}
		>
			<div class="ui-hint__body">{children}</div>
		</Popover>
	);
}
