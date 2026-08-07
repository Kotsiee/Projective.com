import type { VNode } from "preact";
import { Icon, IconShell } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { PurchasableItemGroup } from "../types/checkout-types.ts";

/**
 * checkout-glyphs — the `/basket` + `/checkout` icon vocabulary.
 *
 * Everything that has a canonical registry name renders through {@link Icon}, so the surface inherits
 * the one weight, one grid and one sizing model the icon contract governs (DESIGN_SYSTEM.md §B.7); a
 * feature does not hand-author an `<svg>` for a glyph the registry already holds.
 *
 * The one exception is {@link CollapseGlyph}: the lane's collapse control is a MORPHING glyph whose
 * dotted divider is animated by `lane.css` against `.shell-toggle__bar`, so it must be authored
 * locally — through {@link IconShell}, which is exactly the escape hatch the contract provides for a
 * feature-owned mark. It is drawn identically to the global rail's and the wallet lane's, because the
 * three are the same control at three scales and a reader must not have to learn it twice.
 */

// #region Registry glyphs
/** The glyph a purchasable group is represented by in a heading, a rail square or a row. */
export function groupIconName(group: PurchasableItemGroup): IconName {
	switch (group) {
		case "product":
			return "box";
		case "project":
			return "projects";
		case "session":
			return "calendar";
		case "service":
		default:
			return "service";
	}
}

/** The leading glyph for a basket group heading. */
export function GroupIcon({ group }: { group: PurchasableItemGroup }): VNode {
	return <Icon name={groupIconName(group)} />;
}
// #endregion

// #region Feature-owned marks
/**
 * The lane's collapse/expand mark — a rounded panel with a dotted divider that slides across as the
 * lane opens and closes. Authored here rather than taken from the registry because `lane.css` animates
 * its inner bar; it is drawn through {@link IconShell} so it still inherits the contract's stroke,
 * grid handling and `aria-hidden` default.
 */
export const CollapseGlyph: VNode = (
	<IconShell size={20} focusable="false">
		<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="3" />
		<path d="M9.6 6.6v10.8" stroke-dasharray="2.2 2.4" />
	</IconShell>
);
// #endregion
