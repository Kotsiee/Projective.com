import type { ComponentChildren, JSX } from "preact";
import "../styles/mobile-menu.css";
import { useSignal } from "@preact/signals";
import { Icon } from "../../icons/mod.ts";

export interface MobileMenuProps {
	/** Drawer contents — typically the same NavItems as the desktop sidebar. */
	children?: ComponentChildren;
	label?: string;
}

/**
 * MobileMenu — a hamburger trigger that opens a glass pull-out drawer (DESIGN_SYSTEM.md Part D.3).
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper.
 *
 * The overlay (and its `children` slot) is ALWAYS rendered and toggled via `data-open` so open/close
 * is an in-place attribute patch — robust across Fresh island hydration (conditionally *adding* a
 * node at a fragment root, or a slot only SSR-rendered while open, does not mount reliably). Focus/ESC
 * handling and the bottom utility bar are layered in as the overlay primitives land.
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
				onClick={() => (open.value = !open.value)}
			>
				<Icon name="menu" />
			</button>
			<div
				class="ui-mobile-menu"
				data-open={open.value ? "true" : "false"}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				aria-hidden={open.value ? undefined : "true"}
			>
				<button
					type="button"
					class="ui-mobile-menu__backdrop"
					aria-label="Close menu"
					tabIndex={open.value ? 0 : -1}
					onClick={() => (open.value = false)}
				/>
				<nav class="ui-mobile-menu__drawer" aria-label={label}>{children}</nav>
			</div>
		</>
	);
}
