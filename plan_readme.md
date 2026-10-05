# AHP Survey – v1 Workflow Plan (Public Pages + Cloudflare Worker + Private Repo)

**Saved:** 2026-10-02 | **Status:** Planned, not yet implemented | **Author:** Planning session with user

## 0. Repositories & Naming (locked)

* **Public repo (this folder):** `https://github.com/EdoardoScalera/AHP`
  * Role: GitHub Pages survey site only. No secrets, no responses.
  * Contents: `index.html`, `css/`, `js/`, `data/criteria.json`, `docs/`, `.github/workflows/deploy.yml` only.
* **Private repo:** `https://github.com/EdoardoScalera/entrance-survey-responses`
  * Local clone: `C:\Users\scalere1\OneDrive - Tallinna Tehnikaülikool\Documents\GitHub\entrance-survey-responses` (checked 2026-10-02: empty, only `.git/`).
  * Role: raw JSON storage. `data/submissions/*.json` (+ `data/drafts/` placeholder for v2).
* **Worker:** `entrance-submission-api`
  * Production URL (after deploy): `https://entrance-submission-api.<YOUR-SUBDOMAIN>.workers.dev`
  * `ALLOWED_ORIGIN=https://edoardoscalera.github.io` (Origin header has no path; Pages page will be `https://edoardoscalera.github.io/AHP/`).

Related docs read for this plan: `README.md` (old PAT+dispatch design), `cloudflare-worker-setup-guide.md` (target Worker design), `index.html`, `js/{ahp-core,ui,auth,storage,app,config}.js`, `data/criteria.json`, `.github/workflows/{deploy,submit-survey}.yml`.

---

## 1. Why Change (findings from code read)

Current `README.md` design **does not meet privacy/security for v1:**

1. `js/config.js:5` contains a real exposed `github_pat_11BJ5...` in the public repo. Must be revoked. `passwordHash` is also public.
2. `js/storage.js` uses `repository_dispatch` from the browser. Requires PAT in frontend (insecure), CORS-fragile, no synchronous feedback, writes to `data/submissions/` in the **same public repo** – leaks PII (name/role/pilot/country).
3. `.github/workflows/submit-survey.yml` + `data/submissions/` assume same-repo writes. Must be removed from public repo after migration.
4. `js/auth.js` does SHA-256 hash compare locally. User requested server-side gate via Worker.
5. Guide Worker example expects `{accessCode, respondentName, organisation, email, answers}` – does **not** match AHP app payload `{name, role, pilot, country, matrix[8x8], weights[8], cr, consistent, missingCriteria}`. Worker validation must be rewritten for AHP.

Target (per `cloudflare-worker-setup-guide.md` + user answers):

```text
Participant
  | opens questionnaire
  v
Public Pages (EdoardoScalera/AHP)
  | POST {accessCode + AHP payload}, Origin: https://edoardoscalera.github.io
  v
Cloudflare Worker (entrance-submission-api)
  | verifies env.SUBMISSION_ACCESS_CODE, holds env.GITHUB_TOKEN privately
  v
Private repo (entrance-survey-responses) /data/submissions/<timestamp>-<uuid>.json
```

Browser never sees `GITHUB_TOKEN` or real access code. Worker URL is public and safe.

---

## 2. Decisions Locked (from Q&A 2026-10-02)

Q1 Repos: `Keep AHP public, private already exists` → use names above. Private folder access granted.
Q2 Cloudflare: `I have an account but need guide to setup everything, I'll let you setup entire worker from npm` → I scaffold via `npm create cloudflare@latest`.
Q3 Schema/privacy: `Hybrid / minimize PII` → clarified below to **store real identity in private repo** (user needs to know respondent) + consent. See §6.
Q4 Access-code UX: `use cloudflare worker to ask for password to access the survey. Draft can be stored in github and accessed through UX (perhaps nickname to retrieve)` → v1: Worker `/verify` gate, drafts stay in `localStorage`. GitHub nickname drafts deferred to v2.
Q5 Ops: `focus on deploying the tool with cloudflare. Survey revision + other ops later` → v1 = Worker + submit flow only. No admin dashboard, no aggregation/CSV, no survey content changes in v1.

