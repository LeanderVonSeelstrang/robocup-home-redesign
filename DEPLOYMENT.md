# Deployment

Two things ship **separately**:

| What | How | Trigger |
|------|-----|---------|
| Website (static) | GitHub Actions → GitHub Pages | automatic on push to `main` |
| Firestore rules | `firebase` CLI | **manual** (not in the pipeline) |

The emulator changes (firebase.json `emulators`, the localhost gate in both `firebase` modules, `scripts/seed-*.js`) are **localhost-only and have zero production effect** — deployed pages run against the real DB. No action needed for those.

## Release checklist

1. **Commit the regenerated lockfile.** Astro was upgraded 5 → 7; `package.json` + `package-lock.json` must be committed together — CI runs `npm ci` and fails if they drift.

2. **⚠ Grant the admin claim to every real admin — BEFORE deploying rules.** The new rules make `isAdmin()` require an `admin: true` claim. Until an account has it, it loses `teams`/`competitions` write access.
   ```bash
   cd scripts && npm install
   node set-admin-claim.js you@example.com          # repeat per admin (needs scripts/service-account.json)
   ```
   Each admin then signs out/in once to refresh their token.

3. **Deploy the Firestore rules.**
   ```bash
   firebase deploy --only firestore:rules --project robocup-home
   ```

4. **Deploy the site:** push to `main` (or merge the PR). The Pages action runs `npm ci && npm run build` automatically.

## Verify (no errors)

- Local build is green: `npm run build` (must complete; CI runs the same).
- After deploy: an **admin** can create/edit a competition; a **referee** can score runs but is blocked from editing competitions.


