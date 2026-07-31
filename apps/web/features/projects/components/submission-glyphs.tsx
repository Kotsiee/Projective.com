import type { JSX } from "preact";
import type { SubmissionStatus } from "../types/projects-types.ts";
import { IconShell } from "@projective/ui/icons";

/**
 * submission-glyphs — the Submissions explorer's inline-SVG icon set (tree node kinds, review-status
 * marks, and the review-modal chrome). Every glyph is a COMPONENT returning a fresh VNode (not a shared
 * constant), so rendering the same icon across many tree rows never trips the Preact VNode-reuse hazard
 * and needs no `cloneElement` (matching `file-glyphs.tsx`). Stroke-based, `currentColor`, 24×24 viewBox.
 */

interface GlyphProps {
	size?: number;
	class?: string;
}

function svg(size: number, className: string | undefined, children: JSX.Element): JSX.Element {
	return <IconShell size={size} class={className}>{children}</IconShell>;
}

// #region Tree node-kind glyphs
/** Stage — stacked layers (project-scope root nodes). */
export function StageGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 3l8 4.5-8 4.5-8-4.5z" />
			<path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
		</>,
	);
}
/** Submission unit — an outbox tray with an up arrow (matches the Submissions tab glyph). */
export function UnitGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
			<path d="M12 16V4M8 8l4-4 4 4" />
		</>,
	);
}
/** Directory — a folder. */
export function FolderGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
	);
}
// #endregion

// #region Review-status glyphs
/** Pending review — a clock/hourglass. */
export function PendingGlyph({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 8v4l2.5 2" />
		</>,
	);
}
/** Revision requested — a return/rotate arrow. */
export function RevisionGlyph({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 8h9a5 5 0 0 1 0 10H8" />
			<path d="M7 5L4 8l3 3" />
		</>,
	);
}
/** Accepted — a check inside a circle. */
export function AcceptedGlyph({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M8.5 12l2.5 2.5 4.5-5" />
		</>,
	);
}
/** Draft — a small dashed circle. */
export function DraftGlyph({ size = 16, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3" />);
}

/** The status glyph for a submission review status — a component (fresh VNode per render). */
export function SubmissionStatusIcon(
	{ status, size = 16, class: c }: GlyphProps & { status: SubmissionStatus },
): JSX.Element {
	switch (status) {
		case "pending_review":
			return <PendingGlyph size={size} class={c} />;
		case "revision_requested":
			return <RevisionGlyph size={size} class={c} />;
		case "accepted":
			return <AcceptedGlyph size={size} class={c} />;
		default:
			return <DraftGlyph size={size} class={c} />;
	}
}
// #endregion

// #region Review-modal chrome
/** Open in a new tab — a box with an out arrow. */
export function ExternalGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M14 5h5v5" />
			<path d="M19 5l-8 8" />
			<path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
		</>,
	);
}
/** Expand to fullscreen — outward corner arrows. */
export function ExpandGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
		</>,
	);
}
/** Collapse from fullscreen — inward corner arrows. */
export function CollapseGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
		</>,
	);
}
/** Review action — a clipboard with a check (the footer's Review Submission trigger). */
export function ReviewGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<rect x="5" y="4" width="14" height="17" rx="2" />
			<path d="M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1z" />
			<path d="M8.5 13l2 2 4-4.5" />
		</>,
	);
}
/** A speech bubble for the notes tab + note counts. */
export function NoteGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2z" />);
}
/** Stage details tab — layers (small). */
export function StageTabGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return <StageGlyph size={size} class={c} />;
}
/** Ticket details tab — a ticket. */
export function TicketGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
			<path d="M14 6v12" stroke-dasharray="2 2" />
		</>,
	);
}
// #endregion

// #region Workflow-action glyphs (crumb-bar actions + footer Tasks toggle)
/** Plus — Create New Submission. */
export function PlusGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(size, c, <path d="M12 5v14M5 12h14" />);
}
/** Upload — the up-arrow-into-tray (Upload Files). */
export function UploadGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M12 16V4M8 8l4-4 4 4" />
			<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
		</>,
	);
}
/** Trash — Delete Submission. */
export function TrashGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
			<path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
			<path d="M10 11v6M14 11v6" />
		</>,
	);
}
/** Send — a paper plane (Submit for Review / Confirm & Submit). */
export function SendGlyph({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M21 4L3 11l6 2.5L21 4z" />
			<path d="M21 4l-9 16-2.5-6.5" />
		</>,
	);
}
/** Tasks panel — a checklist (the footer Tasks toggle). */
export function TasksPanelIcon({ size = 18, class: c }: GlyphProps): JSX.Element {
	return svg(
		size,
		c,
		<>
			<path d="M4 6.5l1.5 1.5L8 5" />
			<path d="M4 13.5L5.5 15 8 12" />
			<path d="M11 7h9M11 13h9M11 19h6" />
		</>,
	);
}
// #endregion
