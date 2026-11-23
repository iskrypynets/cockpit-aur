# Changelog

## [0.5.11] - 2026-11-23

### Fixed
- **Mobile Sleep & Session Lock Recovery (`RootBoundary`, `App`)**:
  - Added automatic wake detection on `visibilitychange` and `focus` events when device is unlocked or browser tab is foregrounded.
  - Added transport health check on wake; automatically reloads the page to establish a fresh session if the Cockpit WebSocket connection was severed during sleep, eliminating the need to manually click "Reload page".
  - Configured systemd drop-in `idle-timeout.conf` (`--idle-timeout=0`) for `cockpit.service` to prevent Cockpit web service from automatically terminating after 90 seconds of connection inactivity.
  - Removed disruptive `systemctl restart cockpit.service` from `deploy.sh`, preserving live sessions during package updates.

## [0.5.10] - 2026-11-23

### Fixed
- **Consistent English Default Locale (`src/timeFormat.ts`, `src/i18n/index.ts`)**:
  - Pinned `Intl.RelativeTimeFormat`, `formatFullTimestamp`, and `formatFullDate` strictly to English (`en`, `en-US`), eliminating sporadic mixed-language localized date outputs (e.g. "учора" on English views).
  - Set default application locale strictly to English unless explicitly persisted via settings, ensuring a 100% consistent interface across all views.

## [0.5.9] - 2026-11-23

### Added
- **Mirror List Refresh Recommendation & Action (`UpdatesView`, `NetworkErrorState`)**:
  - Added contextual recommendation on update check timeouts and connection failures advising that unresponsive or stale mirrors are typically resolved by updating the mirror list.
  - Added direct **"Open Mirrors"** action button on update check failure states (`UpdatesView` empty state and `NetworkErrorState`) enabling one-click navigation to the Mirrors view to benchmark and update `/etc/pacman.d/mirrorlist`.
  - Added localized strings for English and Ukrainian (`openMirrors`, `mirrorRecommendation`).
- **Mirror Staleness Detection (`backend/src/handlers/query.rs`)**:
  - Implemented automatic check for `/etc/pacman.d/mirrorlist` age during `check-updates`.
  - When the mirrorlist was last modified over 30 days ago, surfaces a warning recommending a mirror refresh.

## [0.5.8] - 2026-11-23

### Fixed
- **Resilient Update Checks & Mirror Fallback Handling (`src/constants.ts`, `src/api.ts`)**:
  - Increased frontend timeout for `check-updates` (`CHECK_UPDATES_TIMEOUT_MS`) from 30s to 60s. This ensures ALPM database synchronization has adequate budget to timeout on unresponsive or unroutable top mirrors and fall back across healthy secondary mirrors without Cockpit killing the process mid-transfer.
- **Stale Lock & Partial Download Prevention (`backend/src/alpm/mod.rs`)**:
  - Enhanced `get_check_handle()` to automatically clear any stale `db.lck` and remove lingering `.part` download files from the isolated user check database directory (`/tmp/checkup-db-${UID}/`) on initialization, preventing aborted or timed-out check operations from locking future update checks.
- **Package Row Actions Testing Cleanup (`src/components/PackageRowActions.test.tsx`)**:
  - Added clean DOM teardown between test cases and explicit undefined reason initialization in install reason gating tests.

## [0.5.7] - 2026-11-23

