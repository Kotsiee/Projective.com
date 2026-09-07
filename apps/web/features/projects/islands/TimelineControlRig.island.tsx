import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/board-rig.css";
import "../styles/timeline.css";
import { Tooltip } from "@projective/ui/feedback";
import { ZoomSlider } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { PX_PER_DAY_MAX, PX_PER_DAY_MIN } from "@projective/ui/gantt";
import {
	requestTimelineCreateStage,
	requestTimelineCreateTicket,
	requestTimelineFit,
	requestTimelineToday,
	restoreTimelineZoom,
	setTimelineZoom,
	timelineCaps,
	timelineTier,
	timelineZoom,
} from "../core/timeline-state.ts";
import { PlusIcon, StagesToggleIcon } from "../components/board-glyphs.tsx";

/**
 * TimelineControlRig — the Gantt's action rig, mounted in the middle-nav FOOTER band via
 * {@link timelineFooterFor}. Icon-first (§B.6): Today · Fit · the time-scale zoom slider (with the
 * unit the scale is currently divided into) · the primary client actions (Create Ticket · Create
 * Stage). It is a DUMB island — it drives the shared timeline signals ({@link timelineZoom}, the
 * engine command channel, the create intents) and reads the body's published capabilities
 * ({@link timelineCaps}); the body reacts. No data access.
 *
 * It composes the SAME `.brd-rig` control set the board's rig uses, so the two footers read as one
 * vocabulary rather than two lookalikes; only the zoom slider and the tier word are its own.
 */

/*
 * The slider runs the zoom on a LOG scale, because px-per-day spans three orders of magnitude and a
 * linear slider would spend nine tenths of its travel on the last, least useful decade. The two ends
 * are the engine's own clamp, so the slider can never ask for a scale the engine refuses.
 */
const LOG_MIN = Math.log(PX_PER_DAY_MIN);
const LOG_MAX = Math.log(PX_PER_DAY_MAX);
const fracOf = (pxPerDay: number): number =>
	Math.max(0, Math.min(1, (Math.log(pxPerDay) - LOG_MIN) / (LOG_MAX - LOG_MIN)));
const pxPerDayOf = (frac: number): number => Math.exp(LOG_MIN + frac * (LOG_MAX - LOG_MIN));

export default function TimelineControlRig(): JSX.Element {
	useEffect(() => restoreTimelineZoom(), []);

	// The slider's own position, kept in step with the shared zoom in BOTH directions: a wheel zoom
	// on the canvas moves the handle, and the handle moves the canvas.
	const slider = useSignal(fracOf(timelineZoom.peek()));
	useSignalEffect(() => {
		const frac = fracOf(timelineZoom.value);
		if (Math.abs(frac - slider.peek()) > 1e-4) slider.value = frac;
	});

	const caps = timelineCaps.value;
	const tier = timelineTier.value;

	return (
		<div class="brd-rig tl-rig">
			<div class="brd-rig__group" role="group" aria-label="Timeline navigation">
				<Tooltip content="Go to today">
					<button
						type="button"
						class="brd-rig__icon"
						aria-label="Go to today"
						onClick={requestTimelineToday}
					>
						<Icon name="calendar" size="sm" />
					</button>
				</Tooltip>
				<Tooltip content="Fit everything in view">
					<button
						type="button"
						class="brd-rig__icon"
						aria-label="Fit everything in view"
						disabled={!caps.hasRange}
						onClick={requestTimelineFit}
					>
						<Icon name="expand" size="sm" />
					</button>
				</Tooltip>
			</div>

			<div class="tl-rig__zoom">
				<ZoomSlider
					value={slider}
					onValueChange={(v) => setTimelineZoom(pxPerDayOf(v))}
					min={0}
					max={1}
					step={0.04}
					segments={6}
					aria-label="Time scale"
					formatValue={(v) => `${Math.round(pxPerDayOf(v))} pixels per day`}
				/>
			</div>
			{tier ? <span class="tl-rig__tier" aria-live="polite">{tier}</span> : null}

			<span class="brd-rig__spacer" />

			{
				/*
				 * What is NOT on the axis, said out loud. An undated ticket is drawn nowhere, and a
				 * timeline that silently omitted a third of the work would be read as the whole plan.
				 */
			}
			{caps.undatedCount > 0
				? (
					<p class="brd-rig__note">
						{caps.undatedCount} undated {caps.undatedCount === 1 ? "ticket" : "tickets"} not drawn
					</p>
				)
				: null}

			{caps.isClient && !caps.hasTickets
				? <p class="brd-rig__note">Sessions are booked, not ticketed.</p>
				: null}

			{caps.isClient && caps.hasTickets
				? (
					<div class="brd-rig__actions">
						<button type="button" class="brd-rig__action" onClick={requestTimelineCreateTicket}>
							<PlusIcon size={16} />
							<span>Ticket</span>
						</button>
						{caps.isProjectScope
							? (
								<button
									type="button"
									class="brd-rig__action"
									onClick={requestTimelineCreateStage}
								>
									<StagesToggleIcon size={16} />
									<span>Stage</span>
								</button>
							)
							: null}
					</div>
				)
				: null}
		</div>
	);
}
