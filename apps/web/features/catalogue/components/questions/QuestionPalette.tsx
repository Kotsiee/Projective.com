import type { JSX, RefObject } from "preact";
import { useDraggable } from "@projective/ui/dnd";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";
import type { IntakeFieldKind } from "@projective/types/services";
import { INTAKE_KIND_LABELS, PALETTE_KINDS } from "../../core/intake-model.ts";

/** Each question kind's glyph, from the icon registry (§B.7). */
export const KIND_ICONS: Readonly<Record<IntakeFieldKind, IconName>> = {
	text: "font-type",
	textarea: "text-wrap",
	number: "list-numbers",
	boolean: "check",
	radio: "circle",
	checkboxes: "list",
	select: "chevron-down",
	multiselect: "list",
	pills: "tag",
};

/** The drag type a palette tile carries. */
export const PALETTE_DRAG = "question-kind";

/** The drag id of a palette tile. */
export const paletteDragId = (kind: IntakeFieldKind) => `kind:${kind}`;

/** The kind a palette drag id names, or `null`. */
export function kindOfDragId(id: unknown): IntakeFieldKind | null {
	const raw = String(id);
	if (!raw.startsWith("kind:")) return null;
	const kind = raw.slice(5) as IntakeFieldKind;
	return PALETTE_KINDS.includes(kind) ? kind : null;
}

function PaletteTile(
	props: { kind: IntakeFieldKind; disabled: boolean; onAdd: (kind: IntakeFieldKind) => void },
): JSX.Element {
	const drag = useDraggable({
		id: paletteDragId(props.kind),
		data: { type: PALETTE_DRAG },
		disabled: props.disabled,
		roleDescription: "question type",
	});
	const label = INTAKE_KIND_LABELS[props.kind];
	return (
		<li class="cat-qb__tile" data-dragging={drag.isDragging.value || undefined}>
			<button
				// deno-lint-ignore no-explicit-any
				ref={drag.setNodeRef as any}
				type="button"
				class="cat-qb__tile-button"
				disabled={props.disabled}
				aria-label={`Add a ${label.toLowerCase()} question`}
				onClick={() => props.onAdd(props.kind)}
				onPointerDown={drag.listeners.onPointerDown}
			>
				<Icon name={KIND_ICONS[props.kind]} size="sm" />
				<span class="cat-qb__tile-label">{label}</span>
			</button>
		</li>
	);
}

/**
 * QuestionPalette — the question types a seller drags onto the canvas, or presses to add at the
 * end, each with its glyph (Decision #525). Disabled once the list is full, and absent while the
 * questions are locked by publishing.
 */
export function QuestionPalette(
	props: { full: boolean; onAdd: (kind: IntakeFieldKind) => void },
): JSX.Element {
	return (
		<div class="cat-qb__palette">
			<h3 class="cat-qb__palette-head" id="cat-qb-palette-h">Question types</h3>
			<ul class="cat-qb__tiles" aria-labelledby="cat-qb-palette-h">
				{PALETTE_KINDS.map((kind) => (
					<PaletteTile key={kind} kind={kind} disabled={props.full} onAdd={props.onAdd} />
				))}
			</ul>
			<p class="cat-sec__hint">Drag a type onto the questions, or press it to add it at the end.</p>
		</div>
	);
}

/** The menu rows that add a question (or a follow-up) of each palette kind. */
export function kindMenu(onPick: (kind: IntakeFieldKind) => void): MenuItem[] {
	return PALETTE_KINDS.map((kind) => ({
		label: INTAKE_KIND_LABELS[kind],
		icon: KIND_ICONS[kind],
		command: () => onPick(kind),
	}));
}

/**
 * AddQuestionMenu — a text button that opens the type picker, for adding a question (or a
 * follow-up) where the palette is out of reach.
 */
export function AddQuestionMenu(
	props: { label: string; menuLabel: string; onPick: (kind: IntakeFieldKind) => void },
): JSX.Element {
	return (
		<ActionMenu
			model={kindMenu(props.onPick)}
			aria-label={props.menuLabel}
			placement="bottom-start"
			trigger={(api) => (
				<Button
					label={props.label}
					icon={<Icon name="plus" size="xs" />}
					variant="text"
					size="sm"
					triggerRef={api.ref as RefObject<HTMLButtonElement>}
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={api.toggle}
				/>
			)}
		/>
	);
}
