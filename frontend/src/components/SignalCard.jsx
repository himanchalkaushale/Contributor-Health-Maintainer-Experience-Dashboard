import React, { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import HealthBadge from './HealthBadge';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

const SignalCard = ({ signal, onClick, delay = 0 }) => {
    const container = useRef();
    const { name, description, severity, metadata } = signal;

    useGSAP(() => {
        gsap.from(container.current, {
            y: 20,
            opacity: 0,
            duration: 0.5,
            delay: delay * 0.1,
            ease: "power2.out"
        });
    }, { scope: container });

    const handleMouseEnter = () => {
        gsap.to(container.current, {
            y: -5,
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            duration: 0.3,
            ease: "power2.out"
        });
    };

    const handleMouseLeave = () => {
        gsap.to(container.current, {
            y: 0,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
            duration: 0.3,
            ease: "power2.out"
        });
    };

    // Helper to render metadata summary
    const renderSummary = () => {
        if (metadata.count !== undefined) {
            return <span className="text-2xl font-bold">{metadata.count}</span>;
        }
        if (metadata.critical_count !== undefined) {
            return (
                <div className="flex gap-4">
                    <div className="flex flex-col">
                        <span className="text-2xl font-bold text-red-600 dark:text-red-400">{metadata.critical_count}</span>
                        <span className="text-xs text-muted-foreground">Critical</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{metadata.warning_count}</span>
                        <span className="text-xs text-muted-foreground">Warning</span>
                    </div>
                </div>
            );
        }
        if (metadata.open_prs !== undefined) {
            return (
                <div className="flex gap-4">
                    <div className="flex flex-col">
                        <span className="text-2xl font-bold">{metadata.open_prs}</span>
                        <span className="text-xs text-muted-foreground">PRs</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-2xl font-bold">{metadata.open_issues}</span>
                        <span className="text-xs text-muted-foreground">Issues</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div
            ref={container}
            className={cn(
                "bg-card text-card-foreground rounded-xl border shadow-sm p-6 cursor-pointer transition-colors",
                "hover:border-primary/50"
            )}
            onClick={onClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-lg tracking-tight">{name}</h3>
                <HealthBadge severity={severity} />
            </div>

            <div className="mb-4">
                {renderSummary()}
            </div>

            <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                {description}
            </p>

            <div className="flex items-center text-sm font-medium text-primary">
                View Details <ArrowRight className="ml-1 w-4 h-4" />
            </div>
        </div>
    );
};

export default SignalCard;
