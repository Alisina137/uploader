# Upload Hub project state

Sources are **Upload Hub — Product Specification v1.0** and **Software Development Workflow V5**. The app is a Node.js web server with server-rendered HTML, browser-native form controls, and SQLite on persistent local storage. The MVP role is Owner. The source baseline is the repository's initial commit `2782798`.

## P0 Foundation

| Acceptance | Owner route and behavior | Verification |
| --- | --- | --- |
| AC-0.1 / FEAT-001 | `/login` uses the owner account created by `pnpm run setup`. Wrong credentials return an error without a session. Sign-out revokes the session. | HTTP integration tests and interactive setup check |
| AC-0.2 | The shell uses a desktop and tablet sidebar, and a bottom bar through 760px. It links to Channels and Settings. | Chromium at 1440px, 820px, and 390px |
| AC-0.3 / FEAT-011 | `/settings` saves profile details and the time zone. The first sign-in uses the browser time zone and falls back to UTC. | HTTP integration tests read back settings from a separate database connection and after sign-out/sign-in |
| AC-0.4 | The same components use the specification's light and dark palettes. | Browser token checks and screenshot review in light and dark |

The P0 scope names Channels in navigation, while the route registry assigns channel management to P1. P0 provides the protected empty Channels landing page. P1 adds the first-run wizard, folder management, upload and draft preparation. Settings covers profile and time zone in P0. The schema includes the 30-day retention default. Storage controls and usage depend on the media lifecycle. Account deletion requires the dependent-data lifecycle, and export is assigned to P3.

No provider or paid service is required for P0. The publishing engine, TikTok mode, storage budget and partner budget decisions still apply before their corresponding integration work. Next phase is P1, Channels and Video Preparation.
