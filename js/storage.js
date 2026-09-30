import { Octokit } from 'https://esm.sh/@octokit/rest@20.0.2';

const Storage = (() => {
  let config = null;
  let octokit = null;

  function init(cfg) {
    if (!cfg) {
      throw new Error('GitHub configuration is missing');
    }

    config = cfg;

    if (!config.githubPat || !config.repoOwner || !config.repoName) {
      throw new Error('Incomplete GitHub configuration');
    }

    octokit = new Octokit({
      auth: config.githubPat
    });
  }

  async function saveSubmission(data) {
    if (!octokit || !config) {
      throw new Error('GitHub client not initialized. Check config.js');
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

    const nameSlug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const filename = `${nameSlug}_${timestamp}.json`;

    const content = {
      name: data.name,
      role: data.role,
      pilot: data.pilot,
      country: data.country,
      timestamp: new Date().toISOString(),
      matrix: data.matrix,
      weights: data.weights,
      cr: data.cr,
      consistent: data.consistent,
      missingCriteria: data.missingCriteria || ''
    };

    const contentBase64 = btoa(
      unescape(
        encodeURIComponent(JSON.stringify(content, null, 2))
      )
    );

    try {
      const response =
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: config.repoOwner,
          repo: config.repoName,
          path: `data/submissions/${filename}`,
          message: `Add AHP submission from ${data.name}`,
          content: contentBase64,
          branch: 'main',
          committer: {
            name: data.name,
            email: 'ahp-survey@entrance.eu'
          },
          author: {
            name: data.name,
            email: 'ahp-survey@entrance.eu'
          }
        });

      return response.data;
    } catch (error) {
      if (error.status === 401) {
        throw new Error('Authentication failed');
      }

      if (error.status === 403) {
        throw new Error(
          'Permission denied: token needs Contents: write access'
        );
      }

      if (error.status === 404) {
        throw new Error(
          'Repository unavailable: check owner, repository, token access, and branch'
        );
      }

      throw new Error(`GitHub API error: ${error.message}`);
    }
  }

  async function fetchCriteria() {
    if (!octokit || !config) {
      return null;
    }

    try {
      const response =
        await octokit.rest.repos.getContent({
          owner: config.repoOwner,
          repo: config.repoName,
          path: 'data/criteria.json',
          ref: 'main'
        });

      const decoded = decodeURIComponent(
        escape(atob(response.data.content))
      );

      return JSON.parse(decoded);
    } catch (error) {
      console.warn(
        'Could not fetch criteria from GitHub:',
        error.message
      );
      return null;
    }
  }

  return {
    init,
    saveSubmission,
    fetchCriteria
  };
})();

export { Storage };