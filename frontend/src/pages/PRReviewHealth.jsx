import React, { useEffect, useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Loader2, AlertTriangle, Clock, List, AlertCircle, CheckCircle2, Info, ArrowRight } from 'lucide-react';

const PRReviewHealth = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!selectedRepo) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                // Construct repo name for query
                const repoName = `${selectedRepo.owner}/${selectedRepo.name}`;
                const res = await repoService.getPRReviewHealth(repoName);
                setData(res);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch PR review health data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedRepo]);

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading review health...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, attention_queue, review_flow } = data;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* 1. Health Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Open PRs"
                    value={summary.open_prs}
                    icon={List}
                    desc="Total backlog"
                    color="text-blue-500"
                />
                <SummaryCard
                    title="Unreviewed PRs"
                    value={summary.unreviewed_prs}
                    icon={AlertTriangle}
                    desc="Zero maintainer interaction"
                    color={summary.unreviewed_prs > 5 ? "text-red-500" : (summary.unreviewed_prs > 2 ? "text-yellow-500" : "text-emerald-500")}
                    tooltip="Open PRs with no maintainer reviews. High risk for contributor drop-off."
                />
                <SummaryCard
                    title="Waiting > 7 Days"
                    value={summary.waiting_over_7d}
                    icon={Clock}
                    desc="Stale candidates"
                    color={summary.waiting_over_7d > 5 ? "text-red-500" : "text-yellow-500"}
                />
                <SummaryCard
                    title="Median Review Time"
                    value={summary.median_review_hours === null ? "N/A" : `${summary.median_review_hours}h`}
                    icon={Clock}
                    desc={summary.median_review_hours === null ? "No data in period" : "First response speed (90d)"}
                    color={summary.median_review_hours === null ? "text-muted-foreground" : (summary.median_review_hours > 72 ? "text-red-500" : "text-emerald-500")}
                />
            </div>

            {/* 2. Critical PR Attention Queue */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col">
                    <div className="p-6 border-b">
                        <h3 className="font-semibold text-foreground">Critical PR Attention Queue</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                            Prioritized by risk: <span className="text-red-500 font-medium">Unreviewed</span> items first.
                        </p>
                    </div>
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                <tr>
                                    <th className="px-6 py-3">PR</th>
                                    <th className="px-6 py-3">Author</th>
                                    <th className="px-6 py-3">Age</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {attention_queue.map((pr) => (
                                    <tr key={pr.number} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {pr.is_unreviewed && (
                                                    <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                                                        Unreviewed
                                                    </span>
                                                )}
                                                <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={pr.title}>
                                                    #{pr.number} {pr.title}
                                                </a>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.author}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.age_days} days</td>
                                        <td className="px-6 py-4">
                                            {pr.status === 'healthy' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</span>}
                                            {pr.status === 'warning' && <span className="text-yellow-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Warning</span>}
                                            {pr.status === 'critical' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Critical</span>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className={`text-sm font-medium hover:underline ${pr.is_unreviewed ? "text-red-600" : "text-primary"}`}>
                                                View on GitHub
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                                {attention_queue.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">All caught up! Zero critical PRs. 🎉</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 3. Review Flow Insight */}
                <div className="space-y-6">
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="font-semibold text-foreground">Review Flow Insight</h3>
                            <div className="group relative">
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                                <div className="absolute right-0 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                    Shows where PRs are stuck in the pipeline.
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="relative pt-2">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-sm font-medium">Waiting for First Review</span>
                                    <span className="text-red-500 font-bold">{review_flow.waiting_for_first_review}</span>
                                </div>
                                <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500" style={{ width: `${(review_flow.waiting_for_first_review / (summary.open_prs || 1)) * 100}%` }}></div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">PRs with absolutely no maintainer feedback.</p>
                            </div>

                            <div className="relative">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-sm font-medium">In Review Process</span>
                                    <span className="text-blue-500 font-bold">{review_flow.in_review_process}</span>
                                </div>
                                <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500" style={{ width: `${(review_flow.in_review_process / (summary.open_prs || 1)) * 100}%` }}></div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">PRs that have received at least one review/comment.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ title, value, icon: Icon, desc, color, tooltip }) => (
    <div className="bg-card p-5 rounded-lg border shadow-sm group relative flex flex-col justify-between hover:border-primary/20 transition-colors">
        <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className={`w-5 h-5 ${color} opacity-80`} />
            </div>
            <div className={`text-2xl font-bold ${title === "Unreviewed PRs" && value > 0 ? "text-red-600" : "text-foreground"}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
        </div>
        {tooltip && (
            <div className="absolute top-full left-0 mt-2 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-lg hidden group-hover:block z-10 w-56">
                {tooltip}
            </div>
        )}
    </div>
);

export default PRReviewHealth;
