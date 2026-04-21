import { useState, useEffect, useCallback } from "react";
import {
  Flame, Phone, Users, MessageSquare, Mail, CheckCircle2,
  AlertTriangle, RefreshCw, Zap, TrendingUp, Building2, Check, Plus
} from "lucide-react";

interface HotReply {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  replyType: string;
  replyQualityLabel?: string;
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

interface TodayProgress { emailsSent: number; callsMade: number; meetingsDone: number; whatsappSent: number; }
interface Targets { emails: number; calls: number; meetings: number; whatsapp: number; }
interface TaskQueueData {
  hotReplies: HotReply[];
  overdueFollowups: OverdueContact[];
  staleLeads: StaleContact[];
  todayProgress: TodayProgress;
  targets: Targets;
  summary: { hotRepliesCount: number; overdueCount: number; staleCount: number };
}

const stageBg: Record<string, string> = {
  interested: 'bg-yellow-100 text-yellow-700',
  meeting_scheduled: 'bg-purple-100 text-purple-700',
  meeting_done: 'bg-indigo-100 text-indigo-700',
  proposal_sent: 'bg-amber-100 text-amber-700',
  contacted: 'bg-blue-100 text-blue-700',
};
const stageLabel: Record<string, string> = {
  interested: 'Interested', meeting_scheduled: 'Mtg Scheduled',
  meeting_done: 'Mtg Done', proposal_sent: 'Proposal Sent', contacted: 'Contacted',
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MiniProgress({ icon, label, current, target, color }: {
  icon: React.ReactNode; label: string; current: number; target: number; color: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const done = current >= target;
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[11px] text-gray-500 font-medium">
          {icon} {label}
        </div>
        <span className={`text-[11px] font-bold ${done ? 'text-green-600' : 'text-gray-700'}`}>
          {current}<span className="text-gray-400 font-normal">/{target}</span>
          {done && ' ✓'}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-green-500' : color}`}
          style={{ width: `${pct}%` }} />
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
  const [logFeedback, setLogFeedback] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/my/task-queue', { credentials: 'include' });
      if (r.ok) setData(await r.json());
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const logActivity = async (contactId: string | undefined, type: string, taskId: string) => {
    if (loggingId) return;
    setLoggingId(taskId);
    setLogFeedback('');
    try {
      const r = await fetch('/api/my/log-activity', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contactId || null, type }),
      });
      if (r.ok) {
        setLoggedIds(prev => { const s = new Set(Array.from(prev)); s.add(taskId); return s; });
        setLogFeedback(`${type} logged!`);
        setTimeout(() => { setLogFeedback(''); fetchData(); }, 1200);
      } else {
        const err = await r.json().catch(() => ({}));
        setLogFeedback(err.message || 'Failed');
        setTimeout(() => setLogFeedback(''), 2000);
      }
    } catch (e: any) {
      setLogFeedback('Network error');
      setTimeout(() => setLogFeedback(''), 2000);
    }
    setLoggingId(null);
  };

