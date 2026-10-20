import type { ComponentChildren, JSX } from "preact";
import {
	chapterFeatures,
	chapterNumber,
	chapterTitleId,
	comingSoonParts,
	FEATURE_CHAPTERS,
	type FeatureChapter,
	type FeatureChapterId,
	featureDemo,
	type FeatureEntry,
	featureHelpHref,
	FEATURES_COPY,
	featureTryHref,
} from "@features/landing/core/features-catalogue.ts";
import { NAV_CHAPTER_ATTR } from "@features/landing/core/feature-dialog.ts";

// #region Stills
/**
 * ChapterStill — the frame a chapter's picture sits in: the demo stage's own window and product
 * viewport (`lp-demo.css`), so a real-component still reads exactly as it does on `/`. The picture
 * is a demo's server-rendered still (`role="img"`, `inert`) and never moves (§2.7: nothing on
 * `/features` moves while browsing). A chapter with no real still has no picture at all, never a
 * placeholder in the window (Decision #302 (C)).
 */
export function ChapterStill({ children }: { children: ComponentChildren }): JSX.Element {
	return (
		<div class="lp-features__still">
			<div class="lp-demo__window">
				<div class="lp-demo__viewport" data-state="poster">
					<div class="lp-demo__screen">{children}</div>
				</div>
			</div>
		</div>
	);
}
// #endregion

// #region Navigation
/** Props for {@link ChapterNav}. */
export interface ChapterNavProps {
	/** The chapter `?section=` asked for, marked as the reader's place; `null` marks none. */
	target: FeatureChapterId | null;
}

/**
 * ChapterNav — the index of chapters under the page head (`flows/LANDING.md` §2.6 note 3): each a
 * real in-page link (`#money`), so it works with no JavaScript, numbered as the chapters are. One
 * sideways row below `--bp-md`; from `--bp-md` it stays pinned under the bar while the chapters
 * scroll by, on the canvas's solid tone with one hairline beneath. The server marks the chapter
 * `?section=` named with `aria-current="location"`; once the reader moves, the dialog island moves
 * the marker to the chapter they are in (each link names its chapter in `NAV_CHAPTER_ATTR`;
 * `chapterAt`, `core/feature-dialog.ts`) and clears it above the first chapter and past the last.
 */
export function ChapterNav({ target }: ChapterNavProps): JSX.Element {
	return (
		<nav class="lp-features__nav" aria-label={FEATURES_COPY.nav}>
			<ol class="lp-features__nav-list">
				{FEATURE_CHAPTERS.map((chapter) => (
					<li key={chapter.id} class="lp-features__nav-item">
						<a
							class="lp-features__nav-link"
							href={`#${chapter.id}`}
							aria-current={chapter.id === target ? "location" : undefined}
							{...{ [NAV_CHAPTER_ATTR]: chapter.id }}
						>
							<span class="lp-features__nav-num" aria-hidden="true">
								{chapterNumber(chapter.id)}
							</span>
							{chapter.title}
						</a>
					</li>
				))}
			</ol>
		</nav>
	);
}
// #endregion

// #region Rows
/**
 * FeatureRow — one feature, as plain text on a hairline (never a box, #288): its h3, its §4.12
 * description, its small print, then its controls — "Try it" (tier 4 outlined) only where a demo
 * exists, and "Learn more" (a text link to the help article) only where one exists. Each control's
 * name is its visible words, then the feature's title visually hidden ("Try it: Work board", "Learn
 * more: Work board"), so the name holds the label a speech-input user says (WCAG 2.5.3, Decision
 * #302 (A); `tryLabel`). With no JavaScript "Try it" opens the landing's demo stage on that demo;
 * hydrated, the dialog island opens it in place: it finds the link by `TRY_DEMO_ATTR` and
 * `TRY_FEATURE_ATTR` (`core/feature-dialog.ts`), the attributes written here.
 */
export function FeatureRow({ entry }: { entry: FeatureEntry }): JSX.Element {
	const demo = featureDemo(entry);
	const help = featureHelpHref(entry);
	return (
		<li id={entry.id} class="lp-features__row">
			<h3 class="lp-heading lp-features__row-title">{entry.title}</h3>
			<p class="lp-body lp-features__row-desc">{entry.description}</p>
			{entry.smallPrint ? <p class="lp-meta lp-features__row-small">{entry.smallPrint}</p> : null}
			{demo !== null || help !== null
				? (
					<div class="lp-features__row-actions">
						{demo !== null
							? (
								<a
									class="lp-btn lp-btn--outlined lp-features__try"
									href={featureTryHref(demo)}
									data-lp-try={demo}
									data-lp-feature={entry.id}
								>
									{FEATURES_COPY.tryIt}
									<span class="ui-visually-hidden">: {entry.title}</span>
								</a>
							)
							: null}
						{help !== null
							? (
								<a class="lp-section__link lp-features__more" href={help}>
									{FEATURES_COPY.learnMore}
									<span class="ui-visually-hidden">: {entry.title}</span>
								</a>
							)
							: null}
					</div>
				)
				: null}
		</li>
	);
}

