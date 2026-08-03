/**
 * Desktop Agent Rate Limiting Manager
 * Handles API rate limiting, request queuing, and abuse detection for desktop agent
 */

const EventEmitter = require('events');

class RateLimitManager extends EventEmitter {
  constructor() {
    super();
    this.requestHistory = [];
    this.blockedEndpoints = new Map();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.rateLimitStatus = {
      remaining: null,
      limit: null,
      resetAt: null
    };
  }

  /**
   * Process API response headers for rate limit information
   */
  processResponse(response) {
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
      const resetAt = new Date(Date.now() + retryAfter * 1000);

      this.rateLimitStatus = {
        remaining: 0,
        limit: parseInt(response.headers['x-ratelimit-limit'] || '0', 10),
        resetAt
      };

      this.emit('rateLimited', {
        retryAfter,
        resetAt,
        status: response.status
      });

      return true;
    }

    // Update rate limit status from headers
    if (response.headers['x-ratelimit-remaining']) {
      this.rateLimitStatus = {
        remaining: parseInt(response.headers['x-ratelimit-remaining'], 10),
        limit: parseInt(response.headers['x-ratelimit-limit'], 10),
        resetAt: new Date(parseInt(response.headers['x-ratelimit-reset'], 10) * 1000)
      };

      this.emit('rateLimitUpdated', this.rateLimitStatus);
    }

    return false;
  }

  /**
   * Check if should queue request or make directly
   */
  shouldQueueRequest() {
    return this.rateLimitStatus.remaining !== null &&
           this.rateLimitStatus.remaining <= 5;
  }

  /**
   * Queue request for retry
   */
  queueRequest(request) {
    this.requestQueue.push({
      request,
      timestamp: new Date(),
      retryCount: 0
    });

    this.emit('requestQueued', {
      queueLength: this.requestQueue.length,
      queued: true
    });

    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * Process queued requests with exponential backoff
   */
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;
    let delay = 1000;

    while (this.requestQueue.length > 0) {
      const { resetAt } = this.rateLimitStatus;
      if (resetAt && new Date() < resetAt) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const { request, retryCount } = this.requestQueue.shift();
      try {
        await request();
        this.emit('queuedRequestProcessed', { success: true, retryCount });
        delay = 1000;
      } catch (error) {
        if (error.status === 429) {
          this.requestQueue.unshift({ request, timestamp: new Date(), retryCount: retryCount + 1 });
          delay = Math.min(delay * 2, 30000);
          this.emit('queuedRequestFailed', { error: error.message, retryCount });
        }
      }
    }

    this.isProcessingQueue = false;
    this.emit('queueProcessingComplete');
  }

  /**
   * Block endpoint temporarily
   */
  blockEndpoint(endpoint, durationSeconds = 60) {
    const unblockTime = new Date(Date.now() + durationSeconds * 1000);
    this.blockedEndpoints.set(endpoint, unblockTime);
    this.emit('endpointBlocked', { endpoint, unblockTime });

    setTimeout(() => {
      this.blockedEndpoints.delete(endpoint);
      this.emit('endpointUnblocked', { endpoint });
    }, durationSeconds * 1000);
  }

  /**
   * Check if endpoint is blocked
   */
  isEndpointBlocked(endpoint) {
    if (!this.blockedEndpoints.has(endpoint)) return false;

    const unblockTime = this.blockedEndpoints.get(endpoint);
    if (new Date() >= unblockTime) {
      this.blockedEndpoints.delete(endpoint);
      return false;
    }
    return true;
  }

  /**
   * Record API call for rate limit tracking
   */
  recordApiCall(endpoint) {
    this.requestHistory.push({
      endpoint,
      timestamp: new Date()
    });

    // Keep only last 5 minutes of history
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000);
    this.requestHistory = this.requestHistory.filter(call => call.timestamp > fiveMinutesAgo);
  }

  /**
   * Get current rate limit status
   */
  getStatus() {
    return {
      ...this.rateLimitStatus,
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessingQueue,
      blockedEndpoints: Array.from(this.blockedEndpoints.keys())
    };
  }

  /**
   * Reset rate limit tracking
   */
  reset() {
    this.requestHistory = [];
    this.blockedEndpoints.clear();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.rateLimitStatus = {
      remaining: null,
      limit: null,
      resetAt: null
    };
  }
}

module.exports = RateLimitManager;
