# Spotify MP3 Mix + AI Music Documentary

A web application that mixes Spotify tracks with local MP3 files and can auto-generate a short “music documentary” (interleaving narration and 5 songs) using the OpenAI Responses API. Ideal for radio-style segments, podcasts, music history snippets, or playlist storytelling.

## Features

- **Spotify Integration**: Log in with Spotify Premium to play tracks using the Web Playback SDK.
- **Local MP3 Playback**: Interleave narration or ads as local MP3s using the Web Audio API.
- **AI Documentary Generator**: Input a topic (e.g., a band). The app identifies the artist, fetches a catalog, and uses OpenAI to draft a concise outline with exactly 5 songs, interspersed with narration.
- **Text-to-Speech (TTS)**: Generate narration MP3s server-side (OpenAI) and play them inline between songs.
- **Mock TTS Mode**: For development, bypass OpenAI and use a placeholder MP3 with `MOCK_TTS=1`.
- **Playlist Persistence (“My Playlists”)**: Save generated outlines as shareable playlist records on the server.
- **Responsive UI + Loading Spinner**: Clean UI with inline spinner while generating outlines.
- **Keyboard Shortcuts**: Space to play/pause; Ctrl+Arrows for navigation and volume.

## Prerequisites

- Node.js (v14 or later)
- npm (comes with Node.js)
- A Spotify Premium account
- A Spotify Developer account to create an application

## Setup

### 1. Create a Spotify Application

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Log in with your Spotify account
3. Click "Create an App"
4. Fill in the following details:
   - App name: Spotify MP3 Mix Player
   - App description: A web player that mixes Spotify tracks with local MP3s
   - Website: http://localhost:8888
   - Redirect URI: http://localhost:8888/callback
5. Click "Save"
6. Note down your `Client ID` and `Client Secret` (click "Show Client Secret")

### 2. Configure Environment Variables

1. Rename the `.env.example` file to `.env`
2. Update the following variables in the `.env` file:
   ```env
   # Spotify
   CLIENT_ID=your_spotify_client_id
   CLIENT_SECRET=your_spotify_client_secret
   REDIRECT_URI=http://localhost:8888/callback

   # Server
   PORT=8888
   CLIENT_DEBUG=0     # set 1 for verbose client logs
   SERVER_DEBUG=0     # set 1 for verbose server logs

   # OpenAI
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_TTS_MODEL=gpt-4o-mini-tts
   OPENAI_TTS_VOICE=alloy
   TTS_OUTPUT_DIR=public/tts

   # Development Features
   MOCK_TTS=0         # set 1 to use a local placeholder MP3 instead of OpenAI TTS
   ```

### 3. Install Dependencies

```bash
npm install
```

### 4. Add MP3 Files

1. Create a directory called `public/audio` in your project root
2. Add your MP3 files to this directory
3. Update the `setupDefaultPlaylist()` function in `public/player.js` to include your MP3 files

### 5. Start the Server

```bash
npm run dev
```

This runs the modular server (`src/server.js`) with nodemon and serves `public/`.

### 6. Access the Application

Open your web browser and navigate to:
```
http://localhost:8888
```

## How to Use

1. Go to `http://localhost:8888/player.html` and click “Login with Spotify Premium”.
2. Authorize the app; the player initializes and transfers playback to this device.
3. To generate a documentary, enter a topic (e.g., “Deftones”) and click “Generate Outline”.
4. The app will:
   - Identify the artist using your Spotify token.
   - Fetch a track catalog (top tracks + albums) and pass it to the OpenAI model.
   - Receive a single JSON object with an interleaved `timeline` (narration and 5 songs).
   - Generate TTS MP3s for narration (or use a placeholder in mock mode).
   - Build a playable playlist alternating narration and songs.
5. Use controls to play/pause/seek. The UI shows a spinner during generation.
6. Click “Refresh” under “My Playlists” to see saved documentary items. Use “Share” to copy a shareable link.

## Customizing the Default Playlist

To customize the playlist, edit the `setupDefaultPlaylist()` function in `public/player.js`. You can add Spotify tracks or local MP3 files to the playlist.

### Adding Spotify Tracks

```javascript
{
    type: 'spotify', 
    id: 'spotify:track:YOUR_SPOTIFY_TRACK_ID',
    name: 'Track Name',
    artist: 'Artist Name',
    albumArt: 'URL_TO_ALBUM_ART',
    duration: DURATION_IN_MS
}
```

### Adding Local MP3 Files

```javascript
{
    type: 'mp3', 
    id: 'unique_id', 
    name: 'MP3 Track Name',
    artist: 'Artist Name',
    albumArt: 'URL_TO_IMAGE',
    duration: DURATION_IN_MS,
    url: '/audio/your_file.mp3'
}
```

