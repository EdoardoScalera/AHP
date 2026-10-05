# Cloudflare Worker setup guide

## Purpose

This guide creates a small **Cloudflare Worker** that receives a questionnaire submission, verifies a shared access code, and writes each accepted response as a JSON file in a private GitHub repository.

```text
Public survey page -> Cloudflare Worker -> private GitHub repository/data/submissions/
```

The public browser never receives the GitHub token. The Worker stores the token and the shared access code as Cloudflare secrets.

## Do I need the Cloudflare website?

No. You can create, configure, test, and deploy a Worker entirely from the command line with **Wrangler**.

You do need a Cloudflare account. The first Wrangler login opens a browser window so you can authorise the command-line tool. After that, deployment can remain command-line based. You may use the dashboard later to view logs or usage, but it is optional.

## Prerequisites

- Node.js LTS installed. Check it:

```powershell
node --version
npm --version
```

- A Cloudflare account.
- A GitHub account or organisation.
- A private GitHub repository for raw responses, for example `entrance-survey-responses`.
- Git installed if you want local version control (recommended but not required).

Use PowerShell on Windows for the commands below.


## Repository layout: use two repositories

For this design, use **two GitHub repositories**:

```text
Repository 1 (public):  entrance-questionnaire
Repository 2 (private): entrance-survey-responses
```

This separation is strongly recommended because the questionnaire page must be public for participants to open it, while raw submissions can contain names, email addresses, stakeholder feedback, or other data that must not be public.

```text
Participant
    |
    | opens the questionnaire
    v
Public GitHub Pages site (entrance-questionnaire)
    |
    | HTTPS POST containing form answers + participant-entered access code
    v
Cloudflare Worker
    |
    | verifies code; holds GitHub credential as a Worker secret
    v
Private GitHub repository (entrance-survey-responses)
```

### Repository 1: public questionnaire website

Create a public repository, for example `entrance-questionnaire`, containing only website material:

```text
entrance-questionnaire/
├── index.html
├── css/
│   └── styles.css
├── js/
│   └── app.js
├── assets/
└── README.md
```

Enable GitHub Pages for this repository. The website JavaScript needs only the public Worker address:

```javascript
const WORKER_URL =
  "[https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev](https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev)";
```

The Worker URL is safe to publish. It is not a GitHub write credential. The Worker performs the access-code check and holds the actual GitHub token privately.

Never put any of the following in this public repository or in browser-side HTML/JavaScript:

- `GITHUB_TOKEN`
- `SUBMISSION_ACCESS_CODE`
- A password that protects or derives a GitHub token
- Raw submitted responses
- A `.dev.vars`, `.env`, or secret configuration file

All browser-delivered page resources can be inspected by users, so a public webpage cannot safely hold a secret.

### Repository 2: private raw response storage

Create a private repository, for example `entrance-survey-responses`, containing raw submissions and, optionally, analysis code:

```text
entrance-survey-responses/
├── data/
│   └── submissions/
│       └── .gitkeep
├── scripts/
└── README.md
```

The Worker writes one uniquely named JSON file per successful response, for example:

```text
data/submissions/2026-09-30T15-25-12-123Z-<uuid>.json
```

Create the fine-grained GitHub personal access token described in Step 1 with access to **only this private repository** and only this required permission:

```text
Repository permissions → Contents: Read and write
```

Do not grant the token access to the public questionnaire repository. This limits the effect if the token has to be replaced or is ever exposed.

### Can one repository work?

Technically, yes: you could use one private repository for both the website source and submissions if your GitHub plan supports publishing Pages from it. However, do not rely on repository privacy to protect anything that your Pages deployment publishes. A public Pages site is meant to serve web content publicly, and deployment configuration mistakes can expose files or make separation unclear.

Using separate repositories prevents raw survey data from sitting beside public website source files. It also lets you give collaborators access to update the questionnaire without automatically granting them access to identifiable responses.

### Optional third repository

You do **not** need a third repository to get started. Keep the Worker project locally at first. After it works, you may version-control it in a separate private repository:

```text
entrance-submission-worker (private)
```

That optional repository would contain Worker source code, `wrangler.jsonc`, and documentation. It must still exclude `.dev.vars`, `.env`, real tokens, and real access codes. Do not store secrets in Git, even in a private repository.


## 1. Prepare the GitHub repository

1. Create a **private** repository called, for example:

```text
entrance-survey-responses
```

2. Create this folder in it:

```text
data/submissions/
```

3. Add an empty placeholder file so Git preserves the folder:

```text
data/submissions/.gitkeep
```

4. Create a fine-grained GitHub personal access token:
   - GitHub -> profile picture -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens.
   - Generate a new token.
   - Choose the repository owner.
   - Under **Repository access**, select **Only select repositories** and choose `entrance-survey-responses`.
   - Under **Repository permissions**, set **Contents** to **Read and write**.
   - Leave all other permissions as **No access**.
   - Set an expiry date and record a reminder to rotate it.
   - Copy the token now. GitHub will not show it again.

