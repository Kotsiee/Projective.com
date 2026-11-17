import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
	Button,
	Chips,
	FormControl,
	InputText,
	Select,
	Textarea,
	ToggleSwitch,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { PROFILE_LIMITS, type ProfileEditModel, type ProfileView } from "@projective/types/profile";
import { type OwnerAvailability, SaveOwnerAvailabilitySchema } from "@projective/types/scheduling";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { calendarModeHref } from "@features/calendar/core/availability-view.ts";
import {
	blockPatch,
	draftOf,
	errorFor,
	errorsFromIssues,
	type Keyed,
} from "../../core/edit-model.ts";
import { refreshOwnerView, saveOwnerPatch } from "../../core/owner-store.ts";
import { ProfileService } from "../../core/ProfileService.ts";
import { weekHours } from "../../core/availability-model.ts";
import { timeZoneOptions } from "../../core/time-zones.ts";
import { useBlockSave } from "../../hooks/useBlockSave.ts";
import { BlockForm } from "./OwnerBlock.tsx";
import { LanguagesEditor } from "./ListEditors.tsx";
import type { LanguageEdit } from "@projective/types/profile";

/**
 * ContextEditors — the inline editors of the context bar's blocks on the owner's `/[handle]`
 * (Decision #439). Each edits one block's fields as a draft, sends only what changed through
 * `org.save_profile` (the availability block through `scheduling.save_owner_availability`), and
 * closes on success so the block redraws from what is now stored.
 */

interface EditorProps {
	handle: string;
	profile: ProfileView;
	close: () => void;
}

interface ModelEditorProps extends EditorProps {
	model: ProfileEditModel;
}

function status(error: string | undefined): "invalid" | "default" {
	return error ? "invalid" : "default";
}

// #region About
/** The headline over the story. */
export function AboutEditor({ handle, profile, model, close }: ModelEditorProps): JSX.Element {
	const headline = useSignal(model.headline);
	const story = useSignal(model.story);
	const save = useBlockSave();
	const err = save.errors.value;
	const dirty = headline.value !== model.headline || story.value !== model.story;

	return (
		<BlockForm
			label="Edit your headline and story"
			guardId="about"
			dirty={dirty}
			busy={save.busy.value}
			message={save.message.value}
			onCancel={close}
			onSave={() =>
				void save.run(
					() =>
						saveOwnerPatch(
							handle,
							blockPatch(model, { headline: headline.peek(), story: story.peek() }),
							profile,
						),
					close,
				)}
		>
			<FormControl
				label="Headline"
				note={`${headline.value.length} / ${PROFILE_LIMITS.headline}`}
				error={err.headline}
				status={status(err.headline)}
			>
				{({ id, describedBy, status: s }) => (
					<InputText
						id={id}
						aria-describedby={describedBy}
						status={s}
						value={headline.value}
						maxLength={PROFILE_LIMITS.headline}
						placeholder="Brand designer for early-stage product teams"
						fluid
						onValueChange={(v) => (headline.value = v)}
					/>
				)}
			</FormControl>
			<FormControl
				label="Your story"
				note={`${story.value.length} / ${PROFILE_LIMITS.story}`}
				error={err.story}
				status={status(err.story)}
			>
				{({ id, describedBy, status: s }) => (
					<Textarea
						id={id}
						aria-describedby={describedBy}
						status={s}
						value={story.value}
						maxLength={PROFILE_LIMITS.story}
						rows={6}
						autoResize
						maxRows={20}
						fluid
						onValueChange={(v) => (story.value = v)}
					/>
				)}
			</FormControl>
		</BlockForm>
	);
}
// #endregion

