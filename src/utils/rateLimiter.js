const fs = require('fs').promises;
const path = require('path');

class RateLimiter {
    constructor(filePath = 'data/rateLimits.json') {
        this.filePath = path.join(process.cwd(), filePath);
        this.rateLimits = new Map();
        this.cleanupInterval = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        // Ensure data directory exists
        const dataDir = path.dirname(this.filePath);
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                console.error('Failed to create data directory:', error);
            }
        }

        // Load existing rate limits
        await this.loadRateLimits();

        // Start cleanup interval (runs every 5 minutes)
        this.startCleanupInterval();

        this.initialized = true;
    }

    async loadRateLimits() {
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            const rateLimitData = JSON.parse(data);

            // Convert to Map and filter out expired entries
            const now = Date.now();
            for (const [userId, expiry] of Object.entries(rateLimitData)) {
                if (expiry > now) {
                    this.rateLimits.set(userId, expiry);
                }
            }

            console.log(`Loaded ${this.rateLimits.size} active rate limits from storage`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Failed to load rate limits:', error);
            }
            // File doesn't exist or is invalid, start with empty rate limits
        }
    }

    async saveRateLimits() {
        try {
            // Convert Map to plain object for JSON storage
            const rateLimitData = Object.fromEntries(this.rateLimits);
            await fs.writeFile(this.filePath, JSON.stringify(rateLimitData, null, 2));
        } catch (error) {
            console.error('Failed to save rate limits:', error);
        }
    }

    isRateLimited(userId) {
        const now = Date.now();
        const expiry = this.rateLimits.get(userId);

        if (!expiry || expiry <= now) {
            // Not rate limited or expired
            this.rateLimits.delete(userId);
            return false;
        }

        return true;
    }

    getRemainingTime(userId) {
        const expiry = this.rateLimits.get(userId);
        if (!expiry) return 0;

        const remaining = expiry - Date.now();
        return Math.max(0, remaining);
    }

    async setRateLimit(userId, durationMs = 600000) { // Default 10 minutes
        const expiry = Date.now() + durationMs;
        this.rateLimits.set(userId, expiry);
        await this.saveRateLimits();
    }

    async removeRateLimit(userId) {
        const removed = this.rateLimits.delete(userId);
        if (removed) {
            await this.saveRateLimits();
        }
        return removed;
    }

    cleanupExpired() {
        const now = Date.now();
        let cleaned = 0;

        for (const [userId, expiry] of this.rateLimits.entries()) {
            if (expiry <= now) {
                this.rateLimits.delete(userId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} expired rate limits`);
            this.saveRateLimits(); // Save after cleanup
        }

        return cleaned;
    }

    startCleanupInterval() {
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpired();
        }, 5 * 60 * 1000);
    }

    stopCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    async shutdown() {
        this.stopCleanupInterval();
        await this.saveRateLimits();
    }

    // Helper method to format remaining time for user-friendly display
    formatRemainingTime(userId) {
        const remaining = this.getRemainingTime(userId);
        if (remaining <= 0) return null;

        const minutes = Math.ceil(remaining / (60 * 1000));
        if (minutes === 1) return '1 minute';
        return `${minutes} minutes`;
    }
}

// Create singleton instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;