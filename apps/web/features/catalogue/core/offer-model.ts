import {
	type AttachmentRef,
	type CatalogueKind,
	type FormArchetype,
	formArchetypeOf,
	hasTeamRoles,
	type ListingLicence,
	type ListingOffer,
	ListingOfferSchema,
	type Milestone,
	type ServiceType,
	STAGES_MAX,
	type StartTrigger,
	type TeamRole,
} from "@projective/types/catalogue";

/**
 * offer-model — the pure rules under the Edit tab's Offer section: list editing with caps, the
 * scope checklist's keys, what an offer looks like once the empty rows are dropped, whether it can
 * be saved yet, and the labels the editors print. DOM-free, so every rule is unit-tested.
 */

// #region Lists
/** The most scope lines a One-Off lists. */
export const SCOPE_MAX = 24;

/** The most deliverables or skills one stage lists. */
export const STAGE_LIST_MAX = 12;

/** `list` with `item` appended, or `list` itself when it is already at `max`. */
export function addItem<T>(list: readonly T[], item: T, max: number): readonly T[] {
	return list.length >= max ? list : [...list, item];
}

/** `list` with `item` inserted at `index`, or `list` itself when it is already at `max`. */
export function insertItem<T>(
	list: readonly T[],
	index: number,
	item: T,
	max: number,
): readonly T[] {
	if (list.length >= max) return list;
	const at = Math.max(0, Math.min(index, list.length));
	return [...list.slice(0, at), item, ...list.slice(at)];
}

/** `list` with the item at `from` moved to `to`; out-of-range indices change nothing. */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

