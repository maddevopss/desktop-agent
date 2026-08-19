/**
 * Desktop Agent Rate Limit Manager Tests
 */

const RateLimitManager = require('../rateLimitManager');

describe('RateLimitManager', () => {
  let manager;

  beforeEach(() => {
    manager = new RateLimitManager();
  });

  test('should process 429 response and emit rateLimited event', (done) => {
    const response = {
      status: 429,
      headers: {
        'retry-after': '60',
        'x-ratelimit-limit': '100'
      }
    };

    manager.on('rateLimited', (data) => {
      expect(data.retryAfter).toBe(60);
      expect(data.status).toBe(429);
      done();
    });

    const result = manager.processResponse(response);
    expect(result).toBe(true);
  });

  test('should update rate limit status from headers', (done) => {
    const response = {
      status: 200,
      headers: {
        'x-ratelimit-remaining': '95',
        'x-ratelimit-limit': '100',
        'x-ratelimit-reset': `${Math.floor(Date.now() / 1000) + 3600}`
      }
    };

    manager.on('rateLimitUpdated', (status) => {
      expect(status.remaining).toBe(95);
      expect(status.limit).toBe(100);
      done();
    });

    manager.processResponse(response);
  });

  test('should determine when to queue requests', () => {
    manager.rateLimitStatus = {
      remaining: 3,
      limit: 100,
      resetAt: new Date()
    };

    expect(manager.shouldQueueRequest()).toBe(true);

    manager.rateLimitStatus.remaining = 10;
    expect(manager.shouldQueueRequest()).toBe(false);
  });

  test('should queue request and emit event', (done) => {
    const mockRequest = jest.fn();

    manager.on('requestQueued', (data) => {
      expect(data.queueLength).toBe(1);
      expect(data.queued).toBe(true);
      done();
    });

    manager.queueRequest(mockRequest);
  });

  test('should block endpoint temporarily', (done) => {
    manager.on('endpointBlocked', (data) => {
      expect(data.endpoint).toBe('/api/sensitive');
      done();
    });

    manager.blockEndpoint('/api/sensitive', 1);
  });

  test('should check if endpoint is blocked', () => {
    manager.blockEndpoint('/api/test', 10);
    expect(manager.isEndpointBlocked('/api/test')).toBe(true);
    expect(manager.isEndpointBlocked('/api/other')).toBe(false);
  });

  test('should record API calls', () => {
    manager.recordApiCall('/api/endpoint1');
    manager.recordApiCall('/api/endpoint2');

    expect(manager.requestHistory.length).toBe(2);
    expect(manager.requestHistory[0].endpoint).toBe('/api/endpoint1');
  });

  test('should get current status', () => {
    manager.rateLimitStatus = {
      remaining: 50,
      limit: 100,
      resetAt: new Date()
    };

    const status = manager.getStatus();
    expect(status.remaining).toBe(50);
    expect(status.queueLength).toBe(0);
    expect(status.isProcessing).toBe(false);
  });

  test('should reset rate limit tracking', () => {
    manager.rateLimitStatus = {
      remaining: 50,
      limit: 100,
      resetAt: new Date()
    };
    manager.recordApiCall('/api/test');
    manager.blockEndpoint('/api/blocked');

    manager.reset();

    expect(manager.requestHistory.length).toBe(0);
    expect(manager.rateLimitStatus.remaining).toBeNull();
    expect(manager.blockedEndpoints.size).toBe(0);
  });
});
