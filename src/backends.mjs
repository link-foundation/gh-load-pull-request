/**
 * Backend implementations for gh-load-pull-request
 * Contains functions for fetching PR data via gh CLI and GitHub API
 */

import { Octokit } from '@octokit/rest';

let verboseLog = () => {};
let log = () => {};

/**
 * Set logging functions from parent module
 * @param {Object} loggers - Object with log and verboseLog functions
 */
export function setLoggers(loggers) {
  log = loggers.log || (() => {});
  verboseLog = loggers.verboseLog || (() => {});
}

/**
 * Check if gh CLI is installed and available
 * @returns {Promise<boolean>} True if gh is installed
 */
export async function isGhInstalled() {
  try {
    const { execSync } = await import('node:child_process');
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated
 * @returns {Promise<boolean>} True if gh is authenticated
 */
export async function isGhAuthenticated() {
  try {
    const { execSync } = await import('node:child_process');
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Get GitHub token from gh CLI if available
 * @returns {Promise<string|null>} GitHub token or null
 */
export async function getGhToken() {
  try {
    if (!(await isGhInstalled())) {
      return null;
    }

    const { execSync } = await import('node:child_process');
    const token = execSync('gh auth token', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return token;
  } catch (_error) {
    return null;
  }
}

/**
 * Transform gh CLI JSON output to match the expected PR data format
 * @param {Object} ghData - Data from gh pr view --json
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object} Transformed PR data matching Octokit format
 */
function transformGhPrData(ghData, owner, repo) {
  // Transform PR object to match Octokit format
  const pr = {
    number: ghData.number,
    title: ghData.title,
    state: ghData.state.toLowerCase(),
    draft: ghData.isDraft,
    merged: ghData.state === 'MERGED',
    html_url: ghData.url,
    user: {
      login: ghData.author.login,
    },
    created_at: ghData.createdAt,
    updated_at: ghData.updatedAt,
    merged_at: ghData.mergedAt,
    closed_at: ghData.closedAt,
    merged_by: ghData.mergedBy ? { login: ghData.mergedBy.login } : null,
    base: {
      ref: ghData.baseRefName,
      sha: ghData.baseRefOid,
    },
    head: {
      ref: ghData.headRefName,
      sha: ghData.headRefOid,
    },
    additions: ghData.additions,
    deletions: ghData.deletions,
    changed_files: ghData.changedFiles,
    labels:
      ghData.labels?.map((l) => ({ name: l.name, color: l.color || '' })) || [],
    assignees: ghData.assignees?.map((a) => ({ login: a.login })) || [],
    requested_reviewers:
      ghData.reviewRequests?.map((r) => ({ login: r.login })) || [],
    milestone: ghData.milestone
      ? { title: ghData.milestone.title, number: ghData.milestone.number }
      : null,
    body: ghData.body,
  };

  // Transform files
  const files = (ghData.files || []).map((f) => ({
    filename: f.path,
    status:
      f.additions > 0 && f.deletions === 0
        ? 'added'
        : f.additions === 0 && f.deletions > 0
          ? 'removed'
          : 'modified',
    additions: f.additions,
    deletions: f.deletions,
    previous_filename: null, // gh CLI doesn't provide this in the same way
    patch: '', // gh CLI doesn't include patch in pr view
  }));

  // Transform commits
  const commits = (ghData.commits || []).map((c) => ({
    sha: c.oid,
    commit: {
      message: `${c.messageHeadline}\n\n${c.messageBody || ''}`.trim(),
      author: {
        name: c.authors?.[0]?.name || 'unknown',
        date: c.authoredDate,
      },
    },
    html_url: `https://github.com/${owner}/${repo}/commit/${c.oid}`,
    author: c.authors?.[0]?.login ? { login: c.authors[0].login } : null,
  }));

  // Transform issue comments
  const comments = (ghData.comments || []).map((c) => ({
    id: c.id,
    user: { login: c.author?.login || 'unknown' },
    body: c.body,
    created_at: c.createdAt,
  }));

  // Transform reviews
  const reviews = (ghData.reviews || []).map((r) => ({
    id: r.id,
    user: { login: r.author?.login || 'unknown' },
    state: r.state,
    body: r.body,
    submitted_at: r.submittedAt,
  }));

  // Review comments need to be fetched separately via gh api
  // as gh pr view doesn't include them in a usable format
  const reviewComments = [];

  return {
    pr,
    files,
    comments,
    reviewComments,
    reviews,
    commits,
  };
}

/**
 * Fetch pull request data using gh CLI
 * @param {Object} options - Options for fetching PR
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {boolean} options.includeReviews - Include PR reviews (default: true)
 * @returns {Promise<Object>} PR data object with pr, files, comments, reviewComments, reviews, commits
 */
export async function loadPullRequestWithGh(options) {
  const { owner, repo, prNumber, includeReviews = true } = options;

  try {
    log(
      'blue',
      `🔍 Fetching pull request ${owner}/${repo}#${prNumber} using gh CLI...`
    );

    const { execSync } = await import('node:child_process');

    // Build the list of JSON fields to fetch
    const jsonFields = [
      'number',
      'title',
      'state',
      'isDraft',
      'body',
      'url',
      'author',
      'createdAt',
      'updatedAt',
      'mergedAt',
      'closedAt',
      'mergedBy',
      'baseRefName',
      'baseRefOid',
      'headRefName',
      'headRefOid',
      'additions',
      'deletions',
      'changedFiles',
      'labels',
      'assignees',
      'reviewRequests',
      'milestone',
      'files',
      'commits',
      'comments',
    ];

    if (includeReviews) {
      jsonFields.push('reviews');
    }

    // Fetch PR data using gh pr view
    const ghCommand = `gh pr view ${prNumber} --repo ${owner}/${repo} --json ${jsonFields.join(',')}`;
    verboseLog('dim', `  Running: ${ghCommand}`);

    const ghOutput = execSync(ghCommand, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60000,
    });

    const ghData = JSON.parse(ghOutput);

    // Fetch review comments separately via gh api
    let reviewComments = [];
    try {
      const reviewCommentsCommand = `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`;
      verboseLog('dim', `  Running: ${reviewCommentsCommand}`);

      const reviewCommentsOutput = execSync(reviewCommentsCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30000,
      });

      const rawReviewComments = JSON.parse(reviewCommentsOutput);
      reviewComments = rawReviewComments.map((c) => ({
        id: c.id,
        user: { login: c.user?.login || 'unknown' },
        body: c.body,
        path: c.path,
        line: c.line,
        created_at: c.created_at,
        diff_hunk: c.diff_hunk,
        pull_request_review_id: c.pull_request_review_id,
      }));
    } catch (reviewError) {
      verboseLog(
        'yellow',
        `  ⚠️ Could not fetch review comments: ${reviewError.message}`
      );
    }

    // Transform gh data to expected format
    const transformedData = transformGhPrData(ghData, owner, repo);
    transformedData.reviewComments = reviewComments;

    log('green', `✅ Successfully fetched PR data using gh CLI`);

    return transformedData;
  } catch (error) {
    const errorMessage = error.message || String(error);
    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('Could not resolve')
    ) {
      throw new Error(`Pull request not found: ${owner}/${repo}#${prNumber}`);
    } else if (errorMessage.includes('auth') || errorMessage.includes('401')) {
      throw new Error(
        'Authentication failed. Please run "gh auth login" to authenticate'
      );
    } else {
      throw new Error(
        `Failed to fetch pull request via gh CLI: ${errorMessage}`
      );
    }
  }
}

/**
 * Fetch pull request data using GitHub REST API via Octokit
 * @param {Object} options - Options for fetching PR
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {string} options.token - GitHub token (optional for public repos)
 * @param {boolean} options.includeReviews - Include PR reviews (default: true)
 * @returns {Promise<Object>} PR data object with pr, files, comments, reviewComments, reviews, commits
 */
export async function loadPullRequestWithApi(options) {
  const { owner, repo, prNumber, token, includeReviews = true } = options;

  try {
    log(
      'blue',
      `🔍 Fetching pull request ${owner}/${repo}#${prNumber} using API...`
    );

    const octokit = new Octokit({
      auth: token,
      baseUrl: 'https://api.github.com',
    });

    // Fetch PR data
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Fetch PR files
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Fetch PR comments (issue comments)
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // Fetch PR review comments (inline code comments)
    const { data: reviewComments } =
      await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
      });

    // Fetch PR reviews
    let reviews = [];
    if (includeReviews) {
      const { data: reviewsData } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });
      reviews = reviewsData;
    }

    // Fetch PR commits
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: prNumber,
    });

    log('green', `✅ Successfully fetched PR data using API`);

    return {
      pr,
      files,
      comments,
      reviewComments,
      reviews,
      commits,
    };
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`Pull request not found: ${owner}/${repo}#${prNumber}`);
    } else if (error.status === 401) {
      throw new Error(
        'Authentication failed. Please provide a valid GitHub token'
      );
    } else {
      throw new Error(`Failed to fetch pull request via API: ${error.message}`);
    }
  }
}

