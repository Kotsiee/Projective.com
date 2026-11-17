import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { ConfirmDialog, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ProfileEditModel, ProfileTabPayload } from "@projective/types/profile";
import "../styles/profile.css";
import {
	certificationDates,
	certificationTitle,
	educationDates,
	experienceDates,
	LedgerRow,
} from "../components/tabs/ExperienceTab.tsx";
import { newestFirst } from "../components/tabs/tab-shared.tsx";
import { OwnerEditButton } from "../components/edit/OwnerBlock.tsx";
import {
	LEDGER_NOUN,
	LedgerAddDialog,
	LedgerRowEditor,
} from "../components/edit/LedgerEditors.tsx";
import {
	blankDraft,
	draftOfRow,
	entriesOf,
	type Ledger,
	type LedgerDraft,
	logosOf,
	removeRowPatch,
} from "../core/owner-experience.ts";
import { liveProfile, saveOwnerPatch } from "../core/owner-store.ts";
import type { OwnerEdit } from "../core/owner-edit.ts";
import { useOwnerAnchor } from "../hooks/useOwnerAnchor.ts";
import { useOwnerModel } from "../hooks/useOwnerModel.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * OwnerExperience — the Experience section as its OWNER sees it on `/[handle]/experience` (Decision
 * #439): the visitor's three ledgers — roles, education, certifications, newest first — with each row
 * editable in place or removable after a confirm, and each ledger's Add opening a dialog. Every change
 * saves the ledger through `org.save_profile`, and the rows redraw from the model the save answers
 * with. An empty ledger stands as a one-line stub, so the way to fill it is where it will be read.
 */
export interface OwnerExperienceProps {
	profile: ProfileView;
	model: ProfileEditModel;
	/** The section's public read — the logos, which the model does not carry. */
	payload: ProfileTabPayload;
	edit: OwnerEdit;
}

const TITLE: Record<Ledger, string> = {
	experience: "Experience",
	education: "Education",
	certifications: "Certifications",
};

const STUB: Record<Ledger, string> = {
	experience: "Visitors see the roles you've held once you add them.",
	education: "Visitors see your qualifications once you add them.",
	certifications: "Visitors see your certifications once you add them.",
};

/** A row's address in the page, for focus to come back to once its editor closes. */
function rowKey(ledger: Ledger, id: string): string {
	return `${ledger}:${id}`;
}

