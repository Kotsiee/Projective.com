import { signal } from "@preact/signals";
import type { IconName } from "@ui/icons/core/paths.tsx";
import type { MenuItem } from "@ui/types/mod.ts";

/** One of the transaction rig's controls, as another surface may offer it. */
export interface MirroredCta {
	label: string;
	icon: IconName;
	/** Runs the rig's own handler (its feedback cycle included). Absent when `href` navigates. */
	run?: () => void;
	href?: string;
	disabled?: boolean;
	/** The fill the rig gives it: the tier-1 accent (a money verb) or the brand primary (Apply). */
	tone?: "accent" | "primary";
}

/**
 * The transaction rig's controls as the rig itself last rendered them. The lane (or, below the frame
 * breakpoint, the buy bar) publishes; the condensed header band and the lane card's right-click menu
 * read. Mirrors carry the rig's own handlers, so no surface grows a second implementation of a
 * purchase — and the rig stays the one place the transaction lives (root CLAUDE.md §3 item 10).
 */
export interface CtaMirror {
	primary: MirroredCta | null;
	secondary: MirroredCta | null;
	/** The pre-purchase contact control: Message client (a link) or the seller's Contact menu. */
	contact: MirroredCta | null;
}

export const ctaMirror = signal<CtaMirror | null>(null);

/** Publish what the rig shows now. Called after every render of the rig. */
export function publishCtaMirror(next: CtaMirror): void {
	ctaMirror.value = next;
}

/**
 * The rig's controls as menu rows, in the rig's order — the primary, the basket line, then contact.
 * A link control is a `url` row (so a middle-click opens a tab); a refused one stays, disabled.
 */
export function mirrorMenuRows(mirror: CtaMirror | null): MenuItem[] {
	if (!mirror) return [];
	const rows: MenuItem[] = [];
	const add = (key: string, cta: MirroredCta | null) => {
		if (!cta) return;
		rows.push({
			key,
			label: cta.label,
			icon: cta.icon,
			...(cta.href ? { url: cta.href } : { command: () => cta.run?.() }),
			disabled: cta.disabled || (!cta.href && !cta.run),
		});
	};
	add("cta-primary", mirror.primary);
	add("cta-secondary", mirror.secondary);
	add("cta-contact", mirror.contact);
	return rows;
}

/**
 * Whether the reader has scrolled past the page frame — the point the conversion lane stops being
 * pinned and leaves the screen. The header band offers the transaction only from then on, so it is
 * never on screen twice.
 */
export const pastFrame = signal(false);