### Added
- **Topological Dependency Graph Resolution (`backend/src/aur/deps.rs`)**:
  - Implemented full recursive AUR dependency build graph resolution via ALPM database inspection and AUR RPC.
  - Automatically identifies missing foreign runtime and build dependencies, filters out installed packages and repository satisfies, and performs topological sorting (Kahn's algorithm) to determine the exact build sequence.
  - Exposed via backend subcommand and endpoint `aur-resolve-graph`.
  - Integrated into `run_aur_operation` so background operation files (`/tmp/cockpit-aur-operation.json`) and progress tracking strictly adhere to the resolved topological graph.
- **Dual Localization (`en`, `uk`)**:
  - Implemented full internationalization architecture (`src/i18n/`) supporting both English (`en`, default) and Ukrainian (`uk`).
  - Added dynamic Cockpit language detection (`cockpit.language`) with browser fallback and manual persistence.
  - Translated top-level navigation tabs, transaction progress phases, status banners, action buttons, and modal dialogs.
  - Standardized all internal code comments and repository documentation strictly in English.

### Fixed
- **Robust Status Display during AUR Builds**:
  - Decoupled progress status tracking from fragile header string parsing.
  - Bound active package indexing and remaining package counts strictly to the pre-resolved topological build order, preventing progress jumps or displaying final explicit targets while earlier dependencies are compiling.

## [0.5.6] - 2026-11-23

### Fixed
- **Accurate AUR Progress & Active Package Tracking (`reduceAurProgress`)**:
  - Fixed premature advancement of package status and progress bar during multi-package AUR upgrades.
  - Eliminated restrictive target-list filtering that rejected dependency packages, ensuring currently compiling AUR dependencies (e.g. `lib32-libarchive` for `lib32-imlib2`) are accurately shown in the UI title, step label, and progress counter.
  - Added dynamic package and dependency discovery from helper headers (`:: X dependencies will also be installed`) and SRCINFO parsing (`:: (X/Y) Parsing SRCINFO: <pkg>`), keeping total package counts and remaining items synchronized with actual helper build queues.
  - Separated pre-download and source verification phases from compilation, preventing progress jumps to 75% before any package has started building.
  - Added support for Ukrainian and Russian localized `makepkg` and `pacman` status output (`==> Створення пакунка:`, `оновлення`, etc.).
  - Introduced `foldAurProgress` to batch-process log chunks and reconnected logs in a single pass, preventing excessive React re-renders and accumulator desynchronization.

## [0.5.5] - 2026-11-22

### Fixed
- **Accurate Official Repository Update Detection (`check-updates`)**:
  - Implemented safe, isolated mirror synchronization for update checking (`get_check_handle()`) using an isolated check database directory (`${CHECKUPDATES_DB:-/tmp/checkup-db-${UID}/}`) matching the standard Arch Linux `checkupdates` convention.
  - Automatically fetches the latest mirror databases over HTTP via non-forced conditional GET (`handle.syncdbs_mut().update(false)`), without requiring root privileges and without altering `/var/lib/pacman/sync/` (eliminating partial upgrade hazards).
  - Resolves the bug where `check-updates` only compared installed packages against stale local sync databases on disk (often resulting in 0 repo updates even when 90+ updates were pending on remote mirrors).
  - Falls back gracefully to system databases if offline or if isolated check database cannot be created.
- **Test Suite**:
  - Added unit test for `get_check_handle()` in backend.
  - Stabilized `installReason` in `PackageRowActions.test.tsx`.

## [0.5.4] - 2026-11-22

### Added
- **Resilient Background AUR Operations**:
  - `systemd-run --user --scope` execution for AUR helpers (`yay`, `paru`), ensuring builds continue uninterrupted across session drops or browser closes.
  - SIGPIPE immunity and persistent disk-backed state tracking (`/run/user/<uid>/cockpit-aur-run.json`) with exit code recording.
  - Seamless frontend reconnection and live log resumption upon page reload or network recovery.
- **Enhanced Mobile Terminal Experience**:
  - Touch-friendly scrollbar slider in Cockpit Tools Terminal (`terminal.html`).
  - Collapsible floating action button (FAB) toggle for terminal settings, keeping the screen unobstructed on mobile viewports.
  - 1000-line scrollback buffer and persistent viewport position tracking.
- **Automated Deployment Pipeline & Verification**:
  - Integrated `./deploy.sh` script with automated multi-node deployment (`vampa`, `plex`, `all`).
  - Comprehensive 16-point deployment self-test suite (`tools/verify_deploy.py`) checking file permissions, user scopes, pacman lock hygiene, and backend IPC health.
  - Clean plain-text MOTD banner generator (`tools/generate_motd.sh`) with pure monochrome ASCII rendering.

### Changed
- Reverted all experimental Cockpit core monkey-patches byte-for-byte to pristine upstream Arch Linux packages.
- Dynamic runtime user-agent string using Rust `CARGO_PKG_VERSION` in `arch-http-client` and AUR RPC.

### Fixed
- Fixed ESLint configuration and React 19 hook anti-patterns across `HistoryView`, `SettingsModal`, `LogViewer`, and graph hooks (0 errors, 0 warnings).
- Resolved focus restoration timing and dialog animation race conditions in `rowFocus`, `PackageRowActions`, `RepositoriesView`, and `MirrorsView` tests.
- Re-synced full test suite: 2,167/2,167 frontend tests passing, 705/705 backend tests passing.

## [0.5.3] - 2026-11-20

### Added
- Floating "Copy" button in Cockpit Tools Terminal (`terminal.html`) with support for copying active text selection or full console output, including touch text-selection styles.
- Auto-sync to both `$HOME/.local/share/cockpit/aur` and `/usr/share/cockpit/aur` in `deploy.sh` to prevent user directory overrides from shadowing system updates.
- Documentation and recommendations for avoiding Cockpit session timeouts and preserving sudo administrative access during remote/mobile sessions.

### Fixed
- Fixed pagination controls (`CompactPagination`) being completely invisible on mobile and narrow screens (< 768px) due to PatternFly v6 CSS defaults.
- Fixed updates table layout squishing on mobile: migrated to `table-layout: auto`, added word wrapping for long package names, and allowed version arrows to wrap cleanly.
- Fixed inconsistent widths and chaotic wrapping of system overview tiles by using a responsive uniform CSS Grid (`minmax(130px, 1fr)`).
- Added cache-busting query strings to `index.html` to ensure immediate browser reload of bundled JS/CSS assets without requiring manual cache clearing.

## [0.5.2] - 2026-11-19

### Added
- Modernized terminal-style `LogViewer` with semantic syntax highlighting (errors, warnings, successes, AUR build steps, hooks), line counter, live/paused auto-scroll badge, and copy-to-clipboard button.
- Initiator identification badges for all transactions in History (`From Cockpit`, `Scheduled upgrade`, `AUR (yay/paru)`, `CLI (Pacman)`, `CLI / Terminal`).
- Explicit `[COCKPIT-AUR]` transaction logging to `/var/log/pacman.log` and stream events for AUR helper runs.

### Changed
- Migrated official repository URL to GitHub (`https://github.com/iskrypynets/cockpit-aur`) and added acknowledgments to the original `cockpit-pacman` project.
- Updated Rust dependencies (`sha2` 0.11.1, `tokio` 1.54.1, `serde_json` 1.0.154, `libc` 0.2.191, `rustls` 0.23.46, `flate2` 1.1.11, `html2text` 0.17.4).
- Updated frontend and dev dependencies (`@patternfly/*` 6.7.0, `react` / `react-dom` 19.3.1, `d3-*` 3.0.1/3.0.2, `@typescript-eslint/*` 8.72.2, `vitest` 5.1.0, `jsdom` 31.0.0, `@playwright/test` 1.65.0).
- Cleaned up legacy `cockpit-pacman` screenshots, benchmark notes, and updated CI binary verification path.

### Fixed
- Fixed missing initiator labels for CLI `pacman`, AUR helper, and untracked transactions in `HistoryView` and `TransactionBanner`.

## [0.5.1] - 2026-11-18

### Changed
- Project renamed to `cockpit-aur` with support for Arch User Repository (AUR) helpers (`yay`, `paru`).
- Renamed system plugin path to `/usr/share/cockpit/aur` and backend executable to `cockpit-aur-backend`.
- Updated package maintainer email to `green_forest@ukr.net`.

### Fixed
- Fixed ESLint / React 19 `set-state-in-effect` warning in `PKGBUILDModal`.
- Resolved `cargo clippy` warnings in Rust AUR runner and update handlers.
- Hardened AUR helper execution to safely refuse unprivileged execution when root lacks a delegated user context.

## [0.5.0] - 2026-11-17

### Added
- Complete AUR integration: package search, package details, and PKGBUILD viewer with syntax highlighting.
- Execution of AUR helpers (`yay`, `paru`) with streaming log output, cancellation guard, and non-root isolation.
- Version tracking of foreign packages via AUR RPC metadata.
- Official `PKGBUILD` for native Arch Linux packaging with `provides` and `conflicts` (`cockpit-pacman`, `cockpit-yay`).
- Stale service detection and restart prompts after system upgrades.

## [0.4.1] - 2026-10-20

### Added
- Review and merge `.pacnew` and `.pacsave` files under `/etc` from Updates, with automatic backups.

### Fixed
- Only count security fixes available in configured repositories, and refresh their availability when updates change.
- Correct application version metadata so older pages detect upgrades and prompt for a reload.
- Flag pending updates that fix an advisory the tracker has already marked fixed.

## [0.4.0] - 2026-10-20

### Added
- Package previews show dependencies, removals and disk space before confirmation.
- Installing while system updates are pending warns about partial upgrades.
- Package drawers, row actions, reinstall and install-reason controls.
- Bookmarkable views, keyboard shortcuts and a searchable package jump.
- Background transactions with shared progress and result notices.
- Repository and mirror editing with checked Undo and outside-change recovery.
- Repository key import by fingerprint, with a separate local-signing step.
- Cache cleanup estimates, filtered selection and recovery for upgrades short on space.
- History origins and date filters; scheduled run details and post-upgrade tidy-up.
- Reversible notice dismissals and recovery for unavailable ArchWeb credentials.
- HTTP, HTTPS and SOCKS proxy support for interactive and scheduled operations.

### Fixed
- Cancellation waits for package writes and post-transaction hooks to finish.
- Failed or partially applied transactions retain their error and applied state.
- Package conflicts require removal consent; saved package ignores survive refreshes.
- Page opening reads existing databases without starting a root database sync.
- Config saves and Undo reject stale revisions; restore backups remain recoverable.
- Scheduled failures and missing run records remain visible.
- Keyring timeouts and cancellation terminate child processes and release locks.
- Cache and history reads are paged or cached; inactive tabs load on demand.
- Unreadable settings, failed advisory writes and local connection errors keep their diagnostics.
- Development installation leaves package-owned system files alone.

## [0.3.8] - 2026-08-30

### Added
- Security advisories can be turned off with `security_advisories` in `/etc/cockpit-pacman/config.json`
- Advisories an update fixes are separated from ones with no fix available, so the count and the severity badge only reflect work you can actually do
- Advisory groups the tracker has not triaged are reported rather than dropped, so a group carrying a real fixed version is no longer withheld
- Scheduled runs record how long they took, why they were skipped, and whether they cleaned up after a run that was killed
- The schedule modal shows the calendar systemd is actually on beside the configured one
- A failed scheduled run is reported to the journal, so a run that dies before it can record anything still leaves a trace
- Warning before leaving the page during a running upgrade
- Warning when the open page is older than the backend it talks to, which happens when the plugin is upgraded under an open session
- Mirror backups show which were taken by hand
- Troubleshooting page in the documentation

### Changed
- Downgrades report progress and errors like every other package operation, and can be cancelled at a safe point
- An interactive upgrade refreshes the package databases first and refuses to continue if a repository fails, rather than applying a partial upgrade
- Most commands no longer ask for administrative access they do not use, so a session that has not escalated keeps the Updates and Repositories tabs
- The Updates tab no longer re-downloads the package databases on every visit, and reuses the security tracker feed for an hour instead of fetching it on every visit
- The orphan, cache and keyring tiles no longer wait for archlinux.org to answer before they settle
- Listing installed packages drops from about 334ms to 60ms, the service restart check from 818ms to 18ms, and cleaning the cache no longer opens every archive it is keeping
- An upgrade no longer floods the log viewer with alpm's own tracing, and the view stays responsive while one runs
- The dependency graph no longer relays out on every keystroke

### Fixed
- A cancelled or interrupted upgrade is no longer reported as a successful one
- Cancelling before anything was applied no longer warns that the system may be inconsistent
- Logging out, or Cockpit restarting its websocket, no longer interrupts a running upgrade
- Install, remove and orphan removal can be cancelled at a safe point
- Saving `pacman.conf` no longer reorders sections or moves comments away from the lines they describe
- A repository disabled and re-enabled in the UI keeps its servers instead of ending up with none
- A save that would leave pacman with no enabled repository or mirror is refused
- A restore no longer deletes older backups, and manual backups outrank automatic ones
- A stale database lock is no longer removed when the check could not see who held it, and clearing one leaves a notice on the page and a line in the journal
- The keyring view no longer offers to initialize a keyring it could not read
- The keyring permission warning expects pacman's default 755 instead of recommending 700, and a symlinked keyring directory no longer draws a warning
- A dismissed `.pacnew` no longer hides a later config file written to the same path
- Realtime kernels are identified correctly and count as needing a reboot
- The service restart check says when it could not see every process
- A malformed `config.json` no longer silently empties the ignored-package list, letting packages you excluded come back as pending updates
- The schedule modal and the ignored-package list load in a session that has not escalated, and a run history that cannot be read is no longer shown as an empty one
- Choosing a filter while a search is still in flight no longer has the older results overwrite the filtered ones
- The dependency graph holds to its node cap
- A streaming failure shows the backend's full error context instead of only its headline
- Applying a schedule no longer leaves the systemd timer and `config.json` disagreeing when part of the change fails
- A scheduled run that failed during the commit records what alpm said instead of blaming the timeout

## [0.3.7] - 2026-06-15

### Added
- Downgrade packages to any earlier version using the Arch Linux Archive
- `pacman.conf` backup history with restore and delete in the Repositories tab
- Pagination in the Updates and Mirrors lists
- Clicking the Security tile filters the updates list to security upgrades
- Notification when an upgrade leaves `.pacnew`/`.pacsave` config files that need merging
- After clearing a stale database lock, the interrupted sync, upgrade, or downgrade resumes automatically, including upgrades waiting on a confirmation
- Confirmation prompt before setting a repository SigLevel that disables signature verification
- Failed or deferred scheduled upgrades now surface in the Updates view and the Cockpit overview health card
- More tooltips and popovers explaining controls across the UI

### Changed
- Cache info, downgrade listing, and mirror testing are much faster on large package caches and when testing many mirrors
- Network failures are now detected and the affected views degrade gracefully instead of showing raw errors when offline
- The plugin page loads faster on first open

### Fixed
- Cancelling a sync or upgrade no longer risks interrupting a transaction mid-commit
- Cancelling a downgrade no longer risks leaving the pacman database locked
- An upgrade no longer hangs holding the package database lock if the Cockpit page stops reading its output
- Package details in the signoffs view now resolve against the package's own repository

## [0.3.6] - 2026-05-11

### Added
- Repositories tab for managing `pacman.conf` repositories (db8fdc6, 1972c3d)
- Services-restart alert in Updates view for stale systemd services after an upgrade (0237f04, 49e0c2c)
- Dismissable services-restart alert (47a5262)
- Dismissable system reboot alert (7286d2d)
- Ignore and unignore actions in the package details modal and row kebab (f0053fe, 8a8869e)
- Update status published to the Cockpit overview page health card (33e55fb)

### Changed
- Banners render above the card on every tab (8cdf0e4)
- Ignored packages can no longer be selected in the updates list (5f583f2)
- Mirrors view no longer renders repo-specific overrides (now managed in Repositories) (5d90c0c)
- Update-stats per package cached against pacman.log mtime to avoid rewalking the log on every package details open (65ffa9e)

### Fixed
- Repositories filter change silently dropping unsaved edits (0c75779)
- Modals closing on any click outside the dialog instead of only backdrop clicks (dfdaa63)
- Kernel preflight missing non-stock kernels that did not match by provides (cf90afa)
- News dismissals not persisting across reloads (f1ce9b0)
- Save Changes button misaligned with the Mirrors toolbar (bb1e53b)
- Ignored update rows briefly misrendering while ignore state loaded after the update list (f3a85c7)
- News summaries with multi-byte characters truncating mid-codepoint (23ed2e7)
- Backend panics on NTP backward time steps and mutex poisoning in the repo cache (4a4c0e9)

## [0.3.5] - 2026-04-12

### Added
- Reboot Now button and reboot-on-completion checkbox in post-upgrade flow (ea38b6c)
- Per-repository mirror servers shown inline with source pills (ada39fe)
- Auto-run mirror status fetch and latency tests on load (11947da)
- Mirrorlist refresh using the Arch mirror status API (c81f3fb)
- Mirrorlist backup history with restore and delete (8393c6e)
- Added/removed diff view when previewing mirrorlist changes (058d895)

### Changed
- Unified mirrors table combining global mirrorlist and repo overrides (ada39fe)
- All timestamps display as relative time with full timestamp on hover (3ef9fa4)

### Fixed
- Stale pacman database lock detection and recovery (2ce5fa8)
- IPv6 fallback for HTTP mirror requests (4525373)
- Double-click vs single-click distinction on dependency graph nodes (cae14fb)

## [0.3.4] - 2026-03-26

### Added
- Contextual popover explainers and clickable license links (afd4de7)
- Cache table grouped by package name with version pills (bae0156)
- ArchWeb package signoff support with sign and revoke actions (58ae312)
- Pagination in the signoffs table (bac7d05)
- Update frequency and packaging metadata in package details modal (e4b0e09)
- View history button in package details modal (aade846)
- Package install from the details modal (b89a33f)
- Arch Security Tracker integration with severity badges and vulnerable package count (cc30314)

### Fixed
- History search input losing focus during background refetch (bdebb0c)
- Manage buttons not visible in up-to-date view (6197cb2)

## [0.3.3] - 2026-03-15

### Added
- Package uninstall from the details modal with confirmation and progress feedback (0fcd6e4)
- Package name search and expand-all toggle in History view (66d12b0)
- Preflight warning when firmware packages are upgraded without a matching kernel upgrade (d9e49ec)

### Changed
- Updates view now syncs the package database on load instead of relying on stale state (fd9e47d)

## [0.3.2] - 2026-02-28

### Fixed
- Dependency graph max depth warning only shown when slider is at maximum (7330ecc)

## [0.3.1] - 2026-02-20

### Added
- Arch Linux news feed in the Updates tab (d509747)
- Network error detection with link to Arch Linux status page (1f46219)

### Fixed
- System hooks not running after upgrades due to alpm_utils overwriting hookdir (9f5de24)
- Alerts positioned outside card in up-to-date view (496cfbd)

## [0.3.0] - 2026-01-23

### Added
- Mirror management tab for viewing, testing, and saving mirrors (5825ee9)
- Dependency graph visualization in Installed Packages tab (b618384, 32f333d)
- Scheduled unattended upgrades via systemd timer (c1432fe)
- Reboot indicator after kernel or critical package updates (e35edff)
- History entries grouped by upgrade runs with accordion UI (fe3b998)
- Clickable rows for package details in more views (9f62de5)
- Auto-fetch mirror status on load when cache is empty (cd04ce5)

### Fixed
- Race conditions and memory leaks in frontend/backend (b27f260)
- Provides packages not resolved in dependency graph (8268af7)

## [0.2.0] - 2026-01-18

### Added
- Cache tab for viewing and cleaning package cache with configurable version retention (7dd68aa)
- History tab for browsing pacman.log with filtering by action type (7dd68aa)
- Package downgrade support from cached versions in package details (7dd68aa)
- Orphans tab for viewing and removing orphan packages (ad0eccd)
- Ignored packages feature to exclude packages from upgrades (f045b11, 0bf5ffc)
- Typeahead search when adding ignored packages with version preview (9e3bc1a)
- Timeout protection for long-running operations (26792fc)
- Graceful error recovery with reload option when errors occur (ea43efa, b9a7fdc)

### Changed
- Renamed "pinned" to "ignored" to match pacman terminology (0bf5ffc)
- Improved keyring view with support for all trust levels (0bf5ffc)
- Redesigned statistics display across all tabs (e72365e, 9692a22, feb17f0)
- Numbers now display with thousands separators (feb17f0)

### Fixed
- Package downgrade not finding cached versions (d8ebfb2)
- Operations could fail if a previous operation was cancelled (fb218c3)
- Cache cleanup now validates version count (max 100) (fb218c3)
- Improved error messages with better formatting (fb218c3)
- Negative file sizes no longer display incorrectly (b5471c8)
