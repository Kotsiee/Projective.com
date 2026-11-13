import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Alert } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { TicketFundingQuote } from "@projective/types/finance";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { initialStageSelection, type PrepaidPreview, previewQuote } from "../core/stage-picker.ts";
import { StagePicker } from "./StagePicker.tsx";

/**
 * TicketBasketPicker — the Add to basket popover's body for a ticket that runs through several stages
 * (Decision #430): the ticket's stages from its funding quote, Select all, and a confirm that adds the
 * chosen stages as one basket line each. The host writes the basket; this only says which stages.
 */
export interface TicketBasketPickerProps {
	/** The project's `prj-…` slug. */
	project: string;
	/** The ticket's `tkt-…` slug, else its row id. */
	ticket: string;
	/** Add these stages; resolve `true` once their lines landed. */
	onConfirm: (stageIds: readonly string[]) => Promise<boolean>;
	onCancel: () => void;
	/** The Dev Context Switcher's prepaid-stage preview. */
	preview?: PrepaidPreview;
}

type Step = "loading" | "ready" | "error";

export function TicketBasketPicker(props: TicketBasketPickerProps): JSX.Element {
	const step = useSignal<Step>("loading");
	const quote = useSignal<TicketFundingQuote | null>(null);
	const failure = useSignal<string | null>(null);
	const selected = useSignal<readonly string[]>([]);
	const busy = useSignal(false);

	const load = async () => {
		step.value = "loading";
		failure.value = null;
		const res = await PaymentsService.ticketFundingQuote(props.project, props.ticket);
		if (!res.ok || !res.data) {
			failure.value = res.message ?? "We couldn't read this ticket's stages just now.";
			step.value = "error";
			return;
		}
		quote.value = res.data.quote;
		selected.value = initialStageSelection(res.data.quote, []);
		step.value = "ready";
	};

	useEffect(() => {
		void load();
	}, []);

	const confirm = async () => {
		if (busy.value || selected.value.length === 0) return;
		busy.value = true;
		try {
			await props.onConfirm(selected.value);
		} finally {
			busy.value = false;
		}
	};

	const shown = quote.value ? previewQuote(quote.value, props.preview ?? "auto") : null;
	const count = selected.value.length;

	return (
		<div class="stbp">
			<p class="stbp__head" id="stbp-head">Add stages to your basket</p>

			{step.value === "loading"
				? <p class="stbp__status" role="status">Reading this ticket's stages…</p>
				: null}

			{step.value === "error"
				? (
					<>
						<Alert severity="danger">{failure.value}</Alert>
						<Button
							severity="neutral"
							variant="outlined"
							rounded
							size="sm"
							label="Try again"
							onClick={() => void load()}
						/>
					</>
				)
				: null}

			{step.value === "ready" && shown
				? (
					<StagePicker
						quote={shown}
						selected={selected}
						onChange={(next) => (selected.value = next)}
						disabled={busy.value}
						idPrefix="stbp-stage"
						labelledBy="stbp-head"
					/>
				)
				: null}

			<div class="stbp__foot">
				<Button variant="text" rounded size="sm" label="Cancel" onClick={props.onCancel} />
				<Button
					severity="accent"
					rounded
					size="sm"
					label={count > 1 ? `Add ${count} stages` : "Add to basket"}
					disabled={step.value !== "ready" || count === 0}
					aria-busy={busy.value || undefined}
					onClick={() => void confirm()}
				/>
			</div>
		</div>
	);
}
