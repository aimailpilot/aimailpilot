import React, { useState, useEffect, useCallback } from "react";
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
  ChevronLeft, ChevronRight, Search, Filter, Loader2, Reply,
  Building, User, ExternalLink, Clock, Eye, EyeOff, Star,
  AlertTriangle, XCircle, MailOpen, ArrowLeft, Users
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

  // Role & team filter (admin can filter by member)
  const [userRole, setUserRole] = useState<string>('member');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [memberFilter, setMemberFilter] = useState<string>('all'); // 'all' or userId
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  // Selected message
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);

  // Reply
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Selected IDs for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      // If admin is filtering by a specific member's email account
      if (memberFilter && memberFilter !== 'all') {
        // Find accounts owned by this member
        const memberAccts = emailAccounts.filter((a: any) => a.userId === memberFilter);
        if (memberAccts.length > 0) {
          // Filter by the first account (API supports single emailAccountId)
          // We'll do additional client-side filtering for multiple accounts
          params.set('emailAccountId', memberAccts.map((a: any) => a.id).join(','));
        }
      }
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const resp = await fetch(`/api/inbox?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to fetch');
      const data = await resp.json();
      
      let filteredMessages = data.messages || [];
      // Client-side filter when admin filters by member (multi-account)
      if (memberFilter && memberFilter !== 'all') {
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
  }, [statusFilter, page, memberFilter, emailAccounts]);

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

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMessages();
    }, 30000);
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
        if (data.totalNew > 0) {
          fetchMessages();
        }
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
    setReplyBody('');
    setLoadingMessage(true);

    try {
      // Fetch full message with body
      const resp = await fetch(`/api/inbox/${msg.id}`, { credentials: 'include' });
      if (resp.ok) {
        const fullMsg = await resp.json();
        setSelectedMessage(fullMsg);
      }
    } catch {}

    // Mark as read if unread
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
      await fetch(`/api/inbox/${id}/archive`, {
        method: 'POST',
        credentials: 'include',
      });
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setTotal(prev => prev - 1);
    } catch {}
  };

  const deleteMessage = async (id: string) => {
    try {
      await fetch(`/api/inbox/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setTotal(prev => prev - 1);
    } catch {}
  };

  const sendReply = async () => {
    if (!selectedMessage || !replyBody.trim()) return;
    setSendingReply(true);
    try {
      const resp = await fetch(`/api/inbox/${selectedMessage.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: replyBody }),
      });
      if (resp.ok) {
        setShowReplyBox(false);
        setReplyBody('');
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, status: 'replied' as const } : m));
        setSelectedMessage(prev => prev ? { ...prev, status: 'replied' } : null);
      } else {
        const err = await resp.json();
        alert(err.message || 'Failed to send reply');
      }
    } catch (err) {
      alert('Failed to send reply');
    } finally {
      setSendingReply(false);
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    const map: Record<string, { label: string; className: string }> = {
      unread: { label: 'Unread', className: 'bg-blue-100 text-blue-700 border-blue-200' },
      read: { label: 'Read', className: 'bg-gray-100 text-gray-600 border-gray-200' },
      replied: { label: 'Replied', className: 'bg-green-100 text-green-700 border-green-200' },
      archived: { label: 'Archived', className: 'bg-amber-100 text-amber-700 border-amber-200' },
    };
    return map[status] || map.read;
  };

  const getProviderBadge = (provider: string) => {
    if (provider === 'gmail') return { label: 'Gmail', className: 'bg-red-50 text-red-600 border-red-200' };
    if (provider === 'outlook') return { label: 'Outlook', className: 'bg-blue-50 text-blue-600 border-blue-200' };
    return { label: provider, className: 'bg-gray-50 text-gray-600' };
  };

  const getInitials = (name: string, email: string) => {
    if (name && name !== email) {
      const parts = name.split(/\s+/);
      return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
    }
    return email?.slice(0, 2).toUpperCase() || '??';
  };

  const totalPages = Math.ceil(total / pageSize);

  // === MESSAGE DETAIL VIEW ===
  if (selectedMessage) {
    const s = getStatusBadge(selectedMessage.status);
    const p = getProviderBadge(selectedMessage.provider);
    return (
      <div className="h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-4 border-b bg-white">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedMessage(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Badge variant="outline" className={s.className}>{s.label}</Badge>
            <Badge variant="outline" className={p.className}>{p.label}</Badge>
            {selectedMessage.campaign && (
              <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
                Campaign: {selectedMessage.campaign.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => archiveMessage(selectedMessage.id)}>
                  <Archive className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => { deleteMessage(selectedMessage.id); setSelectedMessage(null); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Message header */}
        <div className="p-6 border-b bg-white">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">{selectedMessage.subject || '(No Subject)'}</h2>
          <div className="flex items-start gap-4">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-semibold">
                {getInitials(selectedMessage.fromName, selectedMessage.fromEmail)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{selectedMessage.fromName || selectedMessage.fromEmail}</span>
                {selectedMessage.fromName && <span className="text-sm text-gray-500">&lt;{selectedMessage.fromEmail}&gt;</span>}
              </div>
              {selectedMessage.contact && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                  {selectedMessage.contact.company && (
                    <span className="flex items-center gap-1"><Building className="h-3 w-3" /> {selectedMessage.contact.company}</span>
                  )}
                  {selectedMessage.contact.jobTitle && (
                    <span className="flex items-center gap-1">• {selectedMessage.contact.jobTitle}</span>
                  )}
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> {fmtFullDate(selectedMessage.receivedAt)}
                <span className="ml-2">To: {selectedMessage.toEmail}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Message body */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {loadingMessage ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="bg-white rounded-lg border p-6 shadow-sm">
              {selectedMessage.bodyHtml ? (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                  {selectedMessage.body || selectedMessage.snippet || '(No content)'}
                </pre>
              )}
            </div>
          )}

          {/* Reply Box */}
          {showReplyBox ? (
            <div className="mt-6 bg-white rounded-lg border p-4 shadow-sm">
              <div className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                <Reply className="h-3.5 w-3.5" /> Replying to {selectedMessage.fromName || selectedMessage.fromEmail}
              </div>
              <textarea
                className="w-full border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={6}
                placeholder="Type your reply..."
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
              />
              <div className="flex items-center justify-between mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowReplyBox(false)}>Cancel</Button>
                <Button size="sm" onClick={sendReply} disabled={sendingReply || !replyBody.trim()}>
                  {sendingReply ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send Reply
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <Button onClick={() => setShowReplyBox(true)} className="gap-2">
                <Reply className="h-4 w-4" /> Reply
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // === INBOX LIST VIEW ===
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blue-600" /> Unified Inbox
            </h2>
            {unreadCount > 0 && (
              <Badge className="bg-blue-600 text-white">{unreadCount} unread</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {syncStatus && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-2">
                {syncStatus.gmail.connected && (
                  <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-[10px] gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${syncStatus.gmail.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    Gmail {syncStatus.gmail.email ? `(${syncStatus.gmail.email.split('@')[0]})` : ''}
                  </Badge>
                )}
                {syncStatus.outlook.connected && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-[10px] gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${syncStatus.outlook.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    Outlook {syncStatus.outlook.email ? `(${syncStatus.outlook.email.split('@')[0]})` : ''}
                  </Badge>
                )}
                {!syncStatus.gmail.connected && !syncStatus.outlook.connected && (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> No email connected
                  </span>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={syncInbox} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              className="pl-9 h-8 text-sm"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px] h-8 text-sm">
              <SelectValue placeholder="All messages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Messages</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {/* Admin: filter by team member */}
          {(userRole === 'owner' || userRole === 'admin') && teamMembers.length > 0 && (
            <Select value={memberFilter} onValueChange={v => { setMemberFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <div className="flex items-center gap-1.5">
                  <User className="h-3 w-3 text-gray-400" />
                  <SelectValue placeholder="All Members" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                {teamMembers.map((m: any) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.firstName || m.email?.split('@')[0]} {m.lastName || ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selectedIds.size} selected</Badge>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={bulkMarkRead}>
                <CheckCheck className="h-3.5 w-3.5 mr-1" /> Mark Read
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Inbox className="h-12 w-12 mb-3 text-gray-300" />
            <div className="text-base font-medium text-gray-500 mb-1">No messages yet</div>
            <div className="text-sm text-gray-400 mb-4">
              {syncStatus?.gmail.connected || syncStatus?.outlook.connected
                ? 'Click "Sync Now" to check for new replies from your email accounts.'
                : 'Connect your Gmail or Outlook account to start receiving replies here.'}
            </div>
            {!syncStatus?.gmail.connected && !syncStatus?.outlook.connected && (
              <Button size="sm" variant="outline" onClick={() => window.location.href = '/api/auth/google'}>
                Connect Email Account
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {messages
              .filter(m => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (
                  m.subject?.toLowerCase().includes(q) ||
                  m.fromEmail?.toLowerCase().includes(q) ||
                  m.fromName?.toLowerCase().includes(q) ||
                  m.snippet?.toLowerCase().includes(q)
                );
              })
              .map(msg => {
              const isUnread = msg.status === 'unread';
              const isSelected = selectedIds.has(msg.id);
              const providerBadge = getProviderBadge(msg.provider);

              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 ${
                    isUnread ? 'bg-blue-50/40' : ''
                  } ${isSelected ? 'bg-blue-100/40' : ''} ${
                    selectedMessage?.id === msg.id ? 'bg-blue-100' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(msg.id)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>

                  {/* Avatar */}
                  <Avatar className="h-9 w-9 flex-shrink-0" onClick={() => openMessage(msg)}>
                    <AvatarFallback className={`text-xs font-semibold ${
                      msg.provider === 'gmail'
                        ? 'bg-gradient-to-br from-red-400 to-red-600 text-white'
                        : 'bg-gradient-to-br from-blue-400 to-blue-600 text-white'
                    }`}>
                      {getInitials(msg.fromName, msg.fromEmail)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Content */}
                  <div className="flex-1 min-w-0" onClick={() => openMessage(msg)}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-sm truncate max-w-[200px] ${isUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {msg.fromName || msg.fromEmail}
                      </span>
                      {msg.contact?.company && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <Building className="h-2.5 w-2.5" /> {msg.contact.company}
                        </span>
                      )}
                      <Badge variant="outline" className={`${providerBadge.className} text-[9px] px-1 py-0`}>
                        {providerBadge.label}
                      </Badge>
                      {msg.campaignId && (
                        <Badge variant="outline" className="bg-violet-50 text-violet-600 border-violet-200 text-[9px] px-1 py-0">
                          Campaign
                        </Badge>
                      )}
                      {/* Admin: show account owner */}
                      {(userRole === 'owner' || userRole === 'admin') && (msg as any).accountOwner && (
                        <span className="text-[9px] text-indigo-500 flex items-center gap-0.5 bg-indigo-50 px-1.5 py-0 rounded-full">
                          <User className="h-2.5 w-2.5" />
                          {(msg as any).accountOwner.firstName || (msg as any).accountOwner.email?.split('@')[0]}
                        </span>
                      )}
                    </div>
                    <div className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                      {msg.subject || '(No Subject)'}
                    </div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {msg.snippet}
                    </div>
                  </div>

                  {/* Right side - time + actions */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(msg.receivedAt)}</span>
                    {isUnread && (
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    )}
                    {msg.status === 'replied' && (
                      <Reply className="h-3.5 w-3.5 text-green-500" />
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); archiveMessage(msg.id); }}
                        className="p-1 hover:bg-gray-200 rounded">
                        <Archive className="h-3 w-3 text-gray-400" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }}
                        className="p-1 hover:bg-red-100 rounded">
                        <Trash2 className="h-3 w-3 text-gray-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
          <span className="text-xs text-gray-500">
            Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 px-2">{page + 1} / {totalPages}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
