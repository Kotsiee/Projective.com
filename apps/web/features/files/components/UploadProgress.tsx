import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	openUploadDrawer,
	retireUploadReport,
	uploadDrawerOpen,
	uploadReport,
} from "../core/upload-drawer-state.ts";
import {
	type ProgressSample,
	pruneSamples,
	remainingLabel,
	secondsRemaining,
	uploadLabel,
	type UploadTone,
} from "../core/upload-progress.ts";

/**
 * UploadProgress — the footer rig's report on a batch of uploads, in the rig's centre track.
 *
 * Nothing slides over the canvas when a file is dropped: this widget says how the batch is going, and
 * pressing it opens the {@link UploadDrawer} breakdown (per-file rows, Stop, Retry, duplicate prompts).
 *
 * ## What it shows, and how long for
 *
 * - **Working**: "Uploading 3 of 10…", a determinate bar weighted by bytes, the time remaining once
 *   the recent rate is worth quoting, and a slow pulse over the fill while bytes are moving.
 * - **Waiting on an answer**: a duplicate prompt the batch cannot finish without. Stays until it is
 *   answered in the drawer.
 * - **Done**: "10 files uploaded" with a check, for {@link SUCCESS_HOLD_MS}, then it fades out.
 * - **Done, with a note**: a finished file carries something to read (an SVG that was sanitised, a
 *   replacement that kept both copies). The drawer is the only place that note is written, so this
 *   stays until it is pressed or dismissed.
 * - **Failed**: "2 uploads failed". Stays until it is pressed or dismissed.
 *
 * A REPORT is every task queued since the widget last went quiet ({@link uploadReport}). Closing one
 * (the fade, a press on a settled report, the dismiss) retires the ids it covered, so the next drop
 * counts from one. Retired rows stay in the drawer's list: retiring ends the report, not the record.
 *
 * The report and the drawer flag live in `upload-drawer-state`, the module the drawer and the rig
 * share, because a signal does not survive an island boundary as the same instance.
 */

// #region Constants
/** How long a plain success stays before it fades (the brief's 3 to 5 seconds). */
export const SUCCESS_HOLD_MS = 4000;

/** The fade's length; `--dur-slow` plus a frame. Reduced motion zeroes the token, not this wait. */
const FADE_MS = 400;

const MARK: Record<UploadTone, IconName> = {
	idle: "upload",
	active: "upload",
	attention: "help",
	success: "success",
	noted: "info",
	failed: "warning",
};

/** Tones that wait for the person: pressing them or dismissing them closes the report. */
const STICKY: ReadonlySet<UploadTone> = new Set(["noted", "failed"]);
// #endregion

export function UploadProgress(): JSX.Element | null {
	/** The success fade is running. */
	const leaving = useSignal(false);
	const samples = useRef<ProgressSample[]>([]);
	const remaining = useSignal<number | null>(null);
	const report = uploadReport;

	/** Close the report, and the widget goes quiet. */
	function retire(): void {
		leaving.value = false;
		samples.current = [];
		remaining.value = null;
		retireUploadReport();
	}

	// The rate behind "~45s remaining", sampled whenever a progress event moves the batch.
	useSignalEffect(() => {
		const now = report.value;
		if (now.tone !== "active" && now.tone !== "attention") {
			samples.current = [];
			remaining.value = null;
			return;
		}
		const at = performance.now();
		samples.current = [...pruneSamples(samples.current, at), { at, bytes: now.bytesDone }];
		remaining.value = secondsRemaining(samples.current, now.bytesTotal - now.bytesDone);
	});

	// A plain success holds, fades, then retires. New work arriving inside the hold cancels it.
	useSignalEffect(() => {
		if (report.value.tone !== "success") {
			leaving.value = false;
			return;
		}
		const fade = setTimeout(() => (leaving.value = true), SUCCESS_HOLD_MS);
		const done = setTimeout(retire, SUCCESS_HOLD_MS + FADE_MS);
		return () => {
			clearTimeout(fade);
			clearTimeout(done);
		};
	});

	const now = report.value;
	const label = uploadLabel(now);

	/*
	 * Announced on a change of state, never per percent: a live region that speaks every progress event
	 * drowns everything else on the page. It is mounted while the widget is idle too, because a region
	 * inserted together with its text is not announced at all.
	 */
	const status = (
		<span class="ui-visually-hidden" role="status">
			{now.tone === "active" || now.tone === "attention"
				? `Uploading ${now.total} ${now.total === 1 ? "file" : "files"}`
				: label}
		</span>
	);
	if (now.tone === "idle") return status;

	const working = now.tone === "active" || now.tone === "attention";
	const pct = Math.round(now.fraction * 100);
	const meta = working
		? [
			remaining.value !== null ? remainingLabel(remaining.value) : null,
			now.failed > 0 ? `${now.failed} failed` : null,
		].filter(Boolean).join(" · ")
		: "";

	function open(): void {
		openUploadDrawer();
		// A settled report has been seen once its breakdown is open; a working one keeps reporting.
		if (!working) retire();
	}

	return (
		<div
			class="fh-upw"
			data-tone={now.tone}
			data-leaving={leaving.value || undefined}
		>
			<Tooltip content={`${label} · Show details`} placement="top">
				<button
					type="button"
					class="fh-upw__open"
					aria-haspopup="dialog"
					aria-expanded={uploadDrawerOpen.value ? "true" : "false"}
					onClick={open}
				>
					<span class="fh-upw__mark" aria-hidden="true">
						<Icon name={MARK[now.tone]} size="xs" />
					</span>
					<span class="fh-upw__body">
						<span class="fh-upw__line">
							<span class="fh-upw__label">{label}</span>
							{meta ? <span class="fh-upw__meta">{meta}</span> : null}
						</span>
						{working
							? (
								<ProgressBar
									class="fh-upw__bar"
									value={pct}
									severity={now.tone === "attention" ? "warning" : "primary"}
									aria-label={`Upload progress, ${pct}%`}
								/>
							)
							: null}
					</span>
					<span class="ui-visually-hidden">, show details</span>
				</button>
			</Tooltip>
			{STICKY.has(now.tone)
				? (
					<Tooltip content="Dismiss" placement="top">
						<button
							type="button"
							class="fh-upw__dismiss"
							aria-label={`Dismiss: ${label}`}
							onClick={retire}
						>
							<Icon name="close" size="xs" />
						</button>
					</Tooltip>
				)
				: null}
			{status}
		</div>
	);
}