---

## 3. Phase 0 – Emergency Security (user, before build)

- [ ] Revoke `github_pat_11BJ5...` (GitHub → Settings → Developer settings → Tokens).
- [ ] Check `git log -- js/config.js` – if PAT was ever pushed public, consider it compromised (already assumed compromised).
- [ ] Create new fine-grained PAT for **private repo only**:
  * Owner: `EdoardoScalera`
  * Repository access: Only select repositories → `entrance-survey-responses`
  * Permissions: `Contents: Read and write`, all else `No access`
  * Expiry + rotation reminder (e.g., 90 days).
- [ ] Do NOT paste new token in chat, public repo, screenshots, `.dev.vars` committed to git. Only local `.dev.vars` + `npx wrangler secret put GITHUB_TOKEN`.

---

## 4. Phase 1 – Private Repo Init

Location: `C:\Users\scalere1\OneDrive - Tallinna Tehnikaülikool\Documents\GitHub\entrance-survey-responses`, branch `main`.

Target layout:

```text
entrance-survey-responses/
├── data/
│   ├── submissions/
│   │   └── .gitkeep
│   └── drafts/
│       └── .gitkeep  # placeholder for v2 nickname drafts
└── README.md  # private: purpose, access list, retention, contact
```

- [ ] `mkdir -p data/submissions data/drafts`, add `.gitkeep`, commit + push to `main`.
- [ ] Limit collaborators to analysis team only, require 2FA.
- [ ] Note: private GitHub repo = access-controlled, not institutional secure enclave. Acceptable for v1 low-risk with consent; migrate to institutional store if ethics board requires.

---

## 5. Phase 2 – Worker Scaffold (`entrance-submission-api`)

User authorized full scaffold from npm. Proposed location: sibling `worker/` subfolder in public checkout OR `$HOME\Documents\entrance-submission-api` + optional private repo later. Must have own `.gitignore` with `.dev.vars`, `.env*`. No secrets in git even if worker folder lives in public repo.

Steps (PowerShell):

```powershell
cd $HOME\Documents
npm create cloudflare@latest entrance-submission-api
# Choices: Hello World, Worker only, JavaScript, Git Yes, Deploy No
cd entrance-submission-api
npx wrangler login
npx wrangler whoami
```

`wrangler.jsonc` vars (public, safe to commit):

```jsonc
{
  "name": "entrance-submission-api",
  "main": "src/index.js",
  "compatibility_date": "2026-09-30",
  "vars": {
    "GITHUB_OWNER": "EdoardoScalera",
    "GITHUB_REPO": "entrance-survey-responses",
    "ALLOWED_ORIGIN": "https://edoardoscalera.github.io"
  }
}
```

For local dev temporarily use `"ALLOWED_ORIGIN": "http://localhost:8000"`, change to Pages origin before deploy.

### 5.1 Worker API (v1 – `/verify` + `/submit` only)

Keep CORS/POST skeleton from guide, replace validation with AHP rules.

* `OPTIONS` → `204` if `Origin==ALLOWED_ORIGIN` (or no Origin like curl/PowerShell), else `403`. Headers: `Access-Control-Allow-Origin`, `-Methods: POST, OPTIONS`, `-Headers: Content-Type`, `Vary: Origin`.
* `POST /verify` request: `{ "accessCode": "..." }` → `200 {ok:true}` or `403 {error:"The access code is not valid."}`. No file written. Used by unlock screen. Add generic errors to avoid oracle.
* `POST /submit` request:

```json
{
  "accessCode": "participant-entered code",
  "name": "Jane Doe",
  "role": "Building Owner",
  "pilot": "Tallinn pilot",
  "country": "Estonia",
  "email": "optional@example.eu",
  "matrix": [[1,3,...],...],
  "weights": [0.25,...],
  "cr": 0.05,
  "consistent": true,
  "missingCriteria": "free text ≤2000",
  "consent": true
}
```

