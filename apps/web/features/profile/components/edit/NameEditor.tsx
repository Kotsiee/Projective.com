import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { FormControl, InputText } from "@projective/ui/fields";
import type { ProfileEditModel, ProfileView } from "@projective/types/profile";
import { blockPatch } from "../../core/edit-model.ts";
import { saveOwnerPatch } from "../../core/owner-store.ts";
import { useBlockSave } from "../../hooks/useBlockSave.ts";
import { BlockForm } from "./OwnerBlock.tsx";

/**
 * NameEditor — the hero's name, edited in place (Decision #439): a person's first and last name, an
 * entity's one name. The handle is not here — it is an account setting, changed in Settings.
 */
export interface NameEditorProps {
	handle: string;
	profile: ProfileView;
	model: ProfileEditModel;
	close: () => void;
}

export function NameEditor({ handle, profile, model, close }: NameEditorProps): JSX.Element {
	const individual = model.ownerType === "user";
	const first = useSignal(model.firstName);
	const last = useSignal(model.lastName);
	const name = useSignal(model.name);
	const save = useBlockSave();
	const err = save.errors.value;
	const dirty = individual
		? first.value !== model.firstName || last.value !== model.lastName
		: name.value !== model.name;
	const change = () =>
		individual ? { firstName: first.peek(), lastName: last.peek() } : { name: name.peek() };

	return (
		<BlockForm
			label="Edit your name"
			guardId="basics"
			dirty={dirty}
			busy={save.busy.value}
			message={save.message.value}
			onCancel={close}
			onSave={() =>
				void save.run(() => saveOwnerPatch(handle, blockPatch(model, change()), profile), close)}
		>
			<div class="pf-edit__grid">
				{individual
					? (
						<>
							<FormControl
								label="First name"
								required
								error={err.firstName}
								status={err.firstName ? "invalid" : "default"}
							>
								{({ id, describedBy, status, required }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										status={status}
										required={required}
										value={first.value}
										maxLength={60}
										autoComplete="given-name"
										fluid
										onValueChange={(v) => (first.value = v)}
									/>
								)}
							</FormControl>
							<FormControl
								label="Last name"
								error={err.lastName}
								status={err.lastName ? "invalid" : "default"}
							>
								{({ id, describedBy, status }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										status={status}
										value={last.value}
										maxLength={60}
										autoComplete="family-name"
										fluid
										onValueChange={(v) => (last.value = v)}
									/>
								)}
							</FormControl>
						</>
					)
					: (
						<FormControl
							label="Name"
							required
							class="pf-edit__wide"
							error={err.name}
							status={err.name ? "invalid" : "default"}
						>
							{({ id, describedBy, status, required }) => (
								<InputText
									id={id}
									aria-describedby={describedBy}
									status={status}
									required={required}
									value={name.value}
									maxLength={80}
									fluid
									onValueChange={(v) => (name.value = v)}
								/>
							)}
						</FormControl>
					)}
			</div>
		</BlockForm>
	);
}
