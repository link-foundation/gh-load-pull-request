#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from 'fs-extra';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import {
  formatDate,
  convertToJson as formattersConvertToJson,
  generateMetadataMarkdown,
  generateCommitsMarkdown,
  generateFilesMarkdown,
} from './formatters.mjs';

import {
  isGhInstalled as backendsIsGhInstalled,
  isGhAuthenticated as backendsIsGhAuthenticated,
  getGhToken as backendsGetGhToken,
  loadPullRequest as backendsLoadPullRequest,
  loadPullRequestWithGh as backendsLoadPullRequestWithGh,
  loadPullRequestWithApi as backendsLoadPullRequestWithApi,
  setLoggers,
} from './backends.mjs';

let version = '0.1.0';
try {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const { readFileSync, existsSync } = await import('node:fs');
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    version = packageJson.version;
  }
} catch (_error) {
  /* Use fallback version */
}

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

let verboseMode = false;
let silentMode = false;

const log = (color, message) => {
  if (!silentMode) {
    console.error(`${colors[color]}${message}${colors.reset}`);
  }
};

const verboseLog = (color, message) => {
  if (verboseMode && !silentMode) {
    log(color, message);
  }
};

// Initialize loggers for backends module
setLoggers({ log, verboseLog });

/**
 * Set logging mode for library usage
 * @param {Object} options - Logging options
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {boolean} options.silent - Disable all logging
 */
export function setLoggingMode(options = {}) {
  verboseMode = options.verbose || false;
  silentMode = options.silent || false;
  // Update loggers in backends module
  setLoggers({ log, verboseLog });
}

// Re-export backend functions
export const isGhInstalled = backendsIsGhInstalled;
export const isGhAuthenticated = backendsIsGhAuthenticated;
export const getGhToken = backendsGetGhToken;
export const loadPullRequest = backendsLoadPullRequest;
export const loadPullRequestWithGh = backendsLoadPullRequestWithGh;
export const loadPullRequestWithApi = backendsLoadPullRequestWithApi;

/**
 * Parse PR URL to extract owner, repo, and PR number
 * @param {string} url - PR URL or shorthand (owner/repo#123, owner/repo/123, or full URL)
 * @returns {{owner: string, repo: string, prNumber: number}|null} Parsed PR info or null
 */
export function parsePrUrl(url) {
  // Try full URL format (github.com/owner/repo/pull/123 or owner/repo#123 or owner/repo/123)
  const urlMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      prNumber: parseInt(urlMatch[3], 10),
    };
  }

  // Try shorthand format: owner/repo#123
  const shortMatch = url.match(/^([^/]+)\/([^#/]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      prNumber: parseInt(shortMatch[3], 10),
    };
  }

  // Try alternative format: owner/repo/123
  const altMatch = url.match(/^([^/]+)\/([^/]+)\/(\d+)$/);
  if (altMatch) {
    return {
      owner: altMatch[1],
      repo: altMatch[2],
      prNumber: parseInt(altMatch[3], 10),
    };
  }

  return null;
}

const imageMagicBytes = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF header for WebP
  bmp: [0x42, 0x4d],
  ico: [0x00, 0x00, 0x01, 0x00],
  svg: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml for SVG (though SVG can also start with <svg)
};

/**
 * Validate image by checking magic bytes
 * @param {Buffer} buffer - Image buffer to validate
 * @param {string} url - Original URL (for logging)
 * @returns {{valid: boolean, format?: string, reason?: string}} Validation result
 */
