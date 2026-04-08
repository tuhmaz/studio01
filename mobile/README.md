# Hausmeister Pro — Mobile App

React Native / Expo app for workers. **Private distribution only — not for app stores.**

## Requirements
- Node.js 18+
- Expo CLI: `npm install -g expo-cli eas-cli`
- Android device or emulator (primary target)

## Setup

```bash
cd mobile
npm install
```

## Development (with local server)

1. Edit `src/api/client.ts` → set `DEFAULT_URL` to your local IP:
   ```ts
   export const DEFAULT_URL = 'http://192.168.1.x:9002';
   ```
2. Run the app:
   ```bash
   npx expo start
   ```
3. Scan QR code with **Expo Go** app on your phone.

## Build APK (private distribution)

```bash
# Login to Expo account (free)
eas login

# Build APK for Android (no Google Play needed)
eas build --platform android --profile preview
```

The APK file can then be:
- Shared via WhatsApp / Telegram
- Hosted on the company server
- Distributed via QR code

Workers install it by enabling **"Unbekannte Quellen"** in Android settings.

## Screens

| Screen | Description |
|--------|-------------|
| **Login** | Email + password login |
| **Heute** | Today's assignments overview |
| **Stempeln** | Clock in/out with GPS verification |
| **Notizen** | Photos, voice notes, text notes |
| **Profil** | Monthly hours summary + server config |

## Server Configuration

Workers can change the server URL in the **Profil** tab → server settings.
Default: `http://152.53.31.61:9002`

## API Endpoints Used

- `POST /api/auth/mobile` — Login, returns JWT token
- `GET  /api/auth/mobile` — Verify token (Bearer)
- `POST /api/data` — All data operations (Bearer token supported)
