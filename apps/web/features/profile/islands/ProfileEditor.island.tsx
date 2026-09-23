import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	Button,
	Chips,
	FormControl,
	InputText,
	Select,
	SelectButton,
	Textarea,
	ToggleSwitch,
} from "@projective/ui/fields";
import {
	PROFILE_LIMITS,
	type ProfileEditModel,
	ProfileSavePatchSchema,
	type ProfileVisibility,
} from "@projective/types/profile";
import "../styles/profile.css";
import { EditSection } from "../components/edit/EditSection.tsx";
import { MediaSection } from "../components/edit/MediaSection.tsx";
import {
	CertificationsEditor,
	EducationEditor,
	ExperienceEditor,
	LanguagesEditor,
} from "../components/edit/ListEditors.tsx";
import {
	draftOf,
	type EditDraft,
	errorFor,
	errorsFromIssues,
	isDirty,
	patchOf,
	withSavedIds,
} from "../core/edit-model.ts";
import { ProfileService } from "../core/ProfileService.ts";

/**
 * ProfileEditor — the owner's **Edit profile & settings** page (`/[handle]/edit`): the profile as a
 * vertical stack of collapsible sections, each field a persistently editable input in the order the
 * public page shows it, and the privacy switches at the end.
 *
 * # One draft, one Save
 *
 * Every text and list field edits ONE draft; the sticky save bar (and Ctrl ⁄ ⌘ + S) sends only what
 * changed (`core/edit-model.ts` `patchOf`), checked first against the same Zod patch schema the
 * route checks, so a refusal is pinned to its field before anything travels. Discard returns every
 * field to what was last saved. Leaving the page with unsaved changes asks first.
 *
 * Media is the exception — the photo and the showcase save the moment they are applied
 * ({@link MediaSection}), because applying a picture already makes a public rendition on the server.
 */
export interface ProfileEditorProps {
	model: ProfileEditModel;
	/** The signed-in owner's user id — whose account avatar a new photo updates. */
	userId: string;
}

const VISIBILITY_OPTIONS: Array<{ label: string; value: ProfileVisibility }> = [
	{ label: "Public", value: "public" },
	{ label: "Unlisted", value: "unlisted" },
	{ label: "Private", value: "private" },
];

const VISIBILITY_NOTE: Record<ProfileVisibility, string> = {
	public: "Anyone can find your profile in search and on Explore.",
	unlisted: "Anyone with the link can open your profile, but it isn't listed anywhere.",
	private: "Only you can see your profile.",
};

/** The time zones offered — the platform's own list, so a saved value is one the database knows. */
const TIME_ZONES = (() => {
	try {
		return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
	} catch {
		return ["UTC"];
	}
})();

