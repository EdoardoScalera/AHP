const CONFIG = {
  // Cloudflare Worker that verifies the access code and writes to the private repo.
  // Safe to publish: this URL is NOT a secret. The Worker holds GITHUB_TOKEN + access code privately.
  // TODO(YOU): replace with your deployed URL from `npx wrangler deploy`, e.g.
  // https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev
  WORKER_URL: 'https://entrance-submission-api.edoardo-scalera.workers.dev',
  VERIFY_PATH: '/verify',
  SUBMIT_PATH: '/submit'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

export { CONFIG };