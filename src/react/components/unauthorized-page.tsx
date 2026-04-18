"use client";

import type { ReactNode } from "react";
import { FortaLogo } from "./forta-logo";

/** Configuration for the UnauthorizedPage component. */
export interface UnauthorizedPageProps {
  /** The name of the service the user was denied access to (e.g. "Monitor"). */
  serviceName: string;

  /** Logo element rendered alongside the Forta branding. */
  logo?: ReactNode;

  /**
   * URL for the "Go to Forta Dashboard" button.
   * Default: "https://forta.appleby.cloud".
   */
  fortaDashboardUrl?: string;

  /**
   * URL for the "Sign in with a different account" action.
   * Defaults to the fortaDashboardUrl value.
   */
  signInUrl?: string;
}

/**
 * Full-page unauthorized / access-denied screen.
 *
 * Designed for use when a user's grant has been revoked (error_code 4003).
 * Displays the service logo alongside Forta branding, a lock icon, an
 * explanation, and actions to navigate to the Forta dashboard or sign in
 * with a different account.
 *
 * Uses Tailwind CSS classes — consuming apps should add the forta-js dist
 * directory to their Tailwind content configuration.
 */
export function UnauthorizedPage({
  serviceName,
  logo,
  fortaDashboardUrl = "https://forta.appleby.cloud",
  signInUrl,
}: UnauthorizedPageProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-8 shadow-sm border border-zinc-200 dark:border-zinc-800 max-w-md w-full text-center">
        {/* Header: Service logo | divider | Forta */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {logo}
          {logo && <div className="h-8 w-px bg-zinc-300 dark:bg-zinc-600" />}
          <div className="flex items-center gap-2">
            <FortaLogo className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">
              Forta
            </span>
          </div>
        </div>

        {/* Lock icon */}
        <div className="flex justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-10 h-10 text-zinc-400 dark:text-zinc-500"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-zinc-900 dark:text-white mb-2">
          Unauthorized
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          You don&apos;t have access to {serviceName}. Your grant may have been
          revoked or you haven&apos;t been granted access yet.
        </p>

        <div className="flex flex-col gap-3">
          <a
            href={fortaDashboardUrl}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Go to Forta Dashboard
          </a>
          <a
            href={signInUrl ?? fortaDashboardUrl}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors"
          >
            Sign in with a different account
          </a>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-6">
          If you believe this is a mistake, contact your administrator.
        </p>
      </div>
    </div>
  );
}
