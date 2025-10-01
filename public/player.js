// Debug toggle via env-configured flag injected by the server at /config.js
// Set CLIENT_DEBUG=1 in your server env to enable verbose logging in the client.
const DEBUG = (() => {
    try {
        const flag = (typeof window !== 'undefined') ? window.CLIENT_DEBUG : undefined;
        return flag === '1' || flag === 1 || flag === true;
    } catch {
        return false;
    }
})();

function clearAccessToken(reason) {
    try {
        const storage = window.sessionStorage || window.localStorage;
        storage.removeItem('spotify_access_token');
    } catch {}
    state.accessToken = null;
    dbg('cleared access token', { reason });
    try {
        // Hide player and show login prompt
        if (playerSection) playerSection.classList.add('hidden');
        if (loginSection) loginSection.classList.remove('hidden');
        if (docStatusEl) docStatusEl.textContent = 'Please log in to start.';
    } catch {}
}

// Fetch Spotify user id for persistence (top-level, used across features)
async function fetchSpotifyUserId() {
    // Do not make network calls if no access token
    if (!state.accessToken) return null;
    try {
        const r = await fetch('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${state.accessToken}` }
        });
        if (r.status === 401) {
            // Token invalid/expired → treat as logged out and stop further attempts
            clearAccessToken('401 on /v1/me');
            return null;
        }
        if (r.status === 403) {
            // User not added to developer dashboard
            showAccessDeniedOverlay();
            return null;
        }
        if (!r.ok) return null;
        const me = await r.json();
        return me?.id || null;
    } catch (e) {
        dbg('fetchSpotifyUserId error', e);
        return null;
    }
}

// Show an empty state when no playlist is available
function showEmptyState(message) {
    try { if (docStatusEl) docStatusEl.textContent = message || 'No playlist loaded.'; } catch {}
    try {
        if (trackNameElement) trackNameElement.textContent = 'No playlist loaded';
        if (artistNameElement) artistNameElement.textContent = '—';
        if (albumArtElement) albumArtElement.src = DEFAULT_ALBUM_ART;
        if (progressBar) progressBar.style.width = '0%';
        if (currentTimeElement) currentTimeElement.textContent = '0:00';
        if (durationElement) durationElement.textContent = '0:00';
    } catch {}
    try {
        if (playlistElement) playlistElement.innerHTML = '<li class="placeholder">No items. Generate an outline or import a playlist to begin.</li>';
    } catch {}
    // Hide all player sections in empty state
    setPlayerSectionsVisible(false);
}

const dbg = (...args) => { if (DEBUG) console.log('[DBG]', ...args); };

// My Playlists rendering and actions
async function refreshMyPlaylists() {
    const ownerId = await fetchSpotifyUserId();
    if (!ownerId) {
        if (myPlaylistsEmpty) myPlaylistsEmpty.textContent = 'Login required to view saved playlists.';
        return;
    }
    try {
        // Fetch both completed playlists and active jobs
        const [playlistsResp, jobsResp] = await Promise.all([
            fetch(`/api/users/${encodeURIComponent(ownerId)}/playlists`),
            fetch(`/api/users/${encodeURIComponent(ownerId)}/jobs`)
        ]);
        
        const playlistsJson = playlistsResp.ok ? await playlistsResp.json() : { playlists: [] };
        const jobsJson = jobsResp.ok ? await jobsResp.json() : { jobs: [] };
        
        const playlists = Array.isArray(playlistsJson?.playlists) ? playlistsJson.playlists : [];
        const jobs = Array.isArray(jobsJson?.jobs) ? jobsJson.jobs : [];
        
        // Filter active jobs (pending or running)
        const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
        
        if (myPlaylistsList) myPlaylistsList.innerHTML = '';
        
        if (!playlists.length && !activeJobs.length) {
            if (myPlaylistsEmpty) myPlaylistsEmpty.classList.remove('hidden');
            return;
        }
        
        if (myPlaylistsEmpty) myPlaylistsEmpty.classList.add('hidden');
        
        // Show active jobs first
        activeJobs.forEach(job => {
            const li = document.createElement('li');
            const topic = job.params?.topic || '(generating)';
            const statusBadge = job.status === 'running' 
                ? `<span class="badge badge-running">⏳ ${Math.round(job.progress || 0)}%</span>`
                : `<span class="badge badge-pending">⏸ Queued</span>`;
            
            li.innerHTML = `
                <div class="saved-item job-item">
                    <button class="saved-title job-link" data-job-id="${job.id}" title="Reconnect to job">
                        ${topic} ${statusBadge}
                        <span class="saved-meta job-status">${job.stageLabel || 'Starting...'}</span>
                    </button>
                </div>`;
            myPlaylistsList.appendChild(li);
        });
        
        // Show completed playlists
        playlists.forEach(rec => {
            const li = document.createElement('li');
            const title = rec.title || '(untitled)';
            const meta = rec.topic ? `(<span class="saved-meta-topic">${rec.topic}</span>)` : '';
            li.innerHTML = `
                <div class="saved-item">
                    <button class="saved-title as-link" data-id="${rec.id}" title="Load playlist">
                        ${title} <span class="saved-meta">${meta}</span>
                    </button>
                </div>`;
            myPlaylistsList.appendChild(li);
        });
        
        // Attach events: click title to load playlist
        myPlaylistsList.querySelectorAll('.saved-title.as-link[data-id]').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.getAttribute('data-id');
                if (loadIdInput) loadIdInput.value = id;
                if (loadIdBtn) loadIdBtn.click();
            });
        });
        
        // Attach events: click job to reconnect
        myPlaylistsList.querySelectorAll('.saved-title.job-link[data-job-id]').forEach(el => {
            el.addEventListener('click', () => {
                const jobId = el.getAttribute('data-job-id');
                reconnectToJob(jobId);
            });
        });
        
    } catch (e) {
        console.error('refreshMyPlaylists error', e);
        if (myPlaylistsEmpty) {
            myPlaylistsEmpty.classList.remove('hidden');
            myPlaylistsEmpty.textContent = 'Failed to load playlists.';
        }
    }
}

// (moved) We attach listeners and refresh after DOM elements are defined below

// Save generated playlist record to server for sharing and history
async function saveGeneratedPlaylist(doc, ownerId) {
    try {
        if (!doc || !Array.isArray(doc.timeline)) return null;
        const body = {
            ownerId: ownerId || 'anonymous',
            title: doc.title || (doc.topic ? `Music history: ${doc.topic}` : 'Music history'),
            topic: doc.topic || '',
            summary: doc.summary || '',
            timeline: doc.timeline
        };
        const r = await fetch('/api/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!r.ok) return null;
        const json = await r.json();
        return json?.playlist || null;
    } catch (e) {
        console.error('saveGeneratedPlaylist error', e);
        return null;
    }
}


// Generate TTS for narration segments and attach URLs onto the doc (timeline or legacy)
async function generateTTSForDoc(doc, playlistId) {
    try {
        if (!doc) return doc;
        let texts = [];
        let targets = [];
        if (Array.isArray(doc.timeline)) {
            doc.timeline.forEach((entry) => {
                if (entry && entry.type === 'narration' && typeof entry.text === 'string' && entry.text.trim().length > 0) {
                    texts.push({ text: entry.text.trim() });
                    targets.push(entry);
                }
            });
        } else if (Array.isArray(doc.narration_segments)) {
            doc.narration_segments.forEach((seg) => {
                if (seg && typeof seg.text === 'string' && seg.text.trim().length > 0) {
                    texts.push({ text: seg.text.trim() });
                    targets.push(seg);
                }
            });
        }

        if (texts.length === 0) {
            dbg('generateTTSForDoc: no narration segments found');
            return doc;
        }

        dbg('generateTTSForDoc: requesting TTS batch', { count: texts.length });
        try { if (docStatusEl) docStatusEl.textContent = `Generating narration tracks (${texts.length})…`; } catch {}
        const resp = await fetch('/api/tts-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: texts, playlistId })
        });
        if (!resp.ok) {
            let details = {};
            try { details = await resp.json(); } catch {}
            dbg('generateTTSForDoc: tts-batch failed', { status: resp.status, details });
            try { if (docStatusEl) docStatusEl.textContent = 'Narration generation failed.'; } catch {}
            showError('Narration generation failed. Please try again.');
            return doc;
        }
        const json = await resp.json();
        const urls = Array.isArray(json?.urls) ? json.urls : [];
        dbg('generateTTSForDoc: received urls', { total: urls.length });

        let i = 0;
        for (const target of targets) {
            const url = urls[i++] || null;
            if (url) {
                target.tts_url = url;
            }
        }

        try { if (docStatusEl) docStatusEl.textContent = 'Narration tracks ready.'; } catch {}
        return doc;
    } catch (e) {
        console.error('generateTTSForDoc error', e);
        try { if (docStatusEl) docStatusEl.textContent = 'Narration generation failed.'; } catch {}
        showError('Narration generation failed. Please try again.');
        return doc;
    }
}

