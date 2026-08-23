/**
 * @projective/ui/calendar — icon glyphs. Stroked, `currentColor`, token-agnostic (the consumer sets
 * `color`). Each is a plain function component (a fresh VNode per render — never a shared constant —
 * to respect the Preact VNode-reuse guard). Icon-first navigation (§B.6): controls pair these with a
 * `Tooltip` + `aria-label`, never text.
 */
import type { JSX } from "preact";
import { IconShell, type IconShellProps } from "../../icons/mod.ts";

interface IconProps {
	size?: number;
	class?: string;
}

/**
 * The shared root attributes for this sub-package's glyphs, delegated to the one icon contract
 * (§B.7) so the calendar reads as part of the same set as the rest of the product rather than a
 * lookalike. `size` travels as a pixel number because these glyphs are icon-only controls.
 */
function base(size: number, cls?: string): IconShellProps {
	return { size, class: cls };
}

export function ChevronLeftIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<path d="M15 6l-6 6 6 6" />
		</IconShell>
	);
}

export function ChevronRightIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<path d="M9 6l6 6-6 6" />
		</IconShell>
	);
}

/** Day view — a single tall column. */
export function DayViewIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<rect x="8" y="4" width="8" height="16" rx="1.5" />
			<path d="M8 9h8" />
		</IconShell>
	);
}

/** Week view — seven columns. */
export function WeekViewIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<rect x="3.5" y="5" width="17" height="14" rx="1.5" />
			<path d="M8.3 5v14M12 5v14M15.7 5v14M3.5 9.5h17" />
		</IconShell>
	);
}

/** Month view — a grid of cells. */
export function MonthViewIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<rect x="3.5" y="4.5" width="17" height="16" rx="2" />
			<path d="M3.5 9h17M9 9v11.5M15 9v11.5M3.5 14.5h17" />
		</IconShell>
	);
}

/** Return-to-today target. */
export function TodayIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<circle cx="12" cy="12" r="7.5" />
			<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
			<path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" />
		</IconShell>
	);
}

/**
 * Four corner brackets pointing outward — "make this bigger".
 *
 * The same geometry as the `expand` entry in `@projective/ui/icons`, restated here rather than
 * imported for the reason every glyph in this file is: this package's icons are sized and weighted
 * for an 11px mark inside a 20px card, and the shared registry is calibrated for chrome. The two are
 * the same drawing at two scales, not one drawing shared.
 */
export function ExpandIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
		</IconShell>
	);
}

export function PlusIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<path d="M12 5v14M5 12h14" />
		</IconShell>
	);
}

export function SearchIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<circle cx="11" cy="11" r="6.5" />
			<path d="M20 20l-3.6-3.6" />
		</IconShell>
	);
}

export function FilterIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<path d="M4 6h16M7 12h10M10 18h4" />
		</IconShell>
	);
}

export function ClockIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<circle cx="12" cy="12" r="7.75" />
			<path d="M12 8v4.2l2.8 1.7" />
		</IconShell>
	);
}

export function GlobeIcon({ size = 18, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<circle cx="12" cy="12" r="8" />
			<path d="M4 12h16M12 4c2.4 2.2 3.6 5 3.6 8s-1.2 5.8-3.6 8c-2.4-2.2-3.6-5-3.6-8s1.2-5.8 3.6-8Z" />
		</IconShell>
	);
}

/** People / attendees counter glyph. */
export function AttendeesIcon({ size = 16, class: cls }: IconProps): JSX.Element {
	return (
		<IconShell {...base(size, cls)}>
			<circle cx="9" cy="8" r="3.2" />
			<path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3.2 3.2 0 0 1 0 6M20.5 19a5.5 5.5 0 0 0-4-5.3" />
		</IconShell>
	);
}
