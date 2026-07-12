import type { ComponentChildren, JSX } from "preact";
import "../styles/mobile-menu.css";
import { useSignal } from "@preact/signals";

export interface MobileMenuProps {
	/** Drawer contents — typically the same NavItems as the desktop sidebar. */
	children?: ComponentChildren;
	label?: string;
}

/**
 * MobileMenu — a hamburger trigger that opens a glass pull-out drawer (DESIGN_SYSTEM.md Part D.3).
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper. Focus/ESC handling and
 * the bottom utility bar are layered in as the overlay primitives land.
 */
export function MobileMenu({ children, label = "Menu" }: MobileMenuProps): JSX.Element {
	const open = useSignal(false);
	return (
		<>
			<button
				type="button"
				class="ui-mobile-menu__trigger"
				aria-label={label}
				aria-expanded={open.value ? "true" : "false"}
				onClick={() => (open.value = true)}
			>
				<span aria-hidden="true">☰</span>
			</button>
			{open.value
				? (
					<div class="ui-mobile-menu" role="dialog" aria-modal="true" aria-label={label}>
						<button
							type="button"
							class="ui-mobile-menu__backdrop"
							aria-label="Close menu"
							onClick={() => (open.value = false)}
						/>
						<nav class="ui-mobile-menu__drawer" aria-label={label}>{children}</nav>
					</div>
				)
				: null}
		</>
	);
}
