import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail, Phone, Users, Target, TrendingUp, Calendar, AlertTriangle,
  MessageSquare, RefreshCw, Zap, IndianRupee, BarChart3, Clock,
  Send, Briefcase, CheckCircle2, XCircle, Flame, ChevronRight,
  ArrowRight, PartyPopper, Bell, Eye, ChevronDown, ChevronUp,
  ExternalLink, User, Building2, Reply
} from "lucide-react";

interface DashboardStats {
  emailsSent: number;
  callsMade: number;
  meetingsDone: number;
  proposalsSent: number;
  hotLeads: number;
  dealsWon: number;
  dealsLost: number;
  revenue: number;
  winRate: number;
  totalActivities: number;
  pipeline: Record<string, { count: number; value: number }>;
}

interface Nudge {
  type: string;
  priority: string;
  title: string;
  message: string;
  count: number;
  actionType?: string;
}

interface RecentActivity {
  id: string;
  type: string;
  outcome: string;
  notes: string;
  createdAt: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
  company: string;
}

interface EmailNeedingReply {
  id: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  bodyHtml: string;
  receivedAt: string;
  status: string;
  campaignId: string;
  contactId: string;
  replyType: string;
  contactFirstName: string;
  contactLastName: string;
  contactCompany: string;
  campaignName: string;
}

interface DashboardData {
  stats: DashboardStats;
  nudges: Nudge[];
  recentActivities: RecentActivity[];
  period: string;
  orgCreatedAt?: string;
}

