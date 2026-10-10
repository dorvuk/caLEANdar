# caLEANdar

This is completely vibe-coded but it helps me organize my classes :)

A local-first university calendar for Windows and macOS. A quiet, monochrome interface with a scheduling engine that keeps recurring edits predictable and reversible. No accounts, cloud, telemetry, or runtime server.

## Run it

On this Windows machine, the built installer is:

```
src-tauri/target/release/bundle/nsis/caLEANdar_1.0.2_x64-setup.exe
```

The standalone application is `src-tauri/target/release/caleandar.exe`. The application needs the Microsoft WebView2 runtime, normally present on Windows 10/11. The installer includes the bootstrapper for machines that need it; installing a missing runtime requires an internet connection. Once the runtime is installed, caLEANdar runs completely offline.

The first launch opens an empty calendar. Select **Preview the sample timetable** to try a synthetic winter timetable, including a source exception and individually listed weekly classes. The same file is at [samples/fri-sample.ics](samples/fri-sample.ics). Its courses and instructors are illustrative.

Branding comes from [assets/opaq.png](assets/opaq.png) for desktop icons and the browser favicon, and [assets/transp.png](assets/transp.png) for the sidebar, loading/empty states, and PNG exports. Regenerate platform icons after replacing the opaque asset with `npm run tauri -- icon assets/opaq.png`.

## Develop and build

Prerequisites: Node.js 22.12 or newer, npm, and stable Rust 1.90 or newer. Follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

- **Windows:** Visual Studio C++ desktop build tools, a Windows SDK, and WebView2.
- **macOS:** Xcode command-line tools (`xcode-select --install`). Build installers on a Mac; Windows does not cross-build a macOS application.

```sh
npm ci
npm run desktop         # native desktop development
npm run desktop:build   # Windows NSIS installer, or macOS .app and .dmg
```

On this workspace, Rust was installed into the ignored `.tools` directory without changing the system PATH. The Windows helper automatically uses it:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 dev
powershell -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 build
powershell -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 test
```

For frontend development, `npm run dev` opens a browser preview at `http://127.0.0.1:1420`. This preview uses browser storage and browser downloads. The installed desktop app uses SQLite and native file dialogs. Preview data is independent of desktop data; transfer it using a configuration export.

macOS bundles appear under `src-tauri/target/release/bundle/macos` and `bundle/dmg`. Windows installers appear under `bundle/nsis`. Builds are unsigned; macOS distribution requires your own Apple signing/notarization credentials. Installed applications require neither Node nor Rust.

## Everyday use

1. Click **Import timetable** or drop one `.ics` / `.ical` file onto the app. Review courses, source changes, skipped records, and removals before importing. The app detects existing sources by content, filename, or matching UIDs; choose a destination explicitly when updating one of several sources.
2. Click an event to edit it. Choose **This occurrence**, **All weeks**, or **This & future**. For recurring edits, choose the inclusive original-date range and either preserve imported occurrence weeks or explicitly generate every eligible week.
3. Set a new weekly day by changing the editor's date to that weekday. A Friday moved to Monday moves to Monday of its original ISO week. It replaces the Friday position. The original occurrence identity is retained.
4. Individual edits and cancellations have higher precedence than later recurring edits. To clear one, select **Clear this exception**, or use **Course details → Individual exceptions → Restore**. **Use original for this date** bypasses session edits for that occurrence. **Reset whole session** clears its recurring edits, exceptions, and extra occurrences; course names/groupings/default metadata remain separate.
5. To add an extra occurrence, edit the date/time in the event panel and choose **Add extra at these times**. This creates a deliberate extra, with its own identity.
6. Use **New course** for standalone courses or personal activities, or drag across time slots to prefill the exact selected start and end. Click a course in the sidebar to change its color, name, or other defaults. **Group lectures, labs & tutorials** lets you select separate courses and put their sessions under a shared name/color; each session retains its type, original identity, and edits. Session types can also be changed individually. Course details lets you reorder, move or separate sessions, and add additional weekly meetings. A recurring source with multiple weekdays can be separated into independent weekday sessions, with its exceptions retained. Hiding a course preserves it. Removing a course/session requires confirmation and can be reversed in **Settings → Recovery**.
7. Navigate with the sidebar mini calendar, the dated button's calendar picker, Today, and previous/next controls. Keyboard shortcuts: `N` new course, `T` today, `←` / `→` previous/next period. Shortcuts are disabled while typing, editing, or using the date picker. Week/day views have no all-day row; imported all-day events remain available in Month view and PNG exports.
8. **Settings** controls appearance, time range, weekends, calendar timezone, labels, default view, and course types. Font sizes, density, and light/dark appearance persist. Floating imports and recurring edits use this timezone's wall clock; changing it reinterprets those times. Zoned imports and explicit occurrence times retain their instants.

