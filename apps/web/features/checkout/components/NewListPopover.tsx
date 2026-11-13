import type { JSX, VNode } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { CreateBasketListSchema } from "@projective/types/finance";
import { Popover, type PopoverTriggerApi } from "@projective/ui/feedback";
import { Button, FormControl, InputText } from "@projective/ui/fields";

// #region Props
/** Props for {@link NewListPopover}. */
export interface NewListPopoverProps {
	/** Open state; the host opens it from its "New list" action. */
	open: Signal<boolean>;
	/** The anchor the panel hangs from (`bottom-end`); wire `api.ref` onto it. */
	trigger: (api: PopoverTriggerApi) => VNode;
	/**
	 * Create the list and open it. Resolves to `null` on success, or to the sentence to show under the
	 * field when the list could not be made — the popover then stays open with the name kept.
	 */
	onCreate: (name: string) => Promise<string | null>;
}
// #endregion

const NAME_MAX = 120;

/**
 * NewListPopover — names a new list (a non-default `finance.baskets` row, Decision #70) in a small
 * anchored `Popover`, never a centred dialog: it opens from the basket drawer's switcher, the checkout
 * header band's switcher and the `/checkout` lane, and a second scrim stacked over the drawer is what
 * DESIGN_SYSTEM §B.10 forbids. The panel portals to the body above the drawer's layer (`BodyPortal`
 * + the overlay stack). Focus lands in the name field; Enter submits; Create list is disabled until
 * the name is valid by the SSOT's own rule (`CreateBasketListSchema`), and stays focusable while the
 * write is in flight. Create list is the tier-2 structural fill (§B.8.1: a create commits to structure,
 * not money). The host owns the write and what opens afterwards.
 */
export function NewListPopover(props: NewListPopoverProps): JSX.Element {
	const { open, trigger, onCreate } = props;
	const name = useSignal("");
	const creating = useSignal(false);
	const failure = useSignal<string | null>(null);
	const fieldScope = useRef<HTMLDivElement>(null);
	const valid = CreateBasketListSchema.shape.name.safeParse(name.value).success;

	const reset = () => {
		name.value = "";
		failure.value = null;
	};

	const submit = async (event: Event) => {
		event.preventDefault();
		if (!valid || creating.peek()) return;
		creating.value = true;
		failure.value = null;
		const refused = await onCreate(name.value.trim());
		creating.value = false;
		if (refused) {
			failure.value = refused;
			return;
		}
		reset();
		open.value = false;
	};

	return (
		<Popover
			open={open}
			trigger={trigger}
			label="Create new list"
			placement="bottom-end"
			initialFocusRef={fieldScope}
			class="bsk-newlist"
			onOpenChange={(isOpen) => {
				if (!isOpen) reset();
			}}
		>
			<form class="bsk-newlist__form" noValidate onSubmit={(event) => void submit(event)}>
				<FormControl
					label="List name"
					error={failure.value ?? undefined}
					status={failure.value ? "invalid" : undefined}
					collapseHint
				>
					{(field) => (
						<div ref={fieldScope}>
							<InputText
								id={field.id}
								aria-describedby={field.describedBy}
								status={field.status}
								value={name}
								placeholder="e.g. 3D assets"
								autoComplete="off"
								maxLength={NAME_MAX}
								enterKeyHint="done"
								fluid
							/>
						</div>
					)}
				</FormControl>
				<div class="bsk-newlist__actions">
					<Button
						variant="text"
						severity="secondary"
						label="Cancel"
						onClick={() => (open.value = false)}
					/>
					<Button
						type="submit"
						variant="filled"
						structural
						label="Create list"
						disabled={!valid}
						aria-busy={creating.value ? "true" : undefined}
					/>
				</div>
			</form>
		</Popover>
	);
}
