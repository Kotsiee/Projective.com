# System Architecture — Projective

> **Canonical technical source of truth.** This document was renamed from `brain2.md` (formerly at
> `documentation/business/brain2.md`) during the July 2026 restructure. It is the **absolute,
> binding authority** for architecture, the Islands boundary, package taxonomy, database
> conventions, security, caching, and integrations. Its business/product counterpart is
> [`documentation/business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) (formerly `brain.md`). If
> the two ever conflict, `PRODUCT_SPEC.md` wins on **business rules**; this file wins on
> **technical/architectural rules**. See the "Restructure Change Log" at the bottom for exactly what
> changed in the move.

## System Directives for Autonomous Agents

> **CRITICAL INSTRUCTION FOR AI AGENTS:** > You are operating within "Projective," a
> high-performance, high-trust collaborative freelancing platform. You are acting as the Lead
> Systems Architect. Read and internalize these absolute rules before executing any commands,
> scaffolding files, or modifying the codebase. Failure to adhere to these rules will break the
> modular monolith architecture.

---

### 1. Database & Schema Mutability (The Additive Rule)

- **Additive Changes Only:** You may add new columns, indexes, or constraints to support new
  features. You **MUST NOT** delete tables, drop columns, or alter existing foreign-key
  relationships (especially around Escrows, Wallets, and Stages) without explicit permission from
  the human developer.
- **The Zod Single Source of Truth (SSOT):** The `@projective/types` workspace is the SSOT. If you
  write a Supabase SQL migration, you MUST simultaneously update the corresponding Zod schema and
  TypeScript interface. The database and the `types` package must never drift.
- **JSONB Contracts:** Before querying or mutating `jsonb` columns, you must define their exact Zod
  shape in `@projective/types` to ensure runtime safety.

### 2. Architecture & The "Islands" Boundary

- **Islands are Dumb:** UI components in `islands/` or mapped via Fresh must **NEVER** import the
  Supabase client or access the database directly. They must use `fetch` to call internal API
  routes.
- **Thin Routes, Fat Services:** Fresh API routes (`routes/api/...`) are only for HTTP parsing, Zod
  validation, and Auth Guarding. All business logic, financial math, and database mutations MUST be
  abstracted into Services.
- **Deno 2.x Workspaces:** Strictly use defined path aliases. The UI layer is consolidated under
  `@projective/ui` with multi-export sub-paths grouped into **seven professional taxonomies**:
  `@projective/ui/layout` · `/navigation` · `/fields` · `/display` · `/feedback` · `/overlay` ·
  `/utils` (declared in `packages/ui/deno.json`; see
  [`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) for the full
  component roster per sub-path). The earlier atoms/charts/data/time/files/system split and the bare
  `@projective/fields` · `charts` · `data` · `time` · `files` · `utils` aliases are **deprecated
  shims** pending consumer migration. App-side use `@server/services`, `@features/*`. Never use
  relative path traversal (`../../../`) across workspace boundaries.

### 3. UI, Styling & Reactivity

- **Pure CSS & BEM Only:** Do not use Tailwind CSS, styled-components, or inline styles. You must
  write Pure CSS using strict **BEM (Block Element Modifier)** conventions.
- **Variable Mapping:** Always utilize the global CSS variables defined in the themes folder (e.g.,
  `var(--primary)`, `var(--field-bg)`). Use `calc()` and `color-mix()` for dynamic states.
