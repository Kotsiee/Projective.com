import type { JSX } from "preact";
import { MobileMenu as Menu, type MobileMenuProps } from "@projective/ui/navigation";

/** Hydration wrapper for the package's mobile pull-out drawer (DESIGN_SYSTEM.md Part D.3). */
export default function MobileMenu(props: MobileMenuProps): JSX.Element {
	return <Menu {...props} />;
}