// Player state
const state = {
    spotifyPlayer: null,
    audioContext: null,
    audioSource: null,
    gainNode: null,
    sdkReady: false,
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.5,
    playlist: [],
    currentTrackIndex: 0,
    isSpotifyTrack: true,
    accessToken: null,
    deviceId: null,
    isInitialized: false,
    isAdPlaying: false,
    isGeneratingDoc: false,
    startedTrackIndex: -1,
    loadedPlaylistId: null,
    // Section clip control (seconds)
    sectionClipSeconds: 30,
    // Internal timing for Spotify clip limiting
    spotifyClipTimeoutId: null,
    spotifyClipStartTime: 0,
    spotifyClipPlayedMs: 0,
    // Track if access denied overlay has been shown
    accessDeniedShown: false
};

// Custom Credentials Management
const CUSTOM_CREDS_KEY = 'spotify_custom_credentials';

function getCustomCredentials() {
    try {
        const stored = localStorage.getItem(CUSTOM_CREDS_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function saveCustomCredentials(clientId, clientSecret) {
    const creds = { clientId, clientSecret };
    localStorage.setItem(CUSTOM_CREDS_KEY, JSON.stringify(creds));
    return creds;
}

function clearCustomCredentials() {
    localStorage.removeItem(CUSTOM_CREDS_KEY);
}

function hasCustomCredentials() {
    const creds = getCustomCredentials();
    return creds && creds.clientId && creds.clientSecret;
}

// Get redirect URI (always /callback on current origin)
function getRedirectUri() {
    let origin = window.location.origin;
    // Spotify requires 127.0.0.1 instead of localhost
    origin = origin.replace('localhost', '127.0.0.1');
    return origin + '/callback';
}

// Get active credentials (custom or default from server)
async function getActiveCredentials() {
    const custom = getCustomCredentials();
    if (custom && custom.clientId && custom.clientSecret) {
        return custom;
    }
    // Fallback to server config
    try {
        const resp = await fetch('/api/config');
        if (resp.ok) {
            const config = await resp.json();
            return {
                clientId: config.clientId,
                clientSecret: null // Server doesn't expose secret
            };
        }
    } catch {}
    return null;
}

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// Initialize theme on load
initTheme();

// DOM Elements
const loginSection = document.getElementById('login');
const playerSection = document.getElementById('player');
const loginButton = document.getElementById('login-button');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const playPauseButton = document.getElementById('play-pause');
const previousButton = document.getElementById('previous');
const nextButton = document.getElementById('next');
const progressBar = document.getElementById('progress-bar');
const currentTimeElement = document.getElementById('current-time');
const durationElement = document.getElementById('duration');
const volumeControl = document.getElementById('volume');
const trackNameElement = document.getElementById('track-name');
const artistNameElement = document.getElementById('artist-name');
const albumArtElement = document.getElementById('album-art');
const playlistElement = document.getElementById('playlist');
const errorElement = document.getElementById('error');
const localBadgeElement = document.getElementById('local-badge');

// Player section containers
const docMetaEl = document.querySelector('#player .doc-meta');
const nowPlayingEl = document.querySelector('#player .now-playing');
const controlsEl = document.querySelector('#player .controls');
const volumeEl = document.querySelector('#player .volume-control');
const playlistWrapEl = document.querySelector('#player .playlist');

function setPlayerSectionsVisible(visible) {
    const method = visible ? 'remove' : 'add';
    // Also toggle the entire player container
    try { if (playerSection) playerSection.classList[method]('hidden'); } catch {}
    try { if (docMetaEl) docMetaEl.classList[method]('hidden'); } catch {}
    try { if (nowPlayingEl) nowPlayingEl.classList[method]('hidden'); } catch {}
    try { if (controlsEl) controlsEl.classList[method]('hidden'); } catch {}
    try { if (volumeEl) volumeEl.classList[method]('hidden'); } catch {}
    try { if (playlistWrapEl) playlistWrapEl.classList[method]('hidden'); } catch {}
}

// Documentary generation UI elements (index page)
const docTopicInput = document.getElementById('doc-topic');
const generateDocBtn = document.getElementById('generate-doc');
const docOutputEl = document.getElementById('doc-output');
const docPromptEl = document.getElementById('doc-prompt');
const sectionDurationSelect = document.getElementById('section-duration');
const saveStatusEl = document.getElementById('save-status');
const loadIdInput = document.getElementById('load-id-input');
const loadIdBtn = document.getElementById('load-id-btn');
const shareBtn = document.getElementById('share-btn');
const myPlaylistsList = document.getElementById('my-playlists-list');
const myPlaylistsEmpty = document.getElementById('my-playlists-empty');
const refreshMyPlaylistsBtn = document.getElementById('refresh-my-playlists');
const docSpinner = document.getElementById('doc-spinner');
const docSpinnerText = document.getElementById('doc-spinner-text');
const docStatusEl = document.getElementById('doc-status');
const docRawDetails = document.getElementById('doc-raw');
// Doc meta fields in player UI
const docTitleDisplay = document.getElementById('doc-title');
const docTopicDisplay = document.getElementById('doc-topic-display');
const docSummaryDisplay = document.getElementById('doc-summary');
// Import modal elements
const importOpenBtn = document.getElementById('import-open-btn');
const importModal = document.getElementById('import-modal');
const importCancelBtn = document.getElementById('import-cancel-btn');

// Settings modal elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const customClientIdInput = document.getElementById('custom-client-id');
const customClientSecretInput = document.getElementById('custom-client-secret');
const customRedirectUriInput = document.getElementById('custom-redirect-uri');
const saveCredentialsBtn = document.getElementById('save-credentials-btn');
const clearCredentialsBtn = document.getElementById('clear-credentials-btn');
const openSettingsFromDenied = document.getElementById('open-settings-from-denied');

// Built-in default album art (inline SVG, dark gray square with music note)
const DEFAULT_ALBUM_ART = 'data:image/svg+xml;utf8,\
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">\
<rect width="300" height="300" fill="%23282828"/>\
<g fill="%23B3B3B3">\
<circle cx="110" cy="200" r="28"/>\
<circle cx="170" cy="220" r="22"/>\
<path d="M190 80v100h-10V100l-60 15v65h-10V105l80-20z"/>\
</g>\
</svg>';

// HTMLAudioElement for narration/local playback (iOS friendly)
const narrationAudio = document.getElementById('narration-audio');
if (narrationAudio) {
    narrationAudio.volume = state.volume;
}

// Build playlist from documentary JSON (supports both legacy structure + new timeline)
function buildPlaylistFromDoc(doc) {
    try {
        const newPlaylist = [];

        if (doc && Array.isArray(doc.timeline)) {
            // New format: single interleaved timeline array
            let narrationCount = 0;
            doc.timeline.forEach((entry) => {
                if (!entry || !entry.type) return;
                if (entry.type === 'narration') {
                    narrationCount += 1;
                    const ttsUrl = entry.tts_url || entry.ttsUrl || entry.url;
                    if (!ttsUrl) {
                        showError('Narration audio missing for one or more segments. Please retry generation.');
                        return; // skip adding this narration segment
                    }
                    const narrationTitle = entry.title || `Narration ${narrationCount}`;
                    newPlaylist.push({
                        type: 'mp3',
                        id: `narration-${narrationCount - 1}`,
                        name: narrationTitle,
                        artist: 'Narrator',
                        albumArt: DEFAULT_ALBUM_ART,
                        duration: 0,
                        url: ttsUrl,
                        narrationText: entry.text || ''
                    });
                } else if (entry.type === 'song') {
                    const title = entry.title || '';
                    const artist = entry.artist || '';
                    const uri = entry.track_uri || null;
                    newPlaylist.push({
                        type: 'spotify',
                        id: uri || null,
                        name: title,
                        artist: artist,
                        albumArt: '',
                        duration: 0,
                        spotifyQuery: entry.spotify_query || `${title} artist:${artist}`
                    });
                }
            });
        } else if (doc && Array.isArray(doc.structure) && Array.isArray(doc.tracks) && Array.isArray(doc.narration_segments)) {
            // Legacy format fallback
            doc.structure.forEach((item) => {
                if (item.type === 'narration') {
                    const seg = doc.narration_segments[item.narration_index];
                    if (!seg) return;
                    const ttsUrl = seg.tts_url || seg.ttsUrl || seg.url;
                    if (!ttsUrl) {
                        showError('Narration audio missing for one or more segments. Please retry generation.');
                        return; // skip adding this narration segment
                    }
                    const narrationTitle = seg.title || `Narration ${item.narration_index + 1}`;
                    newPlaylist.push({
                        type: 'mp3',
                        id: `narration-${item.narration_index}`,
                        name: narrationTitle,
                        artist: 'Narrator',
                        albumArt: DEFAULT_ALBUM_ART,
                        duration: 0,
                        url: ttsUrl,
                        narrationText: seg.text
                    });
                } else if (item.type === 'song') {
                    const tr = doc.tracks[item.track_index];
                    if (!tr) return;
                    const searchName = tr.title || '';
                    const searchArtist = tr.artist || '';
                    const trackUri = tr.track_uri || null;
                    newPlaylist.push({
                        type: 'spotify',
                        id: trackUri || null,
                        name: searchName,
                        artist: searchArtist,
                        albumArt: '',
                        duration: 0,
                        spotifyQuery: tr.spotify_query || `${searchName} artist:${searchArtist}`
                    });
                }
            });
        } else {
            throw new Error('Invalid documentary structure');
        }

        if (newPlaylist.length === 0) throw new Error('Empty generated playlist');

        state.playlist = newPlaylist;
        state.currentTrackIndex = 0;
        state.currentTrack = state.playlist[0];
        state.isSpotifyTrack = state.currentTrack.type === 'spotify';
        state.startedTrackIndex = -1; // nothing played yet
        renderPlaylist();
        setPlayerSectionsVisible(true);
        // Try to load durations for local MP3s to show in the playlist
        preloadTrackDurations();
        updateNowPlaying({
            name: state.currentTrack.name,
            artist: state.currentTrack.artist,
            albumArt: state.currentTrack.albumArt,
            duration: state.currentTrack.duration,
            position: 0,
            isPlaying: false
        });
    } catch (e) {
        console.error('Failed to build playlist from doc:', e);
        showError('Failed to build playlist from generated outline');
    }
}

// Initialize the player when the window loads
window.onSpotifyWebPlaybackSDKReady = () => {
    // This function will be called by the Spotify Web Playback SDK when it's ready
    console.log('Spotify Web Playback SDK ready');
    dbg('SDK ready');
    state.sdkReady = true;
    // If we already have a token in the URL, initialize now
    if (state.accessToken && !state.isInitialized) {
        initPlayer();
    }
};

// Parse URL hash to get access token
async function parseHash() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const hashToken = params.get('access_token');
    const authCode = params.get('auth_code');
    
    // Prefer sessionStorage; fall back to localStorage
    const storage = window.sessionStorage || window.localStorage;
    
    // Handle custom auth code exchange
    if (authCode && !hashToken) {
        const creds = getCustomCredentials();
        if (creds && creds.clientId && creds.clientSecret) {
            try {
                dbg('Exchanging auth code for token with custom credentials');
                const response = await fetch('/api/exchange-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: authCode,
                        client_id: creds.clientId,
                        client_secret: creds.clientSecret,
                        redirect_uri: getRedirectUri()
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    try { storage.setItem('spotify_access_token', data.access_token); } catch {}
                    if (data.refresh_token) {
                        try { storage.setItem('spotify_refresh_token', data.refresh_token); } catch {}
                    }
                    state.accessToken = data.access_token;
                    // Clear hash
                    try { window.history.replaceState({}, '', window.location.pathname + window.location.search); } catch {}
                } else {
                    console.error('Failed to exchange code for token');
                    window.location.href = '/';
                    return;
                }
            } catch (error) {
                console.error('Code exchange error:', error);
                window.location.href = '/';
                return;
            }
        }
    } else if (hashToken) {
        try { storage.setItem('spotify_access_token', hashToken); } catch {}
        // Hard clear the URL hash so the token is not visible
        try { window.history.replaceState({}, '', window.location.pathname + window.location.search); } catch {}
        state.accessToken = hashToken;
    } else {
        // Attempt to retrieve from storage
        try { state.accessToken = storage.getItem('spotify_access_token') || null; } catch { state.accessToken = null; }
    }
    
    dbg('parseHash', { hasToken: !!state.accessToken, path: window.location.pathname });

    if (state.accessToken) {
        if (state.sdkReady) {
            initPlayer();
        } else {
            console.log('Token present, waiting for Spotify SDK to be ready...');
        }
    } else if (window.location.pathname === '/player.html') {
        // If we're on the player page but don't have a token, redirect to login
        window.location.href = '/';
    }
}

// Initialize the player
async function initPlayer() {
    if (state.isInitialized) return;
    
    try {
        // Set up Spotify Web Playback
        state.spotifyPlayer = new Spotify.Player({
            name: 'Spotify MP3 Mix Player',
            getOAuthToken: cb => { cb(state.accessToken); },
            volume: state.volume
        });

    // In case the access token arrives via hash after redirect, refresh playlists
    window.addEventListener('hashchange', () => {
        const prev = !!state.accessToken;
        parseHash();
        if (!prev && state.accessToken) {
            try { refreshMyPlaylists(); } catch {}
        }
    });

        // Set up Web Audio API for local MP3 playback
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.gainNode = state.audioContext.createGain();
        state.gainNode.gain.value = state.volume;
        
        // Set up event listeners
        setupEventListeners();
        
        // Connect to the Spotify player
        const connected = await state.spotifyPlayer.connect();
        if (connected) {
            console.log('Connected to Spotify player');
            
            // Show the player and hide the login section
            if (loginSection) {
                loginSection.classList.add('hidden');
            }
            playerSection.classList.remove('hidden');
            
            // Default playlist setup removed; playlist is built from generated or loaded docs
        }
        
        state.isInitialized = true;
    } catch (error) {
        console.error('Error initializing player:', error);
        showError('Failed to initialize player. Please try again.');
    }
}

// Set up event listeners
function setupEventListeners() {
    // Spotify Player Events
    state.spotifyPlayer.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        dbg('player ready', { device_id });
        state.deviceId = device_id;
        transferPlaybackHere(device_id);
    });

    state.spotifyPlayer.addListener('player_state_changed', (playerState) => {
        if (!playerState) return;
        // If we're currently playing a local MP3, ignore Spotify updates to avoid UI flicker/overwrite
        if (!state.isSpotifyTrack) {
            dbg('ignore spotify player_state_changed (local active)');
            return;
        }
        
        // Spotify SDK provides current track in track_window
        const currentTrack = playerState.track_window?.current_track;
        const positionMs = playerState.position; // ms
        const isPaused = playerState.paused;
        const durationMs = currentTrack?.duration_ms ?? state.duration;

        dbg('player_state_changed', {
            name: currentTrack?.name,
            artists: currentTrack?.artists?.map(a => a.name).join(', '),
            positionMs,
            durationMs,
            paused: isPaused
        });

        if (currentTrack) {
            updateNowPlaying({
                name: currentTrack.name,
                artist: (currentTrack.artists || []).map(a => a.name).join(', '),
                albumArt: currentTrack.album?.images?.[0]?.url || '',
                duration: durationMs,
                position: positionMs,
                isPlaying: !isPaused
            });
            // Persist duration to playlist item so durations show in the list
            try {
                if (Number.isFinite(durationMs) && durationMs > 0) {
                    const idx = state.currentTrackIndex;
                    const plItem = state.playlist && state.playlist[idx];
                    if (plItem && (!plItem.duration || plItem.duration === 0)) {
                        plItem.duration = durationMs;
                        renderPlaylist();
                    }
                }
            } catch {}
        }
    });
    
    state.spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('Initialization Error:', message);
        showError('Failed to initialize Spotify player');
    });
    
    state.spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('Authentication Error:', message);
        showError('Authentication failed. Please log in again.');
        window.location.href = '/';
    });
    
    state.spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('Account Error:', message);
        showError('Spotify Premium account required');
    });
    
    // UI Event Listeners
    if (loginButton) {
        loginButton.addEventListener('click', () => {
            const redirectUri = getRedirectUri();
            // Check if custom credentials are configured
            const creds = getCustomCredentials();
            if (creds && creds.clientId) {
                // Use custom auth flow
                const params = new URLSearchParams({
                    client_id: creds.clientId,
                    redirect_uri: redirectUri
                });
                window.location.href = `/login-custom?${params.toString()}`;
            } else {
                // Use default auth flow
                const params = new URLSearchParams({
                    redirect_uri: redirectUri
                });
                window.location.href = `/login?${params.toString()}`;
            }
        });
    }
    
    playPauseButton.addEventListener('click', togglePlayPause);
    previousButton.addEventListener('click', playPrevious);
    nextButton.addEventListener('click', playNext);
    
    // Progress bar click
    const progressContainer = document.querySelector('.progress-container');
    progressContainer.addEventListener('click', (e) => {
        if (!state.duration) return;
        
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const seekTime = pos * state.duration;
        dbg('seek', { pos, seekTimeMs: seekTime, forSpotify: state.isSpotifyTrack });
        
        if (state.isSpotifyTrack) {
            // Spotify seek expects milliseconds, and state.duration is already in ms
            state.spotifyPlayer.seek(Math.floor(seekTime));
        } else {
            // For local MP3, restart at the new offset
            resumeLocalAt(seekTime / 1000);
        }
    });
    
    // Volume control
    volumeControl.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        state.volume = volume;
        
        if (state.spotifyPlayer) {
            state.spotifyPlayer.setVolume(volume);
        }
        if (state.gainNode) {
            state.gainNode.gain.value = volume;
        }
        if (narrationAudio) {
            narrationAudio.volume = volume;
        }
    });
    
    // Update progress bar
    requestAnimationFrame(updateProgress);
}