/** `list` with the item at `index` shallow-merged with `patch`. */
export function patchItem<T extends object>(
	list: readonly T[],
	index: number,
	patch: Partial<T>,
): readonly T[] {
	return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/** `list` with the item at `index` replaced. */
export function replaceItem<T>(list: readonly T[], index: number, item: T): readonly T[] {
	return list.map((current, i) => (i === index ? item : current));
}

/** `list` without the item at `index`. */
export function removeItem<T>(list: readonly T[], index: number): readonly T[] {
	return list.filter((_, i) => i !== index);
}
// #endregion

// #region Checklist keys
/** What a key pressed in a checklist row does: the next lines and the row to focus. */
export interface ChecklistStep {
	lines: readonly string[];
	focus: number;
}

/**
 * The scope checklist's keys. Enter opens an empty row below the current one (unless the list is
 * full); Backspace in an empty row removes it and moves to the row above. Anything else is `null`,
 * so the input handles it.
 */
export function checklistKey(
	lines: readonly string[],
	index: number,
	key: string,
	max: number,
): ChecklistStep | null {
	if (key === "Enter") {
		const next = insertItem(lines, index + 1, "", max);
		return next === lines ? null : { lines: next, focus: index + 1 };
	}
	if (key === "Backspace" && lines[index] === "" && lines.length > 1) {
		return { lines: removeItem(lines, index), focus: Math.max(0, index - 1) };
	}
	return null;
}

/** Lines as they are saved: trimmed, with the empty rows dropped. */
export function cleanLines(lines: readonly string[]): string[] {
	return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}
// #endregion

// #region New rows
/** A fresh milestone or stage, named by its place so it saves before the seller renames it. */
export function newMilestone(position: number, noun: "Milestone" | "Stage"): Milestone {
	return {
		name: `${noun} ${position}`,
		description: "",
		deliverables: [],
		skills: [],
		startTrigger: "after_previous",
		lagDays: 0,
		chainReaction: true,
	};
}

/** A fresh team role. */
export function newTeamRole(position: number): TeamRole {
	return { name: `Role ${position}`, summary: "", skills: [], count: 1 };
}

/** Whether another stage, milestone or role fits. */
export function canAddStage(count: number): boolean {
	return count < STAGES_MAX;
}
// #endregion

// #region Saving
function cleanStage(stage: Milestone): Milestone {
	return {
		...stage,
		name: stage.name.trim(),
		deliverables: cleanLines(stage.deliverables),
		skills: cleanLines(stage.skills),
	};
}

function cleanRole(role: TeamRole): TeamRole {
	return { ...role, name: role.name.trim(), skills: cleanLines(role.skills) };
}

/**
 * The offer as it is saved: names trimmed, and every empty scope line, deliverable and skill row
 * dropped (an empty row is where the seller is about to type, not something to save).
 */
export function sanitiseOffer(offer: ListingOffer): ListingOffer {
	switch (offer.archetype) {
		case "one_off":
			return {
				...offer,
				milestones: offer.milestones.map(cleanStage),
				scope: cleanLines(offer.scope),
				teamRoles: offer.teamRoles.map(cleanRole),
			};
		case "pipeline":
			return {
				...offer,
				stages: offer.stages.map(cleanStage),
				teamRoles: offer.teamRoles.map(cleanRole),
			};
		default:
			return offer;
	}
}

/** Why an offer cannot be saved yet, said the way the field under it would say it. */
export interface OfferProblem {
	/** Where the problem is (`milestones.1.name`), so the editor can place the sentence. */
	path: string;
	message: string;
}

function unnamed(
	noun: string,
	rows: readonly { name: string }[],
	key: string,
): OfferProblem | null {
	const index = rows.findIndex((row) => row.name.trim() === "");
	return index < 0 ? null : { path: `${key}.${index}.name`, message: `Name ${noun} ${index + 1}.` };
}

/** The row of list `key` a problem is about (`milestones.1.name` → row 1), or `null`. */
export function problemRow(
	problem: OfferProblem | null,
	key: string,
): { index: number; message: string } | null {
	const match = problem?.path.match(new RegExp(`^${key}\\.(\\d+)(\\.|$)`));
	return problem && match ? { index: Number(match[1]), message: problem.message } : null;
}

/**
 * The first reason the sanitised offer would be refused, or `null` when it saves. Names are checked
 * first, in their own words; anything else falls back to the schema's message.
 */
export function offerProblem(offer: ListingOffer): OfferProblem | null {
	const clean = sanitiseOffer(offer);
	if (clean.archetype === "one_off") {
		const problem = unnamed("milestone", clean.milestones, "milestones") ??
			unnamed("role", clean.teamRoles, "teamRoles");
		if (problem) return problem;
	}
	if (clean.archetype === "pipeline") {
		const problem = unnamed("stage", clean.stages, "stages") ??
			unnamed("role", clean.teamRoles, "teamRoles");
		if (problem) return problem;
	}
	const parsed = ListingOfferSchema.safeParse(clean);
	if (parsed.success) return null;
	const issue = parsed.error.issues[0];
	return { path: issue.path.join("."), message: issue.message };
}
// #endregion

// #region Labels
/**
 * The delivery line a card and the summary read ("5-day delivery", "60-minute session"), or `null`
 * when the offer does not decide one (a product, a pipeline, a One-Off with no turnaround yet).
 */
export function deliveryLabel(offer: ListingOffer): string | null {
	switch (offer.archetype) {
		case "one_off":
			return offer.turnaroundDays === null ? null : `${offer.turnaroundDays}-day delivery`;
		case "session":
			return `${offer.minutes}-minute session`;
		case "cohort":
			return `${offer.minutes}-minute group session`;
		default:
			return null;
	}
}

/** A seat cap a new cohort starts from. */
export const DEFAULT_COHORT_SEATS = 10;

/**
 * The same session offer in the other format. One-to-one ↔ cohort keeps the length, the count and
 * the provider; a cohort gains a seat cap and enrolment, a one-to-one session drops them.
 */
export function switchSessionFormat(
	offer: Extract<ListingOffer, { archetype: "session" | "cohort" }>,
	to: "session" | "cohort",
): Extract<ListingOffer, { archetype: "session" | "cohort" }> {
	const base = {
		minutes: offer.minutes,
		count: offer.count,
		meetingProvider: offer.meetingProvider,
	};
	if (to === "session") return { archetype: "session", ...base };
	return {
		archetype: "cohort",
		...base,
		maxSeatsPerCohort: offer.archetype === "cohort"
			? offer.maxSeatsPerCohort
			: DEFAULT_COHORT_SEATS,
		continuousEnrollment: offer.archetype === "cohort" ? offer.continuousEnrollment : false,
	};
}

/** Which offer form a listing shows, and whether it carries the team block. */
export interface OfferEditor {
	archetype: FormArchetype;
	withTeam: boolean;
}

/**
 * The offer form for a listing's kind and delivery model, or `null` while its stored offer is still
 * in another archetype's shape (a delivery-model change whose save has not landed: the server
 * re-derives the offer, and showing the old form would edit a shape about to be replaced).
 */
export function offerEditorFor(
	kind: CatalogueKind,
	serviceType: ServiceType | null,
	offer: ListingOffer,
): OfferEditor | null {
	const archetype = formArchetypeOf(kind, serviceType);
	if (offer.archetype !== archetype) return null;
	return { archetype, withTeam: archetype === "one_off" && hasTeamRoles(serviceType) };
}

/** Each licence in one sentence, under the licence choice. */
export const LICENCE_SUMMARY: Readonly<Record<ListingLicence, string>> = {
	personal: "For the buyer's own projects. Not for client work or anything sold on.",
	commercial: "For work the buyer is paid for, including client projects. Not for resale as is.",
	extended: "Commercial use, plus products the buyer sells that include this file.",
};

/** The start-trigger choices a stage after the first offers, in the order they read. */
export const TRIGGER_OPTIONS: readonly { value: StartTrigger; label: string }[] = [
	{ value: "on_project_start", label: "When the project starts" },
	{ value: "after_previous", label: "After the previous stage" },
	{ value: "fixed_offset", label: "N days after the previous stage" },
];

/** The turnaround stops the slider offers, in days. */
export const TURNAROUND_STOPS = [1, 2, 3, 5, 7, 10, 14, 21, 30] as const;

/** The stop nearest a stored turnaround (which may predate the slider's stops). */
export function nearestStop(days: number): number {
	return TURNAROUND_STOPS.reduce((best, stop) =>
		Math.abs(stop - days) < Math.abs(best - days) ? stop : best
	);
}
// #endregion

// #region Attachments
/** The parts of a library file an attachment row records. */
export interface AttachableFile {
	assetId?: string | null;
	id: string;
	name: string;
	ext: string;
	sizeBytes: number;
}

const FORMAT_LABELS: Readonly<Record<string, string>> = {
	zip: "ZIP archive",
	pdf: "PDF document",
	psd: "Photoshop document",
	ai: "Illustrator file",
	fig: "Figma file",
	sketch: "Sketch file",
	blend: "Blender scene",
	ttf: "TrueType font",
	otf: "OpenType font",
	woff2: "Web font",
	mp3: "Audio",
	wav: "Audio",
	mp4: "Video",
	mov: "Video",
	docx: "Word document",
	xlsx: "Spreadsheet",
	csv: "Spreadsheet",
	md: "Markdown",
	txt: "Text",
	json: "JSON",
	epub: "E-book",
};

/** A format's name as buyers read it ("ZIP archive"), from its extension; unknown → "PSD file". */
export function formatLabel(ext: string): string {
	const key = ext.replace(/^\./, "").toLowerCase();
	return FORMAT_LABELS[key] ?? `${key.toUpperCase() || "Unknown"} file`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One library file as an attachment row. `fileId` is the registry file behind it, when there is one
 * (a fixture asset has none and attaches only its description). A file with no usable extension is
 * not attachable: the bundle lists formats, so `null`.
 */
export function attachmentOf(file: AttachableFile): AttachmentRef | null {
	const ext = file.ext.replace(/^\./, "").toLowerCase();
	if (!/^[a-z0-9]{1,10}$/.test(ext)) return null;
	const fileId = file.assetId ?? file.id;
	return {
		name: file.name.slice(0, 200),
		label: formatLabel(ext).slice(0, 80),
		extension: `.${ext}`,
		bytes: Math.max(0, Math.round(file.sizeBytes)),
		...(UUID_RE.test(fileId) ? { fileId } : {}),
	};
}

/**
 * `list` with each new attachment appended once (a file already attached is skipped), up to `max`.
 */
export function addAttachments(
	list: readonly AttachmentRef[],
	added: readonly AttachmentRef[],
	max: number,
): readonly AttachmentRef[] {
	const seen = new Set(list.map((a) => a.fileId ?? `${a.name}${a.extension}`));
	const next = [...list];
	for (const item of added) {
		const key = item.fileId ?? `${item.name}${item.extension}`;
		if (seen.has(key) || next.length >= max) continue;
		seen.add(key);
		next.push(item);
	}
	return next;
}

/** "2.4 MB" — a byte count as a buyer reads it. */
export function bytesLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
// #endregion
