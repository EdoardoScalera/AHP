const CONFIG = {
  // Cloudflare Worker that verifies the access code and writes to the private repo.
  // for testing locally:
  // WORKER_URL: "http://localhost:8787",
  WORKER_URL: 'https://entrance-submission-api.edoardo-scalera.workers.dev',
  VERIFY_PATH: '/verify',
  SUBMIT_PATH: '/submit'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

export { CONFIG };