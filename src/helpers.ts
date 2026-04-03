import { randomBytes } from "crypto";
import type { IncomingMessage } from "http";
import { parseCookies, COOKIE_ACCESS_TOKEN } from "./cookies";

/**
 * generateState returns a 32-byte cryptographically random hex string for use
 * as an OAuth2 CSRF state parameter.
 */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * extractToken returns the Bearer token from the Authorization header, falling
 * back to the forta-access-token cookie. Returns null if neither is present.
 */
export function extractToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const candidate = authHeader.slice(7);
    // A valid JWT has exactly 2 dots. Guard against "Bearer undefined" etc.
    if ((candidate.match(/\./g) || []).length === 2) {
      return candidate;
    }
  }

  const cookies = parseCookies(req);
  const cookieToken = cookies[COOKIE_ACCESS_TOKEN];
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}
