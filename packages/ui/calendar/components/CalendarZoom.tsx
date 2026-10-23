/**
 * @projective/ui/calendar — the calendar's view control: one zoom slider across every view, and a
 * toggle between the calendar and the timeline.
 *
 * The slider is the platform's {@link ZoomSlider}, cut into one zone per stop — Month · Week · Day on
 * the calendar, Year · Quarter · Month · Week · Day on the timeline — with a transition mark at every
 * boundary, so a drag across a mark is the same view change Ctrl+wheel makes there. The stop the
 * handle is in is printed beside it and spoken as the slider's value.
 */
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useLayoutEffect } from "preact/hooks";
import "../styles/zoom.css";
import { cx } from "../../core/cx.ts";
import { Tooltip } from "../../feedback/mod.ts";
import { Button } from "../../fields/components/Button.tsx";
import { ZoomSlider } from "../../fields/islands/ZoomSlider.tsx";
import type { FieldSize } from "../../fields/types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import {
	type CalendarZoomMode,
	stopAt,
	stopsFor,
	ZOOM_STOP_LABEL,
	zoomMarks,
	zoomStep,
} from "../core/zoom.ts";

/** Props for {@link CalendarZoom}. */
export interface CalendarZoomProps {
	/** Which axis the slider drives. */
	mode: CalendarZoomMode;
	/** The position along that axis: 0 is its widest view, 1 its deepest. */
	value: number;
	onValueChange: (value: number) => void;
	/** Switch between the calendar and the timeline. Absent, no toggle is drawn. */
	onModeChange?: (mode: CalendarZoomMode) => void;
	size?: FieldSize;
	class?: string;
}

export function CalendarZoom(props: CalendarZoomProps): JSX.Element {
	const { mode } = props;
	const slider = useSignal(props.value);
	useLayoutEffect(() => {
		if (props.value !== slider.peek()) slider.value = props.value;
	}, [props.value]);

	const timeline = mode === "timeline";
	const stop = ZOOM_STOP_LABEL[stopAt(mode, slider.value)];

	return (
		<div class={cx("cal-zoom", props.class)} data-mode={mode}>
			{props.onModeChange
				? (
					<Tooltip content="Timeline view">
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="cal-zoom__mode ui-hit"
							icon={<Icon name="timeline" size="sm" />}
							aria-label="Timeline view"
							aria-pressed={timeline ? "true" : "false"}
							onClick={() => props.onModeChange?.(timeline ? "calendar" : "timeline")}
						/>
					</Tooltip>
				)
				: null}
			<ZoomSlider
				value={slider}
				onValueChange={(v) => props.onValueChange(v)}
				min={0}
				max={1}
				step={zoomStep(mode)}
				segments={stopsFor(mode).length * 2}
				marks={zoomMarks(mode)}
				size={props.size ?? "sm"}
				aria-label={timeline ? "Timeline zoom" : "Calendar zoom"}
				formatValue={(v) => `${ZOOM_STOP_LABEL[stopAt(mode, v)]} view`}
				class="cal-zoom__slider"
			/>
			<span class="cal-zoom__stop" aria-hidden="true">{stop}</span>
		</div>
	);
}