The default pixel font is [Pixelify Sans](https://github.com/google/fonts/tree/main/ofl/pixelifysans), bundled locally and embedded in PNG rendering. It requires no font download or installation. Its [SIL Open Font License](public/licenses/PixelifySans-OFL.txt) is included in the application. Individual course colors persist and are included in both PNG modes and JSON transfers; courses without a color follow the theme accent. Updating from 1.0.0 uses the same database and keeps existing courses and settings.

## Reimporting

Reimports match a source's UIDs. Changed baselines replace the imported layer; course grouping, visibility, removed flags, session patches, and individual exceptions remain. Source removals are retained as tombstones with the original UID and baseline, so returning records recover their overrides. Unsupported records are reported and their existing baselines retained. Source data and edits are committed together.

Separately listed events are grouped only when the name, room, description, instructor, timezone, weekday, start time, and duration match exactly, and they occupy different weeks. Similar names alone do not merge. If the university regenerates UIDs or changes the original recurrence timestamps, the app cannot reliably infer the identity of those occurrences: the preview reports unmatched sources, and old overrides remain recoverable rather than being reassigned speculatively.

## PNG export

**Export PNG** offers a selected real calendar week with all effective exceptions, or a generic weekly pattern. Choose hours, weekends, and 1×–4× resolution. A preview shows the actual exported layout. Overlaps use separate columns; overnight events split across day columns. Short events automatically increase the vertical scale to fit their labels. The desktop presents a native Save dialog.

The generic pattern excludes one-off events, nonweekly rules, and individual exceptions. It shows regular slots, without teaching gaps or alternate-week intervals, and uses the recurring pattern at the chosen date. Use the selected-week mode for an exact schedule. Events outside the selected visible hours are excluded. Oversized exports produce a useful error instead of an empty or truncated PNG.

## Academic calendar

The optional **FRI · 2026/27** preset uses inclusive teaching and examination dates from the [official FRI study calendar](https://www.fri.uni-lj.si/en/study-calendar), verified during implementation. Academic settings are separate from timetable imports. In **Settings → Academic**, edit periods and breaks, select a year, or create an empty future year with dates you verify yourself. Academic week 1 is the Monday-based week containing each semester's first teaching day.

Overlays and Slovenian days off are visual guides. They never cancel existing events. New recurring courses can exclude non-teaching dates when generated; subsequent academic edits do not retroactively suppress their classes. There is no scraping or background updater. Export timetables yourself from the [FRI timetable website](https://urnik.fri.uni-lj.si/) and import the downloaded file.

## Transfer and recover

In **Settings → Recovery**, export a configuration JSON, copy it to your other computer, and import it there. Schema version 1 contains complete source text, courses, session baselines, date-range edits, occurrence exceptions, extras, academic years/breaks, and preferences. It contains no machine-specific source paths.

Imports validate versions, types, dates, recurrence limits, identities, and references before saving. **Replace** explains the replacement and backs up the current state in the same transaction. **Merge** deduplicates matching IDs, lists conflicts, and lets you choose current or incoming records. It never automatically resolves conflicting manual changes. Independently created records have independent IDs.

Every desktop save retains the previous complete configuration; the last 50 snapshots are available in Recovery. Browser preview retains 5. Failed saves leave the displayed state unchanged. Revision checks prevent a second application window from overwriting a newer save.

Local desktop data is in the standard application-data directory:

- Windows: `%APPDATA%\si.caleandar.desktop\calendar.sqlite`
- macOS: `~/Library/Application Support/si.caleandar.desktop/calendar.sqlite`

SQLite uses WAL and full synchronous commits. Close the application before copying the raw database; use configuration export for transferring between machines. Uninstalling or updating the executable does not migrate source files from their original disk locations: all necessary contents are already in the local database.

## Architecture

```
src/core/       model, iCalendar import, recurrence/override engine, dates,
                configuration validation/merge, labels, PNG rendering
src/platform/   Tauri IPC and browser-preview adapter
src/ui/         React calendar, sidebar, contextual editors, settings
src-tauri/src/  native dialogs/files and transactional SQLite storage
samples/        synthetic offline timetable
tests/          recurrence, formats, configuration, PNG, scale and UI workflows
```

- **Tauri 2** embeds built frontend assets and uses the operating system's webview. Rust provides SQLite and native file dialogs. There is no separately running backend in the installed app.
- **React + TypeScript + Vite** provide a small, direct UI with ordinary component state.
- **FullCalendar** handles week/month/day layout, selection, overlap positioning, and drag/resize interactions. Dragging opens the scope editor before committing.
- **ical.js** parses VEVENT, RRULE, RDATE, EXDATE, RECURRENCE-ID, embedded VTIMEZONE, and source range exceptions. **Luxon/Intl** provide IANA timezone offsets, local editing, and Gregorian/ISO-week date arithmetic; timezone information is available offline.
- The engine applies **imported baseline → date-range session patches → individual exception**, with an occurrence key derived from **session ID + source UID + original recurrence timestamp**. Explicit extras have UUIDs. No permanent weekly instance table is generated. Expansion is bounded to the visible window; iterator checkpoints and date prefilters keep repeated navigation inexpensive.
- SQLite stores the versioned state as a single JSON document plus transactionally managed prior snapshots. This deliberately keeps portable state and native storage identical, and makes multi-record imports atomic. `PRAGMA user_version` handles schema migration; newer unsupported database schemas are refused. The TypeScript validator defines the portable schema alongside `src/core/model.ts`.
- PNG export renders a self-contained SVG into a canvas and encodes a standard PNG without screenshots, external fonts, or remote resources.

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

Tests cover the required Friday-to-Monday move in RRULE and separate-event formats, isolated week edits, cancellation/restoration, later series edits, reimport/removal/return, configuration transfer, Ljubljana DST, floating/UTC times, RDATE/EXDATE/source exceptions, large date moves, generated weeks, academic boundaries, overlap layout, and 5,000-event imports. Playwright tests the complete UI workflow, reload, malformed-file protection, JSON transfer, and downloaded PNG signature/resolution. Rust tests exercise migrations, disk persistence, backups, and stale writes. Native Windows validation also exercises the compiled webview, SQLite IPC, reload, and PNG canvas with external network requests blocked.

The native validation build uses `tests/native/tauri.conf.json` and the separate `si.caleandar.validation` data directory. `scripts/native-smoke.mjs` attaches to that hidden build's WebView2 debugging port 9223. Production builds do not enable that port.

## Limits in version 1

- Sub-daily recurrence rules, deprecated EXRULE, RDATE periods with varying durations, and orphan RECURRENCE-ID records are rejected with an explanation. Standard daily, weekly, monthly, and yearly rules are supported; recurring rules must remain below the safe expansion limit of 200,000 iterator steps per window.
- A recurring source initially forms one session. For a weekly RRULE with multiple BYDAY entries, use **Course details → Separate a weekday** before editing one weekday independently. Filters keep the original source rules and keys intact through reimports. Explicit extra occurrences stay with the original session when separating weekdays.
- Automatic grouping of separately listed classes is deliberately conservative. Session merges that would combine conflicting recurrence overrides are not automatic.
- Native imports are UTF-8 text. Calendar files are limited to 20 MB and 50,000 VEVENT records; complete configurations are limited to 40 MB. Unsupported/newer configuration versions are not guessed or silently converted.
- In a DST gap, an explicitly entered local time is rejected; choose an existing time. Ambiguous fall-back times follow Luxon/Intl's zone-offset choice. The UI is optimized for ordinary daytime classes.
- macOS source/build support is included, but macOS runtime validation requires a Mac. The Windows app and installer were built and tested here. Distribution signing is left to the application owner.
