import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, InputText } from "@projective/ui/fields";
import type { WorkspaceDetail } from "@projective/types/workspace";
import { WorkspaceService } from "../../core/WorkspaceService.ts";
import { channelHref, channelNameFrom, channelNameRefusal } from "../../core/channel-model.ts";

const FORM_ID = "wsp-channel-create";

/** Props for {@link ChannelCreateDialog}. */
export interface ChannelCreateDialogProps {
	workspace: WorkspaceDetail;
	visible: Signal<boolean>;
	/** `/teams/:h/channels` — where the new channel opens once it exists. */
	base: string;
}

/**
 * ChannelCreateDialog — the Channels section's "New channel": a name (folded to the channel's address
 * as it is typed, and shown as `# name`) and an optional topic. Create is the dialog's one structural
 * fill (§B.8.1 tier 2); a refusal is said in place and changes nothing. A created channel opens, so the
 * press lands somewhere real.
 */
export function ChannelCreateDialog(props: ChannelCreateDialogProps): JSX.Element {
	const ws = props.workspace;
	const name = useSignal("");
	const topic = useSignal("");
	const busy = useSignal(false);
	const touched = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const nameRef = useRef<HTMLDivElement>(null);

	const slug = channelNameFrom(name.value);
	const problem = channelNameRefusal(slug, ws.channels);

	function close(): void {
		props.visible.value = false;
		name.value = "";
		topic.value = "";
		touched.value = false;
		refusal.value = null;
	}

	async function submit(): Promise<void> {
		touched.value = true;
		if (problem || busy.value) return;
		busy.value = true;
		refusal.value = null;
		const res = await WorkspaceService.createChannel({
			kind: ws.kind,
			id: ws.id,
			name: slug,
			topic: topic.value.trim() || undefined,
		});
		busy.value = false;
		if (!res.ok) {
			refusal.value = res.message ?? "The channel couldn't be created. Nothing was changed.";
			return;
		}
		globalThis.location.assign(channelHref(props.base, slug));
	}

	return (
		<Dialog
			visible={props.visible}
			header="New channel"
			modal
			width="28rem"
			initialFocusRef={nameRef}
			onVisibleChange={(open) => {
				if (!open) close();
			}}
			footer={
				<div class="wsp-dialog__actions">
					<Button severity="secondary" variant="text" size="sm" label="Cancel" onClick={close} />
					<Button
						structural
						size="sm"
						type="submit"
						form={FORM_ID}
						label={busy.value ? "Creating…" : "Create channel"}
						loading={busy.value}
					/>
				</div>
			}
		>
			<form
				id={FORM_ID}
				class="wsp-dialog"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div ref={nameRef} class="wsp-dialog__field">
					<FormControl
						label="Name"
						required
						hintMode="inline"
						hint={slug ? `Opens as # ${slug}` : `Everyone in ${ws.name} is in every channel.`}
						error={touched.value && problem ? problem : undefined}
					>
						{({ id, describedBy, required }) => (
							<InputText
								id={id}
								aria-describedby={describedBy}
								required={required}
								value={name}
								onValueChange={() => (refusal.value = null)}
								onBlur={() => (touched.value = true)}
								start="#"
								placeholder="delivery-sync"
								maxLength={60}
								autoCapitalize="none"
								spellcheck={false}
								autoComplete="off"
								block
							/>
						)}
					</FormControl>
				</div>
				<FormControl label="Topic" hint="What the channel is for — optional.">
					{({ id, describedBy }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							value={topic}
							placeholder="Handoffs between design and build"
							maxLength={200}
							block
						/>
					)}
				</FormControl>
				{refusal.value && <InlineNotice align="start" assertive text={refusal.value} />}
			</form>
		</Dialog>
	);
}
