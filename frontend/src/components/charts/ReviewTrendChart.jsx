import React from 'react';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    Legend, ResponsiveContainer
} from 'recharts';

const ReviewTrendChart = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                No trend data in this period.
            </div>
        );
    }

    // Format week_start label — show Mon DD
    const formatWeek = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    const chartData = data.map((d) => ({
        week: formatWeek(d.week_start),
        'Time to Merge (h)': d.time_to_merge_hours,
        'Review Cycle (h)': d.review_cycle_hours,
        'Merged PRs': d.merged_count,
    }));

    return (
        <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorMergedBars" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                        dataKey="week"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        yAxisId="hours"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => v != null ? `${v}h` : ''}
                        width={45}
                    />
                    <YAxis
                        yAxisId="count"
                        orientation="right"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={30}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            borderColor: 'hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--popover-foreground))',
                            fontSize: '12px',
                        }}
                        itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        formatter={(value, name) => {
                            if (value == null) return ['No data', name];
                            if (name === 'Merged PRs') return [value, name];
                            return [`${value}h`, name];
                        }}
                    />
                    <Legend
                        wrapperStyle={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}
                    />
                    <Bar
                        yAxisId="count"
                        dataKey="Merged PRs"
                        fill="url(#colorMergedBars)"
                        stroke="#8b5cf6"
                        strokeWidth={1}
                        radius={[3, 3, 0, 0]}
                    />
                    <Line
                        yAxisId="hours"
                        type="monotone"
                        dataKey="Time to Merge (h)"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                    />
                    <Line
                        yAxisId="hours"
                        type="monotone"
                        dataKey="Review Cycle (h)"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ReviewTrendChart;
