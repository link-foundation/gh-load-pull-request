---
'gh-load-pull-request': minor
---

Use gh CLI as default backend with API fallback

- By default, the tool now uses the `gh` CLI to fetch PR data when available
- Automatically falls back to GitHub REST API (Octokit) if gh CLI is not installed or not authenticated
- Added `--force-api` flag to force using the GitHub API instead of gh CLI
- Added `--force-gh` flag to force using gh CLI (fails if not available)
- Added new CI/CD job to test both gh CLI and API modes
- Improved verbose logging to show which backend is being used
