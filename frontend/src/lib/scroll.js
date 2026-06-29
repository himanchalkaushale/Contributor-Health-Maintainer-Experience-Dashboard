import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Smoothly scroll the section with the given id into view.
 * Fails gracefully (no-op) when the section is not currently mounted.
 */
export function scrollToSection(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Scroll to the element matching `location.hash` once the page's async data
 * is available. Because most pages render their target sections only after a
 * fetch resolves, this effect re-runs whenever the provided `dependencies`
 * change and waits a frame (plus a short retry) for conditional sections to
 * mount before scrolling.
 *
 * @param {Array} dependencies values that, when changed, indicate page data
 *   has (re)rendered and a scroll attempt should be made.
 */
export function useHashScroll(dependencies = []) {
    const location = useLocation();

    useEffect(() => {
        const hash = location.hash;
        if (!hash) return;

        const id = decodeURIComponent(hash.slice(1));
        if (!id) return;

        let attempts = 0;
        let rafId;
        let timeoutId;

        const tryScroll = () => {
            const el = document.getElementById(id);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            // Section may still be mounting after async data; retry a few times.
            attempts += 1;
            if (attempts < 10) {
                timeoutId = setTimeout(tryScroll, 120);
            }
        };

        rafId = requestAnimationFrame(tryScroll);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            if (timeoutId) clearTimeout(timeoutId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.hash, ...dependencies]);
}
