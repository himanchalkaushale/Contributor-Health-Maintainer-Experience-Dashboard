import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';

const BUCKET_COLORS = ['#10b981', '#f59e0b', '#f97316', '#ef4444'];

const WaitDistributionChart = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                No wait-time data available.
            </div>
        );
    }

    const hasData = data.some((d) => d.count > 0);
    if (!hasData) {
        return (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                No wait-time data in this period.
            </div>
        );
    }

    return (
        <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                        dataKey="bucket"
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
                        allowDecimals={false}
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
                        formatter={(value) => [`${value} PR${value !== 1 ? 's' : ''}`, 'Count']}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {data.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={BUCKET_COLORS[index % BUCKET_COLORS.length]}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default WaitDistributionChart;
