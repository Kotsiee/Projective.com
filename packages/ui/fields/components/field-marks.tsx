import type { JSX } from "preact";
import type { FieldStatus } from "../types/mod.ts";
import { statusMark } from "../core/field.ts";
import { IconShell } from "../../icons/mod.ts";

/**
 * Field status marks — the icon/shape channel that keeps a validation state off hue alone (§A.5).
 *
 * Three shapes, chosen to stay distinct under every colour-vision simulation and at 1em: a **bang**
 * for "this is wrong", a **tick** for "this is right", a **half-filled ring** for the softer amber
 * publishing gate. They inherit `currentColor` from `.ui-field__mark`, which the status modifier
 * paints, so a control never has to know which colour its own state is.
 *
 * Drawn on the 16-unit grid and rendered through the one icon contract ({@link IconShell},
 * DESIGN_SYSTEM.md §B.7), so a status mark sits beside a chevron or a clear button at exactly the
 * same rendered stroke without either knowing about the other.
 */

/** The authoring grid these marks were drawn on. */
const BOX = "0 0 16 16";

/** Invalid / unmet required gate. */
export function AlertMark(): JSX.Element {
	return (
		<IconShell viewBox={BOX}>
			<circle cx="8" cy="8" r="6.2" />
			<path d="M8 4.9v3.6" />
			<path d="M8 11.1h.01" />
		</IconShell>
	);
}

/** Valid. */
export function CheckMark(): JSX.Element {
	return (
		<IconShell viewBox={BOX}>
			<circle cx="8" cy="8" r="6.2" />
			<path d="M5.3 8.2 7.2 10.1l3.5-4" />
		</IconShell>
	);
}

/** Warning / publishing gate — informative, not an error. */
export function GateMark(): JSX.Element {
	return (
		<IconShell viewBox={BOX}>
			<circle cx="8" cy="8" r="6.2" />
			<path d="M8 1.8v12.4" stroke-dasharray="2.2 2.2" />
			<path d="M8 5.4v3.2" />
		</IconShell>
	);
}

/**
 * The mark for a status, or `null` for the neutral default. Controls render this straight into their
 * `.ui-field__mark` slot; when it returns `null` the slot collapses to zero width.
 */
export function FieldMark(props: { status?: FieldStatus }): JSX.Element | null {
	switch (statusMark(props.status)) {
		case "alert":
			return <AlertMark />;
		case "check":
			return <CheckMark />;
		case "gate":
			return <GateMark />;
		default:
			return null;
	}
}

/**
 * A busy indicator for `loading`. A ring with a gap, rotating — the taxonomy's only spinner, shared
 * so a loading AutoComplete and a loading Button cannot drift apart. Reduced motion freezes it into
 * a static three-quarter ring, which still reads as "not settled yet".
 */
export function BusyMark(): JSX.Element {
	return (
		<IconShell viewBox={BOX} class="ui-field-busy">
			<path d="M14.2 8a6.2 6.2 0 1 0-2.1 4.7" />
		</IconShell>
	);
}
