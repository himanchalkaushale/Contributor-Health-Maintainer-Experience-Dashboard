import React from 'react';

const STAGE_COLORS = {
    'Unreviewed': { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-100' },
    'In Review':  { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-100' },
    'Approved':   { bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-100' },
    'Merged':     { bg: 'bg-purple-500', text: 'text-purple-600', light: 'bg-purple-100' },
};

const ReviewFunnel = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No funnel data available.
            </div>
        );
    }

    const maxCount = Math.max(...data.map((d) => d.count), 1);

    return (
        <div className="space-y-3 w-full">
            {data.map((stage, i) => {
                const colors = STAGE_COLORS[stage.stage] || {
                    bg: 'bg-gray-400', text: 'text-gray-600', light: 'bg-gray-100'
                };
                const widthPct = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 6 : 0) : 0;

                return (
                    <div key={stage.stage} className="relative">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-foreground flex items-center gap-2">
                                <span className={`inline-block w-2 h-2 rounded-full ${colors.bg}`} />
                                {stage.stage}
                            </span>
                            <span className={`text-sm font-bold ${colors.text}`}>{stage.count}</span>
                        </div>
                        <div className="w-full bg-secondary h-3 rounded-full overflow-hidden">
                            <div
                                className={`h-full ${colors.bg} transition-all duration-500`}
                                style={{ width: `${widthPct}%` }}
                            />
                        </div>
                        {/* Arrow connector except for last item */}
                        {i < data.length - 1 && (
                            <div className="flex justify-center mt-1 mb-0">
                                <svg width="12" height="10" viewBox="0 0 12 10" className="text-muted-foreground opacity-50">
                                    <path d="M6 10 L0 0 L12 0 Z" fill="currentColor" />
                                </svg>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ReviewFunnel;