Validation (400 on fail, 403 on bad code):

* `accessCode===env.SUBMISSION_ACCESS_CODE` else 403.
* `name/role/pilot/country`: trimmed string 1–120 chars required.
* `email`: optional, if present regex + ≤254.
* `matrix`: array 8×8 (generic n×n, expect 8), numbers 1/9–9, diag==1, reciprocal `|m[i][j]-1/m[j][i]|<1e-6`.
* `weights`: array len==matrix len, numbers 0–1, sum 0.99–1.01.
* `cr`: number 0–1. `consistent`: boolean. `missingCriteria`: string ≤2000 (optional). `consent===true` else 400.
* `Content-Type` must include `application/json`, method must be POST.

Storage (on pass):

```json
{
  "schemaVersion": 2,
  "submissionId": "<crypto.randomUUID()>",
  "submittedAt": "<ISO>",
  "respondent": {"name":"...","role":"...","pilot":"...","country":"...","email":"..."},
  "ahp": {"matrix":[...],"weights":[...],"cr":0.05,"consistent":true,"missingCriteria":"...","consent":true},
  "_meta": {"workflow":"cloudflare-worker"}
}
```

* No `accessCode` stored.
* Filename: `data/submissions/<safeTimestamp>-<uuid>.json` (`:`/`.` → `-`).
* GitHub call: `PUT https://api.github.com/repos/{OWNER}/{REPO}/contents/{path}` with `Authorization: Bearer env.GITHUB_TOKEN`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, body `{message:"Add survey response <id>", content: base64(json), branch:"main"}`.
* GitHub non-OK → log detail server-side (`console.error`, `wrangler tail`), return `502 {error:"The response could not be saved..."}` to browser.
* Success → `201 {ok:true, submissionId, message:"Thank you..."}`.
* `catch` → `400 {error:"Invalid submission."}`. Never log full bodies in prod (PII).

Local test (second PowerShell):

```powershell
# .dev.vars (ignored, never commit):
# SUBMISSION_ACCESS_CODE=replace-with-strong-test-code
# GITHUB_TOKEN=github_pat_...

npx wrangler dev  # http://localhost:8787

$body = @{ accessCode="replace-with-strong-test-code"; name="Test participant"; role="Test role"; pilot="Test pilot"; country="Test"; email="test@example.org"; matrix=@(@(1,3),@(0.333,1)); weights=@(0.75,0.25); cr=0.01; consistent=$true; missingCriteria="Test only"; consent=$true } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/submit" -ContentType "application/json" -Body $body
# expect ok:true + file in private repo; wrong code → 403 no file
```

Deploy:

```powershell
npx wrangler secret put SUBMISSION_ACCESS_CODE
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
# save https://entrance-submission-api.<subdomain>.workers.dev → put in public js/config.js as WORKER_URL
```

---

## 6. Respondent Identity & Privacy (answers Phase-4 question)

**Q: “I need to know who's the respondent. Data are anyway in private repo right? Otherwise store safely a document matching nickname with real name.”**

A: Yes – in v1 raw data lives **only** in private repo. To meet traceability:

* Store real identity directly in submission `respondent:{name,role,pilot,country,email?}` in private repo. Simplest, no extra lookup. Access = only private-repo collaborators. This is the v1 approach.
* Do NOT create a `nickname<->real name` map via Worker in v1 (extra endpoint + enumeration risk). If ethics later requires pseudonymisation: use `nickname` in submissions + keep mapping **offline** (local Excel not in git, or manually maintained `data/participants/registry.json` in private repo, never written by Worker). Deferred to v2/ethics review.
* Frontend must add consent checkbox + privacy note, e.g.: “I agree my name/role/pilot/country and comparisons are stored in private repo `entrance-survey-responses` for ENTRANCE analysis, accessible only to project team.” Worker rejects if `consent!==true`.
* Minimize: no collection of sensitive data beyond what is needed; cap lengths; do not store access code.