Do not save this token in source code, a Git repository, frontend JavaScript, or a screenshot.

## 2. Create the Worker project from PowerShell

Choose a parent folder and run:

```powershell
cd $HOME\Documents
npm create cloudflare@latest entrance-submission-api
```

Answer prompts approximately as follows:

```text
Start with:             Hello World example
Template:               Worker only
Language:               JavaScript
Use Git:                Yes (recommended)
Deploy now:             No
```

The exact wording can change as Wrangler evolves. The important choices are a Worker-only project and JavaScript.

Enter the project:

```powershell
cd entrance-submission-api
```

## 3. Authenticate Wrangler

Run:

```powershell
npx wrangler login
```

Your browser opens once. Log in to Cloudflare and approve Wrangler access. Return to PowerShell after confirmation.

Verify it if desired:

```powershell
npx wrangler whoami
```

## 4. Configure public repository values

Open `wrangler.jsonc` in VS Code or another editor. Retain fields generated by Cloudflare and add a top-level `vars` section like this:

```jsonc
{
  "name": "entrance-submission-api",
  "main": "src/index.js",
  "compatibility_date": "2026-09-30",

  "vars": {
    "GITHUB_OWNER": "YOUR-GITHUB-USERNAME-OR-ORG",
    "GITHUB_REPO": "entrance-survey-responses",
    "ALLOWED_ORIGIN": "https://YOUR-GITHUB-USERNAME.github.io"
  }
}
```

Replace:

- `YOUR-GITHUB-USERNAME-OR-ORG` with the account or organisation that owns the response repository.
- `entrance-survey-responses` with your repository name.
- `https://YOUR-GITHUB-USERNAME.github.io` with the final origin of your public survey page. Do not include a trailing slash.

`ALLOWED_ORIGIN` is not a secret; it restricts which browser site can make cross-origin requests to your Worker.

If your questionnaire is not hosted yet, use a temporary local origin for testing:

```text
http://localhost:8000
```

Change it to the real survey-page origin before deployment.

## 5. Add the Worker source code

Open `src/index.js` and replace all of its content with this code:

```javascript
export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const requestOrigin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      if (requestOrigin && requestOrigin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return response({ error: "Method not allowed." }, 405, corsHeaders);
    }

    if (requestOrigin && requestOrigin !== allowedOrigin) {
      return response({ error: "Origin not allowed." }, 403, corsHeaders);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return response({ error: "Expected JSON data." }, 415, corsHeaders);
    }

    try {
      const body = await request.json();

      if (
        typeof body.accessCode !== "string" ||
        body.accessCode !== env.SUBMISSION_ACCESS_CODE
      ) {
        return response(
          { error: "The access code is not valid." },
          403,
          corsHeaders
        );
      }

      const respondentName = cleanText(body.respondentName, 120);
      const organisation = cleanText(body.organisation, 160);
      const email = cleanText(body.email, 254);
      const answers = body.answers;

      if (!respondentName || !email || !isPlainObject(answers)) {
        return response(
          { error: "Please complete all required fields." },
          400,
          corsHeaders
        );
      }

      const submission = {
        schemaVersion: 1,
        submissionId: crypto.randomUUID(),
        submittedAt: new Date().toISOString(),
        respondent: {
          name: respondentName,
          organisation,
          email
        },
        answers
      };

      const safeTimestamp = submission.submittedAt
        .replace(/:/g, "-")
        .replace(/\./g, "-");
      const filePath =
        `data/submissions/${safeTimestamp}-${submission.submissionId}.json`;

      const githubUrl =
        `https://api.github.com/repos/${env.GITHUB_OWNER}/` +
        `${env.GITHUB_REPO}/contents/${filePath}`;

      const githubResponse = await fetch(githubUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          message: `Add survey response ${submission.submissionId}`,
          content: base64(JSON.stringify(submission, null, 2)),
          branch: "main"
        })
      });

      if (!githubResponse.ok) {
        console.error("GitHub API error:", githubResponse.status,
          await githubResponse.text());
        return response(
          { error: "The response could not be saved. Please try again later." },
          502,
          corsHeaders
        );
      }

      return response(
        {
          ok: true,
          submissionId: submission.submissionId,
          message: "Thank you. Your response has been submitted."
        },
        201,
        corsHeaders
      );
    } catch (error) {
      console.error("Request error:", error);
      return response({ error: "Invalid submission." }, 400, corsHeaders);
    }
  }
};

function cleanText(value, maximumLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximumLength);
}

function isPlainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function response(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}
```

This initial version expects these fields:

```json
{
  "accessCode": "shared secret supplied by participant",
  "respondentName": "Required name",
  "organisation": "Optional organisation",
  "email": "Required email",
  "answers": {
    "exampleQuestion": "example answer"
  }
}
```

Change the `answers` structure later to match the final ENTRANCE questionnaire. The access code is checked but is deliberately not written into the JSON file.

## 6. Prevent accidental secret commits

Open `.gitignore` and ensure it includes:

```gitignore
.dev.vars
.env
.env.*
```

Do not commit a file containing real tokens or passwords.

## 7. Add local development secrets

For local testing only, create a file named `.dev.vars` in the project root:

```text
SUBMISSION_ACCESS_CODE=replace-with-a-strong-test-access-code
GITHUB_TOKEN=github_pat_replace-with-your-token
```

The Worker gets `GITHUB_OWNER`, `GITHUB_REPO`, and `ALLOWED_ORIGIN` from `wrangler.jsonc`; it gets the access code and token from `.dev.vars` locally.

Confirm `.dev.vars` is ignored before you run any Git commit:

```powershell
git status
```

It must not be listed as a file to commit.

## 8. Run locally

Start the Worker:

```powershell
npx wrangler dev
```

It will normally show a URL such as:

```text
http://localhost:8787
```

In a second PowerShell terminal, submit a test request. Replace the access code with the exact test value in `.dev.vars`:

```powershell
$body = @{
  accessCode = "replace-with-a-strong-test-access-code"
  respondentName = "Test participant"
  organisation = "Test organisation"
  email = "test@example.org"
  answers = @{
    pilotSite = "Test pilot"
    thermalComfort = 4
    flexibilityAcceptance = 3
    comments = "Test only: delete this response after verification."
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787" `
  -ContentType "application/json" `
  -Body $body
```

Expected outcome:

- PowerShell returns `ok: true` and a submission ID.
- A new JSON file appears at `data/submissions/` in the response repository.

If GitHub returns 401 or 403:

- Check that the PAT is correct and has not expired.
- Confirm the token is limited to the selected response repository.
- Confirm the token has **Contents: Read and write** permission.
- Confirm `GITHUB_OWNER`, `GITHUB_REPO`, and the branch name are correct.

Try a wrong access code too. It should return an error and create no file.

## 9. Add deployed Worker secrets

Do not deploy `.dev.vars`; it is for local development only. Store production secrets with Wrangler:

```powershell
npx wrangler secret put SUBMISSION_ACCESS_CODE
```

Paste the real shared access code when prompted.

Then add the GitHub token:

```powershell
npx wrangler secret put GITHUB_TOKEN
```

Paste the fine-grained GitHub token when prompted.

The terminal will not show the secret after entry. These values are stored as encrypted Worker secrets and are exposed to the Worker only as `env.SUBMISSION_ACCESS_CODE` and `env.GITHUB_TOKEN`.

## 10. Deploy from the command line

Deploy the Worker:

```powershell
npx wrangler deploy
```

Wrangler prints the production endpoint, normally similar to:

```text
https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev
```

Save this URL. It is the URL your public questionnaire will call.

You can make a production test using the same PowerShell payload, replacing the URL:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev" `
  -ContentType "application/json" `
  -Body $body
```

If `ALLOWED_ORIGIN` is set to your GitHub Pages URL, PowerShell should still work because it does not normally send an `Origin` header. A real browser request must originate from exactly the configured origin.

## 11. Call it from the questionnaire page

Use the Worker URL in your public webpage JavaScript:

```javascript
const WORKER_URL = "https://entrance-submission-api.YOUR-SUBDOMAIN.workers.dev";

async function submitResponse(payload) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Submission failed.");
  }

  return result;
}
```

Build `payload` using the form field values, with the field names expected by the Worker: `accessCode`, `respondentName`, `organisation`, `email`, and `answers`.

Never put `GITHUB_TOKEN` or `SUBMISSION_ACCESS_CODE` directly into public webpage code. The participant enters the access code; the Worker checks it privately.

## 12. Go-live checklist

- [ ] The response repository is private.
- [ ] The GitHub fine-grained token has access to only that repository.
- [ ] The token has only **Contents: Read and write** permission.
- [ ] The Worker source contains no token and no actual access code.
- [ ] `.dev.vars` is ignored by Git and was never committed.
- [ ] `ALLOWED_ORIGIN` exactly matches the deployed questionnaire origin.
- [ ] A wrong access code produces no response file.
- [ ] A correct request produces exactly one JSON response file.
- [ ] The generated JSON file contains no `accessCode`.
- [ ] The questionnaire includes appropriate data-protection information and consent where required.
- [ ] You recorded the GitHub token expiry/rotation date.

## Operating notes

- A shared access code is a simple gate, not individual identity verification. People can share it.
- Do not collect sensitive personal data unless your research governance and data-protection arrangements explicitly support it.
- Store raw identifiable responses in a private repository or, preferably, an approved institutional data environment.
- Change the shared access code by running `npx wrangler secret put SUBMISSION_ACCESS_CODE` again. It takes effect on the Worker without exposing the previous value.
- Replace a renewed GitHub token with `npx wrangler secret put GITHUB_TOKEN`.
- If a token is exposed, revoke it in GitHub immediately, create a replacement token, and update the Worker secret.
- You can view Worker logs from the command line during diagnosis:

```powershell
npx wrangler tail
```

Avoid logging full request bodies in production because they may contain personal data.
