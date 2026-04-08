import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Inbox, Mail, Send, RefreshCw, Archive, Trash2, Check, CheckCheck,
  ChevronLeft, ChevronRight, Search, Filter, Loader2, Reply, Forward,
  Building, User, ExternalLink, Clock, Eye, EyeOff, Star, StarOff,
  AlertTriangle, XCircle, MailOpen, ArrowLeft, Users, Sparkles,
  Bold, Italic, Underline, Link, List, ListOrdered, Type,
  Wand2, Brain, Copy, MoreHorizontal, Tag, Paperclip,
  MessageSquare, Zap, ChevronDown, ChevronUp, X, MailPlus,
  ThumbsUp, ThumbsDown, Coffee, Bot, MessageCircle, Ban, Shield,
  UserCheck, Calendar, PhoneForwarded, XSquare, Target, Bell,
  BarChart3, Flame, Snowflake, TrendingUp, Heart, BellRing
} from "lucide-react";

interface InboxMessage {
  id: string;
  organizationId: string;
  emailAccountId?: string;
  campaignId?: string;
  messageId?: string;
  contactId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  outlookMessageId?: string;
  outlookConversationId?: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  bodyHtml: string;
  status: 'unread' | 'read' | 'replied' | 'archived' | 'sent';
  provider: 'gmail' | 'outlook';
  replyType: string;
  bounceType: string;
  threadId?: string;
  assignedTo?: string;
  leadStatus: string;
  isStarred: number;
  sentByUs: number;
  aiDraft?: string;
  repliedAt?: string;
  replyContent?: string;
  repliedBy?: string;
  receivedAt: string;
  createdAt: string;
  contact?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    jobTitle: string;
    status: string;
    score: number;
    leadStatus: string;
  } | null;
  campaign?: {
    id: string;
    name: string;
  } | null;
  accountOwner?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface InboxStats {
  total: number;
  unread: number;
  replied: number;
  archived: number;
  positive: number;
  negative: number;
  ooo: number;
  autoReply: number;
  bounced: number;
  starred: number;
}

