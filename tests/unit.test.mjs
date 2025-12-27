#!/usr/bin/env bun

/**
 * Unit tests for gh-load-pull-request
 *
 * Tests pure functions without network access.
 *
 * Run with:
 *   bun test tests/unit.test.mjs
 */

import { describe, it, assert } from 'test-anywhere';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(
  __dirname,
  '..',
  'src',
  'gh-load-pull-request.mjs'
);

// Import the module
const lib = await import(scriptPath);

describe('parsePrUrl', () => {
  const { parsePrUrl } = lib;

  it('Should parse full GitHub URL', () => {
    const result = parsePrUrl('https://github.com/facebook/react/pull/28000');
    assert.ok(result.owner === 'facebook', 'owner should be facebook');
    assert.ok(result.repo === 'react', 'repo should be react');
    assert.ok(result.prNumber === 28000, 'prNumber should be 28000');
  });

  it('Should parse shorthand with hash', () => {
    const result = parsePrUrl('facebook/react#28000');
    assert.ok(result.owner === 'facebook', 'owner should be facebook');
    assert.ok(result.repo === 'react', 'repo should be react');
    assert.ok(result.prNumber === 28000, 'prNumber should be 28000');
  });

  it('Should parse shorthand with slash', () => {
    const result = parsePrUrl('facebook/react/28000');
    assert.ok(result.owner === 'facebook', 'owner should be facebook');
    assert.ok(result.repo === 'react', 'repo should be react');
    assert.ok(result.prNumber === 28000, 'prNumber should be 28000');
  });

  it('Should handle repo names with dashes', () => {
    const result = parsePrUrl('link-foundation/gh-load-pull-request#2');
    assert.ok(
      result.owner === 'link-foundation',
      'owner should be link-foundation'
    );
    assert.ok(
      result.repo === 'gh-load-pull-request',
      'repo should be gh-load-pull-request'
    );
    assert.ok(result.prNumber === 2, 'prNumber should be 2');
  });

  it('Should handle repo names with underscores', () => {
    const result = parsePrUrl('owner_name/repo_name#123');
    assert.ok(result.owner === 'owner_name', 'owner should be owner_name');
    assert.ok(result.repo === 'repo_name', 'repo should be repo_name');
    assert.ok(result.prNumber === 123, 'prNumber should be 123');
  });

  it('Should return null for invalid formats', () => {
    assert.ok(parsePrUrl('not-valid') === null, 'not-valid should return null');
    assert.ok(parsePrUrl('') === null, 'empty string should return null');
    assert.ok(parsePrUrl('just-one-part') === null, 'should return null');
    assert.ok(
      parsePrUrl('owner/repo') === null,
      'owner/repo without number should return null'
    );
    assert.ok(
      parsePrUrl('owner/repo#abc') === null,
      'owner/repo#abc should return null'
    );
  });
});

describe('extractMarkdownImageUrls', () => {
  const { extractMarkdownImageUrls } = lib;

  it('Should extract markdown image URLs', () => {
    const content = '![alt text](https://example.com/image.png)';
    const result = extractMarkdownImageUrls(content);
    assert.ok(result.length === 1, 'should find 1 image');
    assert.ok(
      result[0].url === 'https://example.com/image.png',
      'should extract correct URL'
    );
    assert.ok(result[0].alt === 'alt text', 'should extract alt text');
  });

  it('Should extract multiple images', () => {
    const content =
      '![img1](https://a.com/1.png) text ![img2](https://b.com/2.jpg)';
    const result = extractMarkdownImageUrls(content);
    assert.ok(result.length === 2, 'should find 2 images');
    assert.ok(result[0].url === 'https://a.com/1.png', 'first URL correct');
    assert.ok(result[1].url === 'https://b.com/2.jpg', 'second URL correct');
  });

  it('Should extract HTML img tags', () => {
    const content = '<img src="https://example.com/image.png" />';
    const result = extractMarkdownImageUrls(content);
    assert.ok(result.length === 1, 'should find 1 image');
    assert.ok(
      result[0].url === 'https://example.com/image.png',
      'should extract URL from img tag'
    );
  });

  it('Should handle mixed markdown and HTML', () => {
    const content =
      '![md](https://a.com/1.png) <img src="https://b.com/2.png" />';
    const result = extractMarkdownImageUrls(content);
    assert.ok(result.length === 2, 'should find 2 images');
  });

  it('Should return empty array for content without images', () => {
    const result = extractMarkdownImageUrls('No images here');
    assert.ok(result.length === 0, 'should return empty array');
  });

  it('Should handle null/undefined content', () => {
    assert.ok(
      extractMarkdownImageUrls(null).length === 0,
      'null should return empty'
    );
    assert.ok(
      extractMarkdownImageUrls(undefined).length === 0,
      'undefined should return empty'
    );
    assert.ok(
      extractMarkdownImageUrls('').length === 0,
      'empty string should return empty'
    );
  });

  it('Should extract image with title', () => {
    const content = '![alt](https://example.com/img.png "Image Title")';
    const result = extractMarkdownImageUrls(content);
    assert.ok(result.length === 1, 'should find 1 image');
    assert.ok(
      result[0].url === 'https://example.com/img.png',
      'should extract URL correctly'
    );
  });
});

