import type { ComponentChildren, JSX } from "preact";
import "../styles/obscure.css";
import { cx } from "../../core/cx.ts";
import { Button } from "../../fields/components/Button.tsx";
import { Icon } from "../../icons/mod.ts";
import { ScreenShareContext, useHoldToReveal, useScreenShareActive } from "../core/screen-share.ts";

export interface RevealHoldProps {
	children: ComponentChildren;
	/** The Show control's label (default "Show"). */
	label?: string;
	/** Id of the region it reveals, for the control's `aria-controls`. */
	controls?: string;
	class?: string;
}

/**
 * RevealHold — the press-and-hold Show on a payment confirmation (Decision #297 ruling (c)): while
 * screen sharing mode is on, the amounts inside render masked except while Show is held, so a
 * person can check what they are about to commit. With the mode off it adds no control.
 */
export function RevealHold(props: RevealHoldProps): JSX.Element {
	const active = useScreenShareActive();
	const hold = useHoldToReveal();
	return (
		<>
			<ScreenShareContext.Provider value={{ active: active && !hold.revealing }}>
				{props.children}
			</ScreenShareContext.Provider>
			{active
				? (
					<Button
						type="button"
						variant="text"
						severity="secondary"
						size="sm"
						class={cx("ui-reveal-hold", props.class)}
						icon={<Icon name="eye" size="xs" />}
						label={props.label ?? "Show"}
						aria-controls={props.controls}
						{...hold.handlers}
					/>
				)
				: null}
		</>
	);
}
