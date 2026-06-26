# robocup-home-redesign

Website + referee tooling for the RoboCup@Home league. Static [Astro](https://astro.build) site, backed by Firebase (Firestore + Auth), deployed to GitHub Pages.

Local development runs against the **Firebase Local Emulator** — no access to the production database is required.

---

## Install

Requirements: **Node.js 24**, the **Firebase CLI**, and a **Java runtime** (the Firestore/Auth emulators need it).

```bash
# clone, then from the repo root:
npm install                      # app dependencies
npm install -g firebase-tools    # Firebase CLI (if not already installed)
```

Install a Java runtime for the emulators:

```bash
brew install --cask temurin      # macOS
sudo apt install -y default-jre  # Ubuntu / Debian
```

`scripts/` is a separate package for one-off data tasks (migration, admin-claim).
You only need its deps for those — **the emulator seed needs nothing installed**:

```bash
cd scripts && npm install        # only for migrate.js / set-admin-claim.js
```

---

## Setting up the emulator

The emulator is pinned to project `robocup-home` and runs Firestore (`:8080`), Auth (`:9099`) and a UI (`:4000`). State is saved to the git-ignored `emulator-data/` on exit and re-imported next start.

```bash
npm run emulator                 # start the emulators (leave running)
npm run seed                     # in a second terminal: load demo data + test accounts
```

`npm run seed` is dependency-free (talks to the emulators over HTTP) and resets to a known state. It creates a demo competition (`rc2027`) with teams, schedule, inspections, scored runs, and these accounts:

| Role      | Email             | Password     |
| --------- | ----------------- | ------------ |
| Referee   | `referee@local`   | `referee123` |
| Referee   | `referee2@local`  | `referee123` |
| Admin     | `admin@local`     | `admin123`   |

---

## Dev run

```bash
npm run emulator    # terminal A — emulators
npm run seed        # terminal B — once, to populate the emulator
npm run dev         # terminal C — Astro dev server
```

Open <http://localhost:4321/referee> (the referee-tool entry point). On `localhost` the app **automatically** connects to the emulator; deployed builds use the real database — there is no flag to switch.

Other scripts: `npm run build` (production build → `dist/`), `npm run preview` (serve the build).

---

## Rollout

The **site** deploys automatically: pushing to `main` runs `.github/workflows/deploy.yml` (`npm ci && npm run build`) and publishes `dist/` to GitHub Pages.

**Firestore rules deploy separately and are not in the pipeline.** Push them manually with the CLI:

```bash
firebase deploy --only firestore:rules --project robocup-home
```

⚠️ Admin access requires the `admin` custom claim. Before deploying rules, grant it to each real admin (needs `scripts/service-account.json`), or admins lose write access:

```bash
cd scripts && node set-admin-claim.js you@example.com
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full release checklist.
