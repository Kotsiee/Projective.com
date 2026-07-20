import type {
	FileItem,
	FileKind,
	FileSortDir,
	FileSortKey,
	MessageSender,
	ProjectDetail,
	SubmissionCrumb,
	SubmissionListPage,
	SubmissionListParams,
	SubmissionNodeKind,
	SubmissionNote,
	SubmissionReview,
	SubmissionStatus,
	SubmissionTreeNode,
	SubmissionUnit,
	SubmissionUnitKind,
} from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * projects submissions fixtures — the fat {@link ProjectBackendService}'s in-memory answer for the
 * Submissions explorer read (channel scope `/projects/[projectId]/[channelId]/submissions/…` and
 * project scope `/projects/[projectId]/submissions/…`) while `PROJECTS_BACKEND_LIVE` is off
 * (thin-frontend pattern, root CLAUDE.md §10). Like {@link findFilePage} / {@link findMessagePage} it
 * DERIVES a deterministic deliverable hierarchy from the resolved {@link ProjectDetail} — its stages
 * and its provider-side members become the navigation tree (stages → submitters → units → directories),
 * each unit a stable set of files — so the explorer always agrees with the project that opened it. No
 * RNG: a slug/segment hash seeds the variation and a fixed reference clock keeps SSR and the island's
 * refetch identical. The live path (RLS-scoped `submissions.*` / `files.*` reads) replaces this builder
 * behind the same gate with zero shape churn (the projection is the SSOT {@link SubmissionListPageSchema}).
 */

// #region Reference clock + deterministic helpers
/** Fixed reference "now" (no `Date.now()`), matching the files/messages fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}
function fmtDay(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}
function fmtDuration(ms: number): string {
	const total = Math.round(ms / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

/** A URL-safe slug (used for submitter / unit / directory segments). */
function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}
// #endregion

