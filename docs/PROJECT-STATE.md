# Upload Hub project state

Sources are **Upload Hub — Product Specification v1.0** and **Software Development Workflow V5**. The app is a Node.js web server with server-rendered HTML, browser-native form controls, and SQLite on persistent local storage. The MVP role is Owner. P1 builds on P0 foundation commit `e1c0707`.

## P0 Foundation

| Acceptance | Owner route and behavior | Verification |
| --- | --- | --- |
| AC-0.1 / FEAT-001 | `/login` uses the owner account created by `pnpm run setup`. Wrong credentials return an error without a session. Sign-out revokes the session. | HTTP integration tests and interactive setup check |
| AC-0.2 | The shell uses a desktop and tablet sidebar, and a bottom bar through 760px. It links to Channels and Settings. | Chromium at 1440px, 820px, and 390px |
| AC-0.3 / FEAT-011 | `/settings` saves profile details and the time zone. The first sign-in uses the browser time zone and falls back to UTC. | HTTP integration tests read back settings from a separate database connection and after sign-out/sign-in |
| AC-0.4 | The same components use the specification's light and dark palettes. | Browser token checks and screenshot review in light and dark |

The P0 scope names Channels in navigation, while the route registry assigns channel management to P1. P0 provides the protected empty Channels landing page. P1 adds the first-run wizard, folder management, upload and draft preparation. Settings covers profile and time zone in P0. The schema includes the 30-day retention default. Storage controls and usage depend on the media lifecycle. Account deletion requires the dependent-data lifecycle, and export is assigned to P3.

No provider or paid service is required for P0. The publishing engine, TikTok mode, storage budget and partner budget decisions still apply before their corresponding integration work.


## P1 Channels and Video Preparation

| Acceptance | Owner workflow | Verification |
| --- | --- | --- |
| AC-1.1 / FEAT-002 | Onboarding creates the first channel or can be skipped. Active folders can be created, renamed, archived, restored and deleted with typed-name confirmation. Archived drafts and defaults are read-only. | HTTP lifecycle tests and Chromium onboarding |
| AC-1.2 / FEAT-003 | Private MP4/MOV upload uses checked byte offsets. Browser retries resume from the stored offset and support cancel and reselect after reload. | Interrupted HTTP request and Chromium network interruption after a completed chunk |
| AC-1.3 and AC-1.4 / FEAT-006 | Media inspection suggests Short or Long. Platforms shows eligibility and explains ineligibility. | FFmpeg fixtures for a 60-second portrait and 600-second landscape video |
| AC-1.5 / FEAT-005 | Details validates and autosaves metadata. Review previews the eligible platforms and saves the draft. Custom thumbnails and frame selection are available. | Server title validation, thumbnail validation and source-range tests. Chromium draft save and frame selection |
| AC-1.6 / BR-013 | Duplicate detection asks whether to open the existing draft or create another. | Both options verified across Chromium and HTTP tests |
| AC-1.7 / BR-009 | Defaults are copied when adding a video. Existing drafts keep their defaults when a folder's defaults change. | HTTP tests |
| AC-1.8 | Channels and Videos have empty, filtered, loading, and error states. The folder list and video actions adapt to phone widths. | HTTP state checks and Chromium desktop and mobile review |

The Videos list shows Draft as its sole status in P1. Platform eligibility appears in the editor while account connections, provider-specific controls, and publishing remain P2 scope. The locally stored source is shared when a draft is duplicated in the list and is removed after the last reference is deleted. Platform media delivery and hosted object storage require provider and deployment configuration in P2.

Windows setup needs FFmpeg on PATH. Sources live on a private persistent filesystem for this single-instance phase. The database automatically upgrades existing P0 data on startup. Next phase is P2, Connect and Publish Now.

## P2 Connect and Publish Now

Ayrshare is the provider adapter. Each configured folder gets a separate encrypted partner profile. Existing folders provision on first connect. The Accounts tab refreshes linked identities from the partner. Review runs target validation, signs media links, and commits independent SQLite queue entries. The worker uses a stable idempotency key per submission, retries transient errors with backoff, and polls pending partner IDs. Activity records each target outcome. The default TikTok mode requires the creator to finish the post in TikTok Inbox.

Live authorization, partner plan entitlements, external media access, and real platform publication require validation using the owner's configured accounts. No subscription or live post was created during development.

Verification covered the P0 and P1 regression suite, signed media delivery, expired links and disconnect, foreign-folder denial, quota and caption/ratio rejection, replay protection, independent target failures, confirmed retry, and polling a pending result. Chromium exercised mobile Accounts and desktop Platforms → Review → Activity against an isolated test adapter. The interactive publishing setup command was exercised with disposable settings.
