import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useMigratingHeader } from "@features/shell/hooks/useMigratingHeader.ts";

/**
 * EntityHeroProbe — the anchor of the entity view's scroll-migrated sticky header (§D.7.6).
 *
 * `EntityViewPage` is a SERVER component and the hero has no island of its own, so the probe is a
 * zero-UI island rendered as the hero's last child: a zero-height sentinel whose bottom edge IS the
 * hero's bottom edge. The shared `useMigratingHeader` hook does the rest — the same rule, the same
 * hysteresis and the same back-control hand-over the profile's hero runs on its rig — so the two
 * surfaces cannot condense on different terms.
 */
export default function EntityHeroProbe(): JSX.Element {
	const sentinel = useRef<HTMLDivElement>(null);
	useMigratingHeader(sentinel);
	return <div ref={sentinel} class="evp-hero__probe" aria-hidden="true" />;
}
