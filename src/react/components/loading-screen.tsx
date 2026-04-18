"use client";

import type { ReactNode } from "react";

/** Configuration for the LoadingScreen component. */
export interface LoadingScreenProps {
  /** Content displayed above the spinner (typically logo + service name). */
  logo?: ReactNode;
}

/**
 * Full-viewport loading overlay shown while the initial auth check runs.
 *
 * Uses a pure-CSS spinner so there is no dependency on FontAwesome or any
 * other icon library.
 *
 * Uses Tailwind CSS classes — consuming apps should add the forta-js dist
 * directory to their Tailwind content configuration.
 */
export function LoadingScreen({ logo }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 gap-6">
      {logo}
      <div className="h-6 w-6 rounded-full border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 animate-spin" />
    </div>
  );
}
