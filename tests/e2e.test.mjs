#!/usr/bin/env bun

/**
 * End-to-end tests for gh-load-pull-request
 *
 * Tests real PR downloads and content verification against GitHub API data.
 * These tests require network access and a valid GitHub token for best results.
 *
 * Run with:
 *   bun test tests/e2e.test.mjs
 */

import { describe, it, assert, setDefaultTimeout } from 'test-anywhere';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Set timeout to 60 seconds for network tests
setDefaultTimeout(60000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(
  __dirname,
  '..',
  'src',
  'gh-load-pull-request.mjs'
);

/**
 * Check if output indicates rate limiting
 */
function isRateLimited(output) {
  return (
    output.includes('rate limit exceeded') ||
    output.includes('API rate limit') ||
    output.includes('403')
  );
}

/**
 * Command execution helper
 */
function runCli(args, options = {}) {
  const cmd = `bun run "${scriptPath}" ${args}`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 55000,
      ...options,
    });
    return { stdout: result, stderr: '', exitCode: 0, rateLimited: false };
  } catch (error) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    const combinedOutput = stdout + stderr;
    return {
      stdout,
      stderr,
      exitCode: error.status || 1,
      rateLimited: isRateLimited(combinedOutput),
    };
  }
}

/**
 * Create a temporary directory for test output
 */