export function validateImageBuffer(buffer, url) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, reason: 'Buffer too small' };
  }

  const bytes = [...buffer.slice(0, 8)];

  // Check for HTML error page (starts with <!DOCTYPE or <html or <!)
  const htmlMarkers = [
    [0x3c, 0x21], // <!
    [0x3c, 0x68, 0x74, 0x6d, 0x6c], // <html
    [0x3c, 0x48, 0x54, 0x4d, 0x4c], // <HTML
  ];

  for (const marker of htmlMarkers) {
    if (marker.every((byte, i) => bytes[i] === byte)) {
      return {
        valid: false,
        reason: 'Downloaded file is HTML (likely error page)',
      };
    }
  }

  // Check for valid image formats
  for (const [format, magic] of Object.entries(imageMagicBytes)) {
    if (magic.every((byte, i) => bytes[i] === byte)) {
      return { valid: true, format };
    }
  }

  // Special check for SVG (can start with <svg directly)
  const svgMarker = [0x3c, 0x73, 0x76, 0x67]; // <svg
  if (svgMarker.every((byte, i) => bytes[i] === byte)) {
    return { valid: true, format: 'svg' };
  }

  // If we can't identify it but it's not HTML, give it the benefit of the doubt
  // Some images might have unusual headers
  verboseLog(
    'yellow',
    `⚠️ Unknown image format for ${url}, bytes: [${bytes
      .slice(0, 8)
      .map((b) => `0x${b.toString(16)}`)
      .join(', ')}]`
  );
  return { valid: true, format: 'unknown' };
}

/**
 * Get file extension from format or URL
 * @param {string} format - Image format detected
 * @param {string} url - Original URL
 * @returns {string} File extension with leading dot
 */
