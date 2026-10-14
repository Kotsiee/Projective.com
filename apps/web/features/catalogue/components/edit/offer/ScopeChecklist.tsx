import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { DndContext, DropIndicator, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { checklistKey, moveItem, removeItem, replaceItem } from "../../../core/offer-model.ts";

/** Props for {@link ScopeChecklist}. */
export interface ScopeChecklistProps {
	/** The rows as the seller is editing them, empty rows included. */
	lines: readonly string[];
	onChange: (lines: readonly string[]) => void;
	/** Names the list ("Scope", "Stage 2 deliverables"); rows read "Scope line 3". */
	label: string;
	max: number;
	maxLength: number;
	placeholder: string;
}

const lineId = (index: number) => `line:${index}`;
const indexOf = (id: unknown) => Number(String(id).replace("line:", ""));

interface RowProps {
	index: number;
	text: string;
	label: string;
	maxLength: number;
	placeholder: string;
	only: boolean;
	register: (index: number, el: HTMLInputElement | null) => void;
	onText: (text: string) => void;
	onKey: (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => void;
	onRemove: () => void;
}

function ChecklistRow(props: RowProps): JSX.Element {
	const sortable = useSortable({
		id: lineId(props.index),
		data: { type: "scope-line", accepts: ["scope-line"] },
		roleDescription: "line",
	});
	const name = `${props.label} line ${props.index + 1}`;
	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="cat-offer__check"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<button
				type="button"
				class="cat-offer__grip"
				aria-label={`Reorder ${name}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<Icon name="grip" size="xs" />
			</button>
			<Icon name="check" size="xs" class="cat-offer__check-mark" />
			<input
				ref={(el) => props.register(props.index, el)}
				class="cat-offer__check-input"
				value={props.text}
				maxLength={props.maxLength}
				placeholder={props.placeholder}
				aria-label={name}
				enterKeyHint="next"
				onInput={(e) => props.onText(e.currentTarget.value)}
				onKeyDown={props.onKey}
			/>
			{!props.only && (
				<button
					type="button"
					class="cat-offer__remove"
					aria-label={`Remove ${name}`}
					onClick={props.onRemove}
				>
					<Icon name="close" size="2xs" />
				</button>
			)}
		</div>
	);
}

/**
 * ScopeChecklist — an editable list of short lines (what is included, a stage's deliverables) as
 * unboxed `check` rows, never chips or cards. Enter opens a row below, Backspace in an empty row
 * removes it and returns to the row above, rows drag to reorder (pointer or keyboard through
 * `@projective/ui/dnd`). Empty rows are kept while the seller types and dropped when saved.
 */
export function ScopeChecklist(props: ScopeChecklistProps): JSX.Element {
	const { onChange, max } = props;
	const lines = props.lines.length > 0 ? props.lines : [""];
	const inputs = useRef<(HTMLInputElement | null)[]>([]);
	const dragIndex = useSignal<number | null>(null);
	const overIndex = useSignal<number | null>(null);

	const focusRow = (index: number) => {
		setTimeout(() => {
			const el = inputs.current[index];
			if (el && document.activeElement !== el) el.focus();
		}, 0);
	};

	const onKey = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace" && e.currentTarget.selectionStart !== 0) return;
		const step = checklistKey(lines, index, e.key, max);
		if (!step) return;
		e.preventDefault();
		onChange(step.lines);
		focusRow(step.focus);
	};

	const from = dragIndex.value;
	const over = overIndex.value;
	const seamBefore = from !== null && over !== null && from > over ? over : null;
	const seamAfter = from !== null && over !== null && from < over ? over : null;

	return (
		<div class="cat-offer__checklist-wrap">
			<DndContext
				onDragStart={(e) => (dragIndex.value = indexOf(e.active.id))}
				onDragOver={(e) => (overIndex.value = e.over === null ? null : indexOf(e.over))}
				onDragEnd={(e) => {
					const start = dragIndex.value;
					const target = e.over === null ? null : indexOf(e.over);
					dragIndex.value = null;
					overIndex.value = null;
					if (e.canceled || start === null || target === null) return;
					onChange(moveItem(lines, start, target));
				}}
			>
				<ul class="cat-offer__checklist" aria-label={props.label}>
					{lines.map((text, i) => (
						<li key={i} class="cat-offer__check-slot">
							<DropIndicator active={seamBefore === i} />
							<ChecklistRow
								index={i}
								text={text}
								label={props.label}
								maxLength={props.maxLength}
								placeholder={i === lines.length - 1 ? props.placeholder : ""}
								only={lines.length === 1}
								register={(index, el) => (inputs.current[index] = el)}
								onText={(next) => onChange(replaceItem(lines, i, next))}
								onKey={onKey(i)}
								onRemove={() => {
									onChange(removeItem(lines, i));
									focusRow(Math.max(0, i - 1));
								}}
							/>
							<DropIndicator active={seamAfter === i} />
						</li>
					))}
				</ul>
			</DndContext>
			<p class="cat-sec__count">{lines.filter((l) => l.trim()).length} of {max}</p>
		</div>
	);
}