export default function OwnerExperience(props: OwnerExperienceProps): JSX.Element {
	const model = useOwnerModel(props.model);
	const profile = liveProfile(props.profile);
	const logos = useMemo(() => logosOf(props.payload), [props.payload]);
	const entries = entriesOf(model, logos);
	const handle = props.edit.handle;
	const editing = useSignal<string | null>(null);
	const removing = useSignal<{ ledger: Ledger; id: string } | null>(null);
	const confirmOpen = useSignal(false);
	const addOpen = useSignal(false);
	const addDraft = useSignal<LedgerDraft | null>(null);
	const addSeq = useSignal(0);
	const notice = useSignal("");
	useOwnerAnchor("experience", () => {});

	function closeRow(key: string): void {
		editing.value = null;
		setTimeout(() => {
			document.querySelector<HTMLElement>(`[data-row="${key}"] .pf-owneredit`)?.focus();
		}, 0);
	}

	function openAdd(ledger: Ledger): void {
		addDraft.value = blankDraft(ledger);
		addSeq.value += 1;
		addOpen.value = true;
	}

	async function remove(): Promise<void> {
		const target = removing.peek();
		removing.value = null;
		if (!target) return;
		const res = await saveOwnerPatch(
			handle,
			removeRowPatch(model, target.ledger, target.id),
			profile,
		);
		notice.value = res.ok ? `The ${LEDGER_NOUN[target.ledger].one} was removed.` : res.message;
	}

	function rowActions(ledger: Ledger, id: string): ComponentChildren {
		const noun = LEDGER_NOUN[ledger].one;
		return (
			<>
				<OwnerEditButton
					label={`this ${noun}`}
					onClick={() => (editing.value = rowKey(ledger, id))}
				/>
				<Tooltip content="Remove" density="compact">
					<Button
						size="sm"
						severity="neutral"
						variant="outlined"
						iconOnly
						class="pf-owneredit"
						aria-label={`Remove this ${noun}`}
						icon={<Icon name="trash" size="sm" />}
						onClick={() => {
							removing.value = { ledger, id };
							confirmOpen.value = true;
						}}
					/>
				</Tooltip>
			</>
		);
	}

	/** The row `id` of `ledger`: its fields while it is being edited, else the visitor's row. */
	function row(ledger: Ledger, id: string, view: (key: string) => JSX.Element): JSX.Element {
		const key = rowKey(ledger, id);
		const stored = draftOfRow(model, ledger, id);
		if (editing.value === key && stored) {
			return (
				<li key={key} class="pf-tl pf-tl--editing" data-row={key}>
					<LedgerRowEditor
						handle={handle}
						profile={profile}
						model={model}
						id={id}
						index={stored.index}
						initial={stored.draft}
						close={() => closeRow(key)}
					/>
				</li>
			);
		}
		return view(key);
	}

	function section(ledger: Ledger, rows: JSX.Element[]): JSX.Element {
		return (
			<section class="pf-exp__section" aria-labelledby={`pf-exp-${ledger}`}>
				<div class="pf-ownerhead">
					<h2 class="pf-h" id={`pf-exp-${ledger}`}>{TITLE[ledger]}</h2>
					<Button
						size="sm"
						variant="text"
						class="pf-edit__ghost"
						aria-haspopup="dialog"
						icon={<Icon name="plus" size="sm" />}
						onClick={() => openAdd(ledger)}
					>
						{LEDGER_NOUN[ledger].add}
					</Button>
				</div>
				{rows.length
					? <ul class="pf-exp__list" role="list">{rows}</ul>
					: <p class="pf-ownerstub__note">{STUB[ledger]}</p>}
			</section>
		);
	}

	const experience = newestFirst(entries.experience, (e) => e.start).map((e) =>
		row(
			"experience",
			e.id,
			(key) => (
				<LedgerRow
					key={key}
					rowKey={key}
					logo={e.logo}
					org={e.org}
					title={e.role}
					dates={experienceDates(e)}
					summary={e.summary}
					actions={rowActions("experience", e.id)}
				/>
			),
		)
	);
	const education = newestFirst(entries.education, (d) => d.start).map((d) =>
		row(
			"education",
			d.id,
			(key) => (
				<LedgerRow
					key={key}
					rowKey={key}
					logo={d.logo}
					org={d.school}
					title={`${d.credential} · ${d.field}`}
					dates={educationDates(d)}
					actions={rowActions("education", d.id)}
				/>
			),
		)
	);
	const certifications = newestFirst(entries.certifications, (c) => c.issued).map((c) =>
		row(
			"certifications",
			c.id,
			(key) => (
				<LedgerRow
					key={key}
					rowKey={key}
					logo={c.logo}
					org={c.issuer}
					title={certificationTitle(c)}
					dates={certificationDates(c)}
					link={c.credentialUrl}
					actions={rowActions("certifications", c.id)}
				/>
			),
		)
	);

	return (
		<div class="pf-exp" id="experience">
			<p class="pf-inline__status" role="status" aria-live="polite">{notice.value}</p>
			{section("experience", experience)}
			{section("education", education)}
			{section("certifications", certifications)}
			{addDraft.value && (
				<LedgerAddDialog
					key={addSeq.value}
					open={addOpen}
					initial={addDraft.value}
					handle={handle}
					profile={profile}
					model={model}
					onAdded={(noun) => (notice.value = `The ${noun} was added.`)}
				/>
			)}
			<ConfirmDialog
				visible={confirmOpen}
				header="Remove this entry?"
				message="It leaves your Experience section for good."
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => void remove()}
				onReject={() => (removing.value = null)}
			/>
		</div>
	);
}
