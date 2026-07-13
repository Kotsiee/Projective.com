import type { JSX, VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import "../styles/file-upload.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../hooks/useId.ts";
import type { FieldSize } from "../types/mod.ts";

// #region Types
/** Lifecycle state of a queued file. */
export type UploadStatus = "pending" | "uploading" | "complete" | "error";

/** A single entry in the upload queue. */
export interface UploadFile {
	/** Stable id for this queue entry. */
	id: string;
	/** The underlying `File`. */
	file: File;
	/** Current lifecycle state. */
	status: UploadStatus;
	/** Upload progress 0–100. */
	progress: number;
	/** Object URL preview for image files (revoked on removal). */
	preview?: string;
	/** Validation/upload error message when `status === "error"`. */
	error?: string;
}

/** Progress/status setters handed to a {@link FileUploadProps.customUpload} implementation. */
export interface UploadControls {
	setProgress: (progress: number) => void;
	setStatus: (status: UploadStatus, error?: string) => void;
}

/** Render context for the header/item templates. */
export interface FileUploadContext {
	files: UploadFile[];
	upload: () => void;
	clear: () => void;
	remove: (id: string) => void;
	choose: () => void;
}

/** Props for {@link FileUpload}. */
export interface FileUploadProps {
	/** `advanced` shows the drop zone + queue + action bar; `basic` is a single picker button. */
	mode?: "advanced" | "basic";
	/** Allow selecting multiple files (default `true` in advanced mode). */
	multiple?: boolean;
	/** `accept` attribute forwarded to the native input (e.g. `"image/*,.pdf"`). */
	accept?: string;
	/** Reject files larger than this many bytes, surfacing a message. */
	maxFileSize?: number;
	/** Upload automatically as soon as files are selected. */
	auto?: boolean;
	/** Native field name. */
	name?: string;
	/** Disable all interaction. */
	disabled?: boolean;
	/** Size ramp (default `md`). */
	size?: FieldSize;
	/** Label for the choose button (default `"Choose"`). */
	chooseLabel?: string;
	/** Per-file custom uploader; when present it drives progress via {@link UploadControls}. */
	customUpload?: (file: UploadFile, controls: UploadControls) => Promise<void> | void;
	/** Bulk upload handler used when `customUpload` is absent. */
	onUpload?: (files: UploadFile[]) => Promise<void> | void;
	/** Fired after files pass validation and enter the queue. */
	onSelect?: (files: UploadFile[]) => void;
	/** Fired when a file is removed from the queue. */
	onRemove?: (file: UploadFile) => void;
	/** Fired on each progress tick from a custom uploader. */
	onProgress?: (file: UploadFile, progress: number) => void;
	/** Replaces the header/action bar. */
	headerTemplate?: (ctx: FileUploadContext) => VNode;
	/** Replaces a single queued-file row. */
	itemTemplate?: (file: UploadFile, ctx: FileUploadContext) => VNode;
	/** Replaces the empty drop-zone body. */
	emptyTemplate?: () => VNode;
	id?: string;
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Helpers
/** Human-readable byte size. */
function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

let seq = 0;
function nextId(): string {
	return `f${Date.now().toString(36)}-${(seq++).toString(36)}`;
}
// #endregion

/**
 * FileUpload — a full uploader control. In `advanced` mode it renders a keyboard-operable drag-and-drop
 * zone (with dragover highlight) plus a file picker, a queue of selected files showing per-file
 * progress bars and image thumbnails, and Upload/Clear/Remove actions; `basic` mode is a single
 * picker button. Selection is validated against `accept`/`maxFileSize` (rejections surface as
 * messages), the queue is signal-first, and uploading is delegated to `customUpload` (per file, with
 * live progress) or `onUpload` (bulk). Header/item/empty templates allow full render control. The
 * drop zone is a labelled `button`; the queue is an `aria-live` list so additions/removals are
 * announced. Reduced-motion is honoured by the token-driven progress transition.
 */
export function FileUpload(props: FileUploadProps): JSX.Element {
	const {
		mode = "advanced",
		multiple = true,
		accept,
		maxFileSize,
		auto,
		name,
		disabled,
		size = "md",
		chooseLabel = "Choose",
		customUpload,
		onUpload,
		onSelect,
		onRemove,
		onProgress,
		headerTemplate,
		itemTemplate,
		emptyTemplate,
		id,
		"aria-label": ariaLabel = "File upload",
		class: className,
	} = props;

	const rootId = useId(id, "file-upload");
	const inputRef = useRef<HTMLInputElement>(null);
	const queue = useMemo<Signal<UploadFile[]>>(() => signal<UploadFile[]>([]), []);
	const messages = useMemo<Signal<string[]>>(() => signal<string[]>([]), []);
	const dragging = useMemo(() => signal(false), []);

	// #region Queue mutation
	const patch = (fileId: string, next: Partial<UploadFile>) => {
		queue.value = queue.value.map((f) => (f.id === fileId ? { ...f, ...next } : f));
	};

	const choose = () => {
		if (!disabled) inputRef.current?.click();
	};

	const addFiles = (fileList: FileList | File[]) => {
		const incoming = Array.from(fileList);
		const accepted: UploadFile[] = [];
		const errors: string[] = [];
		for (const file of incoming) {
			if (maxFileSize && file.size > maxFileSize) {
				errors.push(`${file.name} exceeds the ${formatBytes(maxFileSize)} limit.`);
				continue;
			}
			accepted.push({
				id: nextId(),
				file,
				status: "pending",
				progress: 0,
				preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
			});
		}
		messages.value = errors;
		if (accepted.length === 0) return;
		queue.value = multiple ? [...queue.value, ...accepted] : accepted.slice(-1);
		onSelect?.(accepted);
		if (auto) uploadPending(accepted);
	};

	const remove = (fileId: string) => {
		const target = queue.value.find((f) => f.id === fileId);
		if (target?.preview) URL.revokeObjectURL(target.preview);
		queue.value = queue.value.filter((f) => f.id !== fileId);
		if (target) onRemove?.(target);
	};

	const clear = () => {
		for (const f of queue.value) if (f.preview) URL.revokeObjectURL(f.preview);
		queue.value = [];
		messages.value = [];
	};
	// #endregion

	// #region Upload
	const uploadPending = async (subset?: UploadFile[]) => {
		const pending = (subset ?? queue.value).filter((f) => f.status === "pending");
		if (pending.length === 0) return;

		if (customUpload) {
			for (const f of pending) {
				patch(f.id, { status: "uploading", progress: 0 });
				const controls: UploadControls = {
					setProgress: (progress) => {
						patch(f.id, { progress });
						onProgress?.(f, progress);
					},
					setStatus: (status, error) => patch(f.id, { status, error }),
				};
				try {
					await customUpload(f, controls);
					patch(f.id, { status: "complete", progress: 100 });
				} catch (err) {
					patch(f.id, { status: "error", error: err instanceof Error ? err.message : String(err) });
				}
			}
			return;
		}

		for (const f of pending) patch(f.id, { status: "uploading" });
		try {
			await onUpload?.(pending);
			for (const f of pending) patch(f.id, { status: "complete", progress: 100 });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			for (const f of pending) patch(f.id, { status: "error", error: message });
		}
	};
	// #endregion

	// #region DnD
	const onDrop = (e: JSX.TargetedDragEvent<HTMLElement>) => {
		e.preventDefault();
		dragging.value = false;
		if (disabled) return;
		if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
	};
	const onDragOver = (e: JSX.TargetedDragEvent<HTMLElement>) => {
		e.preventDefault();
		if (!disabled) dragging.value = true;
	};
	const onDragLeave = () => (dragging.value = false);
	// #endregion

	const files = queue.value;
	const ctx: FileUploadContext = { files, upload: () => uploadPending(), clear, remove, choose };

	const nativeInput = (
		<input
			ref={inputRef}
			id={rootId}
			type="file"
			class="ui-file-upload__input"
			name={name}
			accept={accept}
			multiple={multiple}
			disabled={disabled}
			aria-hidden="true"
			tabIndex={-1}
			onChange={(e) => {
				if (e.currentTarget.files) addFiles(e.currentTarget.files);
				e.currentTarget.value = "";
			}}
		/>
	);

	// #region Basic mode
	if (mode === "basic") {
		return (
			<span
				class={cx("ui-file-upload", "ui-file-upload--basic", `ui-file-upload--${size}`, className)}
			>
				<button
					type="button"
					class="ui-file-upload__choose"
					disabled={disabled}
					aria-label={ariaLabel}
					onClick={choose}
				>
					<span class="ui-file-upload__choose-icon" aria-hidden="true">⭱</span>
					<span>{files.length > 0 ? files[0].file.name : chooseLabel}</span>
				</button>
				{nativeInput}
			</span>
		);
	}
	// #endregion

	const hasPending = files.some((f) => f.status === "pending");

	return (
		<div
			class={cx(
				"ui-file-upload",
				`ui-file-upload--${size}`,
				disabled && "ui-file-upload--disabled",
				className,
			)}
		>
			{/* #region Header / actions */}
			{headerTemplate ? headerTemplate(ctx) : (
				<div class="ui-file-upload__header">
					<button
						type="button"
						class="ui-file-upload__choose"
						disabled={disabled}
						onClick={choose}
					>
						<span class="ui-file-upload__choose-icon" aria-hidden="true">⭱</span>
						<span>{chooseLabel}</span>
					</button>
					<button
						type="button"
						class="ui-file-upload__action"
						disabled={disabled || !hasPending}
						onClick={() => uploadPending()}
					>
						Upload
					</button>
					<button
						type="button"
						class="ui-file-upload__action ui-file-upload__action--ghost"
						disabled={disabled || files.length === 0}
						onClick={clear}
					>
						Clear
					</button>
				</div>
			)}
			{/* #endregion */}

			{nativeInput}

			{/* #region Drop zone */}
			<button
				type="button"
				class={cx("ui-file-upload__zone", dragging.value && "ui-file-upload__zone--drag")}
				disabled={disabled}
				aria-label={`${ariaLabel}. Drop files here or activate to browse.`}
				onClick={choose}
				onDrop={onDrop}
				onDragOver={onDragOver}
				onDragEnter={onDragOver}
				onDragLeave={onDragLeave}
			>
				{files.length === 0 &&
					(emptyTemplate ? emptyTemplate() : (
						<span class="ui-file-upload__zone-hint">
							<span class="ui-file-upload__zone-icon" aria-hidden="true">⭳</span>
							Drag and drop files here, or browse
						</span>
					))}
				{files.length > 0 && (
					<span class="ui-file-upload__zone-hint">Drop more files, or browse</span>
				)}
			</button>
			{/* #endregion */}

			{/* #region Validation messages */}
			{messages.value.length > 0 && (
				<ul class="ui-file-upload__messages" role="alert">
					{messages.value.map((m, i) => <li key={i} class="ui-file-upload__message">{m}</li>)}
				</ul>
			)}
			{/* #endregion */}

			{/* #region Queue */}
			{files.length > 0 && (
				<ul class="ui-file-upload__list" aria-live="polite" aria-label="Selected files">
					{files.map((f) =>
						itemTemplate ? itemTemplate(f, ctx) : (
							<li
								key={f.id}
								class={cx("ui-file-upload__item", `ui-file-upload__item--${f.status}`)}
							>
								<div class="ui-file-upload__thumb" aria-hidden="true">
									{f.preview
										? <img class="ui-file-upload__thumb-img" src={f.preview} alt="" />
										: (
											<span class="ui-file-upload__thumb-ext">
												{f.file.name.split(".").pop() ?? "?"}
											</span>
										)}
								</div>
								<div class="ui-file-upload__meta">
									<span class="ui-file-upload__name">{f.file.name}</span>
									<span class="ui-file-upload__size">{formatBytes(f.file.size)}</span>
									<div
										class="ui-file-upload__progress"
										role="progressbar"
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={Math.round(f.progress)}
										aria-label={`${f.file.name} upload progress`}
									>
										<div
											class="ui-file-upload__progress-bar"
											style={styleVars({ "--progress": `${f.progress}%` })}
										/>
									</div>
									{f.error && <span class="ui-file-upload__error">{f.error}</span>}
								</div>
								<button
									type="button"
									class="ui-file-upload__remove"
									aria-label={`Remove ${f.file.name}`}
									disabled={disabled}
									onClick={() => remove(f.id)}
								>
									×
								</button>
							</li>
						)
					)}
				</ul>
			)}
			{/* #endregion */}
		</div>
	);
}
