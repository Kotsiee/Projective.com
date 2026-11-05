/**
 * Room adapters — one meeting at each provider (Decision #383, rulings R3 and R5). Nothing here writes
 * to anybody's calendar, and every room lets an attendee in without its host, because a room they
 * cannot enter leaves no evidence that they came.
 *
 * An adapter holds no token: the service passes one in for the call, and nothing an adapter throws or
 * returns contains it. Nothing past this file knows a provider's field names.
 */

// #region Shapes
/** What a room is for, as the queue states it. */
export interface RoomFacts {
	roomId: string;
	title: string;
	startsAt: string;
	endsAt: string;
	/** The host's account at the provider, from the connection. */
	hostAccount: string | null;
}

/** A meeting as a provider made it. */
export interface MintedRoom {
	meetingId: string;
	hostId: string | null;
	joinUrl: string;
	passcode: string | null;
	/** People can hold personal links on this meeting. */
	registration: boolean;
}

/** One stretch of one participant in a room, from the provider's own record. */
export interface RoomAttendance {
	key: string;
	accountId: string | null;
	registrantId: string | null;
	email: string | null;
	joinedAt: string;
	leftAt: string | null;
}

/** A person's own way into a room. */
export interface RoomRegistrant {
	registrantId: string;
	joinUrl: string;
}

export interface RoomAdapter {
	create(token: string, room: RoomFacts): Promise<MintedRoom>;
	/** Follow a new time. Absent: the provider's room has no time. */
	move?(token: string, meetingId: string, room: RoomFacts): Promise<void>;
	/** Take the meeting down. Absent: there is nothing to take down. */
	close?(token: string, meetingId: string): Promise<void>;
	/** Everyone the provider recorded, oldest first or not. Empty when nobody came. */
	attendance(token: string, meetingId: string): Promise<RoomAttendance[]>;
	/** A fresh link for the host, where a stored one would be a credential that expires. */
	hostLink?(token: string, meetingId: string): Promise<string | null>;
	register?(
		token: string,
		meetingId: string,
		person: { email: string; firstName: string },
	): Promise<RoomRegistrant>;
}

/** A provider refused, or could not be reached. `final` means trying again cannot help. */
export class RoomProviderError extends Error {
	constructor(readonly status: number, readonly code: string, readonly final: boolean) {
		super(`Provider answered ${status} (${code}).`);
		this.name = "RoomProviderError";
	}
}
// #endregion

// #region Calling a provider
/** 401 can be a token that just died, and 408 and 429 pass; any other refusal will refuse again. */
const isFinal = (status: number) =>
	status >= 400 && status < 500 && ![401, 408, 429].includes(status);