export default function UnifiedInbox() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // View modes
  const [viewMode, setViewMode] = useState<'unified' | 'account' | 'campaign'>('unified');

  // Role & team filter
  const [userRole, setUserRole] = useState<string>('member');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [replyTypeFilter, setReplyTypeFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  // Selected message
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [threadMessages, setThreadMessages] = useState<any[]>([]);

  // Reply state
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const replyEditorRef = useRef<HTMLDivElement>(null);

  // AI Assistant
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiTone, setAiTone] = useState<string>('professional');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiCustomInstructions, setAiCustomInstructions] = useState('');

  // Starred messages (server-side)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  // Selected IDs for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Quick view panels
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showLeadPanel, setShowLeadPanel] = useState(false);

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // Fetch user role, team, accounts, campaigns on mount
  useEffect(() => {
    (async () => {
      try {
        const [profileRes, membersRes, accountsRes, campaignsRes] = await Promise.all([
          fetch('/api/auth/user-profile', { credentials: 'include' }),
          fetch('/api/team/members', { credentials: 'include' }),
          fetch('/api/email-accounts', { credentials: 'include' }),
          fetch('/api/campaigns?limit=100', { credentials: 'include' }),
        ]);
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setUserRole(profile.role || 'member');
        }
        if (membersRes.ok) setTeamMembers(await membersRes.json());
        if (accountsRes.ok) setEmailAccounts(await accountsRes.json());
        if (campaignsRes.ok) {
          const campData = await campaignsRes.json();
          setCampaigns(Array.isArray(campData) ? campData : campData.campaigns || []);
        }
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (replyTypeFilter) params.set('replyType', replyTypeFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (viewMode === 'account' && accountFilter && accountFilter !== 'all') {
        params.set('emailAccountId', accountFilter);
      }
      if (viewMode === 'campaign' && campaignFilter && campaignFilter !== 'all') {
        params.set('campaignId', campaignFilter);
      }
      if (memberFilter && memberFilter !== 'all') {
        params.set('assignedTo', memberFilter);
      }
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      params.set('viewMode', viewMode);

      const resp = await fetch(`/api/inbox/enhanced?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to fetch');
      const data = await resp.json();

      setMessages(data.messages || []);
      setTotal(data.total || 0);
      setUnreadCount(data.unread || 0);
      if (data.stats) setStats(data.stats);
      
      // Track starred IDs from server
      const starred = new Set<string>();
      (data.messages || []).forEach((m: any) => { if (m.isStarred) starred.add(m.id); });
      setStarredIds(starred);
    } catch (err) {
      console.error('Inbox fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, replyTypeFilter, searchQuery, page, viewMode, accountFilter, campaignFilter, memberFilter]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Auto-refresh every 2 minutes (reduced from 30s to avoid UI disruption)
  useEffect(() => {
    const interval = setInterval(fetchMessages, 120000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-sync every 3 min
  useEffect(() => {
    const initialTimeout = setTimeout(() => syncInbox(false), 5000);
    const syncInterval = setInterval(() => { if (!syncing) syncInbox(false); }, 180000);
    return () => { clearTimeout(initialTimeout); clearInterval(syncInterval); };
  }, []);

  const syncInbox = async (manual = true) => {
    if (manual) setSyncing(true);
    try {
      const resp = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ lookbackMinutes: 120 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        // Always refresh messages after sync to recover from any prior fetch failures
        fetchMessages();
      }
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      if (manual) setSyncing(false);
    }
  };

  const openMessage = async (msg: InboxMessage) => {
    setSelectedMessage(msg);
    setShowReplyBox(false);
    setShowAiPanel(false);
    setShowContactInfo(false);
    setShowLeadPanel(false);
    setLoadingMessage(true);

    try {
      const resp = await fetch(`/api/inbox/${msg.id}`, { credentials: 'include' });
      if (resp.ok) setSelectedMessage(await resp.json());
    } catch {}

    // Load thread messages
    if (msg.gmailThreadId || msg.outlookConversationId || msg.contactId) {
      try {
        const threadId = msg.gmailThreadId || msg.outlookConversationId;
        if (threadId) {
          const threadResp = await fetch(`/api/inbox/thread/${threadId}`, { credentials: 'include' });
          if (threadResp.ok) setThreadMessages(await threadResp.json());
        } else if (msg.contactId) {
          const convResp = await fetch(`/api/inbox/contact/${msg.contactId}`, { credentials: 'include' });
          if (convResp.ok) setThreadMessages(await convResp.json());
        }
      } catch {}
    }

    if (msg.status === 'unread') {
      try {
        await fetch(`/api/inbox/${msg.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'read' }),
        });
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch {}
    }
    setLoadingMessage(false);
  };

  const archiveMessage = async (id: string) => {
    try {
      await fetch(`/api/inbox/${id}/archive`, { method: 'POST', credentials: 'include' });
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setTotal(prev => prev - 1);
    } catch {}
  };

  const deleteMessage = async (id: string) => {
    try {
      await fetch(`/api/inbox/${id}`, { method: 'DELETE', credentials: 'include' });
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setTotal(prev => prev - 1);
    } catch {}
  };

  const classifyMessage = async (id: string, replyType: string) => {
    try {
      await fetch(`/api/inbox/${id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ replyType }),
      });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, replyType } : m));
      if (selectedMessage?.id === id) setSelectedMessage(prev => prev ? { ...prev, replyType } : null);
    } catch {}
  };

  const assignMessage = async (id: string, userId: string) => {
    try {
      await fetch(`/api/inbox/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, assignedTo: userId } : m));
    } catch {}
  };

  const updateLeadStatus = async (id: string, leadStatus: string) => {
    try {
      await fetch(`/api/inbox/${id}/lead-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadStatus }),
      });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, leadStatus } : m));
      if (selectedMessage?.id === id) setSelectedMessage(prev => prev ? { ...prev, leadStatus } : null);
    } catch {}
  };

  const toggleStar = async (id: string) => {
    const isCurrentlyStarred = starredIds.has(id);
    try {
      await fetch(`/api/inbox/${id}/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isStarred: !isCurrentlyStarred }),
      });
      setStarredIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyStarred) next.delete(id); else next.add(id);
        return next;
      });
    } catch {}
  };

  // Rich editor commands
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    replyEditorRef.current?.focus();
  };

  const saveDraft = async (messageId: string, body: string) => {
    try {
      await fetch(`/api/inbox/${messageId}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
    } catch { /* silent */ }
  };

  const sendReply = async () => {
    if (!selectedMessage) return;
    const replyHtml = replyEditorRef.current?.innerHTML || '';
    if (!replyHtml.trim() || replyHtml === '<br>') return;
    setSendingReply(true);
    try {
      const resp = await fetch(`/api/inbox/${selectedMessage.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: replyHtml }),
      });
      if (resp.ok) {
        setShowReplyBox(false);
        if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, status: 'replied' as const } : m));
        setSelectedMessage(prev => prev ? { ...prev, status: 'replied' } : null);
      } else {
        const err = await resp.json();
        // Auto-save as draft on failure
        await saveDraft(selectedMessage.id, replyHtml);
        alert((err.message || 'Failed to send reply') + '\n\nYour reply has been saved as a draft.');
      }
    } catch {
      // Auto-save as draft on failure
      const replyHtml = replyEditorRef.current?.innerHTML || '';
      if (replyHtml && selectedMessage) await saveDraft(selectedMessage.id, replyHtml);
      alert('Failed to send reply. Your reply has been saved as a draft.');
    } finally {
      setSendingReply(false);
    }
  };

  const generateAiDraft = async () => {
    if (!selectedMessage) return;
    setAiDrafting(true);
    try {
      const resp = await fetch(`/api/inbox/${selectedMessage.id}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tone: aiTone, customInstructions: aiCustomInstructions }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (replyEditorRef.current) {
          replyEditorRef.current.innerHTML = data.draft?.replace(/\n/g, '<br>') || '';
        }
        setShowReplyBox(true);
        setShowAiPanel(false);
      }
    } catch (err) {
      console.error('AI draft error:', err);
    } finally {
      setAiDrafting(false);
    }
  };

  const bulkMarkRead = async () => {
    if (selectedIds.size === 0) return;
    try {
      await fetch('/api/inbox/bulk-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setMessages(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, status: 'read' as const } : m));
      setSelectedIds(new Set());
      fetchMessages();
    } catch {}
  };

  const bulkArchive = async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await fetch(`/api/inbox/${id}/archive`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }
    setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setTotal(prev => prev - selectedIds.size);
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} messages? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      await fetch(`/api/inbox/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    }
    setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setTotal(prev => prev - selectedIds.size);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === messages.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(messages.map(m => m.id)));
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text).catch(() => {}); };

  const fmtDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const fmtFullDate = (d: string) => {
    return new Date(d).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
      unread: { label: 'Unread', className: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Mail className="h-3 w-3" /> },
      read: { label: 'Read', className: 'bg-gray-100 text-gray-600 border-gray-200', icon: <MailOpen className="h-3 w-3" /> },
      replied: { label: 'Replied', className: 'bg-green-100 text-green-700 border-green-200', icon: <Reply className="h-3 w-3" /> },
      archived: { label: 'Archived', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: <Archive className="h-3 w-3" /> },
      sent: { label: 'Sent', className: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: <Send className="h-3 w-3" /> },
    };
    return map[status] || map.read;
  };

  const getReplyTypeBadge = (replyType: string) => {
    const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
      positive: { label: 'Positive', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <ThumbsUp className="h-3 w-3" /> },
      negative: { label: 'Negative', className: 'bg-red-100 text-red-700 border-red-200', icon: <ThumbsDown className="h-3 w-3" /> },
      ooo: { label: 'OOO', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: <Coffee className="h-3 w-3" /> },
      auto_reply: { label: 'Auto-reply', className: 'bg-gray-100 text-gray-600 border-gray-200', icon: <Bot className="h-3 w-3" /> },
      general: { label: 'General', className: 'bg-sky-100 text-sky-700 border-sky-200', icon: <MessageCircle className="h-3 w-3" /> },
      bounce: { label: 'Bounce', className: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle className="h-3 w-3" /> },
      unsubscribe: { label: 'Unsubscribe', className: 'bg-orange-100 text-orange-700 border-orange-200', icon: <Ban className="h-3 w-3" /> },
    };
    return map[replyType] || null;
  };

  const getLeadStatusBadge = (leadStatus: string) => {
    const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
      interested: { label: 'Interested', className: 'bg-emerald-100 text-emerald-700', icon: <Heart className="h-3 w-3" /> },
      meeting_scheduled: { label: 'Meeting', className: 'bg-blue-100 text-blue-700', icon: <Calendar className="h-3 w-3" /> },
      follow_up: { label: 'Follow Up', className: 'bg-amber-100 text-amber-700', icon: <PhoneForwarded className="h-3 w-3" /> },
      closed: { label: 'Closed', className: 'bg-green-100 text-green-700', icon: <Check className="h-3 w-3" /> },
      not_interested: { label: 'Not Interested', className: 'bg-gray-100 text-gray-600', icon: <XSquare className="h-3 w-3" /> },
    };
    return map[leadStatus] || null;
  };

  const getProviderIcon = (provider: string) => {
    if (provider === 'gmail') return <span className="text-[10px] font-bold text-red-500">G</span>;
    if (provider === 'outlook') return <span className="text-[10px] font-bold text-blue-500">O</span>;
    return <Mail className="h-3 w-3 text-gray-400" />;
  };

  const getInitials = (name: string, email: string) => {
    if (name && name !== email) {
      const parts = name.split(/\s+/);
      return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
    }
    return email?.slice(0, 2).toUpperCase() || '??';
  };

  const totalPages = Math.ceil(total / pageSize);

  // ============ MESSAGE DETAIL VIEW ============
  if (selectedMessage) {
    const s = getStatusBadge(selectedMessage.status);
    const contact = selectedMessage.contact;
    const replyBadge = getReplyTypeBadge(selectedMessage.replyType);
    const leadBadge = getLeadStatusBadge(selectedMessage.leadStatus);

    return (
      <div className="h-full flex flex-col bg-gray-50">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-white shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedMessage(null); setThreadMessages([]); }} className="gap-1.5 text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className="h-5 w-px bg-gray-200" />
            <Badge variant="outline" className={`${s.className} gap-1 text-[10px]`}>{s.icon}{s.label}</Badge>
            {replyBadge && (
              <Badge variant="outline" className={`${replyBadge.className} gap-1 text-[10px]`}>{replyBadge.icon}{replyBadge.label}</Badge>
            )}
            {leadBadge && (
              <Badge variant="outline" className={`${leadBadge.className} gap-1 text-[10px]`}>{leadBadge.icon}{leadBadge.label}</Badge>
            )}
            {selectedMessage.provider && (
              <Tooltip>
                <TooltipTrigger>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${selectedMessage.provider === 'gmail' ? 'bg-red-50' : 'bg-blue-50'}`}>
                    {getProviderIcon(selectedMessage.provider)}
                  </div>
                </TooltipTrigger>
                <TooltipContent>{selectedMessage.provider === 'gmail' ? 'Gmail' : 'Outlook'}</TooltipContent>
              </Tooltip>
            )}
            {selectedMessage.campaign && (
              <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-[10px] gap-1">
                <Tag className="h-2.5 w-2.5" /> {selectedMessage.campaign.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Reply Type Classification */}
            <Select value={selectedMessage.replyType || ''} onValueChange={(v) => classifyMessage(selectedMessage.id, v)}>
              <SelectTrigger className="w-[110px] h-7 text-[10px]">
                <SelectValue placeholder="Classify" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="positive"><span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3 text-emerald-600" /> Positive</span></SelectItem>
                <SelectItem value="negative"><span className="flex items-center gap-1"><ThumbsDown className="h-3 w-3 text-red-600" /> Negative</span></SelectItem>
                <SelectItem value="ooo"><span className="flex items-center gap-1"><Coffee className="h-3 w-3 text-amber-600" /> OOO</span></SelectItem>
                <SelectItem value="auto_reply"><span className="flex items-center gap-1"><Bot className="h-3 w-3 text-gray-600" /> Auto-reply</span></SelectItem>
                <SelectItem value="general"><span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-sky-600" /> General</span></SelectItem>
              </SelectContent>
            </Select>
            {/* Lead Status */}
            <Select value={selectedMessage.leadStatus || ''} onValueChange={(v) => updateLeadStatus(selectedMessage.id, v)}>
              <SelectTrigger className="w-[120px] h-7 text-[10px]">
                <SelectValue placeholder="Lead Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interested"><span className="flex items-center gap-1"><Heart className="h-3 w-3" /> Interested</span></SelectItem>
                <SelectItem value="meeting_scheduled"><span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Meeting</span></SelectItem>
                <SelectItem value="follow_up"><span className="flex items-center gap-1"><PhoneForwarded className="h-3 w-3" /> Follow Up</span></SelectItem>
                <SelectItem value="closed"><span className="flex items-center gap-1"><Check className="h-3 w-3" /> Closed</span></SelectItem>
                <SelectItem value="not_interested"><span className="flex items-center gap-1"><XSquare className="h-3 w-3" /> Not Interested</span></SelectItem>
              </SelectContent>
            </Select>
            {/* Assign */}
            {isAdmin && teamMembers.length > 0 && (
              <Select value={selectedMessage.assignedTo || ''} onValueChange={(v) => assignMessage(selectedMessage.id, v)}>
                <SelectTrigger className="w-[110px] h-7 text-[10px]">
                  <SelectValue placeholder="Assign" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((m: any) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.firstName || m.email?.split('@')[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="h-5 w-px bg-gray-200 mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleStar(selectedMessage.id)}>
                  {starredIds.has(selectedMessage.id)
                    ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-400" />
                    : <StarOff className="h-4 w-4 text-gray-400" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Star</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => archiveMessage(selectedMessage.id)}>
                  <Archive className="h-4 w-4 text-gray-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-600" onClick={() => { deleteMessage(selectedMessage.id); setSelectedMessage(null); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Two-panel: message + optional contact sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main message area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Message header */}
            <div className="px-6 py-4 bg-white border-b">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 leading-tight">{selectedMessage.subject || '(No Subject)'}</h2>
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-semibold">
                    {getInitials(selectedMessage.fromName, selectedMessage.fromEmail)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{selectedMessage.fromName || selectedMessage.fromEmail}</span>
                    {selectedMessage.fromName && (
                      <button onClick={() => copyToClipboard(selectedMessage.fromEmail)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                        &lt;{selectedMessage.fromEmail}&gt; <Copy className="h-2.5 w-2.5 opacity-50" />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtFullDate(selectedMessage.receivedAt)}</span>
                    <span>To: {selectedMessage.toEmail}</span>
                  </div>
                  {contact && (
                    <button onClick={() => setShowContactInfo(!showContactInfo)}
                      className="mt-1.5 flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 transition-colors">
                      {contact.company && <span className="flex items-center gap-1"><Building className="h-3 w-3" /> {contact.company}</span>}
                      {contact.jobTitle && <span>| {contact.jobTitle}</span>}
                      {contact.score > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">{contact.score} pts</Badge>}
                      <ChevronDown className={`h-3 w-3 transition-transform ${showContactInfo ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
              </div>

              {/* Contact info panel (Lead Profile Sidebar) */}
              {showContactInfo && contact && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-gray-400">Name:</span> <span className="font-medium">{contact.firstName} {contact.lastName}</span></div>
                    <div><span className="text-gray-400">Email:</span> <span className="font-medium">{contact.email}</span></div>
                    {contact.company && <div><span className="text-gray-400">Company:</span> <span className="font-medium">{contact.company}</span></div>}
                    {contact.jobTitle && <div><span className="text-gray-400">Title:</span> <span className="font-medium">{contact.jobTitle}</span></div>}
                    <div><span className="text-gray-400">Status:</span> <Badge variant="outline" className={`text-[9px] ml-1 ${contact.status === 'hot' ? 'bg-red-50 text-red-600' : contact.status === 'warm' ? 'bg-amber-50 text-amber-600' : contact.status === 'cold' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{contact.status}</Badge></div>
                    <div><span className="text-gray-400">Score:</span> <span className="font-medium">{contact.score}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Conversation Thread */}
              {threadMessages.length > 1 && (
                <div className="px-6 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="h-4 w-4 text-indigo-500" />
                    <span className="text-xs font-medium text-gray-700">Conversation Thread ({threadMessages.length} messages)</span>
                  </div>
                  <div className="space-y-2 mb-3">
                    {threadMessages.filter(t => t.id !== selectedMessage.id).slice(-3).map((tm: any) => (
                      <div key={tm.id} className={`p-2.5 rounded-lg border text-xs ${tm.sentByUs ? 'bg-blue-50/50 border-blue-100 ml-8' : 'bg-white border-gray-100 mr-8'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-700">{tm.sentByUs ? 'You' : (tm.fromName || tm.fromEmail)}</span>
                          <span className="text-gray-400">{fmtDate(tm.receivedAt)}</span>
                        </div>
                        <p className="text-gray-500 truncate">{tm.snippet || tm.subject}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Message body */}
              <div className="px-6 py-4">
                {loadingMessage ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                ) : (
                  <div className="bg-white rounded-xl border shadow-sm">
                    <div className="p-5">
                      {selectedMessage.bodyHtml ? (
                        <div className="prose prose-sm max-w-none [&_img]:max-w-full [&_a]:text-blue-600" dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }} />
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">{selectedMessage.body || selectedMessage.snippet || '(No content)'}</pre>
                      )}
                    </div>
                    {selectedMessage.replyContent && (
                      <div className="border-t border-blue-100 bg-blue-50/50">
                        <div className="px-5 py-3 flex items-center gap-2 text-xs text-blue-700 font-medium">
                          <Send className="h-3 w-3" /> Your Reply {selectedMessage.repliedBy && <span className="text-blue-500">({selectedMessage.repliedBy})</span>}
                          {selectedMessage.repliedAt && <span className="text-blue-400 ml-auto">{new Date(selectedMessage.repliedAt).toLocaleString()}</span>}
                        </div>
                        <div className="px-5 pb-4">
                          <div className="prose prose-sm max-w-none text-blue-900 bg-white/70 rounded-lg p-3 border border-blue-100" dangerouslySetInnerHTML={{ __html: selectedMessage.replyContent }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="px-6 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" onClick={() => {
                    setShowReplyBox(true); setShowAiPanel(false);
                    // Load saved draft if available
                    if (selectedMessage?.replyContent && selectedMessage.status !== 'replied') {
                      setTimeout(() => {
                        if (replyEditorRef.current && !replyEditorRef.current.innerHTML.trim()) {
                          replyEditorRef.current.innerHTML = selectedMessage.replyContent || '';
                        }
                      }, 100);
                    }
                  }} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                    <Reply className="h-3.5 w-3.5" /> Reply{selectedMessage?.replyContent && selectedMessage.status !== 'replied' ? ' (Draft)' : ''}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAiPanel(!showAiPanel)} className="gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50">
                    <Sparkles className="h-3.5 w-3.5" /> AI Draft
                  </Button>
                  {selectedMessage.aiDraft && !showReplyBox && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setShowReplyBox(true);
                      setTimeout(() => {
                        if (replyEditorRef.current) replyEditorRef.current.innerHTML = selectedMessage.aiDraft?.replace(/\n/g, '<br>') || '';
                      }, 100);
                    }} className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50">
                      <Brain className="h-3.5 w-3.5" /> Use Saved AI Draft
                    </Button>
                  )}
                </div>
              </div>

              {/* AI Draft Panel */}
              {showAiPanel && (
                <div className="px-6 pb-3">
                  <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                        <Sparkles className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">AI Reply Assistant</h4>
                        <p className="text-[10px] text-gray-500">Generate a context-aware reply</p>
                      </div>
                      <button onClick={() => setShowAiPanel(false)} className="ml-auto p-1 hover:bg-white/50 rounded"><X className="h-4 w-4 text-gray-400" /></button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">Tone</label>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { value: 'professional', label: 'Professional', icon: '💼' },
                            { value: 'friendly', label: 'Friendly', icon: '😊' },
                            { value: 'concise', label: 'Concise', icon: '⚡' },
                            { value: 'formal', label: 'Formal', icon: '🎩' },
                            { value: 'custom', label: 'Custom', icon: '✏️' },
                          ].map(t => (
                            <button key={t.value} onClick={() => setAiTone(t.value)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${aiTone === t.value ? 'bg-purple-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-purple-300'}`}>
                              {t.icon} {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {aiTone === 'custom' && (
                        <textarea className="w-full border border-purple-200 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" rows={2}
                          placeholder="e.g., Mention our product launch, be enthusiastic..." value={aiCustomInstructions} onChange={e => setAiCustomInstructions(e.target.value)} />
                      )}
                      <Button onClick={generateAiDraft} disabled={aiDrafting} className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white gap-2">
                        {aiDrafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                        {aiDrafting ? 'Generating draft...' : 'Generate AI Reply'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Rich Reply Editor */}
              {showReplyBox && (
                <div className="px-6 pb-6">
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b text-xs text-gray-500">
                      <Reply className="h-3.5 w-3.5 text-blue-500" />
                      <span>Replying to <strong className="text-gray-700">{selectedMessage.fromName || selectedMessage.fromEmail}</strong></span>
                      <button onClick={() => setShowReplyBox(false)} className="ml-auto p-0.5 hover:bg-gray-200 rounded"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b bg-white flex-wrap">
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); execCmd('bold'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Bold className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Bold</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); execCmd('italic'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Italic className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Italic</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); execCmd('underline'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Underline className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Underline</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><List className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Bullet List</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList'); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><ListOrdered className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Numbered List</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => { e.preventDefault(); const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500"><Link className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Insert Link</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild><button onMouseDown={e => e.preventDefault()} onClick={() => setShowAiPanel(true)} className="p-1.5 hover:bg-purple-100 rounded text-purple-500"><Sparkles className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>AI Assist</TooltipContent></Tooltip>
                    </div>
                    <div ref={replyEditorRef} contentEditable className="min-h-[140px] max-h-[300px] overflow-y-auto px-4 py-3 text-sm text-gray-700 focus:outline-none leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-1 [&_li]:my-0.5" style={{ wordBreak: 'break-word' }} data-placeholder="Type your reply..." />
                    <div className="flex items-center justify-between px-4 py-2.5 border-t bg-gray-50">
                      <div className="text-[10px] text-gray-400">Press Ctrl+Enter to send</div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setShowReplyBox(false)}>Cancel</Button>
                        <Button size="sm" onClick={sendReply} disabled={sendingReply} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
                          {sendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send Reply
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ INBOX LIST VIEW ============
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-white">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Inbox className="h-4.5 w-4.5 text-white" />
              </div>
              Inbox
            </h2>
            {unreadCount > 0 && <Badge className="bg-blue-600 text-white font-bold text-xs">{unreadCount}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {/* Stats mini badges */}
            {stats && (
              <div className="hidden md:flex items-center gap-1.5 mr-2">
                {stats.positive > 0 && <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[9px] gap-0.5"><ThumbsUp className="h-2.5 w-2.5" />{stats.positive}</Badge>}
                {stats.bounced > 0 && <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-[9px] gap-0.5"><XCircle className="h-2.5 w-2.5" />{stats.bounced}</Badge>}
                {stats.ooo > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[9px] gap-0.5"><Coffee className="h-2.5 w-2.5" />{stats.ooo}</Badge>}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => syncInbox(true)} disabled={syncing} className="gap-1.5 h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing' : 'Sync'}
            </Button>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex items-center gap-1 mb-2.5">
          {[
            { value: 'unified' as const, label: 'Unified', icon: <Inbox className="h-3 w-3" /> },
            { value: 'account' as const, label: 'By Account', icon: <Mail className="h-3 w-3" /> },
            { value: 'campaign' as const, label: 'By Campaign', icon: <Target className="h-3 w-3" /> },
          ].map(v => (
            <button key={v.value} onClick={() => { setViewMode(v.value); setPage(0); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${viewMode === v.value ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input className="pl-8 h-8 text-sm border-gray-200" placeholder="Search inbox..." value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(0); }} />
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { value: 'all', label: 'All', count: stats?.total },
              { value: 'unread', label: 'Unread', count: stats?.unread },
              { value: 'read', label: 'Read' },
              { value: 'replied', label: 'Replied', count: stats?.replied },
              { value: 'bounced', label: 'Bounced', count: stats?.bounced },
              { value: 'archived', label: 'Archived' },
              { value: 'unsubscribed', label: 'Unsub' },
              { value: 'warmup', label: 'Warmup', count: stats?.warmup },
            ].map(f => (
              <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(0); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${statusFilter === f.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label}{f.count ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>

          {/* Reply type filter */}
          <Select value={replyTypeFilter} onValueChange={v => { setReplyTypeFilter(v === 'all_types' ? '' : v); setPage(0); }}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3 w-3 text-gray-400" />
                <SelectValue placeholder="Reply Type" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_types">All Types</SelectItem>
              <SelectItem value="positive"><span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3 text-emerald-600" /> Positive</span></SelectItem>
              <SelectItem value="negative"><span className="flex items-center gap-1"><ThumbsDown className="h-3 w-3 text-red-600" /> Negative</span></SelectItem>
              <SelectItem value="ooo"><span className="flex items-center gap-1"><Coffee className="h-3 w-3 text-amber-600" /> OOO</span></SelectItem>
              <SelectItem value="auto_reply"><span className="flex items-center gap-1"><Bot className="h-3 w-3 text-gray-600" /> Auto-reply</span></SelectItem>
              <SelectItem value="general"><span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-sky-600" /> General</span></SelectItem>
              <SelectItem value="bounce"><span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-red-600" /> Bounce</span></SelectItem>
              <SelectItem value="unsubscribe"><span className="flex items-center gap-1"><Ban className="h-3 w-3 text-orange-600" /> Unsubscribe</span></SelectItem>
            </SelectContent>
          </Select>

          {/* Account filter (visible in account view) */}
          {viewMode === 'account' && emailAccounts.length > 0 && (
            <Select value={accountFilter} onValueChange={v => { setAccountFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-gray-400" /><SelectValue placeholder="All Accounts" /></div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {emailAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}><span className="truncate">{a.email}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Campaign filter (visible in campaign view) */}
          {viewMode === 'campaign' && campaigns.length > 0 && (
            <Select value={campaignFilter} onValueChange={v => { setCampaignFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <div className="flex items-center gap-1.5"><Target className="h-3 w-3 text-gray-400" /><SelectValue placeholder="All Campaigns" /></div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Campaigns</SelectItem>
                {campaigns.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}><span className="truncate">{c.name}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Admin: filter by team member */}
          {isAdmin && teamMembers.length > 0 && (
            <Select value={memberFilter} onValueChange={v => { setMemberFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <div className="flex items-center gap-1.5"><Users className="h-3 w-3 text-gray-400" /><SelectValue placeholder="All Members" /></div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                {teamMembers.map((m: any) => (
                  <SelectItem key={m.userId} value={m.userId}>{m.firstName || m.email?.split('@')[0]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mt-2 py-1.5 px-3 bg-blue-50 rounded-lg border border-blue-200">
            <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 text-xs">{selectedIds.size} selected</Badge>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-blue-700 hover:bg-blue-100" onClick={bulkMarkRead}><CheckCheck className="h-3 w-3" /> Mark Read</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-700 hover:bg-amber-100" onClick={bulkArchive}><Archive className="h-3 w-3" /> Archive</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-600 hover:bg-red-100" onClick={bulkDelete}><Trash2 className="h-3 w-3" /> Delete</Button>
            <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Clear</button>
          </div>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-3" />
            <span className="text-sm text-gray-500">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-blue-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-700 mb-1">No messages</h3>
            <p className="text-sm text-gray-400 text-center max-w-sm mb-4">
              {searchQuery || statusFilter !== 'all' || replyTypeFilter
                ? 'No messages match your current filters. Try adjusting your search or filters.'
                : 'Your inbox is empty. Click "Sync" to check for new replies.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => syncInbox(true)} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Sync Now</Button>
          </div>
        ) : (
          <>
            {/* Select all row */}
            <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-gray-50/50">
              <input type="checkbox" checked={selectedIds.size === messages.length && messages.length > 0} onChange={selectAll} className="w-3.5 h-3.5 rounded border-gray-300" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{total} message{total !== 1 ? 's' : ''}</span>
            </div>

            {/* Messages */}
            <div className="divide-y divide-gray-100">
              {messages.map(msg => {
                const isUnread = msg.status === 'unread';
                const isSelected = selectedIds.has(msg.id);
                const isStarred = starredIds.has(msg.id);
                const replyBadge = getReplyTypeBadge(msg.replyType);
                const leadBadge = getLeadStatusBadge(msg.leadStatus);

                return (
                  <div key={msg.id}
                    className={`group flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-all hover:bg-blue-50/40 ${isUnread ? 'bg-blue-50/20' : ''} ${isSelected ? 'bg-blue-100/30' : ''}`}>
                    {/* Checkbox + Star */}
                    <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(msg.id)} className="w-3.5 h-3.5 rounded border-gray-300" />
                      <button onClick={(e) => { e.stopPropagation(); toggleStar(msg.id); }} className={`p-0.5 transition-opacity ${isStarred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isStarred ? <Star className="h-3 w-3 text-yellow-500 fill-yellow-400" /> : <Star className="h-3 w-3 text-gray-300 hover:text-yellow-400" />}
                      </button>
                    </div>

                    {/* Avatar */}
                    <Avatar className="h-8 w-8 flex-shrink-0 mt-0.5" onClick={() => openMessage(msg)}>
                      <AvatarFallback className={`text-[10px] font-semibold ${msg.provider === 'gmail' ? 'bg-gradient-to-br from-red-400 to-red-500 text-white' : 'bg-gradient-to-br from-blue-400 to-blue-500 text-white'}`}>
                        {getInitials(msg.fromName, msg.fromEmail)}
                      </AvatarFallback>
                    </Avatar>

                    {/* Content */}
                    <div className="flex-1 min-w-0" onClick={() => openMessage(msg)}>
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className={`text-sm truncate ${isUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {msg.sentByUs ? `To: ${msg.toEmail}` : (msg.fromName || msg.fromEmail)}
                        </span>
                        {msg.contact?.company && (
                          <span className="hidden sm:flex text-[9px] text-gray-400 items-center gap-0.5 bg-gray-100 px-1.5 py-0 rounded-full">
                            <Building className="h-2 w-2" /> {msg.contact.company}
                          </span>
                        )}
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${msg.provider === 'gmail' ? 'bg-red-50' : 'bg-blue-50'}`}>
                          {getProviderIcon(msg.provider)}
                        </div>
                        {replyBadge && (
                          <Badge variant="outline" className={`${replyBadge.className} text-[9px] px-1.5 py-0 gap-0.5`}>
                            {replyBadge.icon}{replyBadge.label}
                          </Badge>
                        )}
                        {leadBadge && (
                          <Badge variant="outline" className={`${leadBadge.className} text-[9px] px-1.5 py-0 gap-0.5`}>
                            {leadBadge.icon}{leadBadge.label}
                          </Badge>
                        )}
                        {msg.campaignId && (
                          <span className="text-[9px] text-violet-500 bg-violet-50 px-1.5 py-0 rounded-full">{msg.campaign?.name || 'Campaign'}</span>
                        )}
                      </div>
                      <div className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                        {msg.subject || '(No Subject)'}
                      </div>
                      <div className="text-xs text-gray-400 truncate mt-0.5 max-w-[90%]">{msg.snippet}</div>
                    </div>

                    {/* Right side */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                      <span className={`text-[11px] whitespace-nowrap ${isUnread ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
                        {fmtDate(msg.receivedAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        {isUnread && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        {msg.status === 'replied' && <Reply className="h-3 w-3 text-green-500" />}
                        {msg.bounceType && <XCircle className="h-3 w-3 text-red-500" />}
                        {msg.aiDraft && <Sparkles className="h-3 w-3 text-purple-400" />}
                        {msg.assignedTo && <UserCheck className="h-3 w-3 text-indigo-400" />}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); archiveMessage(msg.id); }} className="p-1 hover:bg-gray-200 rounded-md">
                          <Archive className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }} className="p-1 hover:bg-red-100 rounded-md">
                          <Trash2 className="h-3 w-3 text-gray-400 hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t bg-white">
          <span className="text-xs text-gray-500">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-gray-600 px-2">{page + 1}/{totalPages}</span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <style>{`
        [contenteditable][data-placeholder]:empty::before,
        [contenteditable][data-placeholder].empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
