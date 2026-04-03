"use client";

// ── React adapter for Forta authentication ──────────────────────────────────
//
// Usage:
//
//   import { FortaProvider, useForta, useFortaUser } from 'forta-js/react';
//
//   // Wrap your app:
//   <FortaProvider config={{
//     apiUrl: process.env.NEXT_PUBLIC_API_URL,
//     loginUrl: `${process.env.NEXT_PUBLIC_API_URL}/forta/login`,
//     logoutUrl: `${process.env.NEXT_PUBLIC_API_URL}/forta/logout`,
//   }}>
//     <App />
//   </FortaProvider>
//
//   // In components:
//   const { isLoggedIn, user, login, logout, apiClient } = useForta();
//
// The provider is the "base forta store" — apps compose their own state
// management (Redux, Zustand, Context, etc.) around it.

export { FortaProvider } from "./provider";
export type {
    FortaProviderConfig,
    FortaProviderProps,
    FortaAuthContext,
} from "./provider";

export { useForta, useFortaUser, useAuthStatus, useFortaApi } from "./hooks";

export {
    createFortaApiClient,
    type FortaApiClient,
    type FortaApiClientConfig,
    type RequestConfig,
} from "./api-client";

// Re-export core types for convenience.
export type {
    User,
    UserPublic,
    UserMetadata,
    UserStatus,
    ApiResponse,
    ApiSuccess,
    ApiError,
} from "../types";