describe('validateImageBuffer', () => {
  const { validateImageBuffer } = lib;

  it('Should validate PNG images', () => {
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const result = validateImageBuffer(pngBuffer, 'test.png');
    assert.ok(result.valid, 'PNG should be valid');
    assert.ok(result.format === 'png', 'format should be png');
  });

  it('Should validate JPEG images', () => {
    const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = validateImageBuffer(jpgBuffer, 'test.jpg');
    assert.ok(result.valid, 'JPEG should be valid');
    assert.ok(result.format === 'jpg', 'format should be jpg');
  });

  it('Should validate GIF images', () => {
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const result = validateImageBuffer(gifBuffer, 'test.gif');
    assert.ok(result.valid, 'GIF should be valid');
    assert.ok(result.format === 'gif', 'format should be gif');
  });

  it('Should reject HTML content', () => {
    const htmlBuffer = Buffer.from('<!DOCTYPE html><html>');
    const result = validateImageBuffer(htmlBuffer, 'error.html');
    assert.ok(!result.valid, 'HTML should be invalid');
    assert.ok(result.reason.includes('HTML'), 'reason should mention HTML');
  });

  it('Should reject small buffers', () => {
    const smallBuffer = Buffer.from([0x89, 0x50]);
    const result = validateImageBuffer(smallBuffer, 'small.png');
    assert.ok(!result.valid, 'small buffer should be invalid');
    assert.ok(
      result.reason.includes('too small'),
      'reason should mention too small'
    );
  });

  it('Should handle null buffer', () => {
    const result = validateImageBuffer(null, 'null.png');
    assert.ok(!result.valid, 'null buffer should be invalid');
  });
});

describe('getExtensionFromFormat', () => {
  const { getExtensionFromFormat } = lib;

  it('Should return correct extension for known formats', () => {
    assert.ok(
      getExtensionFromFormat('png', 'test') === '.png',
      'png should return .png'
    );
    assert.ok(
      getExtensionFromFormat('jpg', 'test') === '.jpg',
      'jpg should return .jpg'
    );
    assert.ok(
      getExtensionFromFormat('gif', 'test') === '.gif',
      'gif should return .gif'
    );
    assert.ok(
      getExtensionFromFormat('webp', 'test') === '.webp',
      'webp should return .webp'
    );
    assert.ok(
      getExtensionFromFormat('svg', 'test') === '.svg',
      'svg should return .svg'
    );
  });

  it('Should extract extension from URL when format is unknown', () => {
    const result = getExtensionFromFormat(
      'unknown',
      'https://example.com/image.jpg'
    );
    assert.ok(result === '.jpg', 'should extract .jpg from URL');
  });

  it('Should normalize jpeg to jpg', () => {
    const result = getExtensionFromFormat(
      'unknown',
      'https://example.com/image.jpeg'
    );
    assert.ok(result === '.jpg', 'jpeg should be normalized to .jpg');
  });

  it('Should default to .png for unknown formats', () => {
    const result = getExtensionFromFormat(
      'unknown',
      'https://example.com/file'
    );
    assert.ok(result === '.png', 'unknown format should default to .png');
  });
});

