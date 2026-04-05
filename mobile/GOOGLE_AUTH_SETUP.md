# Google Sign-In Setup (Expo + Node backend)

This project uses:
- Expo client OAuth (`expo-auth-session`)
- Backend token verification at `POST /api/auth/google`

## 1) Create Google OAuth credentials

1. Open Google Cloud Console.
2. Create/select your project.
3. Configure OAuth consent screen.
4. Create OAuth Client IDs:
   - Web application
   - Android (optional for native builds)
   - iOS (optional for native builds)

  Additionally, if you want to retrieve the user's phone number during sign-up, enable the Google People API for the project and include the scope `https://www.googleapis.com/auth/user.phonenumbers.read` when creating the OAuth consent and client IDs.

For Expo Go proxy flow, add this redirect URI to your Web client:

`https://auth.expo.io/@YOUR_EXPO_USERNAME/handkraft`

Replace `YOUR_EXPO_USERNAME` with your Expo account username.

## 2) Configure backend env

1. Copy `server/.env.example` to `server/.env`.
2. Set values:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `GOOGLE_CLIENT_ID` = your Web Client ID

If you plan to accept tokens from native Android builds, also add `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` (the Android client ID) to the server `.env` so the backend verifier accepts that audience.

## 3) Configure mobile env

1. Copy `mobile/.env.example` to `mobile/.env`.
2. Set values:
   - `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

Note: the mobile client now requests the People API phone-number scope. When an access token is returned by Google the app will send it along with the id token to `POST /api/auth/google`. The server will (optionally) call the People API to fetch the user's phone number and store it on the user record if available.

## Scope Mapping (What gets captured)

With your current scopes, the app can capture all requested profile fields on Google sign-up:

- `openid`
  - `sub` (Google account id used for account linking)
- `https://www.googleapis.com/auth/userinfo.email`
  - `email`
  - `email_verified`
- `https://www.googleapis.com/auth/userinfo.profile`
  - `name`
  - `given_name`
  - `family_name`
  - `picture`
  - `locale`
- `https://www.googleapis.com/auth/user.phonenumbers.read`
  - `phoneNumbers` from People API (when available on the user's Google account)

No additional scopes are required for these fields.

## 4) Start servers

From `server/`:

```powershell
npm run dev
```

From `mobile/`:

```powershell
npm run start
```

## 5) Test in app

1. Open app in Expo Go.
2. Go to Login or Sign Up screen.
3. Tap "Sign in with Google".
4. Complete Google consent.
5. App receives id token, backend verifies it, app stores JWT, then navigates to feed.

## Troubleshooting

- Error: `Token audience mismatch`
  - Ensure server `GOOGLE_CLIENT_ID` and mobile client IDs are correct.
- Error: `Google client not configured`
  - Ensure backend `.env` exists and backend restarted.
- Google opens but app does not return
  - Verify app scheme in `app.json` and Expo redirect URI in Google console.
- Request fails from phone to backend
  - Ensure phone and backend machine are on same network, or set `EXPO_PUBLIC_API_URL` manually.
