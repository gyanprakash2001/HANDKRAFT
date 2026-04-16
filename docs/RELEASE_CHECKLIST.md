# HANDKRAFT APK Release Checklist

Use this checklist for every APK release.

## 1) One-time setup

### Generate a production upload keystore
Run this from your machine:

```bash
keytool -genkeypair -v \
  -storetype JKS \
  -keystore handkraft-upload-key.jks \
  -alias handkraft-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

### Convert keystore to base64 for GitHub secret

```bash
base64 -w 0 handkraft-upload-key.jks > handkraft-upload-key.base64
```

On PowerShell (Windows):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("handkraft-upload-key.jks")) | Set-Content handkraft-upload-key.base64
```

### Configure repository secrets
In GitHub repository settings, add:
- ANDROID_KEYSTORE_BASE64
- ANDROID_KEYSTORE_PASSWORD
- ANDROID_KEY_ALIAS
- ANDROID_KEY_PASSWORD
- EXPO_PUBLIC_API_URL

Set `EXPO_PUBLIC_API_URL` to your production backend API URL, for example:

```text
https://<your-app-name>.azurewebsites.net/api
```

## 2) Update app version

- Update mobile/app.json expo.version for user-facing version.
- Update mobile/app.json expo.android.versionCode for each production release (must always increase).

## 3) Create and publish release tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

The Build and Release Android APK workflow will:
- Build a signed release APK.
- Generate SHA-256 checksum.
- Publish GitHub Release with notes and APK asset.

## 4) Verify release outcome
- Confirm workflow run success in GitHub Actions.
- Confirm GitHub Release contains:
  - app-release.apk
  - app-release.apk.sha256
- Confirm docs landing page shows latest release and download button.

## 5) Beta release pattern
Use beta tags for pre-production builds:
- v1.2.0-beta.1
- v1.2.0-beta.2

Beta tags are marked as pre-release automatically.

## 6) Rollback strategy
- Keep previous stable release tag available.
- If latest release fails, re-promote previous stable release in release notes and landing page copy.