export default function MyDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("today");
  const [expandedNudge, setExpandedNudge] = useState<string | null>(null);
  const [replyEmails, setReplyEmails] = useState<EmailNeedingReply[]>([]);
  const [replyEmailsTotal, setReplyEmailsTotal] = useState(0);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailNeedingReply | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyMsg, setReclassifyMsg] = useState('');

  const triggerAIReclassify = async () => {
    setReclassifying(true);
    setReclassifyMsg('');
    try {
      const res = await fetch('/api/inbox/reclassify', { method: 'POST', credentials: 'include' });
      const json = await res.json();
      setReclassifyMsg(json.message || 'Started');
      setTimeout(() => { fetchDashboard(); setReclassifyMsg(''); }, 15000);
    } catch (e) { setReclassifyMsg('Failed to start'); }
    setReclassifying(false);
  };

  const fetchDashboard = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/my/dashboard?period=${period}`, { credentials: "include" });
      if (res.ok) {
        setData(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || err.message || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      console.error("Dashboard fetch failed:", e);
      setErrorMsg(e.message || 'Network error');
    }
    setLoading(false);
  };

  const fetchReplyEmails = async () => {
    setLoadingEmails(true);
    try {
      const res = await fetch(`/api/my/emails-needing-reply?limit=50`, { credentials: "include" });
      if (res.ok) {
        const result = await res.json();
        setReplyEmails(result.emails || []);
        setReplyEmailsTotal(result.total || 0);
      }
    } catch (e) { console.error("Reply emails fetch failed:", e); }
    setLoadingEmails(false);
  };

  useEffect(() => { fetchDashboard(); }, [period]);

  const handleNudgeClick = (nudge: Nudge) => {
    if (nudge.type === 'needs_reply') {
      if (expandedNudge === 'needs_reply') {
        setExpandedNudge(null);
      } else {
        setExpandedNudge('needs_reply');
        if (replyEmails.length === 0) fetchReplyEmails();
      }
    } else {
      setExpandedNudge(expandedNudge === nudge.type ? null : nudge.type);
    }
  };

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val.toLocaleString("en-IN")}`;
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const activityIcon = (type: string) => {
    switch (type) {
      case 'call': return <Phone className="h-3.5 w-3.5 text-green-600" />;
      case 'meeting': return <Users className="h-3.5 w-3.5 text-purple-600" />;
      case 'email': return <Mail className="h-3.5 w-3.5 text-blue-600" />;
      case 'proposal': return <Briefcase className="h-3.5 w-3.5 text-indigo-600" />;
      case 'whatsapp': return <MessageSquare className="h-3.5 w-3.5 text-green-500" />;
      default: return <Clock className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const nudgeStyles: Record<string, { bg: string; border: string; icon: any; iconBg: string; iconColor: string }> = {
    high: { bg: 'bg-red-50', border: 'border-red-200', icon: AlertTriangle, iconBg: 'bg-red-100', iconColor: 'text-red-600' },
    medium: { bg: 'bg-amber-50', border: 'border-amber-200', icon: Bell, iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
    low: { bg: 'bg-green-50', border: 'border-green-200', icon: PartyPopper, iconBg: 'bg-green-100', iconColor: 'text-green-600' },
  };

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const getMonthOptions = () => {
    const options: { key: string; label: string }[] = [];
    const createdAt = data?.orgCreatedAt ? new Date(data.orgCreatedAt) : new Date();
    const now = new Date();
    const startYear = createdAt.getFullYear();
    const startMonth = createdAt.getMonth();
    const endYear = now.getFullYear();
    const endMonth = now.getMonth();

    for (let y = startYear; y <= endYear; y++) {
      const mStart = y === startYear ? startMonth : 0;
      const mEnd = y === endYear ? endMonth : 11;
      for (let m = mStart; m <= mEnd; m++) {
        const key = `${y}-${String(m + 1).padStart(2, '0')}`;
        const label = y === endYear && y === startYear ? monthNames[m] : `${monthNames[m]} ${y}`;
        options.push({ key, label });
      }
    }
    return options;
  };

  const monthOptions = getMonthOptions();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data) return (
    <div className="text-center py-12">
      <div className="text-gray-500">Failed to load dashboard</div>
      {errorMsg && <div className="text-xs text-red-400 mt-2">{errorMsg}</div>}
    </div>
  );

  const { stats, nudges, recentActivities } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-blue-600" /> My Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Your personal sales performance & action items</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {["today", "week"].map(p => (
            <button key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === p ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {p === 'today' ? 'Today' : 'This Week'}
            </button>
          ))}
          <span className="text-gray-300 mx-1">|</span>
          {monthOptions.map(({ key, label }) => (
            <button key={key}
              onClick={() => setPeriod(key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${period === key ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {label}
            </button>
          ))}
          <span className="text-gray-300 mx-1">|</span>
          <button
            onClick={() => setPeriod('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${period === 'all' ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            All Time
          </button>
          <Button variant="outline" size="sm" onClick={fetchDashboard} className="ml-2">
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={triggerAIReclassify} disabled={reclassifying} className="ml-1 border-purple-300 text-purple-700 hover:bg-purple-50">
            <Zap className={`h-3.5 w-3.5 mr-1 ${reclassifying ? "animate-pulse" : ""}`} /> AI Refine
          </Button>
          {reclassifyMsg && <span className="text-xs text-purple-600 ml-2">{reclassifyMsg}</span>}
        </div>
      </div>

      {/* Nudges / Action Items */}
      {nudges.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-500" /> Action Items
          </h2>
          <div className="space-y-2">
            {nudges.map((nudge) => {
              const style = nudgeStyles[nudge.priority] || nudgeStyles.medium;
              const NudgeIcon = nudge.type === 'needs_reply' ? Mail : nudge.type === 'celebration' ? PartyPopper : style.icon;
              const isExpanded = expandedNudge === nudge.type;
              const isClickable = nudge.type === 'needs_reply';

              return (
                <div key={nudge.type}>
                  <div
                    onClick={() => isClickable && handleNudgeClick(nudge)}
                    className={`${style.bg} border ${style.border} rounded-xl p-3 flex items-center gap-3 ${isClickable ? 'cursor-pointer hover:shadow-sm transition' : ''}`}>
                    <div className={`${style.iconBg} rounded-lg p-2 shrink-0`}>
                      <NudgeIcon className={`h-5 w-5 ${style.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800">{nudge.title}</div>
                      <div className="text-xs text-gray-600">{nudge.message}</div>
                    </div>
                    {isClickable && (
                      <div className="shrink-0">
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    )}
                  </div>

                  {/* Expanded: Emails needing reply */}
                  {nudge.type === 'needs_reply' && isExpanded && (
                    <div className="mt-2 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                      {loadingEmails ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                        </div>
                      ) : replyEmails.length === 0 ? (
                        <div className="text-center py-6 text-gray-400 text-sm">No emails found</div>
                      ) : (
                        <>
                          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 uppercase">
                              {replyEmailsTotal} email{replyEmailsTotal !== 1 ? 's' : ''} awaiting reply
                            </span>
                            <Button variant="ghost" size="sm" onClick={fetchReplyEmails} className="h-7 text-xs">
                              <RefreshCw className={`h-3 w-3 mr-1 ${loadingEmails ? 'animate-spin' : ''}`} /> Refresh
                            </Button>
                          </div>

                          <div className="divide-y divide-gray-50">
                            {replyEmails.map((email) => (
                              <div key={email.id}
                                onClick={() => setSelectedEmail(selectedEmail?.id === email.id ? null : email)}
                                className={`px-4 py-3 hover:bg-blue-50/40 cursor-pointer transition ${selectedEmail?.id === email.id ? 'bg-blue-50/60' : ''} ${email.status === 'unread' ? 'bg-blue-50/20' : ''}`}>
                                <div className="flex items-start gap-3">
                                  <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${email.status === 'unread' ? 'bg-blue-500' : 'bg-gray-300'}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`text-sm truncate ${email.status === 'unread' ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                                          {email.fromName || email.fromEmail}
                                        </span>
                                        {email.contactCompany && (
                                          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                            <Building2 className="h-2.5 w-2.5" /> {email.contactCompany}
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(email.receivedAt)}</span>
                                    </div>
                                    <div className={`text-sm truncate ${email.status === 'unread' ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                                      {email.subject || '(no subject)'}
                                    </div>
                                    <div className="text-xs text-gray-400 truncate mt-0.5">{email.snippet}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                      {email.campaignName && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{email.campaignName}</Badge>
                                      )}
                                      {email.replyType && email.replyType !== '' && (
                                        <Badge className={`text-[10px] px-1.5 py-0 h-4 ${
                                          email.replyType === 'positive' ? 'bg-green-100 text-green-700' :
                                          email.replyType === 'negative' ? 'bg-red-100 text-red-600' :
                                          email.replyType === 'ooo' ? 'bg-purple-100 text-purple-600' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>{email.replyType}</Badge>
                                      )}
                                    </div>

                                    {/* Expanded email body */}
                                    {selectedEmail?.id === email.id && (
                                      <div className="mt-3 pt-3 border-t border-gray-100">
                                        <div className="flex items-center gap-4 text-[11px] text-gray-500 mb-2">
                                          <span>From: <strong>{email.fromName || ''}</strong> &lt;{email.fromEmail}&gt;</span>
                                          <span>To: {email.toEmail}</span>
                                          <span>{formatDate(email.receivedAt)}</span>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 max-h-64 overflow-y-auto">
                                          {email.bodyHtml ? (
                                            <div dangerouslySetInnerHTML={{ __html: email.bodyHtml }} className="prose prose-sm max-w-none" />
                                          ) : (
                                            <pre className="whitespace-pre-wrap font-sans">{email.body || email.snippet || 'No content'}</pre>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<Send className="h-5 w-5 text-blue-600" />} label="Emails Sent" value={stats.emailsSent} bg="bg-blue-50" />
        <StatCard icon={<Phone className="h-5 w-5 text-green-600" />} label="Calls Made" value={stats.callsMade} bg="bg-green-50" />
        <StatCard icon={<Users className="h-5 w-5 text-purple-600" />} label="Meetings Done" value={stats.meetingsDone} bg="bg-purple-50" />
        <StatCard icon={<IndianRupee className="h-5 w-5 text-emerald-600" />} label="Revenue" value={formatCurrency(stats.revenue)} bg="bg-emerald-50" isString />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<Flame className="h-5 w-5 text-orange-600" />} label="Hot Leads" value={stats.hotLeads} bg="bg-orange-50" />
        <StatCard icon={<Briefcase className="h-5 w-5 text-indigo-600" />} label="Proposals Sent" value={stats.proposalsSent} bg="bg-indigo-50" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} label="Deals Won" value={stats.dealsWon} bg="bg-green-50" />
        <StatCard icon={<Target className="h-5 w-5 text-blue-600" />} label="Win Rate" value={`${stats.winRate}%`} bg="bg-blue-50" isString />
      </div>

      {/* Pipeline Funnel + Recent Activity */}
      <div className="grid grid-cols-2 gap-4">
        {/* Pipeline */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-bold text-gray-900">My Pipeline</h2>
          </div>
          <div className="p-4 space-y-2">
            {[
              { stage: 'new', label: 'New', color: 'bg-gray-400' },
              { stage: 'contacted', label: 'Contacted', color: 'bg-blue-400' },
              { stage: 'interested', label: 'Interested', color: 'bg-yellow-400' },
              { stage: 'meeting_scheduled', label: 'Meeting Scheduled', color: 'bg-purple-400' },
              { stage: 'meeting_done', label: 'Meeting Done', color: 'bg-purple-500' },
              { stage: 'proposal_sent', label: 'Proposal Sent', color: 'bg-indigo-500' },
              { stage: 'won', label: 'Won', color: 'bg-green-500' },
              { stage: 'lost', label: 'Lost', color: 'bg-red-400' },
            ].map(({ stage, label, color }) => {
              const data = stats.pipeline[stage];
              const count = data?.count || 0;
              const value = data?.value || 0;
              const maxCount = Math.max(...Object.values(stats.pipeline).map(p => p.count), 1);
              const barWidth = count > 0 ? Math.max((count / maxCount) * 100, 8) : 0;

              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-gray-600 font-medium truncate">{label}</div>
                  <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden relative">
                    {barWidth > 0 && (
                      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${barWidth}%` }} />
                    )}
                  </div>
                  <div className="w-16 text-right">
                    <span className="text-sm font-bold text-gray-900">{count}</span>
                    {value > 0 && <span className="text-[10px] text-gray-400 ml-1">{formatCurrency(value)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Clock className="h-5 w-5 text-gray-600" />
            <h2 className="text-base font-bold text-gray-900">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {recentActivities.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No recent activity</div>
            ) : (
              recentActivities.map((act) => (
                <div key={act.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="mt-0.5 bg-gray-50 rounded-lg p-1.5">
                    {activityIcon(act.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">
                        {act.type.charAt(0).toUpperCase() + act.type.slice(1)}
                        {act.outcome && (
                          <Badge className={`ml-2 text-[10px] ${
                            act.outcome === 'interested' ? 'bg-green-100 text-green-700' :
                            act.outcome === 'not_interested' ? 'bg-red-100 text-red-600' :
                            act.outcome === 'follow_up' ? 'bg-blue-100 text-blue-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>{act.outcome.replace(/_/g, ' ')}</Badge>
                        )}
                      </span>
                      <span className="text-[11px] text-gray-400">{timeAgo(act.createdAt)}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {act.firstName || act.lastName ? `${act.firstName || ''} ${act.lastName || ''}`.trim() : act.contactEmail}
                      {act.company && <span className="text-gray-400"> · {act.company}</span>}
                    </div>
                    {act.notes && <div className="text-xs text-gray-400 mt-0.5 truncate">{act.notes}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bg, isString }: { icon: React.ReactNode; label: string; value: number | string; bg: string; isString?: boolean }) {
  return (
    <div className={`${bg} rounded-xl p-4 border border-gray-100`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{isString ? value : (value as number).toLocaleString()}</div>
    </div>
  );
}
