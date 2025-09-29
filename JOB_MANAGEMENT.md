# Multi-User Job Management with SSE

## Overview

Implemented Server-Sent Events (SSE) based job management for documentary generation with real-time progress updates.

## Features

✅ **Multi-user support** - Each user (Spotify ID) can have up to 2 concurrent jobs
✅ **Real-time progress** - SSE streams detailed progress updates to client
✅ **Survives page refresh** - Jobs continue in background, reconnect on refresh
✅ **Sub-stage detail** - Shows specific progress like "Searching for track 3/5"
✅ **Automatic cleanup** - Completed jobs removed after 1 hour
✅ **Error handling** - Graceful degradation if connection drops

## Architecture

### Backend Components

#### 1. Job Manager (`src/services/jobManager.js`)
- In-memory job storage (Map)
- Tracks user jobs (max 2 per user)
- EventEmitter for progress updates
- Automatic cleanup of old jobs

#### 2. Jobs Route (`src/routes/jobs.js`)
- `GET /api/jobs/:jobId/stream` - SSE endpoint for progress
- `GET /api/jobs/:jobId` - REST endpoint for job status
- `GET /api/users/:userId/jobs` - List user's jobs
- `GET /api/jobs/stats` - Job manager stats

#### 3. Music Doc Route (`src/routes/musicDoc.js`)
- Creates job immediately, returns jobId
- Processes documentary asynchronously
- Emits progress at each stage
- Handles errors gracefully

### Frontend Components

#### SSE Connection (`public/player.js`)
- Connects to `/api/jobs/:jobId/stream`
- Receives real-time progress events
- Updates UI with detailed status
- Handles completion and errors
- Auto-reconnects on page refresh

## Flow

```
User clicks "Generate"
  ↓
POST /api/music-doc
  ← Returns { jobId: "job_123..." } immediately
  ↓
Client connects to GET /api/jobs/job_123/stream (SSE)
  ↓
Server emits progress events:
  → { type: "progress", stage: 1, stageLabel: "Identifying artist", progress: 10%, detail: "Searching..." }
  → { type: "progress", stage: 2, stageLabel: "Planning documentary", progress: 25%, detail: "AI creating outline..." }
  → { type: "progress", stage: 3, stageLabel: "Searching for tracks", progress: 40%, detail: "Finding specific tracks..." }
  → { type: "progress", stage: 5, stageLabel: "Generating documentary", progress: 65%, detail: "AI creating timeline..." }
  → { type: "progress", stage: 6, stageLabel: "Saving playlist", progress: 85%, detail: "Persisting..." }
  → { type: "complete", result: { data, playlistId, plan } }
  ↓
Client generates TTS and builds playlist
  ↓
Done!
```

## Progress Stages

| Stage | Label | Progress | Details |
|-------|-------|----------|---------|
| 1 | Identifying artist | 10-20% | Searching Spotify, fetching top tracks |
| 2 | Planning documentary | 25-35% | LLM creating narrative outline |
| 3 | Searching for tracks | 40-50% | Finding specific tracks on Spotify |
| 4 | Fetching backup catalog | 55-60% | Loading alternatives if tracks missing |
| 5 | Generating documentary | 65-75% | LLM creating final timeline |
| 6 | Saving playlist | 85-95% | Persisting to filesystem |
| - | Complete | 100% | Job done |

## API Endpoints

### Create Job
```http
POST /api/music-doc
Content-Type: application/json

{
  "topic": "Deftones",
  "prompt": "Focus on experimental phase",
  "accessToken": "spotify_token",
  "ownerId": "spotify_user_id",
  "narrationTargetSecs": 180
}

Response:
{
  "ok": true,
  "jobId": "job_1234567890_abc123"
}
```

### Stream Progress (SSE)
```http
GET /api/jobs/job_1234567890_abc123/stream

Response (text/event-stream):
data: {"type":"init","jobId":"job_123","status":"running","stage":1,"progress":10}

data: {"type":"progress","stage":2,"stageLabel":"Planning","progress":25,"detail":"AI creating outline..."}

data: {"type":"complete","result":{"data":{...},"playlistId":"xyz"}}
```

### Get Job Status
```http
GET /api/jobs/job_1234567890_abc123

Response:
{
  "ok": true,
  "job": {
    "id": "job_123",
    "userId": "spotify_user_id",
    "status": "running",
    "stage": 3,
    "stageLabel": "Searching for tracks",
    "progress": 45,
    "createdAt": "2025-09-30T06:00:00Z",
    "updatedAt": "2025-09-30T06:01:30Z"
  }
}
```

## Job Lifecycle

1. **Created** - Job added to manager, status: `pending`
2. **Running** - Processing started, status: `running`
3. **Progress** - Emits events at each sub-stage
4. **Completed** - Success, status: `completed`, result stored
5. **Failed** - Error occurred, status: `failed`, error stored
6. **Cleanup** - Removed after 1 hour if completed/failed

## Concurrent Job Limits

- **Max 2 jobs per user** simultaneously
- Additional requests return 429 error
- Jobs are tracked by Spotify user ID
- Completed jobs don't count toward limit

## Error Handling

### Server Errors
- Job marked as `failed`
- Error message stored in job
- SSE emits `{ type: "error", error: "message" }`

### Connection Errors
- Client shows: "Connection error. Check My Playlists"
- Job continues in background
- User can check "My Playlists" for result
- Can reconnect by refreshing page

### Page Refresh
- SSE connection drops
- Job continues processing
- User can reconnect to same jobId
- If job complete, shows final state immediately

## Memory Management

- Jobs stored in-memory (lost on server restart)
- Automatic cleanup every hour
- Removes completed/failed jobs older than 1 hour
- EventEmitters cleaned up on client disconnect

## Testing

### Start a Job
```bash
curl -X POST http://localhost:8888/api/music-doc \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Radiohead",
    "accessToken": "YOUR_TOKEN",
    "ownerId": "YOUR_USER_ID",
    "narrationTargetSecs": 180
  }'
```

### Stream Progress
```bash
curl -N http://localhost:8888/api/jobs/JOB_ID/stream
```

### Check Stats
```bash
curl http://localhost:8888/api/jobs/stats
```

## Future Enhancements

- [ ] Persistent storage (filesystem/database)
- [ ] Job queue for rate limiting
- [ ] Retry failed stages
- [ ] Cancel running jobs
- [ ] Job history/logs
- [ ] WebSocket fallback for SSE
- [ ] Progress bar UI component
- [ ] Email notification on completion
