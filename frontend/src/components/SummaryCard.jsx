import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { scrollToSection } from '@/lib/scroll';

/**
 * Trend badge shared across analytics pages.
 * For time-based KPIs (lowerIsBetter = true): positive delta is bad -> red.
 * For density KPIs (lowerIsBetter = false): positive delta is good -> green.
 */
export const TrendBadge = ({ delta, lowerIsBetter = true }) => {
    if (delta == null) return null;
    const up = delta > 0;
    const neutral = delta === 0;
    let color, Icon;
    if (neutral) {
        color = 'text-muted-foreground'; Icon = Minus;
    } else if ((up && lowerIsBetter) || (!up && !lowerIsBetter)) {
        color = 'text-red-500'; Icon = TrendingUp;
    } else {
        color = 'text-emerald-500'; Icon = up ? TrendingUp : TrendingDown;
    }
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
            <Icon className="w-3 h-3" />
            {Math.abs(delta)}%
        </span>
    );
};

/**
 * Shared summary card. Clickable when `targetId` is set (updates the URL hash
 * and smooth-scrolls to the matching section).
 *
 * Props:
 *  - title, value, icon, desc, color
 *  - tooltip (hover info), targetId (click-to-scroll), delta, lowerIsBetter
 *  - rounded: 'lg' | 'xl' (visual variant per page)
 *  - redValueFor: when `title` matches and `value` is truthy, the value renders red.
 */
const SummaryCard = ({
    title,
    value,
    icon: Icon,
    desc,
    color,
    tooltip,
    targetId,
    delta,
    lowerIsBetter = true,
    rounded = 'lg',
    redValueFor,
}) => {
    // Use full literal class strings so Tailwind's JIT keeps them (dynamic
    // `rounded-${rounded}` would be purged).
    const roundedClass = rounded === 'xl' ? 'rounded-xl' : 'rounded-lg';
    const baseClasses = `bg-card p-5 ${roundedClass} border shadow-sm group relative flex flex-col justify-between transition-colors hover:border-primary/20`;

    const valueRed = redValueFor && title === redValueFor && value > 0;

    const inner = (
        <>
            <div>
                <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium text-muted-foreground">{title}</span>
                    {Icon && <Icon className={`w-5 h-5 ${color} opacity-80`} />}
                </div>
                <div className={`text-2xl font-bold ${valueRed ? 'text-red-600' : 'text-foreground'}`}>
                    {value}
                </div>
                <div className="flex items-center gap-2 mt-1">
                    {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
                    {delta != null && <TrendBadge delta={delta} lowerIsBetter={lowerIsBetter} />}
                </div>
            </div>
            {tooltip && (
                <div className="absolute top-full left-0 mt-2 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-lg hidden group-hover:block z-10 w-56">
                    {tooltip}
                </div>
            )}
        </>
    );

    if (!targetId) {
        return <div className={baseClasses}>{inner}</div>;
    }

    const handleActivate = () => {
        if (history.replaceState) {
            history.replaceState(null, '', `#${targetId}`);
        }
        scrollToSection(targetId);
    };

    return (
        <button
            type="button"
            onClick={handleActivate}
            className={`${baseClasses} text-left w-full cursor-pointer hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
            {inner}
        </button>
    );
};

export default SummaryCard;