// Transfer playback to this device
async function transferPlaybackHere(deviceId) {
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${state.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: false
            })
        });
        
        if (response.status === 403) {
            showAccessDeniedOverlay();
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to transfer playback');
        }
        
        console.log('Playback transferred to this device');
    } catch (error) {
        console.error('Error transferring playback:', error);
    }
}

// Legacy hard-coded default playlist was removed to avoid overriding loaded/generated playlists

// Render the playlist in the UI
function renderPlaylist() {
    playlistElement.innerHTML = '';
    
    state.playlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = index === state.currentTrackIndex ? 'playing' : '';
        const dur = (track && track.duration && track.duration > 0) ? formatTime(track.duration) : '';
        const durHtml = dur ? `<span class="track-duration">${dur}</span>` : '';
        li.innerHTML = `
            <span class="track-number">${index + 1}</span>
            <div class="track-info">
                <div class="track-title">${track.name}</div>
                <div class="track-artist">${track.artist}</div>
            </div>
            <div class="badges">
                ${track.type === 'mp3' ? '<span class="badge badge-local">LOCAL</span>' : ''}
                ${durHtml}
            </div>
        `;
        
        li.addEventListener('click', () => {
            // Do not allow playback until the user is logged in
            if (!state.accessToken) {
                try { if (docStatusEl) docStatusEl.textContent = 'Please log in to play audio.'; } catch {}
                return;
            }
            dbg('playlist click', { index, track });
            playTrack(index);
        });
        
        playlistElement.appendChild(li);
    });
}

