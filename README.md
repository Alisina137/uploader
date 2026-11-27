# Upload Hub

A private workspace for a video creator to organize channels and prepare posts for publishing.

## Local development

Use Node.js 24.13 or newer, pnpm, and FFmpeg. Both `ffmpeg` and `ffprobe` must be on PATH for uploads and thumbnails. On Windows, install the WinGet package if you do not have these tools:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Open a new terminal after installation, then run these commands from the repository root:

```powershell
pnpm run setup
pnpm dev
Start-Process http://localhost:3000
```

Run the last command in a second terminal, or open http://localhost:3000 in your browser. The setup command prompts for the single owner's name, email, and password. Sign in with those credentials and create your first channel folder or skip onboarding. To prepare a draft, open the folder, upload an MP4 or MOV, complete Details, and save from Review. Set your preferred time zone in **Settings**. Run `pnpm test` to check owner sign-in, resumable uploads, folder lifecycle, and the draft workflow.

Settings, sessions, folders, and drafts persist in SQLite under `data/`. Video sources are stored privately alongside it. Uploads support files up to 2 GB. To resume after closing the page, reselect the same file on the same browser. Unfinished transfers older than seven days are cleaned up at server startup. Keep the database and media directory on persistent storage when hosting a single instance. Back up both together. The database schema migrates on startup. Optional settings are documented in `.env.example`. If you set `APP_ORIGIN`, use the same address in the browser. For an HTTPS deployment, set `APP_ORIGIN` to the public HTTPS origin and terminate TLS at the reverse proxy. The login rate limiter keys attempts to the connection address, so requests forwarded by the same proxy share a limit.

See [project state](docs/PROJECT-STATE.md) for phase coverage.
