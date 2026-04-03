import type { User } from "./types";

/**
 * Symbols used to store Forta identity data on request objects without
 * polluting the type system or risking property collisions.
 */
const FORTA_ID_KEY = Symbol.for("forta-id");
const FORTA_USER_KEY = Symbol.for("forta-user");

/** Attaches the Forta user ID to the request object. */
export function setFortaId(req: unknown, id: number): void {
    (req as Record<symbol, unknown>)[FORTA_ID_KEY] = id;
}

/** Attaches the full Forta User to the request object. */
export function setFortaUser(req: unknown, user: User): void {
    (req as Record<symbol, unknown>)[FORTA_USER_KEY] = user;
}

/**
 * getFortaIdFromRequest returns the authenticated user's Forta ID injected
 * by the protect middleware. Returns [0, false] if the request was not
 * authenticated.
 */
export function getFortaIdFromRequest(req: unknown): [number, boolean] {
    const id = (req as Record<symbol, unknown>)[FORTA_ID_KEY];
    return typeof id === "number" ? [id, true] : [0, false];
}

/**
 * getUserFromRequest returns the full Forta User profile injected by the
 * protect middleware. Returns [null, false] if the profile is not available
 * (e.g. local JWT validation without fetchUserOnProtect).
 */
export function getUserFromRequest(req: unknown): [User | null, boolean] {
    const user = (req as Record<symbol, unknown>)[FORTA_USER_KEY] as
        | User
        | undefined;
    return user ? [user, true] : [null, false];
}
