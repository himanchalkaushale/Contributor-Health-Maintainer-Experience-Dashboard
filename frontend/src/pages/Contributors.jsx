import React, { useEffect, useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Loader2, Users, UserPlus, UserMinus, Activity, Clock, AlertTriangle, ArrowRight, Info } from 'lucide-react';

const Contributors = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!selectedRepo) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await repoService.getContributorsHealth(selectedRepo.id);
                setData(res);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch contributors data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();

        // Auto-refresh stats every 5m
        const interval = setInterval(() => {
            repoService.getContributorsHealth(selectedRepo.id).then(setData).catch(console.error);
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [selectedRepo]);

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading contributor health...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, first_time_experience, active_contributors } = data;

    // Feature 1: Interpretation Layer Logic
    let insightSentence = "Contributor retention is stable over the last 30 days.";
    const total = summary.new + summary.returning;
    if (summary.churned > (summary.new + summary.returning) && summary.churned > 0) {
        insightSentence = "Contributor churn exceeds healthy thresholds (>40%).";
    } else if (summary.new > summary.returning * 2 && summary.new > 0) {
        insightSentence = " High influx of new contributors, but retention rates may be low.";
    } else if (summary.churned === 0 && summary.active > 0) {
        insightSentence = "Excellent retention! No recent contributor churn detected.";
    } else if (summary.active === 0) {
        insightSentence = "No active contributors found in the last 30 days.";
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* 1. Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="New Contributors"
                    value={summary.new}
                    icon={UserPlus}
                    desc="First contribution < 30 days"
                    color="text-emerald-500"
                />
                <SummaryCard
                    title="Returning"
                    value={summary.returning}
                    icon={Users}
                    desc="Active now & contributed before"
                    color="text-blue-500"
                />
                <SummaryCard
                    title="Churned"
                    value={summary.churned}
                    icon={UserMinus}
                    desc="No activity > 45 days"
                    color="text-red-500"
                    // Feature 4: Churn Card Messaging
                    extraDesc="Contributors with no activity in the last 45 days."
                />
                <SummaryCard
                    title="Active Total"
                    value={summary.active}
                    icon={Activity}
                    desc="At least 1 action in 30 days"
                    color="text-primary"
                />
            </div>

            {/* 2. Contributor Flow & First-Time Experience */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Flow Visual */}
                <div className="bg-card border rounded-lg p-6 shadow-sm flex flex-col justify-between">
                    <div>
                        <h3 className="font-semibold text-foreground">Contributor Flow</h3>
                        <p className="text-sm text-muted-foreground mt-1">Are contributors sticking around?</p>
                    </div>

                    <div className="flex items-center justify-between mt-6 px-4">
                        <div className="text-center">
                            <div className="text-xl font-bold text-emerald-600">{summary.new}</div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">New</div>
                        </div>
                        <ArrowRight className="text-muted-foreground/30" />
                        <div className="text-center">
                            <div className="text-xl font-bold text-primary">{summary.active}</div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Active</div>
                        </div>
                        <div className="flex flex-col items-center">
                            <div className="h-4 w-[1px] bg-muted-foreground/30 mb-1"></div>
                            <ArrowRight className="text-muted-foreground/30 rotate-90" />
                        </div>
                    </div>
                    <div className="text-center mt-2">
                        <div className="text-xl font-bold text-red-500">{summary.churned}</div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Churned</div>

                        {/* Feature 3 (Partial): Churn Thresholds */}
                        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground text-left">
                            <p className="font-medium mb-1">Churn Rate Thresholds:</p>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                <span>Active &lt; 20%:</span> <span className="text-emerald-500 font-medium">Healthy</span>
                                <span>20% - 40%:</span> <span className="text-yellow-500 font-medium">Warning</span>
                                <span>&gt; 40%:</span> <span className="text-red-500 font-medium">Critical</span>
                            </div>
                        </div>
                    </div>

                    {/* Feature 1: Single Insight Sentence */}
                    <div className="mt-4 pt-4 border-t text-sm font-medium text-center text-foreground/80 bg-muted/20 p-2 rounded">
                        {insightSentence}
                    </div>
                </div>

                {/* First Time Experience */}
                <div className="lg:col-span-2 bg-card border rounded-lg p-6 shadow-sm flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-foreground">First-Time Contributor Experience</h3>
                                {/* Feature 2: Tooltip */}
                                <div className="group relative">
                                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                                    <div className="absolute top-0 left-6 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                        Delayed responses to first PRs significantly reduce contributor retention.
                                    </div>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">Speed of maintainer response to first PRs.</p>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${first_time_experience.severity === 'healthy' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                            first_time_experience.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' :
                                'bg-red-500/10 text-red-600 border-red-500/20'
                            }`}>
                            {first_time_experience.severity.toUpperCase()}
                        </div>
                    </div>

                    <div className="flex items-center gap-12">
                        <div>
                            <div className="text-4xl font-bold tracking-tight text-foreground">{first_time_experience.median_hours}h</div>
                            <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground font-medium">
                                <Clock className="w-4 h-4" /> Median Response Time
                            </div>
                        </div>
                        <div className="h-16 w-[1px] bg-border"></div>
                        <div>
                            <div className="text-4xl font-bold tracking-tight text-muted-foreground/60">{first_time_experience.worst_case_hours}h</div>
                            <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground">
                                <AlertTriangle className="w-4 h-4" /> Worst Case (Outlier)
                            </div>
                        </div>
                    </div>

                    {/* Feature 3: Explicit Health Thresholds */}
                    <div className="mt-8 pt-4 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Response Time Health Thresholds:</p>
                        <div className="flex gap-6 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                <span>Healthy: &lt; 24h</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                <span>Warning: 1-3 days</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                <span>Critical: &gt; 3 days</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. Active Contributors Table */}
            <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b flex items-center gap-2">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground">Active Contributors</h3>
                            {/* Feature 2: Tooltip */}
                            <div className="group relative">
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                                <div className="absolute top-0 left-6 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                    Contributors with at least one activity (PR, Issue, Comment) in the last 30 days.
                                </div>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Contributors with activity in the last 30 days.</p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-secondary/30 text-muted-foreground font-medium">
                            <tr>
                                <th className="px-6 py-3">Contributor</th>
                                <th className="px-6 py-3">Last Activity</th>
                                <th className="px-6 py-3">Latest Action</th>
                                <th className="px-6 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {active_contributors.map((c, i) => (
                                <tr key={i} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-6 py-4 flex items-center gap-3 font-medium text-foreground">
                                        <img src={c.avatar_url} alt={c.login} className="w-6 h-6 rounded-full" />
                                        {c.login}
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                        {new Date(c.last_activity_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.activity_type.includes('pr') ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                                            }`}>
                                            {c.activity_type.replace('_', ' ')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {c.status === 'healthy' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Active recently"></div>}
                                        {c.status === 'warning' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" title="No activity > 14 days"></div>}
                                        {c.status === 'critical' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" title="No activity > 25 days"></div>}
                                    </td>
                                </tr>
                            ))}
                            {active_contributors.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No active contributors found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ title, value, icon: Icon, desc, color, extraDesc }) => (
    <div className="bg-card p-5 rounded-lg border shadow-sm group relative flex flex-col justify-between">
        <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className={`w-5 h-5 ${color} opacity-80`} />
            </div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
        </div>
        {extraDesc && (
            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground italic">
                {extraDesc}
            </div>
        )}
        {/* Simple tooltip on hover */}
        <div className="absolute top-full left-0 mt-2 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-lg hidden group-hover:block z-10 w-48">
            {desc}
        </div>
    </div>
);

export default Contributors;
