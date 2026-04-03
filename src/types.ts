/** Valid user account statuses. */
export type UserStatus = "active" | "invited" | "suspended" | "disabled" | "deleted";

/**
 * User is the public profile of an authenticated Forta user as returned by
 * the /auth/self and /auth/exchange endpoints.
 */
export interface User {
    id: number;
    uuid: string;
    name: string | null;
    display_name: string | null;
    email: string;
    email_verified: boolean;
    is_super_admin: boolean;
    status: UserStatus;
    profile_image_url: string | null;
    last_login_at: string | null;
    inserted_at: string;
    updated_at: string;
    metadata?: UserMetadata | null;
}

/** Alias for User — both names are used across Forta services. */
export type UserPublic = User;

/** UserMetadata holds optional supplementary profile fields. */
export interface UserMetadata {
    username: string | null;
    phone: string | null;
    phone_verified: boolean;
}

/** TokenPair holds a Forta access/refresh token pair along with expiry metadata. */
export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    expires_at: string;
}

/** AuthResponse is the payload returned by /auth/exchange and /auth/refresh. */
export interface AuthResponse {
    user: User;
    authorization: TokenPair;
    is_new_user: boolean;
}

/**
 * FortaEnvelope is the standard response wrapper used by the Forta API for
 * endpoints that use the internal responder package.
 */
export interface FortaEnvelope<T> {
    success: boolean;
    message: string;
    data: T;
}

/** ExchangeCodeRequest matches the body expected by POST /auth/exchange. */
export interface ExchangeCodeRequest {
    client_id: string;
    client_secret: string;
    code: string;
}

/** ErrorResponseBody is the JSON body written by writeJsonError. */
export interface ErrorResponseBody {
    success: boolean;
    error_message: string;
}

// ── Client-side API response types ──────────────────────────────────────────

/** Successful API response from a Forta-compatible backend. */
export interface ApiSuccess<T> {
    success: true;
    status: number;
    message: string;
    data: T;
}

/** Failed API response from a Forta-compatible backend. */
export interface ApiError {
    success: false;
    status: number;
    error: string;
    error_message: string;
    error_code: number;
}

/** Discriminated union returned by the Forta API client. */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
