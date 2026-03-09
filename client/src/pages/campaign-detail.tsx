import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Send, Eye, MousePointerClick, Reply, AlertTriangle,
  CheckCircle2, XCircle, Clock, Search, ChevronDown,
  Mail, Users, RefreshCw,
  Play, Pause, Copy, Archive, Pencil,
  Info, Ban, Calendar, Shield, Timer, Repeat, Check,
  MailOpen, MousePointer, MessageSquare, AlertCircle, UserMinus,
  Bold, Italic, Underline, Link, Image, Code, List, ListOrdered,
  AlignLeft, FileText, MoreVertical, Sparkles, Hash
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
  const actionsRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Update campaign dialog state
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateSubject, setUpdateSubject] = useState("");
  const [updateContent, setUpdateContent] = useState("");
  const [updateEmailAccountId, setUpdateEmailAccountId] = useState("");
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);

  // Expanded sections
  const [showAllEmails, setShowAllEmails] = useState(true);
  const [showTracking, setShowTracking] = useState(true);

  // Reply tracking status
  const [replyTrackingStatus, setReplyTrackingStatus] = useState<any>(null);

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

  const fetchReplyStatus = async () => {
    try {
      const res = await fetch('/api/reply-tracking/status', { credentials: 'include' });
      if (res.ok) setReplyTrackingStatus(await res.json());
    } catch (e) {}
  };

  useEffect(() => { fetchDetail(); fetchReplyStatus(); }, [campaignId]);

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

  // Focus rename input when editing starts
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // ========== RENAME HANDLERS ==========
  const startRename = () => {
    if (!detail) return;
    setRenameValue(detail.campaign.name);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameValue("");
  };

  const saveRename = async () => {
    if (!renameValue.trim() || renameValue.trim() === detail?.campaign.name) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (res.ok) {
        setIsRenaming(false);
        fetchDetail();
      }
    } catch (e) { /* ignore */ }
    setRenameSaving(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') cancelRename();
  };

  // ========== UPDATE DIALOG HANDLERS ==========
  const openUpdateDialog = async () => {
    setShowActions(false);
    if (!detail) return;
    setUpdateSubject(detail.campaign.subject || '');
    setUpdateContent(detail.campaign.content || '');
    setUpdateEmailAccountId(detail.campaign.emailAccountId || '');
    setUpdateError('');
    setShowUpdateDialog(true);

    try {
      const res = await fetch('/api/email-accounts', { credentials: 'include' });
      if (res.ok) setEmailAccounts(await res.json());
    } catch (e) { /* ignore */ }

    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = detail.campaign.content || '';
      }
    }, 100);
  };

  const saveUpdate = async () => {
    setUpdateSaving(true);
    setUpdateError('');
    try {
      const content = editorRef.current?.innerHTML || updateContent;
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subject: updateSubject,
          content,
          emailAccountId: updateEmailAccountId || undefined,
        }),
      });
      if (res.ok) {
        setShowUpdateDialog(false);
        fetchDetail();
      } else {
        const data = await res.json();
        setUpdateError(data.message || 'Failed to update campaign');
      }
    } catch (e) {
      setUpdateError('Network error');
    }
    setUpdateSaving(false);
  };

  const execCommand = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  // ========== ACTION HANDLERS ==========
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

  // ========== LOADING STATE ==========
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400 font-medium">Loading campaign...</span>
        </div>
      </div>
    );
  }

  // ========== ERROR STATE ==========
  if (error || !detail) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-center py-20">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{error || 'Campaign not found'}</p>
          <Button variant="outline" size="sm" onClick={fetchDetail} className="mt-4">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  const { campaign, analytics, messages, totalMessages, recentEvents, stepAnalytics, emailAccount, activityTimeline, hasActiveFollowups } = detail;

  // ========== COMPUTED VALUES ==========
  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string; dot: string }> = {
      active: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Active', dot: 'bg-emerald-500' },
      following_up: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Following Up', dot: 'bg-blue-500' },
      completed: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Ended', dot: 'bg-slate-400' },
      ended: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Ended', dot: 'bg-slate-400' },
      draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft', dot: 'bg-gray-400' },
      scheduled: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Scheduled', dot: 'bg-blue-500' },
      paused: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Paused', dot: 'bg-amber-500' },
      archived: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Archived', dot: 'bg-gray-400' },
    };
    return configs[status] || configs.draft;
  };

  // Show "Following Up" for completed campaigns that have active follow-up sequences
  const effectiveStatus = (campaign.status === 'completed' && hasActiveFollowups) ? 'following_up' : campaign.status;
  const statusConfig = getStatusConfig(effectiveStatus);

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatRelativeTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 172800000) return 'Yesterday';
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const overviewStats = [
    { label: 'Emails sent', value: analytics?.totalSent || campaign.sentCount || 0, emoji: '📨', emojiBg: 'bg-rose-50 border-rose-100', rate: null },
    { label: 'Opens', value: analytics?.opened || campaign.openedCount || 0, emoji: '👀', emojiBg: 'bg-amber-50 border-amber-100', rate: analytics?.openRate ? `${analytics.openRate}%` : null },
    { label: 'Clicks', value: analytics?.clicked || campaign.clickedCount || 0, emoji: '🖱️', emojiBg: 'bg-teal-50 border-teal-100', rate: analytics?.clickRate ? `${analytics.clickRate}%` : null },
    { label: 'Replied', value: analytics?.replied || campaign.repliedCount || 0, emoji: '💬', emojiBg: 'bg-blue-50 border-blue-100', rate: analytics?.replyRate ? `${analytics.replyRate}%` : null },
    { label: 'Bounces', value: analytics?.bounced || campaign.bouncedCount || 0, emoji: '⚠️', emojiBg: 'bg-pink-50 border-pink-100', rate: analytics?.bounceRate ? `${analytics.bounceRate}%` : null },
    { label: 'Unsubscribes', value: analytics?.unsubscribed || campaign.unsubscribedCount || 0, emoji: '🚫', emojiBg: 'bg-gray-50 border-gray-100', rate: analytics?.unsubscribeRate ? `${analytics.unsubscribeRate}%` : null },
  ];

  // Filter messages
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

  // Tracking rows - show ALL contacts with their engagement status (Mailmeteor-style)
  const contactEventMap = new Map<string, { contact: any; email: string; events: TrackingEvent[]; lastActivity: string; message: CampaignMessage }>();
  for (const msg of messages) {
    if (!msg.contact) continue;
    const key = msg.contact.email;
    if (!contactEventMap.has(key)) {
      contactEventMap.set(key, { contact: msg.contact, email: msg.subject || '', events: [], lastActivity: msg.sentAt || msg.createdAt, message: msg });
    }
    const entry = contactEventMap.get(key)!;
    if (msg.events) entry.events.push(...msg.events);
    const lastTime = msg.sentAt || msg.createdAt;
    if (lastTime > entry.lastActivity) entry.lastActivity = lastTime;
    if (msg.events?.length) {
      const latestEventTime = msg.events.reduce((max: string, e: TrackingEvent) => e.createdAt > max ? e.createdAt : max, msg.events[0].createdAt);
      if (latestEventTime > entry.lastActivity) entry.lastActivity = latestEventTime;
    }
  }
  const trackingRows = Array.from(contactEventMap.values())
    .sort((a, b) => {
      // Sort by engagement level: replied > clicked > opened > sent
      const getEngagement = (r: typeof a) => {
        if (r.message.repliedAt || r.message.replyCount) return 4;
        if (r.events.some(e => e.type === 'click')) return 3;
        if (r.message.openedAt || r.message.openCount) return 2;
        return 1;
      };
      const diff = getEngagement(b) - getEngagement(a);
      if (diff !== 0) return diff;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    })
    .slice(0, 30);

  const isActive = campaign.status === 'active';
  const isPaused = campaign.status === 'paused';
  const isFollowingUp = campaign.status === 'completed' && hasActiveFollowups;
  const isEnded = (campaign.status === 'completed' || campaign.status === 'archived') && !isFollowingUp;

  // Progress
  const totalSent = analytics?.totalSent || campaign.sentCount || 0;
  const totalRecip = campaign.totalRecipients || totalMessages || 1;
  const deliveryPct = totalRecip > 0 ? Math.min(100, (totalSent / totalRecip) * 100) : 0;
  const openPct = totalSent > 0 ? Math.min(100, ((analytics?.opened || campaign.openedCount || 0) / totalSent) * 100) : 0;
  const endedDate = isEnded && campaign.updatedAt ? campaign.updatedAt : null;

  return (
    <div className="max-w-[960px] mx-auto pb-16">

      {/* ===================== HEADER ===================== */}
      <div className="px-6 pt-6 pb-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] flex items-center gap-1.5">
            <Send className="h-3 w-3" /> Campaign
          </span>
        </div>

        {/* Title + Actions row */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            {/* Editable title */}
            {isRenaming ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={saveRename}
                  className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent w-full max-w-xl leading-tight py-px"
                  disabled={renameSaving}
                />
                {renameSaving && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
              </div>
            ) : (
              <div className="flex items-center gap-2 group mb-1">
                <h1 className="text-2xl font-bold text-gray-900 truncate leading-tight">{campaign.name}</h1>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={startRename}
                      className="p-1 rounded-md hover:bg-gray-100 text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p className="text-xs font-medium">Rename campaign</p></TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* Metadata */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs text-gray-400">
                Created <span className="text-gray-500 font-medium">{formatDateTime(campaign.createdAt)}</span>
              </span>
              {endedDate && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-400">
                    Ended <span className="text-gray-500 font-medium">{formatDateTime(endedDate)}</span>
                  </span>
                </>
              )}
              {isFollowingUp && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-blue-500 font-medium">
                    <Timer className="h-3 w-3 inline mr-1" />
                    Follow-up sequence active
                  </span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                {statusConfig.label}
              </span>
            </div>
          </div>

          {/* Actions dropdown */}
          <div className="relative flex-shrink-0 pt-0.5" ref={actionsRef}>
            <button
              onClick={() => setShowActions(!showActions)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gray-900 hover:bg-gray-800 shadow-sm transition-colors"
            >
              Actions <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showActions ? 'rotate-180' : ''}`} />
            </button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200/80 rounded-xl shadow-lg shadow-gray-200/60 py-1 w-52 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
                <ActionItem icon={<Pencil className="h-3.5 w-3.5" />} label="Update" onClick={openUpdateDialog} />
                {isActive ? (
                  <ActionItem icon={<Pause className="h-3.5 w-3.5" />} label="Pause sending" onClick={handlePause} />
                ) : isPaused ? (
                  <ActionItem icon={<Play className="h-3.5 w-3.5" />} label="Resume sending" onClick={handleResume} />
                ) : (
                  <ActionItem icon={<Pause className="h-3.5 w-3.5" />} label="Pause sending" disabled />
                )}
                <ActionItem icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} />
                <div className="border-t border-gray-100 my-1" />
                {(isActive || isPaused) ? (
                  <ActionItem icon={<Ban className="h-3.5 w-3.5" />} label="Cancel" onClick={handleStop} destructive />
                ) : (
                  <ActionItem icon={<Ban className="h-3.5 w-3.5" />} label="Cancel" disabled />
                )}
                <ActionItem icon={<Archive className="h-3.5 w-3.5" />} label="Archive" onClick={handleArchive} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===================== PROGRESS BAR ===================== */}
      <div className="px-6 pb-6">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full flex">
            <div className="bg-emerald-400 transition-all duration-700 ease-out" style={{ width: `${openPct}%` }} />
            <div className="bg-blue-400 transition-all duration-700 ease-out" style={{ width: `${Math.max(0, deliveryPct - openPct)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400 font-medium">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Opened</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" /> Delivered</span>
          <span className="ml-auto tabular-nums">{deliveryPct.toFixed(0)}% delivered</span>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* ===================== OVERVIEW ===================== */}
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            Overview
            <Tooltip>
              <TooltipTrigger><Info className="h-3.5 w-3.5 text-gray-300 hover:text-gray-400 transition-colors" /></TooltipTrigger>
              <TooltipContent><p className="text-xs">Campaign performance metrics</p></TooltipContent>
            </Tooltip>
          </h2>
          <button onClick={fetchDetail} className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {overviewStats.map((stat) => (
            <div key={stat.label} className="text-center group">
              <div className={`w-14 h-14 rounded-2xl border ${stat.emojiBg} flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform`}>
                <span className="text-2xl">{stat.emoji}</span>
              </div>
              <div className="text-[11px] text-gray-400 mb-1 font-medium flex items-center justify-center gap-1">
                {stat.label}
                <Tooltip>
                  <TooltipTrigger><Info className="h-2.5 w-2.5 text-gray-300" /></TooltipTrigger>
                  <TooltipContent><p className="text-xs">Total {stat.label.toLowerCase()}</p></TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{stat.value.toLocaleString()}</span>
                {stat.rate && <span className="text-[11px] text-gray-400 font-medium">{stat.rate}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Reply Tracking Status Banner */}
        {(campaign.status === 'active' || campaign.status === 'completed') && (
          <div className="mt-5 p-4 rounded-xl border border-blue-100 bg-blue-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Reply className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    Reply Tracking
                    {replyTrackingStatus?.active ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {replyTrackingStatus?.active 
                      ? 'Checking for replies every 5 minutes via Gmail/Outlook API' 
                      : 'Connect Gmail or Outlook in Email Accounts to enable reply detection'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(analytics?.replied || campaign.repliedCount || 0) > 0 && (
                  <div className="text-right">
                    <div className="text-lg font-bold text-amber-600">{analytics?.replied || campaign.repliedCount || 0}</div>
                    <div className="text-[10px] text-gray-400">replies detected</div>
                  </div>
                )}
              </div>
            </div>
            {/* Note about open tracking accuracy */}
            <div className="mt-3 pt-3 border-t border-blue-100 text-[11px] text-gray-500 flex items-start gap-2">
              <Info className="h-3 w-3 text-blue-400 mt-0.5 flex-shrink-0" />
              <span>Open tracking filters out email proxy pre-fetches (Gmail, Outlook, Yahoo) to show only real opens. Reply detection requires OAuth-connected email accounts.</span>
            </div>
          </div>
        )}
      </div>

      {/* ===================== STEP ANALYTICS TABLE ===================== */}
      {stepAnalytics && stepAnalytics.length > 0 && (
        <div className="px-6 pb-6">
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider w-[28%]"></th>
                  <th className="text-center px-3 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Sent</th>
                  <th className="text-center px-3 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Opens <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-3 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Clicks <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-3 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Replies <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                  <th className="text-center px-3 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">
                    Unsubs <Info className="h-2.5 w-2.5 inline text-gray-300 ml-0.5" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {stepAnalytics.map((step: StepAnalytics, i: number) => (
                  <tr key={i} className={`border-b last:border-b-0 border-gray-50 hover:bg-gray-50/60 transition-colors ${(step as any).isPending ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${(step as any).isPending ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-100'}`}>
                          {(step as any).isPending ? (
                            <Clock className="h-3.5 w-3.5 text-amber-500" />
                          ) : (
                            <Hash className="h-3.5 w-3.5 text-blue-500" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            {step.label}
                            {(step as any).isPending && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Scheduled</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {step.stepNumber === 0 ? (
                              'Sent at campaign creation'
                            ) : step.description ? (
                              <span className="flex items-center gap-1">
                                <span className="text-gray-300">{'\u2193'}</span>
                                {step.description.split('\u2013')[0]?.trim()}
                                {step.description.includes('\u2013') && (
                                  <span className="text-blue-500 font-medium flex items-center gap-0.5">
                                    <Timer className="h-3 w-3" />
                                    {step.description.split('\u2013')[1]?.trim()}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Follow-up</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-3 py-4">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">{(step as any).isPending ? '-' : step.sent}</span>
                    </td>
                    <td className="text-center px-3 py-4">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">{(step as any).isPending ? '-' : step.opened}</span>
                      {!(step as any).isPending && <span className="text-[11px] text-gray-400 ml-1">{step.openRate}%</span>}
                    </td>
                    <td className="text-center px-3 py-4">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">{(step as any).isPending ? '-' : step.clicked}</span>
                      {!(step as any).isPending && <span className="text-[11px] text-gray-400 ml-1">{step.clickRate}%</span>}
                    </td>
                    <td className="text-center px-3 py-4">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">{(step as any).isPending ? '-' : step.replied}</span>
                      {!(step as any).isPending && <span className="text-[11px] text-gray-400 ml-1">{step.replyRate}%</span>}
                    </td>
                    <td className="text-center px-3 py-4">
                      <span className="text-lg font-bold text-gray-900 tabular-nums">{(step as any).isPending ? '-' : step.unsubscribed}</span>
                      {!(step as any).isPending && <span className="text-[11px] text-gray-400 ml-1">0%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== DETAILS + TIMELINE (2-column) ===================== */}
      <div className="px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Campaign Details - 3 cols */}
          <div className="lg:col-span-3">
            <h3 className="text-base font-bold text-gray-900 mb-4">Campaign details</h3>
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                <DetailRow icon={<Users className="h-4 w-4" />} label="Total recipients" value={`${campaign.totalRecipients || totalMessages}`} />
                <DetailRow icon={<Eye className="h-4 w-4" />} label="Tracking" value={campaign.trackOpens !== false ? 'Enabled' : 'Disabled'} valueColor={campaign.trackOpens !== false ? 'text-emerald-600' : 'text-gray-400'} />
                <DetailRow icon={<Shield className="h-4 w-4" />} label="Unsubscribe" value={campaign.includeUnsubscribe ? 'Enabled' : 'Disabled'} valueColor={campaign.includeUnsubscribe ? 'text-emerald-600' : 'text-gray-400'} />
                <DetailRow icon={<Timer className="h-4 w-4" />} label="Throttling" value={`Every ${(campaign as any).throttleDelay || 300} seconds`} />
                <DetailRow icon={<Mail className="h-4 w-4" />} label="Daily cap" value={`Max ${(campaign as any).dailyCap || 500} emails/day`} />
                <DetailRow icon={<Calendar className="h-4 w-4" />} label="Weekdays" value="Enabled" valueColor="text-emerald-600" />
                <DetailRow icon={<Repeat className="h-4 w-4" />} label="Follow-up" value={(detail.followupSequences?.length || 0) > 0 ? `${detail.followupSequences?.length} sequence${(detail.followupSequences?.length || 0) > 1 ? 's' : ''}` : 'None'} valueColor={(detail.followupSequences?.length || 0) > 0 ? 'text-emerald-600' : 'text-gray-400'} />
                {emailAccount && (
                  <DetailRow icon={<Send className="h-4 w-4" />} label="Sender" value={`${emailAccount.displayName || emailAccount.email}`} sub={`via ${emailAccount.provider || 'Email'}`} />
                )}
              </div>
            </div>
          </div>

          {/* Activity Timeline - 2 cols */}
          <div className="lg:col-span-2">
            <h3 className="text-base font-bold text-gray-900 mb-4">Activity</h3>
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5">
              <div className="relative">
                {(activityTimeline || []).length > 1 && (
                  <div className="absolute left-[13px] top-5 bottom-5 w-px bg-gray-100" />
                )}
                <div className="space-y-4">
                  {(activityTimeline || []).map((item: ActivityTimelineItem, i: number) => {
                    const iconConfig: Record<string, { bg: string; color: string; Icon: any }> = {
                      check: { bg: 'bg-emerald-50', color: 'text-emerald-600', Icon: Check },
                      edit: { bg: 'bg-gray-100', color: 'text-gray-500', Icon: Pencil },
                      pause: { bg: 'bg-amber-50', color: 'text-amber-600', Icon: Pause },
                      clock: { bg: 'bg-blue-50', color: 'text-blue-600', Icon: Clock },
                      start: { bg: 'bg-blue-50', color: 'text-blue-600', Icon: Play },
                    };
                    const cfg = iconConfig[item.icon] || iconConfig.start;
                    return (
                      <div key={i} className="flex items-start gap-3 relative">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${cfg.bg}`}>
                          <cfg.Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                        </div>
                        <div className="pt-0.5">
                          <div className="text-sm font-medium text-gray-800">{item.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{formatDateTime(item.timestamp)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {recentEvents.length > 0 && (
                  <div className="pt-4 mt-4 border-t border-gray-100 text-xs text-gray-400 pl-10">
                    + {recentEvents.length} tracking event{recentEvents.length > 1 ? 's' : ''} recorded
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== TRACKING TABLE ===================== */}
      <div className="px-6 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            Tracking
            <span className="text-[11px] font-normal text-gray-400 bg-gray-100 rounded-md px-1.5 py-0.5">{trackingRows.length}</span>
          </h3>
          {trackingRows.length > 0 && (
            <button className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors">View all</button>
          )}
        </div>

        {trackingRows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
              <Eye className="h-6 w-6 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">No tracking events yet</p>
            <p className="text-xs text-gray-400">Events will appear here as recipients interact with your emails</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Recipient</th>
                  <th className="text-center px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Events</th>
                  <th className="text-right px-5 py-3 text-[11px] text-gray-400 font-semibold uppercase tracking-wider">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {trackingRows.map((row, i) => {
                  const opens = row.message.openCount || (row.message.openedAt ? 1 : 0) || row.events.filter(e => e.type === 'open').length;
                  const clicks = row.message.clickCount || (row.message.clickedAt ? 1 : 0) || row.events.filter(e => e.type === 'click').length;
                  const replies = row.message.replyCount || (row.message.repliedAt ? 1 : 0) || row.events.filter(e => e.type === 'reply').length;
                  const isSent = row.message.status === 'sent';
                  const isFailed = row.message.status === 'failed' || row.message.status === 'bounced';
                  // Determine highest engagement level for status badge
                  const statusLabel = replies > 0 ? 'Replied' : clicks > 0 ? 'Clicked' : opens > 0 ? 'Opened' : isFailed ? 'Bounced' : isSent ? 'Delivered' : 'Sending';
                  const statusColor: Record<string, string> = {
                    Replied: 'bg-purple-100 text-purple-700 border-purple-200',
                    Clicked: 'bg-blue-100 text-blue-700 border-blue-200',
                    Opened: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    Delivered: 'bg-gray-100 text-gray-600 border-gray-200',
                    Bounced: 'bg-red-100 text-red-700 border-red-200',
                    Sending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
                  };
                  return (
                    <tr key={i} className="border-b border-gray-50 last:border-b-0 hover:bg-blue-50/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                            {(row.contact.firstName?.[0] || row.contact.email?.[0] || '?').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-gray-900 truncate block max-w-[180px]">
                              {row.contact.firstName || row.contact.lastName
                                ? `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim()
                                : row.contact.email}
                            </span>
                            <span className="text-[11px] text-gray-400 truncate block max-w-[180px]">{row.contact.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor[statusLabel] || statusColor.Delivered}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isSent && <EventBadge type="sent" count={1} />}
                          {opens > 0 && <EventBadge type="open" count={opens} />}
                          {clicks > 0 && <EventBadge type="click" count={clicks} />}
                          {replies > 0 && <EventBadge type="reply" count={replies} />}
                          {isFailed && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-100"><AlertTriangle className="h-2.5 w-2.5" /> Bounced</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-xs text-gray-400">{formatRelativeTime(row.lastActivity)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===================== ALL EMAILS TABLE ===================== */}
      <div className="px-6 pb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            All Emails
            <span className="text-[11px] font-normal text-gray-400 bg-gray-100 rounded-md px-1.5 py-0.5">{totalMessages}</span>
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
              <input
                placeholder="Search recipients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 h-8 text-xs border border-gray-200 rounded-lg w-44 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 bg-white transition-all"
              />
            </div>
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              {['all', 'opened', 'clicked', 'replied', 'bounced'].map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all capitalize ${
                    statusFilter === f ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/60' : 'text-gray-500 hover:text-gray-700'
                  }`}>{f}</button>
              ))}
            </div>
          </div>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
              <Mail className="h-6 w-6 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">{messages.length === 0 ? 'No emails sent yet' : 'No emails match your filters'}</p>
            <p className="text-xs text-gray-400">Try adjusting your search or filter criteria</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_80px_70px_70px_70px_90px] gap-1 px-5 py-2.5 border-b border-gray-100 bg-gray-50/80 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <div>Recipient</div>
              <div className="text-center">Status</div>
              <div className="text-center">Opens</div>
              <div className="text-center">Clicks</div>
              <div className="text-center">Reply</div>
              <div className="text-right">Sent</div>
            </div>

            {/* Table rows */}
            {filteredMessages.slice(0, 50).map((msg: CampaignMessage) => {
              const statusLabel = msg.repliedAt || (msg.replyCount && msg.replyCount > 0) ? 'Replied' :
                msg.clickedAt || (msg.clickCount && msg.clickCount > 0) ? 'Clicked' :
                msg.openedAt || (msg.openCount && msg.openCount > 0) ? 'Opened' :
                msg.status === 'sent' ? 'Delivered' : msg.status === 'failed' ? 'Failed' : 'Sending';

              const statusStyles: Record<string, string> = {
                Replied: 'bg-amber-50 text-amber-700 border-amber-200',
                Clicked: 'bg-purple-50 text-purple-700 border-purple-200',
                Opened: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                Delivered: 'bg-blue-50 text-blue-700 border-blue-200',
                Failed: 'bg-red-50 text-red-700 border-red-200',
                Sending: 'bg-gray-50 text-gray-600 border-gray-200',
              };

              return (
                <div key={msg.id}
                  className="grid grid-cols-[2fr_80px_70px_70px_70px_90px] gap-1 px-5 py-3 border-b border-gray-50 last:border-b-0 hover:bg-blue-50/20 items-center transition-colors">
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
                      <div className="text-[11px] text-gray-400 truncate">{msg.contact?.email || ''}</div>
                      {msg.stepNumber > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 font-semibold mt-0.5">
                          <Hash className="h-2.5 w-2.5" /> Step {msg.stepNumber + 1}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-center">
                    <Badge variant="outline" className={`text-[10px] font-semibold px-1.5 py-0 ${statusStyles[statusLabel] || statusStyles.Sending}`}>
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="text-center">
                    {(msg.openCount || 0) > 0
                      ? <span className="text-sm font-bold text-emerald-600 tabular-nums">{msg.openCount}</span>
                      : <span className="text-xs text-gray-300">–</span>}
                  </div>
                  <div className="text-center">
                    {(msg.clickCount || 0) > 0
                      ? <span className="text-sm font-bold text-purple-600 tabular-nums">{msg.clickCount}</span>
                      : <span className="text-xs text-gray-300">–</span>}
                  </div>
                  <div className="text-center">
                    {(msg.replyCount || 0) > 0
                      ? <span className="text-sm font-bold text-amber-600 tabular-nums">{msg.replyCount}</span>
                      : msg.repliedAt
                        ? <Reply className="h-3.5 w-3.5 text-amber-600 mx-auto" />
                        : <span className="text-xs text-gray-300">–</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-400">
                      {msg.sentAt ? formatRelativeTime(msg.sentAt) : msg.createdAt ? formatRelativeTime(msg.createdAt) : '–'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filteredMessages.length > 50 && (
          <div className="text-xs text-gray-400 text-center mt-3 font-medium">
            Showing 50 of {filteredMessages.length} emails
          </div>
        )}
      </div>

      {/* ===================== UPDATE CAMPAIGN DIALOG ===================== */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent className="sm:max-w-[700px] max-h-[92vh] overflow-y-auto p-0 gap-0 rounded-2xl">
          <DialogHeader className="px-6 pt-6 pb-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-gray-900">Update campaign</DialogTitle>
              <button onClick={() => setShowUpdateDialog(false)} className="text-blue-600 hover:text-blue-700 text-sm font-semibold transition-colors">
                Show preview
              </button>
            </div>
            <DialogDescription className="sr-only">Update your campaign settings, recipients, and message content.</DialogDescription>
          </DialogHeader>

          <div className="px-6 pt-5 pb-6 space-y-6">
            {/* Status banners */}
            {isEnded && (
              <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200/80 rounded-xl">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-amber-800 leading-relaxed">This campaign has ended on {formatDateTime(endedDate || campaign.updatedAt)}.</span>
              </div>
            )}
            {isActive && (
              <div className="flex items-start gap-3 px-4 py-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-emerald-800 leading-relaxed">This campaign is currently active. Changes will apply to unsent emails only.</span>
              </div>
            )}
            {isPaused && (
              <div className="flex items-start gap-3 px-4 py-3.5 bg-blue-50 border border-blue-200/80 rounded-xl">
                <Pause className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-blue-800 leading-relaxed">This campaign is paused. Changes will apply when you resume sending.</span>
              </div>
            )}

            {/* Recipients section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-gray-900">Recipients</h3>
                <button className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-100">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{campaign.totalRecipients || totalMessages}</span> recipients in your list
                <span className="text-gray-300 mx-1.5">–</span>
                <button className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">Add recipients</button>
              </p>
            </div>

            <div className="border-t border-gray-100" />

            {/* Messages section */}
            <div>
              <h3 className="text-base font-bold text-gray-900 mb-4">Messages</h3>

              {/* From field */}
              <div className="flex items-center gap-3 mb-3">
                <label className="text-sm text-gray-500 w-16 flex-shrink-0 font-medium">From</label>
                <div className="flex-1 relative">
                  <select
                    value={updateEmailAccountId}
                    onChange={(e) => setUpdateEmailAccountId(e.target.value)}
                    className="w-full h-10 px-3 pr-8 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-50 outline-none appearance-none cursor-pointer transition-all"
                  >
                    {emailAccounts.length === 0 && emailAccount && (
                      <option value={emailAccount.id}>{emailAccount.displayName || emailAccount.email} &lt;{emailAccount.email}&gt;</option>
                    )}
                    {emailAccounts.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.displayName || a.email} &lt;{a.email}&gt;</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Subject field */}
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm text-gray-500 w-16 flex-shrink-0 font-medium">Subject</label>
                <input
                  value={updateSubject}
                  onChange={(e) => setUpdateSubject(e.target.value)}
                  className="flex-1 h-10 px-3 text-sm border border-gray-200 rounded-lg bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-50 outline-none transition-all"
                  placeholder="Email subject line"
                />
              </div>

              {/* Rich text editor */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50/80 border-b border-gray-200 flex-wrap">
                  <ToolbarBtn icon={<Bold className="h-3.5 w-3.5" />} onClick={() => execCommand('bold')} title="Bold" />
                  <ToolbarBtn icon={<Italic className="h-3.5 w-3.5" />} onClick={() => execCommand('italic')} title="Italic" />
                  <ToolbarBtn icon={<Underline className="h-3.5 w-3.5" />} onClick={() => execCommand('underline')} title="Underline" />
                  <ToolbarSep />
                  <ToolbarBtn icon={<Link className="h-3.5 w-3.5" />} onClick={() => {
                    const url = prompt('Enter URL:');
                    if (url) execCommand('createLink', url);
                  }} title="Insert link" />
                  <ToolbarBtn icon={<Image className="h-3.5 w-3.5" />} onClick={() => {
                    const url = prompt('Image URL:');
                    if (url) execCommand('insertImage', url);
                  }} title="Insert image" />
                  <ToolbarBtn icon={<Code className="h-3.5 w-3.5" />} onClick={() => {
                    const tag = prompt('Variable name (e.g. firstName, lastName, company):');
                    if (tag) execCommand('insertText', `{{${tag}}}`);
                  }} title="Merge tag {{}}" />
                  <ToolbarSep />
                  <ToolbarBtn icon={<List className="h-3.5 w-3.5" />} onClick={() => execCommand('insertUnorderedList')} title="Bullet list" />
                  <ToolbarBtn icon={<ListOrdered className="h-3.5 w-3.5" />} onClick={() => execCommand('insertOrderedList')} title="Numbered list" />
                  <ToolbarBtn icon={<AlignLeft className="h-3.5 w-3.5" />} onClick={() => execCommand('justifyLeft')} title="Align left" />
                  <ToolbarSep />
                  <ToolbarBtn icon={<FileText className="h-3.5 w-3.5" />} onClick={() => execCommand('removeFormat')} title="Clear formatting" />
                </div>

                <div
                  ref={editorRef}
                  contentEditable
                  className="min-h-[300px] max-h-[420px] overflow-y-auto px-4 py-3 text-sm text-gray-800 focus:outline-none leading-relaxed [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-lg"
                  style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
                  suppressContentEditableWarning
                />
              </div>

              {updateError && (
                <p className="text-sm text-red-600 mt-3 flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {updateError}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-gray-100 bg-gray-50/60">
            <div className="flex items-center justify-end gap-3 w-full">
              <Button variant="outline" onClick={() => setShowUpdateDialog(false)} className="px-5 rounded-lg font-semibold">
                Cancel
              </Button>
              <Button onClick={saveUpdate} disabled={updateSaving} className="bg-gray-900 hover:bg-gray-800 text-white px-5 rounded-lg font-semibold shadow-sm">
                {updateSaving ? (
                  <span className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...
                  </span>
                ) : 'Update campaign'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ========== HELPER COMPONENTS ==========

function ActionItem({ icon, label, onClick, disabled, destructive }: {
  icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2.5 transition-colors ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : destructive
            ? 'text-amber-600 hover:bg-amber-50'
            : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className={disabled ? '' : destructive ? '' : 'text-gray-400'}>{icon}</span>
      {label}
    </button>
  );
}

function DetailRow({ icon, label, value, valueColor, sub }: {
  icon: React.ReactNode; label: string; value: string; valueColor?: string; sub?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div className="flex items-center gap-2.5 text-sm text-gray-600">
        <span className="text-gray-400">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-right">
        <span className={`text-sm font-semibold ${valueColor || 'text-gray-900'}`}>{value}</span>
        {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function EventBadge({ type, count }: { type: 'open' | 'click' | 'reply' | 'sent'; count: number }) {
  const configs = {
    sent: { bg: 'bg-gray-50 border-gray-200 text-gray-500', icon: <Send className="h-3 w-3" />, label: 'Sent' },
    open: { bg: 'bg-emerald-50 border-emerald-100 text-emerald-700', icon: <MailOpen className="h-3 w-3" />, label: `${count} open${count > 1 ? 's' : ''}` },
    click: { bg: 'bg-purple-50 border-purple-100 text-purple-700', icon: <MousePointer className="h-3 w-3" />, label: `${count} click${count > 1 ? 's' : ''}` },
    reply: { bg: 'bg-amber-50 border-amber-100 text-amber-700', icon: <MessageSquare className="h-3 w-3" />, label: `${count} repl${count > 1 ? 'ies' : 'y'}` },
  };
  const cfg = configs[type];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.bg}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function ToolbarBtn({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onClick(); }}
          className="p-1.5 rounded-md hover:bg-gray-200/80 text-gray-500 hover:text-gray-800 transition-colors"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top"><p className="text-xs">{title}</p></TooltipContent>
    </Tooltip>
  );
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5" />;
}
