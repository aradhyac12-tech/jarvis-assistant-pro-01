/**
 * Rate Limiter for Edge Functions
 * 
 * Uses in-memory rate limiting with configurable windows.
 * Note: This is per-instance limiting. For production scale,
 * consider using Redis or database-based rate limiting.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store (per edge function instance)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 60000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpiredEntries(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > windowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;  // Milliseconds until window resets
}

/**
 * Check rate limit for a given key
 * @param key Unique identifier (session token, device key, IP, etc.)
 * @param config Rate limit configuration
 * @returns RateLimitResult with allowed status and metadata
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  cleanupExpiredEntries(config.windowMs);
  
  const entry = rateLimitStore.get(key);
  
  if (!entry || now - entry.windowStart >= config.windowMs) {
    // New window
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetIn: config.windowMs,
    };
  }
  
  // Existing window
  const resetIn = config.windowMs - (now - entry.windowStart);
  
  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }
  
  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetIn,
  };
}

/**
 * Create rate limit headers for response
 */
export function rateLimitHeaders(result: RateLimitResult, config: RateLimitConfig): Record<string, string> {
  return {
    "X-RateLimit-Limit": config.maxRequests.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil((Date.now() + result.resetIn) / 1000).toString(),
  };
}

/**
 * Create a 429 Too Many Requests response
 */
export function rateLimitExceededResponse(
  result: RateLimitResult,
  config: RateLimitConfig,
  corsHeaders: Record<string, string>
): Response {
  const retryAfter = Math.ceil(result.resetIn / 1000);
  
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      retry_after_seconds: retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        ...rateLimitHeaders(result, config),
        "Retry-After": retryAfter.toString(),
        "Content-Type": "application/json",
      },
    }
  );
}
