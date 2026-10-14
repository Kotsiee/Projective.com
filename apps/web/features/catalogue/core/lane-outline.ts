import { signal } from "@preact/signals";
import type { EditSection } from "../types/catalogue-types.ts";

/**
 * lane-outline — the bridge between the item workspace (which knows its sections and which one is
 * in view) and the lane's "On this page" list on `/catalogue/[id]`. The workspace publishes; the lane
 * only reads and calls back.
 */

/** One entry of the workspace outline. */
export interface LaneOutlineSection {
	id: EditSection;
	label: string;
}

/** What the workspace publishes for the lane's outline. */
export interface LaneOutline {
	sections: readonly LaneOutlineSection[];
	/** The section in view, or `null`. */
	active: EditSection | null;
	/** Bring a section into view; without it the lane links to the section's fragment. */
	onSelect?: (id: EditSection) => void;
}

/** The element id the workspace renders a section at — the outline's fallback fragment. */
export function outlineAnchor(id: EditSection): string {
	return `cat-sec-${id}`;
}

/** The workspace outline; `null` until a workspace publishes one. */
export const laneOutline = signal<LaneOutline | null>(null);
