# Android OAuth Client (Google) — Setup

Follow these steps to create the Android OAuth client that Google Sign-in requires for standalone/dev-client Android builds.

1) Required values (use these exactly):

- Package name: `com.handkraft`
- SHA-1 fingerprint (from the project's debug keystore):

  `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`

2) Create the OAuth client in Google Cloud Console

- Open: https://console.cloud.google.com/apis/credentials
- Click **Create Credentials → OAuth client ID**
- Choose **Android**
- Enter the package name `com.handkraft` and the SHA‑1 fingerprint above
- Create the client and copy the resulting client ID (looks like `...apps.googleusercontent.com`).

3) Add the client ID to the app and server

- Edit `mobile/.env` and set:

  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<your-android-client-id>.apps.googleusercontent.com

- If your backend verifies Android token audiences, add the same client ID to the server env (for example, `server/.env`):

  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<your-android-client-id>.apps.googleusercontent.com

Note: the server accepts multiple Google OAuth audiences. If you want the server to accept tokens from the Android client, add the same variable (or `GOOGLE_CLIENT_ID`) to `server/.env`.

4) Rebuild and test

- For the dev-client/internal APK (recommended):

```bash
cd mobile
npx eas build -p android --profile development
```

- Install the new APK on your device and run the app. Start Metro on your machine:

```bash
cd mobile
npm run start:dev-client
```

5) Notes and alternatives

- If you used an EAS-managed keystore (production or custom), the signing SHA-1 may differ from the local debug keystore. To get the SHA-1 for the keystore used by EAS:

  - Visit https://expo.dev, open your project → Credentials → Android keystore and copy the SHA-1, or
  - Run `npx eas credentials -p android` locally and inspect the managed keystore (you must be logged into the Expo account that built the app).


- If you only want to test in Expo Go (not dev-client), you can use the Expo/web client flow with `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID` and `useProxy: true`, but Expo Go cannot test native SDKs (like Razorpay).

- To retrieve phone numbers during sign-up, enable the Google People API in your Cloud project and add the scope `https://www.googleapis.com/auth/user.phonenumbers.read` to the OAuth consent screen. The mobile client requests this scope and will send the access token to the backend so the server can fetch the user's phone number (if permitted).

6) If you want me to create the client for you

- I cannot create Google Cloud credentials without access to your Google account/project. If you want me to complete the cloud step, share the SHA-1 and confirm the package name (already provided), or run the commands above and paste the client ID here so I can update `mobile/.env` and `server/.env` for you.
