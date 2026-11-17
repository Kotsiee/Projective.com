import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button, FormControl, InputText, Textarea, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	PORTFOLIO_LIMITS,
	SavePortfolioPieceSchema,
	type WorkPiece,
} from "@projective/types/profile";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import { errorsFromIssues } from "../../core/edit-model.ts";
import {
	pieceDirty,
	type PieceDraft,
	pieceDraftOf,
	pieceInput,
} from "../../core/owner-portfolio.ts";
import { ProfileService } from "../../core/ProfileService.ts";

/**
 * PortfolioDialog — one portfolio piece, added or edited in a dialog from the owner's "Selected work"
 * (Decision #439): a cover picture cut through the File Picker's crop (a still, at the showcase's
 * 16:10), a title, the client and category the tile's caption reads, a description, and whether
 * visitors see it. A save answers with the portfolio as now stored, which the masonry redraws from.
 */
export interface PortfolioDialogProps {
	open: Signal<boolean>;
	handle: string;
	/** The piece being edited; `null` adds a new one. */
	piece: WorkPiece | null;
	onSaved: (pieces: WorkPiece[], added: boolean) => void;
}

export function PortfolioDialog(
	{ open, handle, piece, onSaved }: PortfolioDialogProps,
): JSX.Element {
	const initial = useRef<PieceDraft>(pieceDraftOf(piece)).current;
	const draft = useSignal<PieceDraft>(initial);
	const errors = useSignal<Record<string, string>>({});
	const message = useSignal("");
	const busy = useSignal(false);
	const pickOpen = useSignal(false);
	const scope = useRef<HTMLDivElement>(null);
	const d = draft.value;
	const err = errors.value;
	const dirty = pieceDirty(initial, d);
	const adding = piece === null;
	const set = (patch: Partial<PieceDraft>) => (draft.value = { ...draft.peek(), ...patch });
	const close = () => (open.value = false);

	async function save(): Promise<void> {
		if (busy.peek() || !dirty) return;
		const parsed = SavePortfolioPieceSchema.safeParse(pieceInput(draft.peek(), piece?.id ?? null));
		if (!parsed.success) {
			errors.value = errorsFromIssues(parsed.error.issues);
			message.value = Object.values(errors.value)[0] ?? "Some details need fixing.";
			return;
		}
		busy.value = true;
		message.value = "";
		const res = await ProfileService.savePortfolioPiece(handle, parsed.data);
		busy.value = false;
		if (!res.ok || !res.data) {
			errors.value = res.errors ?? {};
			message.value = res.message ?? "This piece couldn't be saved.";
			return;
		}
		close();
		onSaved(res.data.pieces, adding);
	}

	return (
		<>
			<Dialog
				visible={open}
				header={adding ? "Add work" : "Edit this piece"}
				width="min(44rem, calc(100vw - var(--space-6)))"
				class="pf-piece-dialog"
				initialFocusRef={scope}
				footer={
					<div class="pf-modal__actions">
						<p class="pf-inline__status" role="status" aria-live="polite">{message.value}</p>
						<Button variant="text" class="pf-edit__ghost" onClick={close}>Cancel</Button>
						<Button
							class="pf-edit__save"
							aria-busy={busy.value ? "true" : undefined}
							disabled={!dirty}
							onClick={() => void save()}
						>
							{busy.value ? "Saving…" : adding ? "Add to portfolio" : "Save changes"}
						</Button>
					</div>
				}
			>
				<div
					ref={scope}
					tabIndex={-1}
					class="pf-piece-dialog__body"
					onKeyDown={(e) => {
						if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
							e.preventDefault();
							void save();
						}
					}}
				>
					<div class="pf-piece-dialog__cover">
						<div class="pf-piece-dialog__frame" data-empty={d.coverPreview ? undefined : "true"}>
							{d.coverPreview
								? <img class="pf-piece-dialog__img" src={d.coverPreview} alt="" />
								: <Icon name="image" size="lg" aria-hidden />}
						</div>
						<div class="pf-piece-dialog__covertext">
							<p class="pf-edit__fieldname">Cover picture</p>
							<p class="pf-edit__hint">A still, cropped to the shape of the tile.</p>
							<Button
								size="sm"
								severity="neutral"
								variant="outlined"
								aria-haspopup="dialog"
								icon={<Icon name="image" size="sm" />}
								onClick={() => (pickOpen.value = true)}
							>
								{d.coverPreview ? "Replace picture" : "Choose a picture"}
							</Button>
							{err.cover && <p class="pf-edit__error" role="alert">{err.cover}</p>}
						</div>
					</div>

					<FormControl
						label="Title"
						required
						error={err.title}
						status={err.title ? "invalid" : "default"}
					>
						{({ id, describedBy, status, required }) => (
							<InputText
								id={id}
								aria-describedby={describedBy}
								status={status}
								required={required}
								value={d.title}
								maxLength={PORTFOLIO_LIMITS.title}
								fluid
								onValueChange={(v) => set({ title: v })}
							/>
						)}
					</FormControl>
					<div class="pf-edit__grid">
						<FormControl
							label="Client"
							error={err.client}
							status={err.client ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<InputText
									id={id}
									aria-describedby={describedBy}
									status={status}
									value={d.client}
									maxLength={PORTFOLIO_LIMITS.client}
									placeholder="Leave empty if undisclosed"
									fluid
									onValueChange={(v) => set({ client: v })}
								/>
							)}
						</FormControl>
						<FormControl
							label="Category"
							error={err.category}
							status={err.category ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<InputText
									id={id}
									aria-describedby={describedBy}
									status={status}
									value={d.category}
									maxLength={PORTFOLIO_LIMITS.category}
									placeholder="Product design"
									fluid
									onValueChange={(v) => set({ category: v })}
								/>
							)}
						</FormControl>
					</div>
					<FormControl
						label="About this piece"
						note={`${d.description.length} / ${PORTFOLIO_LIMITS.description}`}
						error={err.description}
						status={err.description ? "invalid" : "default"}
					>
						{({ id, describedBy, status }) => (
							<Textarea
								id={id}
								aria-describedby={describedBy}
								status={status}
								value={d.description}
								maxLength={PORTFOLIO_LIMITS.description}
								rows={3}
								autoResize
								maxRows={10}
								fluid
								onValueChange={(v) => set({ description: v })}
							/>
						)}
					</FormControl>
					<ToggleSwitch
						value={d.isPublic}
						label="Show this piece to visitors"
						onValueChange={(on) => set({ isPublic: on })}
					/>
				</div>
			</Dialog>
			<MediaCropPicker
				open={pickOpen}
				requesterId="profile-portfolio-cover"
				target="showcase"
				title="Choose a cover picture"
				saveLabel="Use this picture"
				onSave={(choices) => {
					const choice = choices[0];
					if (!choice) return Promise.resolve("Choose a picture first.");
					set({
						cover: { sourceAssetId: choice.sourceAssetId, crop: choice.crop },
						coverPreview: choice.previewUrl,
					});
					return Promise.resolve(null);
				}}
			/>
		</>
	);
}