// #region Media pool (Unsplash crops — open registry, §C.4)
const IMG = (id: string, w: number, h: number) => ({
	url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`,
	w,
	h,
});
const PHOTOS = [
	IMG("photo-1618005182384-a83a8bd57fbe", 1200, 800),
	IMG("photo-1558655146-9f40138edfeb", 900, 1200),
	IMG("photo-1550684848-fac1c5b4e853", 1200, 900),
	IMG("photo-1620121692029-d088224ddc74", 1000, 1000),
	IMG("photo-1611262588024-d12430b98920", 1200, 675),
	IMG("photo-1626785774573-4b799315345d", 800, 1000),
	IMG("photo-1517245386807-bb43f82c33c4", 1200, 800),
	IMG("photo-1499951360447-b19be8fe80f5", 1100, 733),
];

const NAMES: Record<FileKind, string[]> = {
	image: ["concept", "moodboard", "hero-shot", "layout", "wireframe", "banner", "screen"],
	video: ["walkthrough", "demo-reel", "handoff-clip"],
	audio: ["voice-note", "review-call", "feedback"],
	pdf: ["concept-deck", "brand-guidelines", "spec-sheet", "annotations"],
	doc: ["scope-of-work", "content-plan", "changelog"],
	code: ["tokens", "theme", "component", "config"],
	archive: ["source-files", "export-pack", "deliverables"],
	file: ["attachment", "asset"],
};
const EXTS: Record<FileKind, string[]> = {
	image: ["png", "jpg", "webp"],
	video: ["mp4", "mov"],
	audio: ["mp3", "wav", "m4a"],
	pdf: ["pdf"],
	doc: ["docx", "pages", "rtf"],
	code: ["ts", "tsx", "css", "json"],
	archive: ["zip", "rar"],
	file: ["bin"],
};

function sizeFor(kind: FileKind, n: number): number {
	const r = n % 1000;
	switch (kind) {
		case "image":
			return 220_000 + r * 3_200;
		case "video":
			return 8_000_000 + r * 42_000;
		case "audio":
			return 900_000 + r * 7_000;
		case "pdf":
			return 180_000 + r * 6_000;
		case "doc":
			return 40_000 + r * 2_000;
		case "code":
			return 1_200 + r * 90;
		case "archive":
			return 2_400_000 + r * 60_000;
		default:
			return 100_000 + r * 1_000;
	}
}
// #endregion

// #region Participants
/** The acting viewer (the client/reviewer perspective in this flow). */
const VIEWER: MessageSender = {
	id: "viewer",
	name: "You",
	avatar:
		"https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	handle: "you",
};

function senderOf(id: string, name: string, avatar: string | null, handle: string | null): MessageSender {
	return { id, name, avatar, handle };
}

/**
 * The provider-side people who submit deliverables — the tree's submitter level. Excludes the reviewing
 * client (the owner on a client-architected project). Always ≥1 (falls back to the counterparty/owner).
 */
function submittersOf(detail: ProjectDetail): MessageSender[] {
	const subs = detail.members
		.filter((m) => m.role === "freelancer" || m.role === "member")
		.map((m) => senderOf(m.id, m.party.name, m.party.avatar, m.party.handle));
	if (subs.length > 0) return subs;
	const p = detail.client ?? detail.owner;
	return [senderOf(`${detail.slug}-sole`, p.name, p.avatar, p.handle)];
}
// #endregion

// #region Internal node model
interface FileProvenance {
	channelId: string;
	channelName: string;
	channelKind: FileItem["channelKind"];
}
interface UnitMeta {
	kind: SubmissionUnitKind;
	status: SubmissionStatus;
	submitter: MessageSender;
	stageId: string | null;
	stageName: string | null;
	stageStatus: string | null;
	ticketId: string | null;
	ticketTitle: string | null;
	createdAt: number;
	notes: SubmissionNote[];
}
/** An internal (pre-wire) tree node carrying its own directly-held files + a possible unit descriptor. */
interface Node {
	segment: string;
	kind: SubmissionNodeKind;
	label: string;
	sublabel: string | null;
	avatar: string | null;
	handle: string | null;
	status: SubmissionStatus | null;
	files: FileItem[];
	children: Node[];
	unit: UnitMeta | null;
}

function recFiles(node: Node): FileItem[] {
	return node.files.concat(...node.children.map(recFiles));
}
function recCount(node: Node): number {
	return node.files.length + node.children.reduce((s, c) => s + recCount(c), 0);
}
// #endregion

// #region File builder
const UNIT_STATUSES: SubmissionStatus[] = [
	"pending_review",
	"revision_requested",
	"accepted",
	"draft",
];
const UNIT_CUSTOM = [
	"Homepage Concepts",
	"Brand System v2",
	"Motion Pass",
	"Component Handoff",
	"Marketing Site",
	"Illustration Set",
];
const POST_SHAPES: FileKind[][] = [
	["image", "image", "image"],
	["image"],
	["video"],
	["pdf"],
	["pdf", "archive"],
	["image", "image"],
	["code", "code"],
	["doc"],
	["audio"],
	["image", "video"],
];
const MSG_TEXT = [
	"Latest direction for review — feedback welcome.",
	"Final export pack for this deliverable.",
	"Source + the compiled deliverable attached.",
	"Concept round two, pushed the type a touch bolder.",
	"Retina assets are in — let me know if the crops work.",
	"",
];

/** Build the files that sit directly inside one directory/unit node. */
function makeFiles(
	seedKey: string,
	count: number,
	submitter: MessageSender,
	prov: FileProvenance,
	baseTs: number,
): FileItem[] {
	const out: FileItem[] = [];
	let ts = baseTs;
	for (let p = 0; p < count; p++) {
		const pseed = hash(`${seedKey}:${p}`);
		const shape = POST_SHAPES[pseed % POST_SHAPES.length];
		const messageId = `${seedKey}-post-${p}`;
		const text = MSG_TEXT[(pseed + p) % MSG_TEXT.length];
		const hasAudioNote = shape.includes("audio") ? false : (pseed % 8 === 0);
		ts += 2 * HOUR + (pseed % 5) * 40 * MIN;

		shape.forEach((kind, i) => {
			const fseed = hash(`${messageId}:${i}`);
			const names = NAMES[kind];
			const exts = EXTS[kind];
			const base = names[(fseed + i) % names.length];
			// Unsigned `>>> 3` — a signed shift could go negative for hashes above 2^31 → a negative
			// array index → an "….undefined" ext. Keep every derived index unsigned.
			const ext = exts[(fseed >>> 3) % exts.length];
			const isVisual = kind === "image" || kind === "video";
			const photo = PHOTOS[(fseed + i) % PHOTOS.length];
			const bytes = sizeFor(kind, fseed);
			const created = ts + i * 20_000;
			const durMs = kind === "video"
				? (30 + (fseed % 210)) * 1000
				: kind === "audio"
				? (12 + (fseed % 180)) * 1000
				: 0;
			out.push({
				id: `${messageId}-${i}`,
				kind,
				name: `${base}-${(p % 4) + 1}${
					kind === "image" && shape.filter((k) => k === "image").length > 1 ? `-${i + 1}` : ""
				}.${ext}`,
				ext,
				url: isVisual ? photo.url : "#",
				thumbnailUrl: isVisual ? photo.url : null,
				sizeBytes: bytes,
				sizeLabel: fmtSize(bytes),
				width: isVisual ? photo.w : null,
				height: isVisual ? photo.h : null,
				durationLabel: durMs ? fmtDuration(durMs) : null,
				channelId: prov.channelId,
				channelName: prov.channelName,
				channelKind: prov.channelKind,
				messageId,
				messageText: text,
				messageAudioUrl: hasAudioNote ? "#" : null,
				sender: submitter,
				createdAt: new Date(created).toISOString(),
				timeLabel: fmtTime(created),
				dayLabel: fmtDay(created),
				dateLabel: fmtDateTime(created),
				starred: fseed % 13 === 0,
			});
		});
	}
	return out;
}

/** The review notes already left on a unit (only revision_requested units carry them, for the demo). */
function notesFor(unitKey: string, status: SubmissionStatus, files: FileItem[]): SubmissionNote[] {
	if (status !== "revision_requested") return [];
	const seed = hash(unitKey);
	const bodies = [
		"The hero crop feels tight on mobile — can we give it more breathing room?",
		"Type hierarchy is close; bump the section headings one step.",
		"Great direction overall. Tighten the export naming before final.",
	];
	const n = 1 + (seed % 2);
	const out: SubmissionNote[] = [];
	for (let i = 0; i < n; i++) {
		const created = NOW - (i + 1) * 5 * HOUR;
		const onFile = i === 0 && files[0] ? files[0].id : null;
		out.push({
			id: `${unitKey}-note-${i}`,
			author: VIEWER,
			text: bodies[(seed + i) % bodies.length],
			fileId: onFile,
			createdAt: new Date(created).toISOString(),
			dateLabel: fmtDateTime(created),
		});
	}
	return out;
}
// #endregion

// #region Tree builders
const DIR_POOL = ["deliverables", "source", "previews", "exports", "documentation"];

/** Build a submission UNIT node (with its directory subtree + files). */
function buildUnit(
	submitter: MessageSender,
	stage: { id: string; name: string; status: string } | null,
	prov: FileProvenance,
	index: number,
	keyBase: string,
): Node {
	// Globally-unique per-unit key (keyBase already carries slug + stage + submitter). File ids derive
	// from it, NOT from the unit's local `segment` — two units can share a repeated custom name, and
	// their files must still be uniquely keyed when a subtree renders both (a duplicate-key hazard).
	const unitKey = `${keyBase}:unit:${index}`;
	const seed = hash(unitKey);
	const kind: SubmissionUnitKind = (["custom", "ticket", "timestamp"] as const)[seed % 3];
	// The active stage's first unit is always pending_review so the review flow is demonstrable.
	const status: SubmissionStatus = stage?.status === "active" && index === 0
		? "pending_review"
		: UNIT_STATUSES[seed % UNIT_STATUSES.length];
	const createdAt = NOW - (index + 1) * 11 * HOUR - (seed % 6) * HOUR;

	const ticketId = kind === "ticket" ? `TCK-${100 + (seed % 800)}` : null;
	const ticketTitle = kind === "ticket"
		? ["Revise the landing hero", "Ship the icon set", "Polish the checkout flow"][seed % 3]
		: null;
	const name = kind === "custom"
		? UNIT_CUSTOM[seed % UNIT_CUSTOM.length]
		: kind === "ticket"
		? `${ticketId} · ${ticketTitle}`
		: `Submission · ${fmtDateTime(createdAt)}`;

	// Append the unit index so sibling units with a repeated custom name stay path-unique.
	const segment = `${slug(kind === "timestamp" ? "submission" : name)}-${index + 1}`;

	// Directory subtree: two or three directories, one carrying a nested sub-directory (breadcrumbs demo).
	const dirCount = 2 + (seed % 2);
	const dirs: Node[] = [];
	const allFiles: FileItem[] = [];
	for (let d = 0; d < dirCount; d++) {
		const dirName = DIR_POOL[(seed + d) % DIR_POOL.length];
		const dseed = hash(`${keyBase}:unit:${index}:dir:${dirName}`);
		const fileGroups = 1 + (dseed % 2);
		const dirFiles = makeFiles(`${unitKey}/${dirName}`, fileGroups, submitter, prov, createdAt + d * HOUR);
		const dirChildren: Node[] = [];
		// The first directory of the first unit gets a nested sub-directory to exercise deep paths.
		if (d === 0) {
			const subName = "retina";
			const subFiles = makeFiles(
				`${unitKey}/${dirName}/${subName}`,
				1,
				submitter,
				prov,
				createdAt + d * HOUR + 30 * MIN,
			);
			dirChildren.push({
				segment: slug(subName),
				kind: "dir",
				label: subName,
				sublabel: null,
				avatar: null,
				handle: null,
				status: null,
				files: subFiles,
				children: [],
				unit: null,
			});
			allFiles.push(...subFiles);
		}
		allFiles.push(...dirFiles);
		dirs.push({
			segment: slug(dirName),
			kind: "dir",
			label: dirName,
			sublabel: null,
			avatar: null,
			handle: null,
			status: null,
			files: dirFiles,
			children: dirChildren,
			unit: null,
		});
	}
	// A couple of loose files at the unit root (not in a directory).
	const rootFiles = makeFiles(`${unitKey}/root`, 1, submitter, prov, createdAt);
	allFiles.push(...rootFiles);

	const notes = notesFor(unitKey, status, allFiles);

	const unitMeta: UnitMeta = {
		kind,
		status,
		submitter,
		stageId: stage?.id ?? null,
		stageName: stage?.name ?? null,
		stageStatus: stage?.status ?? null,
		ticketId,
		ticketTitle,
		createdAt,
		notes,
	};

	return {
		segment,
		kind: "unit",
		label: name,
		sublabel: stage ? stage.name : (kind === "ticket" ? "Ticket" : null),
		avatar: null,
		handle: null,
		status,
		files: rootFiles,
		children: dirs,
		unit: unitMeta,
	};
}

/** Build a submitter node (its units beneath it), or — for the single-freelancer override — its units. */
function buildSubmitterUnits(
	submitter: MessageSender,
	stage: { id: string; name: string; status: string } | null,
	prov: FileProvenance,
	keyBase: string,
): Node[] {
	const seed = hash(`${keyBase}:${submitter.id}`);
	const unitCount = 1 + (seed % 2);
	const units: Node[] = [];
	for (let u = 0; u < unitCount; u++) {
		units.push(buildUnit(submitter, stage, prov, u, `${keyBase}:${submitter.id}`));
	}
	return units;
}

function submitterNode(
	submitter: MessageSender,
	stage: { id: string; name: string; status: string } | null,
	prov: FileProvenance,
	keyBase: string,
): Node {
	const units = buildSubmitterUnits(submitter, stage, prov, keyBase);
	return {
		segment: slug(submitter.handle ?? submitter.name),
		kind: "submitter",
		label: submitter.name,
		sublabel: "Freelancer",
		avatar: submitter.avatar,
		handle: submitter.handle,
		status: null,
		files: [],
		children: units,
		unit: null,
	};
}

/**
 * Build the root nodes for a scope.
 * - project scope → Stages are the roots; each stage → submitters (or units directly under the
 *   single-freelancer override, applied per stage).
 * - channel scope → submitters are the roots (or units directly when there is a single freelancer).
 */
function buildRoots(
	detail: ProjectDetail,
	channelId: string | null,
): { roots: Node[]; singleFreelancer: boolean } {
	const submitters = submittersOf(detail);

	if (channelId) {
		// Channel scope — one channel's submissions.
		const chan = resolveChannel(detail, channelId);
		const prov: FileProvenance = {
			channelId,
			channelName: chan?.name ?? "Channel",
			channelKind: chan?.kind ?? "general",
		};
		const single = submitters.length === 1;
		if (single) {
			return {
				roots: buildSubmitterUnits(submitters[0], null, prov, `${detail.slug}:${channelId}`),
				singleFreelancer: true,
			};
		}
		return {
			roots: submitters.map((s) => submitterNode(s, null, prov, `${detail.slug}:${channelId}`)),
			singleFreelancer: false,
		};
	}

	// Project scope — Stages are the roots.
	const roots: Node[] = detail.channels.stages.map((stage, si) => {
		const prov: FileProvenance = {
			channelId: stage.channel.id,
			channelName: stage.name,
			channelKind: "stage",
		};
		// Per-stage submitter subset so the single-freelancer override is demonstrated on some stages.
		const stageSubs = submitters.slice(0, 1 + (si % submitters.length));
		const stageMeta = { id: stage.id, name: stage.name, status: stage.status };
		const keyBase = `${detail.slug}:${stage.id}`;
		const children: Node[] = stageSubs.length === 1
			? buildSubmitterUnits(stageSubs[0], stageMeta, prov, keyBase)
			: stageSubs.map((s) => submitterNode(s, stageMeta, prov, keyBase));
		return {
			segment: stage.id,
			kind: "stage" as const,
			label: stage.name,
			sublabel: stage.status,
			avatar: null,
			handle: null,
			status: null,
			files: [],
			children,
			unit: null,
		};
	});
	return { roots, singleFreelancer: false };
}

function resolveChannel(
	detail: ProjectDetail,
	channelId: string,
): { name: string; kind: FileItem["channelKind"] } | null {
	for (const c of detail.channels.general) {
		if (c.id === channelId) return { name: c.name, kind: "general" };
	}
	for (const s of detail.channels.stages) {
		if (s.channel.id === channelId || s.id === channelId) return { name: s.name, kind: "stage" };
	}
	for (const t of detail.channels.teams) {
		for (const c of t.channels) {
			if (c.id === channelId) return { name: `${t.teamName} · ${c.name}`, kind: "team" };
		}
	}
	for (const d of detail.channels.dms) {
		if (d.chatId === channelId) return { name: d.party.name, kind: "dm" };
	}
	return null;
}
// #endregion

// #region Wire mapping + path resolution
function toWire(node: Node): SubmissionTreeNode {
	return {
		segment: node.segment,
		kind: node.kind,
		label: node.label,
		sublabel: node.sublabel,
		avatar: node.avatar,
		handle: node.handle,
		status: node.status,
		fileCount: recCount(node),
		children: node.children.map(toWire),
	};
}

/** Walk `path` from the roots, returning the matched node chain (may be shorter than `path`). */
function resolveChain(roots: Node[], path: string[]): Node[] {
	const chain: Node[] = [];
	let level = roots;
	for (const seg of path) {
		const found = level.find((n) => n.segment === seg);
		if (!found) break;
		chain.push(found);
		level = found.children;
	}
	return chain;
}

function toUnit(node: Node): SubmissionUnit | null {
	if (node.kind !== "unit" || !node.unit) return null;
	const u = node.unit;
	return {
		path: [], // filled by the caller (needs the ancestor chain)
		name: node.label,
		kind: u.kind,
		status: u.status,
		submitter: u.submitter,
		stageId: u.stageId,
		stageName: u.stageName,
		ticketId: u.ticketId,
		ticketTitle: u.ticketTitle,
		createdAt: new Date(u.createdAt).toISOString(),
		dateLabel: fmtDateTime(u.createdAt),
		fileCount: recCount(node),
		noteCount: u.notes.length,
	};
}

function buildReview(unitNode: Node, unit: SubmissionUnit): SubmissionReview {
	const u = unitNode.unit!;
	const stageSummary = u.stageName
		? `Deliverables submitted on the ${u.stageName} stage, sent for the client's review. ` +
			`Escrow for this milestone releases on acceptance; requesting a revision returns it to the ` +
			`freelancer with your notes.`
		: `Deliverables sent for the client's review. Escrow releases on acceptance; requesting a ` +
			`revision returns the work with your notes.`;
	const ticketSummary = u.ticketTitle
		? `This submission fulfils ${u.ticketId} — "${u.ticketTitle}". Confirm the acceptance criteria ` +
			`are met before accepting.`
		: null;
	return {
		unit,
		stageName: u.stageName,
		stageStatus: u.stageStatus,
		stageSummary,
		ticketTitle: u.ticketTitle,
		ticketSummary,
		notes: u.notes,
	};
}
// #endregion

// #region Filter + sort + page (mirrors the File Explorer read)
function matches(item: FileItem, params: SubmissionListParams): boolean {
	if (params.kinds && params.kinds.length > 0 && !params.kinds.includes(item.kind)) return false;
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}
const SORTERS: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};
function sortItems(items: FileItem[], sort: FileSortKey, dir: FileSortDir): FileItem[] {
	const cmp = SORTERS[sort];
	const sorted = items.slice().sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
	return dir === "desc" ? sorted.reverse() : sorted;
}
const DEFAULT_LIMIT = 60;
// #endregion

