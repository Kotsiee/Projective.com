import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import type { WorkspaceKind } from "@projective/types/workspace";
import { initialsOf } from "../core/workspace-model.ts";

/**
 * EntityMark — the surface's single entity badge: a **rounded square** carrying a logo, or the
 * entity's initials when there is none.
 *
 * The one hard visual rule of `/teams` and `/businesses` is **squares are entities, circles are
 * people**. That distinction does real work: a roster row, an invitation strip and an org chart all
 * mix organisations and humans, and a reader must be able to tell which is which before reading a
 * single word. `Avatar` from `@projective/ui/display` stays the only way to draw a person; this is
 * the only way to draw an entity, and nothing on the surface renders an entity square by hand.
 *
 * The mark is **kind-tinted through the cascade, not through a branch**: passing {@link kind} stamps
 * `data-kind`, which re-resolves the `--wsp-kind*` trio for this subtree (`workspace-tokens.css`), so
 * a team takes the brand tint and a business the accent tint without this component knowing either
 * colour. That is also why a mark nested inside an already-`data-kind`-stamped region can omit
 * {@link kind} and inherit correctly.
 *
 * ## Labelling
 * By default the mark is **decorative** (`aria-hidden`, `alt=""`): it virtually always sits beside
 * the entity's name, and announcing "Northwind" twice is noise. Pass {@link label} only when the
 * mark is the *sole* content of a control — the collapsed rail's entity button, for instance — where
 * it becomes `role="img"` with that name. It never carries a native `title` (§B.6).
 */

// #region Props
/** The four mark sizes, matching the `--wsp-mark-*` geometry tokens. */
export type EntityMarkSize = "sm" | "md" | "lg" | "xl";

export interface EntityMarkProps {
	/** The entity's display name — the source of the initials. */
	name: string;
	/** `@handle` without the `@`, used as the initials fallback for a name that is empty or symbolic. */
	handle?: string;
	/**
	 * Which kind to tint as. Omit inside a region that already carries `data-kind` (a console body, a
	 * roster card) so the mark inherits rather than re-declaring.
	 */
	kind?: WorkspaceKind;
	/** Logo URL. An empty string or `null` falls through to the initial badge. */
	image?: string | null;
	/** Geometry step (default `md`). */
	size?: EntityMarkSize;
	/** Filled kind background — reserved for placements where the entity IS the subject of the page. */
	solid?: boolean;
	/** Accessible name. Supply this ONLY when the mark is the entire content of a control. */
	label?: string;
	class?: string;
}
// #endregion

// #region Component
/** The rounded-square entity badge. See the module header for the squares-vs-circles rule. */
export function EntityMark(props: EntityMarkProps): JSX.Element {
	const size = props.size ?? "md";
	const src = props.image && props.image.length > 0 ? props.image : null;

	// Either the mark names itself (sole content of a control) or it is silent (name is adjacent).
	// `role` is widened to Preact's `AriaRole` explicitly — inferring it as a bare `string` from the
	// object literal makes the spread unassignable to the span's attribute type.
	const a11y: JSX.HTMLAttributes<HTMLSpanElement> = props.label
		? { role: "img", "aria-label": props.label }
		: { "aria-hidden": "true" };

	return (
		<span
			class={cx(
				"wsp-mark",
				size !== "md" && `wsp-mark--${size}`,
				props.solid && "wsp-mark--solid",
				props.class,
			)}
			data-kind={props.kind}
			{...a11y}
		>
			{src
				? <img class="wsp-mark__img" src={src} alt="" loading="lazy" decoding="async" />
				: (
					<span class="wsp-mark__initial">
						{initialsOf(props.name, props.handle ?? "")}
					</span>
				)}
		</span>
	);
}
// #endregion
