import type { JSX, Ref } from "preact";
import "../styles/quota-ring.css";
import { Popover, ProgressRing, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { QuotaMeter } from "./QuotaMeter.tsx";
import { quotaRingView } from "../core/quota-ring.ts";
import type { StorageQuota } from "../types/file-types.ts";

/**
 * QuotaRing — a library's storage allowance as a ring, for the centre of a file surface's footer rig.
 *
 * The ring and its short figure are one quiet button. Hovering or focusing it shows what is used of
 * what (a portal `Tooltip`); pressing it opens the full {@link QuotaMeter} — figures, band, what is
 * left, the tier and the enforcement note — in a `Popover`, so nothing the meter said is lost by
 * moving it out of the body. Unlimited draws no arc (a share of an unbounded whole is not a quantity):
 * the storage glyph and the stored figure stand in for the ring.
 *
 * `null` renders nothing at all — a scope that consumes no allowance (a project, a conversation, a
 * mount) has nothing to report, and the rig keeps its centre empty rather than drawing a zero.
 *
 * Dumb: every figure is the server's, and the words come from the pure `quotaRingView`.
 */
export interface QuotaRingProps {
	quota: StorageQuota | null;
	/** Whose allowance it is — the popover's title ("Atelier Nova's storage"). */
	ownerLabel?: string;
	class?: string;
}

export function QuotaRing(
	{ quota, ownerLabel, class: className }: QuotaRingProps,
): JSX.Element | null {
	if (!quota) return null;
	const view = quotaRingView(quota);
	const title = ownerLabel ? `${ownerLabel}'s storage` : "Storage";

	return (
		<Tooltip content={view.summary} placement="top">
			<Popover
				placement="top"
				label={title}
				trigger={(api) => (
					<button
						type="button"
						class={`fh-qring ui-hit${className ? ` ${className}` : ""}`}
						ref={api.ref as Ref<HTMLButtonElement>}
						data-tone={view.tone}
						aria-label={view.label}
						aria-haspopup="dialog"
						aria-expanded={api.expanded}
						aria-controls={api.expanded ? api.panelId : undefined}
						onClick={api.toggle}
					>
						{view.unlimited
							? (
								<span class="fh-qring__glyph" aria-hidden="true">
									<Icon name="box" size="sm" />
								</span>
							)
							: (
								<ProgressRing
									value={view.pct}
									size={20}
									strokeWidth={3}
									severity={view.tone}
									aria-label="Storage used"
								/>
							)}
						<span class="fh-qring__figure" aria-hidden="true">{view.figure}</span>
					</button>
				)}
			>
				<div class="fh-qring__panel">
					<p class="fh-qring__title">{title}</p>
					<QuotaMeter quota={quota} />
				</div>
			</Popover>
		</Tooltip>
	);
}
