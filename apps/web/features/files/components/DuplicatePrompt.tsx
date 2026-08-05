import type { JSX } from "preact";
import { Button, type ButtonVariant, type Severity } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { SourceMark } from "./file-hub-glyphs.tsx";
import {
	type AssetItem,
	type DedupOutcome,
	type DuplicateResolution,
	sourceLabel,
	type UploadTask,
	visibilityLabel,
} from "../types/file-types.ts";

/**
 * DuplicatePrompt — the question asked in the one moment it is worth asking: after the fingerprint
 * has been computed and the index has answered, and BEFORE any bytes travel.
 *
 * ## It always shows what it matched
 *
 * `existing` is typed non-nullable rather than mirroring `DedupVerdict.existing`, which is
 * `AssetItem | null`. That is the contract this component exists to enforce: a prompt that asserts
 * "you already have this" without naming the file, its size, where it lives and when it arrived is
 * asking a person to guess, and the safe guess is always "upload it again" — at which point the
 * prompt has cost a decision and saved nothing. The drawer therefore treats a non-`new` verdict
 * carrying no `existing` as `new` and uploads, rather than rendering a prompt with a hole in it.
 *
 * ## The two outcomes get different verbs, and different recommendations
 *
 * An **exact duplicate** is the same CONTENT under some name, so the useful answer is "use the copy
 * you have" — nothing needs to travel. A **name collision** is a DIFFERENT file sitting at the same
 * name in the same folder, so the useful answer is "keep both" and the destructive one is replace.
 * All four resolutions are offered for both (a person may genuinely mean any of them), but the
 * ORDER and the recommendation change, because the same list read in the same order would put the
 * wrong verb first half the time.
 *
 * ## Recommendation is carried by a word, not by a fill
 *
 * The recommended choice is an `outlined` button beside the literal word "Recommended" rather than a
 * filled primary. `--on-primary` on `--primary` measures 3.57:1 in dark mode (flagged by Decision
 * #64 and still unresolved at the token layer), so a filled primary is the wrong place for a label a
 * person has to read carefully — and a recommendation that survives a colour-blindness overlay has
 * to be a word regardless.
 *
 * ## A sampled match is a hint, and says so
 *
 * Above 256 MiB the client digests a SAMPLE — head window, tail window, exact length. Two files
 * sharing all three are very probably the same file and are absolutely not certainly the same file,
 * so when the fingerprint carries `sampled` the prompt prints that caveat instead of quietly
 * upgrading a hint into a claim. (The server re-digests in full before it ever collapses two rows
 * onto one stored object; that is its job, not this component's.)
 *
 * Dumb: no data access, no fetching, no state. It renders a question and reports the answer.
 */

// #region Props
export interface DuplicatePromptProps {
	/** The file waiting on an answer — the "coming in" side of the comparison. */
	task: UploadTask;
	/** What the index found. Narrowed to the two outcomes that actually need a decision. */
	outcome: Exclude<DedupOutcome, "new">;
	/** The asset it matched. Non-null by construction — see the module note. */
	existing: AssetItem;
	/** A resolution is being carried out; the choices stop accepting a second answer. */
	busy?: boolean;
	/** The person's answer. Fired exactly once per activation, never on render. */
	onResolve: (resolution: DuplicateResolution) => void;
}
// #endregion

// #region Choice model
/** One offered answer. Declared as data so the order and the copy live in one readable place. */
interface Choice {
	key: DuplicateResolution;
	label: string;
	/** What actually happens, in the reader's terms. Never a restatement of the label. */
	hint: string;
	variant: ButtonVariant;
	severity: Severity;
	/** The one choice this outcome leads with. */
	recommended?: boolean;
}

/**
 * The choices for an exact content match.
 *
 * `link_existing` leads: the bytes are already held, so using them costs nothing, takes no time and
 * consumes no allowance. `replace` is last of the acting choices and carries the danger ramp,
 * because it is the only one that removes something.
 */
const EXACT_CHOICES: readonly Choice[] = [
	{
		key: "link_existing",
		label: "Use the file you have",
		hint: "Nothing is uploaded. The copy already in your library is used.",
		variant: "outlined",
		severity: "primary",
		recommended: true,
	},
	{
		key: "upload_copy",
		label: "Upload anyway",
		hint: "Keeps both files. The second copy uses your storage allowance.",
		variant: "text",
		severity: "secondary",
	},
	{
		key: "replace",
		label: "Replace the existing file",
		hint:
			"Uploads yours, then moves the older file to your deleted items. Any share link to the older file stops working.",
		variant: "text",
		severity: "danger",
	},
	{
		key: "cancel",
		label: "Skip this file",
		hint: "Nothing is uploaded and nothing changes.",
		variant: "text",
		severity: "secondary",
	},
];

/**
 * The choices for a name collision.
 *
 * `upload_copy` leads: the contents differ, so keeping both is the answer that cannot lose anything.
 * `link_existing` survives — a person may realise the file they already have is the one they meant —
 * but it is demoted and its hint states plainly that the two are not the same file.
 */
