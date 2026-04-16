# HANDKRAFT Week 1 Launch Plan

## Goal
Ship a reliable public download flow for Android APK releases while preparing for Play Store submission in the next phase.

## Week 1 Deliverables
- GitHub Pages site live with latest APK download button.
- GitHub tag-to-release flow that uploads signed APK assets.
- Android signing moved from debug key to secure release key flow.
- Repeatable release checklist and versioning standard documented.
- Student Pack activation completed for core infrastructure, security, and observability.

## Implementation Plan

### Day 1 - Accounts and controls
- Confirm GitHub Education status and Copilot Student activation.
- Activate GitHub Pro, Codespaces, and core Student Pack offers.
- Add spending limits for metered products (Actions/Codespaces/cloud credits).

### Day 2 - Distribution baseline
- Publish Pages landing site from docs folder.
- Add latest release auto-fetch from GitHub Releases API.
- Add install instructions and issue reporting link.

### Day 3 - Android release signing
- Generate production upload keystore.
- Store signing material in GitHub repository secrets.
- Configure Android Gradle release signing for CI and local fallback.

### Day 4 - Automated release pipeline
- Trigger release workflow from version tags (v*).
- Build signed APK in GitHub Actions.
- Upload APK and checksum to GitHub Releases.
- Enable auto-generated release notes.

### Day 5 - Validation and handoff
- Dry run with a beta tag (example: v1.0.0-beta.1).
- Verify Pages download button resolves to latest APK asset.
- Verify app install and smoke test on at least 2 Android devices.
- Freeze release checklist for future weekly releases.

## Release Versioning Standard
- Tag format: v<major>.<minor>.<patch>[-beta.<n>]
- Example stable: v1.1.0
- Example beta: v1.1.0-beta.2
- Keep Expo version in mobile/app.json aligned with stable app releases.
- Increase Android versionCode for every production build.

## Secrets Needed in GitHub
- ANDROID_KEYSTORE_BASE64
- ANDROID_KEYSTORE_PASSWORD
- ANDROID_KEY_ALIAS
- ANDROID_KEY_PASSWORD
- EXPO_PUBLIC_API_URL (example: https://<your-app-name>.azurewebsites.net/api)
- EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
- EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID

## Week 1 Done Criteria
- A user can open the Pages URL and install latest APK in less than 3 steps.
- Every release tag automatically creates a signed APK release asset.
- No release build depends on debug keystore.
- Team can execute release process from documentation without guesswork.
