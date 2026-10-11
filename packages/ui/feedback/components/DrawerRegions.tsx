import type { ComponentChildren, JSX } from "preact";

// #region Props
/** Props for {@link DrawerRegions}. */
export interface DrawerRegionsProps {
	/** The scrolling body. */
	children?: ComponentChildren;
	/** Actions pinned below the body; omitted (or `false`) renders no footer at all. */
	footer?: ComponentChildren;
}
// #endregion

/**
 * The Drawer's body and footer. The footer is the body's SIBLING, never its child, so it stays pinned
 * while the body scrolls and a commit button can never scroll out of view (§B.10.8). Kept free of the
 * stylesheet import so the contract is unit-testable.
 */
export function DrawerRegions({ children, footer }: DrawerRegionsProps): JSX.Element {
	return (
		<>
			<div class="ui-drawer__body">{children}</div>
			{footer != null && footer !== false && <div class="ui-drawer__footer">{footer}</div>}
		</>
	);
}
