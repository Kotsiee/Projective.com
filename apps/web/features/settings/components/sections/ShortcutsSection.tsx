import type { JSX } from "preact";
import { useContext, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { InputText, ToggleSwitch } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Kbd } from "@projective/ui/utils";
import type { ResolvedUiSettings, ToggleableShortcutId } from "@projective/types/org";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import {
	filterShortcuts,
	SHORTCUT_CATEGORIES,
	type ShortcutDefinition,
	shortcutKeys,
} from "@features/shortcuts/core/shortcut-registry.ts";
import { isApplePlatform } from "@features/projects/core/chat-keyboard.ts";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
	SettingsRow,
	SettingsSurfaceContext,
	useSynced,
} from "../SettingsParts.tsx";
import {
	commitShortcutPrefs,
	currentShortcutPrefs,
	paintShortcutPrefs,
} from "../../core/shortcuts-state.ts";
import { sectionMeta } from "../../core/settings-registry.ts";
import "../../styles/settings-shortcuts.css";

/**
 * Settings → Keyboard shortcuts (Decision #371): whether tooltips show a control's shortcut, and the
 * registry of every platform shortcut with a switch per shortcut a person may turn off. A protected
 * shortcut shows its lock and the reason instead of a switch. Every change applies on THIS device in
 * the same frame (the `<html>` attributes every listener reads), then the cookie, then the account.
 */

export interface ShortcutsSectionProps {
	data: SettingsSectionDataOf<"shortcuts">;
}

export function ShortcutsSection(props: ShortcutsSectionProps): JSX.Element {
	const meta = sectionMeta("shortcuts");
	const { mode } = useContext(SettingsSurfaceContext);
	const prefs = useSignal<ResolvedUiSettings>(props.data.uiSettings);
	const status = useSignal<SaveState>(IDLE);
	const query = useSignal("");
	const apple = useSignal(false);

	// The account copy is authoritative across devices: adopt it when this device differs.
	useEffect(() => {
		apple.value = isApplePlatform();
		const device = currentShortcutPrefs();
		const next = props.data.live ? props.data.uiSettings : device;
		if (JSON.stringify(device) !== JSON.stringify(next)) paintShortcutPrefs(next);
		prefs.value = next;
	}, [props.data]);

	async function change(next: ResolvedUiSettings): Promise<void> {
		prefs.value = next;
		status.value = { tone: "busy", text: "Saving…" };
		const res = await commitShortcutPrefs(next);
		prefs.value = res.prefs;
		status.value = res.saved === "account"
			? { tone: "saved", text: "Saved to your account." }
			: res.saved === "device"
			? { tone: "device", text: "Saved on this device. We couldn't reach your account just now." }
			: {
				tone: "error",
				text: `Applied on this device only — ${res.message ?? "your account couldn't be updated."}`,
			};
	}

	function toggle(id: ToggleableShortcutId, on: boolean): void {
		const others = prefs.value.disabled_shortcuts.filter((off) => off !== id);
		void change({ ...prefs.value, disabled_shortcuts: on ? others : [...others, id].sort() });
	}

	const tips = useSynced(prefs.value.show_tooltip_shortcuts);
	const q = query.value.trim();
	const shown = filterShortcuts(q);
	const GroupTag = mode === "page" ? "h3" : "h5";
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock anchor="tooltip-shortcuts" title="Tooltips">
				<SettingsRow
					label="Show keyboard shortcuts in tooltips"
					descId="stg-tips-desc"
					description="Adds the keys beside a button's name when you hover or focus it."
					control={
						<ToggleSwitch
							value={tips}
							aria-label="Show keyboard shortcuts in tooltips"
							aria-describedby="stg-tips-desc"
							onValueChange={(on) => change({ ...prefs.value, show_tooltip_shortcuts: on })}
						/>
					}
				/>
			</SettingsBlock>

			<SettingsBlock
				anchor="shortcut-list"
				title="Shortcuts"
				description="Turn off a shortcut you press by accident or that clashes with your tools. System shortcuts always work."
			>
				<div class="stg-keys__search" role="search">
					<InputText
						type="search"
						value={query}
						placeholder="Search shortcuts"
						aria-label="Search shortcuts"
						fluid
						start={<Icon name="search" size="sm" />}
						onValueChange={(value: string) => (query.value = value)}
					/>
				</div>
				<p class="ui-visually-hidden" role="status">
					{q
						? `${shown.length} ${shown.length === 1 ? "shortcut matches" : "shortcuts match"}`
						: ""}
				</p>
				{SHORTCUT_CATEGORIES.map((category) => {
					const rows = shown.filter((s) => s.category === category);
					if (!rows.length) return null;
					const id = `stg-keys-${category.toLowerCase().replace(/\s+/g, "-")}`;
					return (
						<div key={category} class="stg-keys__group" role="group" aria-labelledby={id}>
							<GroupTag id={id} class="stg-keys__group-title">{category}</GroupTag>
							{rows.map((shortcut) => (
								<ShortcutRow
									key={shortcut.id}
									shortcut={shortcut}
									apple={apple.value}
									on={!prefs.value.disabled_shortcuts.includes(
										shortcut.id as ToggleableShortcutId,
									)}
									onToggle={(on) => toggle(shortcut.id as ToggleableShortcutId, on)}
								/>
							))}
						</div>
					);
				})}
				{shown.length === 0 ? <p class="stg-note">No shortcut matches “{q}”.</p> : null}
			</SettingsBlock>

			<SaveStatus state={status.value} />
		</div>
	);
}

/** One shortcut: its name and what it does, its keys, then its switch — or its lock when protected. */
function ShortcutRow(
	props: {
		shortcut: ShortcutDefinition;
		apple: boolean;
		on: boolean;
		onToggle: (on: boolean) => void;
	},
): JSX.Element {
	const { shortcut } = props;
	const value = useSynced(props.on);
	const descId = `stg-key-${shortcut.id}-desc`;
	return (
		<SettingsRow
			label={shortcut.label}
			descId={descId}
			description={shortcut.description}
			control={
				<span class="stg-keys__control">
					<Kbd
						keys={shortcutKeys(shortcut, props.apple)}
						separator={shortcut.sequence ? "then" : "+"}
						size="sm"
					/>
					{shortcut.isProtected
						? (
							<Tooltip content="System shortcut cannot be disabled">
								<span
									class="stg-keys__lock"
									role="img"
									aria-label={`${shortcut.label} is always on: a system shortcut`}
								>
									<Icon name="lock" size="sm" />
								</span>
							</Tooltip>
						)
						: (
							<ToggleSwitch
								value={value}
								aria-label={shortcut.label}
								aria-describedby={descId}
								onValueChange={props.onToggle}
							/>
						)}
				</span>
			}
		/>
	);
}
