const Storage = (() => {
  let config = null;
  let octokit = null;

  function init(cfg) {
    config = cfg;
    if (typeof Octokit !== 'undefined') {
      octokit = new Octokit({ auth: config.githubPat });
    }
  }

  async function saveSubmission(data) {
    if (!octokit) {
      throw new Error('GitHub client not initialized. Check config.js');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nameSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));

    try {
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: config.repoOwner,
        repo: config.repoName,
        path: `data/submissions/${filename}`,
        message: `Add AHP submission from ${data.name} (${data.role}, ${data.pilot}, ${data.country})`,
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
        throw new Error('Authentication failed. Check GitHub PAT in config.js');
      }
      if (error.status === 403) {
        throw new Error('Permission denied. Ensure PAT has Contents: write access');
      }
      if (error.status === 404) {
        throw new Error('Repository not found. Check repo owner/name in config.js');
      }
      throw new Error(`GitHub API error: ${error.message}`);
    }
  }

  async function fetchCriteria() {
    if (!octokit) return null;
    try {
      const response = await octokit.rest.repos.getContent({
        owner: config.repoOwner,
        repo: config.repoName,
        path: 'data/criteria.json',
        ref: 'main'
      });
      const content = response.data.content;
      const decoded = decodeURIComponent(escape(atob(content)));
      return JSON.parse(decoded);
    } catch (error) {
      console.warn('Could not fetch criteria from GitHub:', error.message);
      return null;
    }
  }

  return { init, saveSubmission, fetchCriteria };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}