describe('convertToJson', () => {
  const { convertToJson } = lib;

  it('Should produce valid JSON', () => {
    const mockData = {
      pr: {
        number: 1,
        title: 'Test PR',
        state: 'open',
        draft: false,
        merged: false,
        html_url: 'https://github.com/test/test/pull/1',
        user: { login: 'testuser' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        merged_at: null,
        closed_at: null,
        merged_by: null,
        base: { ref: 'main', sha: 'abc123' },
        head: { ref: 'feature', sha: 'def456' },
        additions: 10,
        deletions: 5,
        changed_files: 2,
        labels: [{ name: 'bug', color: 'red' }],
        assignees: [],
        requested_reviewers: [],
        milestone: null,
        body: 'Test description',
      },
      commits: [
        {
          sha: 'abc123',
          commit: { message: 'Test commit', author: { date: '2024-01-01' } },
          html_url: 'https://github.com/test/test/commit/abc123',
          author: { login: 'testuser' },
        },
      ],
      files: [
        {
          filename: 'test.js',
          status: 'modified',
          additions: 10,
          deletions: 5,
          previous_filename: null,
          patch: '',
        },
      ],
      reviews: [],
      reviewComments: [],
      comments: [],
    };

    const jsonString = convertToJson(mockData, []);
    let parsed;

    try {
      parsed = JSON.parse(jsonString);
    } catch (_e) {
      assert.ok(false, 'Should produce valid JSON');
      return;
    }

    assert.ok(
      parsed.pullRequest.number === 1,
      'pullRequest.number should be 1'
    );
    assert.ok(
      parsed.pullRequest.title === 'Test PR',
      'pullRequest.title should be Test PR'
    );
    assert.ok(
      parsed.pullRequest.author.login === 'testuser',
      'author.login should be testuser'
    );
    assert.ok(parsed.commits.length === 1, 'should have 1 commit');
    assert.ok(parsed.files.length === 1, 'should have 1 file');
  });
});

describe('setLoggingMode', () => {
  const { setLoggingMode } = lib;

  it('Should accept logging options without error', () => {
    // These should not throw
    setLoggingMode({ verbose: true });
    setLoggingMode({ silent: true });
    setLoggingMode({ verbose: false, silent: false });
    setLoggingMode({});

    // Reset to default
    setLoggingMode({ verbose: false, silent: false });

    assert.ok(true, 'setLoggingMode should accept various options');
  });
});

describe('isGhInstalled', () => {
  const { isGhInstalled } = lib;

  it('Should be an async function', () => {
    assert.ok(
      typeof isGhInstalled === 'function',
      'isGhInstalled should be a function'
    );
    // Check if it returns a promise
    const result = isGhInstalled();
    assert.ok(
      result instanceof Promise,
      'isGhInstalled should return a Promise'
    );
  });

  it('Should return boolean', async () => {
    const result = await isGhInstalled();
    assert.ok(
      typeof result === 'boolean',
      'isGhInstalled should return boolean'
    );
  });
});

describe('isGhAuthenticated', () => {
  const { isGhAuthenticated } = lib;

  it('Should be an async function', () => {
    assert.ok(
      typeof isGhAuthenticated === 'function',
      'isGhAuthenticated should be a function'
    );
    const result = isGhAuthenticated();
    assert.ok(
      result instanceof Promise,
      'isGhAuthenticated should return a Promise'
    );
  });

  it('Should return boolean', async () => {
    const result = await isGhAuthenticated();
    assert.ok(
      typeof result === 'boolean',
      'isGhAuthenticated should return boolean'
    );
  });
});

describe('loadPullRequest modes', () => {
  const { loadPullRequestWithGh, loadPullRequestWithApi } = lib;

  it('Should export loadPullRequestWithGh function', () => {
    assert.ok(
      typeof loadPullRequestWithGh === 'function',
      'loadPullRequestWithGh should be exported'
    );
  });

  it('Should export loadPullRequestWithApi function', () => {
    assert.ok(
      typeof loadPullRequestWithApi === 'function',
      'loadPullRequestWithApi should be exported'
    );
  });
});
