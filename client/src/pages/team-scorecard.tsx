import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Trophy, Mail, Phone, Users, Target, TrendingUp, TrendingDown,
  Calendar, AlertTriangle, MessageSquare, ArrowLeft, RefreshCw,
  Crown, Medal, Award, Zap, IndianRupee, BarChart3, Clock,
  Send, Briefcase, CheckCircle2, XCircle, Flame, X, MailX
} from "lucide-react";

interface ScorecardMember {
  userId: string;
  userName: string;
  email: string;
  role: string;
  emailsSent: number;
  callsMade: number;
  meetingsDone: number;
  proposalsSent: number;
  hotLeads: number;
  notReplied: number;
  dealsWon: number;
  dealsLost: number;
  revenue: number;
  winRate: number;
  totalActivities: number;
}

interface ScorecardData {
  scorecard: ScorecardMember[];
  teamTotals: {
    emailsSent: number;
    callsMade: number;
    meetingsDone: number;
    proposalsSent: number;
    hotLeads: number;
    notReplied: number;
    dealsWon: number;
    dealsLost: number;
    revenue: number;
  };
  overdueActions: number;
  unactionedReplies: number;
  period: string;
  orgCreatedAt?: string;
}

interface DrilldownContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  pipelineStage?: string;
  sentAt?: string;
  subject?: string;
  daysSinceSent?: number;
  dealValue?: number;
  nextActionDate?: string;
  leadBucket?: string;
  suggestedAction?: string;
}

interface DrilldownModal {
  userId: string;
  userName: string;
  type: 'not_replied' | 'hot_leads';
}

interface TeamScorecardProps {
  onBack?: () => void;
}

