/**
 * Token-bucket rate limiter for outbound Pixalate requests.
 * Configurable requests-per-minute; acquire() resolves when a token is
 * available. Refill happens continuously.
 */
export class TokenBucket {
    tokens;
    capacity;
    refillPerMs;
    lastRefill;
    waiters = [];
    timer = null;
    constructor(requestsPerMinute) {
        this.capacity = Math.max(1, requestsPerMinute);
        this.tokens = this.capacity;
        this.refillPerMs = this.capacity / 60_000;
        this.lastRefill = Date.now();
        // Periodic refill so concurrent waiters get resolved without each having
        // to call refill() themselves (which would add ~0 tokens due to tiny elapsed).
        this.timer = setInterval(() => this.refill(), 100);
    }
    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    get availableTokens() {
        this.refill();
        return this.tokens;
    }
    async acquire() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }
        await new Promise((resolve, reject) => {
            this.waiters.push({ resolve, reject });
        });
    }
    /** Non-blocking acquire — returns false when no token is available now. */
    tryAcquire() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
            this.lastRefill = now;
        }
        this.drainWaiters();
    }
    drainWaiters() {
        while (this.waiters.length > 0 && this.tokens >= 1) {
            const waiter = this.waiters.shift();
            this.tokens -= 1;
            waiter.resolve();
        }
    }
}
/** Simple concurrency limiter (semaphore). */
export class Semaphore {
    available;
    queue = [];
    constructor(concurrency) {
        this.available = Math.max(1, concurrency);
    }
    async run(task) {
        await this.acquire();
        try {
            return await task();
        }
        finally {
            this.release();
        }
    }
    acquire() {
        if (this.available > 0) {
            this.available -= 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.queue.push(resolve));
    }
    release() {
        const next = this.queue.shift();
        if (next) {
            next();
        }
        else {
            this.available += 1;
        }
    }
}
//# sourceMappingURL=rateLimiter.js.map