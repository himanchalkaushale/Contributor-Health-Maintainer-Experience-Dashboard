import React from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';

const HealthBadge = ({ severity, className }) => {
    const styles = {
        healthy: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
        warning: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800",
        critical: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
        info: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
    };

    const icons = {
        healthy: CheckCircle,
        warning: AlertCircle,
        critical: AlertCircle,
        info: Info,
    };

    const Icon = icons[severity] || Info;

    return (
        <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
            styles[severity] || styles.info,
            className
        )}>
            <Icon className="w-3.5 h-3.5" />
            <span className="capitalize">{severity}</span>
        </div>
    );
};

export default HealthBadge;
