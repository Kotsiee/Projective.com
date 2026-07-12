import type { JSX } from "preact";
import { Divider, type DividerProps } from "./Divider.tsx";

/**
 * Separator — the semantic variant of {@link Divider} (`role="separator"`, announced to assistive
 * tech). Use when the line marks a genuine content boundary rather than pure decoration.
 */
export function Separator(props: Omit<DividerProps, "decorative">): JSX.Element {
	return <Divider decorative={false} {...props} />;
}
