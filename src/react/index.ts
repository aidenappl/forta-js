"use client";

// ── Provider & hooks ────────────────────────────────────────────────────────

export { FortaProvider } from "./provider";
export type {
    FortaProviderConfig,
    FortaProviderProps,
    FortaAuthContext,
} from "./provider";

export { useForta, useFortaUser, useAuthStatus, useFortaApi } from "./hooks";

// ── API client ──────────────────────────────────────────────────────────────

export {
    createFortaApiClient,
    type FortaApiClient,
    type FortaApiClientConfig,
    type RequestConfig,
} from "./api-client";

// ── Components ──────────────────────────────────────────────────────────────

export { UnauthorizedPage, type UnauthorizedPageProps } from "./components/unauthorized-page";
export { LoadingScreen, type LoadingScreenProps } from "./components/loading-screen";
export { FortaLogo, type FortaLogoProps } from "./components/forta-logo";
export { UserDropdown, type UserDropdownProps, type UserDropdownItem } from "./components/user-dropdown";

// ── Core types (re-exported for convenience) ────────────────────────────────

export type {
    User,
    UserPublic,
    UserMetadata,
    UserStatus,
    ApiResponse,
    ApiSuccess,
    ApiError,
} from "../types";
