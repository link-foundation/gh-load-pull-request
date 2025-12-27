# gh-load-pull-request

[![npm version](https://img.shields.io/npm/v/gh-load-pull-request)](https://www.npmjs.com/package/gh-load-pull-request)

Download GitHub pull request and convert it to markdown - perfect for AI review and analysis.

## Features

- Download any GitHub pull request as markdown
- Includes PR metadata, commits, files, reviews, and comments
- Support for both public and private repositories
- Multiple input formats for convenience
- GitHub CLI integration for seamless authentication
- Output to file or stdout

## Quick Start

```bash
# Download a PR and display as markdown
gh-load-pull-request https://github.com/owner/repo/pull/123

# Using shorthand format
gh-load-pull-request owner/repo#123

# Save to file
gh-load-pull-request owner/repo#123 -o pr.md

# Download private PR (uses gh CLI auth automatically)
gh-load-pull-request owner/private-repo#456
```

## Installation

### Global Installation (Recommended)

Install globally for system-wide access:

```bash
bun install -g gh-load-pull-request

# After installation, use anywhere:
gh-load-pull-request --help
```

### Uninstall

Remove the global installation:

```bash
bun uninstall -g gh-load-pull-request
```

### Local Installation

```bash
# Clone the repository
git clone https://github.com/link-foundation/gh-load-pull-request.git
cd gh-load-pull-request

# Install dependencies
bun install

# Make the script executable
chmod +x gh-load-pull-request.mjs

# Run it
./gh-load-pull-request.mjs --help
```

## Usage

```
Usage: gh-load-pull-request <pr-url> [options]

Options:
  -t, --token         GitHub personal access token (optional for public PRs)
  -o, --output        Output directory (creates pr-<number>/ subfolder)
  --format            Output format: markdown, json (default: markdown)
  --download-images   Download embedded images (default: true)
  --include-reviews   Include PR reviews (default: true)
  --force-api         Force using GitHub API instead of gh CLI
  --force-gh          Force using gh CLI, fail if not available
  -v, --verbose       Enable verbose logging
  -h, --help          Show help
  --version           Show version number
```

## Backend Modes

The tool supports two backend modes for fetching PR data:

### 1. gh CLI Mode (Default)

By default, the tool uses the [GitHub CLI](https://cli.github.com/) (`gh`) to fetch PR data. This is the recommended mode as it:

- Uses your existing `gh` authentication
- Doesn't require managing tokens separately
- Works seamlessly with GitHub Enterprise

### 2. API Mode (Fallback)

If `gh` CLI is not available or not authenticated, the tool automatically falls back to using the GitHub REST API via Octokit. You can also force this mode with `--force-api`.

### Controlling Backend Mode

```bash
# Use default mode (gh CLI with API fallback)
gh-load-pull-request owner/repo#123

# Force gh CLI mode (fails if gh is not available)
gh-load-pull-request owner/repo#123 --force-gh

# Force API mode (useful for testing or when gh has issues)
gh-load-pull-request owner/repo#123 --force-api
```

## Input Formats

The tool supports multiple formats for specifying a pull request:

1. **Full URL**: `https://github.com/owner/repo/pull/123`
2. **Shorthand with #**: `owner/repo#123`
3. **Shorthand with /**: `owner/repo/123`

## Authentication

The tool supports multiple authentication methods for accessing private repositories:

### 1. GitHub CLI (Recommended)

If you have [GitHub CLI](https://cli.github.com/) installed and authenticated, the tool will automatically use your credentials:

```bash
# Authenticate with GitHub CLI (one-time setup)
gh auth login

# Tool automatically detects and uses gh CLI authentication
gh-load-pull-request owner/private-repo#123
```

### 2. Environment Variable

Set the `GITHUB_TOKEN` environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
gh-load-pull-request owner/repo#123
```

### 3. Command Line Token

Pass the token directly with `--token`:

```bash
gh-load-pull-request owner/repo#123 --token ghp_your_token_here
```

### Authentication Priority

The tool uses this fallback chain:

1. `--token` command line argument (highest priority)
2. `GITHUB_TOKEN` environment variable
3. GitHub CLI authentication (if `gh` is installed and authenticated)
4. No authentication (public PRs only)

## Output Format

The markdown output includes:

- **Header**: PR title
- **Metadata**: PR number, author, status, dates, branch info, stats
- **Description**: Full PR description/body
- **Commits**: List of all commits with links and authors
- **Files Changed**: All modified files with change stats
- **Reviews**: All PR reviews with approval status
- **Review Comments**: Inline code review comments with diff context
- **Comments**: General discussion comments

## Examples

```bash
# Basic usage - download and display PR
gh-load-pull-request https://github.com/facebook/react/pull/28000

# Using shorthand format
gh-load-pull-request facebook/react#28000

# Save to file
gh-load-pull-request facebook/react#28000 -o ./output

# Download private PR using gh CLI auth
gh-load-pull-request myorg/private-repo#42

# Download with explicit token
gh-load-pull-request myorg/repo#123 --token ghp_your_token_here

# Force using GitHub API instead of gh CLI
gh-load-pull-request owner/repo#123 --force-api

# Output as JSON
gh-load-pull-request owner/repo#123 --format json

# Verbose mode for debugging
gh-load-pull-request owner/repo#123 -v

# Pipe to other tools (e.g., AI for review)
gh-load-pull-request owner/repo#123 | claude-analyze
```

## Requirements

- [Bun](https://bun.sh/) (>=1.2.0) runtime
- For private repositories (optional):
  - [GitHub CLI](https://cli.github.com/) (recommended) OR
  - GitHub personal access token (via `--token` or `GITHUB_TOKEN` env var)

## Use Cases

- **AI Code Review**: Download PRs as markdown for analysis by AI assistants
- **Documentation**: Archive important PRs for future reference
- **Offline Review**: Review PRs without internet connection
- **Custom Analysis**: Process PR data with custom scripts
- **Team Workflows**: Integrate PR data into custom review processes

## Testing

```bash
# Run all tests
bun test
```

## Development

```bash
# Clone the repository
git clone https://github.com/link-foundation/gh-load-pull-request.git
cd gh-load-pull-request

# Install dependencies
bun install

# Make executable
chmod +x gh-load-pull-request.mjs

# Test locally
./gh-load-pull-request.mjs owner/repo#123

# Run tests
bun test

# Run linting
bun run lint

# Bump version
./version.mjs patch  # or minor, major
```

## Related Projects

- [gh-pull-all](https://github.com/link-foundation/gh-pull-all) - Efficiently sync all repositories from a GitHub organization or user

## License

This project is released into the public domain under The Unlicense - see [LICENSE](LICENSE) file for details.