// Preload durations for local MP3 tracks so playlist can display them
function preloadTrackDurations() {
    try {
        state.playlist.forEach((t, idx) => {
            if (!t || t.type !== 'mp3' || !t.url || t.duration > 0) return;
            const a = new Audio();
            a.preload = 'metadata';
            a.src = t.url;
            a.onloadedmetadata = () => {
                const d = (isFinite(a.duration) && a.duration > 0) ? Math.floor(a.duration * 1000) : 0;
                if (d > 0) {
                    // Update track duration and refresh playlist UI
                    t.duration = d;
                    renderPlaylist();
                }
            };
            // Best effort; ignore errors
            a.onerror = () => {};
        });
    } catch {}
}

// Play a specific track by index
async function playTrack(index) {
    if (index < 0 || index >= state.playlist.length) return;
    
    // No section-based clipping; timers are not used

    state.currentTrackIndex = index;
    state.currentTrack = state.playlist[index];
    state.isSpotifyTrack = state.currentTrack.type === 'spotify';
    state.startedTrackIndex = index;
    dbg('playTrack', { index, isSpotify: state.isSpotifyTrack, track: state.currentTrack });
    
    // Update UI
    updateNowPlaying({
        name: state.currentTrack.name,
        artist: state.currentTrack.artist,
        albumArt: state.currentTrack.albumArt,
        duration: state.currentTrack.duration,
        position: 0,
        isPlaying: true
    });
    
    // Play the track based on its type
    if (state.isSpotifyTrack) {
        await playSpotifyTrack(state.currentTrack);
    } else {
        await playLocalMP3(state.currentTrack);
    }
    
    // Update playlist UI
    renderPlaylist();
}

