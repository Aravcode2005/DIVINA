# Hireflow

> **End-to-end hiring automation** — post a job to LinkedIn, screen every candidate who emails in, and book meetings with the qualified ones, with no manual work in between.

**Stack:** Node.js · Express 5 · MongoDB (Mongoose) · Redis (ioredis) · OpenAI (gpt-3.5-turbo) · Playwright (Chromium) · Gmail API · Google Calendar API · Google OAuth2 · EJS · JWT · bcrypt · Twilio · SendGrid · Docker

---

## ✨ Golden Parts — What This App Gets Right

Amid the rough edges tracked in [Known Issues](#22-known-issues--gaps), several pieces of this codebase are genuinely well-engineered and worth calling out:

- **True multi-tenant isolation, done consistently.** Every piece of state that matters — LinkedIn session, Google tokens, scheduled posts, candidates, processed-email log — is scoped by `adminId` from the database layer up. There's no shared global state between admins anywhere in the pipeline, which is what lets multiple recruiters run independent, non-interfering pipelines on one deployment. (`models/*`, `scheduler/cron.js`, `scheduler/emailScanner.js`)

- **Replay-proof email processing.** `ProcessedEmail` has a compound unique index on `(adminId, messageId)`, and *both* cron jobs check it before acting and record it after. Combined with the `SCREENING_SENT` stage check, this means a candidate can never be double-screened, double-booked, or double-rejected even if a cron tick overlaps or a message gets scanned twice. (`models/ProcessedEmail.js`, `scheduler/emailScanner.js`, `scheduler/replyProcessor.js`)

- **Graceful degradation at every layer, not just the happy path.** The AI reply parser silently falls back to a regex heuristic parser if no OpenAI key is set or the API call fails — the rest of the pipeline never has to know which one ran (`services/aiService.js`). The dashboard's data aggregator (`getCombinedDashboardData`) catches any Mongo failure and returns a fully-zeroed default object instead of a broken page. The posting scheduler catches errors *per admin* and *per post*, so one expired LinkedIn session or one bad post never stalls anyone else's queue.

- **Self-healing Google OAuth.** Both the email scanner and reply processor attach a `tokens` listener to the OAuth2 client and persist any silently-refreshed access token straight back to `AdminGoogleAuth`. Combined with `access_type: offline` + `prompt: consent` at connect time, an admin effectively never has to manually reconnect Gmail once it's set up. (`scheduler/emailScanner.js`, `scheduler/replyProcessor.js`, `controllers/admin.js`)

- **Real auth hygiene, not just a login form.** Session regeneration on login (fixation-proof), bcrypt at salt-rounds 12, OTPs hashed at rest with a 5-minute Redis TTL and a hard 3-attempt lockout, `httpOnly`/`sameSite: strict` cookies — these are the details teams often skip, and they're all here. (`controllers/admin.js`)

- **Concurrency-safe cron jobs.** Both the email scanner and reply processor guard themselves with an `isRunning` flag, so a slow Gmail API response can't cause two overlapping ticks to double-process the same inbox. (`scheduler/emailScanner.js`, `scheduler/replyProcessor.js`)

- **A deterministic, auditable qualification gate.** `qualificationService.js` is a small, pure, side-effect-free function with verbose logging of exactly which rule passed or failed — there's no hidden scoring model to second-guess when a rejection needs to be explained. (`services/qualificationService.js`)

- **AI prompting built to resist hallucination.** The LinkedIn post formatter's system prompt explicitly forbids inventing details, enforces a strict output template with a worked reference example, and requires JSON-mode output — a deliberate design against the most common failure mode of LLM content generation. (`scheduler/cron.js`)

- **Production-realistic headed-browser deployment.** Rather than fighting Playwright into a headless corner, the Docker image ships Xvfb + x11vnc + noVNC so a real, visible Chromium session can run inside a container and be watched or steered over a browser-based VNC client — a pragmatic answer to "how do you run a login-driven browser automation in production." (`Dockerfile`, `entrypoint.sh`)

---

## Table of Contents

1. [What Hireflow Does](#1-what-hireflow-does)
2. [Pipeline Overview](#2-pipeline-overview)
3. [Repository Structure](#3-repository-structure)
4. [Getting Started](#4-getting-started)
5. [Environment Variables](#5-environment-variables)
6. [Application Entry Point (`server.js`)](#6-application-entry-point-serverjs)
7. [Database Models](#7-database-models)
8. [Routes](#8-routes)
9. [Admin Authentication System](#9-admin-authentication-system)
10. [Admin Dashboard](#10-admin-dashboard)
11. [Google OAuth (Gmail + Calendar)](#11-google-oauth-gmail--calendar)
12. [LinkedIn Autoposting Pipeline](#12-linkedin-autoposting-pipeline)
13. [AI Content Formatting (Job Posts)](#13-ai-content-formatting-job-posts)
14. [Email Scanner (Candidate Intake)](#14-email-scanner-candidate-intake)
15. [Reply Processor (Screening & Qualification)](#15-reply-processor-screening--qualification)
16. [AI Reply Parsing Service](#16-ai-reply-parsing-service)
17. [Qualification Rules Engine](#17-qualification-rules-engine)
18. [Gmail/Calendar Service Wrapper](#18-gmailcalendar-service-wrapper)
19. [Views & UI](#19-views--ui)
20. [Docker & Deployment](#20-docker--deployment)
21. [Testing](#21-testing)
22. [Known Issues & Gaps](#22-known-issues--gaps)
23. [Security Notes](#23-security-notes)
24. [Roadmap](#24-roadmap)

---

## 1. What Hireflow Does

Hireflow removes every manual step between "we have a job to fill" and "we have a qualified candidate on the calendar." An admin logs into a dashboard, types (or pastes) a raw job description and a publish time, and attaches an image. From that point on:

- An AI model rewrites the description into a polished, hashtag-tagged LinkedIn post.
- A headless/visible Chromium browser, driving a previously-captured LinkedIn session, publishes the post automatically at the scheduled time.
- Candidates who reply by emailing a resume to the admin's connected Gmail inbox are automatically detected, sent a short screening questionnaire, and tracked through a pipeline of stages.
- Their questionnaire reply is parsed by AI (or a regex fallback if no API key is configured) into structured fields — name, location, visa status, arrival date, and interest in marketing services.
- A rules engine qualifies or rejects the candidate based on those fields. Qualified candidates get an automatic email with a booking link; unqualified candidates are silently rejected; incomplete replies are flagged for manual review.

Everything — LinkedIn session state, Gmail/Calendar OAuth tokens, candidates, scheduled posts, and processed-email dedup logs — is scoped **per admin account**, so multiple recruiters/admins can run independent pipelines from the same deployment.

---

## 2. Pipeline Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              HIREFLOW PIPELINE                            │
│                                                                             │
│   ┌───────────────┐        ┌────────────────┐        ┌─────────────────┐  │
│   │  STAGE 1      │        │  STAGE 2       │        │  STAGE 3        │  │
│   │  Post         │──────► │  Screen        │──────► │  Book           │  │
│   │               │        │                │        │                 │  │
│   │  Admin writes │        │  Candidate     │        │  Qualified      │  │
│   │  a job desc.  │        │  emails a      │        │  candidates get │  │
│   │  → AI polishes│        │  resume → auto │        │  a booking link;│  │
│   │  → Playwright │        │  questionnaire │        │  unqualified are│  │
│   │  posts it to  │        │  → AI parses   │        │  silently       │  │
│   │  LinkedIn     │        │  the reply     │        │  rejected       │  │
│   └───────────────┘        └────────────────┘        └─────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

All three stages run inside **one Express process** (`server.js`), on one port. There is no separate second service — post publishing, inbox scanning, and reply processing are three background loops (a `setInterval` and two `node-cron` jobs) started once the database connection is established.

| Stage | Trigger | What Happens | Technology |
|-------|---------|--------------|------------|
| 1. Post | `setInterval`, every 60s | Due posts are pulled from Mongo, rewritten by GPT-3.5-turbo, and published via Playwright | OpenAI + Playwright + Chromium |
| 2. Screen | `node-cron`, every 2 minutes | Unread inbox emails are scanned for job-application language; a questionnaire is sent and a `Candidate` record created | Gmail API |
| 3. Qualify & Book | `node-cron`, every 2 minutes | Replies to the questionnaire are parsed by AI, scored against hard rules, and the candidate is booked, rejected, or flagged | Gmail API + OpenAI + rules engine |

---

## 3. Repository Structure

```
RAMJIKrishnaAWS/
│
├── server.js                    # Single entry point — boots DB, cron jobs, and the HTTP server
├── package.json                 # Dependency manifest (name: "linkedin-agent")
├── docker-compose.yaml          # App + Redis for local/production container runs
├── Dockerfile                   # node:20-slim + Xvfb + noVNC + Chromium (for non-headless Playwright)
├── entrypoint.sh                # Boots a virtual display + VNC bridge, then starts the app
├── generateToken.js             # Legacy one-time CLI script for manual Google OAuth token generation
├── playwright.config.ts         # Playwright test runner config
├── credentials.json             # Google Cloud OAuth client credentials — never commit
├── adminauth.json               # Placeholder for a captured Playwright session — never commit
├── token.json                   # Legacy OAuth token file (superseded by per-admin DB-stored tokens) — never commit
│
├── util/
│   └── db.js                    # Mongoose connection with pooling/timeouts
│
├── config/
│   └── google.js                # Builds a per-request Google OAuth2 client (file or env-based secrets)
│
├── models/
│   ├── adminmodel.js             # Admin accounts (login credentials)
│   ├── contentmodel.js           # Per-admin scheduled LinkedIn post queue
│   ├── linkedinauth.js           # Per-admin captured LinkedIn browser session (Playwright storageState)
│   ├── AdminGoogleAuth.js        # Per-admin Google OAuth tokens + connected Gmail address
│   ├── Candidate.js              # Candidate records + pipeline stage
│   ├── ProcessedEmail.js         # Dedup log: (adminId, messageId) already handled
│   └── Post.js                   # Legacy/unused schema, kept for reference
│
├── routes/
│   ├── admin.js                  # All admin-facing routes (auth, dashboard, LinkedIn/Google connect)
│   ├── posts.js                  # Public landing route
│   └── superadmin.js             # Empty placeholder — not implemented
│
├── controllers/
│   ├── admin.js                  # Auth flows, dashboard data aggregation, Google OAuth, LinkedIn connect, post scheduling
│   ├── posts.js                  # Landing page + a standalone AI post generator helper
│   └── superadmin.js             # Empty placeholder — not implemented
│
├── scheduler/
│   ├── cron.js                   # Core 60s loop: polls due posts, formats with AI, posts via Playwright
│   ├── linkedin.js               # Older/simpler standalone Playwright poster (uses a local auth.json, not DB-backed)
│   ├── emailScanner.js           # node-cron, every 2 min — detects new applications, sends questionnaire
│   └── replyProcessor.js         # node-cron, every 2 min — parses replies, qualifies, books or rejects
│
├── services/
│   ├── aiService.js              # GPT-3.5-turbo reply parser with a regex-based fallback
│   ├── gmailService.js           # Gmail API + Google Calendar wrapper (list/get/send/mark-read/create-event)
│   └── qualificationService.js   # Hard-rule pass/fail scoring for a parsed candidate
│
├── views/                        # EJS templates (Tailwind CSS, Font Awesome, Google Fonts via CDN)
│   ├── land.ejs / Homepage.ejs / adminHome.ejs
│   ├── adminSignup.ejs / verifyOtp.ejs / AdminProfile.ejs / adminSignin.ejs
│   ├── adminDashboard.ejs        # Main control panel (stats, scheduling form, LinkedIn/Google status, candidates)
│   ├── editDb.ejs                # Internal/debug view
│   └── superAdmin.ejs            # Placeholder view for the unimplemented superadmin role
│
├── images/                       # Uploaded admin profile photos (multer destination)
├── content/                      # Uploaded post images (multer destination)
└── test/
    └── example.specs.ts          # Playwright test scaffold
```

> **Note on the codebase's history:** an earlier version of this project ran as two separate services — a "LinkedIn Autoposter" on port 3000 and a "RecruiterOS" email engine on port 3001 in a `redesigned-bassoon/` subfolder with its own `credentials.json`/`token.json`. That split has since been merged: both pipelines now run inside this single `server.js` process, and Google OAuth is handled per-admin through the dashboard (`/admin/google/connect`) rather than a single global token file. Some artifacts of the old layout remain in `.gitignore` (`docker.yaml`, `/redesigned-bassoon`) and as standalone scripts (`generateToken.js`, `scheduler/linkedin.js`) — see [Known Issues](#22-known-issues--gaps).

---

## 4. Getting Started

**Prerequisites:** Node.js 18+, MongoDB, Redis, an OpenAI API key, a SendGrid account, a Twilio account, a Google Cloud project with the Gmail API + Calendar API enabled, and a LinkedIn account to connect.

```bash
# Install dependencies
npm install

# Install Playwright's browser binaries (first run only)
npx playwright install chromium

# Start MongoDB + Redis (or point at your own instances)
docker compose up -d redis   # if you only want Redis locally

# Configure environment
# create a .env file in the project root — see Section 5 for the full variable list

# Start the server (production)
npm start

# Start the server with auto-reload (development)
npm run dev
```

Open `http://localhost:3000/HomePage` to see the public landing page, or go straight to `http://localhost:3000/admin/signup` to create the first admin account.

**First-time setup checklist:**

- [ ] `.env` populated with all required variables (Section 5)
- [ ] MongoDB and Redis reachable
- [ ] Admin account created and verified via OTP (email or SMS)
- [ ] Google account connected from the dashboard (`/admin/google/connect`) — this is what powers both candidate screening and calendar booking
- [ ] LinkedIn account connected from the dashboard (captures a Playwright session)
- [ ] `credentials.json` (Google Cloud OAuth client) present in the project root

---

## 5. Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development              # Set to "production" for headless Playwright + Docker

# Database & Cache
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/hireflow
REDIS_URL=redis://redis:6379      # Defaults to redis://redis:6379 if unset

# Session & JWT
SECRET_KEY=min-32-char-random-string        # express-session secret
JWT_ADMIN_SECRET=min-32-char-random-string  # signs the admin_jwt cookie
JWT_EXPIRES_IN=1h

# OpenAI (used for post formatting AND reply parsing)
OPEN_AI_API_KEY=sk-...
OPENAI_API_KEY=sk-...              # aiService.js checks this name too — set both to be safe

# SendGrid (email OTP during signup)
SG_KEY=SG.xxxxx

# Twilio (SMS OTP during signup — numbers are sent with a +91 prefix)
TWILIO_ID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NO=+15735944281

# Google OAuth (Gmail + Calendar) — client id/secret can come from credentials.json instead
GOOGLE_CALLBACK_URL=http://localhost:3000/admin/google/callback
CLIENT_ID=...
CLIENT_SECRET=...

# Recruiting pipeline
BOOKING_LINK=https://calendly.com/your-link
INTERVIEW_ATTENDEES=recruiter@company.com,hiring@company.com   # optional, comma-separated
CALENDAR_TIMEZONE=America/Chicago                              # optional, defaults shown

# Browser automation session capture (used by the postlinkedin route)
BROWSERBASE_API_KEY=...            # see Known Issues — this dependency is not currently installed
```

> **Never commit `.env`, `credentials.json`, `token.json`, or `adminauth.json`.** Together they grant full access to your database, AI provider, email/SMS senders, Gmail inbox, calendar, and LinkedIn account.

---

## 6. Application Entry Point (`server.js`)

Boot sequence:

1. Configures `body-parser`, `cookie-parser`, and a single global `multer` disk-storage upload handler (accepts `image/png`, `image/jpg`, `image/jpeg` only) writing to `/images`.
2. Serves `/images` and `/content` as static directories (created on boot if missing).
3. Configures `express-session` (7.5-minute cookie `maxAge`, `httpOnly`, `sameSite: strict`).
4. Sets EJS as the view engine, `views/` as the template directory.
5. Mounts all routes from `routes/admin.js`.
6. Connects to MongoDB (`util/db.js`). Only once the connection succeeds does it:
   - Start the LinkedIn posting loop: `setInterval(postToLinkedin, 60000)`
   - `require('./scheduler/emailScanner')` — registers its own `node-cron` job on import
   - `require('./scheduler/replyProcessor')` — registers its own `node-cron` job on import
   - Start listening on `PORT` (default `3000`)
7. If the DB connection fails, the process logs the error and exits (`process.exit(1)`).

---

## 7. Database Models

### `adminmodel` — Admin Accounts
```
Collection: adminmodels
adminName  String   required             Login identifier
password   String   required            bcrypt hash (salt rounds: 12)
email      String   required
phone      String   required, unique
image      String   required            Path to /images/<filename>
```

### `contentmodel` — Scheduled Post Queue
One document per admin (`findOneAndUpdate` with `upsert`). Each entry pushed into `contentSchedule` is a pending post.
```
Collection: contentmodels
adminId          ObjectId   ref → adminmodel, required
adminName        String     required
contentSchedule  Array      required — [[content: String, scheduledAt: Date], ...]
image            String     Path to /content/<filename>
```
Entries are removed from the array (`$pull`) once the scheduler has finished posting them.

### `linkedinauth` — LinkedIn Browser Session
```
Collection: linkedinauths
adminId          ObjectId   ref → adminmodel, required
adminName        String     required
AdminSessionInfo Mixed      required — Playwright storageState: { cookies, origins, localStorage }
```
Upserted every time an admin (re)connects their LinkedIn account. Reused by the posting scheduler to skip the login step entirely.

### `AdminGoogleAuth` — Google OAuth Tokens
```
Collection: admingoogleauths
adminId   ObjectId   ref → adminmodel, required, unique
email     String     — the Gmail address that was connected
tokens    Object     — access_token, refresh_token, expiry_date, etc.
```
Created/updated by the `/admin/google/callback` route, and silently refreshed in place whenever the Google client library issues new tokens (both cron jobs listen for a `tokens` event and merge+persist them).

### `Candidate` — Applicant Records
```
Collection: candidates
adminId       ObjectId   ref → adminmodel — scopes candidates to the recruiter who owns the inbox
name          String     Parsed from the questionnaire reply
email         String     Applicant's email address
location      String     Parsed current location
visaStatus    String     Parsed & normalized visa status
usArrivalDate String     Parsed US arrival date
qualified     Boolean    Result of the qualification engine
stage         String     SCREENING_SENT | NEEDS_REVIEW | BOOKING_SENT | REJECTED
threadId      String     Gmail thread ID — prevents re-screening the same conversation
createdAt     Date       default: Date.now
```

### `ProcessedEmail` — Deduplication Log
```
Collection: processedemails
adminId      ObjectId   required, indexed
messageId    String     required
processedAt  Date       default: Date.now
```
Compound unique index on `(adminId, messageId)`. Both the scanner and the reply processor check this collection before acting on any email, and record every email they touch — this is what stops the same message from ever triggering a duplicate questionnaire or a duplicate reply.

### `Post` — Legacy (Unused)
An earlier, simpler schema (`content`, `posted`, `postedAt`) referenced only by `controllers/posts.js`'s landing-page query. Not used by the active scheduler.

---

## 8. Routes

#### Public
| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/` | `admin.getLocal` | Redirects to `/HomePage` |
| `GET` | `/HomePage` | `admin.getHomepage` | Public marketing homepage |
| `GET` | `/admin/welcome` | `admin.getwelcomeAdmin` | Welcome/landing screen for admins |

#### Admin Registration & Login
| Method | Path | Handler | Auth |
|--------|------|---------|------|
| `GET` | `/admin/signup` | `admin.getAdminSignup` | None |
| `POST` | `/admin/signup` | `admin.postAdminSignup` | None — sends OTP via Email or SMS |
| `GET` | `/admin/verify/otp` | `admin.getverifyotp` | Session token from signup |
| `POST` | `/admin/verify/otp` | `admin.postverifyotp` | Session token — max 3 attempts |
| `GET` | `/admin/profileCreation` | `admin.getprofileCreation` | Session token |
| `POST` | `/admin/profileCreation` | `admin.postprofileCreation` | Session token — creates the account |
| `GET` | `/admin/signin` | `admin.getAdminSignin` | None |
| `POST` | `/admin/signin` | `admin.postAdminSingin` | None — verifies credentials, issues session + JWT cookie |

#### Admin Dashboard (JWT-protected: `verifyJwt` → `isAuthenticated`)
| Method | Path | Handler | Description |
|--------|------|---------|--------------|
| `GET` | `/admin/:username` | `admin.getAdminDashboard` | Renders the combined dashboard (posts, LinkedIn, RecruiterOS stats, candidates, activity) |
| `POST` | `/admin/:username` | `admin.postAdminDashboard` | Schedules a new LinkedIn post (content + date/time + image) |
| `POST` | `/admin/linkedin` | `admin.postlinkedin` | Captures/refreshes the admin's LinkedIn browser session |
| `GET` | `/admin/google/connect` | `admin.getGoogleConnect` | Starts the Google OAuth consent flow (Gmail + Calendar scopes) |
| `GET` | `/admin/google/callback` | `admin.getGoogleCallback` | OAuth callback — exchanges code for tokens, stores them, redirects back to the dashboard |

> `/admin/google/callback` is intentionally reachable without the JWT/session middleware, since the browser arrives there fresh from Google's redirect; it instead trusts the `state` query parameter (the admin's Mongo `_id`) that was passed into `generateAuthUrl`.

#### Unimplemented
`routes/superadmin.js` and `controllers/superadmin.js` are present but empty — a superadmin role is planned (see [Roadmap](#24-roadmap)) but not wired up to any route logic yet.

---

## 9. Admin Authentication System

### Registration
```
POST /admin/signup
  └── Admin submits name, email, phone, and an OTP delivery method (Email or SMS)
  └── Server generates a 6-digit numeric OTP
      ├── Hashes it with bcryptjs
      └── Stores it in Redis, keyed by a random session token (crypto.randomUUID):
            { name, email, phone, savedOtp, attemptsleft: 3, timeStamp }
          TTL is set to 300 seconds only after the OTP is successfully dispatched
  └── Email path  → sent via SendGrid SMTP relay (smtp.sendgrid.net:587)
  └── SMS path    → sent via Twilio, phone number prefixed with +91
  └── Redirects to /admin/verify/otp

POST /admin/verify/otp
  └── Looks up the Redis hash by the session token
  └── bcrypt.compare(submitted OTP, stored hash)
  └── Wrong OTP  → decrements attemptsleft; at 0 the Redis key is deleted and the request is rejected (403)
  └── Correct OTP → deletes the Redis key, copies { name, email, phone } into the session,
                     redirects to /admin/profileCreation

POST /admin/profileCreation
  └── multer saves the uploaded profile photo to /images/
  └── Uniqueness check against adminName, email, and phone
  └── bcrypt.hash(password, 12)
  └── Creates the adminmodel document
  └── Redirects to /admin/signin
```

### Login
```
POST /admin/signin
  └── Looks up the admin by adminName, then re-checks the submitted email against the stored one
  └── bcrypt.compare(password, stored hash)
  └── On success:
      ├── req.session.regenerate()   — issues a fresh session ID, preventing session fixation
      ├── Session is populated: { isLoggedIn, admin, adminEmail, adminName, photo, number }
      ├── A JWT is signed: { adminId, admin, role: "admin" }
      └── Sets the admin_jwt cookie (httpOnly, sameSite: strict, 1h maxAge)
      └── Redirects to /admin/:username
```

| Cookie property | Value |
|------------------|-------|
| Name | `admin_jwt` |
| `httpOnly` | `true` |
| `sameSite` | `strict` |
| `secure` | `false` (should be `true` behind HTTPS in production) |
| Expiry | 1 hour (hardcoded `maxAge`, independent of `JWT_EXPIRES_IN`) |

### Protected-route middleware chain
```
Request → verifyJwt() → isAuthenticated() → Controller
```
- **`verifyJwt`** — reads the `admin_jwt` cookie, verifies it with `JWT_ADMIN_SECRET`, and if the role is `"admin"` copies `{ username, adminId, role, isLoggedIn }` onto `req.session`.
- **`isAuthenticated`** — checks `req.session.isLoggedIn && req.session.role === "admin"`; otherwise responds `403`.

---

## 10. Admin Dashboard

`GET /admin/:username` calls `getCombinedDashboardData(adminId)`, which fans out to Mongo in parallel (`Promise.all`) to build a single-page snapshot of the entire pipeline:

**Post-scheduling stats**
- `postsScheduled` — total entries in the admin's `contentSchedule`
- `postsDue` — entries whose `scheduledAt` has already passed but haven't posted yet

**Candidate pipeline stats** (queried directly against the `candidates` collection, scoped by `adminId`)
- `resumesReceived` — total candidates ever created
- `responsesSent` — sum of all non-initial stages (screening sent + booked + rejected + needs review)
- `meetingsBooked` — count with `stage: BOOKING_SENT`
- `needsReview` — count with `stage: NEEDS_REVIEW`
- `rejected` — count with `stage: REJECTED`
- `processedEmails` / `processedToday` — global counts from `processedemails` (not admin-scoped)

**Integration status**
- `linkedin.connected` — whether a `linkedinauth` document with session data exists
- `recruiteros.gmailConnected` / `gmailEmail` — whether `AdminGoogleAuth` exists, and which address is connected
- `recruiteros.bookingConfigured` — whether `BOOKING_LINK` is set in the environment
- `recruiteros.scannerCadence` — hardcoded display string, `"Every 2 min"`

**Recent activity** — the 6 most-recently-created candidates, projected down to name/email/location/visa/qualified/stage/createdAt, and rendered as a human-readable activity feed (e.g. "10:42 AM — Jane Doe — booking sent — jane@example.com").

If any query in `getCombinedDashboardData` throws, the whole function falls back to a zeroed-out "empty" object rather than letting the dashboard render fail entirely.

The dashboard view (`views/adminDashboard.ejs`) also hosts the **post-scheduling form** (content textarea + date/time pickers + image upload → `POST /admin/:username`), a **"Connect LinkedIn"** action (→ `POST /admin/linkedin`), and a **"Connect Google"** action (→ `GET /admin/google/connect`).

---

## 11. Google OAuth (Gmail + Calendar)

`config/google.js` builds an OAuth2 client per-request:

- It first tries to read `client_id`/`client_secret` out of `credentials.json` (Google Cloud "OAuth client" download, either the `installed` or `web` shape).
- If that file is missing/unreadable, it falls back to `CLIENT_ID`/`CLIENT_SECRET` environment variables.
- The redirect URI always comes from `GOOGLE_CALLBACK_URL` (default `http://localhost:3000/admin/google/callback`).

**Connect flow**, triggered from the dashboard:
```
GET /admin/google/connect  (JWT + session protected)
  └── Builds an OAuth2 client, generates a consent URL requesting:
        gmail.modify, calendar, userinfo.email
      access_type=offline + prompt=consent (guarantees a refresh_token)
      state = the admin's Mongo _id
  └── Redirects the browser to Google

GET /admin/google/callback  (public — relies on the `state` param instead of session middleware)
  └── Exchanges the authorization `code` for tokens
  └── Fetches the connected account's email via the userinfo endpoint
  └── Upserts an AdminGoogleAuth document: { adminId, email, tokens }
  └── Redirects to /admin/<adminName>
```

Once connected, `scheduler/emailScanner.js` and `scheduler/replyProcessor.js` iterate every `AdminGoogleAuth` document on each cron tick, build a fresh OAuth2 client from the stored tokens, and register a `tokens` event listener so that any silently-refreshed access token is written straight back to Mongo — the admin never has to reconnect unless the refresh token itself is revoked.

---

## 12. LinkedIn Autoposting Pipeline

Hireflow does not use LinkedIn's official API for posting — it drives a real Chromium browser with Playwright, using a previously captured, persisted login session, exactly the way a human would.

### Connecting an account — `POST /admin/linkedin`
The current implementation (`controllers/admin.js#postlinkedin`) creates a [Browserbase](https://www.browserbase.com/) remote session (proxied, captcha-solving, session-recording) *and* separately launches a local headless Chromium instance that navigates to `https://linkedin.com/login` and waits (up to 300 seconds) for the URL to become the LinkedIn feed — implying a human completes the login in that window. Once redirected, it captures `page.context().storageState()` (cookies + localStorage + origins) and upserts it into the `linkedinauth` collection for that admin.

> See [Known Issues](#22-known-issues--gaps) — the `browserbase` package this route imports is not currently declared in `package.json` or installed, and a headless browser cannot present a login form for a human to complete, so this route needs attention before it will work end-to-end.

### Automated posting — driven by `scheduler/cron.js`, called every 60 seconds from `server.js`
```
postToLinkedin()
  └── Fetch every contentmodel document (i.e., every admin with scheduled posts)

  For each admin:
    └── Load their LinkedIn session from linkedinauth — skip the admin entirely if missing
    └── Load their connected Google email from AdminGoogleAuth — skip if missing
        (used as the "send your resume to" address embedded in the generated post)

    For each [content, scheduledAt] entry in contentSchedule:
      └── Skip if scheduledAt is still in the future
      └── getPolishedPosts(content, resumeEmail) → one or more AI-formatted posts
      └── Shuffle the resulting posts into a random order
      For each post:
        └── fetchandpost(post, credentials)
              1. Launch Chromium (headless: false in the current code)
              2. Restore the LinkedIn session: browser.newContext({ storageState: credentials })
              3. Navigate to linkedin.com/feed, wait 4s
              4. Click "Start a post"
              5. Fill the post textbox, wait 2s
              6. Verify the Post button is enabled, click it, wait 5s
              7. Close the browser
      └── Remove ($pull) the completed entry from contentSchedule
```
Errors are caught per-admin and per-post — one admin's LinkedIn session expiring, or one post failing, does not stop the loop from processing everyone else.

`scheduler/linkedin.js` is an older, simpler standalone poster kept in the repo for reference — it reads a local `auth.json` file directly instead of a database-backed session, and is not wired into `server.js`'s scheduler loop.

Session validity is typically 30–90 days; when it expires the admin just reconnects from the dashboard.

---

## 13. AI Content Formatting (Job Posts)

`getPolishedPosts(content, resumeEmail)` in `scheduler/cron.js` sends the admin's raw job description to `gpt-3.5-turbo` in JSON mode, with:

- A **hardcoded reference example** post (a "Cybersecurity Analyst" listing) demonstrating the desired tone and structure.
- A **strict template** the model must follow: `[Job Title] | [City, State]`, a one/two-sentence hook, 2–3 bullet responsibilities, a "send your resume to `<resumeEmail>`" line, an "H1B visa sponsorship available" line, and hashtags for job title / city / employment type / `#Hiring`.
- Explicit anti-hallucination instructions — only use information present in the source text.

The model is asked to return `{ "posts": ["...", "..."] }` — one formatted post per job posting detected in the input. If the response can't be parsed as JSON or is missing the `posts` array, the function logs the error and returns an empty array (the scheduler then skips that entry for this tick and retries on the next one, since the source entry isn't removed from `contentSchedule` until a post is actually attempted).

`controllers/posts.js` also exposes a second, simpler `generateposts(input)` helper using the same system prompt style, used by the public landing-page controller.

---

## 14. Email Scanner (Candidate Intake)

**File:** `scheduler/emailScanner.js` — registered via `node-cron.schedule('*/2 * * * *')`, guarded by an `isRunning` flag so overlapping ticks are skipped rather than run concurrently.

For every connected admin (`AdminGoogleAuth.find()`), it fetches up to 50 unread inbox messages (Gmail query excludes spam/trash/sent and several system senders) and, for each one:

| Filter | Skips the email if... |
|--------|------------------------|
| System sender | The `From` address contains any of: `no-reply`, `noreply`, `mailer-daemon`, `postmaster`, `google`, `pinterest`, `groww`, `unstop`, `naukri`, `linkedin`, `notifications` |
| Self-sent | The `From` address matches the admin's own connected Gmail address |
| Already processed | The message ID is already recorded in `ProcessedEmail` for this admin |
| Awaiting screening reply | The sender already has a `Candidate` record with `stage: SCREENING_SENT` (avoids re-screening someone mid-conversation) |
| Not application-shaped | Subject and body contain none of: `resume`, `application`, `applying`, `apply`, `job`, `developer`, `engineer`, `experience`, `internship`, `portfolio`, `cv`, `position`, `opportunity`, `candidate`, `skills` |
| Already screened (by thread) | A `Candidate` already exists for this Gmail `threadId` |

If none of those filters trip, the scanner:
1. Sends a plain-text screening questionnaire to the sender, asking for full name, current location, visa status, US arrival date, and interest in marketing services.
2. Creates a `Candidate` document: `{ adminId, email, stage: 'SCREENING_SENT', threadId }`.
3. Marks the original email as read and records it in `ProcessedEmail`.

Every branch — matched or filtered out — ends by marking the message read and logging it to `ProcessedEmail`, except the "awaiting reply" branch, which deliberately leaves the message unread/unprocessed so the reply processor (not the scanner) picks it up next.

---

## 15. Reply Processor (Screening & Qualification)

**File:** `scheduler/replyProcessor.js` — same `*/2 * * * *` schedule and `isRunning` guard as the scanner, running as an independent cron job.

For each connected admin, it scans unread mail again and, per email:

1. Skips system senders / self-sent mail (same pattern list as the scanner, plus a couple of additional platform domains).
2. Skips unless the sender currently has a `Candidate` with `stage: SCREENING_SENT`.
3. Skips unless the email body contains at least one screening-reply keyword: `visa`, `opt`, `cpt`, `stem`, `f1`, `h1b`, `h-1b`, `green card`, `citizen`, `location`, `state`, `city`, `marketing`, `arrival`, `came to`, `full name`, `name:`, `looking for`.
4. Calls `parseCandidateReply(body)` (see next section) to extract structured fields.
5. **Missing critical data** (`location` or `visa_status` absent) → `stage: NEEDS_REVIEW`, no email sent, flagged for a human.
6. Otherwise runs `qualifies(parsed)`:
   - **Pass** → sends an "Interview Booking" email containing `BOOKING_LINK`; sets `qualified: true`, `stage: BOOKING_SENT`.
   - **Fail** → no email sent (silent rejection); sets `qualified: false`, `stage: REJECTED`.
7. Marks the email read and records it in `ProcessedEmail` in every case (including on a caught per-item error, so a single malformed email can't jam the queue).

```
Candidate emails a resume
        │  [emailScanner, every 2 min]
        ▼
  stage: SCREENING_SENT  ← questionnaire sent
        │  [replyProcessor, every 2 min, on reply]
        ▼
  AI parses the reply → qualification rules applied
        │
        ├── ALL PASS ─────► stage: BOOKING_SENT   (booking link emailed)
        ├── ANY FAIL ─────► stage: REJECTED       (silent, no email)
        └── DATA MISSING ─► stage: NEEDS_REVIEW    (manual follow-up)
```

> Note: `services/gmailService.js` implements `createInterview()` (a Google Calendar event creator), but `replyProcessor.js` does not currently call it after sending the booking email — booking today is a link the candidate self-schedules through, not an automatically created calendar invite. See [Known Issues](#22-known-issues--gaps).

---

## 16. AI Reply Parsing Service

**File:** `services/aiService.js` — exports `parseCandidateReply(text)`.

**Pre-processing** (`normalizeReplyText`):
1. Normalizes line endings (`\r\n` → `\n`).
2. Truncates at the first sign of quoted/forwarded content — looks for `\nOn `, `\nFrom:`, `\n-----Original Message-----`, `\n---\n`, or a long underscore separator, and cuts everything from there onward.
3. Strips any remaining lines that start with `>` (inline quote markers).

**Length guard:** `truncateForOpenAI` trims to the last 12,000 characters if the cleaned text is longer (keeping the most recent content, which is usually the candidate's own reply rather than older quoted history).

**Primary path — OpenAI:** Sends the cleaned text to `gpt-3.5-turbo` (checks `OPENAI_API_KEY`, then falls back to `OPEN_AI_API_KEY`) with a system prompt instructing it to return raw JSON matching:
```json
{ "full_name": "", "location": "", "visa_status": "", "arrival_date": "", "marketing_services": "" }
```
Visa statuses are explicitly normalized by the prompt (`stem opt` → `STEM-OPT`, `f1 opt` → `F1-OPT`, `initial opt` → `INITIAL-OPT`, `cpt` → `CPT`). Any missing field is `null`. The raw response has stray markdown fences stripped before `JSON.parse`.

**Fallback path — regex heuristics:** If no API key is configured, or the OpenAI call throws or returns something unparsable, `heuristicParseCandidateReply` takes over:
- Extracts labeled fields (`Full Name:`, `Current Location:`, etc.) via regex lookahead to the next label or blank line.
- Matches visa status against a fixed list of substrings (`stem opt`, `f1 opt`, `initial opt`, `cpt`, `opt`, `f1`, `h1b`, `green card`, `citizen`) — first match wins.
- Matches `marketing.*?(yes|no|not interested|nope|never|looking)` to infer interest.

Either path returns the same four-and-a-bit-field JSON shape, so `replyProcessor.js` never needs to know which parser actually ran.

---

## 17. Qualification Rules Engine

**File:** `services/qualificationService.js` — exports `qualifies(candidate)`, a pure function with no side effects besides console logging (useful for auditing why a candidate passed or failed).

All three conditions must hold:

| Rule | Passes when `visa_status` / `location` / `marketing_services`... |
|------|---------------------------------------------------------------|
| Valid visa | ...contains `opt`, `stem`, or `cpt` (case-insensitive substring match) |
| Location not blocked | ...does **not** contain `india`, `pakistan`, `bangladesh`, `nepal`, `sri lanka`, or `remote india` |
| Interested in marketing | ...equals exactly `"yes"` (case-insensitive) |

```js
qualified = validVisa && !blockedLocation && (marketing === "yes")
```

This is a hard, deterministic gate — there is no partial credit or scoring; a single failed rule rejects the candidate regardless of the other two.

---

## 18. Gmail/Calendar Service Wrapper

**File:** `services/gmailService.js` — `createGmailService(auth)` wraps an authenticated `googleapis` client into five functions:

| Function | Underlying API call | Behavior |
|----------|---------------------|----------|
| `getUnreadEmails()` | `gmail.users.messages.list` | Up to 50 unread inbox messages, excluding spam/trash/sent and a few system senders (query-level filter, in addition to the code-level filters in the scanner/processor) |
| `getMessage(id)` | `gmail.users.messages.get` | Full message, including headers and body (used to extract `From`, `Subject`, and decode base64url body parts, recursing into multipart MIME trees to prefer `text/plain`) |
| `sendEmail(to, subject, body)` | `gmail.users.messages.send` | Builds a raw RFC-2822 message from `EMAIL_USER`/the connected account and base64url-encodes it |
| `markAsRead(id)` | `gmail.users.messages.modify` | Removes the `UNREAD` label |
| `createInterview(candidate)` | `calendar.events.insert` | Creates a 30-minute Google Meet event starting 24 hours from now, with the candidate plus `INTERVIEW_ATTENDEES` invited — **currently unused by the reply processor** (see Known Issues) |

OAuth scopes requested when connecting: `gmail.modify`, `calendar`, `userinfo.email`.

---

## 19. Views & UI

All views are server-rendered EJS, styled with Tailwind CSS, Font Awesome 6, and Google Fonts (Inter, Space Grotesk, JetBrains Mono) loaded via CDN — there is no client-side build step.

| File | Route | Purpose |
|------|-------|---------|
| `land.ejs` | (unused directly; referenced by `controllers/posts.js`) | Landing page variant |
| `Homepage.ejs` | `GET /HomePage` | Public marketing homepage |
| `adminHome.ejs` | `GET /admin/welcome` | Admin welcome screen |
| `adminSignup.ejs` | `GET /admin/signup` | Registration form (name, email, phone, OTP method) |
| `verifyOtp.ejs` | `GET /admin/verify/otp` | 6-digit OTP entry |
| `AdminProfile.ejs` | `GET /admin/profileCreation` | Profile photo + password form |
| `adminSignin.ejs` | `GET /admin/signin` | Login form |
| `adminDashboard.ejs` | `GET /admin/:username` | Main control panel: greeting header, connection-status pills, combined pipeline stats, post-scheduling form, LinkedIn panel, RecruiterOS panel, recent-candidates table, activity feed |
| `editDb.ejs` | (internal/debug) | Ad-hoc data view, not linked from the main navigation |
| `superAdmin.ejs` | (unwired) | Placeholder for the planned superadmin role |

---

## 20. Docker & Deployment

`Dockerfile` builds on `node:20-slim` and additionally installs `xvfb`, `x11vnc`, `novnc`, `websockify`, and `chromium` plus the shared libraries Chromium needs headlessly (`libnss3`, `libatk*`, `libgbm1`, etc.) — this stack exists specifically so Playwright's `headless: false` browser launches (used by both the LinkedIn connect flow and `fetchandpost`) can still run inside a container, rendering to a virtual X display that's exposed over VNC/noVNC rather than crashing for lack of a real display.

`entrypoint.sh`:
```bash
Xvfb :99 -screen 0 1280x800x24 -ac &      # virtual framebuffer display :99
x11vnc -display :99 -forever -nopw -shared -rfbport 5900 &   # VNC server on 5900
websockify --web=/usr/share/novnc/6080 localhost:5900 &        # noVNC web bridge on 6080
export DISPLAY=:99
exec node server.js
```
This means an operator can open a noVNC web client against port `6080` and **watch (or manually complete) the LinkedIn login** happening inside the container in real time — relevant given `postlinkedin` currently expects a human to complete a login screen.

`docker-compose.yaml` runs the app plus a Redis instance with an `appendonly` (AOF) persistent volume:
```bash
docker compose up -d          # start app + redis
docker compose down           # stop
docker compose logs -f        # tail logs
```
The compose file maps the container's port 3000 to host port 80, sets `NODE_ENV=production` and `REDIS_URL` for you, and leaves Mongo external (bring your own `MONGODB_URI`, e.g. Atlas) — note the `env_file` line for `.env` is currently commented out, so environment variables other than the three hardcoded ones must be supplied another way (e.g. `docker compose run -e` or uncommenting that line) before the compose stack will have API keys, JWT secrets, etc.

---

## 21. Testing

`test/example.specs.ts` plus `playwright.config.ts` scaffold Playwright-based end-to-end tests (the config/spec file are currently placeholders/near-empty — this is a starting point, not a populated suite yet).

```bash
npx playwright test
```

The `npm test` script in `package.json` is still the default CRA-style placeholder (`echo "Error: no test specified" && exit 1`) and does not run the Playwright suite.

---

## 22. Known Issues & Gaps

| Issue | Location | Notes / Suggested Fix |
|-------|----------|------------------------|
| `browserbase` package used but not installed | `controllers/admin.js` (`postlinkedin`) | Not present in `package.json` dependencies or `node_modules` — this route will throw on `require('browserbase')` until it's added (`npm install browserbase`) or the code path is removed |
| Headless Chromium can't complete a human LinkedIn login | `controllers/admin.js` (`postlinkedin`) | Launches with `headless: true` while relying on a human to type credentials/solve 2FA into a window that isn't rendered anywhere accessible; likely needs `headless: false` funneled through the Xvfb/noVNC setup like `fetchandpost` does, or to be driven entirely through the Browserbase remote session instead |
| `fetchandpost` always launches non-headless | `scheduler/cron.js` | Hardcoded `headless: false` — fine under the Xvfb/noVNC Docker setup, but will fail on any host without a display server if run outside that container |
| Fixed `waitForTimeout()` delays are fragile | `scheduler/cron.js`, `scheduler/linkedin.js` | Timing-based waits break if LinkedIn's UI is slow or changes; prefer `waitForSelector()` |
| LinkedIn selectors will break on UI changes | `scheduler/cron.js`, `scheduler/linkedin.js` | `getByText('Start a post')` and friends are brittle — monitor and update as LinkedIn ships redesigns |
| `scheduler/linkedin.js` is dead/duplicate code | `scheduler/linkedin.js` | Reads a local `auth.json` (not DB-backed), isn't required anywhere in `server.js`; either wire it in or remove it |
| `createInterview()` is unused | `services/gmailService.js`, `scheduler/replyProcessor.js` | A qualified candidate gets an email with `BOOKING_LINK` but no calendar event is auto-created; wire it up after the booking email if that's the intended flow |
| `ProcessedEmail` grows unbounded | `models/ProcessedEmail.js` | No TTL index — add one (e.g. 90 days) if inbox volume is high |
| Superadmin role unimplemented | `routes/superadmin.js`, `controllers/superadmin.js` | Both files are effectively empty placeholders |
| `.gitignore` references stale paths | `.gitignore` | Still lists `docker.yaml` and `/redesigned-bassoon`, both renamed/merged away — `docker-compose.yaml` is the current filename and isn't ignored |
| No `.env.example` checked in | repo root | New setups have to reconstruct the variable list from this README rather than copying a template |
| Scheduler polls every 60s regardless of workload | `server.js` | A fixed `setInterval` — switching to `node-cron` with a real schedule (like the other two jobs) would make the cadence configurable and consistent |
| Resume email uses whatever Google account is connected | `scheduler/cron.js` | The "send resume to" address in generated posts is the admin's connected Gmail address; if Google isn't connected yet, that admin's due posts are silently skipped every tick until they connect |
| `docker-compose.yaml`'s `env_file` is commented out | `docker-compose.yaml` | Only `NODE_ENV`, `PORT`, and `REDIS_URL` are actually passed to the container as written; every other secret needs another delivery mechanism |

---

## 23. Security Notes

### Strengths
- Passwords hashed with bcryptjs (salt rounds: 12).
- JWT cookie is `httpOnly` and `sameSite: strict`.
- Session is regenerated on login (`req.session.regenerate`), preventing session fixation.
- Signup OTPs expire after 5 minutes (Redis TTL) and are hashed at rest, not stored in plaintext.
- OTP brute-force is capped at 3 attempts before the Redis record is deleted.
- Google OAuth uses `access_type: offline` + `prompt: consent` to reliably obtain (and persist) refresh tokens rather than re-prompting admins.
- `ProcessedEmail`'s compound unique index prevents replay/duplicate-processing of the same message.

### Gaps & Recommended Fixes
| Risk | Location | Fix |
|------|----------|-----|
| No CSRF protection | All state-changing admin forms | Add CSRF middleware (e.g. `csrf-csrf`) |
| No rate limiting on login/OTP/signup | `routes/admin.js` | Add `express-rate-limit` |
| No input sanitization in rendered views | `views/*.ejs` | Add `xss`/`DOMPurify` on any user-supplied content rendered back into HTML |
| Redis has no password in local/default setup | `docker-compose.yaml` | Set `requirepass` and pass credentials via `REDIS_URL` |
| Express sessions are stored in memory by default | `server.js` | Use a shared store (e.g. `connect-mongo` or `connect-redis`) so sessions survive restarts and scale across instances |
| `admin_jwt` cookie `secure` is hardcoded `false` | `controllers/admin.js` | Set based on `NODE_ENV`/HTTPS so the cookie isn't sent over plaintext in production |
| `/admin/google/callback` trusts a client-supplied `state` value | `controllers/admin.js` | `state` should be a signed/opaque value tied to the session, not just the raw admin ID, to fully prevent OAuth callback tampering |
| `token.json` / `credentials.json` / `adminauth.json` must never be committed | repo root | Already `.gitignore`d — rotate immediately if any of them are ever exposed |

> **Always run this app behind HTTPS in production.** LinkedIn session cookies and Gmail/Calendar OAuth tokens transmitted over plain HTTP are trivially interceptable.

---

## 24. Roadmap

- [ ] Fix or remove the Browserbase-based LinkedIn connect flow (missing dependency, headless/human-login mismatch)
- [ ] Wire `createInterview()` into the reply processor so qualified candidates get an auto-created calendar event, not just a link
- [ ] Add a TTL index to `ProcessedEmail`
- [ ] Implement (or remove) the superadmin role and its placeholder routes/views
- [ ] Replace fixed Playwright timeouts with selector-based waits
- [ ] Move the LinkedIn posting loop from `setInterval` to `node-cron` for consistency with the other two schedulers
- [ ] Edit/cancel a scheduled post before it publishes
- [ ] Notify the admin by email when a scheduled post fails or a candidate is booked
- [ ] Support attaching the uploaded post image to the actual LinkedIn post (currently uploaded/stored but not attached by `fetchandpost`)
- [ ] Bulk CSV upload for scheduling multiple posts at once
- [ ] Session-expiry alerts prompting the admin to reconnect LinkedIn or Google before a pipeline silently stalls
- [ ] Ship a populated Playwright test suite (`test/example.specs.ts` is currently a placeholder)
- [ ] Check in a `.env.example` template

---

*Hireflow — Post the job. Screen the candidates. Book the meetings. Automatically.*