export default function ProfileEditor({ model, userId }: ProfileEditorProps): JSX.Element {
	const individual = model.ownerType === "user";
	const sections = model.sections;
	const baseline = useSignal<EditDraft>(draftOf(model));
	const draft = useSignal<EditDraft>(draftOf(model));
	/** Bumped by Discard: remounts the fields so every input shows the saved value again. */
	const formKey = useSignal(0);
	const errors = useSignal<Record<string, string>>({});
	const saving = useSignal(false);
	const status = useSignal("");
	const dirtyRef = useRef(false);

	const d = draft.value;
	const err = errors.value;
	const dirty = isDirty(baseline.value, d, sections, individual);
	dirtyRef.current = dirty;

	function set<K extends keyof EditDraft>(key: K, value: EditDraft[K]): void {
		draft.value = { ...draft.peek(), [key]: value };
	}

	/** A section's summary state — unsaved edits, or a refused field inside it. */
	function stateOf(keys: Array<keyof EditDraft>): "edited" | "error" | undefined {
		if (Object.keys(err).some((k) => keys.some((key) => k === key || k.startsWith(`${String(key)}.`)))) {
			return "error";
		}
		const base = baseline.value;
		return keys.some((k) => JSON.stringify(base[k]) !== JSON.stringify(d[k])) ? "edited" : undefined;
	}

	async function save(): Promise<void> {
		if (saving.peek()) return;
		const patch = patchOf(baseline.peek(), draft.peek(), sections, individual);
		if (Object.keys(patch).length === 0) {
			status.value = "Nothing to save.";
			return;
		}
		const parsed = ProfileSavePatchSchema.safeParse(patch);
		if (!parsed.success) {
			errors.value = errorsFromIssues(parsed.error.issues);
			status.value = "Some details need fixing before they can be saved.";
			return;
		}
		saving.value = true;
		status.value = "Saving…";
		const sent = draft.peek();
		const res = await ProfileService.save(model.handle, parsed.data);
		saving.value = false;
		if (!res.ok || !res.data) {
			errors.value = res.errors ?? {};
			status.value = res.message ?? "Your changes couldn't be saved.";
			return;
		}
		errors.value = {};
		// Adopt the ids the database gave any new rows, so the next save updates them in place.
		const saved = withSavedIds(draft.peek(), sent, draftOf(res.data.model));
		draft.value = saved;
		baseline.value = withSavedIds(sent, sent, draftOf(res.data.model));
		status.value = "Saved.";
	}

	function discard(): void {
		draft.value = baseline.peek();
		errors.value = {};
		formKey.value += 1;
		status.value = "Changes discarded.";
	}

	// Ctrl / ⌘ + S saves from anywhere on the page.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void save();
			}
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);

	// Leaving with unsaved changes asks first.
	useEffect(() => {
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (!dirtyRef.current) return;
			e.preventDefault();
			e.returnValue = "";
		};
		globalThis.addEventListener("beforeunload", onBeforeUnload);
		return () => globalThis.removeEventListener("beforeunload", onBeforeUnload);
	}, []);

	const fieldError = (path: string) => errorFor(err, path);

	return (
		<div class="pf-edit">
			<header class="pf-edit__head">
				<h1 class="pf-edit__h1">Edit profile & settings</h1>
				<p class="pf-edit__lede">
					Changes save when you press Save (or Ctrl + S). Photos and showcase items save as soon as
					you apply them.
				</p>
			</header>

			<EditSection
				id="edit-media"
				title="Photo & showcase"
				description="Your profile photo and the six items at the top of your profile."
			>
				<MediaSection
					handle={model.handle}
					name={individual ? `${d.firstName} ${d.lastName}`.trim() : d.name}
					individual={individual}
					userId={userId}
					initial={{ avatar: model.avatar, showcase: model.showcase }}
					onNotice={(text) => (status.value = text)}
				/>
			</EditSection>

			<div class="pf-edit__form" key={formKey.value}>
				{sections.identity && (
					<EditSection
						id="edit-basics"
						title="Basics"
						description="Your name and the one line under it."
						state={stateOf(["firstName", "lastName", "name", "headline"])}
					>
						<div class="pf-edit__grid">
							{individual
								? (
									<>
										<FormControl
											label="First name"
											required
											error={fieldError("firstName")}
											status={fieldError("firstName") ? "invalid" : "default"}
										>
											{({ id, describedBy, status: s, required }) => (
												<InputText
													id={id}
													aria-describedby={describedBy}
													status={s}
													required={required}
													value={d.firstName}
													maxLength={60}
													autoComplete="given-name"
													fluid
													onValueChange={(v) => set("firstName", v)}
												/>
											)}
										</FormControl>
										<FormControl
											label="Last name"
											error={fieldError("lastName")}
											status={fieldError("lastName") ? "invalid" : "default"}
										>
											{({ id, describedBy, status: s }) => (
												<InputText
													id={id}
													aria-describedby={describedBy}
													status={s}
													value={d.lastName}
													maxLength={60}
													autoComplete="family-name"
													fluid
													onValueChange={(v) => set("lastName", v)}
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
										error={fieldError("name")}
										status={fieldError("name") ? "invalid" : "default"}
									>
										{({ id, describedBy, status: s, required }) => (
											<InputText
												id={id}
												aria-describedby={describedBy}
												status={s}
												required={required}
												value={d.name}
												maxLength={80}
												fluid
												onValueChange={(v) => set("name", v)}
											/>
										)}
									</FormControl>
								)}
							<FormControl
								label="Headline"
								class="pf-edit__wide"
								hint={`${d.headline.length} / ${PROFILE_LIMITS.headline} — what you do, in a line.`}
								error={fieldError("headline")}
								status={fieldError("headline") ? "invalid" : "default"}
							>
								{({ id, describedBy, status: s }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										status={s}
										value={d.headline}
										maxLength={PROFILE_LIMITS.headline}
										placeholder="Brand designer for early-stage product teams"
										fluid
										onValueChange={(v) => set("headline", v)}
									/>
								)}
							</FormControl>
						</div>
					</EditSection>
				)}

				{sections.about && (
					<EditSection
						id="edit-about"
						title="About"
						description="Your story, in your own words."
						state={stateOf(["story"])}
					>
						<FormControl
							label="About"
							hint={`${d.story.length} / ${PROFILE_LIMITS.story}`}
							error={fieldError("story")}
							status={fieldError("story") ? "invalid" : "default"}
						>
							{({ id, describedBy, status: s }) => (
								<Textarea
									id={id}
									aria-describedby={describedBy}
									status={s}
									value={d.story}
									maxLength={PROFILE_LIMITS.story}
									rows={6}
									autoResize
									maxRows={20}
									fluid
									onValueChange={(v) => set("story", v)}
								/>
							)}
						</FormControl>
					</EditSection>
				)}

				{sections.location && (
					<EditSection
						id="edit-location"
						title="Location & time"
						description="Where you're based, and the time zone your hours are shown in."
						state={stateOf(["city", "country", "timezone"])}
					>
						<div class="pf-edit__grid">
							<FormControl label="City" error={fieldError("city")} status={fieldError("city") ? "invalid" : "default"}>
								{({ id, describedBy, status: s }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										status={s}
										value={d.city}
										maxLength={80}
										autoComplete="address-level2"
										fluid
										onValueChange={(v) => set("city", v)}
									/>
								)}
							</FormControl>
							<FormControl
								label="Country"
								error={fieldError("country")}
								status={fieldError("country") ? "invalid" : "default"}
							>
								{({ id, describedBy, status: s }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										status={s}
										value={d.country}
										maxLength={80}
										autoComplete="country-name"
										fluid
										onValueChange={(v) => set("country", v)}
									/>
								)}
							</FormControl>
							{individual && (
								<FormControl
									label="Time zone"
									class="pf-edit__wide"
									error={fieldError("timezone")}
									status={fieldError("timezone") ? "invalid" : "default"}
								>
									{({ id, describedBy, status: s }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											status={s}
											options={TIME_ZONES.map((z) => ({ label: z.replace(/_/g, " "), value: z }))}
											value={d.timezone}
											filter
											placeholder="Choose your time zone"
											fluid
											onValueChange={(v) => set("timezone", v)}
										/>
									)}
								</FormControl>
							)}
						</div>
					</EditSection>
				)}

				{sections.skills && (
					<EditSection
						id="edit-skills"
						title="Skills"
						description="Up to 15 — each one links visitors to search."
						state={stateOf(["skills"])}
					>
						<FormControl
							label="Skills"
							hint="Press Enter after each skill."
							error={fieldError("skills")}
							status={fieldError("skills") ? "invalid" : "default"}
						>
							{({ id, describedBy, status: s }) => (
								<Chips
									id={id}
									aria-describedby={describedBy}
									status={s}
									value={d.skills}
									max={PROFILE_LIMITS.skills}
									placeholder="Add a skill"
									addOnBlur
									fluid
									onValueChange={(v) => set("skills", v)}
								/>
							)}
						</FormControl>
					</EditSection>
				)}

				{sections.languages && (
					<EditSection
						id="edit-languages"
						title="Languages"
						description="The languages you work in, and how well."
						state={stateOf(["languages"])}
					>
						<LanguagesEditor rows={d.languages} errors={err} onChange={(rows) => set("languages", rows)} />
					</EditSection>
				)}

				{sections.experience && (
					<EditSection
						id="edit-experience"
						title="Experience"
						description="Roles, education and certifications — shown on your Experience tab."
						state={stateOf(["experience", "education", "certifications"])}
					>
						<h3 class="pf-edit__subhead">Roles</h3>
						<ExperienceEditor rows={d.experience} errors={err} onChange={(rows) => set("experience", rows)} />
						<h3 class="pf-edit__subhead">Education</h3>
						<EducationEditor rows={d.education} errors={err} onChange={(rows) => set("education", rows)} />
						<h3 class="pf-edit__subhead">Certifications</h3>
						<CertificationsEditor
							rows={d.certifications}
							errors={err}
							onChange={(rows) => set("certifications", rows)}
						/>
					</EditSection>
				)}

				<EditSection
					id="edit-privacy"
					title="Privacy & display"
					description="Who can see your profile, and what it shows."
					state={stateOf(["visibility", "settings"])}
				>
					{sections.visibility && (
						<FormControl label="Who can see your profile" hint={VISIBILITY_NOTE[d.visibility]}>
							{({ describedBy }) => (
								<SelectButton
									aria-describedby={describedBy}
									aria-label="Profile visibility"
									options={VISIBILITY_OPTIONS}
									value={d.visibility}
									onValueChange={(v) => {
										if (typeof v === "string") set("visibility", v as ProfileVisibility);
									}}
								/>
							)}
						</FormControl>
					)}
					<ul class="pf-edit__switches" role="list">
						<li>
							<ToggleSwitch
								value={d.settings.allowAvatarExpand}
								label="Let visitors open your profile photo full size"
								onValueChange={(v) => set("settings", { ...draft.peek().settings, allowAvatarExpand: v })}
							/>
						</li>
						{sections.location && (
							<li>
								<ToggleSwitch
									value={d.settings.showLocation}
									label="Show your city and country"
									onValueChange={(v) => set("settings", { ...draft.peek().settings, showLocation: v })}
								/>
							</li>
						)}
						<li>
							<ToggleSwitch
								value={d.settings.showLocalTime}
								label="Show your local time beside your availability"
								onValueChange={(v) => set("settings", { ...draft.peek().settings, showLocalTime: v })}
							/>
						</li>
					</ul>
				</EditSection>
			</div>

			<div class="pf-edit__savebar" data-dirty={dirty ? "true" : "false"}>
				<p class="pf-edit__status" role="status" aria-live="polite">
					{status.value || (dirty ? "You have unsaved changes." : "All changes saved.")}
				</p>
				<div class="pf-edit__saveactions">
					<Button variant="text" class="pf-edit__ghost" disabled={!dirty || saving.value} onClick={discard}>
						Discard
					</Button>
					<Button
						class="pf-edit__save"
						disabled={!dirty || saving.value}
						loading={saving.value}
						onClick={() => void save()}
					>
						Save changes
					</Button>
				</div>
			</div>
		</div>
	);
}
