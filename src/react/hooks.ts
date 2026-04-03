"use client";

import { useContext } from "react";
import { FortaContext, type FortaAuthContext } from "./provider";

function useFortaContext(): FortaAuthContext {
    const ctx = useContext(FortaContext);
    if (!ctx) {
        throw new Error(
            "forta-js: useForta() must be used inside a <FortaProvider>"
        );
    }
    return ctx;
}

/**
 * Returns the full Forta auth context: state, helpers, and the API client.
 *
 * ```tsx
 * const { isLoggedIn, isLoading, user, login, logout, apiClient } = useForta();
 * ```
 */
export function useForta(): FortaAuthContext {
    return useFortaContext();
}

/**
 * Returns just the authenticated User, or null if not logged in.
 *
 * ```tsx
 * const user = useFortaUser();
 * if (user) console.log(user.email);
 * ```
 */
export function useFortaUser() {
    return useFortaContext().user;
}

/**
 * Returns the loading and logged-in flags without the full user object.
 * Useful for lightweight auth guards.
 *
 * ```tsx
 * const { isLoggedIn, isLoading } = useAuthStatus();
 * ```
 */
export function useAuthStatus() {
    const { isLoggedIn, isLoading } = useFortaContext();
    return { isLoggedIn, isLoading };
}

/**
 * Returns the Forta API client configured by the provider. Use this to make
 * authenticated API calls from components.
 *
 * ```tsx
 * const api = useFortaApi();
 * const res = await api.fetch<MyData>({ method: "GET", url: "/my/endpoint" });
 * ```
 */
export function useFortaApi() {
    return useFortaContext().apiClient;
}