// Play a Spotify track
async function playSpotifyTrack(track) {
    try {
        // First, stop any currently playing MP3
        if (state.audioSource) {
            dbg('stopping local audio before Spotify');
            try { state.audioSource.onended = null; } catch (_) {}
            try { state.audioSource.stop(); } catch (_) {}
            state.audioSource = null;
        }
        // Also pause HTMLAudioElement narration if playing
        if (narrationAudio) {
            try { narrationAudio.onended = null; } catch (_) {}
            try { narrationAudio.pause(); } catch (_) {}
        }
        state.isSpotifyTrack = true;
        
        // Resolve track URI via Spotify Search if not provided
        let trackUri = track.id && track.id.startsWith('spotify:track:') ? track.id : null;
        if (!trackUri) {
            dbg('searching Spotify', { name: track.name, artist: track.artist });
            const queryStr = track.spotifyQuery && track.spotifyQuery.trim()
                ? track.spotifyQuery
                : `${track.name} artist:${track.artist}`;
            const q = encodeURIComponent(queryStr);
            const searchResp = await fetch(`https://api.spotify.com/v1/search?type=track&limit=1&q=${q}`, {
                headers: { 'Authorization': `Bearer ${state.accessToken}` }
            });
            if (searchResp.status === 403) {
                showAccessDeniedOverlay();
                throw new Error('Access denied');
            }
            if (!searchResp.ok) throw new Error('Failed to search track');
            const searchData = await searchResp.json();
            const item = searchData?.tracks?.items?.[0];
            if (!item) throw new Error('No tracks found');
            trackUri = item.uri;
            // Persist duration from search result onto playlist item for UI consistency
            try {
                if (Number.isFinite(item.duration_ms) && item.duration_ms > 0) {
                    const idx = state.currentTrackIndex;
                    const plItem = state.playlist && state.playlist[idx];
                    if (plItem) {
                        plItem.duration = item.duration_ms;
                        renderPlaylist();
                    }
                }
            } catch {}
            dbg('search result', { uri: trackUri, name: track.name, artist: track.artist, duration: track.duration });
            updateNowPlaying({
                name: track.name,
                artist: track.artist,
                albumArt: track.albumArt,
                duration: track.duration
            });
        }

        // Play the Spotify track
        await state.spotifyPlayer._options.getOAuthToken(async token => {
            dbg('playing Spotify', { uri: trackUri, device: state.deviceId });
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    uris: [trackUri]
                })
            });
            
            if (response.status === 403) {
                showAccessDeniedOverlay();
                throw new Error('Access denied');
            }
            
            if (!response.ok) {
                dbg('Spotify play failed', { status: response.status });
                throw new Error('Failed to play track');
            }
            
            state.isPlaying = true;
            updatePlayPauseButton();
        });
    } catch (error) {
        console.error('Error playing Spotify track:', error);
        showError('Failed to play track');
    }
}

// Play a local MP3 file
async function playLocalMP3(track) {
    try {
        state.isSpotifyTrack = false;
        // Pause Spotify if currently playing
        if (state.spotifyPlayer) {
            try { state.spotifyPlayer.pause(); } catch (_) {}
        }
        // Stop any WebAudio source
        if (state.audioSource) {
            try { state.audioSource.onended = null; } catch (_) {}
            try { state.audioSource.stop(); } catch (_) {}
            state.audioSource = null;
        }
        if (narrationAudio) {
            narrationAudio.src = track.url;
            narrationAudio.currentTime = 0;
            narrationAudio.volume = state.volume;
            narrationAudio.onended = () => playNext();
            await narrationAudio.play();
        }
        state.audioStartTime = Date.now();
        state.audioPauseTime = undefined;
        state.isPlaying = true;
        updatePlayPauseButton();
        // We do not know duration until metadata loads; update when available
        if (narrationAudio) {
            if (isFinite(narrationAudio.duration) && narrationAudio.duration > 0) {
                state.duration = narrationAudio.duration * 1000;
            }
            narrationAudio.onloadedmetadata = () => {
                state.duration = narrationAudio.duration * 1000;
                // Persist duration onto the track for playlist display
                try {
                    if (state.currentTrack && (!state.currentTrack.duration || state.currentTrack.duration === 0)) {
                        state.currentTrack.duration = state.duration;
                        renderPlaylist();
                    }
                } catch {}
                updateNowPlaying({ duration: state.duration });
            };
        }
        updateNowPlaying({ position: 0, isPlaying: true });
        // Media Session metadata for iOS lockscreen
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: track.name || 'Narration',
                    artist: track.artist || 'Narrator',
                    artwork: [{ src: track.albumArt || DEFAULT_ALBUM_ART, sizes: '300x300', type: 'image/png' }]
                });
                navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
                navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
                navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
                navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
            } catch {}
        }
    } catch (error) {
        console.error('Error playing MP3 (element):', error);
        showError('Failed to play MP3');
    }
}

// Toggle play/pause
function togglePlayPause() {
    if (!state.currentTrack) return;
    
    if (state.isPlaying) {
        if (state.isSpotifyTrack) {
            dbg('toggle pause: Spotify');
            state.spotifyPlayer.pause();
        } else if (narrationAudio) {
            // Pause local audio element
            dbg('toggle pause: local MP3 (element)');
            narrationAudio.pause();
            state.audioPauseTime = Date.now();
        }
        state.isPlaying = false;
    } else {
        if (state.isSpotifyTrack) {
            dbg('toggle resume: Spotify');
            state.spotifyPlayer.resume();
        } else {
            // Resume local audio element
            if (narrationAudio && narrationAudio.src) {
                dbg('toggle resume: local MP3 (element)');
                narrationAudio.play();
            } else if (state.currentTrack && state.currentTrack.url) {
                // No src set yet, start fresh
                playLocalMP3(state.currentTrack);
            }
        }
        state.isPlaying = true;
    }
    
    updatePlayPauseButton();
}

// No section-based clipping timers are used for Spotify playback

// Resume local audio at a given offset in seconds
function resumeLocalAt(offsetSeconds) {
    if (!state.currentTrack || state.currentTrack.type !== 'mp3' || !narrationAudio) return;
    try {
        narrationAudio.currentTime = Math.max(0, offsetSeconds);
        narrationAudio.play();
        state.audioStartTime = Date.now() - Math.floor(offsetSeconds * 1000);
        state.audioPauseTime = undefined;
    } catch (err) {
        console.error('Error resuming MP3 (element):', err);
        showError('Failed to seek MP3');
    }
}

// Play the next track
function playNext() {
    const nextIndex = (state.currentTrackIndex + 1) % state.playlist.length;
    playTrack(nextIndex);
}

// Play the previous track
function playPrevious() {
    const prevIndex = (state.currentTrackIndex - 1 + state.playlist.length) % state.playlist.length;
    playTrack(prevIndex);
}

// Update the now playing information
function updateNowPlaying({ name, artist, albumArt, duration, position, isPlaying }) {
    if (name !== undefined) trackNameElement.textContent = name;
    if (artist !== undefined) artistNameElement.textContent = artist;
    if (albumArt !== undefined) albumArtElement.src = albumArt || DEFAULT_ALBUM_ART;
    if (duration !== undefined) state.duration = duration;
    if (position !== undefined) state.currentTime = position;
    if (isPlaying !== undefined) state.isPlaying = isPlaying;
    
    // Update the progress bar
    updateProgress();
    
    // Update the play/pause button
    updatePlayPauseButton();

    // Toggle LOCAL badge in Now Playing
    if (localBadgeElement) {
        if (state.isSpotifyTrack) {
            localBadgeElement.classList.add('hidden');
        } else {
            localBadgeElement.classList.remove('hidden');
        }
    }
}

