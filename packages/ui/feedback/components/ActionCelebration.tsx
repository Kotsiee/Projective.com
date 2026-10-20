import type { ComponentChildren, JSX } from "preact";
import "../styles/action-celebration.css";
import { cx } from "../../core/cx.ts";
import { motionReduced } from "../../display/core/scroll-spy.ts";

/** Props for {@link ActionCelebration}. */
export interface ActionCelebrationProps {
	/** Play the burst; drive it from `useActionCelebration().active` or a store signal. */
	active: boolean;
	/** The dots' ink: `primary` beside a filled commit, `neutral` beside an outlined utility. */
	tone?: "primary" | "neutral";
	/** The control being acknowledged. Its own box is never moved or resized. */
	children: ComponentChildren;
	/** Extra class(es) on the wrapper. */
	class?: string;
}

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * ActionCelebration — a one-shot spark burst around a control whose action has just committed
 * (a listing published, a follow made). Eight dots leave the control's edges and fade while the
 * control settles from a slight lift, on `--spring-snappy`; the wrapper is the anchor, so the
 * control keeps its own box and press feedback. Decorative: `aria-hidden`, never announced — the
 * caller's own status text says what happened. Under either reduced-motion channel the dots are not
 * rendered at all and nothing moves.
 */
export function ActionCelebration(props: ActionCelebrationProps): JSX.Element {
	const { active, tone = "primary", children, class: className } = props;
	const burst = active && !motionReduced();
	return (
		<span
			class={cx("ui-celebrate", `ui-celebrate--${tone}`, className)}
			data-active={burst ? "true" : undefined}
		>
			<span class="ui-celebrate__body">{children}</span>
			{burst && (
				<span class="ui-celebrate__burst" aria-hidden="true">
					{DOTS.map((i) => <i class="ui-celebrate__dot" key={i} />)}
				</span>
			)}
		</span>
	);
}
