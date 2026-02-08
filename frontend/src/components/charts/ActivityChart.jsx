import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ActivityChart = ({ data }) => {
    if (!data || !data.weeks) return null;

    // Transform data for Recharts
    // Data format from backend: { weeks: ["W1", "W2"], prs: [10, 12], issues: [5, 8] }
    const chartData = data.weeks.map((week, index) => ({
        name: week,
        PRs: data.prs[index],
        Issues: data.issues[index]
    }));

    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={chartData}
                    margin={{
                        top: 10,
                        right: 30,
                        left: 0,
                        bottom: 0,
                    }}
                >
                    <defs>
                        <linearGradient id="colorPRs" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorIssues" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                        dataKey="name"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            borderColor: 'hsl(var(--border))',
                            borderRadius: '8px',
                            color: 'hsl(var(--popover-foreground))'
                        }}
                        itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                    />
                    <Area
                        type="monotone"
                        dataKey="PRs"
                        stroke="#8b5cf6"
                        fillOpacity={1}
                        fill="url(#colorPRs)"
                    />
                    <Area
                        type="monotone"
                        dataKey="Issues"
                        stroke="#f59e0b"
                        fillOpacity={1}
                        fill="url(#colorIssues)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ActivityChart;
