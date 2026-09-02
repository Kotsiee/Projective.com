import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import { uploadForProject } from "../../core/upload.ts";

/**
 * AttachmentField — device files in, `files.items` ids out, for the two wizard controls that carry a
 * document rather than a value: the brief's reference material and a custom NDA.
 *
 * It drives the SAME three-step handshake every other attachment surface in this feature uses
 * ({@link uploadForProject}: `upload-init` → PUT at the signed URL → `upload-complete`), so bytes
 * never transit an application route and the wizard's payload only ever carries identifiers. There
 * is deliberately no second implementation of that handshake here.
 *
 * **The name lives only in this component.** The payload carries ids, which is the right thing to
 * send and the wrong thing to render — "attached: 9f3c…" tells the author nothing about which file
 * they picked. The chip list is therefore local, seeded from the ids it is given and kept in step by
 * being the only thing that writes them. A create wizard is a fresh page every time, so an id whose
 * name this component never saw does not arise in practice; one that did would render as a generic
 * attachment rather than as a broken row.
 *
 * **A failure is reported, never swallowed.** A file that does not land keeps its name on screen
 * with the reason beside it, because an attachment that silently disappears leaves a brief that
 * looks complete and is missing the thing it was written about.
 */

// #region Shapes
/** One attachment, as the author sees it. */
interface Attachment {
	/** The `files.items` id the payload carries. */
	id: string;
	/** The device file's own name. */
	name: string;
}

export interface AttachmentFieldProps {
	/** The asset ids currently attached. */
	ids: readonly string[];
	/** Fired with the new id list whenever one lands or is removed. */
	onChange: (ids: string[]) => void;
	/** The library uploads are filed in — the acting user's id. */
	ownerId: string | null;
	/** How many may be attached at once. */
	max: number;
	/** Accept filter for the file dialog (e.g. `.pdf,.doc,.docx`). */
	accept?: string;
	/** The button's own words. */
	label: string;
	/** Wired from the field wrapper, so the label points at a real focusable element. */
	id?: string;
	"aria-describedby"?: string;
}
// #endregion

// #region The control
export function AttachmentField(props: AttachmentFieldProps): JSX.Element {
	const inputRef = useRef<HTMLInputElement>(null);
	const attached = useSignal<Attachment[]>([]);
	const uploading = useSignal<string[]>([]);
	const failures = useSignal<string[]>([]);

	// The ids the draft holds are authoritative for the payload; this list is authoritative for the
	// names. A removal from elsewhere therefore drops the chip too, rather than leaving one behind.
	const known = attached.value.filter((item) => props.ids.includes(item.id));
	const unnamed = props.ids.filter((id) => !known.some((item) => item.id === id));
	const rows: Attachment[] = [
		...known,
		...unnamed.map((id) => ({ id, name: "Attachment" })),
	];

	const remaining = Math.max(0, props.max - rows.length);
	const busy = uploading.value.length > 0;

	async function take(files: File[]): Promise<void> {
		if (files.length === 0) return;
		if (!props.ownerId) {
			failures.value = [
				"We could not tell whose library to file these in — sign in again and retry.",
			];
			return;
		}
		const accepted = files.slice(0, remaining);
		const rejected = files.slice(remaining);
		uploading.value = accepted.map((file) => file.name);
		failures.value = rejected.map((file) =>
			`${file.name} — only ${props.max} attachments are allowed.`
		);

		const outcome = await uploadForProject(accepted, {
			ownerType: "user",
			ownerId: props.ownerId,
			// Runs alongside the transfer, so a poster frame never delays the bytes.
			metadataFor: extractMetadata,
		});

		// `assetIds` is written positionally and then compacted, so it holds the files that landed in
		// the order they were offered — matching them back by index would relabel the wrong ones.
		const landed = accepted
			.filter((_file, index) => !outcome.failures.some((failure) => failure.index === index))
			.map((file, position) => ({ id: outcome.assetIds[position], name: file.name }))
			.filter((item): item is Attachment => typeof item.id === "string");

		uploading.value = [];
		failures.value = [
			...failures.value,
			...outcome.failures.map((failure) => `${failure.name} — ${failure.message}`),
		];
		attached.value = [...attached.value, ...landed];
		props.onChange([...props.ids, ...landed.map((item) => item.id)]);
	}

	function drop(id: string): void {
		attached.value = attached.value.filter((item) => item.id !== id);
		props.onChange(props.ids.filter((existing) => existing !== id));
	}

	return (
		<div class="pwz-attach">
			<input
				ref={inputRef}
				class="pwz-attach__input"
				type="file"
				multiple={props.max > 1}
				accept={props.accept}
				tabIndex={-1}
				aria-hidden="true"
				onChange={(event) => {
					const input = event.currentTarget;
					void take(Array.from(input.files ?? []));
					// Cleared so picking the same file twice still fires a change event.
					input.value = "";
				}}
			/>

			<button
				type="button"
				id={props.id}
				class="pwz-attach__pick"
				aria-describedby={props["aria-describedby"]}
				disabled={remaining === 0 || busy}
				onClick={() => inputRef.current?.click()}
			>
				<Icon name="upload" size="sm" />
				{busy ? "Uploading…" : props.label}
			</button>

			{rows.length > 0 && (
				<ul class="pwz-attach__list">
					{rows.map((item) => (
						<li key={item.id} class="pwz-attach__item">
							<Icon name="document" size="sm" />
							<span class="pwz-attach__name">{item.name}</span>
							<button
								type="button"
								class="pwz-attach__drop"
								aria-label={`Remove ${item.name}`}
								onClick={() => drop(item.id)}
							>
								<Icon name="close" size="xs" />
							</button>
						</li>
					))}
				</ul>
			)}

			{uploading.value.map((name) => (
				<p key={name} class="pwz-attach__status" role="status">Uploading {name}…</p>
			))}

			{failures.value.length > 0 && (
				<ul class="pwz-attach__failures" role="alert">
					{failures.value.map((message) => <li key={message}>{message}</li>)}
				</ul>
			)}

			{remaining === 0 && rows.length > 0 && (
				<p class="pwz-attach__status">
					{props.max === 1 ? "One document attached." : `All ${props.max} attachments used.`}
				</p>
			)}
		</div>
	);
}
// #endregion
