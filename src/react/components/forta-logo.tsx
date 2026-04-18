"use client";

/** Props for the FortaLogo SVG component. */
export interface FortaLogoProps {
  /** CSS class(es) applied to the root <svg> element. */
  className?: string;
}

/**
 * Inline SVG of the Forta shield logo.
 *
 * The logo renders at whatever size the parent dictates (via className or
 * surrounding layout). By default it has no intrinsic width/height — use
 * Tailwind utilities like `h-10 w-10` to size it.
 */
export function FortaLogo({ className }: FortaLogoProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="1024" height="1024" rx="220" fill="white" />
      <path
        d="M512 168L792 304V596C792 736 682 831 512 888C342 831 232 736 232 596V304L512 168Z"
        fill="black"
      />
      <path
        d="M512 292L680 373V565C680 648 616 710 512 749C408 710 344 648 344 565V373L512 292Z"
        fill="white"
      />
      <rect x="404" y="292" width="64" height="86" fill="black" />
      <rect x="556" y="292" width="64" height="86" fill="black" />
      <path
        d="M448 458C448 440.327 462.327 426 480 426H544C561.673 426 576 440.327 576 458V736C553.465 743.415 531.806 748.926 512 752C492.194 748.926 470.535 743.415 448 736V458Z"
        fill="black"
      />
      <path
        d="M344 620L438 564V723C399.306 704.57 367.441 680.411 344 650V620Z"
        fill="black"
      />
      <path
        d="M680 620L586 564V723C624.694 704.57 656.559 680.411 680 650V620Z"
        fill="black"
      />
    </svg>
  );
}
