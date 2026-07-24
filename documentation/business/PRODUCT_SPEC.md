# Product Specification — Projective

> **Canonical business/product source of truth.** This document was renamed from `brain.md` (same
> `documentation/business/` folder) during the July 2026 restructure — content moved verbatim. It is
> the **absolute, overriding authority** for all business logic, workflows, escrow, hiring, stage
> lifecycles, the sitemap, and visual identity. Its technical counterpart is
> [`documentation/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md)
> (formerly `brain2.md`). If any other document conflicts with this one on a business rule, **this
> file wins.** Governance: root [`CLAUDE.md`](../../CLAUDE.md), folder [`CLAUDE.md`](CLAUDE.md), and
> [`documentation/CLAUDE.md`](../CLAUDE.md).

App Name: Projective

Projective is a collaborative freelancing marketplace that enables businesses to hire entire
teams—functioning as "micro-agencies"—to deliver projects end-to-end. By replacing fragmented
individual hiring with structured, stage-based team collaboration, we provide the predictability of
an agency with the cost-efficiency of the gig economy.

[toc]

## Features

### Stage-Based Projects

Projects on Projective are not monolithic. They are decomposed into atomic, actionable **Stages**.
This modularity ensures that payment (Escrow) is only released upon verified progress. Every stage
is categorized by the **CREATE** framework to define its objective:

##### The CREATE Framework

- **Create:** Asset generation and production (e.g., UI Design, Code Implementation, Copywriting).
- **Run:** Operational and maintenance activities (e.g., Server Management, Social Media Posting, Ad
  Monitoring).
- **Educate:** Structured knowledge transfer (e.g., Programming Tutoring, Language Lessons).
- **Advise:** Strategic consulting and high-level guidance (e.g., Architecture Review, Business
  Strategy).
- **Test:** Validation and quality assurance (e.g., Bug Hunting, Security Audits, User Testing).
- **Empower:** Final handover and client enablement (e.g., Team Onboarding, Documentation Delivery).

#### Stage Formats

To accommodate everything from software development to live consulting, Stages exist in two distinct
functional formats.

##### 1. Deliverable-Based (Pipelines & One-Offs)

This format is used for tangible work outcomes. It merges traditional "File-based" delivery with
"Task-based" activities.

- **Activity Logic:** The Freelancer completes a predefined checklist of tasks.
- **Evidence:** While some stages require **Artifacts** (Files), others may only require **Proof of
  Action** (e.g., a screenshot or a simple "Task Complete" confirmation).
- **Workflow:**
  1. **Initiation:** Escrow is locked when the Freelancer moves the ticket to "In Progress."
  2. **Submission:** Freelancer checks off completed tasks and attaches any relevant files.
  3. **Review:** Client reviews the submission against the checklist.
  4. **Resolution:** Client Approves (Releases Payout) or Requests Revision (Moves back to In
     Progress).

##### 2. Session-Based (Services)

This format is used for time-bound, synchronous interactions. It relies on real-time presence and
verified attendance rather than asynchronous file uploads. It is the primary engine for Advisors,
Tutors, and Consultants.

###### A. Scheduling & The "Proactive" Calendar

Unlike static booking pages, Projective uses a dynamic negotiation flow to ensure all parties are
aligned on time and location.

- **Availability Windows:** Freelancers/Teams define "Work Windows" in their local time zone. The
  system performs real-time conversion to the Client’s local time.
- **The Proposal Flow:** 1. **Initiation:** The Freelancer proposes a specific Date, Time, and
  "Location" (integrated Zoom, Google Meet, or MS Teams link). 2. **Notification:** Attendees
  receive multi-channel alerts (Email, SMS, and Push) via the `NotificationService`. 3. **The
  Handshake:** Attendees can **Approve** the slot or **Counter-Propose** a new time. 4. **The
  Majority Rule:** For sessions involving multiple attendees (Group Sessions), any proposed change
  to an established time requires a **Majority Consensus** ($>50\%$) to be finalized.

###### B. Verification: The Digital Handshake

To prevent "he-said-she-said" disputes, Projective uses passive API verification to confirm
attendance.

- **Presence Logs:** The `SessionService` listens for Webhooks from the conferencing provider (e.g.,
  Zoom `participant_joined`).
- **Proof of Presence:** Both the Freelancer and the Client must be logged in the room within the
  first 15 minutes for the session to be marked as "Successful."
- **Failure to Attend:** If the system detects a Freelancer no-show, the Escrow is flagged for an
  immediate refund.

###### C. Financial Integrity & The 24-Hour Rule

The financial lifecycle of a session is governed by strict "Time-to-Event" (TTE) windows to protect
both the freelancer’s time and the client’s capital.

| Event                       | Timeline             | Financial Outcome                                                            |
| :-------------------------- | :------------------- | :--------------------------------------------------------------------------- |
| **Booking**                 | At Checkout          | **Escrow Locked:** Funds are held by Projective.                             |
| **Cancellation (Standard)** | $>24\text{h}$ before | **Full Refund:** Escrow returned to Client.                                  |
| **Cancellation (Late)**     | $<24\text{h}$ before | **Forfeit:** Escrow released to Freelancer (Time Protection).                |
| **Freelancer Cancel**       | Any time             | **Auto-Refund:** Full Escrow returned to Client immediately.                 |
| **Session Complete**        | T + 0                | **Pending Window:** 24-hour countdown begins.                                |
| **Payout Release**          | T + 24h              | **Automatic Release:** Payment sent to Freelancer wallet (Negative Consent). |

###### D. The Session Workflow

1. **Booking:** Client selects/purchases session(s). Escrow is locked.
2. **Coordination:** Parties finalize time/location via the Calendar Proposal interface.
3. **Execution:** Session occurs via the platform-generated link.
4. **Validation:** System logs presence via Webhooks.
5. **Resolution:** - **Success:** Client approves or stays silent for 24 hours $\rightarrow$ Payout.
   - **Dispute:** Client claims "No Show" $\rightarrow$ `DisputeService` audits the API Presence
     Logs to verify the claim.

#### Logic Summary Table

| Feature                  | Deliverable-Based           | Session-Based           |
| :----------------------- | :-------------------------- | :---------------------- |
| **Primary Project Type** | Pipelines / One-Offs        | Session Services        |
| **Success Metric**       | Completed Checklist / Files | Time Spent / Attendance |
| **Escrow Trigger**       | Starting the Ticket         | Booking the Slot        |
| **UI Representation**    | Kanban / Timeline           | Calendar                |

---

### Freelancers & Teams

Projective treats individuals and groups with the same level of architectural flexibility. Whether
you are a solo consultant or a global collective, the platform provides the infrastructure to manage
work, money, and time without the administrative overhead of traditional agency registration.

##### The "Virtual Agency" Concept

Teams on Projective exist to eliminate the legal and financial friction of collaboration.

- **No Incorporation Required:** Form a group, invite members, and start accepting enterprise-level
  projects without setting up a legal entity or a joint bank account.
- **Freelancer-Only Space:** The Teams workspace belongs to the freelancer side of the platform. It
  is visible only when the active persona is a Freelancer profile, and is never surfaced to a
  Client/Business persona.
- **Additive, Unlockable Personas:** A user's persona is not fixed at signup. Someone who onboarded
  as a Client/Operator can unlock a Freelancer profile at any time from the **Become a Partner**
  conversion page (`/become-partner`) — the freelancer suite layers on top of the same identity and
  reputation, and the two are switched from the account menu. A freelancer profile carries the
  seller's **skills** (used for discovery ranking); it does **not** carry an hourly rate —
  Projective does not treat a signalling hourly rate as a platform field. Unlocking is free,
  idempotent, and immediately activates the Freelancer persona. Reaching the profile's **go-live
  milestone** (a baseline of photo, headline, story, and skills) is what lets a freelancer publish
  publicly, sell premium services, and apply to workspaces — this can happen before the profile is
  100% complete.
- **Draft-First Creation:** Creating a Team is deliberately low-friction — a member supplies only a
  display **Name** and a unique alphanumeric **`@handle`**. The Team is created instantly in a
  **Draft/Unverified** state; branding, contribution splits, roles, and member invitations are
  completed afterwards on the Team's settings page.
- **Automated Payment Splitting:** Payments are distributed at the moment of Escrow release. If a
  Stage payout is $1,000, Projective automatically routes percentages to individual member wallets
  based on predefined **Contribution Agreements**.
- **Unified Identity:** Teams can create "Services" (Sessions) and bid on "Projects" as a single
  entity, building a collective reputation and portfolio.

##### Role-Based Access Control (RBAC)

To maintain security and operational integrity, Team members are assigned specific roles that
dictate their "Action Permissions" across the monorepo.

| Role             | Actions                                                                                 |
| :--------------- | :-------------------------------------------------------------------------------------- |
| **Lead / Admin** | Create Services, Manage Financial Splits, Invite/Remove Members, Finalize Submissions.  |
| **Member**       | Join Projects, Claim Stage Tickets, Manage Boards, Communicate with Clients.            |
| **Contributor**  | View Project Details, Post Internal Comments, Upload Drafts (Requires Member Approval). |

##### Resource Allocation Logic

Teams have total flexibility in how they deploy their talent across a Pipeline or One-Off project:

- **Solo-Stage:** One member is dedicated to a single project.
- **Sequential Handover:** Member A handles the "Design" stage; Member B handles "Development."
- **Collaborative Stage:** Multiple members assigned to a single "Stage Ticket" to work in parallel.

#### Work Management Tools

Both Solo Freelancers and Teams have access to "Meta-Management" tools to handle their internal
throughput.

##### The Global Workload Kanban

Users can track their entire business lifecycle through a customizable Global Kanban. This board
aggregates data from all active projects and proposals:

- **Proposals Sent:** Track open bids and active negotiations.
- **Ready:** Projects/Stages where Escrow is locked and work can begin.
- **In-Progress:** Active tickets currently being worked on.
- **Complete:** Finalized work awaiting the 24-hour payout window.

##### The "Board" Tab (Stage-Level)

Inside every Project Stage, next to the "Chat" and "Files" tabs, is the **Board**.

- This is a granular, internal Kanban specifically for that stage.
- **Purpose:** To break down a "Deliverable-Based" stage into micro-tasks (e.g., "Initial Sketch,"
  "Color Pass," "Exporting").
- **Client Visibility:** Clients can see the progress of the Board to maintain transparency without
  needing to interrupt via chat.

#### Sessions & Scheduling

Projective’s Session engine functions as a high-integrity calendar, similar to enterprise tools like
MS Teams or Google Calendar, but with integrated financial protection.

##### The Proactive Calendar

- **Work Windows:** Freelancers set their availability based on their local **Time Zone**, which the
  system automatically converts for the Client.
- **The Proposal Flow:** 1. Freelancer/Team proposes a Date, Time, and "Location" (Integrated Zoom,
  Google Meet, or Teams link). 2. **Notifications:** Attendees are notified via Webhook-driven
  Email, SMS, and In-App Push. 3. **The Handshake:** Attendees can **Approve** or
  **Counter-Propose**. 4. **Majority Decision:** In multi-attendee sessions (Group Sessions), a
  change in time requires a majority consensus to be finalized.

##### Cancellation & Escrow Protection

- **Freelancer Cancellation:** If a Freelancer cancels a session, the system triggers an **Immediate
  Full Refund** of the escrowed amount to the attendee(s).
- **Attendee Protection:** If an attendee cancels more than 24 hours in advance, they are refunded.
  Within the 24-hour window, the Escrow is forfeited to the Freelancer to compensate for the lost
  time slot.

---

### Projects & Services

Projective offers three distinct "Work Flows" to accommodate various professional engagements. While
every engagement requires a **Start Date**, an **End Date** is never mandatory, allowing for
open-ended collaborations and retainers.

#### The Three Work Flows

##### 1. One-Off Projects (The "Sprint")

One-off projects are essentially single-ticket Pipelines designed for a specific, finite objective.

- **Structure:** Defined by a single "Master Ticket" outlined in the project description.
- **Deadlines:** - **Soft Deadline:** A target date set by the client. Freelancers can be
  incentivised via a **Deadline Bonus**—a financial top-up released only if the final stage is
  approved before the soft deadline.
  - **Hard Deadline:** Defined simply by the completion and approval of all internal stages.
- **Visualization:** **Timeline View (Gantt Chart).** Focuses on the linear progression of stages
  toward a single delivery point.

[Image of a Gantt chart timeline for project management]

##### 2. Pipelines (The "Engine")

Pipelines are designed for high-volume, recurring, or complex multi-part work.

- **Structure:** Multiple "Tickets" moving through various columns/stages.
- **Dynamics:** Ideal for ongoing maintenance, content production, or software development where
  work is fed into the system continuously.
- **Visualization:** **Kanban Board.** Focuses on throughput, bottlenecks, and the current status of
  various work units.

##### 3. Session Services (The "Sync")

Sessions are time-bound, synchronous engagements for knowledge transfer or consultation.

- **Group Logic:** Can be configured as "Solo" or "Group" sessions. Group sessions allow for
  multiple attendees with optional seat caps.
- **Tutoring vs. Advisory:**
  - **Tutoring:** Freelancers can import a structured **Lesson Plan**. Each session corresponds to a
    specific curriculum module.
  - **Advisory:** No fixed plan; functions as recurring "Check-ins" (e.g., weekly consulting, health
    coaching).
- **Visualization:** **Calendar View.** Focuses on time-slots, availability, and upcoming
  synchronous events.

#### Services vs. Projects

The distinction between a "Project" and a "Service" lies in **Who Architects the Stages.**

| Attribute        | Project                               | Service                                            |
| :--------------- | :------------------------------------ | :------------------------------------------------- |
| **Originator**   | Client                                | Freelancer / Team                                  |
| **Definition**   | Client posts a Request.               | Freelancer lists a "Productized Service."          |
| **Architecture** | Client & Freelancer negotiate stages. | Freelancer pre-determines the stages/lesson plans. |
| **Flow Type**    | Usually One-off or Pipeline.          | Can be One-off, Pipeline, or Session-based.        |

##### Productised Services

Services allow freelancers to act as the "Lead Architect." A client may initiate a request (e.g., "I
need a 4-week SEO Audit"), but the freelancer provides the template. The client purchases the
service, and the corresponding Kanban, Timeline, or Calendar is automatically instantiated based on
the freelancer’s pre-set workflow.

##### Extension Logic

For both Projects and Services, the "End" is non-binding. If a client and freelancer agree to
continue, new tickets (for Pipelines) or new sessions (for Services) can be added to the existing
engagement, maintaining the historical data and communication thread.

---

### Clients & Businesses

While an individual can hire freelancers directly, the **Business** entity is designed for
organisations that need to coordinate multiple stakeholders, budgets, and projects under a single
umbrella.

##### What is a Projective Business?

A Business is a collaborative shell for project consumers. It acts as the "Employer of Record" for
the platform's workflows, providing a centralised point of management for work requested by various
team members.

- **Client / Operator Mode (Visibility Gate):** The Businesses space is a client-side surface gated
  by an account-level **Client / Operator Mode** modifier. An account only sees the Businesses space
  — and can only create or manage Businesses — once it has opted into Operator Mode. This keeps the
  client/hiring surface out of the way for accounts that operate purely as freelancers.
- **Draft-First Creation:** Creating a Business is low-friction — the owner supplies only a display
  **Name** and a unique alphanumeric **`@handle`**. The Business is created instantly in a
  **Draft/Unverified** state; legal name, logo, billing details, member roles, and financial setup
  are completed afterwards on the Business settings page.
- **Unified Management:** Instead of isolated projects, a Business can manage "Sets" of projects,
  allowing for cross-project visibility.
- **Shared Capital (The Business Wallet):** Much like Freelancer Teams, Businesses utilise a shared
  wallet. Funds can be pre-loaded into the vault, allowing individual managers to initiate "Escrow
  Locks" without needing access to a primary corporate credit card for every transaction.
- **Legal Simplicity:** The Business entity handles the administrative side of hiring, ensuring all
  contracts and invoices are issued to the organizational entity rather than individual employees.

##### Hierarchy & Role-Based Permissions

To prevent unauthorized spending and ensure project quality, Businesses utilise a strict hierarchy.
Roles define what a user can do within the Business context:

| Role                | Actions                                                                                                  |
| :------------------ | :------------------------------------------------------------------------------------------------------- |
| **Owner / Admin**   | Full access. Can manage the Business Wallet, set budget caps, and invite/remove members.                 |
| **Project Manager** | Can create new Projects/Pipelines, approve submissions, and release Escrow payments.                     |
| **Observer**        | View-only access to progress, analytics, and chat logs. Cannot approve payments or change project scope. |

##### Multi-Business Ownership

A single Projective account (User ID) is not tethered to a single organization.

- **Entrepreneurial Flexibility:** A user can own multiple Businesses (e.g., "Main Corp" and "Side
  Venture") and switch between them via the dashboard without re-logging.
- **Cross-Role Participation:** A user can be an **Owner** of Business A while simultaneously being
  a **Member** or **Freelancer** for Business B.

#### Business Operations & Analytics

Businesses have access to advanced tools designed to streamline the "Purchasing" side of the
marketplace.

##### Intervaled Invoicing

To satisfy accounting and tax requirements, Businesses can opt into an **Intervaled Invoicing
Model**.

- Instead of hundreds of micro-transactions on a bank statement, Projective generates a single,
  consolidated monthly invoice.
- This invoice summarises all Escrow movements, bonuses, and platform fees processed during that
  period.

##### Expenditure Analytics

The Business Dashboard provides a "Bird's Eye View" of organizational spend and project health:

- **Velocity Tracking:** Visualize how quickly tickets are moving through your various Pipelines.
- **Budget Burn-down:** Real-time tracking of how much capital is currently locked in Escrow versus
  what remains in the Business Wallet.
- **Performance Grading:** Data-driven insights into which Freelancers or Teams are delivering the
  highest ROI for the business based on revision counts and deadline adherence.

##### Workflow Orchestration

A Business can deploy its members across different initiatives:

- **Departmental Isolation:** "Marketing" members only see marketing pipelines, while "Product"
  members see software development timelines.
- **Centralized Oversight:** Owners can see the totality of the organization's engagement with the
  marketplace, ensuring no duplicate work is being commissioned across different departments.

---

### Messaging, Collaboration & Connections

Projective provides a multi-layered communication suite designed to facilitate high-velocity
collaboration while protecting the integrity of the marketplace.

#### 1. Platform Integrity & Monitoring

To maintain a secure and fair ecosystem, Projective implements an automated monitoring layer on all
messaging channels.

- **The Protected Phase:** From the initial proposal until the final Escrow release, messages are
  monitored for **PII (Personally Identifiable Information)**.
- **Restricted Data:** Sharing of bank details, external social media handles, personal emails, or
  phone numbers is strictly prohibited.
- **Consequences:** Attempting to circumvent the platform’s payment system results in severe
  penalties, ranging from temporary account suspension to permanent bans.
- **The "Projective Unlock":** Once a project is successfully completed and escrow is released,
  these restrictions are lifted. We encourage clients and freelancers to exchange contact details
  for long-term relationships or potential employment.

> **Why the change?** We believe that if Projective has successfully facilitated a high-value
> connection, that success is our best marketing. Furthermore, our internal tools—Kanban, Automated
> Invoicing, and Stage-tracking—are so deeply integrated that moving "off-platform" for active work
> would be an operational disadvantage.

#### 2. Channel Architecture

Communication is partitioned into specific channels to ensure that the right people have the right
context without "ping fatigue."

##### A. Stage Channels (Operational)

- **Scope:** One channel per Stage.
- **Participants:** The Client and all Freelancer(s)/Teams assigned to that specific stage.
- **Access Control:** The stage room is **stage-scoped, not project-scoped** — only the stage's
  assigned talent (an assigned freelancer, or an active member of an assigned team) and the
  client/owner side may open, read, or post in it. A project participant who is _not_ assigned to
  that stage is locked out of its room. (Enforced by `projects.has_stage_access` at the channel-open
  RPC and in the comms row-level-security policies; the project-wide General Channel below keeps the
  broader project-level access.)
- **Purpose:** Deep-dive discussions on current deliverables, task-specific feedback, and file
  iterations.

##### B. General Channel (Strategic)

- **Scope:** Project-wide.
- **Participants:** Everyone associated with the project (Client, Business members, and all
  Freelancers across all stages).
- **Purpose:** High-level announcements, project milestones, and general coordination.

##### C. Team Channels (Private - Freelancer Side)

- **Scope:** Internal to a Freelancer Team.
- **Participants:** Only members of a specific Team.
- **Logic:** If multiple teams are hired for one project, each team receives a separate, private
  channel. The Client cannot see these messages.
- **Access Control:** Talent-side only — an assigned freelancer or an active member of an assigned
  team. The client/owner is locked out. (Enforced by `comms.can_access_scope` on the `team_private`
  scope, at the channel-open RPC and in the comms row-level-security policies, so the channel never
  leaks over the realtime stream.)
- **Purpose:** Internal strategy, peer review, and task delegation.

##### D. Business Channels (Private - Client Side)

- **Scope:** Internal to the Client's Business.
- **Participants:** Only verified (active) members of the Business entity, plus the project owner.
- **Logic:** This channel is hidden from all freelancers.
- **Access Control:** Client-side only — the project owner or an active member of the paying client
  business (`projects.can_review_project`). (Enforced by `comms.can_access_scope` on the
  `business_private` scope in the comms RLS policies.)
- **Purpose:** Budget discussions, internal stakeholder alignment, and freelancer performance
  reviews.

#### 3. Technical Implementation: The "Handover" State

The protected phase is tracked at the project level by `projects.handover_unlocked_at` (NULL while
protected; a timestamp once unlocked), read via `projects.is_protected_phase`.

1. **Protected (`handover_unlocked_at IS NULL`)**: A `BEFORE INSERT` trigger on stage messages
   (`comms.mask_pii`) scans every payload and **masks + flags** any email address, external phone
   number, or third-party payment link/handle (the row is stored with a `[… hidden]` placeholder and
   `pii_masked = true`). Enforcement lives in SQL so it cannot be bypassed via direct writes; the
   `@projective/backend` `PIIFilter` mirrors the same rules for instant client feedback.
2. **The "Projective Unlock" (`handover_unlocked_at` set)**: When the **final escrow releases**
   (`projects.approve_stage` settles the last stage) — or the project is force-completed — the
   filter switches off for that project's threads and the full, unrestricted file library unlocks,
   allowing the "Contact Handover."

#### Notifications — what we tell you, and what you can turn off

Every notification belongs to one of eight **categories**: Money · Work · Messages · Schedule ·
Discovery · Account · System · Marketing. A user controls delivery at three grains — globally, per
category, and per individual event — across four transports (in-app, push, email, SMS).

Three product rules govern the whole surface:

1. **Some alerts cannot be turned off.** Anything that moves money, changes access, or affects legal
   standing — escrow and payout events, chargebacks, invoices, identity-verification outcomes,
   password and new-device events, permission changes, moderation decisions, policy updates — is
   **mandatory** and ignores every preference. A user is never left unaware that they were paid, that
   a payout failed, or that someone signed in as them.
2. **Quiet hours silence the interruption, not the record.** Inside a user's quiet window, push and
   SMS are withheld; the in-app inbox still receives everything, so nothing is lost. A small set of
   genuinely time-critical events (a session starting in minutes, a security alert, a failed payout)
   is allowed to break through, and a **global snooze is pierced only by critical alerts**.
3. **Unsubscribing from marketing never silences anything else.** An unsubscribe or a bounce
   suppresses that address for Marketing only — a transactional or security email still reaches it.

Supporting behaviours the user should expect: repeated events of the same kind **collapse into one
entry** rather than flooding the inbox (five messages in one channel become one line, not five); a
digest cadence rolls low-urgency mail into a daily or weekly summary delivered at the user's local
hour; an urgent alert left unread falls back to email after a short window; and **dismissing archives
rather than deletes**, so the record survives.

Reminders (a session at T-60/T-15/T-5, a nudge on an abandoned basket, a chase on a submission left
unreviewed) are scheduled ahead of time and **cancelled automatically when the reason disappears** —
cancelling a session cancels its reminders.

_Schema, routing precedence and delivery mechanics:
[`database/comms/`](../database/comms/Tables.md) · `SYSTEM_ARCHITECTURE.md` §The Notification
Engine._

---

### Escrow, Wallets & Finance

Projective’s financial layer is built on a **Trust-First** architecture. By utilizing a
multi-layered wallet system and a state-aware escrow engine, we ensure that no work begins without
funding and no payment is released without verification.

#### 1. The Wallet Ecosystem

Every entity on Projective has an associated **Vault**, but their behaviors differ based on their
organizational role.

##### Individual Wallets

The base unit of the platform. Every user has a personal wallet to hold earnings from freelance work
or personal funds for hiring.

- **Use Case:** Solo freelancers and individual clients.
- **Access:** Owner-only.

##### Business Wallets (The Pooled Fund)

Designed for organizations managing multiple projects and teams.

- **Centralized Capital:** Funds are held at the Business level. Individual Project Managers use
  this shared pool to fund Escrow tickets.
- **Hierarchy Controls:** Owners can set "Spending Caps" for Project Managers to prevent
  unauthorized budget depletion.
- **Analytics:** Provides a macro-view of organizational burn-rate across all departments. The
  `org.get_business_finance` wrapper reads live balances, transaction lines and escrow allocations
  directly from the ledger. Its former `/dashboard` overview page has been retired in favour of the
  persona-adaptive `/home` engagement feed; the dedicated business finance surface is being
  re-homed.
- **Opening Platform Credit (MVP demo path):** On creation every Business Wallet is seeded with a
  one-time promotional platform credit so the internal-wallet flow is exercisable end-to-end — a
  business can fund a Stage (debiting the credit into Escrow) and watch the hold/release move real
  ledger lines without an external top-up. This is a demo-path grant, distinct from any future
  real-money funding, and is recorded as a normal `demo_opening_credit` ledger entry.

##### Team Wallets (The Distribution Hub)

Designed for collaborator groups (Virtual Agencies).

- **Automated Splitting:** When a Stage payout is released to a Team, the Team Wallet instantly
  parses the **Contribution Agreement**.
- **Instant Disbursement:** Funds are automatically routed to the individual members' personal
  wallets based on their % stake, eliminating the "Master-Slave" payment delay common in traditional
  agencies.

#### 2. Escrow Lifetimes by Project Type

Escrow is a "Locked" state. While the money is in Escrow, it belongs to neither the Client nor the
Freelancer—it is held by the platform’s secure ledger.

| Project Type  | Lock Trigger                                                               | Release Trigger                                                                                       |
| :------------ | :------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **One-Off**   | **Upfront:** When the project or first stage begins.                       | **Manual:** Upon Client approval of the final deliverable.                                            |
| **Pipelines** | **Just-In-Time (JIT):** When a freelancer moves a ticket to "In Progress." | **Chain Reaction:** Approval of Ticket A releases payout and automatically locks Escrow for Ticket B. |
| **Sessions**  | **Booking:** When the time slot is confirmed.                              | **Negative Consent:** 24 hours after the session ends (assuming no "No-Show" claim).                  |

#### 3. Finance Tracking & Analytics

Projective provides a "Financial Control Center" for both sides of the marketplace to track their
fiscal health.

- **Ledger Transparency:** Every movement of capital (Deposit $\rightarrow$ Lock $\rightarrow$
  Release $\rightarrow$ Withdrawal) is logged with a unique transaction ID and a link to the
  corresponding Stage or Session.
- **Projected Revenue (Freelancer):** Analytics showing "Locked Capital"—money currently in Escrow
  for active work that hasn't been released yet.
- **Burn-Down Charts (Client):** Visual representation of budget consumption over time, especially
  useful for long-running Pipelines.

#### 4. Business Invoicing & Intervaled Billing

To bridge the gap between "Marketplace Speed" and "Corporate Accounting," Businesses utilise an
**Intervaled Invoicing** system.

- **Monthly Consolidation:** Instead of triggering a credit card charge for every $50 ticket,
  Projective tracks all Escrow activity within a 30-day window.
- **Consolidated Statement:** On the 1st of each month, the Business receives a single, legally
  compliant invoice covering all successful payouts and platform fees.
- **Over-Budget Safeguards:** If a Business attempts to lock Escrow for a project that exceeds their
  pre-approved monthly credit or current Wallet balance, the system prompts for a "Top-Up" or a
  budget increase before work can proceed.

#### 5. Funding, Payout Readiness & the "No Forever-Escrow" Guarantee

Money enters and leaves the platform through two deliberately asymmetric paths:

- **Clients pay with zero friction (tap-and-pay).** An individual client needs **no ID verification
  and no wallet** — they pay by card through Stripe (with an optional save-card for reuse). Buying
  should never require onboarding.
- **Freelancers must be _payout-ready before they earn_.** Identity verification (KYC) **and** a
  configured payout method are **onboarding gates**: a freelancer cannot land a gig or join a team
  until both are in place. This is the platform's **No Forever-Escrow Guarantee** — because every
  earner is payable before any work is accepted, funds can never become locked in a permanent,
  un-releasable escrow state.
- **Business owners verify to operate the pool.** Wallet verification (KYB) is required to _operate_
  a pooled Business Wallet — see §Identity Verification. (Concrete gates: `finance-model.md` §10
  KYC/KYB Gating.)

#### 6. Global Multi-Currency & Localized Money

Projective is currency-global by design.

- **You price and are paid in your own currency.** Every project, service, product, ticket, and
  stage is priced in the creator's local currency, and the creator is paid that exact amount in that
  currency. Stored and settled values never leave their origin currency.
- **You see money in yours.** Prices and balances are _displayed_ in each viewer's preferred
  currency — a purely presentational, read-time conversion that never changes what is stored or
  settled.
- **Settlement is reproducible.** The exchange rate used is captured at the moment money is
  committed, so a settlement figure never drifts with the market afterward.

(The base-currency choice, rate-snapshot mechanics, display-conversion service, and the **open**
question of who bears the FX spread are all in `finance-model.md` §11 Multi-Currency & FX.)

#### 7. Subscriptions, Allowances & Entitlements

Projective monetises **three axes, and never the fourth**. The distinction is a platform-level rule,
not a pricing detail:

| Axis                       | What it governs                                                              | Monetised?                    |
| :------------------------- | :--------------------------------------------------------------------------- | :---------------------------- |
| **Execution capacity**     | How much work a freelancer may hold concurrently                             | **Never** — governed by $W_i$ |
| **Distribution**           | Outbound proposals and invitations                                           | Yes — a tiered _allowance_    |
| **Marketplace footprint**  | Live public projects, published listings, entities owned, seats, promotion   | Yes — tiered caps             |
| **Reputation (Standing)**  | The earned rung a client reads before hiring                                 | **Never** — earned only       |

Charging for execution capacity would be the hourly-tracking sin Projective exists to avoid, and a
purchasable rung would make the trust signal worthless. Both are permanently off the table.

##### Governing principles

- **Plenty, then acceleration.** A user must never feel suffocated by their tier; the features they
  hold should feel plentiful, and upgrading should simply make sense. Free limits are set generously
  by intent.
- **Unlimited private drafting.** Drafting a project, service or listing is always free and always
  unlimited. Only going **live and public** consumes a footprint slot — you are never charged to
  think.
- **A freelancer is a superset of a client.** There is one universal free baseline that carries the
  full buyer experience; seller and scale upgrades layer on top. There is no separate client plan.
- **Two payment planes.** A **personal** plan raises what a _user_ may do; an **entity** plan raises
  what a _team/business/organisation_ may do. Owning more entities never powers them — each pays for
  its own muscle.
- **Joining is never capped.** Owning teams and businesses is metered; joining them is not.

##### Proposal allowances

Outbound proposals are metered per week, with a rolling buffer that returns a few every several
hours. This is an **anti-spam** mechanism, not a paywall: when the same handful of top performers
apply to every posting, the average freelancer is less likely to be chosen and the client's shortlist
is worse. A ceiling therefore exists on **every** tier — a paid plan raises it, never removes it, and
proposals are never sold à la carte. Withdrawing a proposal returns its unit.

An entity must hold at least **two members** before it may send proposals as a team.

##### Entitlement resolution

A subject's effective limit is **plan × earned rung**, then optionally raised by an administrative
grant. A grant may only ever raise a limit, never lower it. Concrete magnitudes, prices, the ladder
table and the fee-flex rules are in `finance-model.md` §16.

---

### The Hiring Process

Hiring on Projective is a two-way discovery engine. Whether a client seeks out a specific expert or
a freelancer applies to an open project, the final engagement is cemented through a modular
negotiation process at the **Stage** level

#### 1. Discovery Paths

There are two primary ways an engagement begins:

- **The Inbound Request (Freelancer-Led):** A freelancer or team browses the "Explore" page, finds
  an open project, and submits a **Proposal**. This may include a portfolio highlight or a brief
  cover note.
- **The Outbound Invitation (Client-Led):** A client uses the "Explore" page to find a freelancer or
  team that matches their needs and sends a direct **Invitation** to join a specific project or
  stage.

##### Discovery & Courtesy Calls (the third path)

Before either party commits to a negotiation, they may simply **talk**. A discovery call is a
short, scheduled conversation booked directly from a provider's availability page — the
lowest-friction way for a client to establish fit and for a provider to qualify a lead.

> **A discovery call is a conversion tool, not a deliverable.** It creates **no** Project, Stage, or
> Ticket; it never enters the delivery state-machine in
> [`PRODUCT_MANAGEMENT.md`](../PRODUCT_MANAGEMENT.md) §3.1; and it does **not** count toward
> Workload Intensity. This is the distinction that keeps a fifteen-minute chat from being
> administratively identical to a paid engagement.

**Two flavours.**

| | **Courtesy Call** (free) | **Paid Consultation** |
| :--- | :--- | :--- |
| Purpose | Establish fit, qualify a lead | Sell expertise directly |
| Money | None | Provider-set price |
| Escrow | **No** | Session money path (see the flag below) |
| KYC gate | **No** | Follows the standard Session rules |
| Flow | Request → Confirm → auto-generated meeting link (the **Calendar Handshake**) | As above, plus payment |

The courtesy call is the common case and is deliberately frictionless: no payment surface, no
verification wall, no negotiation. It must remain bookable even by a provider who has connected no
third-party tools at all — the platform falls back to a manually supplied link.

**Pricing.** A paid consultation is priced by the provider and is **not negotiable**, for exactly
the reason given in [§Why Sessions are Fixed](#why-sessions-are-fixed): consultation time is the
provider's product, and haggling over it reintroduces the friction the fixed-price rule exists to
remove.

**Availability is two layers, not one.** A provider's **working hours** say when they are at their
desk; a **call window** is the narrower subset during which they will accept an interruption. The
two are configured and displayed separately — "I am working" and "interrupt me" are not the same
statement. Providers additionally set **buffers** either side of a call (so bookings cannot be
stacked back-to-back), a **minimum notice** period, a **booking horizon**, and — for free calls
only — a **weekly cap** and a **per-requester cooldown**. These are burnout and abuse guards, and
they belong to the provider, not the platform.

**Cancellation, lateness and no-shows.**

- A **courtesy** call carries **no financial consequence**, because there is no money in it. A late
  cancel (inside the platform cancellation window) or a no-show is recorded as a **reliability
  signal only**.
  > **Open (flagged):** whether that reliability signal feeds the reputation / discovery-rank
  > machinery in [§Reputation & Discovery](#reputation--discovery) needs a deliberate decision.
- A **paid** consultation follows the Session cancellation rules. Those rules are subject to the
  standing, already-logged conflict between [`finance-model.md`](finance-model.md) §4 (50% penalty)
  and this document's Session table (full forfeit); per the source-of-truth hierarchy **this
  document wins**. The schema records the resulting refund/penalty per call rather than assuming
  either, so the ratified rule can be applied without a migration.

**Attendance is evidence.** When a call runs on a connected conferencing provider, participant
join/leave callbacks are logged as a **Digital Handshake** — the same evidence trail a delivered
Session Service produces, and the basis on which a no-show can be asserted rather than alleged.

**Where it is configured.** The public booking surface is the provider's availability page
(`/[handle]/availability`); the configuration — call windows, durations, fees, buffers, caps, and
connected conferencing tools — lives under Settings. See
[`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §Conferencing for the technical
contract and `documentation/database/scheduling/` for the schema.

#### 2. The Negotiation Logic

Projective distinguishes between "Intent" and "Agreement" through **Soft** and **Hard** budgets.

##### Soft Budget (The Anchor)

When a client creates a project, they set a **Soft Budget** for each stage. This acts as a public
signal of their price range and expectations. It is non-binding.

##### Hard Budget (The Contract)

The **Hard Budget** is the final, negotiated price that governs the Escrow lock.

- **The Client Proposal:** If hiring, the client proposes a specific rate for the stage.
- **The Freelancer Counter:** The freelancer can **Accept**, **Reject**, or **Counter-Offer** with a
  different rate.
- **The Iteration:** This "Counter-Offer" cycle continues until both parties agree. Once accepted,
  the Hard Budget is locked into the Stage's financial ledger.

> **Note:** A freelancer can be hired for multiple stages within the same project, each with its own
> independent Hard Budget and negotiation history.

#### 3. Budgeting by Project Type

The financial structure of a hire adapts to the workflow of the project type.

| Project Type  | Budget Basis    | Negotiation Type                                                |
| :------------ | :-------------- | :-------------------------------------------------------------- |
| **One-Off**   | **Per Stage**   | Full negotiation (Counter-offers allowed).                      |
| **Pipelines** | **Per Ticket**  | Negotiation on the "Unit Price" for all tickets in that stage.  |
| **Sessions**  | **Per Session** | **Fixed Price:** Set by the Freelancer/Service. No negotiation. |

##### Why Sessions are Fixed

Since Session-Based projects are defined as **Services** (the freelancer’s product), the price is
set by the provider. This ensures that advisors and tutors can maintain a consistent "Market Rate"
without the administrative friction of haggling over hourly time slots.

#### 4. Participation & Onboarding

Once the Hard Budget is accepted:

1. **Escrow Lock:** The system attempts to lock the first stage's budget from the Client/Business
   Wallet.
2. **Channel Access:** The freelancer is automatically granted access to the **General** and
   **Stage-Specific** messaging channels.
3. **Internal Board:** The freelancer can begin populating their internal **Board** (Kanban) for
   that stage to track their individual progress.

#### Individualized Hiring & Stage Roles

In many projects, a single Stage requires a diverse squad rather than a single individual.
Projective handles this through **Individualized Approvals**, allowing clients to build tailored
teams where each participant is compensated based on their specific experience and role.

##### 1. Stage Roles & Open Seats

When a client architects a Stage, they can define multiple **Seats**, each assigned a specific
**Role**.

- **Example Stage:** "Frontend Implementation"
  - **Seat 1 (Role: Architecture):** Targeted at senior freelancers or teams.
  - **Seat 2 (Role: Implementation):** Targeted at mid-level contributors.
  - **Seat 3 (Role: QA/Testing):** Targeted at specialised testers.

##### 2. The Granular Negotiation Flow

Because every freelancer brings a different level of expertise, negotiation does not happen at the
Stage level—it happens at the **Assignment level**.

- **Per-Seat Negotiation:** If a Stage has three open seats, the client initiates three separate
  negotiations.
- **Tailored Pay:** Freelancer A (Senior) may negotiate a Hard Budget of $2,000 for the
  'Architecture' seat, while Freelancer B (Junior) accepts $800 for the 'Implementation' seat.
- **Privacy of Rate:** Negotiation history and final Hard Budgets are private between the Client and
  the specific Freelancer/Team. Other participants in the same stage do not see each other's
  financial agreements.

#### 3. Approval & Onboarding Logic

To ensure the stage is properly funded, the system follows a **Cumulative Escrow** model:

1. **Individual Approval:** The client clicks "Hire" for a specific freelancer for a specific seat.
2. **Sub-Escrow Lock:** The system locks the Hard Budget for _that specific freelancer_ from the
   Business/Client Wallet.
3. **Stage Activation:** A stage can move to "In Progress" as soon as the first seat is filled and
   funded. Additional seats can be filled and funded while the stage is active. (A stage flips from
   **Open → Assigned** automatically when its first seat is filled.)
4. **No Double-Booking (Atomic Assignment):** Accepting an application is atomic and
   conflict-guarded: the same freelancer or team may not hold two live assignments on the same
   stage, nor be booked on two different stages whose scheduled windows overlap. Concurrent accepts
   of the same candidate are serialised (per-candidate advisory lock) so a race cannot slip a
   double-booking past the guard. (Enforced by `projects.assign_from_application` — advisory lock,
   an active-assignee unique index, and `projects.fn_assignee_slot_conflict`.)
5. **Resolution:** Payouts are released individually. If the "Junior" finishes their tasks and the
   client approves their contribution, their specific Escrow is released even if the "Senior" is
   still working on their part of the stage.

#### 4. Why This Matters for "Open Seats"

This model allows for **Elastic Squads**:

- **Scalability:** A client can post a stage with 10 "Task-Based" seats and hire 10 different
  freelancers at 10 different rates simultaneously.
- **Incentive Alignment:** You can hire a "Lead" on a high-fixed fee and "Reviewers" on smaller,
  per-ticket bonuses within the same stage.
- **Team Participation:** A "Team" can claim multiple seats within a stage, or a single seat if they
  are acting as a single unit (with internal payment splitting handled by their Team Wallet).
- **Team-Lead Application Authority:** Only a **Team Lead** (the team owner, or a member holding a
  `lead`/`admin` role) may submit an application on behalf of a team — an ordinary member cannot
  bind the team to a seat. An individual freelancer may only apply as themselves. (Enforced by
  `org.is_team_lead` inside `projects.apply_to_seat`.)

---

### Resource Allocation & Ticketing

To ensure project velocity and prevent freelancer burnout or "ticket hoarding," Projective utilises
a weighted resource allocation engine. This system balances automation (Pull-based work) with
organizational control (Push-based work).

#### 1. The Claim-and-Commit Protocol (Pipelines)

In Pipeline-based stages, tickets move through a refined state machine to prevent race conditions
and ensure accountability.

- **Ready (The Backlog):** Tickets are visible to all freelancers hired for the stage.
- **Claimed (The Lock):** When a freelancer "Claims" a ticket, it is soft-locked to their ID.
  - **Concurrency Check:** The system verifies the freelancer is under both their Project and Global
    caps.
  - **Escrow Lock:** The ticket-specific escrow is committed to that freelancer.
- **In Progress (The Commitment):** The freelancer moves the ticket to "Doing."
- **Claim Expiry (TTL):** To prevent "Ticket Parking," claimed tickets have a Time-To-Live
  (`claim_ttl_minutes`, default 24h). If no commitment is detected before the TTL expires, the
  `projects.fn_release_expired_claims` sweep auto-releases the ticket back to the backlog. A parked
  claim earns nothing: any escrow held at claim is **refunded to the client in full** and the
  freelancer is paid $0 — deliberately distinct from a mid-work removal (see "Freelancer Removal
  Mid-Ticket"), where the freelancer is compensated.

#### 2. The Weighting Engine (Workload Intensity)

Not all tasks are created equal. Projective calculates **Workload Intensity ($W_i$)** to measure a
freelancer's true bandwidth. This score is derived from the **CREATE** category weight multiplied by
a **Difficulty Multiplier**.

##### Baseline Category Weights

| Category    | Baseline Weight |
| :---------- | :-------------- |
| **Create**  | 1.5             |
| **Advise**  | 1.2             |
| **Educate** | 1.0             |
| **Run**     | 0.8             |
| **Test**    | 0.7             |
| **Empower** | 0.5             |

##### The Architect’s Override (Multipliers)

Clients can refine the intensity of a specific ticket using Difficulty Multipliers:

- **Low:** 0.5x
- **Standard:** 1.0x
- **High:** 2.0x

> **Formula:** $W_{ticket} = \text{CategoryWeight} \times \text{DifficultyMultiplier}$

#### 3. Concurrency Limits

To maintain platform health, the system enforces limits at two layers. Both are expressed as a sum
of Workload Intensity ($W_i$) and are validated by `projects.check_ticket_capacity` before **any**
claim or assignment; a violation raises a clean, user-facing error rather than silently over-loading
the freelancer:

1. **Project Hard Cap:** Set by the Client/Business on a stage
   (`project_stages.max_concurrent_intensity`, `NULL` = unlimited) — the max summed $W_i$ a single
   freelancer may hold concurrently within that stage (a cap of `2.0` == "max two standard-weight
   tickets").
2. **Global Soft Cap:** The max summed $W_i$ a freelancer may hold across all projects
   (`org.freelancer_profiles.max_workload_intensity`, falling back to the
   `global_workload_cap_default` platform parameter). At the global limit they cannot claim new
   tickets anywhere until they submit current work. The live figure feeds the **Workload Capacity
   Gauge** via `projects.get_workload_capacity`.

#### 4. Assignment Modes

Clients can configure how work is distributed within a stage:

- **Open Pull (Default):** Any hired freelancer can claim any "Ready" ticket, provided they have the
  capacity.
- **Round Robin:** The system automatically assigns the next ticket to the freelancer with the
  lowest current $W_i$.
- **Manual Assignment:** The Client/Business must explicitly assign tickets to specific freelancers.
- **Parallel Stream (One-Offs):** In one-off projects, all freelancers work on the stage objectives
  simultaneously. Payouts are tied to their individual seat contracts rather than specific ticket
  units.

> **Implementation:** a stage's `assignment_mode` (`projects.assignment_routing_mode` enum:
> `open_pull` | `round_robin` | `manual` | `parallel_stream`, set via
> `projects.set_stage_assignment_mode`) governs routing. Self-claim (`projects.claim_ticket`) is
> permitted **only** in `open_pull`; the other modes route through owner/system RPCs —
> `auto_assign_round_robin` (next ready ticket → the capacity-cleared roster member with the lowest
> current $W_i$), `assign_ticket_manual` (owner pin, override), and `assign_parallel_stream` (fan
> the stage's ready tickets across the roster for concurrent execution). Every path funnels through
> `projects.fn_assign_ticket_core`, so the concurrency caps above are always enforced. The owner
> selects the mode — and triggers a round-robin / parallel-stream pass — from the **Assignment
> routing** control in the stage's Staffing tab; the current mode is surfaced through
> `projects.get_stage_details`.

#### 5. Ticket Lifecycle & Business Rules

##### Creation & Purchasing Gate

- **Minimum Viable Creation:** A ticket requires only a **Title** to be created. Every other field,
  including the description, is optional at creation time.
- **Purchasing Gate:** A ticket cannot be purchased through any channel until a **Description** has
  been added. A title-only ticket is a draft placeholder — it is visible for planning but not yet
  sellable.

##### Payment Tracking (Installments)

Ticket payment is not a single lump-sum transaction. The system tracks a running **Amount Paid**
against the ticket's Hard Budget, since clients may fund a ticket in installments (e.g., topping up
a Business Wallet incrementally, or partial pre-authorization on Maintenance-cycle tickets — see
"Escrow, Wallets & Finance" §4 for the intervaled-billing equivalent at the Business level).

##### Purchase Methods

| Method              | Use Case                                                                                                            |
| :------------------ | :------------------------------------------------------------------------------------------------------------------ |
| **Buy Now**         | Immediate, single-ticket purchase and escrow lock.                                                                  |
| **Basket Checkout** | Batch-purchase multiple tickets across one or more stages/projects in a single checkout flow.                       |
| **Invoicing**       | For verified Business accounts (KYB Level 3) — routes through Intervaled Invoicing rather than an immediate charge. |

##### Escrow Lifecycle for Tickets

Funds enter escrow the moment a freelancer **claims** the ticket, and are released upon completion
(client approval) of the relevant stage. This is the same trigger already described under "Resource
Allocation & Ticketing" §1 (Claim-and-Commit Protocol) — the ticket-specific escrow is committed at
the **Claimed** step, not at the subsequent "In Progress" transition.

> **Note on existing terminology:** The "Escrow Lifetimes by Project Type" table (under "Escrow,
> Wallets & Finance" §2) describes the Pipeline lock trigger as "when a freelancer moves a ticket to
> 'In Progress.'" In practice a freelancer claims and begins a ticket in the same action, so these
> describe the same moment — but this section is the precise statement: the lock is tied to the
> **Claim**, not the later status change. Treat this section as the authoritative wording if the two
> ever need to be reconciled in code.

##### Ticket Movement, Placement & Default Stage Selection

- **Client-Initiated Movement:** Clients are permitted to move tickets between stages at will.
- **Multi-Stage Initialization:** A ticket may be created within one or multiple stages
  simultaneously, per the client's preference.
- **Default Selection Rules:**
  - If a ticket is created **from within a specific stage**, that stage is selected by default; any
    additional stages must be selected manually.
  - If a ticket is created as a **general ticket** (not initiated from within a specific stage), it
    defaults to having **all available stages** selected, in sequence.

##### Ticket Ordering

- **"New" Stage:** Clients may manually reorder tickets.
- **All Other Stages:** Order is determined automatically by most-recent-update timestamp — no
  manual reordering is available once a ticket has left "New."

##### Editing & Reordering Restrictions

- **Editing:** Clients may only edit a ticket that has **not yet been claimed** by a freelancer.
  Once claimed, ticket details (title, description, budget) are locked.
- **Stage Reordering Post-Claim:** Once a ticket is claimed, clients may only reorder the stages
  that have **not yet been started or claimed** — the claimed ticket's current and completed stages
  are frozen in sequence.

##### Deletion Protocol

- **Pre-Claim Deletion:** Processed immediately — no escrow exists yet, so there is nothing to
  release.
- **Post-Claim Deletion:** Any escrowed funds are released to the freelancer in full, and the client
  incurs no further charge. This mirrors the "Fair Exit" spirit described in `finance-model.md` §3,
  but for outright ticket deletion (rather than a time-based split) the freelancer receives the full
  escrowed amount, not a partial one.

##### Freelancer Removal Mid-Ticket

If a freelancer is removed from a stage or project while actively holding a claimed ticket:

1. Escrowed funds for that ticket are released to the freelancer immediately.
2. The ticket's status is reset to **"New,"** returning it to the public backlog so another
   freelancer can claim it.

##### Dispute Mechanism: Workload Intensity Reporting

A freelancer may report a ticket if they believe its assigned Workload Intensity ($W_i$, see
"Resource Allocation & Ticketing" §2) does not reflect the actual effort required.

1. **Report Filed:** The ticket enters a 48-hour **"Hidden"** status — it is removed from public
   view and all work on it is suspended.
2. **Resolution Window:** If the client increases the ticket's Workload Intensity within the 48-hour
   window, the ticket is unhidden and work resumes at the new $W_i$.
3. **Client Non-Response:** If the client does not adjust the $W_i$ within 48 hours, **both parties
   incur a penalty** (see "Reputation & Discovery" §1 for how penalties feed the Reliability Index).
4. **Unsubstantiated Report:** If the report is resolved with no $W_i$ change (i.e., a moderator or
   the client determines the original weighting was fair), the reporting freelancer receives a
   **ranking reduction** on the Explore page.

---

### Stage Management

Stages are the client's primary organizational unit within a project, and clients retain full CRUD
control over them, subject to the protections described below once tickets are actively claimed.

#### 1. Client Capabilities

Clients are authorized to **create, rename, edit, reorder, and delete** stages at any point in a
project's lifecycle.

#### 2. Stage Reordering

Reordering the stages themselves does **not** alter the existing sequence or order of the tickets
assigned within those stages — ticket order (per "Resource Allocation & Ticketing" §5, Ticket
Ordering) is preserved independently of where the stage sits in the overall project sequence.

#### 3. Stage Deletion

- **Active Tickets:** If a stage containing active (claimed, escrowed) tickets is deleted, all
  escrowed funds for those tickets are released to the freelancer(s) — the same outcome as a
  post-claim ticket deletion.
- **Dangling Requirements:** If the deleted stage was listed as a required stage on any other
  tickets (per the Multi-Stage Initialization rule above), it is automatically removed from those
  tickets' stage requirements rather than leaving a broken reference.

---

### Digital Marketplace & IP Governance

The Projective Marketplace is a repository for templates, artwork, digital assets, and code. It
functions both as an independent storefront for creators and as a secondary lifecycle for
project-derived assets.

#### 1. Intellectual Property (IP) Framework

Projective operates on a "Client-First" IP default to protect business interests, with a structured
pathway for shared ownership.

- **Default State (Client-Only):** Upon final escrow release, the Intellectual Property of all
  deliverables is transferred 100% to the Client. The Freelancer retains only the right to display
  the work in their Projective portfolio (unless a Non-Disclosure Agreement is in place).
- **The Shared IP Request:** A Freelancer may request "Marketplace Rights" for assets created during
  a project.
  - **Negotiation:** The Client must explicitly approve this request.
  - **Result:** The IP status changes to **Shared Ownership**, granting the Freelancer the legal
    right to list and sell the asset (or derivatives) on the Projective Marketplace.
- **Independent Assets:** Creators may upload and sell assets created entirely outside of a platform
  project. These are 100% owned by the creator.

#### 2. Marketplace Sourcing

The marketplace populates from two distinct sources:

1. **Project-Derived Assets:** Assets built during a One-Off Project or Pipeline. These are linked
   to the original project ID for provenance tracking.
2. **Independent Listings:** Assets uploaded directly by a seller (e.g., a UI Kit, a custom font, or
   a Shopify template).

#### 3. The "Request to Sell" Workflow

To maintain trust, the transition from "Project Deliverable" to "Marketplace Product" follows a
strict approval gate:

1. **Submission:** Freelancer completes the project/stage work.
2. **Request:** Freelancer triggers the "Request Marketplace Listing" action.
3. **Client Review:** The Client reviews the request. They may grant shared IP for the whole asset
   or specific components (e.g., "You can sell the UI layout, but not the logo").
4. **Listing:** Once approved, the asset is minted as a **Marketplace Listing** with a cryptographic
   link back to the original project for IP verification.

#### 4. Dispute Resolution & Legal Documentation

Projective acts as the **System of Record** for IP ownership but does not act as a legal arbiter for
off-platform activity.

- **On-Platform Disputes:** Similarity claims are only investigated if a Freelancer lists an asset
  derived from a project they worked on _without_ obtaining Shared IP approval. In these cases,
  Projective may remove the listing and suspend the seller.
- **Off-Platform Sales:** If a Freelancer sells project-derived assets on a third-party site without
  permission, Projective cannot intervene directly.
- **The IP Audit Trail:** Projective provides both Clients and Freelancers with **Verified IP
  Documentation** (timestamps, chat logs, and escrow release records) to be used as evidence in
  external legal proceedings.

#### 5. Revenue & Royalties

When a project-derived asset is sold, the marketplace logic can be configured to support:

- **Direct Sale:** Freelancer takes the revenue (minus platform fee).
- **Shared Royalty:** A percentage of every sale is automatically routed to the original Client's
  wallet as a "Founding Partner" incentive for allowing the asset to be sold.

---

### Reputation & Discovery

Projective is a meritocracy. Discovery is driven by a combination of verified performance data,
current availability, and mutual trust. We prioritize actual output over "Pay-to-Win" mechanics,
ensuring that the best-performing and most available freelancers are always surfaced to the right
clients.

#### 1. The Reliability Index ($R_i$)

Instead of a binary star rating, Projective calculates a multi-dimensional **Reliability Index**.
This score is derived from hard data captured by the `ResourceAllocation` engine.

##### Performance Metrics

- **Velocity:** Measured by the average time taken to move a ticket from `Claimed` to `Complete`
  relative to the estimated $W_i$ (Workload Intensity).
- **Accuracy:** The ratio of **Initial Approvals** vs. **Revision Requests**. High accuracy
  indicates a freelancer who understands requirements the first time.
- **Retention:** The "LTV" of a freelancer-client relationship. It tracks how many clients return
  for a second project or add additional tickets to an existing pipeline.

> **The "Architect" Tier:** Freelancers who consistently manage multi-person Stages with high
> Velocity and Accuracy earn the "Architect" designation. This unlocks the ability to lead
> Team-based projects and architect Stage templates for the Marketplace.

#### 2. Dynamic Search & Availability Boost

To prevent "Marketplace Entrenchment," the search algorithm is **Workload-Aware**.

- **The Discovery Loop:** A high-reputation freelancer who is currently at their **Global Intensity
  Cap** will see their ranking temporarily lowered.
- **The Fighting Chance:** Newer or less experienced freelancers with 100% availability and a clean
  (even if short) track record receive a "Discovery Boost."
- **Recommender Logic:** For freelancers browsing the "Explore" page, the system utilises their
  project history and "Saved" preferences to surface Pipelines and One-Offs that match their
  demonstrated skill set.

#### 3. Reciprocal Reviews

Trust is a two-way street. Projective enforces a review system that protects both the workforce and
the purchasers.

##### Governance Rules

- **Atomic Reviews:** A Project/Service must be completed, or a freelancer must have exited the
  engagement, before a review can be submitted.
- **Entity Consolidation:** A **Business** counts as a single entity. Individual members within a
  business cannot spam reviews; only one aggregate review per business-freelancer engagement is
  permitted.
- **Reciprocity:** Freelancers and Teams provide ratings for Clients and Businesses. These ratings
  contribute to the **Client Trust Score**.

##### The Warning System

If a Client or Business falls below a critical Trust threshold:

1. **Search Penalty:** Their project posts are de-ranked on the Explore page.
2. **Safety Guard:** When a freelancer attempts to join a low-rated project, the UI triggers warning
   modal.
3. **Informed Consent:** The freelancer must acknowledge the low rating and review the client's
   history before the system allows them to submit a proposal or accept a hire.

#### 4. Discovery for Services

Services (Sessions, Templates, and Productized Pipelines) are ranked using the same **Reliability
Index**.

- **Session Attendance:** For Session Services, the "Reliability Index" is heavily weighted by the
  **Digital Handshake** data (No-show rates).
- **Marketplace Feedback:** For templates and digital assets, ranking is driven by "Utility Scores"
  (successful downloads and positive usage signals from clients who implemented the asset).**

#### 5. Standing, Mastery & Progression

**Standing** is the client-facing rung of the Reliability Index — the same score, discretised into a
five-step ladder (New → Established → Trusted → Expert → Elite) so that both a freelancer and a
prospective client can read it at a glance. It does not replace $R_i$; it is $R_i$ made legible.

##### The governing rule of gamification

> **Every reward must map to something a client independently values. Reputation is the currency, not
> points.**

Projective is moving real money through escrow, and clients are paying for professionalism. The
moment progression feels like an arcade, it cheapens what the client is buying and invites gaming.
Held to that rule, progression stops being a bolt-on feature and becomes the platform's competitive
position: incumbents rank by who earned most or paid most; Projective ranks by who is **reliable and
available**.

##### What a rung unlocks

Standing carries real capacity, not cosmetics: a larger published-listing allowance, a weekly
proposal bonus, a higher discovery weighting, and a lower marketplace commission at the top rungs.
There are therefore **two paths up the same mountain — earn it, or accelerate it with a
subscription — and they stack.** A high-standing free user is rewarded rather than starved, and a
paid plan reads as an accelerant rather than a gate.

##### What moves a rung

Stage completion, on-time delivery, the dual-track review scores, a low dispute rate, $W_i$
reliability (delivering at capacity without dropping tickets), and tenure — each offset by active
penalties. **Never raw earnings and never raw proposal counts.** Ranking by spend or by volume is the
pay-to-win trap the ladder exists to avoid. A volume floor also applies at each rung, so a single
flawless engagement cannot vault a newcomer to the top.

##### CREATE mastery

Because every stage is typed against the CREATE framework, a freelancer's specialisation is
**derived** from what they have actually delivered rather than self-declared — an intensity-weighted
share per category that surfaces as "Create specialist", "Advise specialist", and feeds discovery
matching so Create-heavy stages route to proven Create deliverers. No competing marketplace can
compute this, because none have the stage taxonomy.

##### Streaks, milestones and designations

Streaks track **delivered quality** — on-time delivery, fast response, dispute-free runs — and are
visible to clients because they are things a client cares about. Milestones (first payout, first
five-star, a returning client) are light celebratory garnish. A **designation** such as _Architect_
carries real capability: leading multi-person, team-based stages and authoring Marketplace stage
templates.

Deliberately absent: login and attendance streaks, vanity points detached from client value, and
public earnings leaderboards. The first is hostile to freelancer wellbeing, the second cheapens the
signal, and the third drives race-to-the-bottom pricing.

##### Buyers are not gamified

Clients, businesses and organisations carry the **Client Trust Score** and verification badges, not a
Standing rung. Buyers want efficiency and trust, not quests; over-gamifying that side makes serious
clients leave.

(Rung thresholds, the score weighting, the listing/proposal/commission ladder and the interaction
with subscriptions are all in `finance-model.md` §16.3.)

---

### Dispute Resolution

While Projective's Stage-based architecture and "Digital Handshakes" minimize friction, disputes can
occur. Our resolution process is designed to be data-driven, objective, and prioritized toward
mutual agreement.

#### 1. The Evidence Vault (Immutable Audit)

The moment a formal dispute is raised, the `DisputeService` creates an **Evidence Vault**. This is a
point-in-time, immutable snapshot of the project’s state, ensuring that neither party can "clean up"
or delete evidence after a dispute has begun.

The Vault captures:

- **The Board:** All internal tasks, their completion status, and who checked them off.
- **Communications:** Full chat logs from General, Stage, and relevant Business/Team channels.
- **Files:** The exact versions of files submitted for the disputed stage.
- **Metadata:** IP addresses, timestamps for "Digital Handshakes" (sessions), and browser metadata
  for presence verification.

#### 2. The Resolution Lifecycle

We utilise a tiered escalation model to reduce the need for platform intervention and speed up
capital recovery.

##### Phase 1: Mutual Resolution (The "Refund Offer")

Before an auditor is assigned, the system forces a 48-hour "Cooling Off" period where the parties
must attempt a manual settlement.

- **The Tool:** A specialised interface where the Client can request a partial refund (e.g., "Give
  me back 50% of the Escrow") or the Freelancer can offer a partial release.
- **The Outcome:** If both parties agree to a percentage, the `EscrowService` executes the split
  immediately and closes the dispute.

##### Phase 2: Platform Intervention (The "Audit")

If no agreement is reached in Phase 1, either party can escalate the case to a **Projective
Auditor**.

- **Audit Process:** A neutral third party reviews the Evidence Vault against the original **Stage
  Requirements** and **CREATE Framework** objectives.
- **Decision:** The Auditor has the authority to release the funds to the freelancer, refund them to
  the client, or execute a split they deem fair based on the proof of work.

#### 3. Session-Specific Disputes (No-Show Claims)

For Session-Based Services, disputes are largely automated through our conferencing integrations.

- **The Attendance Audit:** If a client claims a "No-Show," the system automatically
  cross-references the Zoom/Meet/Teams Webhook logs in the Evidence Vault.
- **Deterministic Ruling:**
  - If the logs show the Freelancer never joined: **Instant Refund.**
  - If the logs show both joined for >80% of the duration: **Claim Dismissed.**
  - If the logs are ambiguous: **Escalated to Manual Audit.**

#### 4. Reputation Impact

Disputes have a significant weight on the **Reliability Index ($R_i$)**.

- **The "Strike" System:** Frequent disputes, even those resolved in the freelancer's favor, will
  trigger a "Quality Audit" of the freelancer's services.
- **Bad-Faith Reporting:** If a client is found to be abusing the dispute system to avoid payment
  (demonstrated by a pattern of "No-Show" claims that are proven false by API logs), their Business
  Trust Score is severely penalized.

#### 5. Finality & The Legal Shield

Once an Auditor makes a final ruling, the Escrow is released, and the transaction is considered
closed on the platform.

- **Post-Resolution:** Users are provided with a "Dispute Summary PDF" containing the Evidence Vault
  hash. This document can be used as the definitive record if either party chooses to pursue the
  matter in a local court of law.

---

### Identity, Taxes & Compliance

To operate as a high-trust global marketplace, Projective implements a rigorous compliance layer.
This ensures that every participant is verified, every transaction is reported correctly to tax
authorities, and the platform remains protected against financial crime.

#### 1. Identity Verification (KYC & KYB)

Projective uses a tiered verification system to balance ease of onboarding with enterprise-grade
security.

- **Level 1: Basic (Individual):** Email and Phone verification. Allows for limited project
  participation and small-cap Escrow locks.
- **Level 2: Verified (Freelancer/Client):** Requires Government ID and biometric "liveness" checks
  (via Stripe Identity). Necessary for significant payouts and appearing in the "Explore" rankings.
- **Level 3: Business (KYB):** Requires corporate registration documents and "Ultimate Beneficial
  Owner" (UBO) verification. Necessary to open a **Business Wallet** and utilise **Intervaled
  Invoicing**.

> **Where each gate applies (refinement, 2026-07-23 — logged in root `CLAUDE.md` §8):** Level-2
> verification is a **freelancer onboarding gate** (an earner is verified _before_ landing a gig,
> not only at payout time), and **individual clients are exempt** — buying is tap-and-pay, requiring
> no ID and no wallet (§Escrow, Wallets & Finance #5). Level-3 KYB is required to **operate** a
> pooled Business Wallet. This narrows the former "Freelancer/Client" Level-2 label to the earner.
> Concrete gate + predicates: `finance-model.md` §10.

#### 2. Automated Tax Compliance

Projective removes the "Tax Season" headache by automating the generation of all necessary tax
documents based on the platform's transaction ledger.

##### For US-Based Users

- **Form 1099-K/1099-NEC:** Automatically generated for freelancers who exceed federal or state
  earning thresholds.
- **W-9 Collection:** Seamlessly collected during the Level 2 verification process.

##### For International Users (VAT/GST)

- **Reverse Charge Mechanism:** For B2B transactions within the EU, Projective automatically handles
  VAT ID validation and applies reverse-charge logic to invoices.
- **Tax Residence Certificates:** Centralized storage for freelancers to provide proof of residency
  to clients for withholding tax exemptions.

#### 3. Anti-Money Laundering (AML) & Fraud Detection

The `ComplianceService` monitors all movement of capital within the platform's wallets to detect and
prevent illicit activity.

- **Suspicious Pattern Detection:** Automated flags for "Round-Tripping" (where a user hires
  themselves via a second account to move money) and "Rapid Churn" (large deposits followed by
  immediate withdrawal requests).
- **Sanctions Screening:** All users are screened against global watchlists (OFAC, etc.) during
  Level 2 and Level 3 verification.
- **The "Safety Hold":** New accounts or high-risk transactions may be subject to a 72-hour security
  hold before funds can be withdrawn from the platform.

#### 4. Legal Handover & IP Documents

Compliance doesn't end with money; it extends to the **Chain of Title** for Intellectual Property.

- **The IP Transfer Deed:** Upon the release of Escrow, Projective generates a cryptographically
  signed **Deed of Transfer**. This document links the specific file hashes, project IDs, and
  participant IDs, serving as a permanent legal record of the IP handover.
- **Verified Audit Trail:** In the event of a dispute or an acquisition, Projective can provide an
  "Organization Audit Pack," which includes all contracts, invoices, and IP deeds in a single,
  verified bundle.

#### 5. Data Privacy & The "Vault"

Projective treats sensitive identity data with "Zero-Trust" principles.

- **PII Encryption:** Sensitive data (SSNs, Passport numbers) are never stored in plain text. We
  utilise **Supabase Vault** and AES-256 encryption at the application layer.
- **Retention Policies:** We strictly adhere to GDPR/CCPA "Right to be Forgotten" protocols, while
  maintaining the minimum data required by financial regulators for tax auditing (typically 7
  years).

---

## Account Creation, Age Guardrails & Onboarding

_Added 2026-07-13 (see root `CLAUDE.md` §8, decisions 5–7). Governs `/join`, `/login`,
`/forgot-password`, and `/verify`._

### Authentication surfaces

MVP auth is **Google OAuth + email/password** (per `SYSTEM_ARCHITECTURE.md` §Authentication).
Canonical routes: **`/join`** (account creation), `/login`, `/forgot-password`, `/verify` (6-digit
email code — the `CodeField` OTP pattern). Email confirmation still ultimately rides on GoTrue's
single-use token; the 6-digit entry is the in-app confirmation surface.

`/login` additionally offers an **Enterprise SSO** path (new, 2026-07-13): the user enters a
corporate email **domain** (e.g. `company.com`) which is resolved to that organization's configured
**SAML/OIDC** identity provider to begin the handshake (`/api/auth/sso`). SSO IdP wiring is deferred
(the surface ships now, provider resolution lands with Supabase/enterprise onboarding); this sits
alongside the roadmap's Microsoft/GitHub/Apple SSO in `SYSTEM_ARCHITECTURE.md` §Authentication.

### Onboarding step sequence (single-screen, non-scrolling wizard)

`/join` is a fixed, viewport-height (no-scroll) two-column experience: a deep-primary **illustrative
sidebar** — a single large SVG scene that adapts to the active step, expressive imaginative step
titles (never a literal "Step 1.2"), and a progress track — beside a stepped form. Choice-only steps
**auto-advance** the instant a card is picked (no "Next" click), and the first step opens
**neutral** (neither account type pre-selected).

**Account paths diverge on the first choice.** An **Individual** is asked **1.2** Client or
Freelancer _(required)_. An **Organization is a buyer/client by definition** — it registers to hire,
**not to provide services** — so it **skips 1.2 entirely** and never sees the Freelancer-only skills
step.

Step slots: **Step 1** account type (Individual / Organization) · **1.2** Client or Freelancer
_(Individual only; required)_ · **1.3** Purpose _(Individual: optional interest tags, max 5;
Organization: scale — employees + industry + **website / corporate domain**)_ · **1.4** Skills &
interests _(Individual: optional, max 5, **shown only when Freelancer**; Organization: structure —
address + departments)_ · **1.5** identity _(Individual: first/last/username; Organization:
legal/brand name, handle, CRN)_ · **1.6** credentials _(Individual: email, DoB, password;
Organization: corporate email, phone, admin password)_. **Password setup is skipped entirely for
OAuth/SSO signups.** Individuals may reach for **Google OAuth at any step** — authenticating
mid-flow pre-fills their identity and returns them to the flow rather than bypassing it.

The optional Purpose/Skills tags are chosen from an interactive **pill cluster** with a combobox for
adding custom tags, capped at **5** per cluster.

### Return-path redirection (`redirectTo`)

Every auth surface carries a **`redirectTo`** query parameter — the in-app path the user was on
before entering the flow. After a successful join/login **and** verification, the user is returned
to that exact path. `redirectTo` is untrusted input and is sanitised to a **same-origin absolute
path** before use (open-redirect guard). The dashboard auth-guard bounce populates it (renamed from
`redirect` → `redirectTo`, 2026-07-13, for one consistent contract).

### Google OAuth pre-fill

If a Google sign-in succeeds but no Projective profile exists yet, the OAuth callback routes the
user to **`/join`** with their Google **first name, last name, email, and profile picture**
pre-filled. Pre-filled avatar URLs are host-allowlisted (provider CDNs + the media fallback
registry); names/email are length-clamped.

### Age guardrails (Date of Birth)

Individual signup collects **Date of Birth** and enforces, on both client and server:

| Age         | State          | Capability                                                                     |
| :---------- | :------------- | :----------------------------------------------------------------------------- |
| **< 13**    | **Blocked**    | Cannot create an account. A friendly minimum-age message is shown.             |
| **13 – 17** | **Restricted** | Account is created but flagged: **cannot buy services or sell work until 18.** |
| **≥ 18**    | **Full**       | Unrestricted access.                                                           |

The `restricted` flag is **re-derived server-side from DoB** (never trusted from the client) and
persisted on the individual profile; buy/sell capability unlocks automatically at 18. (Constants:
`MIN_AGE = 13`, `ADULT_AGE = 18`.) This state is capability-scoped and does not add a column to the
work/delivery status machine in `PRODUCT_MANAGEMENT.md`.

### Individual onboarding — "quick to onboard, slow to set up"

Deliberately lean (consistent with the low-friction, Draft-First creation philosophy for Teams and
Businesses). Collected at signup **only**:

- **Intent:** Client ("I want to hire") or Freelancer ("I want to work"). This seeds the initial
  active session context **only** — personas remain **additive** (§Additive, Unlockable Personas): a
  Client can unlock a Freelancer profile later via `/become-partner`, and vice-versa.
- **Credentials:** Email, Password (+ confirm).
- **Profile basics:** First name, Last name, Username (`@handle`), Date of Birth.

Everything else (photo, headline, story, skills, professional details) is completed later inside the
app shell — the UI states this explicitly.

### Organization onboarding — comprehensive, multi-step

Business/enterprise signup is the deliberate opposite: a structured wizard. Collected at signup:

- **Company & identity:** Legal company name; Trading / brand name (if different); Company
  Registration Number (CRN) / Tax ID (EIN, VAT, …).
- **Administrative & contact:** Primary corporate email (billing/legal notices); Corporate phone;
  Registered business address (street, city, postcode/ZIP, country).
- **Scale & structure:** Estimated employees (tiers **1–50 / 51–200 / 201–500 / 500+**); Primary
  industry / sector.
- **Initial IAM:** Initial **departments** (expandable top-level list); initial **admin/stakeholder
  invites** (repeatable Name · Email · base permission tier).
- **Admin login:** the owning admin's name + password (signs in with the corporate email).

> The organization is still created in a **Draft/Unverified** state; full KYB (registration
> documents, UBO) remains deferred to verification Level 3 before a Business Wallet opens. This
> onboarding **gathers** the identity/scale/IAM baselines up front; it does not itself complete KYB.

## Sitemap and Route Overview

| Category      | Path / Route              | Sub-Path                 | Description                                                                                    |
| :------------ | :------------------------ | :----------------------- | :--------------------------------------------------------------------------------------------- |
| **Auth**      | `/onboarding`             |                          | User onboarding flow                                                                           |
|               | `/reset`                  |                          | Reset password                                                                                 |
|               | `/verify`                 |                          | Account verification                                                                           |
|               | `/login`                  |                          | User login                                                                                     |
|               | `/join`                   |                          | User registration (account creation — canonical; renamed from `/register`, 2026-07-13)         |
|               | `/forgot-password`        |                          | Password recovery                                                                              |
| **Dashboard** | `/home`                   |                          | Persona-adaptive engagement feed (recommended work, reels, activity, profile-setup tracker)    |
|               | `/become-partner`         |                          | Freelancer conversion funnel (Client/Operator → unlock freelancer suite)                       |
|               | `/articles/[slug]`        |                          | Editorial reader for freelancer stories linked from `/become-partner`                          |
|               | `/business`               |                          | Show all businesses                                                                            |
|               | `/business/create`        |                          | Create a new business                                                                          |
|               | `/business/[business id]` | `index`                  | View business details                                                                          |
|               |                           | `members`                | View business members                                                                          |
|               |                           | `settings`               | Edit business settings                                                                         |
|               |                           | `projects`               | View business projects                                                                         |
|               |                           | `billing`                | Stripe Connect integration                                                                     |
|               |                           | `invoices`               |                                                                                                |
|               | `/connections`            | `index`                  | View network connections                                                                       |
|               | `/messages`               | `index`                  | All messages list                                                                              |
|               | `/messages/[message id]`  | `chat`                   | Active conversation                                                                            |
|               |                           | `details`                | Message/Contact info                                                                           |
|               |                           | `files/index`            | List shared files                                                                              |
|               |                           | `files/[file id]`        | View specific file                                                                             |
|               | `/settings`               | `index`                  | General account settings                                                                       |
|               | `/teams`                  | `index`                  | Show all teams                                                                                 |
|               | `/teams/create`           |                          | Create a new team                                                                              |
|               | `/teams/[team id]`        | `index`                  | View team details                                                                              |
|               |                           | `members`                | View team members                                                                              |
|               |                           | `settings`               | Edit team settings                                                                             |
|               |                           | `projects`               | View team projects                                                                             |
|               |                           | `vault`                  | Shared wallet access                                                                           |
|               | `/analytics`              | `index`                  | Performance data                                                                               |
|               | `/wallet`                 | `index`                  | Overview of wallets                                                                            |
|               |                           | `create`                 | Setup new wallet                                                                               |
|               |                           | `[wallet id]`            | View specific wallet                                                                           |
|               | `/projects`               | `index`                  | List all projects                                                                              |
|               | `/projects/create`        |                          | Start a new project                                                                            |
|               | `/projects/[project id]`  | `index` / `details`      | Project overview                                                                               |
|               |                           | `board`                  | Task/Kanban board                                                                              |
|               |                           | `finance`                | Project budget/costs                                                                           |
|               |                           | `settings`               | Project configuration                                                                          |
|               |                           | `team`                   | Project-specific members                                                                       |
|               |                           | `timeline`               | Roadmap view                                                                                   |
|               |                           | `calendar`               | Project dates                                                                                  |
|               |                           | `[channel id]/index`     | In-project channel/DM conversation (`/projects/[project id]/[channel id]`; §Unified Messaging) |
|               |                           | `[stage id]/index`       | Specific stage view                                                                            |
|               |                           | `[stage id]/review`      | Stage approval/review                                                                          |
|               |                           | `[stage id]/files`       | Stage-specific files                                                                           |
|               |                           | `[stage id]/submissions` | Stage deliverables                                                                             |
|               | `/disputes`               | `index`                  |                                                                                                |
|               |                           | `[dispute id]`           |                                                                                                |
|               | `/legal`                  | `index`                  |                                                                                                |
|               |                           | `audit-packs`            |                                                                                                |
|               |                           | `transfers`              |                                                                                                |
|               | `/services`               | `index`                  |                                                                                                |
|               |                           | `create`                 |                                                                                                |
|               |                           | `availability`           |                                                                                                |
| **Public**    | `/index`                  |                          | Landing Page                                                                                   |
|               | `/about`                  |                          | Company information                                                                            |
|               | `/explore`                |                          | Discovery/Search                                                                               |
|               | `/[handle]`               | `index`                  | Public profile home                                                                            |
|               |                           | `reviews`                | User reviews/ratings                                                                           |
|               |                           | `teams`                  | Public team listings                                                                           |
|               |                           | `projects`               | Public project showcase                                                                        |
|               |                           | `services`               | Offered services                                                                               |
|               |                           | `products`               | Products for sale                                                                              |
|               |                           | `articles`               | Blog/Published posts                                                                           |
|               |                           | `portfolio`              | Work portfolio items                                                                           |
|               | `/help/[...article path]` | `index`                  | Documentation / Help center                                                                    |
|               | `/view/[entity type]`     | `index`                  | Public entity viewer                                                                           |

---

## Tech Stack

Projective is engineered for maximum performance, type-safety, and developer velocity. The following
stack has been selected to support our high-trust financial architecture and modular "Virtual
Agency" logic.

| Layer            | Choice                    | Rationale                                                                                                             |
| :--------------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| **Runtime**      | **Deno 2.x**              | Secure-by-default, native TypeScript support, and zero-config workspace management.                                   |
| **Framework**    | **Fresh 2.x**             | **Islands Architecture** ensures zero-JS by default for public pages with selective hydration for complex dashboards. |
| **Language**     | **TypeScript**            | Strict typing is non-negotiable for our $W_i$ (Workload Intensity) math and financial ledger integrity.               |
| **Database**     | **Supabase (PostgreSQL)** | Relational integrity for Escrow/Wallets, combined with built-in **Row Level Security (RLS)** and Realtime.            |
| **Architecture** | **Modular Monolith**      | Physical integration with logical isolation allows for shared types and simplified deployment.                        |
| **API Strategy** | **Integrated Handlers**   | Deno Handlers within Fresh routes allow for "Thin Controllers" to call "Fat Services" with zero network latency.      |
| **Styling**      | **Pure CSS + BEM**        | Native CSS nesting and variables ensure high performance without the build-step overhead of CSS-in-JS.                |

### Architectural Strategy: The Modular Monolith

To avoid the complexity of microservices while maintaining clean boundaries, Projective utilizes
**Deno Workspaces**.

- **App Layer (`/apps/web`):** Handles routing, UI Islands, and API Request/Response parsing.
- **Logic Layer (`/packages/backend`):** Contains the "Source of Truth" for business logic
  (Services).
- **Type Layer (`/packages/types`):** Centralized Zod schemas and TypeScript interfaces shared
  across all workspaces to prevent drift.

---

## Libraries

Projective operates on a "Performance-First" philosophy. To maintain the leanest possible hydration
profile in our Fresh Islands, we prioritize **In-House Built Components** over generic, bloated UI
libraries. This ensures complete control over the DOM, CSS-BEM adherence, and optimal performance
for complex data-heavy views.

### 1. The Core UI Library (`@projective/ui`)

The following components are built from scratch using Preact/Signals, ensuring zero unnecessary
dependencies and full themeability:

- **Navigation & Layout:** Splitters, Steppers, Accordions, Cards, Skeletons.
- **Form Controls:** Buttons, Inputs, Time Pickers, Custom Date Pickers.
- **Feedback:** Toasts, Progress Bars, Tooltips.
- **Data Display:** Virtualized & Infinite Scrolling Tables, Grid Views, Lists.
- **File Management:** Drag & Drop File Pickers with chunked upload support.

### 2. Specialized Third-Party Integrations

While we favor in-house logic, we utilize industry-standard primitives for specialized,
high-complexity tasks, wrapped in our own **Islands Architecture** boundaries:

- **Rich Text Editing:** Powered by **Quill.js**. Wrapped to ensure proper lifecycle management
  within Preact.
- **Data Visualization:** **Tiered rendering** (resolved 2026-07-12 — see root `CLAUDE.md` "Resolved
  Decisions"):
  - **D3.js** owns scales, geometry, and path math, and renders **low-density charts as SVG**
    (crisp, stylable, accessible).
  - **Canvas2D** renders **mid-density** charts to avoid DOM bloat.
  - **PIXI.js (WebGL)** renders the **high-density "stage"** (Gantt timelines, pipeline flows, 10k+
    entities at 60 FPS), fed by the Rust/WASM geometry engine.
  - The renderer is selected automatically by a performance metric (entity count + measured frame
    budget). This supersedes the earlier "strictly Canvas-over-SVG" wording.
- **Drag & Drop:** Custom wrappers around native browser APIs to support Kanban ticket movement
  without the overhead of heavy external libraries.

### 3. Hooks & Utility Wrappers

Consistency across the monorepo is maintained through a robust layer of custom hooks located in
`@projective/shared/hooks`:

- **State Persistence:** `useLocalStorage` / `useSessionStorage` for persistent UI states.
- **Intersection Logic:** `useIntersectionObserver` for infinite scroll and lazy-loading components.
- **Financial Math:** `useWorkloadIntensity` for real-time $W_i$ calculations in the UI.
- **Presence:** `usePresence` for real-time collaboration signals via Supabase.

### 4. Charting & Visualization Suite

Our charting library handles the visualization of complex timelines and financial data. All charts
are encapsulated in specialized Islands:

- **Gantt Charts:** Custom D3 + Canvas implementation for One-Off project timelines.
- **Pie/Donut Charts:** Business expenditure and budget burn-down.
- **Line/Area Graphs:** Velocity tracking and revenue projections over time.
- **Kanban Connectors:** Visual logic for "Chain Reaction" escrow locks in Pipelines.

---

## Directory & Project Structure

Projective follows a Domain-Driven Design (DDD) approach within a Deno 2.x Workspace monorepo. This
structure ensures that features are encapsulated, logic is shared efficiently via local packages,
and the Fresh 2.x (Vite-based) routing remains thin and performant.

### The Unified Internal Structure (features, packages, sub-packages)

Every **feature**, **package**, and **sub-package** organizes its files into the same seven folders.
This is a template, not a mandate to create empty directories — populate the folders a unit actually
needs; the menu is fixed so any unit is navigable the same way.

| Folder        | Holds                                                       |
| :------------ | :---------------------------------------------------------- |
| `components/` | Preact components (Pure CSS + BEM, token-only, zero/low JS) |
| `islands/`    | Hydrated, interactive components (`*.island.tsx`)           |
| `styles/`     | Component-specific BEM CSS                                  |
| `hooks/`      | Custom Preact hooks                                         |
| `wrappers/`   | HOCs / provider wrappers                                    |
| `types/`      | TS interfaces / Zod schemas                                 |
| `core/`       | Critical logic & helpers                                    |

### 1. Shared Packages (`/packages/*`)

```text
packages/[package]/
├── components/ islands/ styles/ hooks/ wrappers/ types/ core/   # (populate as needed)
├── [sub-package]/      # multi-export taxonomy — mirrors the same 7-folder shape internally
│   ├── components/ styles/ types/ … + mod.ts
├── deno.json           # package config + multi-export sub-paths
└── mod.ts              # entry barrel
```

Package-wide shared helpers/types live at the **package-level** `core/`/`types/`; a sub-package
(e.g. `@projective/ui/layout`) imports those and adds its own `components/`, `styles/`, etc. (See
`packages/ui/` for the reference implementation: package `core/`+`types/`, sub-packages `layout/`
and `system/`.)

### 2. Feature-Based Application Structure (`/apps/web/features/`)

To keep `/routes` thin, a "Feature Folder" pattern hosts the fat controllers; `routes/` re-exports
them. Features use the same seven folders and **may add** `routes/` (fat page components) and
`services/` (feature-specific API/logic) for this pattern.

```text
apps/web/features/[feature-group]/[sub-feature]/
├── components/ islands/ styles/ hooks/ wrappers/ types/ core/   # the unified seven
├── routes/             # (feature-only) "fat" page components
└── services/           # (feature-only) API callers / logic
```

### 3. Fresh 2.x Vite Configuration

We utilise the Fresh Vite plugin to customize the crawling behavior of our monorepo. This allows us
to treat local feature directories as sources for islands and routes, maintaining strict separation
of concerns.

```ts
/*
 * apps/web/vite.config.ts
 * Configures the Fresh 2.x Vite environment for Projective.
 */
import { defineConfig } from "vite";
import fresh from "@fresh/vite";

export default defineConfig({
	plugins: [
		fresh({
			serverEntry: "./main.ts",
			clientEntry: "./client.ts",
			// Define centralized directories for standard Fresh behavior
			islandsDir: "./islands",
			routeDir: "./routes",
			staticDir: ["static", "generated"],
			// Allow Fresh to discover islands within the features/ directory
			islandSpecifiers: [
				"./features/**/islands/*.island.tsx",
				"@projective/ui/*.island.tsx",
			],
			// Ignore folders to prevent route collisions during crawling
			ignore: [/[\\/]internal[\\/]/],
		}),
	],
});
```

### 4. Path Alias Strategy

To maintain the Strict Import Strategy, the deno.json at the root maps all workspaces. This
eliminates relative path nesting (e.g., ../../../) and ensures the UI and Backend packages are
easily accessible.

- @server/services/* -> ./packages/backend/services/*
- @projective/ui -> ./packages/ui/mod.ts
- @projective/types -> ./packages/types/mod.ts
- @features/* -> ./apps/web/features/*

---

## Visual Identity

The Projective brand is built on a "Calm Tech" aesthetic, utilizing a teal-primary palette that
invokes trust and clarity.

#### Logo Specifications

- **Brand Teal:** #288690
- **Brand White:** #FFFFFF
- **Aspect Ratio 1:1:** Icon-only (Favicons, Profile Placeholders).
- **Aspect Ratio 7:2:** Wordmark (Primary Header Navigation).\

### Color Palette (Semantic Mapping)

While implementation utilizes HSL for dynamic delta-shifting (hover/active states), the following
Hex values define the base visual target.

#### 1. Base Surfaces (Light Mode)

- **Primary Background (#FAFAFA):** Used for the main body background to reduce eye strain.
- **Surface Layer (#FFFFFF):** Used for Cards, Headers, and Sidebar elements to create elevation.
- **Primary Teal (#288690):** Main action color, primary buttons, and active states.
- **Success (#268C66):** Used for "Complete" status and approved submissions.
- **Warning (#D98216):** Used for "In Progress" status and time-sensitive alerts.
- **Danger (#D94141):** Used for "Incomplete" status, errors, and no-show claims.

#### 2. Typography & Contrast

- **Text Main (#1A1A1A):** High contrast for primary body and headings.
- **Text Secondary (#666666):** Used for labels, descriptions, and muted info.
- **Text Disabled (#B3B3B3):** Non-interactive or pending elements.
- **Border Subtle (#E6E6E6):** Low-contrast dividers and component outlines.

#### 3. Dark Mode Targets

- **Background (#1A1A1A):** Deep neutral for the main canvas.
- **Surface Layer (#212121):** Elevated cards and navigation bars.
- **Text Main (#FFFFFF):** Maximum readability for dark backgrounds.
- **Text Secondary (#B3B3B3):** Muted contrast for secondary information.\

### Geometry & Elevation

Projective prioritizes soft, rounded geometry to maintain a friendly, professional interface.

#### Border Radius Hierarchy

- **X-Small (4px):** Checkboxes, small badges, and internal task indicators.
- **Small (6px):** Standard buttons and input fields.
- **Base (8px):** The standard "Projective Rounding"—used for most cards and dropdowns.
- **Large (12px):** Project stage containers and large modal overlays.
- **X-Large (16px):** Primary dashboard widgets and major layout containers.

#### Shadows & Depth

- **Elevation Low:** `0 2px 4px rgba(0,0,0,0.05)` — Used for standard cards to provide a subtle
  "lift."
- **Elevation Medium:** `0 4px 12px rgba(0,0,0,0.1)` — Used for hover states and sidebar headers.
- **Elevation High:** `0 8px 24px rgba(0,0,0,0.15)` — Reserved for Modals and active Popovers.\

### Interaction & Motion

Animations must be purposeful and subtle. Avoid "Cascading" or "Bounce" effects.

#### Transitions

- **Fast (150ms):** Hover states for buttons and icons.
- **Medium (250ms):** Sidebar expansion/retraction and modal entry.
- **Slow (350ms):** Theme switching and complex layout shifts (Gantt transitions).

#### Interaction Cues

- **Hover Delta:** Surfaces should lighten (Dark Mode) or darken (Light Mode) by approximately 8% on
  hover.
- **Active Delta:** Surfaces should shift by 12% on click to provide tactile feedback.
- **Focus Ring:** A 3px semi-transparent teal glow (#28869066) must be applied to all focusable
  elements for accessibility.
- **Ripples:** Applied to primary buttons only. Use a low-opacity white/teal overlay that expands
  and fades within 350ms.\

### Component Sizing

- **Header Height (48px):** Fixed height for Guest and User headers.
- **Sidebar Width (64px / 224px):** Collapsed (Icon-only) vs. Expanded (Full Label) states.
- **Input Height (40px):** Standardized vertical height for all form controls.\

### Accessibility Compliance

- **Scaling:** All font sizes and spacing must be defined in `rem` units to support browser zoom and
  user-defined font size increases.
- **Contrast:** The primary Teal (#288690) must be checked against Backgrounds to ensure a minimum
  4.5:1 ratio for readable text.
- **Motion Reduction:** All transitions and ripple effects must respect the `prefers-reduced-motion`
  media query by jumping directly to the final state.
