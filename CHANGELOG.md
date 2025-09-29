# Changelog

## Major Refactor: Intelligent Track Selection & Multi-Stage Documentary Generation

### Overview
Completely redesigned the music documentary generation workflow to prioritize **intentional, narrative-driven track selection** over mechanical sampling.

### Key Changes

#### 1. Multi-Stage Documentary Workflow
**Old Approach**: Fetch random tracks from albums → LLM picks from whatever is available
**New Approach**: LLM plans documentary first → Search for specific tracks → Generate final doc

**Stages**:
1. **Identify Artist** - Normalize artist name, get Spotify ID
2. **Plan Documentary** (NEW) - LLM creates outline with specific track requirements
3. **Targeted Track Search** (NEW) - Search Spotify for exact tracks the LLM requested
4. **Backup Catalog** - Fetch broader catalog only if tracks are missing
5. **Final Generation** - LLM creates timeline following the plan

#### 2. New Services & Prompts

**Created**:
- `src/services/musicPlan.js` - Documentary planning service
- `src/services/trackSearch.js` - Targeted Spotify track search
- `src/prompts/musicPlan/system.txt` - Planning instructions
- `src/prompts/musicPlan/user.txt` - Planning prompt template

**Planning Output**:
```json
{
  "title": "Documentary title",
  "narrative_arc": "Story overview",
  "era_covered": "Time period",
  "required_tracks": [
    {
      "song_title": "Track name",
      "approximate_year": "1994",
      "album_name": "Album",
      "why_essential": "Narrative importance",
      "narrative_role": "breakthrough moment / evolution / etc"
    }
  ]
}
```

#### 3. TTS Voice Instructions (British Accent)

**Created**:
- `src/prompts/tts/instructions.txt` - Voice persona instructions
- `src/prompts/tts/input.txt` - Input template

**Features**:
- British accent (RP or London)
- Enigmatic, passionate music journalist/DJ persona
- Detailed control over: voice affect, tone, pacing, emotion, emphasis, pronunciation, pauses
- References BBC Radio 6 Music and legendary DJs (John Peel, Gilles Peterson)

**Updated**:
- `src/services/tts.js` - Loads and applies instructions
- `src/routes/tts.js` - Supports optional per-request instruction overrides

#### 4. Improved Album Distribution

**Updated**: `src/routes/spotify.js` - `/api/artist-tracks`

**Old Logic**:
- Fetched albums and stopped as soon as 100 tracks reached
- Only processed ~5 albums (heavy bias toward recent releases)
- Missing classic/early work

**New Logic**:
- Fetches ALL albums first (up to 200)
- Calculates tracks per album dynamically for broad coverage
- Samples from 30-50 albums across entire career
- Better chronological representation

#### 5. Frontend Simplification

**Updated**: `public/player.js`

**Removed**:
- Complex 3-stage manual workflow (identify → fetch catalog → generate)
- Fallback logic for missing artists
- Redundant catalog fetching

**New**:
- Single call to `/api/music-doc` with `accessToken`
- Server handles all stages internally
- Cleaner error handling

#### 6. Configuration Improvements

**Updated**:
- `nodemon.json` - Now watches `.env` file for auto-restart
- `.env.example` - Added voice recommendations (nova/onyx for music journalism)

#### 7. localStorage Persistence Fix

**Fixed**: `public/player.js`
- Narration duration selection now persists to localStorage
- Restores saved value on page load
- Fixes issue where selection was always defaulting to 30 seconds

### Removed Files
- `src/routes/musicDoc.js` (old version) - Replaced with multi-stage version
- `MUSIC_DOC_V2.md` - Merged into README

### API Changes

#### `/api/music-doc` (Updated)
**Request**:
```json
{
  "topic": "The Prodigy",
  "accessToken": "spotify_token",  // NOW REQUIRED
  "prompt": "Optional instructions",
  "ownerId": "user_id",
  "narrationTargetSecs": 180
}
```

**Response**:
```json
{
  "ok": true,
  "data": { "title": "...", "timeline": [...] },
  "playlistId": "saved_id",
  "plan": { /* documentary plan */ },
  "trackSearchResults": {
    "found": 5,
    "missing": 0,
    "backup": 20
  }
}
```

### Benefits

1. **Intentional Track Selection**: LLM chooses tracks based on narrative importance, not random sampling
2. **Better Chronological Coverage**: Samples from entire career, not just recent albums
3. **Narrative Coherence**: Final documentary follows pre-planned story structure
4. **Transparency**: Plan and search results returned for debugging
5. **Voice Personality**: TTS now has distinctive British music journalist character
6. **Simpler Frontend**: One API call instead of complex orchestration
7. **Better UX**: Settings persist, clearer status messages

### Migration Notes

- **Breaking Change**: `/api/music-doc` now requires `accessToken` parameter
- Users must be logged in to Spotify to generate documentaries
- Old single-call flow (without catalog) has been removed

### Example: The Prodigy

**Before**:
- Fetched 100 tracks from 5 recent albums
- Missing "Experience" (1992), "Music for the Jilted Generation" (1994)
- LLM had to work with whatever tracks happened to be sampled

**After**:
1. Plan identifies essential tracks: "Charly" (1992), "Out of Space" (1992), "Voodoo People" (1994), "Firestarter" (1996), "Breathe" (1996)
2. Searches for those exact tracks
3. Finds all 5 + fetches 20 backup tracks
4. LLM creates documentary following the plan with proper chronological flow

### Testing

Restart the server to pick up all changes:
```bash
npm run dev
```

Generate a documentary and check debug logs for:
```
[DBG] music-doc: stage 1 - identify artist
[DBG] music-doc: stage 2 - plan documentary
[DBG] musicPlan: request
[DBG] music-doc: stage 3 - search for required tracks
[DBG] trackSearch: found
[DBG] music-doc: stage 5 - generate final documentary
```