// #region Location
/** Where the profile is based — and, for a person, the time zone their local clock reads in. */
export function LocationEditor({ handle, profile, model, close }: ModelEditorProps): JSX.Element {
	const city = useSignal(model.city);
	const country = useSignal(model.country);
	const timezone = useSignal(model.timezone);
	const zones = useSignal(timeZoneOptions());
	const individual = model.ownerType === "user";
	const save = useBlockSave();
	const err = save.errors.value;
	const dirty = city.value !== model.city || country.value !== model.country ||
		(individual && timezone.value !== model.timezone);

	return (
		<BlockForm
			label="Edit where you're based"
			guardId="location"
			dirty={dirty}
			busy={save.busy.value}
			message={save.message.value}
			onCancel={close}
			aside={
				<Button
					variant="text"
					class="pf-edit__ghost"
					aria-haspopup="dialog"
					onClick={() => openSettings("profile", "local-time")}
				>
					Display settings
				</Button>
			}
			onSave={() =>
				void save.run(
					() =>
						saveOwnerPatch(
							handle,
							blockPatch(model, {
								city: city.peek(),
								country: country.peek(),
								timezone: individual ? timezone.peek() : model.timezone,
							}),
							profile,
						),
					close,
				)}
		>
			<div class="pf-edit__grid">
				<FormControl label="City" error={err.city} status={status(err.city)}>
					{({ id, describedBy, status: s }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							status={s}
							value={city.value}
							maxLength={80}
							autoComplete="address-level2"
							fluid
							onValueChange={(v) => (city.value = v)}
						/>
					)}
				</FormControl>
				<FormControl label="Country" error={err.country} status={status(err.country)}>
					{({ id, describedBy, status: s }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							status={s}
							value={country.value}
							maxLength={80}
							autoComplete="country-name"
							fluid
							onValueChange={(v) => (country.value = v)}
						/>
					)}
				</FormControl>
				{individual && (
					<FormControl
						label="Time zone"
						class="pf-edit__wide"
						error={err.timezone}
						status={status(err.timezone)}
					>
						{({ id, describedBy, status: s }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								status={s}
								options={zones.value}
								value={timezone.value}
								filter
								placeholder="Choose your time zone"
								fluid
								onValueChange={(v) => (timezone.value = v)}
							/>
						)}
					</FormControl>
				)}
			</div>
		</BlockForm>
	);
}
// #endregion

// #region Availability
interface AvailabilityEditorProps extends EditorProps {
	/** The weekday the owner's week starts on, 0 = Sunday — only the summary's reading order. */
	weekStartsOn: number;
}

/**
 * Whether the hours show on the profile, and the time zone they are kept in. The hours themselves
 * are the default availability template's, edited on `/calendar?view=availability` (Decision #408),
 * so this never writes them; the call terms are Settings → Scheduling's.
 */
export function AvailabilityEditor(
	{ handle, profile, close, weekStartsOn }: AvailabilityEditorProps,
): JSX.Element {
	const loaded = useSignal<OwnerAvailability | null>(null);
	const takesCalls = useSignal(false);
	const failed = useSignal(false);
	const timezone = useSignal("");
	const published = useSignal(false);
	const zones = useSignal(timeZoneOptions());
	const save = useBlockSave();

	useEffect(() => {
		let live = true;
		void ProfileService.availability(handle).then((res) => {
			if (!live) return;
			if (!res.ok || !res.data) {
				failed.value = true;
				return;
			}
			loaded.value = res.data.availability;
			takesCalls.value = res.data.takesCalls;
			timezone.value = res.data.availability.timezone;
			published.value = res.data.availability.published;
		});
		return () => {
			live = false;
		};
	}, [handle]);

	const current = loaded.value;
	const dirty = !!current &&
		(timezone.value !== current.timezone || published.value !== current.published);
	const hours = current ? weekHours(current.bands, weekStartsOn) : [];
	const message = failed.value
		? "Your schedule can't be loaded right now. Try again in a moment."
		: save.message.value;

	async function send() {
		const base = loaded.peek();
		if (!base) {
			return { ok: false as const, message: "Your schedule isn't loaded yet.", errors: {} };
		}
		const parsed = SaveOwnerAvailabilitySchema.safeParse({
			timezone: timezone.peek(),
			published: published.peek(),
			call: base.call,
		});
		if (!parsed.success) {
			const errors = errorsFromIssues(parsed.error.issues);
			return {
				ok: false as const,
				message: Object.values(errors)[0] ?? "Check these settings.",
				errors,
			};
		}
		const res = await ProfileService.saveAvailability(handle, parsed.data);
		if (!res.ok || !res.data) {
			return {
				ok: false as const,
				message: res.message ?? "Your availability couldn't be saved.",
				errors: res.errors ?? {},
			};
		}
		await refreshOwnerView(handle, profile);
		return { ok: true as const };
	}

	return (
		<BlockForm
			label="Edit your availability"
			guardId="availability"
			dirty={dirty}
			busy={save.busy.value}
			message={message}
			onCancel={close}
			aside={takesCalls.value && (
				<Button
					variant="text"
					class="pf-edit__ghost"
					aria-haspopup="dialog"
					onClick={() => openSettings("scheduling", "calls")}
				>
					Call settings
				</Button>
			)}
			onSave={() => void save.run(send, close)}
		>
			{!current && !failed.value && <p class="pf-edit__hint">Loading your schedule…</p>}
			{current && (
				<>
					<ToggleSwitch
						value={published.value}
						label="Show my hours on my profile"
						onValueChange={(on) => (published.value = on)}
					/>
					<FormControl
						label="Time zone your hours are kept in"
						error={save.errors.value.timezone}
						status={status(save.errors.value.timezone)}
					>
						{({ id, describedBy, status: s }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								status={s}
								options={zones.value}
								value={timezone.value}
								filter
								fluid
								onValueChange={(v) => (timezone.value = v)}
							/>
						)}
					</FormControl>
					{hours.length
						? (
							<ul class="pf-hours" role="list" aria-label="Your weekly hours">
								{hours.map((line) => (
									<li key={line.days} class="pf-hours__line">
										<span class="pf-hours__days">{line.days}</span>
										<span class="pf-hours__times">{line.times}</span>
									</li>
								))}
							</ul>
						)
						: <p class="pf-edit__hint">No working hours yet.</p>}
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm pf-edit__calendarlink"
						href={calendarModeHref("availability")}
						data-icon-pos="right"
					>
						<span class="ui-button__label">Edit working hours on your calendar</span>
						<span class="ui-button__icon" aria-hidden="true">
							<Icon name="arrow-right" size="sm" />
						</span>
					</a>
				</>
			)}
		</BlockForm>
	);
}
// #endregion

