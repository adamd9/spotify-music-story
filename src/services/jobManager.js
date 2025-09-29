const { EventEmitter } = require('events');
const { dbg } = require('../utils/logger');

/**
 * In-memory job manager for multi-user documentary generation
 * - Max 2 concurrent jobs per user
 * - SSE-based progress streaming
 * - Jobs survive page refresh (until server restart)
 */
class JobManager {
  constructor() {
    // Map<jobId, Job>
    this.jobs = new Map();
    // Map<userId, Set<jobId>>
    this.userJobs = new Map();
    // Cleanup completed jobs after 1 hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Create a new job
   * @param {string} userId - Spotify user ID
   * @param {object} params - Job parameters (topic, prompt, etc.)
   * @returns {object} Job object with id
   */
  createJob(userId, params) {
    // Check concurrent job limit
    const userJobIds = this.userJobs.get(userId) || new Set();
    const activeJobs = Array.from(userJobIds)
      .map(id => this.jobs.get(id))
      .filter(job => job && (job.status === 'pending' || job.status === 'running'));
    
    if (activeJobs.length >= 2) {
      throw new Error('Maximum 2 concurrent jobs per user. Please wait for existing jobs to complete.');
    }

    const jobId = this.generateJobId();
    const job = {
      id: jobId,
      userId,
      params,
      status: 'pending', // pending, running, completed, failed
      stage: 0,
      stageLabel: 'Queued',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      emitter: new EventEmitter(),
    };

    this.jobs.set(jobId, job);
    
    // Track user's jobs
    if (!this.userJobs.has(userId)) {
      this.userJobs.set(userId, new Set());
    }
    this.userJobs.get(userId).add(jobId);

    dbg('jobManager: created', { jobId, userId, activeJobs: activeJobs.length + 1 });
    return job;
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs for a user
   */
  getUserJobs(userId) {
    const jobIds = this.userJobs.get(userId) || new Set();
    return Array.from(jobIds)
      .map(id => this.jobs.get(id))
      .filter(job => job)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Update job progress
   */
  updateProgress(jobId, update) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    Object.assign(job, {
      ...update,
      updatedAt: new Date().toISOString(),
    });

    // Emit progress event to SSE clients
    job.emitter.emit('progress', {
      jobId,
      status: job.status,
      stage: job.stage,
      stageLabel: job.stageLabel,
      progress: job.progress,
      detail: update.detail,
    });

    dbg('jobManager: progress', { 
      jobId, 
      stage: job.stage, 
      stageLabel: job.stageLabel, 
      progress: job.progress 
    });
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId, result) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.result = result;
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();

    job.emitter.emit('complete', {
      jobId,
      result,
    });

    dbg('jobManager: completed', { jobId, userId: job.userId });
  }

  /**
   * Mark job as failed
   */
  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.error = error.message || String(error);
    job.completedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();

    job.emitter.emit('error', {
      jobId,
      error: job.error,
    });

    dbg('jobManager: failed', { jobId, error: job.error });
  }

  /**
   * Subscribe to job progress (for SSE)
   */
  subscribe(jobId, onProgress, onComplete, onError) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    job.emitter.on('progress', onProgress);
    job.emitter.on('complete', onComplete);
    job.emitter.on('error', onError);

    // Return unsubscribe function
    return () => {
      job.emitter.off('progress', onProgress);
      job.emitter.off('complete', onComplete);
      job.emitter.off('error', onError);
    };
  }

  /**
   * Cleanup old completed jobs
   */
  cleanup() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.completedAt &&
        new Date(job.completedAt).getTime() < oneHourAgo
      ) {
        // Remove from user's job set
        const userJobIds = this.userJobs.get(job.userId);
        if (userJobIds) {
          userJobIds.delete(jobId);
          if (userJobIds.size === 0) {
            this.userJobs.delete(job.userId);
          }
        }
        
        // Remove job
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      dbg('jobManager: cleanup', { cleaned, remaining: this.jobs.size });
    }
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get stats
   */
  getStats() {
    const stats = {
      total: this.jobs.size,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      users: this.userJobs.size,
    };

    for (const job of this.jobs.values()) {
      stats[job.status]++;
    }

    return stats;
  }

  /**
   * Shutdown
   */
  shutdown() {
    clearInterval(this.cleanupInterval);
    dbg('jobManager: shutdown', this.getStats());
  }
}

// Singleton instance
const jobManager = new JobManager();

module.exports = jobManager;
