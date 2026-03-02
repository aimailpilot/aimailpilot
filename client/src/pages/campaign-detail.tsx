import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Send, Eye, MousePointerClick, Reply, AlertTriangle,
  CheckCircle2, XCircle, Clock, Search, ChevronDown, ChevronUp,
  Mail, Activity, Users, ExternalLink, RefreshCw,
  MoreVertical, Play, Pause, Copy, Archive, X, Pencil,
  Info, Zap, Ban, Calendar, Shield, Timer, Repeat, Check,
  MailOpen, MousePointer, MessageSquare, AlertCircle, UserMinus
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CampaignDetail, CampaignMessage, TrackingEvent, StepAnalytics, ActivityTimelineItem } from "@/types";

interface CampaignDetailPageProps {
  campaignId: string;
  onBack: () => void;
}

export default function CampaignDetailPage({ campaignId, onBack }: CampaignDetailPageProps) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showActions, setShowActions] = useState(false);
  const [showAllEmails, setShowAllEmails] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/detail`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load campaign');
      const data = await res.json();
      setDetail(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [campaignId]);

  // Auto-refresh every 10s for active campaigns
  useEffect(() => {
    if (detail?.campaign?.status === 'active') {
      const interval = setInterval(fetchDetail, 10000);
      return () => clearInterval(interval);
    }
  }, [detail?.campaign?.status]);

  // Close actions menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setShowActions(false);
    };
    if (showActions) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActions]);

  // Action handlers
  const handleDuplicate = async () => {
    setShowActions(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/duplicate`, { method: 'POST', credentials: 'include' });
      if (res.ok) alert('Campaign duplicated!');
    } catch (e) { /* ignore */ }
  };

  const handlePause = async () => {
    setShowActions(false);
    try {
      await fetch(`/api/campaigns/${campaignId}/pause`, { method: 'POST', credentials: 'include' });
      fetchDetail();
    } catch (e) { /* ignore */ }
  };

  const handleResume = async () => {
    setShowActions(false);
    try {
      await fetch(`/api/campaigns/${campaignId}/resume`, { method: 'POST', credentials: 'include' });
      fetchDetail();
    } catch (e) { /* ignore */ }
  };

  const handleStop = async () => {
    setShowActions(false);
    if (!confirm('Are you sure you want to cancel this campaign?')) return;
    try {
      await fetch(`/api/campaigns/${campaignId}/stop`, { method: 'POST', credentials: 'include' });
      fetchDetail();
    } catch (e) { /* ignore */ }
  };

  const handleArchive = async () => {
    setShowActions(false);
    try {
      await fetch(`/api/campaigns/${campaignId}/archive`, { method: 'POST', credentials: 'include' });
      fetchDetail();
    } catch (e) { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading campaign details...</span>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-16">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
          <p className="text-gray-600">{error || 'Campaign not found'}</p>
        </div>
      </div>
    );
  }

  const { campaign, analytics, messages, totalMessages, recentEvents, stepAnalytics, emailAccount, activityTimeline } = detail;

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-500 text-white',
      completed: 'bg-gray-500 text-white',
      ended: 'bg-gray-500 text-white',
      draft: 'bg-slate-400 text-white',
      scheduled: 'bg-blue-500 text-white',
      paused: 'bg-amber-500 text-white',
      archived: 'bg-gray-400 text-white',
    };
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[status] || styles.draft}`}>{status === 'completed' ? 'ended' : status}</span>;
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatRelativeTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 172800000) return 'Yesterday';
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Overview stat emojis matching Mailmeteor style
  const overviewStats = [
    {
      label: 'Emails sent', value: analytics?.totalSent || campaign.sentCount || 0,
      emoji: '📨', emojiBg: 'bg-red-50 border border-red-100', rate: null,
    },
    {
      label: 'Opens', value: analytics?.opened || campaign.openedCount || 0,
      emoji: '👀', emojiBg: 'bg-yellow-50 border border-yellow-100', rate: analytics?.openRate ? `${analytics.openRate}%` : null,
    },
    {
      label: 'Clicks', value: analytics?.clicked || campaign.clickedCount || 0,
      emoji: '🖱️', emojiBg: 'bg-teal-50 border border-teal-100', rate: analytics?.clickRate ? `${analytics.clickRate}%` : null,
    },
    {
      label: 'Replied', value: analytics?.replied || campaign.repliedCount || 0,
      emoji: '💬', emojiBg: 'bg-green-50 border border-green-100', rate: analytics?.replyRate ? `${analytics.replyRate}%` : null,
    },
    {
      label: 'Bounces', value: analytics?.bounced || campaign.bouncedCount || 0,
      emoji: '⚠️', emojiBg: 'bg-pink-50 border border-pink-100', rate: analytics?.bounceRate ? `${analytics.bounceRate}%` : null,
    },
    {
      label: 'Unsubscribes', value: analytics?.unsubscribed || campaign.unsubscribedCount || 0,
      emoji: '🚫', emojiBg: 'bg-gray-50 border border-gray-100', rate: analytics?.unsubscribeRate ? `${analytics.unsubscribeRate}%` : null,
    },
  ];

  // Filter messages for emails table
  const filteredMessages = messages.filter((m: CampaignMessage) => {
    const matchesSearch =
      (m.contact?.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.contact?.firstName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.contact?.lastName || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'opened') return matchesSearch && (m.openedAt || (m.openCount && m.openCount > 0));
    if (statusFilter === 'clicked') return matchesSearch && (m.clickedAt || (m.clickCount && m.clickCount > 0));
    if (statusFilter === 'replied') return matchesSearch && (m.repliedAt || (m.replyCount && m.replyCount > 0));
    if (statusFilter === 'bounced') return matchesSearch && (m.status === 'failed' || m.status === 'bounced');
    return matchesSearch;
  });

  // Group events by contact for tracking table
  const contactEventMap = new Map<string, { contact: any; email: string; events: TrackingEvent[]; lastActivity: string }>();
  for (const msg of messages) {
    if (!msg.contact) continue;
    const key = msg.contact.email;
    if (!contactEventMap.has(key)) {
      contactEventMap.set(key, { contact: msg.contact, email: msg.subject || '', events: [], lastActivity: msg.sentAt || msg.createdAt });
    }
    const entry = contactEventMap.get(key)!;
    if (msg.events) {
      entry.events.push(...msg.events);
    }
    // Track latest activity
    const lastTime = msg.sentAt || msg.createdAt;
    if (lastTime > entry.lastActivity) entry.lastActivity = lastTime;
    if (msg.events && msg.events.length > 0) {
      const latestEventTime = msg.events.reduce((max, e) => e.createdAt > max ? e.createdAt : max, msg.events[0].createdAt);
      if (latestEventTime > entry.lastActivity) entry.lastActivity = latestEventTime;
    }
  }
  const trackingRows = Array.from(contactEventMap.values())
    .filter(row => row.events.length > 0)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, 20);

  const isActive = campaign.status === 'active';
  const isPaused = campaign.status === 'paused';
  const isEnded = campaign.status === 'completed' || campaign.status === 'archived';

  // Delivery progress bar
  const totalSent = analytics?.totalSent || campaign.sentCount || 0;
  const totalRecip = campaign.totalRecipients || totalMessages || 1;
  const deliveryPct = totalRecip > 0 ? Math.min(100, (totalSent / totalRecip) * 100) : 0;
  const openPct = totalSent > 0 ? ((analytics?.opened || campaign.openedCount || 0) / totalSent) * 100 : 0;

  return (
    <div className="max-w-5xl mx-auto">
      {/* ==================== HEADER ==================== */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <Play className="h-3 w-3" /> Campaign
              </div>
              <h1 className="text-xl font-bold text-gray-900 truncate">{campaign.name}</h1>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-400 flex-wrap">
                <span><strong className="text-gray-600">Created</strong> {formatDateTime(campaign.createdAt)}</span>
                {isEnded && campaign.updatedAt && (
                  <span><strong className="text-gray-600">Ended</strong> {formatDateTime(campaign.updatedAt)}</span>
                )}
                <span><strong className="text-gray-600">Status</strong> {getStatusBadge(campaign.status)}</span>
              </div>
            </div>
          </div>

          {/* Actions dropdown */}
          <div className="relative flex-shrink-0" ref={actionsRef}>
            <Button
              onClick={() => setShowActions(!showActions)}
              className="bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              size="sm"
            >
              Actions <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-48 z-50">
                <button onClick={() => { setShowActions(false); /* TODO: open edit */ }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
                  <Pencil className="h-3.5 w-3.5" /> Update
                </button>
                {isActive ? (
                  <button onClick={handlePause}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
                    <Pause className="h-3.5 w-3.5" /> Pause sending
                  </button>
                ) : isPaused ? (
                  <button onClick={handleResume}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
                    <Play className="h-3.5 w-3.5" /> Resume sending
                  </button>
                ) : (
                  <button disabled
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-300 cursor-not-allowed flex items-center gap-2.5">
                    <Pause className="h-3.5 w-3.5" /> Pause sending
                  </button>
                )}
                <button onClick={handleDuplicate}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                {(isActive || isPaused) ? (
                  <button onClick={handleStop}
                    className="w-full text-left px-4 py-2.5 text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2.5">
                    <Ban className="h-3.5 w-3.5" /> Cancel
                  </button>
                ) : (
                  <button disabled
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-300 cursor-not-allowed flex items-center gap-2.5">
                    <Ban className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
                <button onClick={handleArchive}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delivery progress bar */}
        <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full flex">
            <div className="bg-emerald-400 transition-all duration-500" style={{ width: `${openPct}%` }} />
            <div className="bg-blue-400 transition-all duration-500" style={{ width: `${Math.max(0, deliveryPct - openPct)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-1.5 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Opened</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Delivered</span>
          <span className="ml-auto">{deliveryPct.toFixed(0)}% delivered</span>
        </div>
      </div>

      {/* ==================== OVERVIEW WITH EMOJIS ==================== */}
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            Overview
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-gray-300" />
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Campaign performance overview</p></TooltipContent>
            </Tooltip>
          </h2>
          <button onClick={fetchDetail} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {overviewStats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className={`w-14 h-14 rounded-full ${stat.emojiBg} flex items-center justify-center mx-auto mb-2`}>
                <span className="text-2xl">{stat.emoji}</span>
              </div>
              <div className="text-[11px] text-gray-500 mb-0.5 flex items-center justify-center gap-1">
                {stat.label}
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-2.5 w-2.5 text-gray-300" />
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Total {stat.label.toLowerCase()}</p></TooltipContent>
                </Tooltip>
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {stat.value.toLocaleString()}
                {stat.rate && <span className="text-sm font-medium text-gray-400 ml-1">{stat.rate}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* ==================== STEP BREAKDOWN TABLE ==================== */}
        {stepAnalytics && stepAnalytics.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider w-1/3"></th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Sent</th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Opens <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Clicks <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Replies <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Unsubscribes <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {stepAnalytics.map((step: StepAnalytics, i: number) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-sm font-semibold text-gray-900">{step.label}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        {step.stepNumber === 0 ? (
                          <>Sent at campaign creation</>
                        ) : step.description ? (
                          <>
                            <span className="text-gray-400">↓</span>
                            <span>{step.description.split('–')[0]?.trim()}</span>
                            {step.description.includes('–') && (
                              <span className="flex items-center gap-0.5">
                                <Timer className="h-3 w-3 text-blue-400" />
                                {step.description.split('–')[1]?.trim()}
                              </span>
                            )}
                          </>
                        ) : (
                          <><Clock className="h-3 w-3" /> Follow-up</>
                        )}
                      </div>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-lg font-bold text-gray-900">{step.sent}</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-lg font-bold text-gray-900">{step.opened}</span>
                      <span className="text-xs text-gray-400 ml-1">{step.openRate}%</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-lg font-bold text-gray-900">{step.clicked}</span>
                      <span className="text-xs text-gray-400 ml-1">{step.clickRate}%</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-lg font-bold text-gray-900">{step.replied}</span>
                      <span className="text-xs text-gray-400 ml-1">{step.replyRate}%</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-lg font-bold text-gray-900">{step.unsubscribed}</span>
                      <span className="text-xs text-gray-400 ml-1">0%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ==================== CAMPAIGN DETAILS + TIMELINE ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Campaign details */}
          <div>
            <h3 className="text-base font-bold text-gray-900 mb-4">Campaign details</h3>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                <DetailRow
                  icon={<Users className="h-4 w-4" />}
                  label="Total recipients"
                  value={`${campaign.totalRecipients || totalMessages}`}
                  tooltip="Total number of email recipients for this campaign"
                />
                <DetailRow
                  icon={<Eye className="h-4 w-4" />}
                  label="Tracking"
                  value={campaign.trackOpens !== false ? 'Enabled' : 'Disabled'}
                  valueColor={campaign.trackOpens !== false ? 'text-emerald-600' : 'text-gray-400'}
                  tooltip="Whether email open and click tracking is enabled"
                />
                <DetailRow
                  icon={<Shield className="h-4 w-4" />}
                  label="Unsubscribe"
                  value={campaign.includeUnsubscribe ? 'Enabled' : 'Disabled'}
                  valueColor={campaign.includeUnsubscribe ? 'text-emerald-600' : 'text-gray-400'}
                  tooltip="Whether an unsubscribe link is included in emails"
                />
                <DetailRow
                  icon={<Timer className="h-4 w-4" />}
                  label="Throttling"
                  value="Every 2 seconds"
                  tooltip="Delay between each email sent to avoid spam filters"
                />
                <DetailRow
                  icon={<Mail className="h-4 w-4" />}
                  label="Daily cap"
                  value={emailAccount ? 'Max 500 emails/day' : 'Not configured'}
                  tooltip="Maximum number of emails sent per day for this account"
                />
                <DetailRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Weekdays"
                  value="Enabled"
                  valueColor="text-emerald-600"
                  tooltip="Emails are sent only on weekdays"
                />
                <DetailRow
                  icon={<Repeat className="h-4 w-4" />}
                  label="Follow-up"
                  value={(detail.followupSequences?.length || 0) > 0 ? 'Enabled' : 'Disabled'}
                  valueColor={(detail.followupSequences?.length || 0) > 0 ? 'text-emerald-600' : 'text-gray-400'}
                  tooltip="Whether automatic follow-up emails are configured"
                />
                {emailAccount && (
                  <DetailRow
                    icon={<Send className="h-4 w-4" />}
                    label="Sender"
                    value={`${emailAccount.displayName || emailAccount.email} (${emailAccount.provider})`}
                    tooltip="Email account used to send this campaign"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Activity timeline */}
          <div>
            <h3 className="text-base font-bold text-gray-900 mb-4">Activity</h3>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="relative">
                {/* Timeline vertical line */}
                <div className="absolute left-[13px] top-4 bottom-4 w-px bg-gray-200" />

                <div className="space-y-5">
                  {(activityTimeline || []).map((item: ActivityTimelineItem, i: number) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                        item.icon === 'check' ? 'bg-emerald-100' :
                        item.icon === 'edit' ? 'bg-gray-100' :
                        item.icon === 'pause' ? 'bg-amber-100' :
                        item.icon === 'clock' ? 'bg-blue-100' :
                        'bg-blue-100'
                      }`}>
                        {item.icon === 'check' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> :
                         item.icon === 'edit' ? <Pencil className="h-3.5 w-3.5 text-gray-500" /> :
                         item.icon === 'pause' ? <Pause className="h-3.5 w-3.5 text-amber-600" /> :
                         item.icon === 'clock' ? <Clock className="h-3.5 w-3.5 text-blue-600" /> :
                         <Play className="h-3.5 w-3.5 text-blue-600" />}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{item.label}</div>
                        <div className="text-xs text-gray-400">{formatDateTime(item.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {recentEvents.length > 0 && (
                  <div className="pt-3 mt-3 border-t border-gray-100 text-xs text-gray-400 pl-10">
                    ...and {recentEvents.length} tracking event{recentEvents.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ==================== TRACKING TABLE ==================== */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-900">Tracking</h3>
            {trackingRows.length > 0 && (
              <button
                onClick={() => setShowAllEmails(true)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                View all
              </button>
            )}
          </div>

          {trackingRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
              <Eye className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No tracking events yet</p>
              <p className="text-xs text-gray-300 mt-1">Events will appear here as recipients interact with your emails</p>
              {detail.trackingBaseUrl && (
                <p className="text-[10px] text-gray-300 mt-3">
                  Tracking URL: <code className="bg-gray-50 px-1 py-0.5 rounded text-gray-400">{detail.trackingBaseUrl}</code>
                </p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Recipient</th>
                    <th className="text-left px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Events</th>
                    <th className="text-right px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {trackingRows.map((row, i) => {
                    const opens = row.events.filter(e => e.type === 'open').length;
                    const clicks = row.events.filter(e => e.type === 'click').length;
                    const replies = row.events.filter(e => e.type === 'reply').length;
                    return (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3">
                          <span className="text-sm text-gray-900 font-medium truncate block max-w-[200px]">
                            {row.contact.firstName || row.contact.lastName
                              ? `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim()
                              : row.contact.email}
                          </span>
                          <span className="text-xs text-gray-400 truncate block max-w-[200px]">{row.contact.email}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 truncate block max-w-[200px]">{row.email || campaign.subject || '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {opens > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-100">
                                <MailOpen className="h-3 w-3" />
                                {opens} open{opens > 1 ? 's' : ''}
                              </span>
                            )}
                            {clicks > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium border border-purple-100">
                                <MousePointer className="h-3 w-3" />
                                {clicks} click{clicks > 1 ? 's' : ''}
                              </span>
                            )}
                            {replies > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium border border-amber-100">
                                <MessageSquare className="h-3 w-3" />
                                {replies} repl{replies > 1 ? 'ies' : 'y'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-xs text-gray-400">
                            {formatRelativeTime(row.events.length > 0
                              ? row.events.reduce((latest, e) => e.createdAt > latest ? e.createdAt : latest, row.events[0].createdAt)
                              : row.lastActivity)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ==================== ALL EMAILS TABLE ==================== */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-900">
              All Emails <span className="text-sm font-normal text-gray-400">({totalMessages})</span>
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
                <input
                  placeholder="Search recipients..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs border border-gray-200 rounded-lg w-48 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'opened', label: 'Opened' },
                  { key: 'clicked', label: 'Clicked' },
                  { key: 'replied', label: 'Replied' },
                  { key: 'bounced', label: 'Bounced' },
                ].map(f => (
                  <button key={f.key} onClick={() => setStatusFilter(f.key)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                      statusFilter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredMessages.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
              <Mail className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">{messages.length === 0 ? 'No emails sent yet' : 'No emails match your filters'}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[2fr_80px_80px_80px_80px_100px] gap-2 px-5 py-2.5 border-b border-gray-100 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <div>Recipient</div>
                <div className="text-center">Status</div>
                <div className="text-center">Opens</div>
                <div className="text-center">Clicks</div>
                <div className="text-center">Reply</div>
                <div className="text-right">Sent</div>
              </div>
              {filteredMessages.slice(0, 50).map((msg: CampaignMessage) => {
                const statusLabel = msg.repliedAt || (msg.replyCount && msg.replyCount > 0) ? 'Replied' :
                  msg.clickedAt || (msg.clickCount && msg.clickCount > 0) ? 'Clicked' :
                  msg.openedAt || (msg.openCount && msg.openCount > 0) ? 'Opened' :
                  msg.status === 'sent' ? 'Delivered' :
                  msg.status === 'failed' ? 'Failed' : 'Sending';
                const statusColors: Record<string, string> = {
                  Replied: 'bg-amber-50 text-amber-700 border-amber-200',
                  Clicked: 'bg-purple-50 text-purple-700 border-purple-200',
                  Opened: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  Delivered: 'bg-blue-50 text-blue-700 border-blue-200',
                  Failed: 'bg-red-50 text-red-700 border-red-200',
                  Sending: 'bg-gray-50 text-gray-600 border-gray-200',
                };

                return (
                  <div key={msg.id} className="grid grid-cols-[2fr_80px_80px_80px_80px_100px] gap-2 px-5 py-3 border-b border-gray-50 hover:bg-blue-50/20 items-center transition-colors">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {(msg.contact?.firstName?.[0] || msg.contact?.email?.[0] || '?').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {msg.contact?.firstName || msg.contact?.lastName
                            ? `${msg.contact?.firstName || ''} ${msg.contact?.lastName || ''}`.trim()
                            : msg.contact?.email || 'Unknown'}
                        </div>
                        <div className="text-xs text-gray-400 truncate">{msg.contact?.email || ''}</div>
                        {msg.stepNumber > 0 && (
                          <div className="text-[10px] text-blue-500 font-medium">Step {msg.stepNumber + 1}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <Badge variant="outline" className={`text-[10px] font-medium ${statusColors[statusLabel] || statusColors.Sending}`}>
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="text-center">
                      {(msg.openCount || 0) > 0 ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-sm font-semibold text-emerald-600">{msg.openCount}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">First opened: {msg.firstOpenedAt ? formatDateTime(msg.firstOpenedAt) : formatDateTime(msg.openedAt || '')}</p></TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </div>
                    <div className="text-center">
                      {(msg.clickCount || 0) > 0 ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-sm font-semibold text-purple-600">{msg.clickCount}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">First click: {msg.firstClickedAt ? formatDateTime(msg.firstClickedAt) : formatDateTime(msg.clickedAt || '')}</p></TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </div>
                    <div className="text-center">
                      {(msg.replyCount || 0) > 0 ? (
                        <span className="text-sm font-semibold text-amber-600">{msg.replyCount}</span>
                      ) : msg.repliedAt ? (
                        <Reply className="h-3.5 w-3.5 text-amber-600 mx-auto" />
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400">{msg.sentAt ? formatRelativeTime(msg.sentAt) : msg.createdAt ? formatRelativeTime(msg.createdAt) : '-'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredMessages.length > 50 && (
            <div className="text-xs text-gray-400 text-center mt-3">
              Showing 50 of {filteredMessages.length} emails
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper component for campaign details row
function DetailRow({ icon, label, value, valueColor, tooltip }: { icon: React.ReactNode; label: string; value: string; valueColor?: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div className="flex items-center gap-2.5 text-sm text-gray-600">
        <span className="text-gray-400">{icon}</span>
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-gray-300" />
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">{tooltip}</p></TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className={`text-sm font-semibold ${valueColor || 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
