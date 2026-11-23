import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, Checkbox } from "@projective/ui/fields";
import {
	COMMIT_LEGAL_DOCUMENTS,
	type LegalAcceptanceRequired,
	type LegalCommitStamp,
} from "@projective/types/legal";
import "../styles/commit-acceptance.css";

/** Props for {@link CommitAcceptanceDialog}. */
export interface CommitAcceptanceDialogProps {
	/**
	 * What the door asked for: a claim or funding refusal's `details` read through
	 * `readLegalAcceptanceRequired`. `null` while nothing is asked; the dialog sets it back to `null`
	 * when it closes.
	 */
	request: Signal<LegalAcceptanceRequired | null>;
	/** Run the claim or funding again carrying the accepted version. */
	onAccept: (stamp: LegalCommitStamp) => void;
}

const COPY = {
	claim: {
		header: "Before your first paid claim",
		lead:
			"Work you deliver on a paid ticket is transferred to the client under the IP Transfer Deed when its escrow is finally released.",
		action: "Accept and claim",
	},
	fund: {
		header: "Before your first funding",
		lead:
			"Money you fund is held, released and refunded under the Escrow Terms. You accept them once for each version.",
		action: "Accept and fund",
	},
} as const;

/**
 * CommitAcceptanceDialog — asks for the IP Transfer Deed at a maker's first paid claim and the Escrow
 * Terms at a payer's first funding (LG3), once per version. A claim or funding door answers 409
 * `legal_acceptance_required` naming the document and the version in effect; this dialog names exactly
 * that version beside an unticked box, links the document (a new tab, so the claim or funding keeps its
 * place), and on Accept closes and hands the host the stamp to run the same commit again. The database
 * records the acceptance inside that commit, so a cancelled dialog records nothing.
 */
export function CommitAcceptanceDialog(props: CommitAcceptanceDialogProps): JSX.Element {
	const visible = useSignal(false);
	const ticked = useSignal(false);

	useSignalEffect(() => {
		const open = props.request.value !== null;
		visible.value = open;
		if (open) ticked.value = false;
	});

	const ask = props.request.value;
	const doc = ask ? COMMIT_LEGAL_DOCUMENTS[ask.document] : null;
	const copy = doc ? COPY[doc.surface] : COPY.fund;
	const boxId = "legal-commit-accept";

	const accept = () => {
		if (!ask || !ticked.value) return;
		const stamp: LegalCommitStamp = { [ask.document]: ask.version };
		props.request.value = null;
		props.onAccept(stamp);
	};

	return (
		<Dialog
			visible={visible}
			header={copy.header}
			width="var(--overlay-w-sm)"
			class="legal-commit-dialog"
			onVisibleChange={(open) => {
				if (!open) props.request.value = null;
			}}
			footer={
				<div class="legal-commit__foot">
					<Button variant="text" label="Cancel" onClick={() => (props.request.value = null)} />
					{doc?.surface === "fund"
						? (
							<Button
								variant="filled"
								severity="accent"
								rounded
								label={copy.action}
								disabled={!ticked.value}
								onClick={accept}
							/>
						)
						: (
							<Button
								variant="filled"
								label={copy.action}
								disabled={!ticked.value}
								onClick={accept}
							/>
						)}
				</div>
			}
		>
			{ask && doc && (
				<div class="legal-commit">
					<p class="legal-commit__lead">{copy.lead}</p>
					<div class="legal-commit__row">
						<Checkbox id={boxId} value={ticked} required />
						<label class="legal-commit__text" for={boxId}>
							I accept the{" "}
							<a
								class="legal-commit__link"
								href={`/legal/${ask.document}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								{doc.title}
							</a>{" "}
							v{ask.version}
						</label>
					</div>
				</div>
			)}
		</Dialog>
	);
}