// Update the progress bar
function updateProgress() {
    if (state.isPlaying) {
        if (state.isSpotifyTrack) {
            // For Spotify, prefer player_state_changed but also poll current state for smooth updates
            try {
                if (state.spotifyPlayer && typeof state.spotifyPlayer.getCurrentState === 'function') {
                    state.spotifyPlayer.getCurrentState().then(s => {
                        if (!s) return; // device not active
                        const pos = Number.isFinite(s.position) ? s.position : state.currentTime;
                        const dur = Number.isFinite(s.duration) ? s.duration : state.duration;
                        state.currentTime = pos;
                        state.duration = dur;
                        // Persist duration on the current playlist item for display
                        try {
                            const idx = state.currentTrackIndex;
                            const plItem = state.playlist && state.playlist[idx];
                            if (plItem && (!plItem.duration || plItem.duration === 0) && Number.isFinite(dur) && dur > 0) {
                                plItem.duration = dur;
                                renderPlaylist();
                            }
                        } catch {}
                        const progress = state.duration ? (state.currentTime / state.duration) * 100 : 0;
                        progressBar.style.width = `${progress}%`;
                        currentTimeElement.textContent = formatTime(state.currentTime);
                        durationElement.textContent = formatTime(state.duration);
                    }).catch(() => {});
                } else {
                    const progress = state.duration ? (state.currentTime / state.duration) * 100 : 0;
                    progressBar.style.width = `${progress}%`;
                    currentTimeElement.textContent = formatTime(state.currentTime);
                    durationElement.textContent = formatTime(state.duration);
                }
            } catch {
                const progress = state.duration ? (state.currentTime / state.duration) * 100 : 0;
                progressBar.style.width = `${progress}%`;
                currentTimeElement.textContent = formatTime(state.currentTime);
                durationElement.textContent = formatTime(state.duration);
            }
        } else if (narrationAudio) {
            // For local MP3 via HTMLAudioElement, use element timing
            const durSec = (isFinite(narrationAudio.duration) && narrationAudio.duration > 0)
                ? narrationAudio.duration
                : (state.duration ? state.duration / 1000 : 0);
            const curSec = narrationAudio.currentTime || 0;
            state.duration = Math.max(0, durSec * 1000);
            state.currentTime = Math.max(0, curSec * 1000);

            const progress = state.duration ? (state.currentTime / state.duration) * 100 : 0;
            progressBar.style.width = `${progress}%`;

            // Update time display
            currentTimeElement.textContent = formatTime(state.currentTime);
            durationElement.textContent = formatTime(state.duration);
        }
    }
    
    // Continue the animation loop
    requestAnimationFrame(updateProgress);
}

// Format time in ms to MM:SS
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Update the play/pause button
function updatePlayPauseButton() {
    if (state.isPlaying) {
        playPauseButton.textContent = '⏸';
        playPauseButton.title = 'Pause';
    } else {
        playPauseButton.textContent = '▶';
        playPauseButton.title = 'Play';
    }
}

// Show an error message
function showError(message) {
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
    
    // Hide the error after 5 seconds
    setTimeout(() => {
        errorElement.classList.add('hidden');
    }, 5000);
}

