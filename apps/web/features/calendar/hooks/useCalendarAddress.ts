import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { CalendarWindow, IsoDate } from "@projective/types/scheduling";
import type { CalendarViewMode, ZoomStop } from "@projective/ui/calendar";
import { PX_PER_DAY_DEFAULT } from "@projective/ui/gantt";
import {
	type CalendarAddress,
	calendarAddressHref,
	type CalendarAddressSurface,
	type CalendarOpening,
	type CalendarViewState,
	nextCalendarAddress,
	readCalendarAddress,
	timelineScaleOf,
	timelineStopOf,
} from "../core/calendar-address.ts";
import { installCalendarAddress } from "../core/calendar-state.ts";
import { nextReadAround } from "../core/window-reach.ts";

/** A burst of scrolling or zooming settles into one address write. */
const WRITE_SETTLE_MS = 250;
/** A burst of scrolling settles into one window read. */
const READ_SETTLE_MS = 300;

/**
 * Install the address into the shared calendar state on this region's first render (Decision #413).
 * Every region of the `/calendar` surface calls it first thing, because whichever hydrates first must
 * install the address before anything — the engine's zoom sync included — reads the state.
 */
export function useCalendarAddress(address: CalendarAddress | undefined, tz: string | null): void {
	const installed = useRef(false);
	if (installed.current) return;
	installed.current = true;
	if (address) installCalendarAddress(address, tz);
}

/**
 * The Timeline scale (px per day) of a body whose engine owns its view — an engagement's calendar, a
 * public schedule — held here so the address can name it (`?zoom=`) and the writer can read it. A
 * host-held scale is one the engine no longer remembers, so it opens at the address's stop, else at
 * what the reader last left under the engine's own key, and is remembered there.
 */
export function useOwnedTimelineScale(storageKey: string, zoom?: ZoomStop): Signal<number> {
	const scale = useSignal(zoom ? timelineScaleOf(zoom) : PX_PER_DAY_DEFAULT);
	const key = `${storageKey}:timeline:zoom`;
	const restored = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const stored = Number(readStored(key));
		if (!zoom && stored > 0) scale.value = stored;
		restored.current = true;
		return () => {
			if (timer.current !== null) clearTimeout(timer.current);
		};
	}, []);

	// A pinch moves the scale every frame, so it is remembered once it settles.
	useSignalEffect(() => {
		const ppd = scale.value;
		if (!restored.current) return;
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			writeStored(key, String(ppd));
		}, WRITE_SETTLE_MS);
	});
	return scale;
}

/** A stored value, or `null` where storage is absent or refused (a private window, a full quota). */
function readStored(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Remember a value; `false` where storage is absent or refused, which costs only the default. */
function writeStored(key: string, value: string): boolean {
	try {
		globalThis.localStorage?.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

/** Options for {@link useCalendarAddressWriter}. */
export interface AddressWriterOptions {
	surface: CalendarAddressSurface;
	/** What the calendar shows now. Read inside an effect, so every signal it reads is followed. */
	state: () => CalendarViewState;
	/** The page's zone, once there is a page. */
	tz: () => string | null;
}

/**
 * Keep the address in step with what the calendar shows, with `replaceState`, so a reload or a shared
 * link lands on it and Back is never filled with every scroll. One writer per surface: its body.
 *
 * Armed one task after mount, once the reader's stored defaults have been restored, and what the
 * calendar showed then is the baseline {@link nextCalendarAddress} measures a move against.
 */
export function useCalendarAddressWriter(opts: AddressWriterOptions): void {
	const optsRef = useRef(opts);
	optsRef.current = opts;
	const opened = useRef<CalendarOpening | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const arm = setTimeout(() => {
			const s = optsRef.current.state();
			opened.current = {
				view: s.view,
				focus: s.focus,
				timelineStop: timelineStopOf(s.timelineScale),
			};
		}, 0);
		return () => {
			clearTimeout(arm);
			if (timer.current !== null) clearTimeout(timer.current);
		};
	}, []);

	useSignalEffect(() => {
		const s = optsRef.current.state();
		if (!opened.current) return;
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			write(s);
		}, WRITE_SETTLE_MS);
	});

	function write(s: CalendarViewState): void {
		const tz = optsRef.current.tz();
		const loc = globalThis.location;
		if (!tz || !loc || !opened.current) return;
		const current = readCalendarAddress(new URL(loc.href), optsRef.current.surface).address;
		const next = nextCalendarAddress(current, s, opened.current, tz);
		const href = calendarAddressHref(loc.pathname, loc.search, next);
		if (href !== `${loc.pathname}${loc.search}`) history.replaceState(history.state, "", href);
	}
}

/** Options for {@link useCalendarWindowReader}. */
export interface WindowReaderOptions<P> {
	/** The window the page on screen was read over; `undefined` for a page that is not windowed. */
	window: () => CalendarWindow | undefined;
	view: () => CalendarViewMode;
	focus: () => number;
	tz: () => string | null;
	/** Read the page around a day; `null` when it could not be read. */
	read: (around: IsoDate) => Promise<P | null>;
	/** Put a page that landed on screen. */
	apply: (page: P) => void;
}

/**
 * Read the next window as the reader's focus nears the edge of the one on screen (S-29), so the
 * grid shows "Not loaded" only while a read is on its way or after one failed. Reads settle for a
 * moment first, and only the latest one's page is applied: an earlier read landing late would put
 * back a window the reader has already left.
 */
export function useCalendarWindowReader<P>(opts: WindowReaderOptions<P>): void {
	const optsRef = useRef(opts);
	optsRef.current = opts;
	const lastAround = useRef<IsoDate | null>(null);
	const latest = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => () => {
		latest.current++;
		if (timer.current !== null) clearTimeout(timer.current);
	}, []);

	useSignalEffect(() => {
		const o = optsRef.current;
		const tz = o.tz();
		const around = tz
			? nextReadAround(o.window(), o.view(), o.focus(), tz, lastAround.current)
			: null;
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
		if (!around) return;
		timer.current = setTimeout(() => {
			timer.current = null;
			const ticket = ++latest.current;
			lastAround.current = around;
			void optsRef.current.read(around).then((page) => {
				if (ticket !== latest.current) return;
				if (page) optsRef.current.apply(page);
				// A failed read may be tried again once the reader moves; the notice already says why.
				else lastAround.current = null;
			});
		}, READ_SETTLE_MS);
	});
}
