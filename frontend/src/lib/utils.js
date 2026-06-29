import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

/**
 * Parse an ISO-ish timestamp from the backend into a real Date object.
 *
 * The backend stores datetimes as naive UTC (datetime.utcnow()) and Pydantic
 * serializes them WITHOUT a timezone offset (e.g. "2026-06-28T16:40:00"). If we
 * feed that straight to `new Date(...)`, JS treats it as LOCAL time, which
 * shifts the instant by several hours and corrupts "X min ago" math. Here we
 * append a "Z" so it is interpreted as UTC, unless the string already carries
 * an explicit offset.
 */
export function parseBackendDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const str = String(value);
    // Has an explicit offset ("Z", "+05:30" or "+0000")? Leave as-is.
    const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str);
    return new Date(hasOffset ? str : str + "Z");
}

/**
 * Format a Date into a real-life relative label.
 *   < 60s    -> "just now"
 *   < 60m    -> "5m ago"
 *   < 24h    -> "3h ago"
 *   < 7d     -> "2d ago"
 *   older    -> "Jun 28, 2026"
 * Returns "—" if the date is null/invalid or in the future.
 */
export function formatRelativeTime(value) {
    const date = parseBackendDate(value);
    if (!date || isNaN(date.getTime())) return "—";

    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs < 0) return "—"; // clock skew / future-dated

    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return "just now";

    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;

    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

/**
 * Format a duration given in hours into a human-readable string.
 * - null/undefined -> "N/A"
 * - < 24h          -> "Xh" (e.g. "5h", "0.5h")
 * - >= 24h         -> "Xd Yh" (e.g. "2d 4h"), omitting "0h" (e.g. "3d")
 */
export function formatDuration(hours) {
    if (hours === null || hours === undefined || isNaN(hours)) return "N/A";
    if (hours < 0) hours = 0;

    if (hours < 24) {
        // Show one decimal only for sub-hour values, otherwise round.
        const rounded = hours < 1 ? Math.round(hours * 10) / 10 : Math.round(hours);
        return `${rounded}h`;
    }

    const totalHours = Math.round(hours);
    const days = Math.floor(totalHours / 24);
    const remHours = totalHours % 24;
    return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}
