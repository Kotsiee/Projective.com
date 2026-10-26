import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "../../../fields/components/Button.tsx";
import { Popover } from "../../../feedback/islands/Popover.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { useScheduler } from "./context.ts";
import type { Preset, PresetBinding, SchedulerTemplate } from "./types.ts";

// #region Props
/** Props for `AvailabilityScheduler.PresetBar`. */
export interface PresetBarProps {
	/** Starting points to load (their rules are copied with fresh ids). */
	templates?: readonly SchedulerTemplate[];
	/** The owner's library presets, loadable the same way. */
	presets?: readonly Preset[];
	/** The service binding line; omit outside a service. */
	binding?: PresetBinding;
	/** Save the current rules as a new library preset; the action renders only when supplied. */
	onSavePreset?: (draft: Preset) => void;
}
// #endregion

// #region Binding
/** The binding line: whose hours these are, with the actions the binding supplies. */
export function BindingLine({ binding }: { binding: PresetBinding }): JSX.Element {
	const linked = binding.mode === "linked";
	const actions = linked
		? [
			{ label: "Edit preset", run: binding.onEditPreset },
			{ label: "Override for this service", run: binding.onOverride },
		]
		: [
			{ label: `Revert to ${binding.presetName}`, run: binding.onRevert },
			{ label: "Save as preset", run: binding.onSaveAsPreset },
		];
	return (
		<p class="ui-avsched__binding">
			{linked
				? (
					<>
						Uses <strong class="ui-avsched__binding-name">{binding.presetName}</strong>
					</>
				)
				: "Custom for this service"}
			{actions.filter((a) => a.run).map((a) => (
				<span class="ui-avsched__binding-action" key={a.label}>
					<span aria-hidden="true">·</span>
					<Button variant="link" size="sm" label={a.label} onClick={a.run} />
				</span>
			))}
		</p>
	);
}
// #endregion

// #region PresetBar
/** The preset's name, the binding line, and the load-a-starting-point menu (plan §5.5). */
export function PresetBar(props: PresetBarProps): JSX.Element {
	const { templates = [], presets = [], binding, onSavePreset } = props;
	const { store } = useScheduler();
	const menuOpen = useSignal(false);
	const draft = store.draft.value;
	const sources: { heading: string; items: SchedulerTemplate[] }[] = [
		{ heading: "Templates", items: [...templates] },
		{
			heading: "Your presets",
			items: presets.filter((p) => p.id !== draft.id && !p.archivedAt).map((p) => ({
				key: p.id,
				name: p.name,
				description: p.description,
				rules: p.rules,
			})),
		},
	].filter((s) => s.items.length);

	return (
		<div class="ui-avsched__presetbar">
			<div class="ui-avsched__identity">
				<h3 class="ui-avsched__title">{draft.name}</h3>
				{binding && <BindingLine binding={binding} />}
			</div>
			<div class="ui-avsched__presetbar-actions">
				{sources.length > 0 && (
					<Popover
						open={menuOpen}
						label="Start from a template or preset"
						placement="bottom-end"
						trigger={(api) => (
							<button
								ref={api.ref as RefObject<HTMLButtonElement>}
								type="button"
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
								aria-haspopup="dialog"
								aria-expanded={api.expanded}
								aria-controls={api.panelId}
								onClick={api.toggle}
							>
								<span class="ui-button__icon">
									<Icon name="list" />
								</span>
								<span class="ui-button__label">Start from…</span>
							</button>
						)}
					>
						{sources.map((source) => (
							<div class="ui-avsched__menu" key={source.heading}>
								<p class="ui-avsched__heading">{source.heading}</p>
								<ul class="ui-avsched__menu-list">
									{source.items.map((item) => (
										<li key={item.key}>
											<button
												type="button"
												class="ui-avsched__menu-item"
												onClick={() => {
													store.loadTemplate(item);
													menuOpen.value = false;
												}}
											>
												<span class="ui-avsched__menu-name">{item.name}</span>
												{item.description && (
													<span class="ui-avsched__menu-meta">{item.description}</span>
												)}
											</button>
										</li>
									))}
								</ul>
							</div>
						))}
					</Popover>
				)}
				{onSavePreset && (
					<Button
						severity="neutral"
						variant="outlined"
						size="sm"
						label="Save as preset"
						onClick={() => onSavePreset(store.draft.peek())}
					/>
				)}
			</div>
		</div>
	);
}
// #endregion
