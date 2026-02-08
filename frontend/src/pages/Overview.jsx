import React, { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Users, GitPullRequest, Clock, AlertCircle, Loader2, Info } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Legend
} from 'recharts';

const Overview = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [chartView, setChartView] = useState('all');

    const containerRef = useRef();

    useEffect(() => {
        if (!selectedRepo) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const overviewData = await repoService.getRepoOverview(selectedRepo.id);
                setData(overviewData);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch repository health data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [selectedRepo]);

    useGSAP(() => {
        if (!data) return;
        gsap.fromTo(".summary-card",
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: "power2.out", clearProps: "all" }
        );
        gsap.fromTo(".chart-container",
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.6, delay: 0.2, ease: "power3.out", clearProps: "all" }
        );
    }, { scope: containerRef, dependencies: [data] });

    if (!selectedRepo) return <div className="flex h-[60vh] items-center justify-center text-muted-foreground">Select a repository.</div>;
    if (loading) return <div className="flex h-[60vh] items-center justify-center gap-4 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin text-primary" /><p>Syncing repository data...</p></div>;
    if (error) return <div className="flex h-[60vh] items-center justify-center gap-4 text-destructive"><AlertCircle className="w-8 h-8" /><p>{error}</p></div>;
    if (!data) return null;

    const chartData = data.activity_trend.weeks.map((week, index) => ({
        name: week,
        prs: data.activity_trend.prs[index],
        issues: data.activity_trend.issues[index]
    }));

    return (
        <div ref={containerRef} className="space-y-8">
            {/* Summary Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                {/* Active Contributors */}
                <div className="summary-card bg-card p-5 rounded-lg border shadow-sm group relative">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5 cursor-help">
                            <span className="text-sm font-medium text-muted-foreground">Active Contributors</span>
                            <Info className="w-3.5 h-3.5 text-muted-foreground/50" />
                        </div>
                        <Users className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">{data.active_contributors}</div>
                    <div className="text-xs text-muted-foreground mt-1">Last 30 days</div>

                    {/* Tooltip */}
                    <div className="absolute top-full left-0 mt-2 w-48 bg-popover border p-2 rounded shadow-lg text-xs hidden group-hover:block z-50">
                        Users who opened a PR/Issue, reviewed, or commented in the last 30d.
                    </div>
                </div>

                {/* Open PRs */}
                <div className={`summary-card bg-card p-5 rounded-lg border shadow-sm border-l-4 ${data.stale_prs > 5 ? 'border-l-yellow-500' : 'border-l-emerald-500'} group relative`}>
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-muted-foreground">Open PRs</span>
                        <GitPullRequest className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">{data.open_prs}</div>
                    <div className="text-xs text-yellow-600 mt-1 font-medium">⚠️ {data.stale_prs} pending &gt;14 days</div>

                    <div className="absolute top-full left-0 mt-2 w-48 bg-popover border p-2 rounded shadow-lg text-xs hidden group-hover:block z-50">
                        Total open PRs. Warning tracks stale PRs unreviewed for 14+ days.
                    </div>
                </div>

                {/* Avg Review Time */}
                <div className="summary-card bg-card p-5 rounded-lg border shadow-sm border-l-4 border-l-emerald-500 group relative">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-muted-foreground">Median Review Time</span>
                        <Clock className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">{data.avg_review_time_label}</div>
                    <div className="text-xs text-muted-foreground mt-1">Excludes old/unreviewed</div>

                    <div className="absolute top-full left-0 mt-2 w-48 bg-popover border p-2 rounded shadow-lg text-xs hidden group-hover:block z-50">
                        Median time from creation to first review for PRs in last 90 days.
                    </div>
                </div>

                {/* Unanswered Issues */}
                <div className={`summary-card bg-card p-5 rounded-lg border shadow-sm border-l-4 ${data.unanswered_issues > 5 ? 'border-l-red-500' : 'border-l-emerald-500'} group relative`}>
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium text-muted-foreground">Unanswered Issues</span>
                        <AlertCircle className="w-5 h-5 text-muted-foreground/70" />
                    </div>
                    <div className="text-2xl font-bold text-foreground mb-2">{data.unanswered_issues}</div>

                    {/* Buckets */}
                    <div className="space-y-1">
                        {data.issue_age_buckets.map((b, i) => (
                            <div key={i} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{b.label}</span>
                                <span className={`font-medium ${b.color}`}>{b.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Chart - Kept same as verified */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="chart-container lg:col-span-3 bg-card border rounded-lg shadow-sm p-6 flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                        <div>
                            <h3 className="text-sm font-bold text-foreground tracking-tight">Contributor Activity Trend (Last 30 Days)</h3>
                            <p className="text-xs text-muted-foreground mt-1 max-w-md">Normalized view of demand vs throughput.</p>
                        </div>
                        <div className="flex bg-secondary/50 rounded-md p-0.5 text-xs">
                            {['all', 'prs', 'issues'].map(mode => (
                                <button key={mode} onClick={() => setChartView(mode)} className={`px-3 py-1 rounded-sm uppercase font-semibold transition-colors ${chartView === mode ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{mode}</button>
                            ))}
                        </div>
                    </div>
                    <div className="h-[320px] w-full mt-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorPrs" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorIssues" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.5} />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                                    dy={10}
                                />
                                <YAxis
                                    yAxisId="left"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: '#6366f1' }}
                                    label={{ value: 'PRs', angle: -90, position: 'insideLeft', fill: '#6366f1', fontSize: 10, dy: 40 }}
                                />
                                <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                                    label={{ value: 'Issues', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 10, dy: 40 }}
                                />
                                <Tooltip
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-popover/95 backdrop-blur-sm border border-border p-3 rounded-lg shadow-xl text-xs">
                                                    <p className="font-semibold text-foreground mb-2">{label}</p>
                                                    {payload.map((entry, index) => (
                                                        <div key={index} className="flex items-center gap-2 mb-1 last:mb-0">
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                            <span className="text-muted-foreground capitalize">{entry.name}:</span>
                                                            <span className="font-medium text-foreground">{entry.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Legend iconType="circle" />
                                {(chartView === 'all' || chartView === 'prs') && (
                                    <Area
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="prs"
                                        stroke="#6366f1"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorPrs)"
                                        name="PRs"
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                )}
                                {(chartView === 'all' || chartView === 'issues') && (
                                    <Area
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="issues"
                                        stroke="#94a3b8"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorIssues)"
                                        name="Issues"
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-4 pt-4 border-t bg-slate-50/50 -mx-6 -mb-6 p-4 rounded-b-lg">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <AlertCircle className="w-5 h-5 text-yellow-600" />
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-foreground">{data.trend_title || "No significant trend detected"}</h4>
                                <p className="text-xs text-muted-foreground mt-0.5">{data.trend_description || "Not enough data to determine a trend."}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Overview;
