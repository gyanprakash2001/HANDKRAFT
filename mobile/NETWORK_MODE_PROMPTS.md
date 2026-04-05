# HANDKRAFT Network Mode Prompts

Use these exact prompts with Copilot when you want to switch quickly.

## 1) Same Wi-Fi Mode (laptop + phone on same network)

Prompt:

"Switch HANDKRAFT mobile to same Wi-Fi mode now. Use `ApiSwitcher` quick action **Same Wi-Fi** (or set mode to `auto`), ensure backend is running on port 5000, and verify with one API call from the app."

## 2) Mobile Data Mode (phone not on same Wi-Fi)

Prompt:

"Switch HANDKRAFT mobile to mobile-data mode now. Start the backend and tunnel (`cd server && npm run dev` and `cd server && npm run tunnel`), use `ApiSwitcher` quick action **Mobile Data** with the ngrok URL, then verify by loading feed/login and report any failing endpoint."

## Quick Notes

- `Same Wi-Fi` mode is fastest for development.
- `Mobile Data` mode needs both backend and tunnel running on your laptop.
- For ngrok free plan, API requests require skip-warning header; app already handles this automatically.
