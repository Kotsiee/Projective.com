import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { RichTextEditor } from "@projective/ui/editor";
import { AutoComplete, InputText, SelectButton, type Suggestion } from "@projective/ui/fields";
import { ServiceType } from "@projective/types/catalogue";
import { CreateCategory } from "@projective/types/org";
import type { ListingDetail, SkillRef } from "../../types/catalogue-types.ts";
import { CREATE_CATEGORY_OPTIONS, SERVICE_MODELS } from "../../core/catalogue-model.ts";
import { edit, editDescription } from "../../core/workspace-store.ts";
import { WorkspaceService } from "../../core/WorkspaceService.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";

const SKILLS_MAX = 24;
const NOT_YET = "none";

const TITLE_ID = "cat-basics-title";
const DESC_ID = "cat-basics-desc";
const CREATE_LABEL = "CREATE category";
const CREATE_HINT_ID = "cat-basics-create-hint";
const SKILLS_ID = "cat-basics-skills";
const SKILLS_HINT_ID = "cat-basics-skills-hint";
const MODEL_LABEL = "Delivery model";
const MODEL_HINT_ID = "cat-basics-model-hint";

const CREATE_OPTIONS = [
	...CREATE_CATEGORY_OPTIONS.map((c) => ({ label: c.label, value: c.value })),
	{ label: "Not yet", value: NOT_YET },
];

const MODEL_OPTIONS = SERVICE_MODELS.map((m) => ({ label: m, value: m }));

function labelOf(item: Suggestion): string {
	return typeof item === "string" ? item : item.label;
}

/**
 * BasicsSection — what the listing is: its title (whose visible label is its accessible name), the
 * rich description, the CREATE category, the skills it is found under (`org.skills`, through the
 * skills typeahead) and, for a service, its delivery model. The model can change only while the
 * listing is a draft: once published, bookings and projects depend on it, so it shows as text with
 * the way to change it.
 */
export function BasicsSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const skillOptions = useSignal<string[]>([]);
	const skillsLoading = useSignal(false);
	const skillsNotice = useSignal<string | null>(null);
	const known = useSignal<Map<string, SkillRef>>(
		new Map(listing.skills.map((s) => [s.label, s])),
	);

	async function findSkills(q: string): Promise<void> {
		skillsLoading.value = true;
		const res = await WorkspaceService.skills(q);
		skillsLoading.value = false;
		if (!res.ok || !res.data) {
			skillOptions.value = [];
			skillsNotice.value = res.message ?? "Skills aren't available right now.";
			return;
		}
		skillsNotice.value = null;
		const next = new Map(known.peek());
		for (const skill of res.data.skills) next.set(skill.label, skill);
		known.value = next;
		skillOptions.value = res.data.skills.map((s) => s.label);
	}

	function setSkills(value: string | Suggestion[]): void {
		if (typeof value === "string") return;
		const refs = value.map(labelOf).flatMap((label) => {
			const ref = known.peek().get(label);
			return ref ? [ref] : [];
		});
		if (refs.length > SKILLS_MAX) {
			skillsNotice.value = `A listing can carry up to ${SKILLS_MAX} skills.`;
			return;
		}
		edit("skills", refs);
	}

	const category = CREATE_CATEGORY_OPTIONS.find((c) => c.value === listing.createCategory);
	const isDraft = listing.status === "draft";

	return (
		<EditSectionFrame section="basics" intro="What buyers see first, and where they find it.">
			<div class="cat-sec__field">
				<label class="cat-sec__label" for={TITLE_ID}>Title</label>
				<InputText
					id={TITLE_ID}
					value={listing.title}
					onValueChange={(v) => edit("title", v)}
					maxLength={200}
					status={listing.title.trim() ? "default" : "required"}
					required
					block
				/>
			</div>

			<div class="cat-sec__field">
				<span class="cat-sec__label" aria-hidden="true">Description</span>
				<RichTextEditor
					id={DESC_ID}
					value={listing.description}
					onValueChange={editDescription}
					placeholder="What buyers get, how you work, and what's included."
					status={listing.descriptionText.trim() ? "default" : "gate"}
					minRows={6}
					maxAutoHeight="28rem"
					aria-label="Description"
				/>
			</div>

			<div class="cat-sec__field">
				<span class="cat-sec__label" aria-hidden="true">{CREATE_LABEL}</span>
				<SelectButton
					options={CREATE_OPTIONS}
					value={listing.createCategory ?? NOT_YET}
					onValueChange={(v) => {
						if (typeof v !== "string") return;
						const parsed = CreateCategory.safeParse(v);
						edit("createCategory", parsed.success ? parsed.data : null);
					}}
					aria-label={CREATE_LABEL}
					aria-describedby={CREATE_HINT_ID}
				/>
				<p class="cat-sec__hint" id={CREATE_HINT_ID}>
					{category
						? category.hint
						: "Which kind of work this is. It decides where the listing counts towards your standing."}
				</p>
			</div>

			<div class="cat-sec__field">
				<label class="cat-sec__label" for={SKILLS_ID}>Skills</label>
				<AutoComplete
					id={SKILLS_ID}
					multiple
					forceSelection
					value={listing.skills.map((s) => s.label)}
					suggestions={skillOptions.value}
					onComplete={(q) => void findSkills(q)}
					onValueChange={setSkills}
					loading={skillsLoading.value}
					emptyMessage="No skill by that name"
					placeholder="Search skills"
					aria-describedby={SKILLS_HINT_ID}
					fluid
				/>
				<p class="cat-sec__hint" id={SKILLS_HINT_ID} role="status">
					{skillsNotice.value ?? "The skills this listing is found under in search."}
				</p>
			</div>

			{listing.kind === "service" && (
				<div class="cat-sec__field">
					<span class="cat-sec__label" aria-hidden={isDraft ? "true" : undefined}>
						{MODEL_LABEL}
					</span>
					{isDraft
						? (
							<SelectButton
								options={MODEL_OPTIONS}
								value={listing.serviceType ?? "One-Off"}
								onValueChange={(v) => {
									const parsed = ServiceType.safeParse(v);
									if (parsed.success) edit("serviceType", parsed.data);
								}}
								aria-label={MODEL_LABEL}
								aria-describedby={MODEL_HINT_ID}
							/>
						)
						: <p class="cat-sec__value">{listing.serviceType ?? "Not set"}</p>}
					<p class="cat-sec__hint" id={MODEL_HINT_ID}>
						{isDraft
							? "How buyers engage you. It can change only while this listing is a draft."
							: "Fixed once published, because bookings and projects depend on it. To offer this another way, archive it and create a new listing."}
					</p>
				</div>
			)}
		</EditSectionFrame>
	);
}
