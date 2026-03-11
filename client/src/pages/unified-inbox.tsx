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
  MessageSquare, Zap, ChevronDown, ChevronUp, X, MailPlus
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
  status: 'unread' | 'read' | 'replied' | 'archived';
  provider: 'gmail' | 'outlook';
  aiDraft?: string;
  repliedAt?: string;
  receivedAt: string;
  createdAt: string;
  contact?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    jobTitle: string;
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

interface SyncStatus {
  gmail: { connected: boolean; email: string | null; active: boolean; checking: boolean };
  outlook: { connected: boolean; email: string | null; active: boolean; checking: boolean };
}

export default function UnifiedInbox() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  // Role & team filter
  const [userRole, setUserRole] = useState<string>('member');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  // Selected message
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);

  // Reply state
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const replyEditorRef = useRef<HTMLDivElement>(null);

  // AI Assistant
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiTone, setAiTone] = useState<string>('professional');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiCustomInstructions, setAiCustomInstructions] = useState('');

  // Starred messages (local tracking)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  // Selected IDs for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Quick view panels
  const [showContactInfo, setShowContactInfo] = useState(false);

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // Fetch user role and team members on mount
  useEffect(() => {
    (async () => {
      try {
        const [profileRes, membersRes, accountsRes] = await Promise.all([
          fetch('/api/auth/user-profile', { credentials: 'include' }),
          fetch('/api/team/members', { credentials: 'include' }),
          fetch('/api/email-accounts', { credentials: 'include' }),
        ]);
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setUserRole(profile.role || 'member');
        }
        if (membersRes.ok) setTeamMembers(await membersRes.json());
        if (accountsRes.ok) setEmailAccounts(await accountsRes.json());
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (accountFilter && accountFilter !== 'all') {
        params.set('emailAccountId', accountFilter);
      } else if (memberFilter && memberFilter !== 'all') {
        const memberAccts = emailAccounts.filter((a: any) => a.userId === memberFilter);
        if (memberAccts.length > 0) {
          params.set('emailAccountId', memberAccts.map((a: any) => a.id).join(','));
        }
      }
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const resp = await fetch(`/api/inbox?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to fetch');
      const data = await resp.json();

      let filteredMessages = data.messages || [];
      if (memberFilter && memberFilter !== 'all' && accountFilter === 'all') {
        const memberAcctIds = new Set(emailAccounts.filter((a: any) => a.userId === memberFilter).map((a: any) => a.id));
        if (memberAcctIds.size > 0) {
          filteredMessages = filteredMessages.filter((m: any) => memberAcctIds.has(m.emailAccountId));
        }
      }

      setMessages(filteredMessages);
      setTotal(data.total || 0);
      setUnreadCount(data.unread || 0);
    } catch (err) {
      console.error('Inbox fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, memberFilter, accountFilter, emailAccounts]);

  const fetchSyncStatus = async () => {
    try {
      const resp = await fetch('/api/inbox/sync-status', { credentials: 'include' });
      if (resp.ok) setSyncStatus(await resp.json());
    } catch {}
  };

  useEffect(() => {
    fetchMessages();
    fetchSyncStatus();
  }, [fetchMessages]);

  // Auto-refresh every 60 seconds (less aggressive)
  useEffect(() => {
    const interval = setInterval(fetchMessages, 60000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const syncInbox = async () => {
    setSyncing(true);
    try {
      const resp = await fetch('/api/inbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ lookbackMinutes: 120 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.totalNew > 0) fetchMessages();
      }
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
      fetchSyncStatus();
    }
  };

  const openMessage = async (msg: InboxMessage) => {
    setSelectedMessage(msg);
    setShowReplyBox(false);
    setShowAiPanel(false);
    setShowContactInfo(false);
    setLoadingMessage(true);

    try {
      const resp = await fetch(`/api/inbox/${msg.id}`, { credentials: 'include' });
      if (resp.ok) setSelectedMessage(await resp.json());
    } catch {}

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

  // Rich editor commands
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    replyEditorRef.current?.focus();
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
        alert(err.message || 'Failed to send reply');
      }
    } catch {
      alert('Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  // AI Draft generation
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
        // Insert AI draft into the reply editor
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

  const toggleStar = (id: string) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map(m => m.id)));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

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
    };
    return map[status] || map.read;
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

    return (
      <div className="h-full flex flex-col bg-gray-50">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-white shadow-sm">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedMessage(null)} className="gap-1.5 text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className="h-5 w-px bg-gray-200" />
            <Badge variant="outline" className={`${s.className} gap-1 text-[10px]`}>{s.icon}{s.label}</Badge>
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
            {(selectedMessage as any).accountOwner && isAdmin && (
              <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200 text-[10px] gap-1">
                <User className="h-2.5 w-2.5" /> {(selectedMessage as any).accountOwner.firstName || (selectedMessage as any).accountOwner.email?.split('@')[0]}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
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
                      <ChevronDown className={`h-3 w-3 transition-transform ${showContactInfo ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
              </div>

              {/* Contact info panel */}
              {showContactInfo && contact && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-gray-400">Name:</span> <span className="font-medium">{contact.firstName} {contact.lastName}</span></div>
                    <div><span className="text-gray-400">Email:</span> <span className="font-medium">{contact.email}</span></div>
                    {contact.company && <div><span className="text-gray-400">Company:</span> <span className="font-medium">{contact.company}</span></div>}
                    {contact.jobTitle && <div><span className="text-gray-400">Title:</span> <span className="font-medium">{contact.jobTitle}</span></div>}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable content: message body + reply */}
            <div className="flex-1 overflow-y-auto">
              {/* Message body */}
              <div className="px-6 py-4">
                {loadingMessage ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border shadow-sm">
                    <div className="p-5">
                      {selectedMessage.bodyHtml ? (
                        <div className="prose prose-sm max-w-none [&_img]:max-w-full [&_a]:text-blue-600"
                          dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }} />
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                          {selectedMessage.body || selectedMessage.snippet || '(No content)'}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="px-6 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" onClick={() => { setShowReplyBox(true); setShowAiPanel(false); }} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                    <Reply className="h-3.5 w-3.5" /> Reply
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowAiPanel(!showAiPanel); }} className="gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50">
                    <Sparkles className="h-3.5 w-3.5" /> AI Draft
                  </Button>
                  {selectedMessage.aiDraft && !showReplyBox && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setShowReplyBox(true);
                      setTimeout(() => {
                        if (replyEditorRef.current) {
                          replyEditorRef.current.innerHTML = selectedMessage.aiDraft?.replace(/\n/g, '<br>') || '';
                        }
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
                        <p className="text-[10px] text-gray-500">Generate a context-aware reply using AI</p>
                      </div>
                      <button onClick={() => setShowAiPanel(false)} className="ml-auto p-1 hover:bg-white/50 rounded">
                        <X className="h-4 w-4 text-gray-400" />
                      </button>
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
                            <button
                              key={t.value}
                              onClick={() => setAiTone(t.value)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                aiTone === t.value
                                  ? 'bg-purple-600 text-white shadow-sm'
                                  : 'bg-white text-gray-600 border border-gray-200 hover:border-purple-300'
                              }`}
                            >
                              {t.icon} {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {aiTone === 'custom' && (
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Custom instructions</label>
                          <textarea
                            className="w-full border border-purple-200 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                            rows={2}
                            placeholder="e.g., Mention our upcoming product launch, be enthusiastic about their interest..."
                            value={aiCustomInstructions}
                            onChange={e => setAiCustomInstructions(e.target.value)}
                          />
                        </div>
                      )}

                      <Button
                        onClick={generateAiDraft}
                        disabled={aiDrafting}
                        className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white gap-2"
                      >
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
                    {/* Reply header */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b text-xs text-gray-500">
                      <Reply className="h-3.5 w-3.5 text-blue-500" />
                      <span>Replying to <strong className="text-gray-700">{selectedMessage.fromName || selectedMessage.fromEmail}</strong></span>
                      <button onClick={() => setShowReplyBox(false)} className="ml-auto p-0.5 hover:bg-gray-200 rounded">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Toolbar */}
                    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b bg-white flex-wrap">
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <Bold className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Bold (Ctrl+B)</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <Italic className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Italic (Ctrl+I)</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => execCmd('underline')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <Underline className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Underline (Ctrl+U)</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => execCmd('insertUnorderedList')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <List className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Bullet List</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => execCmd('insertOrderedList')} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <ListOrdered className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Numbered List</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => {
                          const url = prompt('Enter URL:');
                          if (url) execCmd('createLink', url);
                        }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700">
                          <Link className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>Insert Link</TooltipContent></Tooltip>
                      <div className="w-px h-5 bg-gray-200 mx-1" />
                      <Tooltip><TooltipTrigger asChild>
                        <button onClick={() => { setShowAiPanel(true); }} className="p-1.5 hover:bg-purple-100 rounded text-purple-500 hover:text-purple-700">
                          <Sparkles className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger><TooltipContent>AI Assist</TooltipContent></Tooltip>
                    </div>

                    {/* Editable area */}
                    <div
                      ref={replyEditorRef}
                      contentEditable
                      className="min-h-[140px] max-h-[300px] overflow-y-auto px-4 py-3 text-sm text-gray-700 focus:outline-none [&_a]:text-blue-600 [&_a]:underline leading-relaxed"
                      style={{ wordBreak: 'break-word' }}
                      data-placeholder="Type your reply..."
                      onFocus={e => { if (e.currentTarget.innerHTML === '' || e.currentTarget.innerHTML === '<br>') e.currentTarget.classList.add('empty'); else e.currentTarget.classList.remove('empty'); }}
                      onInput={e => { (e.currentTarget as HTMLDivElement).classList.remove('empty'); }}
                    />

                    {/* Send bar */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-t bg-gray-50">
                      <div className="text-[10px] text-gray-400">
                        Press Ctrl+Enter to send
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setShowReplyBox(false)}>Cancel</Button>
                        <Button size="sm" onClick={sendReply} disabled={sendingReply} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
                          {sendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          Send Reply
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
  const filteredMessages = messages.filter(m => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.subject?.toLowerCase().includes(q) ||
      m.fromEmail?.toLowerCase().includes(q) ||
      m.fromName?.toLowerCase().includes(q) ||
      m.snippet?.toLowerCase().includes(q)
    );
  });

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
            {unreadCount > 0 && (
              <Badge className="bg-blue-600 text-white font-bold text-xs">{unreadCount}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {syncStatus && (
              <div className="flex items-center gap-1.5 mr-1">
                {syncStatus.gmail.connected && (
                  <Tooltip><TooltipTrigger>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${syncStatus.gmail.active ? 'bg-green-100 ring-2 ring-green-300' : 'bg-red-50'}`}>
                      <span className="text-[10px] font-bold text-red-500">G</span>
                    </div>
                  </TooltipTrigger><TooltipContent>Gmail: {syncStatus.gmail.email || 'Connected'}</TooltipContent></Tooltip>
                )}
                {syncStatus.outlook.connected && (
                  <Tooltip><TooltipTrigger>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${syncStatus.outlook.active ? 'bg-green-100 ring-2 ring-green-300' : 'bg-blue-50'}`}>
                      <span className="text-[10px] font-bold text-blue-500">O</span>
                    </div>
                  </TooltipTrigger><TooltipContent>Outlook: {syncStatus.outlook.email || 'Connected'}</TooltipContent></Tooltip>
                )}
                {!syncStatus.gmail.connected && !syncStatus.outlook.connected && (
                  <Tooltip><TooltipTrigger>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  </TooltipTrigger><TooltipContent>No email provider connected</TooltipContent></Tooltip>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={syncInbox} disabled={syncing} className="gap-1.5 h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing' : 'Sync'}
            </Button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              className="pl-8 h-8 text-sm border-gray-200"
              placeholder="Search inbox..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
              { value: 'read', label: 'Read' },
              { value: 'replied', label: 'Replied' },
              { value: 'archived', label: 'Archived' },
            ].map(f => (
              <button
                key={f.value}
                onClick={() => { setStatusFilter(f.value); setPage(0); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  statusFilter === f.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Admin: filter by account */}
          {isAdmin && emailAccounts.length > 1 && (
            <Select value={accountFilter} onValueChange={v => { setAccountFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {emailAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="truncate">{a.email?.split('@')[0]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Admin: filter by team member */}
          {isAdmin && teamMembers.length > 0 && (
            <Select value={memberFilter} onValueChange={v => { setMemberFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-gray-400" />
                  <SelectValue placeholder="All Members" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                {teamMembers.map((m: any) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.firstName || m.email?.split('@')[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mt-2 py-1.5 px-3 bg-blue-50 rounded-lg border border-blue-200">
            <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 text-xs">{selectedIds.size} selected</Badge>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-blue-700 hover:bg-blue-100" onClick={bulkMarkRead}>
              <CheckCheck className="h-3 w-3" /> Mark Read
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-700 hover:bg-amber-100" onClick={bulkArchive}>
              <Archive className="h-3 w-3" /> Archive
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-600 hover:bg-red-100" onClick={bulkDelete}>
              <Trash2 className="h-3 w-3" /> Delete
            </Button>
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
        ) : filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-blue-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-700 mb-1">No messages</h3>
            <p className="text-sm text-gray-400 text-center max-w-sm mb-4">
              {syncStatus?.gmail.connected || syncStatus?.outlook.connected
                ? 'Your inbox is empty. Click "Sync" to check for new replies.'
                : 'Connect Gmail or Outlook in Email Accounts to start receiving replies.'}
            </p>
            {(syncStatus?.gmail.connected || syncStatus?.outlook.connected) && (
              <Button size="sm" variant="outline" onClick={syncInbox} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Sync Now
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Select all row */}
            <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-gray-50/50">
              <input
                type="checkbox"
                checked={selectedIds.size === messages.length && messages.length > 0}
                onChange={selectAll}
                className="w-3.5 h-3.5 rounded border-gray-300"
              />
              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                {total} message{total !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Messages */}
            <div className="divide-y divide-gray-100">
              {filteredMessages.map(msg => {
                const isUnread = msg.status === 'unread';
                const isSelected = selectedIds.has(msg.id);
                const isStarred = starredIds.has(msg.id);

                return (
                  <div
                    key={msg.id}
                    className={`group flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-all hover:bg-blue-50/40 ${
                      isUnread ? 'bg-blue-50/20' : ''
                    } ${isSelected ? 'bg-blue-100/30' : ''}`}
                  >
                    {/* Checkbox + Star */}
                    <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(msg.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <button onClick={(e) => { e.stopPropagation(); toggleStar(msg.id); }}
                        className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isStarred
                          ? <Star className="h-3 w-3 text-yellow-500 fill-yellow-400" />
                          : <Star className="h-3 w-3 text-gray-300 hover:text-yellow-400" />}
                      </button>
                    </div>

                    {/* Avatar */}
                    <Avatar className="h-8 w-8 flex-shrink-0 mt-0.5" onClick={() => openMessage(msg)}>
                      <AvatarFallback className={`text-[10px] font-semibold ${
                        msg.provider === 'gmail'
                          ? 'bg-gradient-to-br from-red-400 to-red-500 text-white'
                          : 'bg-gradient-to-br from-blue-400 to-blue-500 text-white'
                      }`}>
                        {getInitials(msg.fromName, msg.fromEmail)}
                      </AvatarFallback>
                    </Avatar>

                    {/* Content */}
                    <div className="flex-1 min-w-0" onClick={() => openMessage(msg)}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-sm truncate ${isUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {msg.fromName || msg.fromEmail}
                        </span>
                        {msg.contact?.company && (
                          <span className="hidden sm:flex text-[9px] text-gray-400 items-center gap-0.5 bg-gray-100 px-1.5 py-0 rounded-full">
                            <Building className="h-2 w-2" /> {msg.contact.company}
                          </span>
                        )}
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${msg.provider === 'gmail' ? 'bg-red-50' : 'bg-blue-50'}`}>
                          {getProviderIcon(msg.provider)}
                        </div>
                        {msg.campaignId && (
                          <span className="text-[9px] text-violet-500 bg-violet-50 px-1.5 py-0 rounded-full">Campaign</span>
                        )}
                        {isAdmin && (msg as any).accountOwner && (
                          <span className="hidden md:flex text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0 rounded-full items-center gap-0.5">
                            <User className="h-2 w-2" />
                            {(msg as any).accountOwner.firstName || (msg as any).accountOwner.email?.split('@')[0]}
                          </span>
                        )}
                      </div>
                      <div className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                        {msg.subject || '(No Subject)'}
                      </div>
                      <div className="text-xs text-gray-400 truncate mt-0.5 max-w-[90%]">
                        {msg.snippet}
                      </div>
                    </div>

                    {/* Right side */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                      <span className={`text-[11px] whitespace-nowrap ${isUnread ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
                        {fmtDate(msg.receivedAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        {isUnread && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        {msg.status === 'replied' && <Reply className="h-3 w-3 text-green-500" />}
                        {msg.aiDraft && <Sparkles className="h-3 w-3 text-purple-400" />}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); archiveMessage(msg.id); }}
                          className="p-1 hover:bg-gray-200 rounded-md transition-colors">
                          <Archive className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }}
                          className="p-1 hover:bg-red-100 rounded-md transition-colors">
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
          <span className="text-xs text-gray-500">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
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

      {/* Custom styles for contentEditable placeholder */}
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
