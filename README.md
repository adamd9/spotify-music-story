# Spotify MP3 Mix Player

A web application that allows you to play a mix of Spotify tracks and local MP3 files seamlessly. This is perfect for radio shows, podcasts, or any scenario where you want to mix Spotify content with custom audio files.

## Features

- **Spotify Integration**: Log in with your Spotify Premium account to access your music.
- **Local MP3 Playback**: Play custom MP3 files alongside Spotify tracks.
- **Seamless Playback**: Smooth transitions between Spotify and local MP3 files.
- **Playlist Support**: Create playlists with a mix of Spotify tracks and MP3s.
- **Responsive Design**: Works on desktop and mobile devices.
- **Keyboard Shortcuts**: Control playback with keyboard shortcuts.

## Prerequisites

- Node.js (v14 or later)
- npm (comes with Node.js)
- A Spotify Premium account
- A Spotify Developer account to create an application

## Setup Instructions

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
   ```
   CLIENT_ID=your_spotify_client_id
   CLIENT_SECRET=your_spotify_client_secret
   REDIRECT_URI=http://localhost:8888/callback
   PORT=8888
   MP3_FILE_PATH=/audio/advertisement.mp3
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
node server.js
```

### 6. Access the Application

Open your web browser and navigate to:
```
http://localhost:8888
```

## How to Use

1. Click the "Login with Spotify Premium" button
2. Authorize the application to access your Spotify account
3. The player will load with a default playlist
4. Use the player controls to play, pause, skip tracks, and adjust volume
5. Click on any track in the playlist to play it

## Customizing the Playlist

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

- **"User not registered in the Developer Dashboard"**: Make sure you've added your Spotify account as a user in the Spotify Developer Dashboard under your app's settings.
- **Playback issues**: Ensure you have a stable internet connection and that your Spotify Premium account is active.
- **CORS errors**: The app should be served from `http://localhost:8888` to match your Spotify app's redirect URI.

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgements

- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