// #region Skills
/** Up to fifteen skills, seeded from the names visitors read (the door maps them back to slugs). */
export function SkillsEditor({ handle, profile, close }: EditorProps): JSX.Element {
	const initial = profile.skills.map((s) => s.label);
	const skills = useSignal<string[]>(initial);
	const save = useBlockSave();
	const err = errorFor(save.errors.value, "skills");
	const dirty = JSON.stringify(skills.value) !== JSON.stringify(initial);

	return (
		<BlockForm
			label="Edit your skills"
			guardId="skills"
			dirty={dirty}
			busy={save.busy.value}
			message={save.message.value}
			onCancel={close}
			onSave={() =>
				void save.run(
					() =>
						saveOwnerPatch(
							handle,
							{ skills: skills.peek().map((s) => s.trim()).filter((s) => s.length > 0) },
							profile,
						),
					close,
				)}
		>
			<FormControl
				label="Skills"
				note={`${skills.value.length} / ${PROFILE_LIMITS.skills}`}
				error={err}
				status={status(err)}
			>
				{({ id, describedBy, status: s }) => (
					<Chips
						id={id}
						aria-describedby={describedBy}
						status={s}
						value={skills.value}
						max={PROFILE_LIMITS.skills}
						placeholder="Add a skill and press Enter"
						addOnBlur
						fluid
						onValueChange={(v) => (skills.value = v)}
					/>
				)}
			</FormControl>
		</BlockForm>
	);
}
// #endregion

// #region Languages
/** The languages the profile works in, and how well. */
export function LanguagesBlockEditor(
	{ handle, profile, model, close }: ModelEditorProps,
): JSX.Element {
	const initial = draftOf(model).languages;
	const rows = useSignal<Keyed<LanguageEdit>[]>(initial);
	const save = useBlockSave();
	const patch = () => blockPatch(model, { languages: rows.peek() });
	const dirty = Object.keys(blockPatch(model, { languages: rows.value })).length > 0;

	return (
		<BlockForm
			label="Edit your languages"
			guardId="languages"
			dirty={dirty}
			busy={save.busy.value}
			message={save.message.value}
			onCancel={close}
			onSave={() => void save.run(() => saveOwnerPatch(handle, patch(), profile), close)}
		>
			<LanguagesEditor
				rows={rows.value}
				errors={save.errors.value}
				onChange={(next) => (rows.value = next)}
			/>
		</BlockForm>
	);
}
// #endregion