## Keyboard Shortcuts

- **Space**: Play/Pause
- **Ctrl + →**: Next track
- **Ctrl + ←**: Previous track
- **Ctrl + ↑**: Increase volume
- **Ctrl + ↓**: Decrease volume

## Troubleshooting

- **OAuth “User not registered in the Developer Dashboard”**: Add your account as a user in your Spotify app’s settings.
- **Playback issues**: Ensure Premium is active; verify Web Playback SDK initialized and device playback was transferred.
- **CORS**: Serve from `http://localhost:8888` to match the redirect URI.
- **Outline button doesn’t respond**: We bind listeners directly and with a delegated fallback. Ensure you’re on `player.html`.
- **TTS costs/time during development**: Set `MOCK_TTS=1` to use a bundled local MP3 for narration.

---

## Architecture Overview

- **Frontend** (`public/`)
  - `player.html` + `player.js`: UI, Spotify SDK setup, doc generation workflow, playlist rendering, narration TTS requests, and “My Playlists” interactions.
  - `index.html`: Minimal landing/login page.
  - `styles.css`: Responsive layout, player styles, spinner, badges.
  - `favicon.svg`: Custom favicon with record/play/speech motif.

- **Server (development)** (`src/`)
  - `src/app.js`, `src/server.js`: Express app with modular routes.
  - `src/routes/tts.js`: `/api/tts-batch` for TTS (honors `MOCK_TTS`).
  - `src/routes/musicDoc.js`: `/api/music-doc` to generate an outline via OpenAI Responses API (model: `gpt-5-mini`).
  - `src/routes/spotify.js`: Spotify helper endpoints (identify artist, fetch catalog).
  - `src/routes/playlists.js`: Filesystem-backed playlist persistence (see endpoints below).
  - `src/config.js`: Central config, including `features.mockTts` and paths.

- **Server (alternative single-file)**
  - `server.js`: A root-level single-file server that includes equivalent endpoints. Use if you prefer running `node server.js` (update `package.json` accordingly).

- **Storage**
  - `public/tts/`: Generated narration MP3s.
  - `data/playlists/`: JSON playlist records for “My Playlists”.

---

## API Endpoints

All routes are served by the Express server. In development, `npm run dev` serves the modular routes under `src/`.

- **Auth + Player**
  - `GET /login` → Redirect to Spotify OAuth.
  - `GET /callback` → OAuth callback; redirects to `/player.html` with tokens in URL hash.
  - `GET /refresh_token?refresh_token=...` → Access token refresh.

- **Config**
  - `GET /config.js` → Defines `window.CLIENT_DEBUG` based on server env for client logs.

- **Spotify Helpers**
  - `POST /api/identify-artist` → `{ query, accessToken }` → `{ ok, artist }`.
  - `POST /api/artist-tracks` → `{ artistId, accessToken, market?, desiredCount? }` → `{ ok, tracks }`.

- **Documentary Generation**
  - `POST /api/music-doc` → Body includes `{ topic, prompt?, catalog? }` and returns `{ ok, data }` where `data` strictly conforms to a JSON schema with a single interleaved `timeline` containing narration and exactly 5 song items.

- **TTS**
  - `POST /api/tts-batch` → `{ segments: [{ text }] }` → `{ ok, urls }`. In mock mode (`MOCK_TTS=1`), returns a placeholder MP3 URL for each segment without calling OpenAI.

- **Playlists (Persistence for “My Playlists”)**
  - `POST /api/playlists` → `{ ownerId, title, topic, summary, timeline }` → `{ ok, playlist }`.
  - `GET /api/playlists/:id` → `{ ok, playlist }`.
  - `PATCH /api/playlists/:id` → Partial updates `{ title?, topic?, summary?, timeline? }` → `{ ok, playlist }`.
  - `GET /api/users/:ownerId/playlists` → `{ ok, playlists: [{ id, ownerId, title, topic, createdAt, updatedAt }] }`.

---

## Environment Variables Reference

- `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`
- `PORT`
- `CLIENT_DEBUG`, `SERVER_DEBUG`
- `OPENAI_API_KEY`
- `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`
- `TTS_OUTPUT_DIR`
- `MOCK_TTS` (1 to enable placeholder MP3s for TTS)

---

## Development Notes

- Run in dev with nodemon: `npm run dev` (uses `src/server.js`).
- The client’s `DEBUG` mode is toggled from the server via `/config.js` and `CLIENT_DEBUG`.
- The Generate Outline button shows an inline spinner while work is in progress.
- If you need to use the single-file root server (`server.js`), change `package.json` scripts to point to it.

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgements

- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [OpenAI Responses + TTS](https://platform.openai.com/docs)
