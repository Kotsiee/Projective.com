import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/block-ui.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { styleVars } from "../../core/style.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Props
/** Props for {@link BlockUI}. */
export interface BlockUIProps {
	/** Blocked state — raw boolean (uncontrolled) or a `Signal<boolean>` (controlled). */
	blocked: Bindable<boolean>;
	/** Mask the whole viewport instead of just `children`. */
	fullScreen?: boolean;
	/** Content shown centred over the scrim (spinner, message). */
	template?: ComponentChildren;
	/** Blur the masked content behind the scrim. */
	blur?: boolean;
	/** Fired whenever the blocked state changes. */
	onBlockedChange?: (blocked: boolean) => void;
	/** The subtree to mask (ignored when `fullScreen`). */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * BlockUI — masks a subtree (or the whole page with `fullScreen`) while an async action runs. While
 * `blocked` it lays a token scrim over the content, optionally centring a `template` (spinner or
 * message), and makes the masked region non-interactive: pointer events are swallowed by the scrim
 * and the content is marked `inert` so keyboard focus cannot escape into it. The wrapper carries
 * `aria-busy` so assistive tech announces the pending state. Full-screen mode locks body scroll and
 * layers at `--z-overlay` via {@link useOverlayStack}.
 */
export function BlockUI(props: BlockUIProps): JSX.Element {
	const { blocked, fullScreen, template, blur, onBlockedChange, children, class: className } = props;

	const ctrl = useControllable<boolean>(blocked, false, onBlockedChange);
	const isBlocked = ctrl.signal.value;
	const contentRef = useRef<HTMLDivElement>(null);

	const stack = useOverlayStack({ active: isBlocked && !!fullScreen, lockScroll: !!fullScreen });

	// #region Inert masking (focus cannot enter the masked content)
	useEffect(() => {
		const el = contentRef.current;
		if (!el || fullScreen) return;
		if (isBlocked) el.setAttribute("inert", "");
		else el.removeAttribute("inert");
	}, [isBlocked, fullScreen]);
	// #endregion

	const scrim = isBlocked && (
		<div
			class={cx("ui-block-ui__mask", blur && "ui-block-ui__mask--blur")}
			style={fullScreen ? styleVars({ "--block-z": stack.zIndex }) : undefined}
			aria-hidden="true"
		>
			{template && <div class="ui-block-ui__content">{template}</div>}
		</div>
	);

	if (fullScreen) {
		return (
			<div class={cx("ui-block-ui ui-block-ui--fullscreen", className)} aria-busy={isBlocked || undefined}>
				{scrim}
			</div>
		);
	}

	return (
		<div class={cx("ui-block-ui", className)} aria-busy={isBlocked || undefined}>
			<div ref={contentRef} class="ui-block-ui__target">{children}</div>
			{scrim}
		</div>
	);
}
