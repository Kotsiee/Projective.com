import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * role-glyphs — the Roles screen's own domain mark, drawn on the `IconShell` contract (§B.7): the tick
 * standing on a rule that leads a capability's configured rule ("Spending at or above … needs an
 * approver's sign-off"). Allowed under a written rule is never drawn as a plain tick, which would
 * over-promise. `aria-hidden` (the `IconShell` default): the rule's own words carry it.
 */

/** A tick standing on a rule — allowed, inside a rule the entity configured. */
export function ConditionalGlyph(): JSX.Element {
	return (
		<IconShell focusable="false">
			<path d="M5.5 10.5l4 4L18.5 5" />
			<path d="M6 19h12" />
		</IconShell>
	);
}