// Show access denied overlay when user is not added to developer dashboard
function showAccessDeniedOverlay() {
    // Only show once per session
    if (state.accessDeniedShown) return;
    state.accessDeniedShown = true;
    
    const overlay = document.getElementById('access-denied-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

// Initialize the player when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    // Check if we have an access token in the URL
    parseHash();
    // If already authenticated, refresh My Playlists immediately
    if (state.accessToken) {
        try { refreshMyPlaylists(); } catch {}
    }
    
    // Ensure login button works on the index page before auth
    const loginBtn = document.getElementById('login-button');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const redirectUri = getRedirectUri();
            // Check if custom credentials are configured
            const creds = getCustomCredentials();
            if (creds && creds.clientId) {
                // Use custom auth flow
                const params = new URLSearchParams({
                    client_id: creds.clientId,
                    redirect_uri: redirectUri
                });
                window.location.href = `/login-custom?${params.toString()}`;
            } else {
                // Use default auth flow
                const params = new URLSearchParams({
                    redirect_uri: redirectUri
                });
                window.location.href = `/login?${params.toString()}`;
            }
        });
    }
    
    // Set up keyboard shortcuts (ignore when typing in inputs/textareas/contenteditable)
    document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
        if (isTyping) {
            return; // don't hijack keys while user is typing
        }
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowRight':
                if (e.ctrlKey) playNext();
                break;
            case 'ArrowLeft':
                if (e.ctrlKey) playPrevious();
                break;
            case 'ArrowUp':
                if (e.ctrlKey) {
                    const newVolume = Math.min(state.volume + 0.1, 1);
                    state.volume = newVolume;
                    volumeControl.value = newVolume * 100;
                    if (state.spotifyPlayer) {
                        state.spotifyPlayer.setVolume(newVolume);
                    }
                }
                break;
            case 'ArrowDown':
                if (e.ctrlKey) {
                    const newVolume = Math.max(state.volume - 0.1, 0);
                    state.volume = newVolume;
                    volumeControl.value = newVolume * 100;
                    if (state.spotifyPlayer) {
                        state.spotifyPlayer.setVolume(newVolume);
                    }
                }
                break;
        }
    });

    // Reconnect to an existing job (for page refresh or clicking pending job)
    function reconnectToJob(jobId) {
        dbg('Reconnecting to job', { jobId });
        
        // Show spinner
        try { if (docSpinner) docSpinner.classList.remove('hidden'); } catch {}
        try { if (generateDocBtn) generateDocBtn.disabled = true; } catch {}
        state.isGeneratingDoc = true;
        
        // Connect to job stream
        connectToJobStream(jobId);
    }
    
    // Connect to SSE stream for a job
    function connectToJobStream(jobId) {
        const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);
        
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                dbg('SSE event', data);
                
                if (data.type === 'init' || data.type === 'progress') {
                    // Update status with detailed progress
                    const statusText = `${data.stageLabel}${data.detail ? ': ' + data.detail : ''} (${Math.round(data.progress)}%)`;
                    if (docStatusEl) docStatusEl.textContent = statusText;
                    if (docSpinnerText) docSpinnerText.textContent = statusText;
                    
                    // Update My Playlists to show progress
                    refreshMyPlaylists().catch(() => {});
                } else if (data.type === 'complete') {
                    eventSource.close();
                    dbg('Job complete', data.result);
                    handleJobComplete(data.result);
                } else if (data.type === 'error') {
                    eventSource.close();
                    if (docStatusEl) docStatusEl.textContent = `Job failed: ${data.error}`;
                    try { if (docSpinner) docSpinner.classList.add('hidden'); } catch {}
                    try { if (generateDocBtn) generateDocBtn.disabled = false; } catch {}
                    state.isGeneratingDoc = false;
                    refreshMyPlaylists().catch(() => {});
                }
            } catch (err) {
                console.error('SSE parse error', err);
            }
        };
        
        eventSource.onerror = (err) => {
            console.error('SSE error', err);
            eventSource.close();
            if (docStatusEl) docStatusEl.textContent = 'Connection error. Check "My Playlists" for result.';
            try { if (docSpinner) docSpinner.classList.add('hidden'); } catch {}
            try { if (generateDocBtn) generateDocBtn.disabled = false; } catch {}
            state.isGeneratingDoc = false;
        };
    }
    
    // Handle job completion
    async function handleJobComplete(result) {
        try {
            const drafted = result?.data;
            const playlistId = result?.playlistId;
            
            if (!drafted || !playlistId) {
                throw new Error('Invalid job result');
            }
            
            // TTS is now generated server-side, just load the playlist
            try { 
                if (docStatusEl) docStatusEl.textContent = 'Loading documentary...';
                if (docSpinnerText) docSpinnerText.textContent = 'Loading documentary...';
            } catch {}
            
            if (saveStatusEl) {
                const shareUrl = `${window.location.origin}/player.html?playlistId=${playlistId}`;
                saveStatusEl.textContent = `Saved as: ${drafted.title || 'Music history'} — Share ID: ${playlistId} — ${shareUrl}`;
            }
            
            try { await refreshMyPlaylists(); } catch {}
            buildFromDoc(drafted);
        } catch (err) {
            console.error('Load failed', err);
            if (docStatusEl) docStatusEl.textContent = 'Documentary created. Check "My Playlists".';
        } finally {
            try { if (docSpinner) docSpinner.classList.add('hidden'); } catch {}
            try { if (generateDocBtn) generateDocBtn.disabled = false; } catch {}
            state.isGeneratingDoc = false;
        }
    }

    // Documentary generator (two-stage flow when Spotify token is available)
    async function handleGenerateDocClick() {
        if (state.isGeneratingDoc) {
            dbg('Generate clicked while already generating – ignoring');
            return;
        }
        state.isGeneratingDoc = true;
        // UI: show spinner and disable button
        try { if (docSpinner) docSpinner.classList.remove('hidden'); } catch {}
        try { if (generateDocBtn) generateDocBtn.disabled = true; } catch {}
        try { if (docStatusEl) docStatusEl.textContent = 'Generating outline…'; } catch {}
        try { if (docRawDetails) { docRawDetails.classList.add('hidden'); docRawDetails.open = false; } } catch {}
        const topic = (docTopicInput && docTopicInput.value ? docTopicInput.value : '').trim();
        const prompt = (docPromptEl && docPromptEl.value ? docPromptEl.value : '').trim();
        if (!topic) {
            if (docStatusEl) docStatusEl.textContent = 'Please enter a topic (e.g., The Beatles).';
            // hide spinner and re-enable
            try { if (docSpinner) docSpinner.classList.add('hidden'); } catch {}
            try { if (generateDocBtn) generateDocBtn.disabled = false; } catch {}
            return;
        }
        if (docStatusEl) docStatusEl.textContent = 'Generating outline…';
        // Read narration target seconds from state (already loaded from localStorage)
        const narrationTargetSecs = state.sectionClipSeconds || 30;

        const buildFromDoc = (data) => {
            // Update concise status
            try {
                const items = Array.isArray(data?.timeline) ? data.timeline : [];
                const songs = items.filter(x => x && x.type === 'song').length;
                const narr = items.filter(x => x && x.type === 'narration').length;
                const title = data?.title || (data?.topic ? `Music history: ${data.topic}` : 'Music history');
                if (docStatusEl) docStatusEl.textContent = `Generated: ${title} — ${songs} songs, ${narr} narration segments.`;
            } catch {}
            // Populate player doc meta
            try {
                if (docTitleDisplay) docTitleDisplay.textContent = data?.title || '-';
                if (docTopicDisplay) docTopicDisplay.textContent = data?.topic || '-';
                if (docSummaryDisplay) docSummaryDisplay.textContent = data?.summary || '-';
            } catch {}
            // Populate raw JSON and reveal expandable section
            try {
                if (docOutputEl) docOutputEl.textContent = JSON.stringify(data, null, 2);
                if (docRawDetails) docRawDetails.classList.remove('hidden');
            } catch {}
            buildPlaylistFromDoc(data);
        };

        try {
            if (!state.accessToken) {
                throw new Error('Spotify login required. Please log in to generate documentaries.');
            }

            const ownerId = await fetchSpotifyUserId();
            
            // Create job and get jobId
            try { 
                if (docStatusEl) docStatusEl.textContent = 'Starting documentary generation...';
                if (docSpinnerText) docSpinnerText.textContent = 'Starting documentary generation...';
            } catch {}
            
            const docResp = await fetch('/api/music-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    topic, 
                    prompt, 
                    accessToken: state.accessToken,
                    ownerId, 
                    narrationTargetSecs 
                })
            });
            
            if (!docResp.ok) {
                const errText = await docResp.text().catch(() => '');
                throw new Error(`Failed to start job: ${docResp.status} ${errText}`);
            }
            
            const { jobId } = await docResp.json();
            dbg('Job created', { jobId });
            
            // Refresh My Playlists to show the new job
            try { await refreshMyPlaylists(); } catch {}
            
            // Connect to SSE stream for progress updates
            connectToJobStream(jobId);
            
        } catch (err) {
            console.error('doc gen failed', err);
            if (docStatusEl) docStatusEl.textContent = `Generation failed: ${err.message}`;
            try { if (docSpinner) docSpinner.classList.add('hidden'); } catch {}
            try { if (generateDocBtn) generateDocBtn.disabled = false; } catch {}
            state.isGeneratingDoc = false;
        }
    }

    // Attach direct listener when elements are present
    if (generateDocBtn) {
        dbg('Binding click listener for #generate-doc (direct)');
        generateDocBtn.addEventListener('click', handleGenerateDocClick);
    } else {
        dbg('Generate button not found at script parse time');
    }

    // Load by ID
    if (loadIdBtn && loadIdInput) {
        // Trigger load on button click
        loadIdBtn.addEventListener('click', async () => {
            const id = (loadIdInput.value || '').trim();
            if (!id) return;
            // Guard: don't reload if we already loaded this exact playlist id
            if (state.loadedPlaylistId && state.loadedPlaylistId === id) {
                dbg('load-by-id: skipping reload of same id', { id });
                return;
            }
            try {
                if (docStatusEl) docStatusEl.textContent = 'Loading playlist…';
                if (docRawDetails) { docRawDetails.classList.add('hidden'); docRawDetails.open = false; }
                const r = await fetch(`/api/playlists/${encodeURIComponent(id)}`);
                if (!r.ok) throw new Error('Not found');
                const json = await r.json();
                const pl = json?.playlist;
                if (!pl || !Array.isArray(pl.timeline)) throw new Error('Invalid playlist data');
                // Close modal if open
                try {
                    const modal = document.getElementById('import-modal');
                    if (modal && !modal.classList.contains('hidden')) {
                        modal.classList.add('hidden');
                        modal.setAttribute('aria-hidden', 'true');
                    }
                } catch {}
                // Show concise status
                try {
                    const items = Array.isArray(pl.timeline) ? pl.timeline : [];
                    const songs = items.filter(x => x && x.type === 'song').length;
                    const narr = items.filter(x => x && x.type === 'narration').length;
                    const title = pl?.title || (pl?.topic ? `Music history: ${pl.topic}` : 'Music history');
                    if (docStatusEl) docStatusEl.textContent = `Loaded: ${title} — ${songs} songs, ${narr} narration segments.`;
                } catch {}
                // Populate player doc meta from loaded playlist
                try {
                    if (docTitleDisplay) docTitleDisplay.textContent = pl?.title || '-';
                    if (docTopicDisplay) docTopicDisplay.textContent = pl?.topic || '-';
                    if (docSummaryDisplay) docSummaryDisplay.textContent = pl?.summary || '-';
                } catch {}
                // Populate raw and reveal
                try {
                    if (docOutputEl) docOutputEl.textContent = JSON.stringify(pl, null, 2);
                    if (docRawDetails) docRawDetails.classList.remove('hidden');
                } catch {}
                buildPlaylistFromDoc(pl);
                state.loadedPlaylistId = id;
            } catch (e) {
                console.error('load by id error', e);
                if (docStatusEl) docStatusEl.textContent = 'Playlist not found.';
            }
        });
        // Trigger load on Enter key
        loadIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loadIdBtn.click();
            }
        });
    }

    // Hide player sections until something is loaded
    setPlayerSectionsVisible(false);

    // Auto-load by playlistId query param (only when logged in)
    try {
        if (state.accessToken) {
            const params = new URLSearchParams(window.location.search);
            const pid = params.get('playlistId');
            if (pid) {
                if (loadIdInput) loadIdInput.value = pid;
                if (loadIdBtn) loadIdBtn.click();
            }
        }
    } catch {}

    // If no explicit playlistId:
    // Do nothing until logged in. Once logged in:
    // 1) If the user has at least one playlist, load their latest
    // 2) Else, load env-configured initial playlist (server returns from runtime data)
    try {
        if (!state.accessToken) {
            showEmptyState('Login to start. Generate an outline or import a playlist after logging in.');
        } else {
            const params = new URLSearchParams(window.location.search);
            const pid = params.get('playlistId');
            if (!pid) {
                let loaded = false;
                // Try user latest only if logged in
                let ownerId = null;
                if (state.accessToken) {
                    ownerId = await fetchSpotifyUserId();
                }
                if (ownerId) {
                    try {
                        const lr = await fetch(`/api/users/${encodeURIComponent(ownerId)}/playlists`);
                        if (lr.ok) {
                            const ljson = await lr.json();
                            const list = Array.isArray(ljson?.playlists) ? ljson.playlists : [];
                            if (list.length > 0) {
                                const latest = list[0]; // storage sorts desc by createdAt
                                if (latest && Array.isArray(latest.timeline)) {
                                    try {
                                        if (docTitleDisplay) docTitleDisplay.textContent = latest?.title || '-';
                                        if (docTopicDisplay) docTopicDisplay.textContent = latest?.topic || '-';
                                        if (docSummaryDisplay) docSummaryDisplay.textContent = latest?.summary || '-';
                                    } catch {}
                                    try {
                                        if (docOutputEl) docOutputEl.textContent = JSON.stringify(latest, null, 2);
                                        if (docRawDetails) docRawDetails.classList.remove('hidden');
                                    } catch {}
                                    buildPlaylistFromDoc(latest);
                                    if (latest.id) state.loadedPlaylistId = latest.id;
                                    loaded = true;
                                }
                            }
                        }
                    } catch {}
                }

                if (!loaded) {
                    // Fall back to env-configured initial (may be empty)
                    const r = await fetch('/api/initial-playlist');
                    if (r.ok) {
                        const json = await r.json();
                        const initId = json?.id || (json?.playlist && json.playlist.id);
                        const pl = json?.playlist;
                        if (pl && Array.isArray(pl.timeline)) {
                            try {
                                if (docTitleDisplay) docTitleDisplay.textContent = pl?.title || '-';
                                if (docTopicDisplay) docTopicDisplay.textContent = pl?.topic || '-';
                                if (docSummaryDisplay) docSummaryDisplay.textContent = pl?.summary || '-';
                            } catch {}
                            try {
                                if (docOutputEl) docOutputEl.textContent = JSON.stringify(pl, null, 2);
                                if (docRawDetails) docRawDetails.classList.remove('hidden');
                            } catch {}
                            buildPlaylistFromDoc(pl);
                            if (initId) state.loadedPlaylistId = initId;
                        } else {
                            showEmptyState('No default playlist configured. Generate an outline or import one to begin.');
                        }
                    } else {
                        showEmptyState('No default playlist configured. Generate an outline or import one to begin.');
                    }
                }
            }
        }
    } catch {}

    // (removed duplicate My Playlists rendering block)

    // Share button
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            // If we have a recently saved id from save-status text, try to reuse it; otherwise use current loadIdInput
            const text = saveStatusEl ? saveStatusEl.textContent : '';
            let id = '';
            const m = text && text.match(/Share ID:\s*(\w+)/);
            if (m) id = m[1];
            if (!id && loadIdInput) id = (loadIdInput.value || '').trim();
            if (!id) {
                if (saveStatusEl) saveStatusEl.textContent = 'Nothing to share yet. Generate or load a playlist first.';
                return;
            }
            const url = `${window.location.origin}/player.html?playlistId=${id}`;
            try {
                await navigator.clipboard.writeText(url);
                if (saveStatusEl) saveStatusEl.textContent = `Share link copied to clipboard: ${url}`;
            } catch {
                if (saveStatusEl) saveStatusEl.textContent = `Share link: ${url}`;
            }
        });
    }

    // Bind section duration select (default 30s) — affects LLM prompt only, not playback
    if (sectionDurationSelect) {
        const applySectionDuration = () => {
            const val = parseInt(sectionDurationSelect.value, 10);
            state.sectionClipSeconds = Number.isFinite(val) && val > 0 ? val : 30;
            // Persist to localStorage
            try {
                const storage = window.sessionStorage || window.localStorage;
                storage.setItem('narration_target_secs', state.sectionClipSeconds.toString());
            } catch {}
            dbg('section duration set (prompt only)', { seconds: state.sectionClipSeconds });
        };
        // Initialize from localStorage or current value
        try {
            const storage = window.sessionStorage || window.localStorage;
            const stored = storage.getItem('narration_target_secs');
            const n = parseInt(stored, 10);
            if (!isNaN(n) && n > 0) {
                sectionDurationSelect.value = n.toString();
            }
        } catch {}
        applySectionDuration();
        // Update on change
        sectionDurationSelect.addEventListener('change', applySectionDuration);
    }

    // Theme Toggle Handler
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // Settings Modal Handlers
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            // Load current credentials into form
            const creds = getCustomCredentials();
            if (creds) {
                if (customClientIdInput) customClientIdInput.value = creds.clientId || '';
                if (customClientSecretInput) customClientSecretInput.value = creds.clientSecret || '';
            } else {
                if (customClientIdInput) customClientIdInput.value = '';
                if (customClientSecretInput) customClientSecretInput.value = '';
            }
            // Always show current redirect URI (read-only, for reference)
            if (customRedirectUriInput) customRedirectUriInput.value = getRedirectUri();
            if (settingsModal) settingsModal.classList.remove('hidden');
        });
    }

    if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.add('hidden');
        });
    }

    if (saveCredentialsBtn) {
        saveCredentialsBtn.addEventListener('click', () => {
            const clientId = customClientIdInput ? customClientIdInput.value.trim() : '';
            const clientSecret = customClientSecretInput ? customClientSecretInput.value.trim() : '';

            if (!clientId || !clientSecret) {
                alert('Please enter both Client ID and Client Secret');
                return;
            }

            saveCustomCredentials(clientId, clientSecret);
            alert('Credentials saved! Please refresh the page and log in again with your credentials.');
            if (settingsModal) settingsModal.classList.add('hidden');
        });
    }

    if (clearCredentialsBtn) {
        clearCredentialsBtn.addEventListener('click', () => {
            if (confirm('Clear custom credentials and use default app credentials?')) {
                clearCustomCredentials();
                alert('Credentials cleared! Refresh the page to use default credentials.');
                if (settingsModal) settingsModal.classList.add('hidden');
            }
        });
    }

    if (openSettingsFromDenied) {
        openSettingsFromDenied.addEventListener('click', () => {
            const accessDeniedOverlay = document.getElementById('access-denied-overlay');
            if (accessDeniedOverlay) accessDeniedOverlay.classList.add('hidden');
            if (settingsBtn) settingsBtn.click();
        });
    }
});
