import React, { useEffect, useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Loader2, AlertTriangle, Clock, List, AlertCircle, CheckCircle2, Info } from 'lucide-react';

const PRBottlenecks = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!selectedRepo) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                // Using a direct fetch here since we haven't added getPRBottlenecks to api.js yet
                // But following best activity, I should update api.js first. 
                // For now, I will assume I add it to api.js next.
                const res = await repoService.getPRBottlenecks(selectedRepo.id);
                setData(res);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch PR bottlenecks data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedRepo]);

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading bottlenecks analysis...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, stuck_prs, first_time_prs, review_flow } = data;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* 1. Health Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Open PRs"
                    value={summary.open_prs}
                    icon={List}
                    desc="Total open pull requests"
                    color="text-blue-500"
                />
                <SummaryCard
                    title="Waiting > 7 Days"
                    value={summary.waiting_over_7d}
                    icon={Clock}
                    desc="No maintainer review yet"
                    color={summary.waiting_over_7d > 5 ? "text-red-500" : "text-yellow-500"}
                />
                <SummaryCard
                    title="Median Review Time"
                    value={`${summary.median_review_hours}h`}
                    icon={Clock}
                    desc="Time to first maintainer response"
                    color={summary.median_review_hours > 72 ? "text-red-500" : "text-emerald-500"}
                    tooltip="Healthy: < 24h, Warning: 1-3d, Critical: > 3d"
                />
                <SummaryCard
                    title="Unreviewed PRs"
                    value={summary.unreviewed_prs}
                    icon={AlertTriangle}
                    desc="Zero maintainer comments"
                    color={summary.unreviewed_prs > 5 ? "text-red-500" : "text-emerald-500"}
                />
            </div>

            {/* 2. Review Flow Breakdown */}
            <div className="bg-card border rounded-lg p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <h3 className="font-semibold text-foreground">Review Flow Breakdown</h3>
                    <div className="group relative">
                        <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                        <div className="absolute top-0 left-6 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                            Snapshot of recent 90 days. Helps distinguish if PRs are waiting for reviewers vs merge.
                        </div>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 items-center justify-around text-center">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold">{review_flow.waiting_for_review}</span>
                        <span className="text-sm text-muted-foreground">Waiting for First Review</span>
                    </div>
                    <span className="text-muted-foreground/30 hidden md:block">→</span>
                    <div className="flex flex-col items-center">
                        {/* Calculating waiting for updates roughly or use waiting_for_merge which is post-review */}
                        <span className="text-2xl font-bold">{review_flow.waiting_for_merge}</span>
                        <span className="text-sm text-muted-foreground">Reviewed & Waiting Merge</span>
                    </div>
                    <span className="text-muted-foreground/30 hidden md:block">→</span>
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-emerald-600">{review_flow.merged}</span>
                        <span className="text-sm text-muted-foreground">Merged (Last 90d)</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 3. Stuck PRs Table */}
                <div className="lg:col-span-2 bg-card border rounded-lg shadow-sm overflow-hidden">
                    <div className="p-6 border-b">
                        <h3 className="font-semibold text-foreground">Stuck PRs (Actionable)</h3>
                        <p className="text-sm text-muted-foreground mt-1">Open PRs requiring attention, sorted by age.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                <tr>
                                    <th className="px-6 py-3">PR</th>
                                    <th className="px-6 py-3">Author</th>
                                    <th className="px-6 py-3">Age</th>
                                    <th className="px-6 py-3">Last Activity</th>
                                    <th className="px-6 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {stuck_prs.map((pr) => (
                                    <tr key={pr.number} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={pr.title}>
                                                #{pr.number} {pr.title}
                                            </a>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.author}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.age_days} days</td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${pr.last_activity === 'maintainer' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                                                }`}>
                                                {pr.last_activity}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {pr.status === 'healthy' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</span>}
                                            {pr.status === 'warning' && <span className="text-yellow-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Warning</span>}
                                            {pr.status === 'critical' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Critical</span>}
                                        </td>
                                    </tr>
                                ))}
                                {stuck_prs.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No stuck PRs found! 🎉</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 4. First-Time PR Experience */}
                <div className="bg-card border rounded-lg p-6 shadow-sm h-fit">
                    <h3 className="font-semibold text-foreground mb-4">First-Time Experience</h3>
                    <p className="text-sm text-muted-foreground mb-6">Impact of review delays on new contributors.</p>

                    <div className="space-y-6">
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">New Contributors Stuck</span>
                                <span className={`text-xl font-bold ${first_time_prs.count > 0 ? "text-red-500" : "text-muted-foreground"}`}>{first_time_prs.count}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">First-time PRs waiting &gt; 7 days.</div>
                        </div>

                        <div className="pt-4 border-t">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">Median Review Time</span>
                                <span className="text-xl font-bold">{first_time_prs.median_review_hours}h</span>
                            </div>
                            <div className="text-xs text-muted-foreground">For first-time contributors (All time).</div>
                            <div className="mt-2 text-xs flex gap-2">
                                <span className="text-emerald-500">&lt; 48h</span>
                                <span className="text-yellow-500">2-4d</span>
                                <span className="text-red-500">&gt; 4d</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ title, value, icon: Icon, desc, color, tooltip }) => (
    <div className="bg-card p-5 rounded-lg border shadow-sm group relative flex flex-col justify-between">
        <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className={`w-5 h-5 ${color} opacity-80`} />
            </div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
        </div>
        {tooltip && (
            <div className="absolute top-full left-0 mt-2 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-lg hidden group-hover:block z-10 w-48">
                {tooltip}
            </div>
        )}
    </div>
);

export default PRBottlenecks;
