import type { ComponentChildren, JSX } from "preact";
import "../styles/mobile-menu.css";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";

export interface MobileMenuProps {
	/** Drawer contents — typically the same NavItems as the desktop sidebar. */
	children?: ComponentChildren;
	label?: string;
}

/**
 * MobileMenu — a hamburger trigger that opens a pull-out drawer (DESIGN_SYSTEM.md Part D.3).
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper.
 *
 * The overlay (and its `children` slot) is ALWAYS rendered and toggled via `data-open` so open/close
 * is an in-place attribute patch — robust across Fresh island hydration (conditionally *adding* a
 * node at a fragment root, or a slot only SSR-rendered while open, does not mount reliably). Escape
 * closes it through the shared overlay stack; the bottom utility bar is still to come. The overlay is
 * projected through {@link BodyPortal}, which renders imperatively on the client, so the attribute
 * patch above still applies inside the portal and a header ancestor can never clip or re-base it.
 */
export function MobileMenu({ children, label = "Menu" }: MobileMenuProps): JSX.Element {
	const open = useSignal(false);
	const drawerRef = useRef<HTMLElement>(null);
	const close = () => (open.value = false);
	const stack = useOverlayStack({ active: open.value, layer: "modal" });
	useDismiss({
		open: open.value,
		enabled: stack.isTop,
		onDismiss: close,
		panelRef: drawerRef,
		closeOnOutside: false,
	});
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
			<BodyPortal>
				<div
					class="ui-mobile-menu"
					style={styleVars({ "--z-portal": String(stack.zIndex) })}
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
						onClick={close}
					/>
					<nav ref={drawerRef} class="ui-mobile-menu__drawer" aria-label={label}>{children}</nav>
				</div>
			</BodyPortal>
		</>
	);
}