/**
 * ComingSoonRow — a feature that is not built yet (§4.12, claims X1–X3): its h3 and its description,
 * word for word, the description's own "Coming soon:" lead set in the stronger ink as the row's
 * label. Static and muted: no control, no link, no motion.
 */
export function ComingSoonRow({ entry }: { entry: FeatureEntry }): JSX.Element {
	const [lead, rest] = comingSoonParts(entry.description);
	return (
		<li id={entry.id} class="lp-features__row lp-features__row--soon">
			<h3 class="lp-heading lp-features__row-title">{entry.title}</h3>
			<p class="lp-body lp-features__row-desc">
				{lead ? <span class="lp-features__soon">{lead}</span> : null}
				{rest}
			</p>
		</li>
	);
}
// #endregion

// #region Chapter
/** Props for {@link FeatureChapterSection}. */
export interface FeatureChapterSectionProps {
	chapter: FeatureChapter;
	/** The chapter's picture ({@link ChapterStill}'s content), or nothing (Coming soon). */
	still?: ComponentChildren;
	/** This is the chapter `?section=` asked for: marked for the island to land on. */
	target: boolean;
}

/**
 * FeatureChapterSection — one chapter, a landmark labelled by its h2 (`#find-and-hire`…): the
 * section-header number and the display h2 (on the warm band for the editorial chapters, the serif
 * and a number in the warm ink; #288 registers at weight 500), its rows, and its picture. From `--bp-lg` the head and the rows hold
 * the left column and the picture the right, pinned beside the rows as they scroll. The chapter a
 * `?section=` named carries `SECTION_TARGET_ATTR` (`core/feature-dialog.ts`) and a focusable h2,
 * which the island lands on.
 */
export function FeatureChapterSection(
	{ chapter, still, target }: FeatureChapterSectionProps,
): JSX.Element {
	const rows = chapterFeatures(chapter.id);
	const titleId = chapterTitleId(chapter.id);
	const editorial = chapter.voice === "editorial";
	const muted = chapter.voice === "muted";
	return (
		<section
			id={chapter.id}
			class={[
				"lp-section",
				"lp-features__chapter",
				`lp-features__chapter--${chapter.voice}`,
				editorial ? "lp-section--band" : "",
				still ? "" : "lp-features__chapter--bare",
			].filter(Boolean).join(" ")}
			aria-labelledby={titleId}
			data-lp-target={target ? "" : undefined}
		>
			<div class="lp-features__chapter-inner">
				<header class="lp-features__chapter-head">
					<p
						class={editorial
							? "lp-eyebrow lp-eyebrow--editorial lp-features__num"
							: "lp-eyebrow lp-features__num"}
						aria-hidden="true"
					>
						{chapterNumber(chapter.id)}
					</p>
					<h2
						id={titleId}
						class={editorial
							? "lp-display lp-display--section lp-display--editorial lp-features__chapter-title"
							: "lp-display lp-display--section lp-features__chapter-title"}
						tabIndex={target ? -1 : undefined}
					>
						{chapter.title}
					</h2>
				</header>
				{still ? <ChapterStill>{still}</ChapterStill> : null}
				<ul class="lp-features__rows">
					{rows.map((entry) =>
						muted
							? <ComingSoonRow key={entry.id} entry={entry} />
							: <FeatureRow key={entry.id} entry={entry} />
					)}
				</ul>
			</div>
		</section>
	);
}
// #endregion

// #region Index
/** Props for {@link FeatureIndex}. */
export interface FeatureIndexProps {
	/** The chapter `?section=` asked for, or `null`. */
	target: FeatureChapterId | null;
	/** Each chapter's picture, by chapter; a chapter with none prints its rows alone. */
	stills: Partial<Record<FeatureChapterId, ComponentChildren>>;
}

/**
 * FeatureIndex — `/features`' editorial chapter index (`flows/LANDING.md` §2.5, §2.6, §4.12; work
 * order L5 as amended by Decision #288, which supersedes the prompt's bento grid): the chapter
 * navigation, then Find & hire · Run the work · Money · Trust · Coming soon, each a section of
 * plain-text rows (`features-catalogue.ts`). Separation is spacing, the warm band's solid tone for
 * the editorial chapters, the registers and one hairline per row. No row is boxed: the only outline
 * a row carries is its "Try it" control's, and a chapter's still sits in the demo stage's own
 * window. Nothing here moves.
 */
export function FeatureIndex({ target, stills }: FeatureIndexProps): JSX.Element {
	return (
		<>
			<ChapterNav target={target} />
			{FEATURE_CHAPTERS.map((chapter) => (
				<FeatureChapterSection
					key={chapter.id}
					chapter={chapter}
					still={stills[chapter.id]}
					target={chapter.id === target}
				/>
			))}
		</>
	);
}
// #endregion
