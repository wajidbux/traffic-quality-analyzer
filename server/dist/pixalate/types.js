/**
 * Pixalate API types.
 *
 * Sources of truth (verified live):
 *  - Ad Fraud API v2.0.1: https://api.pixalate.com/.well-known/api/v2/fraud/fraud.yml
 *    server: https://fraud-api.pixalate.com/api/v2
 *  - CTV Apps API:       https://api.pixalate.com/.well-known/api/v2/ctv/ctv.yml
 *    server: https://api.pixalate.com (base path /mrt/ctv)
 *
 * Both APIs use the same PIXALATE_API_KEY (x-api-key header) but different
 * base URLs / paths. They are wired as separate clients so each can be
 * configured, tested, and toggled independently.
 */
export class PixalateApiError extends Error {
    kind;
    httpStatus;
    retryable;
    body;
    constructor(kind, message, opts = {}) {
        super(message);
        this.name = "PixalateApiError";
        this.kind = kind;
        this.httpStatus = opts.httpStatus ?? null;
        this.retryable = opts.retryable ?? false;
        this.body = opts.body ?? null;
    }
}
//# sourceMappingURL=types.js.map