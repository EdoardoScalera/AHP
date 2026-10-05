const CONFIG = {
  // Public Cloudflare Worker URL (not a secret).
  // Copy this file to config.js and set your deployed Worker URL.
  WORKER_URL: 'https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev',

  // Worker routes (do not change unless Worker code changes)
  VERIFY_PATH: '/verify',

  // Submit route
  SUBMIT_PATH: '/submit'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

export { CONFIG };