import { type Signal, useSignal } from "@preact/signals";
import type { CalendarEvent, Routine } from "@projective/types/scheduling";
import { type CalendarImportPreview, readCalendarFile } from "../core/calendar-import.ts";
import {
	buildImportPlan,
	IMPORT_REVIEW_THRESHOLD,
	importBatches,
	type ImportPlan,
	tallyPlan,
} from "../core/import-plan.ts";
import type { CalendarComposer } from "./useCalendarComposer.ts";

/** One file on its way in: what was read, how it will be laid down, and how far the write has got. */
export interface ImportSession {
	preview: CalendarImportPreview;
	plan: ImportPlan;
	/** While the batches are being written. */
	busy: boolean;
	/** Entries saved so far, of `total`. */
	done: number;
	total: number;
	/** Why the write stopped, in the server's words. */
	error: string | null;
}

/** Options for {@link useCalendarImport}. */
export interface CalendarImportOptions {
	composer: CalendarComposer;
	/** The display zone: the file's floating times and all-day dates are read in it. */
	timezone: () => string;
	/** The entries already on the calendar, which an import never writes twice. */
	existing: () => readonly CalendarEvent[];
	/** The routines an import created, to publish. */
	onRoutines: (made: Routine[]) => void;
	/** Told a sentence to show: a refusal, or how an import ended. */
	onNotice: (severity: "success" | "warning", message: string) => void;
}

/** The body's import flow. */
export interface CalendarImport {
	/** The file in review, or being written; `null` when none is. */
	session: Signal<ImportSession | null>;
	/** Whether the review modal shows (a `Dialog` needs the signal itself). */
	reviewing: Signal<boolean>;
	/**
	 * Plan a read file. A small one is written at once; one of more than
	 * {@link IMPORT_REVIEW_THRESHOLD} entries opens the review first.
	 */
	start(preview: CalendarImportPreview): void;
	/** Check and read a dropped file, then {@link start} it; a refusal is said through `onNotice`. */
	readAndStart(file: File): Promise<void>;
	/** Replace the plan with the reader's change to it. */
	setPlan(plan: ImportPlan): void;
	/** Write the plan in review. */
	commit(): Promise<void>;
	/** Close the review. A write in flight carries on and reports when it ends. */
	close(): void;
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * useCalendarImport — read, plan, review and write a calendar file as the host's own entries
 * (Decision #442). The plan and its rules are `import-plan.ts`'s; the writes are the composer's
 * ({@link CalendarComposer.importBatches}), so an imported entry lands on the grid, the lane and the
 * panel exactly as one composed here does.
 */
export function useCalendarImport(opts: CalendarImportOptions): CalendarImport {
	const session = useSignal<ImportSession | null>(null);
	const reviewing = useSignal(false);

	async function write(current: ImportSession): Promise<void> {
		const tz = opts.timezone();
		const batches = importBatches(current.plan, tz);
		const tally = tallyPlan(current.plan);
		if (batches.length === 0) {
			opts.onNotice("warning", "Nothing to import: every event is already on your calendar.");
			session.value = null;
			reviewing.value = false;
			return;
		}
		session.value = { ...current, busy: true, done: 0, total: tally.entries, error: null };
		const outcome = await opts.composer.importBatches(batches, (done, total) => {
			const now = session.peek();
			if (now) session.value = { ...now, done, total };
		});
		if (outcome.routines.length > 0) opts.onRoutines(outcome.routines);
		const name = current.preview.calendarName;
		if (outcome.message) {
			const saved = outcome.created > 0
				? `Imported ${outcome.created} of ${
					plural(outcome.total, "event", "events")
				} from ${name}. `
				: "";
			const now = session.peek();
			if (now && reviewing.peek()) {
				session.value = { ...now, busy: false, error: `${saved}${outcome.message}` };
			} else {
				session.value = null;
				opts.onNotice("warning", `${saved}${outcome.message}`);
			}
			return;
		}
		session.value = null;
		reviewing.value = false;
		const left = tally.onCalendar > 0
			? ` ${plural(tally.onCalendar, "event was", "events were")} already on your calendar.`
			: "";
		opts.onNotice(
			"success",
			`Imported ${plural(outcome.created, "event", "events")} from ${name}.${left}`,
		);
	}

	function start(preview: CalendarImportPreview): void {
		if (session.peek()?.busy) {
			opts.onNotice("warning", "An import is still being saved. Try again when it finishes.");
			return;
		}
		const plan = buildImportPlan(preview, opts.existing(), opts.timezone());
		const next: ImportSession = { preview, plan, busy: false, done: 0, total: 0, error: null };
		session.value = next;
		if (preview.items.length > IMPORT_REVIEW_THRESHOLD) {
			reviewing.value = true;
			return;
		}
		void write(next);
	}

	return {
		session,
		reviewing,
		start,
		async readAndStart(file) {
			const read = await readCalendarFile(file, { timezone: opts.timezone(), now: Date.now() });
			if (!read.ok) {
				opts.onNotice("warning", read.message);
				return;
			}
			start(read.preview);
		},
		setPlan(plan) {
			const current = session.peek();
			if (current && !current.busy) session.value = { ...current, plan, error: null };
		},
		async commit() {
			const current = session.peek();
			if (current && !current.busy) await write(current);
		},
		close() {
			reviewing.value = false;
			if (!session.peek()?.busy) session.value = null;
		},
	};
}