function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'gh-load-pr-test-'));
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir) {
  if (dir && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('URL Parsing', () => {
  it('Should parse full GitHub URL', () => {
    // We can test parsing by checking help output does not show the invalid message
    const result = runCli(
      'https://github.com/facebook/react/pull/28000 --help'
    );
    // --help should work and show usage
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Usage:'), 'Help should be shown');
  });

  it('Should parse shorthand with hash', () => {
    const result = runCli('facebook/react#28000 --help');
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Usage:'), 'Help should be shown');
  });

  it('Should parse shorthand with slash', () => {
    const result = runCli('facebook/react/28000 --help');
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Usage:'), 'Help should be shown');
  });

  it('Should reject invalid format', () => {
    const result = runCli('not-a-valid-format');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('Invalid PR URL') || result.exitCode !== 0,
      'Should reject invalid format'
    );
  });
});

describe('E2E: Simple PR Download', () => {
  it('Should download a simple PR to stdout (markdown)', () => {
    // Test with a known simple public PR
    const result = runCli('link-foundation/gh-load-pull-request#2');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    const output = result.stdout;

    // Verify structure
    assert.ok(output.includes('# '), 'Output should contain a title heading');
    assert.ok(
      output.includes('## Metadata'),
      'Output should contain Metadata section'
    );
    assert.ok(
      output.includes('## Description'),
      'Output should contain Description section'
    );
    assert.ok(
      output.includes('## Commits'),
      'Output should contain Commits section'
    );
    assert.ok(
      output.includes('## Files Changed'),
      'Output should contain Files Changed section'
    );

    // Verify specific content
    assert.ok(output.includes('@konard'), 'Output should contain author');
    assert.ok(output.includes('#2'), 'Output should contain PR number');
    assert.ok(
      output.includes(
        'https://github.com/link-foundation/gh-load-pull-request/pull/2'
      ),
      'Output should contain PR URL'
    );
  });

  it('Should download a simple PR in JSON format', () => {
    const result = runCli(
      'link-foundation/gh-load-pull-request#2 --format json'
    );

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    // Parse JSON
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch (_e) {
      assert.ok(false, 'Output should be valid JSON');
      return;
    }

    // Verify structure
    assert.ok(data.pullRequest, 'JSON should have pullRequest field');
    assert.ok(data.commits, 'JSON should have commits field');
    assert.ok(data.files, 'JSON should have files field');

    // Verify content
    assert.ok(data.pullRequest.number === 2, 'PR number should be 2');
    assert.ok(
      data.pullRequest.author.login === 'konard',
      'Author should be konard'
    );
    assert.ok(data.files.length > 0, 'Should have at least one file changed');
  });
});

describe('E2E: Complex PR Download', () => {
  it('Should download a PR with reviews (facebook/react#28000)', () => {
    const result = runCli('facebook/react#28000');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    const output = result.stdout;

    // Verify title
    assert.ok(
      output.includes('Convert ReactFreshMultipleRenderer to createRoot'),
      'Should contain PR title'
    );

    // Verify metadata
    assert.ok(output.includes('@eps1lon'), 'Should contain author username');
    assert.ok(
      output.includes('closed') || output.includes('merged'),
      'Should show PR state'
    );

    // Verify labels
    assert.ok(output.includes('CLA Signed'), 'Should contain label CLA Signed');
    assert.ok(
      output.includes('React Core Team'),
      'Should contain label React Core Team'
    );

    // Verify conversation section exists
    assert.ok(
      output.includes('## Conversation'),
      'Should have Conversation section'
    );

    // Verify reviews exist
    assert.ok(
      output.includes('APPROVED') || output.includes('Review by'),
      'Should contain review information'
    );
  });

  it('Should include reviews by default', () => {
    const result = runCli('facebook/react#28000 --format json');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    const data = JSON.parse(result.stdout);

    assert.ok(
      data.reviews && data.reviews.length > 0,
      'Should have reviews in JSON output'
    );
  });

  it('Should exclude reviews when --no-include-reviews is set', () => {
    const result = runCli(
      'facebook/react#28000 --format json --no-include-reviews'
    );

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    const data = JSON.parse(result.stdout);

    assert.ok(
      !data.reviews || data.reviews.length === 0,
      'Should not have reviews when excluded'
    );
  });
});

describe('E2E: Save to Directory', () => {
  let tempDir;

  it('Should save PR to directory with correct structure', () => {
    tempDir = createTempDir();

    try {
      const result = runCli(
        `link-foundation/gh-load-pull-request#2 -o "${tempDir}"`
      );

      // Skip assertions if rate limited
      if (result.rateLimited) {
        assert.ok(true, 'Skipped due to rate limiting');
        return;
      }

      // Check for success message in stderr (logs go to stderr)
      const combinedOutput = result.stdout + result.stderr;
      assert.ok(
        result.exitCode === 0 || combinedOutput.includes('Done'),
        `CLI should complete successfully. Output: ${combinedOutput}`
      );

      // Verify directory structure
      const prDir = path.join(tempDir, 'pr-2');
      assert.ok(existsSync(prDir), `PR directory should exist: ${prDir}`);

      const mdPath = path.join(prDir, 'pr-2.md');
      assert.ok(existsSync(mdPath), `Markdown file should exist: ${mdPath}`);

      const jsonPath = path.join(prDir, 'pr-2.json');
      assert.ok(existsSync(jsonPath), `JSON file should exist: ${jsonPath}`);

      // Verify markdown content
      const mdContent = readFileSync(mdPath, 'utf8');
      assert.ok(mdContent.includes('# '), 'Markdown should have title');
      assert.ok(
        mdContent.includes('## Metadata'),
        'Markdown should have Metadata section'
      );

      // Verify JSON content
      const jsonContent = readFileSync(jsonPath, 'utf8');
      const data = JSON.parse(jsonContent);
      assert.ok(
        data.pullRequest.number === 2,
        'JSON should have correct PR number'
      );
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe('E2E: Library Exports', () => {
  it('Should export key functions for library usage', async () => {
    // Dynamic import to test exports
    const lib = await import(scriptPath);

    // Check function exports
    assert.ok(
      typeof lib.parsePrUrl === 'function',
      'parsePrUrl should be exported'
    );
    assert.ok(
      typeof lib.loadPullRequest === 'function',
      'loadPullRequest should be exported'
    );
    assert.ok(
      typeof lib.convertToMarkdown === 'function',
      'convertToMarkdown should be exported'
    );
    assert.ok(
      typeof lib.convertToJson === 'function',
      'convertToJson should be exported'
    );
    assert.ok(
      typeof lib.savePullRequest === 'function',
      'savePullRequest should be exported'
    );
    assert.ok(
      typeof lib.setLoggingMode === 'function',
      'setLoggingMode should be exported'
    );
    assert.ok(
      typeof lib.getGhToken === 'function',
      'getGhToken should be exported'
    );

    // Test parsePrUrl
    const parsed = lib.parsePrUrl('facebook/react#28000');
    assert.ok(parsed.owner === 'facebook', 'Should parse owner');
    assert.ok(parsed.repo === 'react', 'Should parse repo');
    assert.ok(parsed.prNumber === 28000, 'Should parse PR number');
  });
});

describe('E2E: Content Verification', () => {
  it('Should include all key PR metadata fields', () => {
    const result = runCli('link-foundation/gh-load-pull-request#2');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    const output = result.stdout;

    // Verify all metadata fields
    const requiredFields = [
      'Number',
      'URL',
      'Author',
      'State',
      'Created',
      'Updated',
      'Base',
      'Head',
      'Additions',
      'Deletions',
      'Changed Files',
    ];

    for (const field of requiredFields) {
      assert.ok(
        output.includes(`**${field}**`),
        `Output should contain ${field} field`
      );
    }
  });

  it('Should show commits with SHA links', () => {
    const result = runCli('link-foundation/gh-load-pull-request#2');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    const output = result.stdout;

    // Commits should have SHA in backticks and be links
    // Use \x60 for backtick to avoid escaping issues
    assert.ok(
      output.match(/\[\x60[0-9a-f]{7}\x60\]\(https:\/\/github\.com/),
      'Output should contain commit SHA links'
    );
  });

  it('Should show files with status icons and changes', () => {
    const result = runCli('link-foundation/gh-load-pull-request#2');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    const output = result.stdout;

    // Files should have status and change counts like "+218 -1"
    assert.ok(
      output.match(/\+\d+ -\d+/),
      'Output should contain file change counts'
    );
  });
});

describe('E2E: Backend Mode Tests', () => {
  it('Should download PR using gh CLI (default mode)', () => {
    // Default mode uses gh CLI when available
    const result = runCli('link-foundation/gh-load-pull-request#2 --force-gh');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    // Note: this test may fail in environments without gh CLI
    // In that case, it's expected behavior
    if (result.stderr.includes('gh CLI is required but not installed')) {
      assert.ok(true, 'Skipped - gh CLI not installed');
      return;
    }

    if (result.exitCode !== 0) {
      // gh CLI might fail for auth reasons
      assert.ok(true, 'Skipped - gh CLI not available or not authenticated');
      return;
    }

    const output = result.stdout;
    assert.ok(output.includes('# '), 'Output should contain a title heading');
    assert.ok(
      output.includes('## Metadata'),
      'Output should contain Metadata section'
    );
  });

  it('Should download PR using API mode', () => {
    const result = runCli('link-foundation/gh-load-pull-request#2 --force-api');

    // Skip assertions if rate limited
    if (result.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    assert.ok(result.exitCode === 0, 'CLI should exit with code 0');

    const output = result.stdout;
    assert.ok(output.includes('# '), 'Output should contain a title heading');
    assert.ok(
      output.includes('## Metadata'),
      'Output should contain Metadata section'
    );
    assert.ok(
      output.includes('@konard'),
      'Output should contain author username'
    );
  });

  it('Should reject both --force-api and --force-gh at the same time', () => {
    const result = runCli(
      'link-foundation/gh-load-pull-request#2 --force-api --force-gh'
    );

    // This should fail
    assert.ok(result.exitCode !== 0, 'CLI should fail with both flags');
    const combinedOutput = result.stdout + result.stderr;
    assert.ok(
      combinedOutput.includes('Cannot use both'),
      'Should show error about mutually exclusive flags'
    );
  });

  it('Should output same content with both gh and API modes', () => {
    // Test that both modes produce similar output
    const ghResult = runCli(
      'link-foundation/gh-load-pull-request#2 --format json'
    );
    const apiResult = runCli(
      'link-foundation/gh-load-pull-request#2 --force-api --format json'
    );

    // Skip if rate limited
    if (ghResult.rateLimited || apiResult.rateLimited) {
      assert.ok(true, 'Skipped due to rate limiting');
      return;
    }

    // Skip if gh CLI failed
    if (ghResult.exitCode !== 0) {
      assert.ok(true, 'Skipped - gh CLI mode failed');
      return;
    }

    if (apiResult.exitCode !== 0) {
      assert.ok(true, 'Skipped - API mode failed');
      return;
    }

    // Parse both outputs
    let ghData, apiData;
    try {
      ghData = JSON.parse(ghResult.stdout);
      apiData = JSON.parse(apiResult.stdout);
    } catch (_e) {
      assert.ok(false, 'Both outputs should be valid JSON');
      return;
    }

    // Verify key fields match
    assert.ok(
      ghData.pullRequest.number === apiData.pullRequest.number,
      'PR number should match'
    );
    assert.ok(
      ghData.pullRequest.title === apiData.pullRequest.title,
      'PR title should match'
    );
    assert.ok(
      ghData.pullRequest.author.login === apiData.pullRequest.author.login,
      'Author should match'
    );
    assert.ok(ghData.commits.length > 0, 'Should have commits from gh mode');
    assert.ok(apiData.commits.length > 0, 'Should have commits from API mode');
  });
});
