# HANDKRAFT Student Pack Activation Guide (Long-Term)

This list is prioritized for long-term product growth, not just short-term experimentation.

## Activate First (P0)

### Core build and workflow
- GitHub Pro
  - Why: higher private repo capabilities and better long-term repo operations.
- GitHub Copilot Student
  - Why: premium coding help, faster refactors, release automation authoring.
- GitHub Actions (Pro quota)
  - Why: CI/CD for APK and Pages deployment.
- GitHub Codespaces
  - Why: portable development environment and contributor onboarding.

### Hosting and backend
- DigitalOcean credit (200 USD)
  - Why: predictable VPS hosting for Node/Express production backend.
- MongoDB Atlas credit (50 USD)
  - Why: managed production database and easier backup/uptime handling.

### Security and secrets
- 1Password
  - Why: secure storage for keystore passwords and production credentials.
- Doppler
  - Why: environment variable management across local, CI, and production.

### Observability
- Sentry
  - Why: crash/error tracking for mobile and backend.
- New Relic or Datadog
  - Why: API performance and uptime monitoring.

## Activate Soon (P1)

### Domain and branding
- Namecheap or Name.com domain offer
  - Why: own brand domain for app landing and trust.
- .TECH domain offer
  - Why: optional second domain for campaign/microsite.

### Test coverage
- BrowserStack and/or LambdaTest
  - Why: real-device and cross-browser validation for web and mobile web flows.

### Commerce readiness
- Stripe offer
  - Why: lower initial payment costs when web payments scale.

## Activate Later (P2)

### Team productivity and quality
- GitLens/GitKraken
  - Why: improved PR and history workflows.
- Codecov
  - Why: coverage tracking once tests are stable.
- CodeScene/DeepScan
  - Why: code health checks as codebase grows.

### Design and content
- Icons8/IconScout/Visme
  - Why: marketing and storefront visual polish.

## Optional alternatives
- Heroku credit can be used for quick prototypes, but long-term cost/performance is often better on DigitalOcean.
- Azure student credit is useful for experiments and managed services; use only if architecture needs it.

## Recommended long-term stack from Student Pack
- Backend hosting: DigitalOcean
- Database: MongoDB Atlas
- CI/CD: GitHub Actions
- Distribution: GitHub Pages + GitHub Releases
- Monitoring: Sentry + New Relic
- Secrets: 1Password + Doppler
- Testing: BrowserStack

## Cost control rules
- Add budgets and spend alerts for GitHub metered products.
- Set retention rules for Actions artifacts.
- Keep release assets tidy and remove obsolete pre-release artifacts.
- Keep cloud service free-credit usage reviewed weekly.

## Quarterly review checklist
- Are active offers still used by the team?
- Is any offer near expiration?
- Can services be consolidated to reduce cognitive overhead?