  if (loading && !data) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center justify-center gap-2 text-gray-400 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading task queue...
      </div>
    );
  }
  if (!data) return null;

  const { hotReplies, overdueFollowups, staleLeads, todayProgress, targets, summary } = data;
  const totalTasks = summary.hotRepliesCount + summary.overdueCount + summary.staleCount;

  const tabs = [
    { key: 'replies' as const, label: 'Reply Now', count: summary.hotRepliesCount, icon: '🔥' },
    { key: 'overdue' as const, label: 'Overdue', count: summary.overdueCount, icon: '⚠️' },
    { key: 'stale' as const, label: 'Follow Up', count: summary.staleCount, icon: '📞' },
  ];

  const activeList = activeTab === 'replies' ? hotReplies : activeTab === 'overdue' ? overdueFollowups : staleLeads;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-bold text-gray-900">Daily Playbook</span>
          {totalTasks > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{totalTasks}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {logFeedback && <span className="text-xs text-green-600 font-medium">{logFeedback}</span>}
          <button onClick={fetchData} className="text-gray-400 hover:text-gray-600 transition">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Today's Progress — compact horizontal strip */}
      <div className="px-5 py-3 bg-gray-50/60 border-b border-gray-100">
        <div className="flex items-center gap-4">
          <MiniProgress icon={<Mail className="h-3 w-3 text-blue-500" />} label="Emails" current={todayProgress.emailsSent} target={targets.emails} color="bg-blue-500" />
          <MiniProgress icon={<Phone className="h-3 w-3 text-green-500" />} label="Calls" current={todayProgress.callsMade} target={targets.calls} color="bg-green-500" />
          <MiniProgress icon={<Users className="h-3 w-3 text-purple-500" />} label="Meetings" current={todayProgress.meetingsDone} target={targets.meetings} color="bg-purple-500" />
          <MiniProgress icon={<MessageSquare className="h-3 w-3 text-emerald-500" />} label="WhatsApp" current={todayProgress.whatsappSent} target={targets.whatsapp} color="bg-emerald-500" />
        </div>
        {/* Quick log buttons */}
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() => logActivity(undefined, 'call', `qcall_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-green-200 text-green-700 rounded-lg text-[11px] font-medium hover:bg-green-50 transition disabled:opacity-50"
          >
            <Phone className="h-3 w-3" /> Log Call
          </button>
          <button
            onClick={() => logActivity(undefined, 'meeting', `qmtg_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-purple-200 text-purple-700 rounded-lg text-[11px] font-medium hover:bg-purple-50 transition disabled:opacity-50"
          >
            <Users className="h-3 w-3" /> Log Meeting
          </button>
          <button
            onClick={() => logActivity(undefined, 'whatsapp', `qwa_${Date.now()}`)}
            disabled={!!loggingId}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-[11px] font-medium hover:bg-emerald-50 transition disabled:opacity-50"
          >
            <MessageSquare className="h-3 w-3" /> Log WhatsApp
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition ${
              activeTab === tab.key
                ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/30'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>{tab.icon}</span> {tab.label}
            {tab.count > 0 && (
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${
                activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
        {activeList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <CheckCircle2 className="h-7 w-7 mb-1.5 text-green-300" />
            <span className="text-xs">
              {activeTab === 'replies' ? 'All caught up! No pending replies.' :
               activeTab === 'overdue' ? 'No overdue follow-ups!' :
               'All leads are active!'}
            </span>
          </div>
        ) : activeTab === 'replies' ? (
          hotReplies.map(r => {
            const done = loggedIds.has(r.id);
            const name = r.firstName || r.lastName
              ? `${r.firstName || ''} ${r.lastName || ''}`.trim()
              : (r.fromName || r.fromEmail);
            return (
              <div key={r.id} className={`px-4 py-2.5 flex items-center gap-3 transition ${done ? 'opacity-40' : 'hover:bg-gray-50/60'}`}>
                <span className="text-base shrink-0">
                  {r.replyQualityLabel === 'Hot' ? '🔥' : r.replyQualityLabel === 'Warm' ? '⚡' : '📧'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-900 truncate">{name}</span>
                    {r.company && <span className="text-[10px] text-gray-400 truncate">{r.company}</span>}
                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">{timeAgo(r.receivedAt)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{r.subject || '(no subject)'}</div>
                </div>
                <button
                  onClick={() => logActivity(r.contactId, 'email', r.id)}
                  disabled={!!loggingId || done}
                  className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                    done ? 'bg-green-100 text-green-600' :
                    loggingId === r.id ? 'bg-gray-100 text-gray-400' :
                    'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                  }`}
                >
                  {loggingId === r.id ? <RefreshCw className="h-3 w-3 animate-spin" /> :
                   done ? <><Check className="h-3 w-3" /> Done</> : 'Reply →'}
                </button>
              </div>
            );
          })
        ) : activeTab === 'overdue' ? (
          overdueFollowups.map(c => {
            const done = loggedIds.has(c.id);
            const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email;
            return (
              <div key={c.id} className={`px-4 py-2.5 flex items-center gap-3 transition ${done ? 'opacity-40' : 'hover:bg-gray-50/60'}`}>
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-900 truncate">{name}</span>
                    {c.company && <span className="text-[10px] text-gray-400 truncate">{c.company}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {c.pipelineStage && stageBg[c.pipelineStage] && (
                      <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ${stageBg[c.pipelineStage]}`}>
                        {stageLabel[c.pipelineStage]}
                      </span>
                    )}
                    {(c.daysOverdue ?? 0) > 0 && (
                      <span className="text-[10px] text-red-600 font-semibold">{c.daysOverdue}d overdue</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {[
                    { type: 'call', icon: <Phone className="h-3 w-3" />, cls: 'text-green-700 border-green-200 hover:bg-green-50' },
                    { type: 'whatsapp', icon: <MessageSquare className="h-3 w-3" />, cls: 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
                    { type: 'email', icon: <Mail className="h-3 w-3" />, cls: 'text-blue-700 border-blue-200 hover:bg-blue-50' },
                  ].map(btn => (
                    <button key={btn.type}
                      onClick={() => logActivity(c.id, btn.type, `${c.id}_${btn.type}`)}
                      disabled={!!loggingId || done}
                      className={`p-1.5 bg-white border rounded-lg transition ${done ? 'opacity-40' : btn.cls} disabled:opacity-40`}
                      title={`Log ${btn.type}`}
                    >
                      {loggingId === `${c.id}_${btn.type}` ? <RefreshCw className="h-3 w-3 animate-spin" /> : btn.icon}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          staleLeads.map(c => {
            const done = loggedIds.has(c.id);
            const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email;
            return (
              <div key={c.id} className={`px-4 py-2.5 flex items-center gap-3 transition ${done ? 'opacity-40' : 'hover:bg-gray-50/60'}`}>
                <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-900 truncate">{name}</span>
                    {c.company && <span className="text-[10px] text-gray-400 truncate">{c.company}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {c.pipelineStage && stageBg[c.pipelineStage] && (
                      <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ${stageBg[c.pipelineStage]}`}>
                        {stageLabel[c.pipelineStage]}
                      </span>
                    )}
                    {c.lastActivityAt && (
                      <span className="text-[10px] text-gray-400">Last: {timeAgo(c.lastActivityAt)}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {[
                    { type: 'call', icon: <Phone className="h-3 w-3" />, cls: 'text-green-700 border-green-200 hover:bg-green-50' },
                    { type: 'whatsapp', icon: <MessageSquare className="h-3 w-3" />, cls: 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
                    { type: 'meeting', icon: <Users className="h-3 w-3" />, cls: 'text-purple-700 border-purple-200 hover:bg-purple-50' },
                  ].map(btn => (
                    <button key={btn.type}
                      onClick={() => logActivity(c.id, btn.type, `${c.id}_${btn.type}`)}
                      disabled={!!loggingId || done}
                      className={`p-1.5 bg-white border rounded-lg transition ${done ? 'opacity-40' : btn.cls} disabled:opacity-40`}
                      title={`Log ${btn.type}`}
                    >
                      {loggingId === `${c.id}_${btn.type}` ? <RefreshCw className="h-3 w-3 animate-spin" /> : btn.icon}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