const COLLISION_CHOICES: readonly Choice[] = [
	{
		key: "upload_copy",
		label: "Keep both",
		hint: "Yours is uploaded alongside the existing file. Two files will share a name.",
		variant: "outlined",
		severity: "primary",
		recommended: true,
	},
	{
		key: "replace",
		label: "Replace the existing file",
		hint:
			"Uploads yours, then moves the older file to your deleted items. Any share link to the older file stops working.",
		variant: "text",
		severity: "danger",
	},
	{
		key: "link_existing",
		label: "Use the existing file instead",
		hint: "Your file is not uploaded. Only the name matches — the contents are different.",
		variant: "text",
		severity: "secondary",
	},
	{
		key: "cancel",
		label: "Skip this file",
		hint: "Nothing is uploaded and nothing changes.",
		variant: "text",
		severity: "secondary",
	},
];
// #endregion

// #region Copy
/** The headline — states the finding, not the question, so the question below reads as the choice. */
function headline(outcome: Exclude<DedupOutcome, "new">): string {
	return outcome === "exact_duplicate"
		? "You already have this file"
		: "A different file already has this name here";
}

/** What was compared, so the finding can be judged rather than merely believed. */
function explanation(outcome: DedupOutcome, sampled: boolean): string {
	if (outcome === "exact_duplicate") {
		return sampled
			? "The start, the end and the exact size of this file match one in your library. Large files are matched on a sample, so this is a strong signal rather than a certainty — the full contents are checked before anything is linked."
			: "Every byte of this file matches one already in your library.";
	}
	return "The contents are different, so this is not the same file — only the name and the folder are the same.";
}

/** Where an asset sits, in the words the breadcrumb bar uses. */
function locationOf(asset: AssetItem): string {
	const trail = asset.folderPath.filter((segment) => segment.length > 0);
	return trail.length > 0 ? trail.join(" / ") : "Library root";
}

/** When it arrived, and from whom when that is known. */
function arrivalOf(asset: AssetItem): string {
	return asset.sender ? `${asset.dateLabel} · ${asset.sender.name}` : asset.dateLabel;
}
// #endregion

// #region Facts
interface FactProps {
	label: string;
	children: JSX.Element | string;
}

/** One label/value pair. Separated by spacing and type weight — never boxed (§B.4). */
function Fact({ label, children }: FactProps): JSX.Element {
	return (
		<div class="fh-dup__fact">
			<dt class="fh-dup__factlabel">{label}</dt>
			<dd class="fh-dup__factvalue">{children}</dd>
		</div>
	);
}
// #endregion

/**
 * Render the duplicate question for one queued file.
 *
 * @param props The file, what it matched, and the callback that receives the answer.
 */
export function DuplicatePrompt(props: DuplicatePromptProps): JSX.Element {
	const { task, outcome, existing, busy = false, onResolve } = props;

	const sampled = task.fingerprint?.sampled ?? false;
	const choices = outcome === "exact_duplicate" ? EXACT_CHOICES : COLLISION_CHOICES;

	return (
		<div class="fh-dup" data-outcome={outcome}>
			<p class="fh-dup__head">
				<span class="fh-dup__mark" aria-hidden="true">
					<Icon name={outcome === "exact_duplicate" ? "copy" : "warning"} size="xs" />
				</span>
				<span>{headline(outcome)}</span>
			</p>
			<p class="fh-dup__note">{explanation(outcome, sampled)}</p>

			<div class="fh-dup__pair">
				<section class="fh-dup__side" data-side="incoming">
					<h4 class="fh-dup__sidehead">Coming in</h4>
					<p class="fh-dup__name">{task.name}</p>
					<dl class="fh-dup__facts">
						<Fact label="Size">{task.sizeLabel}</Fact>
						<Fact label="Status">Not uploaded yet</Fact>
					</dl>
				</section>

				<section class="fh-dup__side" data-side="existing">
					<h4 class="fh-dup__sidehead">Already in your library</h4>
					<p class="fh-dup__name">
						<span class="fh-dup__source" aria-hidden="true">
							<SourceMark source={existing.source} size={14} />
						</span>
						<span>{existing.name}</span>
					</p>
					<dl class="fh-dup__facts">
						<Fact label="Size">{existing.sizeLabel}</Fact>
						<Fact label="Where">{locationOf(existing)}</Fact>
						<Fact label="Added">{arrivalOf(existing)}</Fact>
						<Fact label="Who can see it">{visibilityLabel(existing.visibility)}</Fact>
						{existing.source !== "supabase"
							? <Fact label="Stored in">{sourceLabel(existing.source)}</Fact>
							: null}
					</dl>
				</section>
			</div>

			<div class="fh-dup__choices">
				{choices.map((choice) => (
					<div class="fh-dup__choice" key={choice.key}>
						<Button
							variant={choice.variant}
							severity={choice.severity}
							size="sm"
							label={choice.label}
							disabled={busy}
							onClick={() => onResolve(choice.key)}
						/>
						{choice.recommended ? <span class="fh-dup__recommended">Recommended</span> : null}
						<span class="fh-dup__hint">{choice.hint}</span>
					</div>
				))}
			</div>
		</div>
	);
}
