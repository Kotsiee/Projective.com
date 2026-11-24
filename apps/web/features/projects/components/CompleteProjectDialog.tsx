import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/project-complete.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type {
	EngagementKind,
	ProjectCompleted,
	ProjectCompletePreview,
} from "../types/projects-types.ts";
import { SettlementService } from "../core/SettlementService.ts";
import {
	projectCompleteBlockedText,
	projectCompleteConsequences,
	projectCompleteCopy,
} from "../core/project-complete-model.ts";

/**
 * CompleteProjectDialog — the client's Complete confirmation (EX1, Decision #546). Opening it reads
 * what completing closes (`GET /api/projects/:id/complete`): the open tickets nobody funded and the
 * open stages. Nothing is held when it is offered, so no money moves and the commit is the core
 * workflow fill, not the financial pill. A blocked engagement (money held, a dispute) says why and
 * offers no commit. Completing opens the engagement's reviews; it can be reopened to extend it, so
 * the confirm is not a destructive one. A refusal stays in the dialog beside its control.
 */
export interface CompleteProjectDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The engagement's route address (`prj-…`). */
	projectId: string;
	title: string;
	/** The engagement's kind as the caller knows it; the preview's own answer wins once it is read. */
	kind: EngagementKind;
	/** The engagement was completed; `message` is the server's notice. */
	onCompleted: (result: ProjectCompleted, message: string | null) => void;
}

export function CompleteProjectDialog(props: CompleteProjectDialogProps): JSX.Element {
	const { open, title, onCompleted } = props;
	const preview = useSignal<ProjectCompletePreview | null>(null);
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const projectRef = useRef(props.projectId);
	projectRef.current = props.projectId;
	const request = useRef(0);
	const actionsRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const my = ++request.current;
		preview.value = null;
		loadError.value = null;
		submitError.value = null;
		loading.value = true;
		const res = await SettlementService.previewProjectComplete(projectRef.current);
		if (my !== request.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ??
				"What completing closes could not be read — please try again.";
			return;
		}
		preview.value = res.data;
	}

	useSignalEffect(() => {
		if (open.value) void load();
		else request.current++;
	});

	const current = preview.value;
	const kind = current?.kind ?? props.kind;
	const copy = projectCompleteCopy(kind);

	async function confirm(): Promise<void> {
		if (busy.value || !preview.value?.completable) return;
		busy.value = true;
		submitError.value = null;
		const res = await SettlementService.completeProject(projectRef.current);
		busy.value = false;
		if (!res.ok || !res.data) {
			submitError.value = res.message ??
				`The ${copy.noun} could not be completed — please try again.`;
			return;
		}
		open.value = false;
		onCompleted(res.data, res.message ?? null);
	}

	return (
		<Dialog
			visible={open}
			header={copy.header}
			class="proj-complete"
			width="32rem"
			initialFocusRef={actionsRef}
			footer={
				<div ref={actionsRef} class="proj-complete__actions">
					<Button
						label="Not yet"
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
					{current?.completable
						? (
							<Button
								label={copy.commit}
								loading={busy.value}
								disabled={busy.value}
								onClick={() => void confirm()}
							/>
						)
						: null}
				</div>
			}
		>
			<div class="proj-complete__body">
				<p class="proj-complete__lede">
					Completing <strong>{title || `this ${copy.noun}`}</strong>{" "}
					closes it and opens its reviews. Nothing is held on it, so no money moves. To extend it
					later, reopen it.
				</p>

				{loading.value
					? <p class="proj-complete__meta" role="status">Reading what this {copy.noun} holds…</p>
					: null}

				{loadError.value
					? (
						<div class="proj-complete__notice">
							<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
							<Button
								label="Try again"
								severity="neutral"
								variant="outlined"
								size="sm"
								onClick={() => void load()}
							/>
						</div>
					)
					: null}

				{current?.blocked
					? (
						<Message severity="info" variant="subtle" size="sm">
							{projectCompleteBlockedText(current.blocked, kind)}
						</Message>
					)
					: null}

				{current?.completable
					? <p class="proj-complete__meta">{projectCompleteConsequences(current).join(" · ")}</p>
					: null}

				{submitError.value
					? (
						<Message
							severity="danger"
							variant="subtle"
							size="sm"
							closable
							onClose={() => (submitError.value = null)}
						>
							{submitError.value}
						</Message>
					)
					: null}
			</div>
		</Dialog>
	);
}
