// Simple request scheduler stub with pacing and backoff hooks

class Scheduler {
  constructor(options = {}) {
    this.maxRps = options.maxRps || 3;
    this.minDelayBetweenBatchesMs = options.minDelayBetweenBatchesMs || 350;
    this.on429Backoff = options.on429Backoff !== false;
    this.queue = [];
    this.running = false;
    this.lastBatchAt = 0;
  }

  enqueue(taskFn, { isAppendBatch = false } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject, isAppendBatch });
      this._run();
    });
  }

  async _run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const { taskFn, resolve, reject, isAppendBatch } = this.queue.shift();
        if (isAppendBatch) {
          const now = Date.now();
          const waitMs = Math.max(0, this.minDelayBetweenBatchesMs - (now - this.lastBatchAt));
          if (waitMs > 0) await this._delay(waitMs);
        }
        try {
          const result = await taskFn();
          if (isAppendBatch) this.lastBatchAt = Date.now();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Scheduler;
}