/**
 * Fetch pull request data from GitHub
 * By default uses gh CLI if available, falls back to API otherwise.
 * @param {Object} options - Options for fetching PR
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {string} options.token - GitHub token (optional for public repos, used for API fallback)
 * @param {boolean} options.includeReviews - Include PR reviews (default: true)
 * @param {boolean} options.forceApi - Force using API instead of gh CLI (default: false)
 * @param {boolean} options.forceGh - Force using gh CLI, fail if not available (default: false)
 * @returns {Promise<Object>} PR data object with pr, files, comments, reviewComments, reviews, commits
 */
export async function loadPullRequest(options) {
  const {
    owner,
    repo,
    prNumber,
    token,
    includeReviews = true,
    forceApi = false,
    forceGh = false,
  } = options;

  // If force API mode, use API directly
  if (forceApi) {
    verboseLog('cyan', '🔧 Using API mode (forced)');
    return loadPullRequestWithApi({
      owner,
      repo,
      prNumber,
      token,
      includeReviews,
    });
  }

  // Check if gh CLI is available
  const ghInstalled = await isGhInstalled();

  // If force gh mode but gh is not available, throw error
  if (forceGh && !ghInstalled) {
    throw new Error(
      'gh CLI is required but not installed. Please install GitHub CLI: https://cli.github.com/'
    );
  }

  // If gh is available, try using it first
  if (ghInstalled) {
    // Check if authenticated
    const ghAuth = await isGhAuthenticated();
    if (!ghAuth) {
      verboseLog(
        'yellow',
        '⚠️ gh CLI is not authenticated, falling back to API'
      );
      if (forceGh) {
        throw new Error(
          'gh CLI is not authenticated. Please run "gh auth login"'
        );
      }
      return loadPullRequestWithApi({
        owner,
        repo,
        prNumber,
        token,
        includeReviews,
      });
    }

    try {
      return await loadPullRequestWithGh({
        owner,
        repo,
        prNumber,
        includeReviews,
      });
    } catch (ghError) {
      // If gh fails and we're not forcing gh, fall back to API
      if (!forceGh) {
        verboseLog(
          'yellow',
          `⚠️ gh CLI failed: ${ghError.message}, falling back to API`
        );
        return loadPullRequestWithApi({
          owner,
          repo,
          prNumber,
          token,
          includeReviews,
        });
      }
      throw ghError;
    }
  }

  // gh not available, use API
  verboseLog('cyan', '🔧 gh CLI not available, using API');
  return loadPullRequestWithApi({
    owner,
    repo,
    prNumber,
    token,
    includeReviews,
  });
}