// #region Public builder
/**
 * Resolve a page of the submissions explorer. `channelId` unset/null → project scope (Stages as tree
 * roots). Returns `null` only when the PROJECT resolves to nothing (the route maps that to a 404).
 */
export function findSubmissionPage(params: SubmissionListParams): SubmissionListPage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;

	const channelId = params.channelId ?? null;
	const { roots, singleFreelancer } = buildRoots(detail, channelId);
	const path = params.path ?? [];

	const chain = resolveChain(roots, path);
	const resolvedPath = chain.map((n) => n.segment);
	// The node the workspace is scoped to (deepest matched), or a virtual root over all root nodes.
	const scopedFiles = chain.length > 0
		? recFiles(chain[chain.length - 1])
		: roots.flatMap(recFiles);

	// The active submission unit is the unit node within the resolved chain (self or ancestor).
	let activeUnit: SubmissionUnit | null = null;
	let review: SubmissionReview | null = null;
	for (let i = 0; i < chain.length; i++) {
		if (chain[i].kind === "unit") {
			const unit = toUnit(chain[i]);
			if (unit) {
				unit.path = resolvedPath.slice(0, i + 1);
				activeUnit = unit;
				review = buildReview(chain[i], unit);
			}
			break;
		}
	}

	// Breadcrumb trail — the scope root plus one crumb per matched node.
	const rootLabel = channelId ? "Submissions" : "All stages";
	const breadcrumbs: SubmissionCrumb[] = [
		{ label: rootLabel, kind: "stage", path: [] },
		...chain.map((n, i) => ({
			label: n.label,
			kind: n.kind,
			path: resolvedPath.slice(0, i + 1),
		})),
	];

	// Filter + sort + page the scoped files.
	const sort = params.sort ?? "date";
	const dir = params.dir ?? (sort === "date" ? "desc" : "asc");
	const matched = scopedFiles.filter((it) => matches(it, params));
	const sorted = sortItems(matched, sort, dir);
	const total = sorted.length;

	const limit = Math.min(200, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const idx = sorted.findIndex((it) => it.id === params.cursor);
		start = idx === -1 ? 0 : idx + 1;
	}
	const pageItems = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;

	return {
		scope: channelId ? "channel" : "project",
		projectId: params.projectId,
		channelId,
		tree: roots.map(toWire),
		path: resolvedPath,
		breadcrumbs,
		items: pageItems,
		activeUnit,
		review,
		hasMore,
		nextCursor: hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].id : null,
		total,
		viewerId: VIEWER.id,
		viewerIsClient: detail.viewerIsClient,
		singleFreelancer,
	};
}
// #endregion