- **Theming-engine exception (Material You):** `@material/material-color-utilities` is an
  **approved, explicitly-scoped exception** to the "zero UI-library dependencies" rule. It may be
  used **only** by the theming engine (`packages/ui/system/`) to generate contextual tonal palettes
  from seed colors; it must **never** be imported by an individual component. Its output is written
  into the same `--*` CSS custom properties components already consume, so the component layer stays
  library-agnostic. See
  [`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) §2 for the
  integration path. No other UI/CSS framework (Tailwind, styled-components, MUI, etc.) is permitted.
- **Signal First:** Use `@preact/signals` (`useSignal`, `useComputed`, `effect`) for all local state
  management to bypass the Preact VDOM. Avoid standard React `useState` or `useEffect` unless
  interacting with external, non-reactive DOM libraries (like QuillJS or Canvas).

### 4. Security & Environment Variables

- **Zero Trust Variables:** When writing `.env.example` files, documentation, or placeholder code
  for third-party integrations (Stripe, Google OAuth, Supabase), always use `XXXX-XXXX` as the
  placeholder value. Never hallucinate or insert real API keys.
- **RLS Awareness:** Always assume Row-Level Security (RLS) is active. When writing queries in
  Services, ensure they are executed in the context of the authenticated user's JWT unless executing
  a specific administrative Edge Function.

### 5. Code Quality & Output Format

- **JSDoc Mandatory:** All exported interfaces, classes, services, and complex functions must be
  fully documented using JSDoc.
- **Regions:** Group logical sections of code (Imports, State, Helpers, Lifecycle) using
  `// #region [Name]` and `// #endregion`.
- **No Meta-Comments:** Do not leave comments like `// I fixed this bug` or
  `// Added per user request` in the source code. Keep your reasoning in the chat output.

> **AGENT ACKNOWLEDGEMENT:** If you understand these rules, proceed with your instructions using
> Deno 2.x, Preact, and Supabase best practices.

### 6. SOLID Principles

The system follows SOLID principles to ensure modularity and ease of testing.

- **Interfaces:** We use strict TypeScript interfaces (e.g., `ValueFieldProps<T>`, `BaseFieldProps`)
  to define contracts for component props and state.
- **Single Responsibility:** Logic is separated between **Islands** (UI/Interaction),
  **Controllers** (API Routes), and **Services** (Business/Data logic).
- **Dependency Inversion:** Components depend on generic interfaces (like `DateValue` or
  `SelectOption`) rather than specific implementation details.

---

## Packages

### Fields

This package provides the capabilities of a full input field library like PrimeNG for Angular but
built natively for Deno Fresh 2.x. It utilizes Preact Signals for ultra-fine-grained reactivity and
a specialized interaction hook to track focus, blur, and dirty states across all components.

#### Design Philosophy

- **BEM Styling:** All components follow strict BEM naming conventions.
- **Theme Integration:** Maps directly to `variables.md` HSL logic (e.g., `--field-bg`,
  `--field-border-focus`).
- **Signal First:** Every `value` prop accepts either a raw type or a `Signal<T>`.
- **Composition:** Complex fields are composed of `LabelWrapper`, `MessageWrapper`, and
  `EffectWrapper`.

#### Components

**DatePicker (DateField)** Select a date from a custom-made calendar where a user can click on the
header to view different scopes (days, months, years, decades).

- **Use Cases:** Birthdays (Single), Booking periods (Range), Event scheduling (Multiple).
- **Options:**
  - `variant`: `'popup' | 'inline' | 'input'`.
  - `selectionMode`: `'single' | 'multiple' | 'range'`.
  - `format`: Custom format strings (e.g., `dd/MM/yyyy`).
  - `minDate/maxDate`: Restrict selectable range.
- **Design:**
  - **Text input:** Shows formatted date; includes a calendar icon adornment.
  - **Popup:** Uses `Popover` to display the `Calendar` component.
  - **Header:** Prev/Next arrows with a title that switches scope (Day -> Month -> Year) on click.

**TimePicker (TimeField)** Select a time (Hours, Minutes) from a custom-made clock interface.

- **Use Cases:** Appointment slots, reminder settings.
- **Options:**
  - `selectionMode`: `'single' | 'multiple'`.
  - `variant`: `'popup' | 'inline'`.
- **Design:**
  - **Header:** Digital display with AM/PM toggle. Toggling AM/PM updates the 24-hour underlying
    `DateTime` value.
  - **Body:** A vector clock face. Clicking an hour automatically transitions the view to minutes
    for single-select mode.
  - **Logic:** Uses `getAngleValue` and `getPosition` utils to map pointer coordinates to time
    increments.

**DateTimePicker** A unified picker for selecting the date then the time within the same popup
interface.

- **Use Cases:** Log entries, future-dated posts, flight arrivals.
- **Design:**
  - **Tabs:** A dual-tab header in the popup allows switching between 'Date' and 'Time' views.
  - **Workflow:** Selecting a date automatically flips the tab to the 'Time' view for a streamlined
    UX.

**TextField** Single or multi-line text input with comprehensive state tracking and adornment
support.

- **Use Cases:** Usernames, passwords, descriptions, numeric inputs.
- **Options:**
  - `type`: `'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search'`.
  - `multiline`: Converts the input to a `textarea`.
  - `showCount`: Displays a character counter relative to `maxLength`.
  - `prefix/suffix`: Accepts `JSX.Element` or strings (e.g., currency symbols or action icons).
- **Design:** Uses `AdornmentWrapper` for icons and `EffectWrapper` to render the animated focus
  rings and ripple effects.

**CodeField** _Note: Implementation pending._ Designed for OTP (One-Time Password) or product key
entry.

- **Use Cases:** 2FA verification, license entry.
- **Design:** A series of single-character boxes.
- **Logic:** Focus management automatically shifts to the next index on `input` and returns to the
  previous index on `backspace` (if the current field is empty).

**SliderField** Allows for selection between ranges using single or dual handles.

- **Use Cases:** Price range filters, volume/intensity controls, logarithmic scale data.
- **Options:**
  - `range`: Enable dual handles for `[min, max]` selection.
  - `scale`: `'linear' | 'logarithmic'`.
  - `marks`: Boolean or `SliderMark[]` to show ticks and labels.
  - `snapToMarks`: Forces values to align with defined marks.
  - `vertical`: Switches orientation.
- **Design:** Pure CSS track with `PointerEvent` based handle tracking to ensure smoothness on
  mobile and desktop.

**DropdownField (SelectField / ComboboxField)** A powerful selection component supporting search,
grouping, and virtualization.

- **Use Cases:** Country selection, category tagging, complex relationship mapping.
- **Options:**
  - `multiple`: Enables multi-select with chip rendering.
  - `searchable`: Filters the option list based on input.
  - `groupSelectMode`: `'value'` (selects the group itself) or `'members'` (selects all children).
  - `displayMode`: `'chips-inside' | 'chips-below' | 'count' | 'text'`.
- **Design:** Nested menu rendering with `depth` tracking for multi-level hierarchies. Includes an
  'Action Bar' for 'Select All' functionality in multi-mode.

**SwitchField** _Note: Implementation pending._ A toggle switch for binary states.

- **Use Cases:** Setting toggles, "Remember Me," feature flags.
- **Design:** A pill-shaped track with a sliding thumb. Supports icons inside the thumb or track.
  Uses ARIA `role="switch"`.

**RichTextField** QuillJS enabled editor with support for Markdown and Delta formats.

- **Use Cases:** Content management, formatted descriptions, email drafting.
- **Options:**
  - `outputFormat`: `'delta' | 'html' | 'markdown'`.
  - `toolbar`: `'basic' | 'full' | custom[]`.
  - `onImageUpload`: Intercepts image insertion to handle server-side uploads via a Service.
- **Design:** Integrated with `QuillParser.ts` for real-time conversion between Delta and Markdown.

**TagField (TagInput)** Input field for managing an array of string tags.

- **Use Cases:** SEO keywords, user interests, organizational labels.
- **Design:** Renders tags as removable chips inside the input container.
- **Logic:** Adds tags on `Enter` or `,` keys. Prevents duplicates and handles
  backspace-to-delete-last functionality.

#### Wrappers

**AdornmentWrapper** Provides standard positioning and hit-areas for prefixes and suffixes within
fields. It handles `onClick` events for interactive icons (e.g., password visibility toggles).

**EffectWrapper** The visual engine for the field's interactive states. It manages:

- **Focus Rings:** Animated borders that respond to `interaction.focused`.
- **Ripples:** Material-inspired pointer feedback.
- **Disabled State:** Visual overlays to prevent interaction.

**FileDropWrapper (GlobalFileDrop)** A layout-level wrapper that turns an entire page or a specific
container into a dropzone.

- **Design:** Remains invisible until a `dragenter` event occurs on the `globalThis`, at which point
  it displays a high-contrast overlay.

#### Hooks

**useInteraction** The core state tracker for every field.

- **Functionality:** Returns signals for `focused`, `hovered`, `active`, `dirty`, and `touched`.
- **Usage:** Essential for triggering validation messages and "floating" label animations.

**useFieldState** Manages the synchronization between external props (Signals or raw) and internal
component state.

- **Functionality:** Handles `defaultValue`, manages `error` messages, and provides a `validate()`
  function that checks `required` status and custom Zod schemas.

**useFileProcessor** A non-visual hook for handling file pipelines.

- **Functionality:** Manages a `processingQueue`. It takes a list of `FileProcessor` objects (e.g.,
  Image Resizer, Virus Scanner) and applies them sequentially to files added via `FileDrop`.

**useCurrencyMask** Transforms a numeric signal into a localized currency string.

- **Functionality:** Handles formatting on blur (e.g., `1200` -> `$1,200.00`) and unmasking on focus
  (e.g., `$1,200.00` -> `1200`) to allow easy numerical editing.

---

### Data

This package provides a robust infrastructure for handling lists, grids, tables, and masonry layouts
with infinite scrolling. It separates the concerns of data fetching (`DataSource`), state management
(`DataManager`), and spatial layout (`Virtualizer`).

#### Core Architecture

**DataSource** The abstract contract for data retrieval.

- **RestDataSource**: A concrete implementation for JSON APIs. It includes built-in TTL caching to
  prevent redundant network requests and a `getMeta()` method for pre-fetching total record counts.
- **Normalization**: Automatically transforms raw API shapes into a `NormalizedItem` which tracks UI
  states like `selected` and `isSkeleton` separately from domain data.

**DataManager** The central "brain" of the package. It tracks which ranges of data are currently
loaded and which are "gaps."

- **Gap Detection**: When the virtualizer requests a range (e.g., items 100-150), the manager checks
  its internal cache and only triggers fetches for missing segments.
- **Batching**: Utilizes `@preact/signals` `batch()` to ensure that loading multiple data chunks
  only triggers a single UI render.

**Virtualizer / MasonryVirtualizer** Engines that calculate which items intersect the current
viewport.

- **1D Virtualizer**: Used for Lists, Tables, and Grids. Supports variable row heights via
  `ResizeObserver`.
- **2D MasonryVirtualizer**: Uses a "Shortest Column First" algorithm and binary search to find
  visible items in a non-linear grid.

#### Components

**DataDisplay** A polymorphic entry point that acts as a controller for all display modes.

- **Use Cases**: The primary component for any collection of data.
- **Modes**:
  - `list`: Standard vertical stack.
  - `grid`: Responsive tile layout with native CSS grid rows.
  - `table`: Column-based data with sorting and resizing.
  - `masonry`: Pin-style layout for variable height content.

**Carousel** A high-performance, touch-ready slider.

- **Features**: Supports autoplay, circular looping, and "page" based pagination dots.
- **Design**: Uses a GPU-accelerated `translate3d` track. Only renders items near the viewport
  (buffer zone) to keep the DOM light.
- **Interactions**: Implements a custom Pointer Event engine for unified mouse and touch swiping.

**ChatList** A specialized display optimized for real-time messaging.

- **Features**: Optimistic UI support and scroll anchoring.
- **Scroll Anchoring**: Automatically keeps the user "locked" to the bottom when new messages
  arrive, or preserves their position when loading historical messages from the top.

**Table** A complex data grid for administrative interfaces.

- **Features**: Virtualized rows, sortable columns, and draggable column resizing.
- **Design**: Uses a `Header` and `TableRow` split to allow for fixed header positioning while the
  row body remains virtualized.

#### Hooks

**useVirtual / useMasonryVirtual** Hooks that bind the spatial engines to the DOM.

- **Ref Tracking**: Provides a `measureElement` callback to be attached to items, allowing the
  engine to learn the "real" height of content after it renders.

**useSelection** A headless logic hook for managing single, multi, and range selection
(Shift+Click).

- **Logic**: Automatically handles `Ctrl/Meta` and `Shift` key modifiers to calculate selected key
  sets.

**useScrollAnchoring** A low-level hook that monitors `scrollHeight` changes to prevent visual
jumping during asynchronous data loading.

#### Design Patterns & Preferences

**CSS & BEM**

- All components import local `.css` files (e.g., `carousel.css`, `list.css`).
- Uses BEM naming: `.data-carousel__track--dragging`, `.data-grid__card--selected`.
- Highly dependent on CSS variables for layout: `--carousel-visible-count`, `--gap`.

**Reactivity**

- Prefers `@preact/signals` for performance-critical values like `scrollTop` and `dragOffset` to
  bypass the Preact VDOM where possible.
- Uses `useComputed` to derive responsive widths from `containerWidth` signals.

**SOLID Principles**

- **Interface Driven**: Heavily utilizes TypeScript interfaces for prop definitions
  (`DataDisplayProps`, `CarouselOptions`) and state containers (`Dataset`).
- **Open/Closed**: The `DataSource` can be extended to support GraphQL, Supabase, or LocalStorage
  without changing the UI components.

---

### UI

This package provides a comprehensive set of modular UI components and layout patterns for the
Projective platform. It follows atomic design principles, ensuring that components are reusable,
maintainable, and easily testable.

#### Design Philosophy

- **Pure CSS + BEM:** Strict BEM naming conventions are used for all styling, ensuring
  predictibility and preventing style leaks.
- **Variables First:** Leveraging the CSS variable architecture defined in
  `apps/web/styles/themes/variables/`, components are fully dynamic and themeable.
- **Atomic Design:** Components are built from the bottom up, with higher-level components
  (molocules/organisms) composed of atomic elements.
- **Accessibility (ARIA):** A first-class citizen, ensuring all interactive elements provide correct
  roles, labels, and state information to assistive technology.

#### Overlay & Popup System

Projective implements a robust overlay system for managing modals, drawers, and context-sensitive
popups. To ensure proper layering (z-index) and focus management, all overlays utilize a portal
pattern, rendering content outside the main application flow.

The architecture separates the visual structure (layouts) from the interactive management (islands).

##### Overlays

**Modal** A centered overlay element that blocks user interaction with the main content until
explicitly dismissed.

- **Use Cases:** Confirmation dialogs, forms within popups, displaying critical notifications.
- **Interaction (Modal Island):**
  - Must trap focus inside the dialog when open (using ARIA `dialog` role).
  - Must support closing via the `ESC` key.
  - The backdrop is interactive to dismiss unless a critical action is required
    (`forcedDismissProps`).

**SlideIn (Drawer)** An overlay panel that slides in from the edge of the viewport.

- **Use Cases:** Side navigation menus, secondary content panels, advanced filters.
- **Options:**
  - `position`: `'left' | 'right'`. Controls the origin of the animation and visual attachment.
- **Design:** Follows strict BEM formatting with modifiers for directional positioning
  (`.drawer--left`, `.drawer--right`). Utilizes variables for consistent transition timing
  (`--medium`) and backdrop colors.

**MobilePopup (Bottom Sheet)** A specialized popup designed for mobile contexts that slides up from
the bottom of the screen.

- **Use Cases:** Moblie navigation, action menus, detailed item views. The mobile popup can be
  configured to dynamically replace both Modals and Side Panels when the viewport width is below a
  specific breakpoint (typically 768px).
- **Design (from reference image `image_592d48.png`):**
  - This component mimics the Apple mobile popup design.
  - It features a rounded container and a prominent visual grab handle ("bar") at the top.
  - Its internal structure is organized with distinct headers (e.g., 'X' close button), content
    areas with varied fields (e.g., 'Name' TextField, 'Time' segmented control, 'Send invites'
    Toggle), and action buttons (e.g., 'Cancel', 'OK').
- **Interaction (BottomOverlay Island):**
  - The height is adjustable by dragging the grab handle at the top of the popup.
  - Must utilize Pointer Events to track dragging interaction.
  - Uses Preact Signals to update the dynamic height (CSS `height` property) in real-time.
  - Sliding to a minimum threshold should auto-dismiss the popup with a smooth animation.

##### Overlay Implementation & State

**`OverlayManager` Island:** A centralized island component responsible for managing the stack of
all active overlays on a page. It provides a signal-based API for other components to register their
request to open an overlay.

**`Modal` & `Drawer` & `MobilePopup` Islands:** These islands are the interactive containers for the
respective overlay types. They manage the internal state of the popup, including focus trapping,
keyboard handling, and pointer event tracking for the draggable elements (e.g., MobilePopup handle).

**Layout Components (Web):** Simple, stateless layout components (e.g., `ModalLayout`,
`DrawerLayout`) are used within the islands to provide structure to the content (Header, Body,
Footer) without introducing client-side logic.

#### Core Component Library

The `@projective/ui` package also contains standard atomic components following the same strict
design patterns and variable architecture. The **authoritative design-system spec** — the token
contract, the consolidated `@projective/ui` sub-path taxonomy, the `<DesignSystemProvider>` context
engine, and the per-component state/variant matrices — lives in
[`documentation/design-system/`](../design-system/DESIGN_SYSTEM.md) and the root `CLAUDE.md` "Design
System & Component Architecture" guardrails. Treat those as the source of truth for the component
layer; this section stays a narrative overview, not a duplicate of the matrices.

##### Visual Components

**Icon** A component for rendering vector icons consistently.

- **Use Cases:** Adding visual context to buttons, menus, or notifications.
- **Options:** `variant`, `size`, `spin`, `colour` (mapped to semantic tokens like `--text-main` or
  `--primary`).

**Button** A highly versatile component for initiating actions.

- **Use Cases:** Submitting forms, closing modals, initiating network requests.
- **Options:**
  - `variant`: `'primary' | 'secondary' | 'danger' | 'ghost' | 'text'`.
  - `effect`: `'ripple' | 'press'`.
- **Styling:** Utilizes CSS `calc()` for dynamic sizing and HSL logic for dynamic colour shifts on
  hover and active states (as defined in `colour.css`).

**Avatar** Renders a visual representation of a user.

- **Use Cases:** Profile sections, message senders, team members.
- **Features:** Auto-generates initial avatars if no image is provided, supports presence indicators
  (online/offline).

##### Data Display Components

**Badge** Renders small status indicators or notification counts.

- **Use Cases:** Displaying status (`primary`, `success`, `danger`, `warning`), showing message
  counts.

#### Layout Components

Atomic layout components are designed using native CSS Grid and Flexbox with variables for
consistent spacing and alignment.

**Grid**

- A pure CSS implementation for generating responsive grids with customizable columns, gaps
  (`--gap`), and alignment options.
- Does not require JavaScript/Islands.

**Flex**

- A flexible layout container providing properties for `direction`, `justify`, `align`, `gap`, and
  responsiveness directly via CSS classes or data attributes.

**Typography** A set of components (`H1-H6`, `P`, `Text`, `Label`, `Subtext`) that standardize font
sizes, families (`--font-sans`), and line heights based on the global variable configurations.

---

### Charts

This package provides high-performance data visualization tools ranging from project management
(Gantt/Kanban) to analytics and freelancer-specific scheduling (Calendar).

#### Visualization Strategy

1. **Hybrid, tiered rendering** (resolved 2026-07-12 — see root `CLAUDE.md` "Resolved Decisions"):
   Preact/HTML for UI controls and headers (accessibility, styling). For the data "stage" the
   renderer escalates by density: **D3.js** for scale/geometry math + **low-density SVG**;
   **Canvas2D** for mid-density; **PIXI.js (WebGL)** for the high-density stage (thousands–100k+
   entities at 60 FPS), fed by the Rust/WASM geometry engine. Selection is automatic on a
   performance metric (entity count + frame budget).
2. **Theme Bridging:** A specialized `theme-bridge.ts` utility synchronizes CSS variables (HSL) from
   the `variables.md` context into Hex values for Canvas rendering, ensuring perfect theme
   consistency.
3. **Signal-Driven:** All interactions (scrolling, zooming, selection) are handled via
   `@preact/signals` to bypass the VDOM for high-frequency updates.

#### Components

**GanttChart** A specialized tool for project timelines and stage management.

- **Design:**
  - **Left List:** HTML-based `GanttTaskList` for rich interactions and BEM styling.
  - **Timeline:** Canvas-based viewport supporting infinite horizontal and vertical scrolling.
  - **Header:** Dynamic "Tiered" header (Years -> Months -> Days) that adapts as you zoom via a
    slider or `Ctrl+Wheel`.
- **Features:** Supports milestones, task dependencies, and progress tracking.

**AnalyticsDisplay** A polymorphic container for data visualization that allows users to swap
between chart types without reloading data.

- **Components:** `PieChart`, `BarChart`, `LineChart`, `AreaChart`.
- **Logic:** Uses an internal `D3Orchestrator` to calculate paths and scales. The UI renders these
  as either SVG for simple charts or Canvas for datasets exceeding 1,000 points.
- **Interchangeability:** Similar to `DataDisplay`, it accepts a unified dataset and a `view`
  signal.

**Calendar (Session Planner)** A "Google/Teams Style" calendar optimized for freelancers managing
session-based work.

- **Design:**
  - **Views:** Day, Week (Multi-column), and Month grid.
  - **Session Focus:** Built-in support for "Session" blocks which include client data, location,
    and payment status.
- **Interactions:** Drag-to-create sessions, resize to adjust duration, and "ghosting" for
  overlapping session detection.

**KanbanBoard** A board that balances Trello's visual simplicity with Azure DevOps' functional
power.

- **Design:** Column-based layout with horizontal scrolling and vertical virtualization within
  columns.
- **Power Features:** - **Swimlanes:** Group columns horizontally by priority or assignee.
  - **WIP Limits:** Visual indicators when a column exceeds its Work-In-Progress capacity.
- **Interaction:** Uses standard Pointer Events for drag-and-drop, updating the backend via a
  `KanbanService` on drop.

#### Core Architecture

**GanttStore (Signal Store)** Manages the global state of a chart instance, including `scrollX`,
`visibleDays`, and `hoveredTask`. It calculates the `timeScale` used by all child components to map
Dates to Pixels.

**GanttManager (The Orchestrator)** Coordinates the PIXI.js application. It manages the `Ticker` for
smooth scrolling animations and triggers renderers for the Grid, Tasks, and Scrollbars.

**ThemeBridge** A critical utility that forces the browser to evaluate CSS `calc()` and `var()`
statements, returning a numeric Hex code for the Canvas engine. This ensures that when `--primary`
changes in `variables.md`, the Canvas tasks update their color instantly.

---

### WASM

The `@projective/wasm` package acts as the performance engine for the Projective platform. By
utilizing Rust compiled to WebAssembly, we achieve near-native execution speeds for
compute-intensive tasks, ensuring the "Projective" experience remains fluid even under heavy data
loads.

#### Core Capabilities & Examples

Beyond basic media handling, WASM is integrated into the following platform-critical workflows:

**1. Media & File Optimization**

- **Image Resizer:** Real-time client-side downscaling of avatars and project attachments before
  Supabase upload to save bandwidth.
- **File Compression:** Transparent GZIP/ZSTD compression for large document uploads within the
  `FileDropWrapper`.
- **Video/Audio Handling:** Frame extraction for video thumbnails and Opus/Vorbis compression for
  audio messages to ensure low-latency playback.

**2. Data & Search Performance**

- **Fuzzy Search Engine:** Powering the `DropdownField` and `DataDisplay` search logic. It enables
  sub-millisecond fuzzy matching across 10,000+ items, which is critical for complex relationship
  mapping.
- **High-Speed Validation:** Offloading massive Zod-like schema validations for large JSON payloads,
  preventing UI "jank" during data ingestion.
- **Diffing Algorithms:** Calculating differences in `RichTextField` Delta objects for version
  history and real-time collaboration.

**3. Graphics & Visualization Support**

- **Geometry Math:** While PIXI.js handles rendering, Rust handles the complex collision detection
  and coordinate mapping for the `GanttTimeline` and `MasonryVirtualizer` when dealing with 100k+
  entities.
- **PDF Generation:** Generating high-fidelity session reports and invoices directly in the browser
  for the **Calendar/Session Planner** using the `printpdf` crate.

**4. Security & Cryptography**

- **Client-Side Hashing:** Implementing Argon2 or PBKDF2 for sensitive data preprocessing.
- **End-to-End Encryption:** Managing AES-GCM encryption for private messages in the `ChatList`
  before they are sent to the database.

#### Architecture & Design Patterns

**Bridge Pattern** The package uses a "Bridge" architecture where Rust handles the raw data buffers
and Deno/TypeScript handles the signal-based state management.

- **Islands Integration:** WASM modules are initialized once at the root layout and shared via a
  `WasmContext` or global signal to avoid redundant loading.
- **Worker Offloading:** Intensive WASM tasks (like video transcoding) are automatically delegated
  to Web Workers to keep the UI thread responsive.

**Naming & Formatting**

- **Rust Side:** Follows standard `snake_case` for functions and `PascalCase` for structs.
- **TS Side:** All WASM-backed functions are exported with an `Async` suffix (e.g.,
  `compressFileAsync`) to reflect the cross-boundary nature of the call.

#### Implementation Notes

- **Memory Management:** We utilize `wasm-bindgen` for efficient memory sharing between the
  JavaScript heap and the Rust linear memory.
- **Error Handling:** Rust `Result` types are mapped to TypeScript `Error` objects with descriptive
  JSDoc headers to ensure the frontend can gracefully handle processing failures.

---

## Backend Services (the Thin-Frontend / Fat-Backend contract)

This concretises §2's "Thin Routes, Fat Services." The system splits **transport** from **business
logic** along a hard line, with a symmetrical service on each side of the network boundary:

- **Thin frontend services** (client) — e.g. `apps/web/features/auth/core/AuthService.ts`. They
  gather inputs, manage local UI state (signals), and make one structured HTTP request per action to
  an internal `/api/*` route, returning a typed result. **No business logic, no DB, no `fetch`
  scattered through islands** — one module owns the endpoint map. Islands stay dumb (§2).
- **Thin routes** (`apps/web/routes/api/**`) — HTTP parse + Zod validation (schemas that will
  consolidate into `@projective/types`) + auth guarding + return-path sanitising only. They call a
  fat service and map its result to a `Response`; they hold **no** business decisions.
- **Fat backend services** — the **`@projective/backend`** package, imported app-side via the
  **`@server/services/*`** alias. They own business logic, encryption, DB transactions, session
  minting, and security policy, and are the **only** layer that touches the Supabase client. They
  are transport-agnostic: every method returns a **`ServiceResult<T>`** (`ok`, suggested HTTP
  `status`, `data`, `message`, field `errors`) that the thin route folds into its response — so a
  route, a cron job, or another service can all reuse the same method.

### `@projective/backend` layout

Follows the standard seven-folder shape; populated as needed:

- `core/env.ts` — the single, lazy, typed reader of the Environment Variable Contract (never throws
  at import; accepts the documented **and** the `.env.development` key names — see §8 row 11).
- `core/supabase.ts` — on-demand client provisioning: `getUserClient(jwt)` (RLS-scoped, the default)
  vs `getServiceClient()` (service-role, RLS-bypassing, narrow/audited use only), gated by
  `isSupabaseConfigured()` / `isAuthBackendLive()`.
- `services/ServiceResult.ts` — the uniform result envelope + `ok()` / `fail()` builders.
- `services/<domain>/<Name>BackendService.ts` — the fat services. Reference implementations:
  `services/auth/AuthBackendService.ts` (mutating, session-bearing),
  `services/explore/ExploreBackendService.ts` (read-only discovery), and
  `services/newsletter/NewsletterBackendService.ts` (a minimal write — the public opt-in capture).

### Live vs stub, and the guard boundary

Fat services ship **stub-first**: each method returns the safe MVP outcome until the real Supabase /
GoTrue calls are implemented and verified, at which point the environment flips
**`AUTH_BACKEND_LIVE=true`** (default off) to enable the live paths. This keeps a half-wired query
from firing against a real project and keeps the app runnable without a backend. Input **guarding**
that depends on feature-local pure helpers (the DoB age-gate, password-required-unless-OAuth) stays
in the route per §2; it consolidates into `@projective/types` with the Zod schemas when that package
lands. Everything downstream of a validated request belongs to the service.

### Discovery (Explore) services

The Explore feature is the second, **read-only** implementation of the contract: `ExploreService`
(client) → `/api/explore/{search,item,related}` (thin) → `services/explore/ExploreBackendService.ts`
(fat) → `ServiceResult<T>`. The fat service owns the whole discovery query — filtering, ranking,
merged-section grouping, item lookup, and paged feed expansion — over curated fixtures
(`services/explore/fixtures.ts` + `query.ts` + the server-side `skills.ts` resolver), which the app
**never** imports. The `/explore` route and `/view/[id]` call the service directly for SSR first
paint; the `SearchDashboard` island refines client-side via `ExploreService` (filter/sort changes,
infinite-scroll pages, drawer refresh). Cross-boundary shapes — `ExploreItem`, `ExploreParams`,
`ResultGroup`, `SearchPayload`, `HomeFeed` — are the Zod SSOT at **`@projective/types/explore`**.
Stub-first behind **`EXPLORE_BACKEND_LIVE`** (default off), gated by `isExploreBackendLive()`; the
live path (Supabase discovery tables + search embeddings) slots in behind that guard.

### Newsletter services

The public footer's "stay updated" capture is the third implementation of the contract, and the
smallest write: `NewsletterService` (client) → `POST /api/newsletter/subscribe` (thin) →
`services/newsletter/NewsletterBackendService.ts` (fat) → `ServiceResult<T>`. The subscribe shape is
the Zod SSOT at **`@projective/types/newsletter`** (`NewsletterSubscribeSchema`), validated in three
places without drift: the client service (before the round-trip), the thin route (the request body),
and the fat service (defence in depth). Stub-first behind **`NEWSLETTER_BACKEND_LIVE`** (default
off), gated by `isNewsletterBackendLive()`; every well-formed address gets a friendly confirmation
while the live path (an upsert into `newsletter.subscriptions` + email-provider sync) waits behind
that guard. The footer's `NewsletterForm` island is the only client touchpoint — it `fetch`es the
route and never reaches the service.

### Messaging services

The global inbox (`/messages`) is a READ-heavy implementation of the contract: `MessagingService`
(client) → `/api/messaging/{conversations,conversation,messages,contacts,settings}` (thin) →
`services/messaging/MessagingBackendService.ts` (fat) → `ServiceResult<T>`. Cross-boundary shapes —
the conversation list / detail / contact-picker / settings projections — are the Zod SSOT at
**`@projective/types/messaging`**; message BODIES reuse `@projective/types/projects`'
`MessagePage`/`ChatMessage` because a project channel and the inbox are one thread, **unified by
`chatId`** (`PRODUCT_SPEC.md` §Unified Messaging) — so the fixtures derive the `dm-{handle}`
conversation ids to match the project DM ids. Stub-first behind **`MESSAGING_BACKEND_LIVE`**
(default off), gated by `isMessagingBackendLive()`; the live path (RLS-scoped `messages.*` tables)
slots in behind that guard with zero shape churn. Full feature detail (the floating pop-out chat
with navigation memory, the role-specific advanced filters, the profile quick-message popover, the
`messagingRole` dev-context axis) is logged in the root `CLAUDE.md` §8 Decision #49.

### Catalogue services (the first WRITE surface)

The seller-side Catalogue (`/catalogue` + the per-item manage page `/catalogue/[id]`) is the **first
write-oriented** implementation of the contract — every prior read is now joined by create / update
/ publish mutations, all still through the same thin/fat split: `CatalogueService` (client) →
`/api/catalogue/{list,item,create,update,status}` (thin) →
`services/catalogue/CatalogueBackendService.ts` (fat) → `ServiceResult<T>`. Reads are GETs; the
mutations are JSON POSTs the fat service applies. Cross-boundary shapes — the listing LIST +
editable detail projections, the light analytics (`ListingMetrics`/`CatalogueStats`), and the
`CreateListingInput`/`UpdateListingInput`/`SetListingStatusInput` payloads — are the Zod SSOT at
**`@projective/types/catalogue`**; pricing is **not forked** (the service delivery model reuses
`ServiceType`, the display projection reuses `EntityPricing`, the per-unit prices reuse the
discovery `ticketPrice`/`sessionPrice` fields). Stub-first behind **`CATALOGUE_BACKEND_LIVE`**
(default off, gated by `isCatalogueBackendLive()`); the fat service DERIVES the seller catalogue
deterministically from the discovery corpus (re-owned to a fixed acting seller) so a listing agrees
with the `ServiceCard`/`ProductCard`/`/view/[id]` it links to, and — because this is the first write
surface — seeds those listings into an **in-module session store** so the create→edit→publish flow
is fully exercisable with the gate off (`createListing` mints an optimistic draft, `updateListing`
merges a patch, `setListingStatus` runs the publish gate). It grants **no persistence** (the store
is per-process). Seller-ness is **not a hard server-side redirect**: the client-side **Dev Context
Switcher** must be able to flip an authed dev to a seller persona at runtime, and the server never
sees that override — so the surface is authed-reachable (the `(dashboard)` middleware bounces
guests; no route gates on `isFreelancer`, per Decisions #14/#16/#48), seller-ness lives in the
dev-seam-reactive sidebar chrome, and the deferred `catalogue.*` RLS + mutation policies are the
real access gate. The publish gate (`publishReadiness`: title + a price + ≥1 media) IS enforced both
client-side (to enable/explain the Publish action) and server-side (defence in depth). The
**deferred live path** is the RLS-scoped `catalogue.*` tables + mutation policies (no DB migration
in this pass — the catalogue is a read+write projection over fixtures, like `detail`/`messages`/
`files`); it slots in behind the same gate with zero shape churn. Full feature detail is logged in
the root `CLAUDE.md` §8 Decision #53.

**`WalletBackendService`** (`services/finance/`) is the context-scoped Wallet & Finance surface
(`/wallet` + its deep pages + action modals) — the 14th thin/fat read and the finance domain's first
WRITE surface, over the finance Zod SSOT (`@projective/types/finance`). Thin `WalletService` (client) →
`apiFetch` → `/api/wallet/{overview,switcher,transactions,activity,payouts,funding,methods,invoices,
access,action}` (thin routes = HTTP + Zod + guard, NO server capability gate) → the fat service →
`ServiceResult<T>`. **All money math is the fat service's** (or its `wallet-fixtures.ts`): the
three-state balance projection, the 5%-fee→vault-cut→template→remainder-to-vault team split
(finance-model §5), FX conversion + `Intl` formatting into the viewer's display currency, the KYC gate
— the client only formats the returned `MoneyView`s (never computes a balance/split/fee/conversion).
The read projections + action inputs + the `MoneyView`/`WalletQuery`/`WalletSim` shapes + the pure
`formatMoney`/`capabilitiesForRole` helpers are the SSOT at **`packages/types/finance/wallet.ts`**.
Stub-first behind **`FINANCE_BACKEND_LIVE`** (default off, `isFinanceBackendLive()`): the fat service
DERIVES a coherent finance world (a personal wallet + team/business vaults + an "All accounts"
aggregate) deterministically from the same cast as `/projects` + `/messages`, and — as a write surface —
mutates an **in-module session store** (top-up / withdraw / transfer / distribute / fund-escrow /
recurring / method / payout / spend / smoother) so the flows are exercisable with the gate off (no
persistence). **No DB migration** — a read+write projection over fixtures; the RLS-scoped `finance.*`
tables + money functions (the real engine, migrations 0009/0305/0310 + 20260723090000..094000) are the
deferred live path behind the same gate. The wallet is the **finance face of the active context**
(Decisions #16/#17): the same route resolves a different wallet via a `?w=scope:id` switcher override.
Full feature detail is logged in the root `CLAUDE.md` §8 Decision #55.

### Sessions & Google OAuth

- **Session cookies.** A successful sign-in (password grant, verified email OTP) returns the GoTrue
  tokens on the `ServiceResult.session` envelope — never in the JSON body. The route mints canonical
  HttpOnly cookies `sb-access-token` / `sb-refresh-token` (the names the `(dashboard)` middleware
  checks) via `apps/web/utils/auth-cookies.ts`, folded in by `toAuthResponse`. Islands `fetch` the
  route, the browser stores the cookies, and the island's `location.href` navigation is
  authenticated.
- **Session lifecycle & silent refresh.** The access token is short-lived (~1h, GoTrue
  `expires_in`); the refresh token lives 30 days. A session must be **renewed**, not dropped, when
  the access cookie expires. The single renewal primitive is fat
  `AuthBackendService.refreshSession(refreshToken)` (live GoTrue `refreshSession({ refresh_token })`
  → rotated tokens; stub re-mints so the path is testable without a wired GoTrue — it grants no
  access, and is only reachable when a refresh cookie is actually presented). It feeds two consumers
  via `apps/web/utils/session.ts` `ensureSession(req)` — fast path (access cookie present) →
  **refresh-before-redirect** (access gone + refresh present → renew in place) → **fail-closed**
  (spent/invalid refresh → clear both cookies):
  - **Server (the `(dashboard)` guard).** `routes/(dashboard)/_middleware.ts` calls `ensureSession`,
    re-mints the renewed `sb-*` cookies onto the proceeding response, re-derives
    `ctx.state.userContext` from the fresh token (so a just-renewed request never paints guest
    chrome), and — only for a genuinely dead session — redirects to `/login` capturing the **full**
    target (`pathname + search`) as `redirectTo` for a loss-free return.
  - **Client (the 401 interceptor).** `POST /api/auth/refresh` (thin, NOT behind the guard — it must
    be reachable when the access token has expired) renews the cookies via `toAuthResponse`. The
    shared `apps/web/utils/api-client.ts` `apiFetch()` wraps `fetch`: on a `401` it triggers a
    single shared refresh, retries the original request, and only routes to
    `/login?redirectTo=<path>` if the session is truly gone. Feature `api.ts` transports adopt it by
    swapping `fetch`→`apiFetch` (done for `features/projects/core/api.ts`).

  This closes session **persistence** only; real signed-JWT **verification** via `@server/services`
  (this section's remaining TODO) is where any _access_ decision must still re-validate — the guard
  and RLS remain the real gates, per root CLAUDE.md Decisions #14/#16. See Decision #46.
- **Sign-out & the account projection (Decision #47).** `AuthService.logout()` →
  `POST /api/auth/logout` (thin) → fat `AuthBackendService.signOut(accessToken)` (live: best-effort
  GoTrue **global** revocation; stub: no-op) → the route **unconditionally clears** both `sb-*`
  cookies (`sessionClearCookies`). Cookie clearing is the authoritative sign-out; revocation is
  defence-in-depth, so a failed revocation never blocks logout. The header `UserActions` island then
  applies a **route-aware redirect**: a protected `(dashboard)` route leaves for the public landing
  (`/`); a public route reloads in place as a guest — the route GROUP that renders the shell is the
  public/protected source of truth (threaded `protectedRoute` → `UserShell` → `UserActions`, set
  only by the `(dashboard)` layout). The account popover binds **live account data** via
  `GET /api/user/me` (thin) → fat `services/user/UserBackendService.me({ context, accessToken })`,
  which composes the chrome `UserContext` (role badge + active workspace) with the live Supabase
  `auth.users` identity (name / email / avatar via `auth.getUser`), degrading to the context
  projection when the live read is unavailable (it only 401s a genuine guest). Shape: the Zod SSOT
  **`@projective/types/user`** (`CurrentUser`, `resolveAccountRole`). The thin client
  `AccountService.current()` is chrome-safe — a failed load resolves to `null` (→ the SSR-hydrated
  context fallback), never a sign-in redirect.
- **Google OAuth (PKCE).** `/api/auth/oauth/google` begins the Supabase handshake and persists the
  PKCE **code-verifier** in a short-lived cookie (a `CookieStore` storage adapter on the anon
  client); `/api/auth/callback` exchanges the `code` for a session, mints the `sb-*` cookies, clears
  the verifier, and routes — a **new** Google identity (no `org.users_public` yet) to `/join`
  pre-filled to finish onboarding via `complete_onboarding`, an existing user to their return path.
  `/join` is only for a **confirmed** brand-new identity: a `users_public` lookup failure defaults
  to _existing_ (route to the return path), so a transient error never re-onboards a returning user
  (Decision #46). All gated by `AUTH_BACKEND_LIVE`; non-live, the start route simulates the
  pre-filled-`/join` branch.
- **Enterprise SSO (SAML/OIDC).** `/api/auth/sso` calls `signInWithSSO({ domain })`; a resolved
  provider returns an IdP authorize URL that the login panel navigates to (carried as the external
  `AuthResult.ssoUrl`, distinct from the same-origin `redirectTo`). SSO reuses the OAuth PKCE
  machinery — the verifier cookie is set on the POST response and the IdP → GoTrue → **the same
  `/api/auth/callback`** completes the exchange. Enabling SAML needs `[auth.sso.saml]` +
  `SAML_PRIVATE_KEY` and a per-domain provider registered via the CLI (see `supabase/config.toml`);
  with none configured the panel shows a friendly "no provider" note.
- **Corporate-domain member signal.** On a standard (email/password) individual signup,
  `AuthBackendService.provisionAccount` fires a best-effort, non-blocking check: if the new
  address's domain matches an existing `org.organisations` registered domain (`website`, normalised
  — scheme / `www.` / path stripped; sub-domains match), it inserts a `comms.notifications` row
  (`type: "organisation.domain_member_signup"`) for that org's active **owners/admins** so they can
  invite or approve the colleague. No new schema — it reuses `comms.notifications` + the org
  membership join. Gated by `AUTH_BACKEND_LIVE` (non-live: no-op); any failure is swallowed so it
  can never fail account creation. OAuth completions are excluded (only inbound email
  registrations).

---

## Database

The Projective database layer is built on PostgreSQL via Supabase, emphasizing Row-Level Security
(RLS), high-performance vector search, and a strict quarantine-based storage lifecycle.

### Migrations

Migration files follow a strictly categorized numbering system to ensure predictable deployment and
prevent schema conflicts. Each range represents a specific layer of the database architecture:

- **0000 - 0099: Core Structure** (Enums, Schemas, Tables).
- **0100 - 0199: Logic Layer** (Functions, Stored Procedures, RPCs).
- **0200 - 0299: Security Layer** (RLS Policies, User Permissions).
- **0300 - 0399: Analytics Layer** (Views, Materialized Views).
- **0400+: Data Layer** (Seed data, initial population, lookups).

Remeber to utilise indexes and other PostgresQl features.

While in MVP development these can be edited manually.

### Searching & Recommender System

To achieve low-latency, high-relevance search, we utilize a **Triggered Search Table** pattern
combined with `pgvector`.

#### Search Architecture

- **Performance:** We avoid searching across complex JOIN views. Instead, dedicated search tables
  are populated via DB triggers whenever source records change.
- **Vector Encoding:** The system uses `pgvector` to store high-dimensional embeddings of text data.
- **Context-Aware Ranking:** The recommender system performs weighted vector similarity searches
  taking into account:
  - **User Context:** Preferences, interaction history, and search history.
  - **Work Context:** Project descriptions, budget constraints, and current freelancer workloads.
  - **Professional Context:** Freelancer headlines, project history, and desired budget.

### Storage Lifecycle

All file uploads follow a "Quarantine-First" protocol to protect the platform from malware and
viruses.

1. **Ingestion:** Files are initially uploaded to a `quarantine` bucket via the Supabase client.
2. **Scanning:** An Edge Function is triggered by the upload event. It scans the file for malware
   using a security provider API.
3. **Sanitization:** - **Clean:** If the file passes, the Edge Function moves it to the permanent
   destination bucket (e.g., `avatars`, `project-files`) and updates the database record.
   - **Infected:** If flagged, the file is deleted immediately, and a security log is generated.

### Edge Functions & Webhooks

Edge Functions act as the serverless orchestration layer for the platform, handling event-driven
logic and external integrations.

#### Core Functions

- **Virus Scanning:** Automated scanning of quarantined storage files.
- **Notifications:** Triggering push notifications, emails, or internal alerts based on database
  webhooks (e.g., a new project bid).
- **Background Tasks:** Handling heavy processing that exceeds the standard request-response timeout
  of Fresh routes.

#### Webhook Standards

- **Authenticity:** All incoming webhooks must verify signatures (e.g., from Stripe or Supabase)
  before processing.
- **Idempotency:** Functions must be designed to handle duplicate events without corrupting data or
  double-sending notifications.

---

## Security

Projective employs a multi-layered security architecture designed to enforce data isolation and
runtime integrity. By combining Deno's native sandboxing with PostgreSQL's Row-Level Security, we
ensure that security is not an afterthought but a core architectural constraint.

### Authentication & Authorization

The platform utilizes Supabase Auth for identity management, integrated directly into the Fresh
request lifecycle.

- **Auth Guards:** All routes within `./apps/web/routes/` are protected by a global `_middleware.ts`
  that validates the user's JWT before the handler is invoked.
- **Role-Based Access Control (RBAC):** Permissions are checked at the Service layer using custom
  claims within the JWT (e.g., `org_role`), ensuring that "Projective" users can only access
  resources within their authorized organizations.
- **Session Integrity:** We use secure, HTTP-only cookies for session persistence to mitigate
  XSS-based token theft.

### Row-Level Security (RLS)

RLS is mandatory for all database tables to prevent cross-tenant data leakage.

- **Tenant Isolation:** Every table containing user or organization data includes an
  `organization_id` or `user_id` column.
- **Policies:** Migration series `0200_org_rls.sql` defines strict `USING` and `WITH CHECK` clauses
  that verify the user's `auth.uid()` or `auth.jwt() -> 'org_id'` matches the row data.
- **Bypassing:** Only the service-role key (used within authenticated Edge Functions) can bypass RLS
  for administrative tasks like file scanning.

### Runtime & API Security

Deno 2.x provides a hardened environment that we strictly configure through permission manifests.

- **Sandboxing:** Our `deno.json` and task runners explicitly define permissions (e.g.,
  `--allow-net`, `--allow-env`). We never use `--allow-all` in production.
- **Input Validation:** Every API route handler uses Zod schemas from `@projective/types` to parse
  and validate request bodies before calling any Service. This prevents SQL injection and malformed
  data from reaching the logic layer.
- **Content Security Policy (CSP):** The Fresh application serves a strict CSP header that restricts
  script execution to trusted domains and the compiled WASM modules.
- **Secrets Management:** Sensitive keys (Stripe API, AWS keys) are stored in **Supabase Vault** and
  accessed via environment variables in Edge Functions, never hardcoded in the repository.

### Cryptography & WASM Integrity

For high-sensitivity operations, we utilize the `@projective/wasm` package for client-side
cryptographic tasks.

- **SubtleCrypto Wrappers:** We provide a standard interface for AES-GCM encryption for private chat
  messages and sensitive attachments.
- **WASM Isolation:** Rust-compiled WASM modules provide a predictable, memory-safe execution
  environment for handling file decryption and sensitive hashing, minimizing the risk of
  memory-unsafe operations in the browser.

### Audit & Compliance

- **Logging:** All mutations (INSERT, UPDATE, DELETE) are captured via PostgreSQL Audit Triggers to
  a non-deletable audit log.
- **Edge Monitoring:** Webhooks and Edge Functions log their execution status and integrity checks
  to a centralized monitoring service.

### Authentication & Identity

Projective utilizes Supabase Auth as the primary identity provider, deeply integrated with
PostgreSQL RLS.

- **MVP Authentication:** The initial release strictly supports **Google OAuth** and standard
  Email/Password authentication.
- **Extensibility:** The architecture must be built to support a unified integration model later. As
  traction builds, the platform will expand to include Microsoft (Azure AD), GitHub, and Apple SSO.
- **Database Sync:** A Supabase trigger automatically creates a corresponding public `users` profile
  record whenever a new identity is registered in the `auth.users` schema.
- **Transactional emails:** GoTrue sends branded, dual-path emails from `supabase/templates/` (wired
  in `config.toml` `[auth.email.template.*]`). The **confirmation** and **recovery** templates each
  surface the **6-digit OTP** (`{{ .Token }}`, `otp_length = 6`) _and_ a magic link, matching the
  `/verify` and `/forgot-password` "type the code or click the link" flows. They are premium,
  responsive, dark-mode-aware, and image-free (inline CSS + table layout, VML buttons for Outlook).
  Note `enable_confirmations = false` for local dev (mail lands in Inbucket).

---

## Internationalization, Currency & Localization

Projective is a currency-global, locale-aware, bidirectional application. The contract is resolved
from **one source of preference** (`org.user_preferences`) and applied at read time.

### Layout direction (RtL / LtR)

- The app supports **both** left-to-right and right-to-left layouts. Direction is chosen by user
  preference (`org.user_preferences.layout_direction` — `ltr` / `rtl` / `auto`) **independent of
  language**; `auto` falls back to the natural direction of the user's `locale`.
- **Mechanism:** the resolved direction is written as the `dir` attribute on the document root; the
  UI mirrors automatically because the codebase already styles with **CSS logical properties**
  (`inline-size`, `inset-inline`, `margin-inline`, `padding-inline`, `border-inline-*`) rather than
  physical `left`/`right`. Under RtL, sidebars flip to the right, list affordances mirror, and
  scroll/anchor logic follows the writing mode — with **no app-side per-component overrides**.
- **Migration target:** any remaining hardcoded physical-direction rule (`left:`/`right:`/
  `margin-left`/`text-align: left`) is a bug to convert to its logical equivalent. The RtL/LtR
  **token contract** is `DESIGN_SYSTEM.md` §A.6; UI implementation is a later pass (this is the
  contract).

### Locale & currency resolution

- `org.user_preferences.locale` (BCP-47, default `en-GB`) drives language, number/date formatting,
  and the `auto` direction fallback.
- **Money is stored in origin currency, displayed in the viewer's.** Stored/settled amounts are
  never converted. A **presentational currency-conversion service** resolves display figures at read
  time: it reads the viewer's `preferred_display_currency`, applies the **latest**
  `finance.fx_rates` row, and formats to locale — a pure read-model transform that touches no ledger
  row. The rate used at **commit** (settlement) is a separate, snapshotted value (`fx_*` columns)
  and is authoritative for money movement. See `finance-model.md` §11.

### Financial idempotency

Every money-mutating operation is idempotent: the service presents an operation key recorded in
`finance.idempotency_keys` (paired with Stripe's `Idempotency-Key`), so a retried request or
redelivered webhook replays the stored result instead of re-executing. This is a hard requirement
for any code path that moves money.

---

## Caching Strategy

Projective uses a tiered caching strategy to minimize latency and database load. We prioritize
"Stale-While-Revalidate" (SWR) patterns to ensure the UI is always responsive while data remains
fresh.

### Server-Side: Deno KV

Deno KV is our high-performance, atomic key-value store. We use it to offload Supabase read pressure
and manage ephemeral server state.

#### Maximizing Deno KV Potential

- **Secondary Indexing:** Since KV is key-ordered, we store data under multiple keys (e.g.,
  `['users', id]` and `['users_by_email', email]`) within an `atomic()` transaction to allow $O(1)$
  lookups by different attributes.
- **TTL (Time-To-Live):** We utilize the `expireIn` option for API response caching.
  - _Example:_ Cache project metadata for 5 minutes (`300_000ms`) to reduce RPC calls.
- **Atomic Operations:** Use `kv.atomic()` for counters (e.g., profile views) or optimistic locking
  to prevent race conditions during concurrent writes.
- **Queues:** Leverage `kv.enqueue()` for background tasks like processing images via WASM or
  sending notifications without blocking the HTTP response.

### Browser Storage: Local vs. Session

We strictly separate persistent configuration from transient session state to ensure a clean user
experience across tabs.

| Storage Type        | Usage Context                          | Examples                                                            |
| :------------------ | :------------------------------------- | :------------------------------------------------------------------ |
| **Local Storage**   | Permanent preferences & Heavy Metadata | Theme (Light/Dark), Language, Offline Drafts, E2E Public Keys.      |
| **Session Storage** | Tab-specific UI state                  | Multi-step form progress, scroll positions, "Back-to-List" filters. |
| **IndexedDB**       | Large Data Blobs                       | Cached WASM binaries, large project datasets for `DataDisplay`.     |

- **Logic Rule:** Never store sensitive JWTs in Local Storage if XSS risk is high; prefer HTTP-only
  cookies managed via Fresh middleware.

### Service Workers (SW)

Service Workers act as a programmable proxy between the Fresh App and the Network.

#### Best Practices

- **Pre-caching Assets:** On `install`, the SW fetches and caches the core UI bundle, CSS variables,
  and essential WASM modules.
- **Navigation Preload:** Enabled to allow the browser to start downloading the page HTML while the
  Service Worker is booting up.
- **Caching Strategies:**
  - **Cache-First:** For immutable assets (Fonts, Icons, compiled WASM).
  - **Network-First:** For critical data like User Profile or Permissions.
  - **Stale-While-Revalidate:** For the `GanttChart` or `Kanban` data, allowing the user to see the
    last-known state instantly while the new data fetches in the background.

### What to Cache (Selection Guide)

1. **Expensive Computations:** Results from WASM-based file compression or video handling should be
   cached in `IndexedDB` to avoid re-processing.
2. **Static Metadata:** Roles, Enums, and "Projective" platform configurations.
3. **Search Results:** Recently accessed `pgvector` search results can be cached in Deno KV to
   provide instant suggestions for common queries.

### Implementation Patterns

**Server-Side (Deno):**

```ts
// #region KV Cache Helper
/**
 * Wraps a service call with Deno KV caching logic.
 */
export async function withCache<T>(
	key: Deno.KvKey,
	fetcher: () => Promise<T>,
	ttl = 60_000,
): Promise<T> {
	const kv = await Deno.openKv();
	const cached = await kv.get<T>(key);

	if (cached.value) return cached.value;

	const fresh = await fetcher();
	await kv.set(key, fresh, { expireIn: ttl });
	return fresh;
}
```

---

## The Core Data Model (ERD & Zod Schemas)

To prevent type-drift and AI hallucinations, `@projective/types` acts as the **Single Source of
Truth (SSOT)** for the data model.

- **The Rule:** No table or column may exist in the Supabase SQL migrations without a perfectly
  matched Zod schema and TypeScript interface in the `types` package.

---

## State Hydration (Server to Island)

Fresh utilizes the "Islands Architecture." The boundary between server-rendered HTML and client-side
interactivity must be strictly maintained.

- **Data Fetching:** Data is **never** fetched directly inside an Island component via Supabase
  client.
- **The Pipeline:** 1. The Fresh Route (`/routes/projects/[id].tsx`) executes a Server-Side call to
  a backend Service (e.g., `ProjectService.getById()`). 2. The Route passes the resolved data down
  to the Island as standard props (e.g., `<ProjectBoardIsland initialData={project} />`). 3. The
  Island receives `initialData` and instantly hydrates it into a local `@preact/signals` state or
  Store class for high-performance interactivity.

---

## Integration Blueprints

"Integrations" must be structurally defined to prevent autonomous agents from hallucinating
incorrect API flows.

### 1. Stripe (Financial Engine)

- **Architecture:** We utilize **Stripe Connect Express** for Freelancers and Teams. This offloads
  KYC/AML compliance to Stripe. The platform owns the **ledger of record** (`finance.wallets` /
  `finance.transactions` / `finance.escrows` — who is owed what); Stripe owns the **fiat rails**.
- **Payment Flow:** We use **Destination Charges**. The Client’s credit card is charged
  (tap-and-pay, no client KYC), funds are held in the platform's Stripe balance (acting as Escrow),
  and upon approval, the funds are routed to the connected Express account minus the platform fee.
- **Identity & readiness (KYC/KYB):** **Stripe Identity** performs the freelancer Level-2 gov-ID /
  liveness check; **Stripe Connect** onboarding performs business KYB. The verdicts are mirrored
  into the app-owned caches (`org.freelancer_profiles.kyc_*`, `org.business_profiles.kyb_*`) and the
  `finance.verification_cases` trail — **only opaque provider references are stored, never PII**.
  The freelancer payout-ready gate (`finance.fn_freelancer_payout_ready`) is the "no forever-escrow"
  guarantee.
- **Idempotency:** every money-mutating call carries a `finance.idempotency_keys` key (and Stripe's
  own `Idempotency-Key` header) so a retried webhook or request **never double-moves money**.
- **FX:** cross-currency commits snapshot the rate used (`finance.fx_rates` → `fx_rate`/`fx_base`/
  `fx_as_of` on the ledger row) so settlement is reproducible; display conversion is read-time only.
- **Webhooks:** The `PaymentService` must listen to Stripe Webhooks (e.g.,
  `payment_intent.succeeded`, `transfer.created`, `identity.verification_session.verified`,
  `charge.dispute.created`) to update the internal `transactions` ledger, verification caches, and
  `finance.chargebacks`. Reconciliation compares the Stripe balance against the internal escrow pool
  (and `finance.v_wallet_reconciliation` checks ledger self-consistency).

### 2. Conferencing (Session Engine)

- **Architecture:** Freelancers connect their preferred conferencing tools via **OAuth** (e.g.,
  Google Calendar/Meet API, Zoom API) from their profile settings.
- **Room Generation:** When a Session time is finalized, the `SessionService` uses the Freelancer's
  OAuth token to generate a unique meeting link.
- **Verification:** The system listens to server-to-server Webhooks (e.g., Zoom's
  `participant_joined`) to power the "Digital Handshake" attendance logs.

---

## Testing Protocols

Testing is mandatory and must use the native Deno test runner (`Deno.test`).

- **Controllers (Routes):** Integration tests using mock HTTP requests to verify correct status
  codes and Zod payload validation.
- **Services (Logic):** Unit tests that mock the Supabase client to ensure financial math (Escrow
  splits) and Workload Intensity ($W_i$) algorithms are flawless.
- **Islands (UI):** DOM testing using Preact Testing Library to verify that signal changes correctly
  update the DOM without full re-renders.

---

## Environment Variable Contract

The application relies on a strict set of environment variables. The AI agent must scaffold a
`.env.example` using exactly these keys:

```env
# Application
DENO_ENV=development
APP_URL=http://localhost:8000

# Supabase (Database & Auth)
SUPABASE_URL=XXXX-XXXX
SUPABASE_ANON_KEY=XXXX-XXXX
SUPABASE_SERVICE_ROLE_KEY=XXXX-XXXX

# Authentication (OAuth)
GOOGLE_CLIENT_ID=XXXX-XXXX
GOOGLE_CLIENT_SECRET=XXXX-XXXX

# Stripe (Finance)
STRIPE_SECRET_KEY=XXXX-XXXX
STRIPE_WEBHOOK_SECRET=XXXX-XXXX
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=XXXX-XXXX

# Security
ENCRYPTION_KEY=XXXX-XXXX # 32-byte hex for Edge Function/Vault encryption
```

---

## Restructure Change Log (July 2026)

This file is a **verbatim move** of the former `brain2.md` with exactly two governed edits. Nothing
else — no directive, no rule, no code block — was altered, softened, or dropped.

1. **Renamed** `documentation/business/brain2.md` →
   `documentation/architecture/SYSTEM_ARCHITECTURE.md`. A redirect stub remains at the old path so
   existing references keep resolving.
2. **§2 UI sub-path taxonomy updated** from the former `atoms/fields/charts/data/time/files/system`
   split to the seven professional taxonomies now declared in `packages/ui/deno.json`:
   `layout / navigation / fields / display / feedback / overlay / utils`. The old aliases are marked
   deprecated shims.
3. **§3 gained the Material You theming-engine exception** — `@material/material-color-utilities` is
   an approved, tightly-scoped exception to "zero UI-library dependencies," usable **only** by
   `packages/ui/system/` to emit CSS custom properties. Components remain library-agnostic.

The full component roster, the token contract, the `<DesignSystemProvider>` context engine, and the
navigation-shell spec live in
[`documentation/design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md).
Product-management hierarchy and lifecycle live in
[`documentation/PRODUCT_MANAGEMENT.md`](../PRODUCT_MANAGEMENT.md).
