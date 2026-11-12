import type { JSX, Ref, RefObject, VNode } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/create-stage-popover.css";
import { Popover, type PopoverProps, type PopoverTriggerApi } from "@projective/ui/feedback";
import { Button, FormControl, InputText, MoneyInput, Select } from "@projective/ui/fields";
import { BodyPortal } from "@projective/ui/overlay";
import { styleVars } from "@ui/core/style.ts";
import type { PressPoint } from "@web/features/files/core/press-point.ts";
import { BoardService } from "../core/BoardService.ts";
import {
	createStagePayload,
	NO_STAGE_CATEGORY,
	STAGE_CATEGORY_OPTIONS,
	STAGE_NAME_MAX,
} from "../core/create-stage.ts";
import type { BoardStageRef } from "../types/projects-types.ts";

/**
 * Where the popover stands when it is opened from somewhere other than its own trigger: on the control
 * that asked (the lane's ＋), or at the point a menu row was pressed (Decision #407).
 */
export type StageAnchor =
	| { kind: "element"; element: HTMLElement }
	| { kind: "point"; point: PressPoint };

/**
 * CreateStagePopover — the one surface that appends a stage: an anchored {@link Popover} holding the
 * stage's name, its CREATE category and its baseline rate, the last two optional (Decision #416). It
 * replaced a full-screen modal for a form the owner fills in one breath, so the board, the timeline and
 * the lane keep their place while it is open.
 *
 * It stands on the control that opened it: the trigger's own button when the caller renders it through
 * {@link trigger} (the footer rigs), or an {@link StageAnchor} when the opener lives elsewhere. It
 * writes through `BoardService.createStage`, which announces the persisted stage to every island that
 * draws stages, and closes only once the server has it; a refusal stays inline and the draft stays.
 */
export interface CreateStagePopoverProps {
	/** Open state, shared with whatever opens it. */
	open: Signal<boolean>;
	/** The project's route slug — the write's URL segment. */
	projectId: string;
	/**
	 * The engagement's currency, which the rate is typed in. `null` offers no rate: a personal project
	 * carries no money (Decision #192), and a price in an unknown currency would be a guess.
	 */
	currency: string | null;
	/** The trigger's own button, given the popover's api exactly as `Popover` gives it. */
	trigger?: (api: PopoverTriggerApi) => VNode;
	/** Where to stand when the opener is not {@link trigger}. */
	anchor?: StageAnchor | null;
	/** Preferred side; a band at the viewport's foot opens upward. */
	placement?: PopoverProps["placement"];
	/** The persisted stage, after the popover has closed. */
	onCreated?: (stage: BoardStageRef) => void;
}

function StagePoint({ at, anchorRef }: { at: PressPoint; anchorRef: RefObject<HTMLElement> }): JSX.Element {
	return (
		<BodyPortal>
			<span
				ref={anchorRef as Ref<HTMLSpanElement>}
				class="proj-stagepop__point"
				aria-hidden="true"
				style={styleVars({ "--stagepop-x": `${at.x}px`, "--stagepop-y": `${at.y}px` })}
			/>
		</BodyPortal>
	);
}

const CATEGORY_HINT =
	"The kind of work this stage is, from the CREATE framework. It labels the work and never changes a ticket's workload intensity.";
const RATE_HINT =
	"The stage's price: per standard ticket on a pipeline, the whole fee on a one-off. Leave it empty to price the stage later.";

export function CreateStagePopover(props: CreateStagePopoverProps): JSX.Element {
	const { open, projectId, currency } = props;
	const nameScope = useRef<HTMLDivElement>(null);
	const name = useSignal("");
	const category = useSignal<string>(NO_STAGE_CATEGORY);
	const rate = useSignal<number | null>(null);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const priced = currency !== null;

	useEffect(() => {
		if (!open.value) return;
		name.value = "";
		category.value = NO_STAGE_CATEGORY;
		rate.value = null;
		error.value = null;
	}, [open.value]);

	async function submit(): Promise<void> {
		const payload = createStagePayload({
			name: name.value,
			category: category.value,
			rateMinor: rate.value,
			priced,
		});
		if (!payload || busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await BoardService.createStage(projectId, payload);
		busy.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "That stage could not be created.";
			return;
		}
		open.value = false;
		props.onCreated?.(res.data.stage);
	}

	return (
		<Popover
			open={open}
			label="Create stage"
			placement={props.placement ?? "bottom-start"}
			class="proj-stagepop"
			initialFocusRef={nameScope}
			avoid={[".ui-app-shell__sidebar"]}
			trigger={(api) => {
				const anchor = props.anchor ?? null;
				if (anchor?.kind === "element") api.ref.current = anchor.element;
				return (
					<>
						{anchor === null && props.trigger ? props.trigger(api) : null}
						{anchor?.kind === "point" ? <StagePoint at={anchor.point} anchorRef={api.ref} /> : null}
					</>
				);
			}}
		>
			<form
				class="proj-stagepop__form"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<FormControl label="Stage name" collapseHint>
					{({ id, describedBy }) => (
						<div ref={nameScope}>
							<InputText
								id={id}
								aria-describedby={describedBy}
								value={name}
								placeholder="e.g. Design review"
								maxLength={STAGE_NAME_MAX}
								required
								block
								onValueChange={(v: string) => (name.value = v)}
							/>
						</div>
					)}
				</FormControl>
				<FormControl label="CREATE category (optional)" hint={CATEGORY_HINT} collapseHint>
					{({ id, describedBy }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							options={[...STAGE_CATEGORY_OPTIONS]}
							value={category.value}
							onValueChange={(v) => (category.value = v || NO_STAGE_CATEGORY)}
							fluid
						/>
					)}
				</FormControl>
				{priced
					? (
						<FormControl label="Baseline rate (optional)" hint={RATE_HINT} collapseHint>
							{({ id, describedBy }) => (
								<MoneyInput
									id={id}
									aria-describedby={describedBy}
									value={rate}
									currency={currency}
									placeholder="Not priced yet"
									fluid
								/>
							)}
						</FormControl>
					)
					: null}
				{error.value ? <p class="proj-stagepop__error" role="alert">{error.value}</p> : null}
				<div class="proj-stagepop__foot">
					<Button type="button" variant="text" size="sm" label="Cancel" onClick={() => (open.value = false)} />
					<Button
						type="submit"
						structural
						size="sm"
						label="Create stage"
						loading={busy.value}
						disabled={busy.value || name.value.trim().length === 0}
					/>
				</div>
			</form>
		</Popover>
	);
}