export default function TeamScorecard({ onBack }: TeamScorecardProps) {
  const [data, setData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("today");
  const [drilldown, setDrilldown] = useState<DrilldownModal | null>(null);
  const [drilldownContacts, setDrilldownContacts] = useState<DrilldownContact[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const fetchScorecard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team/scorecard?period=${period}`, { credentials: "include" });
      if (res.ok) setData(await res.json());
    } catch (e) { console.error("Scorecard fetch failed:", e); }
    setLoading(false);
  };

  useEffect(() => { fetchScorecard(); }, [period]);

  const openDrilldown = async (member: ScorecardMember, type: 'not_replied' | 'hot_leads') => {
    setDrilldown({ userId: member.userId, userName: member.userName, type });
    setDrilldownContacts([]);
    setDrilldownLoading(true);
    try {
      const res = await fetch(`/api/team/scorecard/drilldown?userId=${member.userId}&type=${type}&period=${period}`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setDrilldownContacts(json.contacts || []);
      }
    } catch (e) { console.error("Drilldown fetch failed:", e); }
    setDrilldownLoading(false);
  };

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val.toLocaleString("en-IN")}`;
  };

  const getRankIcon = (idx: number) => {
    if (idx === 0) return <Crown className="h-5 w-5 text-yellow-500" />;
    if (idx === 1) return <Medal className="h-5 w-5 text-gray-400" />;
    if (idx === 2) return <Award className="h-5 w-5 text-amber-600" />;
    return <span className="text-sm font-bold text-gray-400 w-5 text-center">{idx + 1}</span>;
  };

  const getStageBadge = (stage?: string) => {
    const map: Record<string, string> = {
      interested: 'bg-blue-100 text-blue-700',
      meeting_scheduled: 'bg-purple-100 text-purple-700',
      meeting_done: 'bg-indigo-100 text-indigo-700',
      proposal_sent: 'bg-amber-100 text-amber-700',
      won: 'bg-green-100 text-green-700',
      lost: 'bg-red-100 text-red-600',
    };
    const label: Record<string, string> = {
      interested: 'Interested',
      meeting_scheduled: 'Meeting Scheduled',
      meeting_done: 'Meeting Done',
      proposal_sent: 'Proposal Sent',
      won: 'Won',
      lost: 'Lost',
    };
    if (!stage || !map[stage]) return null;
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${map[stage]}`}>{label[stage]}</span>;
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

  const getPeriodLabel = (p: string) => {
    if (p === 'today') return 'Today';
    if (p === 'week') return 'This Week';
    if (p === 'all') return 'All Time';
    const match = p.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const m = parseInt(match[2]) - 1;
      return `${monthNames[m]} ${match[1]}`;
    }
    return p;
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data) return <div className="text-center py-12 text-gray-500">Failed to load scorecard</div>;

  const { scorecard, teamTotals, overdueActions, unactionedReplies } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
              <ArrowLeft className="h-5 w-5 text-gray-500" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" /> Team Scorecard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Sales performance & leaderboard</p>
          </div>
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
          <Button variant="outline" size="sm" onClick={fetchScorecard} className="ml-2">
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Nudge Alerts */}
      {(overdueActions > 0 || unactionedReplies > 0) && (
        <div className="flex gap-3">
          {overdueActions > 0 && (
            <div className="flex-1 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
              <div className="bg-red-100 rounded-lg p-2"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
              <div>
                <div className="text-sm font-semibold text-red-800">{overdueActions} Overdue Actions</div>
                <div className="text-xs text-red-600">Contacts with past-due follow-ups need attention</div>
              </div>
            </div>
          )}
          {unactionedReplies > 0 && (
            <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
              <div className="bg-amber-100 rounded-lg p-2"><MessageSquare className="h-5 w-5 text-amber-600" /></div>
              <div>
                <div className="text-sm font-semibold text-amber-800">{unactionedReplies} Unactioned Replies</div>
                <div className="text-xs text-amber-600">Contacts replied but no follow-up activity logged</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Team Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard icon={<Send className="h-5 w-5 text-blue-600" />} label="Emails Sent" value={teamTotals.emailsSent} bg="bg-blue-50" />
        <SummaryCard icon={<Phone className="h-5 w-5 text-green-600" />} label="Calls Made" value={teamTotals.callsMade} bg="bg-green-50" />
        <SummaryCard icon={<Users className="h-5 w-5 text-purple-600" />} label="Meetings Done" value={teamTotals.meetingsDone} bg="bg-purple-50" />
        <SummaryCard icon={<IndianRupee className="h-5 w-5 text-emerald-600" />} label="Revenue" value={formatCurrency(teamTotals.revenue)} bg="bg-emerald-50" isString />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard icon={<Flame className="h-5 w-5 text-orange-600" />} label="Hot Leads" value={teamTotals.hotLeads} bg="bg-orange-50" />
        <SummaryCard icon={<MailX className="h-5 w-5 text-rose-600" />} label="Not Replied" value={teamTotals.notReplied || 0} bg="bg-rose-50" />
        <SummaryCard icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} label="Deals Won" value={teamTotals.dealsWon} bg="bg-green-50" />
        <SummaryCard icon={<XCircle className="h-5 w-5 text-red-500" />} label="Deals Lost" value={teamTotals.dealsLost} bg="bg-red-50" />
      </div>

      {/* Leaderboard */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-bold text-gray-900">Leaderboard</h2>
          <Badge variant="outline" className="ml-2 text-xs">{getPeriodLabel(period)}</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase w-10">#</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Team Member</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><Send className="h-3 w-3" /> Emails</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><MailX className="h-3 w-3" /> Not Replied</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" /> Calls</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><Users className="h-3 w-3" /> Meetings</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><Flame className="h-3 w-3" /> Hot Leads</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" /> Won</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-center">
                  <div className="flex items-center justify-center gap-1"><Target className="h-3 w-3" /> Win %</div>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase text-right">
                  <div className="flex items-center justify-end gap-1"><IndianRupee className="h-3 w-3" /> Revenue</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {scorecard.map((member, idx) => (
                <tr key={member.userId} className={`border-t border-gray-50 hover:bg-gray-50/50 transition ${idx === 0 ? "bg-yellow-50/30" : ""}`}>
                  <td className="px-4 py-3">{getRankIcon(idx)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{member.userName}</div>
                    <div className="text-[11px] text-gray-400">{member.email}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${member.emailsSent > 0 ? "text-blue-700" : "text-gray-300"}`}>{member.emailsSent}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(member.notReplied || 0) > 0 ? (
                      <button
                        onClick={() => openDrilldown(member, 'not_replied')}
                        className="font-semibold text-rose-600 underline underline-offset-2 hover:text-rose-800 transition"
                        title="Click to see who hasn't replied"
                      >
                        {member.notReplied}
                      </button>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${member.callsMade > 0 ? "text-green-700" : "text-gray-300"}`}>{member.callsMade}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${member.meetingsDone > 0 ? "text-purple-700" : "text-gray-300"}`}>{member.meetingsDone}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(member.hotLeads || 0) > 0 ? (
                      <button
                        onClick={() => openDrilldown(member, 'hot_leads')}
                        className="font-semibold text-orange-600 underline underline-offset-2 hover:text-orange-800 transition"
                        title="Click to see hot leads"
                      >
                        {member.hotLeads}
                      </button>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${member.dealsWon > 0 ? "text-green-700" : "text-gray-300"}`}>{member.dealsWon}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(member.dealsWon + member.dealsLost) > 0 ? (
                      <Badge className={`text-[10px] ${member.winRate >= 50 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {member.winRate}%
                      </Badge>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold ${member.revenue > 0 ? "text-emerald-700" : "text-gray-300"}`}>
                      {member.revenue > 0 ? formatCurrency(member.revenue) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
              {scorecard.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No team members found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Modal */}
      {drilldown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDrilldown(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {drilldown.type === 'not_replied' ? (
                    <span className="flex items-center gap-2"><MailX className="h-4 w-4 text-rose-600" /> Not Replied — {drilldown.userName}</span>
                  ) : (
                    <span className="flex items-center gap-2"><Flame className="h-4 w-4 text-orange-600" /> Hot Leads — {drilldown.userName}</span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {drilldown.type === 'not_replied'
                    ? 'Contacts who received emails but haven\'t replied'
                    : 'Contacts in active pipeline stages'}
                </p>
              </div>
              <button onClick={() => setDrilldown(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1">
              {drilldownLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              ) : drilldownContacts.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No contacts found</div>
              ) : drilldown.type === 'not_replied' ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase">Contact</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase">Subject</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase text-center">Days Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownContacts.map((c) => (
                      <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}</div>
                          <div className="text-[11px] text-gray-400">{c.email}</div>
                          {c.company && <div className="text-[11px] text-gray-400">{c.company}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs max-w-[180px] truncate">{c.subject || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          {c.daysSinceSent != null ? (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              c.daysSinceSent >= 7 ? 'bg-red-100 text-red-700' :
                              c.daysSinceSent >= 3 ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {c.daysSinceSent === 0 ? 'Today' : `${c.daysSinceSent}d`}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase">Contact</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase">Stage</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase">Next Action</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase text-right">Deal Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownContacts.map((c) => (
                      <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}</div>
                          <div className="text-[11px] text-gray-400">{c.email}</div>
                          {c.company && <div className="text-[11px] text-gray-400">{c.company}</div>}
                        </td>
                        <td className="px-4 py-3">{getStageBadge(c.pipelineStage)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {c.nextActionDate ? new Date(c.nextActionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {c.dealValue ? (
                            <span className="text-xs font-semibold text-emerald-700">{formatCurrency(c.dealValue)}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, bg, isString }: { icon: React.ReactNode; label: string; value: number | string; bg: string; isString?: boolean }) {
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