export function getExtensionFromFormat(format, url) {
  const formatExtensions = {
    png: '.png',
    jpg: '.jpg',
    gif: '.gif',
    webp: '.webp',
    bmp: '.bmp',
    ico: '.ico',
    svg: '.svg',
  };

  if (format && formatExtensions[format]) {
    return formatExtensions[format];
  }

  // Try to get from URL
  try {
    const urlPath = new globalThis.URL(url).pathname;
    const ext = path.extname(urlPath).toLowerCase();
    if (
      ext &&
      [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.bmp',
        '.ico',
        '.svg',
      ].includes(ext)
    ) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch (_e) {
    // Ignore URL parsing errors
  }

  return '.png'; // Default fallback
}

/**
 * Download a file with redirect support
 * @param {string} url - URL to download
 * @param {string} token - GitHub token for authenticated requests
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @returns {Promise<Buffer>} Downloaded file content
 */
export function downloadFile(url, token, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new globalThis.URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const headers = {
      'User-Agent': 'gh-load-pull-request',
    };

    // Add auth for GitHub URLs
    if (token && parsedUrl.hostname.includes('github')) {
      headers['Authorization'] = `token ${token}`;
    }

    const req = protocol.get(url, { headers }, (res) => {
      // Handle redirects
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        verboseLog(
          'dim',
          `  ↳ Redirecting to: ${res.headers.location.substring(0, 80)}...`
        );
        resolve(downloadFile(res.headers.location, token, maxRedirects - 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Extract image URLs from markdown content
 * @param {string} content - Markdown content to search
 * @returns {Array<{url: string, alt: string}>} Array of image URLs with alt text
 */
export function extractMarkdownImageUrls(content) {
  if (!content) {
    return [];
  }

  const urls = [];

  // Match markdown images: ![alt](url) or ![alt](url "title")
  const mdImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = mdImageRegex.exec(content)) !== null) {
    urls.push({ url: match[2], alt: match[1] });
  }

  // Match HTML images: <img src="url" /> or <img src='url'>
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImageRegex.exec(content)) !== null) {
    urls.push({ url: match[1], alt: '' });
  }

  return urls;
}

/**
 * Download all images from content and update the markdown
 * @param {string} content - Markdown content with image URLs
 * @param {string} imagesDir - Directory to save images
 * @param {string} token - GitHub token for authenticated requests
 * @param {number} _prNumber - PR number (unused, kept for compatibility)
 * @returns {Promise<{content: string, downloadedImages: Array}>} Updated content and downloaded images info
 */
export async function downloadImages(content, imagesDir, token, _prNumber) {
  if (!content) {
    return { content, downloadedImages: [] };
  }

  const images = extractMarkdownImageUrls(content);
  if (images.length === 0) {
    return { content, downloadedImages: [] };
  }

  const downloadedImages = [];
  let updatedContent = content;
  let imageCounter = 1;

  // Ensure images directory exists
  await fs.ensureDir(imagesDir);

  for (const { url } of images) {
    try {
      verboseLog('dim', `  📥 Downloading: ${url.substring(0, 60)}...`);

      const buffer = await downloadFile(url, token);
      const validation = validateImageBuffer(buffer, url);

      if (!validation.valid) {
        log('yellow', `  ⚠️ Skipping invalid image: ${validation.reason}`);
        continue;
      }

      const ext = getExtensionFromFormat(validation.format, url);
      const filename = `image-${imageCounter}${ext}`;
      const localPath = path.join(imagesDir, filename);
      const relativePath = `./images/${filename}`;

      await fs.writeFile(localPath, buffer);
      downloadedImages.push({
        originalUrl: url,
        localPath,
        relativePath,
        format: validation.format,
      });

      // Replace URL in content
      updatedContent = updatedContent.split(url).join(relativePath);
      imageCounter++;

      verboseLog('green', `  ✅ Saved: ${filename} (${validation.format})`);
    } catch (error) {
      log('yellow', `  ⚠️ Failed to download image: ${error.message}`);
      verboseLog('dim', `     URL: ${url}`);
    }
  }

  return { content: updatedContent, downloadedImages };
}

// Alias for backwards compatibility
export const fetchPullRequest = (owner, repo, prNumber, token, options = {}) =>
  loadPullRequest({ owner, repo, prNumber, token, ...options });

// Process content and download images if enabled
function processContent(
  content,
  imagesDir,
  token,
  prNumber,
  downloadImagesFlag
) {
  if (!downloadImagesFlag) {
    return Promise.resolve({ content, downloadedImages: [] });
  }
  return downloadImages(content, imagesDir, token, prNumber);
}

/**
 * Convert PR data to markdown format
 * @param {Object} data - PR data from loadPullRequest
 * @param {Object} options - Conversion options
 * @param {boolean} options.downloadImagesFlag - Download embedded images (default: true)
 * @param {string} options.imagesDir - Directory to save images
 * @param {string} options.token - GitHub token for downloading images
 * @param {number} options.prNumber - PR number
 * @returns {Promise<{markdown: string, downloadedImages: Array}>} Markdown content and downloaded images
 */
export async function convertToMarkdown(data, options = {}) {
  const { pr, files, comments, reviewComments, reviews, commits } = data;
  const {
    downloadImagesFlag = true,
    imagesDir = '',
    token = '',
    prNumber = 0,
  } = options;

  let markdown = '';
  let allDownloadedImages = [];

  // Process PR body for images
  let prBody = pr.body || '';
  if (downloadImagesFlag && prBody) {
    log('blue', '🖼️ Processing images in PR description...');
    const result = await processContent(
      prBody,
      imagesDir,
      token,
      prNumber,
      downloadImagesFlag
    );
    prBody = result.content;
    allDownloadedImages = [...allDownloadedImages, ...result.downloadedImages];
  }

  markdown += `# ${pr.title}\n\n`;

  markdown += generateMetadataMarkdown(pr);
  markdown += '---\n\n';

  markdown += '## Description\n\n';
  markdown += prBody ? `${prBody}\n\n` : '_No description provided._\n\n';

  markdown += '---\n\n';

  markdown += '## Conversation\n\n';

  const timelineEvents = [];

  for (const comment of comments) {
    timelineEvents.push({
      type: 'comment',
      timestamp: new Date(comment.created_at),
      data: comment,
    });
  }

  for (const review of reviews) {
    if (review.submitted_at) {
      timelineEvents.push({
        type: 'review',
        timestamp: new Date(review.submitted_at),
        data: review,
      });
    }
  }

  timelineEvents.sort((a, b) => a.timestamp - b.timestamp);

  if (timelineEvents.length === 0) {
    markdown += '_No comments or reviews._\n\n';
  } else {
    for (const event of timelineEvents) {
      if (event.type === 'comment') {
        const comment = event.data;
        let commentBody = comment.body || '';
        if (downloadImagesFlag && commentBody) {
          verboseLog(
            'blue',
            `Processing images in comment by @${comment.user.login}...`
          );
          const result = await processContent(
            commentBody,
            imagesDir,
            token,
            prNumber,
            downloadImagesFlag
          );
          commentBody = result.content;
          allDownloadedImages = [
            ...allDownloadedImages,
            ...result.downloadedImages,
          ];
        }

        markdown += `### 💬 Comment by [@${comment.user.login}](https://github.com/${comment.user.login})\n`;
        markdown += `*${formatDate(comment.created_at)}*\n\n`;
        markdown += `${commentBody}\n\n`;
        markdown += '---\n\n';
      } else if (event.type === 'review') {
        const review = event.data;
        let reviewBody = review.body || '';
        if (downloadImagesFlag && reviewBody) {
          verboseLog(
            'blue',
            `Processing images in review by @${review.user.login}...`
          );
          const result = await processContent(
            reviewBody,
            imagesDir,
            token,
            prNumber,
            downloadImagesFlag
          );
          reviewBody = result.content;
          allDownloadedImages = [
            ...allDownloadedImages,
            ...result.downloadedImages,
          ];
        }

        const stateEmoji =
          review.state === 'APPROVED'
            ? '✅'
            : review.state === 'CHANGES_REQUESTED'
              ? '❌'
              : review.state === 'COMMENTED'
                ? '💬'
                : '📝';

        markdown += `### ${stateEmoji} Review by [@${review.user.login}](https://github.com/${review.user.login})\n`;
        markdown += `*${formatDate(review.submitted_at)}* — **${review.state}**\n\n`;

        if (reviewBody) {
          markdown += `${reviewBody}\n\n`;
        }

        // Add review comments for this review
        const reviewReviewComments = reviewComments.filter(
          (rc) => rc.pull_request_review_id === review.id
        );
        if (reviewReviewComments.length > 0) {
          markdown += `#### Inline Comments\n\n`;
          for (const rc of reviewReviewComments) {
            let rcBody = rc.body || '';
            if (downloadImagesFlag && rcBody) {
              const result = await processContent(
                rcBody,
                imagesDir,
                token,
                prNumber,
                downloadImagesFlag
              );
              rcBody = result.content;
              allDownloadedImages = [
                ...allDownloadedImages,
                ...result.downloadedImages,
              ];
            }

            const lineInfo = rc.line ? `:${rc.line}` : '';
            markdown += `**\`${rc.path}${lineInfo}\`**\n\n`;
            markdown += `${rcBody}\n\n`;
            if (rc.diff_hunk) {
              markdown += '```diff\n';
              markdown += `${rc.diff_hunk}\n`;
              markdown += '```\n\n';
            }
          }
        }

        markdown += '---\n\n';
      }
    }
  }

  const standaloneReviewComments = reviewComments.filter(
    (rc) => !rc.pull_request_review_id
  );
  if (standaloneReviewComments.length > 0) {
    markdown += `## Inline Code Comments\n\n`;
    for (const comment of standaloneReviewComments) {
      let commentBody = comment.body || '';
      if (downloadImagesFlag && commentBody) {
        const result = await processContent(
          commentBody,
          imagesDir,
          token,
          prNumber,
          downloadImagesFlag
        );
        commentBody = result.content;
        allDownloadedImages = [
          ...allDownloadedImages,
          ...result.downloadedImages,
        ];
      }

      markdown += `### [@${comment.user.login}](https://github.com/${comment.user.login}) on \`${comment.path}\``;
      if (comment.line) {
        markdown += ` (line ${comment.line})`;
      }
      markdown += `\n`;
      markdown += `*${formatDate(comment.created_at)}*\n\n`;
      markdown += `${commentBody}\n\n`;
      if (comment.diff_hunk) {
        markdown += '```diff\n';
        markdown += `${comment.diff_hunk}\n`;
        markdown += '```\n\n';
      }
      markdown += '---\n\n';
    }
  }

  markdown += generateCommitsMarkdown(commits);

  markdown += generateFilesMarkdown(files);

  return { markdown, downloadedImages: allDownloadedImages };
}

/**
 * Convert PR data to JSON format
 * @param {Object} data - PR data from loadPullRequest
 * @param {Array} downloadedImages - Array of downloaded image info
 * @returns {string} JSON string
 */
export function convertToJson(data, downloadedImages = []) {
  return formattersConvertToJson(data, downloadedImages);
}

/**
 * Save PR data to a folder with all assets for offline viewing
 * @param {Object} data - PR data from loadPullRequest
 * @param {Object} options - Save options
 * @param {string} options.outputDir - Output directory
 * @param {string} options.format - Output format ('markdown' or 'json')
 * @param {boolean} options.downloadImages - Download images (default: true)
 * @param {string} options.token - GitHub token for downloading images
 * @returns {Promise<{mdPath: string, jsonPath: string, imagesDir: string, downloadedImages: Array}>}
 */
export async function savePullRequest(data, options = {}) {
  const {
    outputDir,
    format = 'markdown',
    downloadImages: downloadImagesFlag = true,
    token = '',
  } = options;

  const prNumber = data.pr.number;
  const prDir = path.join(outputDir, `pr-${prNumber}`);
  const imagesDir = path.join(prDir, 'images');
  const mdPath = path.join(prDir, `pr-${prNumber}.md`);
  const jsonPath = path.join(prDir, `pr-${prNumber}.json`);

  // Ensure directories exist
  await fs.ensureDir(prDir);

  let downloadedImages = [];

  // Generate markdown
  log('blue', `📝 Converting to ${format}...`);

  const mdResult = await convertToMarkdown(data, {
    downloadImagesFlag,
    imagesDir,
    token,
    prNumber,
  });
  downloadedImages = mdResult.downloadedImages;

  // Save markdown
  await fs.writeFile(mdPath, mdResult.markdown, 'utf8');
  log('green', `✅ Saved markdown to ${mdPath}`);

  // Always save JSON as well for metadata
  const jsonContent = convertToJson(data, downloadedImages);
  await fs.writeFile(jsonPath, jsonContent, 'utf8');
  log('green', `✅ Saved JSON metadata to ${jsonPath}`);

  if (downloadedImages.length > 0) {
    log(
      'green',
      `📁 Downloaded ${downloadedImages.length} image(s) to ${imagesDir}`
    );
  }

  return {
    mdPath,
    jsonPath,
    imagesDir,
    downloadedImages,
  };
}

// CLI IMPLEMENTATION

// Only run CLI when executed directly, not when imported as a module
// Check if this module is the main entry point by comparing paths
function isRunningAsCli() {
  // Get the actual script being run
  const scriptArg = process.argv[1];
  if (!scriptArg) {
    return false;
  }

  // Normalize paths for comparison
  const scriptPath = path.resolve(scriptArg);
  const thisModulePath = path.resolve(__filename);

  // Check if the script being run is this module
  // This handles both direct execution and bun run
  return (
    scriptPath === thisModulePath ||
    scriptPath.endsWith('gh-load-pull-request.mjs') ||
    scriptPath.endsWith('gh-load-pull-request')
  );
}

/**
 * Parse CLI arguments
 * @returns {Object} Parsed CLI arguments
 */
function parseCliArgs() {
  const scriptName = path.basename(process.argv[1] || 'gh-load-pull-request');
  return yargs(hideBin(process.argv))
    .scriptName(scriptName)
    .version(version)
    .usage('Usage: $0 <pr-url> [options]')
    .command(
      '$0 <pr>',
      'Download a GitHub pull request and convert it to markdown',
      (yargs) => {
        yargs.positional('pr', {
          describe:
            'Pull request URL or shorthand (e.g., https://github.com/owner/repo/pull/123 or owner/repo#123)',
          type: 'string',
        });
      }
    )
    .option('token', {
      alias: 't',
      type: 'string',
      describe: 'GitHub personal access token (optional for public PRs)',
      default: process.env.GITHUB_TOKEN,
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      describe: 'Output directory (creates pr-<number>/ subfolder)',
    })
    .option('download-images', {
      type: 'boolean',
      describe: 'Download embedded images',
      default: true,
    })
    .option('include-reviews', {
      type: 'boolean',
      describe: 'Include PR reviews',
      default: true,
    })
    .option('format', {
      type: 'string',
      describe: 'Output format: markdown, json',
      default: 'markdown',
      choices: ['markdown', 'json'],
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      describe: 'Enable verbose logging',
      default: false,
    })
    .option('force-api', {
      type: 'boolean',
      describe: 'Force using GitHub API instead of gh CLI',
      default: false,
    })
    .option('force-gh', {
      type: 'boolean',
      describe: 'Force using gh CLI, fail if not available',
      default: false,
    })
    .help('h')
    .alias('h', 'help')
    .example('$0 https://github.com/owner/repo/pull/123', 'Download PR #123')
    .example('$0 owner/repo#123', 'Download PR using shorthand format')
    .example('$0 owner/repo#123 -o ./output', 'Save to output directory')
    .example('$0 owner/repo#123 --format json', 'Output as JSON')
    .example('$0 owner/repo#123 --no-download-images', 'Skip image download')
    .example(
      '$0 https://github.com/owner/repo/pull/123 --token ghp_xxx',
      'Download private PR'
    )
    .example('$0 owner/repo#123 --force-api', 'Force using GitHub API')
    .example('$0 owner/repo#123 --force-gh', 'Force using gh CLI').argv;
}

async function main() {
  const argv = parseCliArgs();
  const {
    pr: prInput,
    token: tokenArg,
    output,
    'download-images': downloadImagesFlag,
    'include-reviews': includeReviews,
    format,
    verbose,
    'force-api': forceApi,
    'force-gh': forceGh,
  } = argv;

  // Set verbose mode
  verboseMode = verbose;

  // Validate mutually exclusive flags
  if (forceApi && forceGh) {
    log(
      'red',
      '❌ Cannot use both --force-api and --force-gh at the same time'
    );
    process.exit(1);
  }

  // Parse PR input first (before potentially slow gh CLI token fetch)
  const prInfo = parsePrUrl(prInput);
  if (!prInfo) {
    log('red', `❌ Invalid PR URL or format: ${prInput}`);
    log('yellow', '💡 Supported formats:');
    log('yellow', '   - https://github.com/owner/repo/pull/123');
    log('yellow', '   - owner/repo#123');
    log('yellow', '   - owner/repo/123');
    process.exit(1);
  }

  let token = tokenArg;

  // If force-api mode or no token provided, try to get token from gh CLI for API fallback
  if (forceApi || !token || token === undefined) {
    const ghToken = await getGhToken();
    if (ghToken) {
      token = ghToken;
      if (forceApi) {
        log('cyan', '🔑 Using GitHub token from gh CLI for API mode');
      } else {
        verboseLog('cyan', '🔑 Got GitHub token from gh CLI for fallback');
      }
    }
  }

  const { owner, repo, prNumber } = prInfo;

  try {
    // Fetch PR data
    const data = await loadPullRequest({
      owner,
      repo,
      prNumber,
      token,
      includeReviews,
      forceApi,
      forceGh,
    });

    // Determine output paths
    if (output) {
      // Save to directory
      await savePullRequest(data, {
        outputDir: output,
        format,
        downloadImages: downloadImagesFlag,
        token,
      });
    } else {
      // Output to stdout
      if (format === 'json') {
        const jsonContent = convertToJson(data, []);
        console.log(jsonContent);
      } else {
        const { markdown } = await convertToMarkdown(data, {
          downloadImagesFlag: false, // Don't download images when outputting to stdout
          imagesDir: '',
          token: '',
          prNumber,
        });
        console.log(markdown);
      }
    }

    log('blue', '🎉 Done!');
  } catch (error) {
    log('red', `❌ ${error.message}`);
    if (verboseMode) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run CLI if this is the main module
if (isRunningAsCli()) {
  main().catch((error) => {
    log('red', `💥 Script failed: ${error.message}`);
    if (verboseMode) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}
