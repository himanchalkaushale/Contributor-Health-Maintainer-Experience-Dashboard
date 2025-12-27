import React, { useEffect, useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Loader2, AlertCircle, Clock, AlertTriangle, CheckCircle2, History, List } from 'lucide-react';

const IssuesHealth = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!selectedRepo) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await repoService.getIssuesHealth(selectedRepo.id);
                setData(res);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch issues health data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedRepo]);

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading issue analysis...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, unanswered_issues, age_buckets, triage_quality, first_time_issues } = data;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {/* 1. Health Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Open Issues"
                    value={summary.open_issues}
                    icon={List}
                    desc="Total backlog size"
                    color="text-blue-500"
                />
                <SummaryCard
                    title="Unanswered"
                    value={summary.unanswered}
                    icon={AlertCircle}
                    desc="Waiting for maintainer"
                    color={summary.unanswered > 10 ? "text-red-500" : "text-yellow-500"}
                />
                <SummaryCard
                    title="Median First Response"
                    value={summary.median_first_response_hours === null ? "N/A" : `${summary.median_first_response_hours}h`}
                    icon={Clock}
                    desc={summary.median_first_response_hours === null ? "No data in period" : "Responsiveness (Last 90d)"}
                    color={summary.median_first_response_hours === null ? "text-muted-foreground" : (summary.median_first_response_hours > 48 ? "text-red-500" : "text-emerald-500")}
                />
                <SummaryCard
                    title="Older than 30 Days"
                    value={summary.older_than_30d}
                    icon={History}
                    desc="Stagnant issues (responded but inactive)"
                    color={summary.older_than_30d > 20 ? "text-orange-500" : "text-muted-foreground"}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 2. Unanswered Issues Table (Actionable) */}
                <div className="lg:col-span-2 bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col">
                    <div className="p-6 border-b">
                        <h3 className="font-semibold text-foreground">Unanswered Issues (Actionable)</h3>
                        <p className="text-sm text-muted-foreground mt-1">Issues needing maintainer attention, sorted by age.</p>
                    </div>
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                <tr>
                                    <th className="px-6 py-3">Issue</th>
                                    <th className="px-6 py-3">Author</th>
                                    <th className="px-6 py-3">Age</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {unanswered_issues.map((issue) => (
                                    <tr key={issue.number} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[280px]" title={issue.title}>
                                                #{issue.number} {issue.title}
                                            </a>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">{issue.author}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{issue.age_days} days</td>
                                        <td className="px-6 py-4">
                                            {issue.status === 'healthy' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</span>}
                                            {issue.status === 'warning' && <span className="text-yellow-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Warning</span>}
                                            {issue.status === 'critical' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Critical</span>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                                                View on GitHub
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                                {unanswered_issues.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No unanswered issues! 🎉</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* 3. Triage Quality */}
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <h3 className="font-semibold text-foreground mb-4">
                            Triage Quality
                            <span className="block text-xs text-muted-foreground font-normal mt-1">Based on last 30 days (small sample size)</span>
                        </h3>
                        <div className="space-y-4">
                            <QualityMetric
                                label="Fast Response (<48h)"
                                value={triage_quality.percent_fast_response === null ? "N/A" : `${triage_quality.percent_fast_response}%`}
                                subtext="Issues responded to quickly"
                            />
                            <QualityMetric
                                label="First-Time Issues"
                                value={`${triage_quality.percent_first_time}%`}
                                subtext="Opened by new contributors"
                            />
                            {/* Skipping Labels Metric as DB doesn't support yet */}
                            <div className="p-3 bg-secondary/20 rounded border border-dashed text-xs text-muted-foreground">
                                Label analysis unavailable (DB Schema update required)
                            </div>
                        </div>
                    </div>

                    {/* 4. First-Time Experience */}
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <h3 className="font-semibold text-foreground mb-4">First-Time Experience</h3>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-medium">Unanswered</span>
                                    <span className={`text-xl font-bold ${first_time_issues.count > 0 ? "text-red-500" : "text-foreground"}`}>
                                        {first_time_issues.count}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">Issues by new contributors waiting for reply.</p>
                            </div>
                            <div className="pt-4 border-t">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-medium">Median Response</span>
                                    <span className="text-xl font-bold">{first_time_issues.median_response_hours === null ? "N/A" : `${first_time_issues.median_response_hours}h`}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">Time to welcome new contributors.</p>
                            </div>
                        </div>
                    </div>

                    {/* 5. Backlog Aging */}
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <h3 className="font-semibold text-foreground mb-4">Backlog Aging</h3>
                        <div className="space-y-3">
                            <AgingBar label="< 7 days" value={age_buckets["<7d"]} color="bg-emerald-500" total={summary.open_issues} />
                            <AgingBar label="7 - 30 days" value={age_buckets["7-30d"]} color="bg-yellow-500" total={summary.open_issues} />
                            <AgingBar label="> 30 days" value={age_buckets[">30d"]} color="bg-red-500" total={summary.open_issues} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ title, value, icon: Icon, desc, color }) => (
    <div className="bg-card p-5 rounded-lg border shadow-sm flex flex-col justify-between">
        <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className={`w-5 h-5 ${color} opacity-80`} />
            </div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
        </div>
    </div>
);

const QualityMetric = ({ label, value, subtext }) => (
    <div className="flex justify-between items-center">
        <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{subtext}</div>
        </div>
        <div className="text-lg font-bold">{value}</div>
    </div>
);

const AgingBar = ({ label, value, color, total }) => {
    const percent = total > 0 ? (value / total) * 100 : 0;
    return (
        <div>
            <div className="flex justify-between text-xs mb-1">
                <span>{label}</span>
                <span className="font-medium text-muted-foreground">{value}</span>
            </div>
            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${percent}%` }}></div>
            </div>
        </div>
    );
};

export default IssuesHealth;
