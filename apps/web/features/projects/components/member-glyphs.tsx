import type { JSX } from "preact";
import { IconShell } from "@projective/ui/icons";

/**
 * Members roster glyphs — the few stroke icons the roster needs that `@projective/ui/icons` does not
 * carry (assign/unassign · role · contributor · the authority crown). Function components rather than
 * shared VNode constants: a roster renders them once per row, and a fresh node per call site keeps
 * Preact from reusing one element across positions. Common glyphs (message · kebab · check · close ·
 * external link · grid · list) come from the package `Icon` registry.
 */

// #region Base
interface GlyphProps {
	size?: number;
}

function Svg(props: JSX.SVGAttributes<SVGSVGElement> & GlyphProps): JSX.Element {
	const { size, ...rest } = props;
	return <IconShell size={size} {...rest} />;
}
// #endregion

/** A person with a plus — assign to the current stage/channel. */
export function UserPlusIcon({ size }: GlyphProps): JSX.Element {
	return (
		<Svg size={size}>
			<circle cx="9" cy="8" r="3.2" />
			<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
			<path d="M18 8v6M15 11h6" />
		</Svg>
	);
}

/** A badge check — an assigned contributor. */
export function ContributorIcon({ size }: GlyphProps): JSX.Element {
	return (
		<Svg size={size}>
			<path d="M12 3l2.3 1.7 2.8-.2.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.2L12 21l-2.3-1.7-2.8.2-.9-2.7L3.7 15l.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.2z" />
			<path d="m9 12 2 2 4-4" />
		</Svg>
	);
}

/** A crown — the engagement's authority tier (owner / client), the roster's one distinct accent. */
export function CrownIcon({ size }: GlyphProps): JSX.Element {
	return (
		<Svg size={size}>
			<path d="M4 8l4 4 4-7 4 7 4-4-1.6 10H5.6z" />
			<path d="M6 21h12" />
		</Svg>
	);
}
