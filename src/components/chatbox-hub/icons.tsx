// Inline icons for the dock (stroke = currentColor, so they follow the button's text color).
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const PrivateChatIcon = ({ className = "h-6 w-6" }) => (
  <svg {...base} className={className}>
    <path d="M4 5h16v11H9l-5 4z" />
    <rect x="9.5" y="9.5" width="5" height="4" rx="0.8" />
    <path d="M10.5 9.5V8.3a1.5 1.5 0 0 1 3 0v1.2" />
  </svg>
);

export const RateIcon = ({ className = "h-6 w-6" }) => (
  <svg {...base} className={className}>
    <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z" />
  </svg>
);

export const ItineraryIcon = ({ className = "h-6 w-6" }) => (
  <svg {...base} className={className}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

export const CloseIcon = ({ className = "h-5 w-5" }) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
