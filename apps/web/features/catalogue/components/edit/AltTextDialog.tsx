import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, Textarea } from "@projective/ui/fields";
import { FieldHead } from "./FieldHead.tsx";

const ALT_MAX = 200;
const FIELD_ID = "cat-media-alt";
const COUNT_ID = "cat-media-alt-count";
const HINT_ID = "cat-media-alt-hint";

/** Props for {@link AltTextDialog}. */
export interface AltTextDialogProps {
	/** The slot being described, or `null` when the dialog is closed. */
	position: Signal<number | null>;
	/** A slot's current description, read when the dialog opens on it. */
	altOf: (position: number) => string;
	/** Save the description; resolves whether it saved. */
	onSave: (position: number, alt: string) => Promise<boolean>;
}

/**
 * AltTextDialog — a small dialog for one showcase slot's alternative text (at most 200 characters,
 * counted live), read aloud to buyers who cannot see the picture. Saving keeps the dialog open
 * until the showcase write lands, and closes it only on success.
 */
export function AltTextDialog(props: AltTextDialogProps): JSX.Element {
	const open = useSignal(false);
	const text = useSignal("");
	const busy = useSignal(false);

	useSignalEffect(() => {
		const position = props.position.value;
		open.value = position !== null;
		if (position !== null) text.value = props.altOf(position);
	});

	const close = () => {
		props.position.value = null;
	};

	async function save(): Promise<void> {
		const position = props.position.peek();
		if (position === null || busy.peek()) return;
		busy.value = true;
		const ok = await props.onSave(position, text.peek().trim());
		busy.value = false;
		if (ok) close();
	}

	return (
		<Dialog
			visible={open}
			onVisibleChange={(v) => {
				if (!v) close();
			}}
			header={props.position.value === 1 ? "Describe the cover" : "Describe this item"}
			width="min(28rem, calc(100vw - 2rem))"
			footer={
				<div class="cat-sec__dialog-actions">
					<Button label="Cancel" severity="neutral" variant="outlined" onClick={close} />
					<Button label="Save" loading={busy.value} onClick={() => void save()} />
				</div>
			}
		>
			<div class="cat-sec__field">
				<FieldHead
					label="Alt text"
					htmlFor={FIELD_ID}
					hint="What the picture shows, for buyers using a screen reader. Leave it empty for a purely decorative image."
					hintId={HINT_ID}
				>
					<span class="cat-sec__count" id={COUNT_ID}>{text.value.length} / {ALT_MAX}</span>
				</FieldHead>
				<Textarea
					id={FIELD_ID}
					value={text}
					maxLength={ALT_MAX}
					rows={3}
					autoResize
					maxRows={6}
					aria-describedby={`${COUNT_ID} ${HINT_ID}`}
					fluid
				/>
			</div>
		</Dialog>
	);
}
