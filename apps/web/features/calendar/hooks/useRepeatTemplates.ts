import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { type RepeatPattern, templateRepeat } from "../core/event-recurrence.ts";
import { ScheduleService } from "../core/ScheduleService.ts";

/** One availability template a repeat can follow. */
export interface RepeatTemplate {
	id: string;
	name: string;
	draft: RepeatPattern;
}

/** The templates a repeat can follow, read once per page. */
export interface RepeatTemplates {
	/** `null` while the read is in flight. */
	templates: readonly RepeatTemplate[] | null;
	/** Live templates one rule cannot follow, so they are left out. */
	skipped: number;
	/** The service's own words when the read was refused or failed. */
	error: string | null;
}

const LOADING: RepeatTemplates = { templates: null, skipped: 0, error: null };

const state = signal<RepeatTemplates>(LOADING);
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
	const res = await ScheduleService.presets();
	inflight = null;
	if (!res.ok || !res.data) {
		state.value = {
			templates: [],
			skipped: 0,
			error: res.message ?? "Your availability templates couldn’t be loaded.",
		};
		return;
	}
	const templates: RepeatTemplate[] = [];
	let skipped = 0;
	for (const preset of res.data.presets) {
		if (preset.scope !== "library" || preset.archivedAt !== null) continue;
		const draft = templateRepeat(preset);
		if (draft) templates.push({ id: preset.id, name: preset.name, draft });
		else skipped++;
	}
	state.value = { templates, skipped, error: null };
}

/**
 * The Availability tab's templates as repeat patterns, read from `GET /api/scheduling/presets` the
 * first time a field asks and shared by every field after it. A failed read is retried by the next
 * field that mounts.
 */
export function useRepeatTemplates(enabled = true): RepeatTemplates {
	useEffect(() => {
		if (!enabled || inflight || (state.peek().templates !== null && !state.peek().error)) return;
		state.value = LOADING;
		inflight = load();
	}, [enabled]);
	return enabled ? state.value : LOADING;
}
