const express = require('express');
const jobManager = require('../services/jobManager');
const { dbg } = require('../utils/logger');

const router = express.Router();

/**
 * SSE endpoint for job progress streaming
 * Client connects and receives real-time updates
 */
router.get('/api/jobs/:jobId/stream', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial state
  res.write(`data: ${JSON.stringify({
    type: 'init',
    jobId,
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    progress: job.progress,
  })}\n\n`);

  dbg('SSE: client connected', { jobId, userId: job.userId });

  // If job already completed/failed, send final event and close
  if (job.status === 'completed') {
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      jobId,
      result: job.result,
    })}\n\n`);
    return res.end();
  }

  if (job.status === 'failed') {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      jobId,
      error: job.error,
    })}\n\n`);
    return res.end();
  }

  // Subscribe to job events
  const unsubscribe = jobManager.subscribe(
    jobId,
    // onProgress
    (data) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`);
    },
    // onComplete
    (data) => {
      res.write(`data: ${JSON.stringify({ type: 'complete', ...data })}\n\n`);
      res.end();
    },
    // onError
    (data) => {
      res.write(`data: ${JSON.stringify({ type: 'error', ...data })}\n\n`);
      res.end();
    }
  );

  // Heartbeat to keep connection alive (every 30s)
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
    dbg('SSE: client disconnected', { jobId });
  });
});

/**
 * Get job status (REST endpoint for polling fallback)
 */
router.get('/api/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Return job status without emitter
  const { emitter, ...jobData } = job;
  res.json({ ok: true, job: jobData });
});

/**
 * Get all jobs for a user
 */
router.get('/api/users/:userId/jobs', (req, res) => {
  const { userId } = req.params;
  const jobs = jobManager.getUserJobs(userId);

  // Remove emitters from response
  const jobsData = jobs.map(({ emitter, ...job }) => job);
  res.json({ ok: true, jobs: jobsData });
});

/**
 * Get job manager stats (for debugging)
 */
router.get('/api/jobs/stats', (req, res) => {
  const stats = jobManager.getStats();
  res.json({ ok: true, stats });
});

module.exports = router;
