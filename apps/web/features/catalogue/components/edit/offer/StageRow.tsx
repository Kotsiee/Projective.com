import type { JSX } from "preact";
import { useSortable } from "@projective/ui/dnd";
import {
	InputText,
	NumberInput,
	NumberStepper,
	Select,
	Textarea,
	ToggleSwitch,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { MONEY_FIELD, moneyDigits } from "@web/utils/money-field.ts";
import { formatMoney, toMajorUnits, toMinorUnits } from "@projective/types/finance";
import { StartTrigger } from "@projective/types/catalogue";
import type { Milestone } from "../../../types/catalogue-types.ts";
import { STAGE_LIST_MAX, TRIGGER_OPTIONS } from "../../../core/offer-model.ts";
import { ticketRange } from "../../../core/pricing-model.ts";
import { ScopeChecklist } from "./ScopeChecklist.tsx";
import { SkillTags } from "./SkillTags.tsx";

/** The drag id of stage `index`. */
export const stageDragId = (index: number) => `stage:${index}`;

/** Props for {@link StageRow}. */
export interface StageRowProps {
	index: number;
	stage: Milestone;
	currency: string;
	/** The listing's baseline ticket, in minor units, that an unpriced stage is sold at. */
	baselineMinor: number | null;
	problem: string | null;
	onPatch: (patch: Partial<Milestone>) => void;
	onRemove: () => void;
}

const TRIGGERS = TRIGGER_OPTIONS.map((o) => ({ label: o.label, value: o.value }));

/**
 * StageRow — one Pipeline stage as the seller defines it: its name and description, what it hands
 * over, its ticket price (the baseline unless set, with the range buyers see), the skills it needs,
 * when it starts, and whether arriving tickets are funded at once (the Chain Reaction, #210). The
 * first stage always starts with the project, so it asks neither when nor whether to fund on arrival.
 */
export function StageRow(props: StageRowProps): JSX.Element {
	const { index, stage, currency } = props;
	const sortable = useSortable({
		id: stageDragId(index),
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: "stage",
	});
	const base = `cat-offer-stage-${index}`;
	const label = stage.name.trim() || `Stage ${index + 1}`;
	const priced = stage.priceCents ?? props.baselineMinor;
	const range = priced === null ? null : ticketRange(priced);
	const first = index === 0;

	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="cat-offer__step"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<div class="cat-offer__step-head">
				<button
					type="button"
					class="cat-offer__grip"
					aria-label={`Reorder ${label}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<Icon name="grip" size="xs" />
				</button>
				<InputText
					id={`${base}-name`}
					value={stage.name}
					onValueChange={(name) => props.onPatch({ name })}
					maxLength={80}
					placeholder="Name this stage"
					aria-label={`Stage ${index + 1} name`}
					aria-describedby={props.problem ? `${base}-problem` : undefined}
					status={props.problem ? "invalid" : "default"}
					fluid
				/>
				<button
					type="button"
					class="cat-offer__remove"
					aria-label={`Remove ${label}`}
					onClick={props.onRemove}
				>
					<Icon name="close" size="2xs" />
				</button>
			</div>
			{props.problem && <p class="cat-offer__problem" id={`${base}-problem`}>{props.problem}</p>}

			<Textarea
				value={stage.description}
				onValueChange={(description) => props.onPatch({ description })}
				maxLength={600}
				rows={2}
				autoResize
				maxRows={6}
				placeholder="What happens in this stage"
				aria-label={`${label} description`}
				fluid
			/>

			<div class="cat-sec__field">
				<span class="cat-sec__label">Deliverables</span>
				<ScopeChecklist
					label={`${label} deliverables`}
					lines={stage.deliverables}
					onChange={(deliverables) => props.onPatch({ deliverables: [...deliverables] })}
					max={STAGE_LIST_MAX}
					maxLength={160}
					placeholder="Add a deliverable, then press Enter"
				/>
			</div>

			<div class="cat-offer__row">
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-price`}>Ticket price</label>
					<NumberInput
						{...MONEY_FIELD}
						{...moneyDigits(currency)}
						id={`${base}-price`}
						value={toMajorUnits(stage.priceCents ?? null, currency)}
						onValueChange={(next: number | null) =>
							props.onPatch({ priceCents: toMinorUnits(next, currency) ?? undefined })}
						placeholder={props.baselineMinor === null
							? "Not priced"
							: formatMoney(props.baselineMinor, currency)}
						aria-describedby={`${base}-price-hint`}
					/>
					<p class="cat-sec__hint" id={`${base}-price-hint`}>
						{range
							? `${stage.priceCents === undefined ? "The baseline ticket. " : ""}Buyers see ${
								formatMoney(range.low, currency)
							} – ${formatMoney(range.high, currency)}, by workload.`
							: "Set a baseline ticket in Pricing, or price this stage."}
					</p>
				</div>
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={`${base}-turnaround`}>Turnaround</label>
					<InputText
						id={`${base}-turnaround`}
						value={stage.turnaround ?? ""}
						onValueChange={(t) => props.onPatch({ turnaround: t.trim() ? t : undefined })}
						maxLength={40}
						placeholder="e.g. about a week"
					/>
				</div>
			</div>

			<div class="cat-sec__field">
				<label class="cat-sec__label" for={`${base}-skills`}>Skills</label>
				<SkillTags
					id={`${base}-skills`}
					value={stage.skills}
					onChange={(skills) => props.onPatch({ skills })}
				/>
			</div>

			<div class="cat-sec__field">
				{first
					? <span class="cat-sec__label">Starts</span>
					: <label class="cat-sec__label" for={`${base}-start`}>Starts</label>}
				{first ? <p class="cat-sec__value">When the project starts</p> : (
					<>
						<Select
							id={`${base}-start`}
							options={TRIGGERS}
							value={stage.startTrigger}
							onValueChange={(v) => {
								const parsed = StartTrigger.safeParse(v);
								if (parsed.success) props.onPatch({ startTrigger: parsed.data });
							}}
						/>
						{stage.startTrigger === "fixed_offset" && (
							<div class="cat-offer__compact">
								<NumberStepper
									value={stage.lagDays}
									onValueChange={(n) => props.onPatch({ lagDays: n ?? 0 })}
									min={0}
									max={90}
									unit={stage.lagDays === 1 ? "day" : "days"}
									aria-label={`Days after the previous stage that ${label} starts`}
								/>
							</div>
						)}
					</>
				)}
			</div>

			{!first && (
				<div class="cat-sec__field">
					<ToggleSwitch
						value={stage.chainReaction}
						onValueChange={(chainReaction) => props.onPatch({ chainReaction })}
						label="Fund on arrival"
						aria-describedby={`${base}-chain-hint`}
					/>
					<p class="cat-sec__hint" id={`${base}-chain-hint`}>
						When the previous stage is approved, the buyer's escrow for this stage is held straight
						away so work carries on. Off, the ticket waits here until the buyer funds it.
					</p>
				</div>
			)}
		</div>
	);
}
