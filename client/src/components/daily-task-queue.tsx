import { useState, useEffect, useCallback } from "react";
import {
  Flame, Phone, Users, MessageSquare, Mail, CheckCircle2,
  AlertTriangle, Clock, ChevronRight, RefreshCw, Zap,
  TrendingUp, Building2, Calendar, Check, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HotReply {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  replyType: string;
  replyQualityLabel?: string;
  replyQualityScore?: number;
  firstName?: string;
  lastName?: string;
  company?: string;
  contactId?: string;
}

interface OverdueContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  pipelineStage?: string;
  nextActionDate?: string;
  daysOverdue?: number;
}

interface StaleContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
  pipelineStage?: string;
  lastActivityAt?: string;
}

interface TodayProgress {
  emailsSent: number;
  callsMade: number;
  meetingsDone: number;
  whatsappSent: number;
}

interface Targets {
  emails: number;
  calls: number;
  meetings: number;
  whatsapp: number;
}

interface TaskQueueData {
  hotReplies: HotReply[];
  overdueFollowups: OverdueContact[];
  staleLeads: StaleContact[];
  todayProgress: TodayProgress;
  targets: Targets;
  summary: { hotRepliesCount: number; overdueCount: number; staleCount: number };
}

const stageLabel: Record<string, string> = {
  interested: 'Interested', meeting_scheduled: 'Mtg Scheduled',
  meeting_done: 'Mtg Done', proposal_sent: 'Proposal Sent',
  contacted: 'Contacted', new: 'New',
};
const stageBg: Record<string, string> = {
  interested: 'bg-yellow-100 text-yellow-700',
  meeting_scheduled: 'bg-purple-100 text-purple-700',
  meeting_done: 'bg-indigo-100 text-indigo-700',
  proposal_sent: 'bg-amber-100 text-amber-700',
  contacted: 'bg-blue-100 text-blue-700',
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ProgressBar({ label, icon, current, target, color }: {
  label: string; icon: React.ReactNode; current: number; target: number; color: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const done = current >= target;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-28 shrink-0">
        {icon}
        <span className="text-xs text-gray-600 font-medium">{label}</span>
      </div>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-green-500' : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-16 text-right">
        <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-gray-700'}`}>{current}</span>
        <span className="text-xs text-gray-400">/{target}</span>
        {done && <Check className="inline h-3 w-3 text-green-500 ml-1" />}
      </div>
    </div>
  );
}

export default function DailyTaskQueue() {
  const [data, setData] = useState<TaskQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'replies' | 'overdue' | 'stale'>('replies');
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  const [logType, setLogType] = useState<Record<string, string>>({});

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/my/task-queue', { credentials: 'include' });
      if (r.ok) setData(await r.json());
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const logActivity = async (contactId: string | undefined, type: string, taskId: string) => {
    setLoggingId(taskId);
    try {
      await fetch('/api/my/log-activity', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, type }),
      });
      setLoggedIds(prev => { const s = new Set(Array.from(prev)); s.add(taskId); return s; });
      setTimeout(() => fetch_(), 800);
    } catch { }
    setLoggingId(null);
  };

  if (loading && !data) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex items-center justify-center h-48">
        <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
      </div>
    );
  }
  if (!data) return null;

  const { hotReplies, overdueFollowups, staleLeads, todayProgress, targets, summary } = data;
  const totalTasks = summary.hotRepliesCount + summary.overdueCount + summary.staleCount;

  const tabs = [
    { key: 'replies' as const, label: 'Reply Now', count: summary.hotRepliesCount, icon: <Mail className="h-3.5 w-3.5" />, color: 'text-rose-600', activeBg: 'bg-rose-600' },
    { key: 'overdue' as const, label: 'Overdue', count: summary.overdueCount, icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-amber-600', activeBg: 'bg-amber-600' },
    { key: 'stale' as const, label: 'Follow Up', count: summary.staleCount, icon: <TrendingUp className="h-3.5 w-3.5" />, color: 'text-blue-600', activeBg: 'bg-blue-600' },
  ];

  return (
    <div className="space-y-4">
      {/* Today's Progress */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-bold text-gray-900">Today's Progress</h2>
          </div>
          <button onClick={fetch_} className="text-gray-400 hover:text-gray-600 transition">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <ProgressBar label="Emails" icon={<Mail className="h-3.5 w-3.5 text-blue-500" />} current={todayProgress.emailsSent} target={targets.emails} color="bg-blue-500" />
          <ProgressBar label="Calls" icon={<Phone className="h-3.5 w-3.5 text-green-500" />} current={todayProgress.callsMade} target={targets.calls} color="bg-green-500" />
          <ProgressBar label="Meetings" icon={<Users className="h-3.5 w-3.5 text-purple-500" />} current={todayProgress.meetingsDone} target={targets.meetings} color="bg-purple-500" />
          <ProgressBar label="WhatsApp" icon={<MessageSquare className="h-3.5 w-3.5 text-emerald-500" />} current={todayProgress.whatsappSent} target={targets.whatsapp} color="bg-emerald-500" />
        </div>
        {/* Quick log row */}
        <div className="px-5 pb-4 flex gap-2">
          <button
            onClick={() => logActivity(undefined, 'call', `quick_call_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition border border-green-200"
          >
            <Plus className="h-3 w-3" /> Log Call
          </button>
          <button
            onClick={() => logActivity(undefined, 'meeting', `quick_meeting_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition border border-purple-200"
          >
            <Plus className="h-3 w-3" /> Log Meeting
          </button>
          <button
            onClick={() => logActivity(undefined, 'whatsapp', `quick_wa_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition border border-emerald-200"
          >
            <Plus className="h-3 w-3" /> Log WhatsApp
          </button>
        </div>
      </div>

      {/* Task Queue */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-gray-900">Priority Actions</h2>
            {totalTasks > 0 && (
              <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{totalTasks}</span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/40'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {activeTab === 'replies' && (
            hotReplies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCircle2 className="h-8 w-8 mb-2 text-green-300" />
                <span className="text-sm">All caught up! No pending replies.</span>
              </div>
            ) : hotReplies.map(r => {
              const done = loggedIds.has(r.id);
              const name = r.firstName || r.lastName ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : (r.fromName || r.fromEmail);
              return (
                <div key={r.id} className={`px-4 py-3 flex items-start gap-3 transition ${done ? 'opacity-50' : 'hover:bg-gray-50/50'}`}>
                  <div className="shrink-0 mt-0.5">
                    {r.replyQualityLabel === 'Hot' ? (
                      <span className="text-base">🔥</span>
                    ) : r.replyQualityLabel === 'Warm' ? (
                      <span className="text-base">⚡</span>
                    ) : (
                      <Mail className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                      {r.company && <span className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0"><Building2 className="h-2.5 w-2.5" />{r.company}</span>}
                      <span className="text-[10px] text-gray-400 ml-auto shrink-0">{timeAgo(r.receivedAt)}</span>
                    </div>
                    <div className="text-xs text-gray-600 truncate mt-0.5">{r.subject || '(no subject)'}</div>
                    <div className="text-[11px] text-gray-400 truncate">{r.snippet}</div>
                  </div>
                  <button
                    onClick={() => logActivity(r.contactId, 'email', r.id)}
                    disabled={!!loggingId || done}
                    className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                      done ? 'bg-green-100 text-green-600' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                    }`}
                  >
                    {done ? <><Check className="h-3 w-3" /> Done</> : <>Reply <ChevronRight className="h-3 w-3" /></>}
                  </button>
                </div>
              );
            })
          )}

          {activeTab === 'overdue' && (
            overdueFollowups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCircle2 className="h-8 w-8 mb-2 text-green-300" />
                <span className="text-sm">No overdue follow-ups!</span>
              </div>
            ) : overdueFollowups.map(c => {
              const done = loggedIds.has(c.id);
              const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email;
              return (
                <div key={c.id} className={`px-4 py-3 flex items-start gap-3 transition ${done ? 'opacity-50' : 'hover:bg-gray-50/50'}`}>
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                      {c.company && <span className="text-[10px] text-gray-400 shrink-0">{c.company}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.pipelineStage && stageBg[c.pipelineStage] && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${stageBg[c.pipelineStage]}`}>
                          {stageLabel[c.pipelineStage] || c.pipelineStage}
                        </span>
                      )}
                      {c.daysOverdue != null && c.daysOverdue > 0 && (
                        <span className="text-[10px] text-red-600 font-medium">{c.daysOverdue}d overdue</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => logActivity(c.id, 'call', c.id)}
                      disabled={!!loggingId || done}
                      className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-[11px] font-medium hover:bg-green-100 border border-green-200 transition"
                    >
                      <Phone className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => logActivity(c.id, 'whatsapp', `${c.id}_wa`)}
                      disabled={!!loggingId || done}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-medium hover:bg-emerald-100 border border-emerald-200 transition"
                    >
                      <MessageSquare className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => logActivity(c.id, 'email', `${c.id}_email`)}
                      disabled={!!loggingId || done}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition ${
                        done ? 'bg-green-100 text-green-600 border-green-200' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {activeTab === 'stale' && (
            staleLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCircle2 className="h-8 w-8 mb-2 text-green-300" />
                <span className="text-sm">All leads active — great job!</span>
              </div>
            ) : staleLeads.map(c => {
              const done = loggedIds.has(c.id);
              const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email;
              return (
                <div key={c.id} className={`px-4 py-3 flex items-start gap-3 transition ${done ? 'opacity-50' : 'hover:bg-gray-50/50'}`}>
                  <TrendingUp className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                      {c.company && <span className="text-[10px] text-gray-400 shrink-0">{c.company}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.pipelineStage && stageBg[c.pipelineStage] && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${stageBg[c.pipelineStage]}`}>
                          {stageLabel[c.pipelineStage] || c.pipelineStage}
                        </span>
                      )}
                      {c.lastActivityAt && (
                        <span className="text-[10px] text-gray-400">Last: {timeAgo(c.lastActivityAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => logActivity(c.id, 'call', c.id)}
                      disabled={!!loggingId || done}
                      className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-[11px] font-medium hover:bg-green-100 border border-green-200 transition"
                    >
                      <Phone className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => logActivity(c.id, 'whatsapp', `${c.id}_wa`)}
                      disabled={!!loggingId || done}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-medium hover:bg-emerald-100 border border-emerald-200 transition"
                    >
                      <MessageSquare className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => logActivity(c.id, 'meeting', `${c.id}_mtg`)}
                      disabled={!!loggingId || done}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition ${
                        done ? 'bg-green-100 text-green-600 border-green-200' : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-200'
                      }`}
                    >
                      {done ? <Check className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
