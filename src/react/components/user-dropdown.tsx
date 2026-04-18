"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import type { User } from "../../types";

/** A single item rendered in the dropdown menu. */
export interface UserDropdownItem {
  /** Display label for the item. */
  label: string;

  /** URL to navigate to. Renders an <a> tag. */
  href?: string;

  /** Open href in a new tab. */
  external?: boolean;

  /** Click handler. Renders a <button> when href is absent. */
  onClick?: () => void;

  /** Icon element rendered to the left of the label. */
  icon?: ReactNode;
}

export interface UserDropdownProps {
  /** The authenticated user. */
  user: User;

  /** Called when the user clicks Sign Out. */
  onLogout: () => void;

  /** Additional menu items rendered between the user info header and Sign Out. */
  items?: UserDropdownItem[];

  /**
   * Controls whether the user's name is shown next to the avatar in the
   * trigger button on wider viewports. Default: true.
   */
  showName?: boolean;
}

function getInitials(user: User): string {
  const source = user.display_name || user.name;
  if (source) {
    return source
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return user.email?.[0]?.toUpperCase() ?? "?";
}

/**
 * User account dropdown menu.
 *
 * Renders an avatar trigger button that opens a dropdown panel with user
 * info, optional custom items, and a Sign Out action. Handles click-outside
 * to close.
 *
 * This component does NOT call useForta() internally — it accepts user and
 * onLogout as props so it stays decoupled from the provider and can be used
 * in navbars that source auth state in different ways.
 */
export function UserDropdown({
  user,
  onLogout,
  items,
  showName = true,
}: UserDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const displayName = user.display_name || user.name || "User";
  const initials = getInitials(user);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {user.profile_image_url ? (
          <img
            src={user.profile_image_url}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 dark:bg-blue-500 text-xs font-semibold text-white select-none">
            {initials}
          </div>
        )}
        {showName && (
          <span className="hidden sm:block max-w-[120px] truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {displayName}
          </span>
        )}
        <svg
          className="hidden sm:block h-4 w-4 text-zinc-400 dark:text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg z-50">
          {/* User info */}
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 mb-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {displayName}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {user.email}
            </p>
          </div>

          {/* Custom items */}
          {items?.map((item, i) => {
            const className =
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors";

            if (item.href) {
              return (
                <a
                  key={i}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={close}
                  className={className}
                >
                  {item.icon && (
                    <span className="h-4 w-4 text-zinc-400 dark:text-zinc-500">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </a>
              );
            }

            return (
              <button
                key={i}
                onClick={() => {
                  close();
                  item.onClick?.();
                }}
                className={className}
              >
                {item.icon && (
                  <span className="h-4 w-4 text-zinc-400 dark:text-zinc-500">
                    {item.icon}
                  </span>
                )}
                {item.label}
              </button>
            );
          })}

          {/* Sign Out */}
          <button
            onClick={() => {
              close();
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
