export class ScraperError extends Error {
  constructor(message, { code = 'SCRAPER_ERROR', url, status, retryable = false, retryAfterMs = 0, cause } = {}) {
    super(message, { cause });
    this.name = 'ScraperError';
    Object.assign(this, { code, url, status, retryable, retryAfterMs });
  }

  toJSON() {
    return { code: this.code, message: this.message, url: this.url, status: this.status };
  }
}