async function call<T>(
	url: string,
	token: string,
	init: { method?: string; body?: unknown } = {},
): Promise<T> {
	const res = await fetch(url, {
		method: init.method ?? "GET",
		headers: {
			authorization: `Bearer ${token}`,
			...(init.body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(10_000),
	});
	const text = await res.text();
	let body: Record<string, unknown> = {};
	try {
		if (text) body = JSON.parse(text);
	} catch {
		if (res.ok) throw new RoomProviderError(res.status, "not_json", false);
	}
	if (!res.ok) {
		const nested = body.error as { code?: unknown; status?: unknown } | string | undefined;
		const code = typeof nested === "object" ? nested?.code ?? nested?.status : nested ?? body.code;
		throw new RoomProviderError(res.status, String(code ?? "refused").slice(0, 60), isFinal(res.status));
	}
	return body as T;
}

/** A successful call, or `missing` when the thing is already gone. */
async function orMissing<T>(attempt: Promise<T>, missing: T): Promise<T> {
	try {
		return await attempt;
	} catch (error) {
		if (error instanceof RoomProviderError && error.status === 404) return missing;
		throw error;
	}
}

const durationMinutes = (room: RoomFacts) =>
	Math.max(1, Math.ceil((Date.parse(room.endsAt) - Date.parse(room.startsAt)) / 60_000));

const zulu = (iso: string) => new Date(iso).toISOString().replace(/\.\d+Z$/, "Z");
// #endregion

// #region Zoom
const ZOOM = "https://api.zoom.us/v2";

interface ZoomMeeting {
	id: number | string;
	host_id?: string;
	join_url: string;
	start_url?: string;
	password?: string;
}

interface ZoomParticipants {
	next_page_token?: string;
	participants?: {
		id?: string;
		user_id?: string;
		user_email?: string;
		registrant_id?: string;
		join_time?: string;
		leave_time?: string;
	}[];
}

const zoomMeetingBody = (room: RoomFacts) => ({
	topic: room.title.slice(0, 200),
	start_time: zulu(room.startsAt),
	duration: durationMinutes(room),
	timezone: "UTC",
});

const zoom: RoomAdapter = {
	async create(token, room) {
		// Registration needs a licensed host; on Basic, Zoom refuses the setting.
		const me = await call<{ type?: number }>(`${ZOOM}/users/me`, token);
		const registration = me.type === 2;
		const meeting = await call<ZoomMeeting>(`${ZOOM}/users/me/meetings`, token, {
			method: "POST",
			body: {
				...zoomMeetingBody(room),
				type: 2,
				settings: {
					join_before_host: true,
					jbh_time: 0,
					waiting_room: false,
					approval_type: registration ? 0 : 2,
					registrants_email_notification: false,
					registrants_confirmation_email: false,
				},
			},
		});
		return {
			meetingId: String(meeting.id),
			hostId: meeting.host_id ?? room.hostAccount,
			joinUrl: meeting.join_url,
			passcode: meeting.password ?? null,
			registration,
		};
	},

	async move(token, meetingId, room) {
		await call(`${ZOOM}/meetings/${encodeURIComponent(meetingId)}`, token, {
			method: "PATCH",
			body: zoomMeetingBody(room),
		});
	},

	async close(token, meetingId) {
		await orMissing(
			call(`${ZOOM}/meetings/${encodeURIComponent(meetingId)}?schedule_for_reminder=false`, token, {
				method: "DELETE",
			}),
			{},
		);
	},

	async attendance(token, meetingId) {
		const rows: RoomAttendance[] = [];
		let page = "";
		do {
			const url = `${ZOOM}/past_meetings/${encodeURIComponent(meetingId)}/participants?page_size=300` +
				(page ? `&next_page_token=${encodeURIComponent(page)}` : "");
			// A meeting nobody started has no record: that is Zoom saying nobody came.
			const res = await orMissing(call<ZoomParticipants>(url, token), {} as ZoomParticipants);
			for (const p of res.participants ?? []) {
				if (!p.join_time) continue;
				rows.push({
					key: p.registrant_id || p.id || p.user_email || p.user_id || p.join_time,
					accountId: p.id || null,
					registrantId: p.registrant_id || null,
					email: p.user_email || null,
					joinedAt: p.join_time,
					leftAt: p.leave_time || null,
				});
			}
			page = res.next_page_token ?? "";
		} while (page);
		return rows;
	},

	async hostLink(token, meetingId) {
		const meeting = await call<ZoomMeeting>(`${ZOOM}/meetings/${encodeURIComponent(meetingId)}`, token);
		return meeting.start_url ?? null;
	},

	async register(token, meetingId, person) {
		const added = await call<{ registrant_id?: string; id?: string; join_url: string }>(
			`${ZOOM}/meetings/${encodeURIComponent(meetingId)}/registrants`,
			token,
			{ method: "POST", body: { email: person.email, first_name: person.firstName } },
		);
		return { registrantId: added.registrant_id ?? added.id ?? "", joinUrl: added.join_url };
	},
};
// #endregion

// #region Google Meet
const MEET = "https://meet.googleapis.com/v2";

async function meetPages<T>(url: string, token: string, list: (page: Record<string, unknown>) => T[] | undefined) {
	const rows: T[] = [];
	let page = "";
	do {
		const glue = url.includes("?") ? "&" : "?";
		const res = await call<Record<string, unknown>>(
			`${url}${glue}pageSize=250${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
			token,
		);
		rows.push(...(list(res) ?? []));
		page = String(res.nextPageToken ?? "");
	} while (page);
	return rows;
}

interface MeetParticipant {
	name: string;
	signedinUser?: { user?: string };
}

interface MeetSession {
	startTime?: string;
	endTime?: string;
}

const google: RoomAdapter = {
	async create(token, room) {
		const space = await call<{ name: string; meetingUri: string }>(`${MEET}/spaces`, token, {
			method: "POST",
			body: { config: { accessType: "OPEN", entryPointAccess: "ALL" } },
		});
		return {
			meetingId: space.name,
			hostId: room.hostAccount ? `users/${room.hostAccount}` : null,
			joinUrl: space.meetingUri,
			passcode: null,
			registration: false,
		};
	},

	async attendance(token, meetingId) {
		const filter = encodeURIComponent(`space.name = "${meetingId}"`);
		const records = await meetPages<{ name: string }>(
			`${MEET}/conferenceRecords?filter=${filter}`,
			token,
			(page) => page.conferenceRecords as { name: string }[] | undefined,
		);
		const rows: RoomAttendance[] = [];
		for (const record of records) {
			const people = await meetPages<MeetParticipant>(
				`${MEET}/${record.name}/participants`,
				token,
				(page) => page.participants as MeetParticipant[] | undefined,
			);
			for (const person of people) {
				const sessions = await meetPages<MeetSession>(
					`${MEET}/${person.name}/participantSessions`,
					token,
					(page) => page.participantSessions as MeetSession[] | undefined,
				);
				for (const session of sessions) {
					if (!session.startTime) continue;
					rows.push({
						key: person.signedinUser?.user ?? person.name,
						accountId: person.signedinUser?.user ?? null,
						registrantId: null,
						email: null,
						joinedAt: session.startTime,
						leftAt: session.endTime ?? null,
					});
				}
			}
		}
		return rows;
	},
};
// #endregion

// #region Microsoft Teams
const GRAPH = "https://graph.microsoft.com/v1.0";

interface TeamsMeeting {
	id: string;
	joinWebUrl: string;
	participants?: { organizer?: { identity?: { user?: { id?: string } } } };
}

interface TeamsRecords {
	"@odata.nextLink"?: string;
	value?: {
		emailAddress?: string;
		identity?: { id?: string };
		attendanceIntervals?: { joinDateTime?: string; leaveDateTime?: string }[];
	}[];
}

const teams: RoomAdapter = {
	async create(token, room) {
		const meeting = await call<TeamsMeeting>(`${GRAPH}/me/onlineMeetings/createOrGet`, token, {
			method: "POST",
			body: {
				externalId: room.roomId,
				subject: room.title.slice(0, 200),
				startDateTime: room.startsAt,
				endDateTime: room.endsAt,
			},
		});
		// createOrGet takes no lobby setting. A tenant may forbid it: the room still works, and the
		// attendee's press of join is evidence that they came.
		await call(`${GRAPH}/me/onlineMeetings/${encodeURIComponent(meeting.id)}`, token, {
			method: "PATCH",
			body: { lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true } },
		}).catch((error) => {
			if (!(error instanceof RoomProviderError) || !error.final) throw error;
			console.error("[rooms:teams] lobby left as the tenant set it:", error.code);
		});
		return {
			meetingId: meeting.id,
			hostId: meeting.participants?.organizer?.identity?.user?.id ?? room.hostAccount,
			joinUrl: meeting.joinWebUrl,
			passcode: null,
			registration: false,
		};
	},

	async move(token, meetingId, room) {
		await call(`${GRAPH}/me/onlineMeetings/${encodeURIComponent(meetingId)}`, token, {
			method: "PATCH",
			body: {
				subject: room.title.slice(0, 200),
				startDateTime: room.startsAt,
				endDateTime: room.endsAt,
			},
		});
	},

	async close(token, meetingId) {
		await orMissing(
			call(`${GRAPH}/me/onlineMeetings/${encodeURIComponent(meetingId)}`, token, { method: "DELETE" }),
			{},
		);
	},

	async attendance(token, meetingId) {
		const base = `${GRAPH}/me/onlineMeetings/${encodeURIComponent(meetingId)}/attendanceReports`;
		const reports = await call<{ value?: { id: string }[] }>(base, token);
		const rows: RoomAttendance[] = [];
		for (const report of reports.value ?? []) {
			let url: string | undefined = `${base}/${encodeURIComponent(report.id)}/attendanceRecords`;
			while (url) {
				const page: TeamsRecords = await call<TeamsRecords>(url, token);
				for (const person of page.value ?? []) {
					for (const stretch of person.attendanceIntervals ?? []) {
						if (!stretch.joinDateTime) continue;
						rows.push({
							key: person.identity?.id || person.emailAddress || stretch.joinDateTime,
							accountId: person.identity?.id || null,
							registrantId: null,
							email: person.emailAddress || null,
							joinedAt: stretch.joinDateTime,
							leftAt: stretch.leaveDateTime ?? null,
						});
					}
				}
				url = page["@odata.nextLink"];
			}
		}
		return rows;
	},
};
// #endregion

/** Every provider a room can be minted on. A `custom` room has no adapter: nothing is minted. */
export const ROOM_ADAPTERS: Readonly<Record<string, RoomAdapter>> = {
	zoom,
	google,
	microsoft_teams: teams,
};
