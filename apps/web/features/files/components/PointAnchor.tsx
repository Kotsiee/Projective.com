import type { JSX, Ref, RefObject } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { BodyPortal } from "@projective/ui/overlay";
import type { PressPoint } from "../core/press-point.ts";

/**
 * PointAnchor — a zero-size box at a viewport point, for a popover a menu row opened to stand where the
 * reader clicked (Decision #407). Portalled to `document.body`, as `ActionMenu`'s own point is: a
 * `position: fixed` box left inside the lane's glass chrome would be re-based onto it (§B.10.4).
 */
export function PointAnchor(
	{ at, anchorRef }: { at: PressPoint; anchorRef: RefObject<HTMLElement> },
): JSX.Element {
	return (
		<BodyPortal>
			<span
				ref={anchorRef as Ref<HTMLSpanElement>}
				class="fh-point"
				aria-hidden="true"
				style={styleVars({ "--fh-point-x": `${at.x}px`, "--fh-point-y": `${at.y}px` })}
			/>
		</BodyPortal>
	);
}
