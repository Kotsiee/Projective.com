import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type AccountLifecycle,
	DELETION_BLOCKER_COPY,
	DELETION_CONFIRMATION,
	DELETION_WINDOW_DAYS,
	type DeletionBlocker,
	type DeletionScope,
} from "@projective/types/org";
import { SettingsService } from "../../../core/SettingsService.ts";

/** What each removal tells the person before they confirm it. */
const COPY: Readonly<
	Record<
		DeletionScope,
		{ title: string; lede: string; consequences: readonly string[]; verb: string }
	>
> = {
	freelancer_profile: {
		title: "Switch to client only",
		lede:
			`You'll stop selling at once, and your freelancer profile is permanently deleted after ${DELETION_WINDOW_DAYS.freelancer_profile} days.`,
		consequences: [
			"Your services and products are taken down now, and archived for good after the waiting period.",
			"Your skills, hire questions and seller details are erased and can't be recovered.",
			"Your reviews, Standing and payment records stay — clients and regulators rely on them.",
			`Changed your mind? Become a freelancer again within ${DELETION_WINDOW_DAYS.freelancer_profile} days and everything comes back.`,
		],
		verb: "Delete freelancer profile",
	},
	account: {
		title: "Delete your account",
		lede:
			`Your profile is hidden at once, and your account is permanently erased after ${DELETION_WINDOW_DAYS.account} days.`,
		consequences: [
			"Your name, handle, photos, profile and email addresses are erased and can't be recovered.",
			"Your listings are taken down now and archived for good after the waiting period.",
			"Records of money that moved stay anonymised, as the law requires.",
			`You can cancel any time in the next ${DELETION_WINDOW_DAYS.account} days from this page.`,
		],
		verb: "Delete my account",
	},
};

/** Props for {@link RemovalDialog}. */
export interface RemovalDialogProps {
	open: Signal<boolean>;
	scope: DeletionScope;
	/** What would refuse the schedule right now — the confirm stays off while any remain. */
	blockers: readonly DeletionBlocker[];
	onScheduled: (lifecycle: AccountLifecycle) => void;
}

/**
 * RemovalDialog — the high-friction confirmation for giving up the freelancer profile or deleting
 * the account. It says exactly what goes and what stays, lists anything that must be finished first
 * (and keeps the confirm off until it is), and asks the person to type {@link DELETION_CONFIRMATION}
 * — a phrase every account can type, including one that only signs in with Google. The definer
 * checks the phrase again.
 */
export function RemovalDialog(props: RemovalDialogProps): JSX.Element {
	const copy = COPY[props.scope];
	const typed = useSignal("");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const fieldRef = useRef<HTMLDivElement>(null);
	const inputId = `stg-removal-${props.scope}`;

	useEffect(() => {
		if (!props.open.value) return;
		typed.value = "";
		error.value = null;
	}, [props.open.value]);

	const blocked = props.blockers.length > 0;
	const ready = !blocked && typed.value.trim() === DELETION_CONFIRMATION;

	async function confirm(): Promise<void> {
		if (!ready || busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await SettingsService.scheduleDeletion({
			scope: props.scope,
			confirmation: typed.value.trim(),
		});
		busy.value = false;
		if (!res.ok) {
			error.value = res.message;
			return;
		}
		props.open.value = false;
		props.onScheduled(res.data.lifecycle);
	}

	return (
		<Dialog
			visible={props.open}
			role="alertdialog"
			header={copy.title}
			width="var(--overlay-w-md)"
			class="stg-removal"
			initialFocusRef={fieldRef}
			footer={
				<div class="stg-removal__actions">
					<Button
						label="Keep everything"
						variant="text"
						severity="secondary"
						onClick={() => (props.open.value = false)}
					/>
					<Button
						label={copy.verb}
						severity="danger"
						loading={busy.value}
						disabled={!ready}
						onClick={confirm}
					/>
				</div>
			}
		>
			<div class="stg-removal__body">
				<p class="stg-removal__lede">
					<Icon name="warning" size="sm" aria-hidden="true" />
					{copy.lede}
				</p>
				<ul class="stg-removal__list">
					{copy.consequences.map((line) => <li key={line}>{line}</li>)}
				</ul>
				{blocked
					? (
						<div class="stg-removal__blockers" role="status">
							<p class="stg-removal__blockers-title">Finish these first</p>
							<ul class="stg-removal__list">
								{props.blockers.map((code) => <li key={code}>{DELETION_BLOCKER_COPY[code]}</li>)}
							</ul>
						</div>
					)
					: (
						<div class="stg-field" ref={fieldRef}>
							<label class="stg-field__label" for={inputId}>
								Type <strong>{DELETION_CONFIRMATION}</strong> to confirm
							</label>
							<InputText
								id={inputId}
								value={typed}
								fluid
								autoComplete="off"
								aria-describedby={error.value ? `${inputId}-error` : undefined}
								onValueChange={(value: string) => (typed.value = value)}
								onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void confirm();
									}
								}}
							/>
						</div>
					)}
				{error.value
					? (
						<p id={`${inputId}-error`} class="stg-field__hint stg-field__hint--error" role="alert">
							{error.value}
						</p>
					)
					: null}
			</div>
		</Dialog>
	);
}
