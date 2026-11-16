const CONFIG = {
  // Cloudflare Worker that validates and stores submissions to the private repo.
  // for testing locally:
  // WORKER_URL: "http://localhost:8787",
  // // WORKER_URL: 'https://entrance-submission-api.edoardo-scalera.workers.dev',
  // SUBMIT_PATH: '/submit',
  // // Turnstile site key (set after widget creation via Cloudflare API / dashboard)
  // TURNSTILE_SITEKEY: '0x4AAAAAAF_XijvRoUvW1otC'

  WORKER_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:8787' : 'https://entrance-submission-api.edoardo-scalera.workers.dev',
  SUBMIT_PATH: '/submit',
  TURNSTILE_SITEKEY: "0x4AAAAAAF_XijvRoUvW1otC"
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

export { CONFIG };

