import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/submission-rig.css";
import { ZoomSlider } from "@projective/ui/fields";
import {
	restoreZoom,
	setZoom,
	viewMode,
	zoom,
	ZOOM_CENTER,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_SEGMENTS,
	ZOOM_STEP,
} from "../core/view-state.ts";
import { canReview, requestReview, reviewLabel } from "../core/submissions-review.ts";
import { GridIcon, ListIcon } from "../components/file-glyphs.tsx";
import { ReviewGlyph } from "../components/submission-glyphs.tsx";

/**
 * SubmissionViewControlRig — the Submissions explorer's footer band, mounted in the middle-nav FOOTER
 * slot via {@link submissionsFooterFor}. It is the File Explorer's View Control Rig on the LEFT (the
 * mode glyph · a segmented zoom track with a centred transition marker · ± buttons — the reusable
 * {@link ZoomSlider}, writing the shared {@link zoom}) AND — pinned to the far RIGHT (Part 4) — the
 * **Review Submission** trigger, shown only when the explorer publishes a reviewable unit in view
 * ({@link canReview}). Clicking it opens the review workspace modal (owned by the explorer island) via
 * the shared review signals. Dumb island: no data access.
 */
export default function SubmissionViewControlRig(): JSX.Element {
	useEffect(() => restoreZoom(), []);

	return (
		<div class="subm-rig">
			<div class="subm-rig__zoom">
				<span class="subm-rig__mode" data-mode={viewMode.value} aria-hidden="true">
					{viewMode.value === "grid" ? <GridIcon size={16} /> : <ListIcon size={16} />}
				</span>
				<ZoomSlider
					value={zoom}
					onValueChange={setZoom}
					min={ZOOM_MIN}
					max={ZOOM_MAX}
					step={ZOOM_STEP}
					segments={ZOOM_SEGMENTS}
					center={ZOOM_CENTER}
					size="sm"
					aria-label="Submission view zoom"
				/>
			</div>

			<span class="subm-rig__spacer" />

			{canReview.value
				? (
					<button
						type="button"
						class="subm-rig__review"
						onClick={requestReview}
						aria-label={reviewLabel.value
							? `Review submission: ${reviewLabel.value}`
							: "Review submission"}
					>
						<span class="subm-rig__reviewicon" aria-hidden="true">
							<ReviewGlyph size={17} />
						</span>
						<span class="subm-rig__reviewlabel">Review Submission</span>
					</button>
				)
				: null}
		</div>
	);
}