---

## 7. Phase 3 – Public Repo Refactor (this folder, v1)

- [ ] Delete `.github/workflows/submit-survey.yml` (old dispatch path).
- [ ] Delete `data/submissions/*.json` from public (keep folder with `.gitkeep` + note “moved to private repo” or remove folder). Never store responses here again.
- [ ] `js/config.js` + `js/config.example.js` → only:
  ```js
  const CONFIG = { WORKER_URL: "https://entrance-submission-api.<subdomain>.workers.dev", VERIFY_PATH: "/verify", SUBMIT_PATH: "/submit" };
  ```
- [ ] Rewrite `js/storage.js`: `verifyAccessCode(code)`, `saveSubmission(payload)` via `fetch(WORKER_URL+path, {method:POST, headers:Content-Type, body})`. No `api.github.com`, no PAT. Keep `fetchCriteria()` local only or drop GitHub fetch.
- [ ] Rewrite `js/auth.js`: `POST /verify` instead of SHA-256 compare. Keep code in memory only (`getPassword()`), never `localStorage`. Generic error UI.
- [ ] `js/app.js`: `Storage.init(CONFIG)` without PAT; load `data/criteria.json` via relative `fetch('data/criteria.json')`.
- [ ] `index.html` (+ `js/ui.js`): keep `name/role/pilot/country*`, add `email?` + `consent*` checkbox + privacy link. Keep `Save Draft` = `localStorage` for v1 (no GitHub drafts yet).
- [ ] Keep `.github/workflows/deploy.yml` only. Pages Settings → Source: GitHub Actions. Ensure `upload-pages-artifact path: '.'` no longer includes secrets/submissions.
- [ ] Ensure no `.dev.vars`, `.env`, tokens, or codes committed to public. `js/config.js` must contain only `WORKER_URL`.

---

## 8. Phase 4 – Test & Go-Live Checklist (v1)

Local:

- [ ] `python3 -m http.server 8000` in `AHP/` + `wrangler dev` with `ALLOWED_ORIGIN=http://localhost:8000`.
- [ ] Correct code → `201 ok:true` + 1 file in private `data/submissions/`, no `accessCode` in file.
- [ ] Wrong code → `403` + no file. Bad matrix/weights → `400`. Non-POST → `405`. Wrong Origin (browser) → `403`.

Prod:

- [ ] Set `ALLOWED_ORIGIN=https://edoardoscalera.github.io`, `wrangler deploy`, update public `WORKER_URL`, push public `main`, verify Pages deploy.
- [ ] Test from `https://edoardoscalera.github.io/AHP/` (unlock → fill 8×8 → CR green → submit → success screen). Confirm file appears private. `npx wrangler tail` for logs (no body logging).
- [ ] Go-live checks: private repo private; token only private repo + Contents RW; Worker source has no token/code; `.dev.vars` ignored/never committed; old PAT revoked; consent text present; token expiry recorded.

---

## 9. Explicit Non-Goals for v1 (do after v1 works, per user)

* GitHub nickname drafts (`POST /drafts`, `GET /drafts?nickname=`) – design ready but not in v1.
* Survey content revision / new sections.
* Admin dashboard, geometric-mean aggregation, CSV export, notifications, token rotation automation.

## 10. Next Actions (when resuming)

1. User: revoke old PAT, create private-scoped PAT, confirm `main` branch + consent wording.
2. Assistant (build): scaffold `entrance-submission-api`, implement `src/index.js` per §5.1, `wrangler.jsonc`, `.gitignore`.
3. Assistant: refactor public `config/storage/auth/app/ui/index.html`, delete `submit-survey.yml` + public submissions.
4. Joint: `wrangler dev` → `secret put` → `deploy` → Pages end-to-end test.

*Progress saved – no code changed yet. Resume by approving §3–§7 to start build.*
