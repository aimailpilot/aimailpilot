import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, Send, Eye, MousePointerClick, Reply, AlertTriangle,
  CheckCircle2, XCircle, Clock, Search, ChevronDown, ChevronUp,
  Mail, Activity, BarChart3, Users, ExternalLink, RefreshCw,
  Filter, Download
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CampaignDetail, CampaignMessage, TrackingEvent } from "@/types";

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
  const [activeTab, setActiveTab] = useState<'emails' | 'activity'>('emails');
  const [sortBy, setSortBy] = useState<'date' | 'opens' | 'clicks'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
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

  const { campaign, analytics, messages, totalMessages, recentEvents } = detail;

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      completed: 'bg-gray-50 text-gray-600 border-gray-200',
      draft: 'bg-slate-50 text-slate-500 border-slate-200',
      scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
      paused: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return <Badge variant="outline" className={`font-medium text-xs capitalize ${styles[status] || styles.draft}`}>{status}</Badge>;
  };

  const getEmailStatusIcon = (msg: CampaignMessage) => {
    if (msg.repliedAt || (msg.replyCount && msg.replyCount > 0)) return <Reply className="h-3.5 w-3.5 text-amber-500" />;
    if (msg.clickedAt || (msg.clickCount && msg.clickCount > 0)) return <MousePointerClick className="h-3.5 w-3.5 text-purple-500" />;
    if (msg.openedAt || (msg.openCount && msg.openCount > 0)) return <Eye className="h-3.5 w-3.5 text-emerald-500" />;
    if (msg.status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />;
    if (msg.status === 'failed' || msg.status === 'bounced') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    return <Clock className="h-3.5 w-3.5 text-gray-400" />;
  };

  const getEmailStatusLabel = (msg: CampaignMessage) => {
    if (msg.repliedAt || (msg.replyCount && msg.replyCount > 0)) return 'Replied';
    if (msg.clickedAt || (msg.clickCount && msg.clickCount > 0)) return 'Clicked';
    if (msg.openedAt || (msg.openCount && msg.openCount > 0)) return 'Opened';
    if (msg.status === 'sent') return 'Delivered';
    if (msg.status === 'failed') return 'Failed';
    if (msg.status === 'bounced') return 'Bounced';
    return 'Sending';
  };

  // Filter and sort messages
  const filteredMessages = messages
    .filter((m: CampaignMessage) => {
      const matchesSearch =
        (m.contact?.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.contact?.firstName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.contact?.lastName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.contact?.company || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (statusFilter === 'all') return matchesSearch;
      if (statusFilter === 'opened') return matchesSearch && (m.openedAt || (m.openCount && m.openCount > 0));
      if (statusFilter === 'clicked') return matchesSearch && (m.clickedAt || (m.clickCount && m.clickCount > 0));
      if (statusFilter === 'replied') return matchesSearch && (m.repliedAt || (m.replyCount && m.replyCount > 0));
      if (statusFilter === 'bounced') return matchesSearch && (m.status === 'failed' || m.status === 'bounced');
      if (statusFilter === 'sent') return matchesSearch && m.status === 'sent' && !m.openedAt && !(m.openCount && m.openCount > 0);
      return matchesSearch;
    })
    .sort((a: CampaignMessage, b: CampaignMessage) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'opens') return ((b.openCount || 0) - (a.openCount || 0)) * dir;
      if (sortBy === 'clicks') return ((b.clickCount || 0) - (a.clickCount || 0)) * dir;
      return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * dir;
    });

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'sent': return <Send className="h-3.5 w-3.5 text-blue-500" />;
      case 'open': return <Eye className="h-3.5 w-3.5 text-emerald-500" />;
      case 'click': return <MousePointerClick className="h-3.5 w-3.5 text-purple-500" />;
      case 'reply': return <Reply className="h-3.5 w-3.5 text-amber-500" />;
      case 'bounce': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'unsubscribe': return <AlertTriangle className="h-3.5 w-3.5 text-gray-500" />;
      default: return <Mail className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'sent': return 'Email sent';
      case 'open': return 'Email opened';
      case 'click': return 'Link clicked';
      case 'reply': return 'Reply received';
      case 'bounce': return 'Bounced';
      case 'unsubscribe': return 'Unsubscribed';
      default: return type;
    }
  };

  const getEventBgColor = (type: string) => {
    switch (type) {
      case 'sent': return 'bg-blue-50';
      case 'open': return 'bg-emerald-50';
      case 'click': return 'bg-purple-50';
      case 'reply': return 'bg-amber-50';
      case 'bounce': return 'bg-red-50';
      default: return 'bg-gray-50';
    }
  };

  // Stats cards
  const statsCards = [
    { label: 'Sent', value: analytics?.totalSent || campaign.sentCount || 0, icon: Send, color: 'text-blue-600', bg: 'bg-blue-50', rate: null },
    { label: 'Opened', value: analytics?.opened || campaign.openedCount || 0, icon: Eye, color: 'text-emerald-600', bg: 'bg-emerald-50', rate: analytics?.openRate ? `${analytics.openRate}%` : null },
    { label: 'Clicked', value: analytics?.clicked || campaign.clickedCount || 0, icon: MousePointerClick, color: 'text-purple-600', bg: 'bg-purple-50', rate: analytics?.clickRate ? `${analytics.clickRate}%` : null },
    { label: 'Replied', value: analytics?.replied || campaign.repliedCount || 0, icon: Reply, color: 'text-amber-600', bg: 'bg-amber-50', rate: analytics?.replyRate ? `${analytics.replyRate}%` : null },
    { label: 'Bounced', value: analytics?.bounced || campaign.bouncedCount || 0, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', rate: analytics?.bounceRate ? `${analytics.bounceRate}%` : null },
  ];

  const messageStatusFilters = [
    { key: 'all', label: 'All', count: messages.length },
    { key: 'sent', label: 'Delivered', count: messages.filter((m: CampaignMessage) => m.status === 'sent' && !m.openedAt && !(m.openCount && m.openCount > 0)).length },
    { key: 'opened', label: 'Opened', count: messages.filter((m: CampaignMessage) => m.openedAt || (m.openCount && m.openCount > 0)).length },
    { key: 'clicked', label: 'Clicked', count: messages.filter((m: CampaignMessage) => m.clickedAt || (m.clickCount && m.clickCount > 0)).length },
    { key: 'replied', label: 'Replied', count: messages.filter((m: CampaignMessage) => m.repliedAt || (m.replyCount && m.replyCount > 0)).length },
    { key: 'bounced', label: 'Bounced', count: messages.filter((m: CampaignMessage) => m.status === 'failed' || m.status === 'bounced').length },
  ];

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
              {getStatusBadge(campaign.status)}
            </div>
            {campaign.description && (
              <p className="text-sm text-gray-500 mt-0.5">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchDetail} className="text-xs">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.label} className="border-gray-200/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{stat.label}</span>
                <div className={`p-1.5 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value.toLocaleString()}</div>
              {stat.rate && (
                <div className="text-xs text-gray-500 mt-1">{stat.rate} rate</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delivery funnel progress */}
      {(analytics?.totalSent || 0) > 0 && (
        <Card className="border-gray-200/60 shadow-sm">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Delivery Funnel</h3>
            <div className="space-y-3">
              {[
                { label: 'Delivered', count: analytics?.delivered || 0, total: analytics?.totalSent || 1, color: 'bg-blue-500' },
                { label: 'Opened', count: analytics?.opened || 0, total: analytics?.totalSent || 1, color: 'bg-emerald-500' },
                { label: 'Clicked', count: analytics?.clicked || 0, total: analytics?.totalSent || 1, color: 'bg-purple-500' },
                { label: 'Replied', count: analytics?.replied || 0, total: analytics?.totalSent || 1, color: 'bg-amber-500' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-4">
                  <span className="text-xs font-medium text-gray-500 w-16">{item.label}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min((item.count / item.total) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-20 text-right">
                    {item.count.toLocaleString()} ({((item.count / item.total) * 100).toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Emails / Activity */}
      <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setActiveTab('emails')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'emails' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Mail className="h-3.5 w-3.5" />
          Emails ({totalMessages})
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'activity' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          Activity ({recentEvents.length})
        </button>
      </div>

      {/* Emails Tab */}
      {activeTab === 'emails' && (
        <div className="space-y-4">
          {/* Search + Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
              <Input
                placeholder="Search emails, contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
              {messageStatusFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    statusFilter === f.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {f.label} {f.count > 0 && <span className="ml-0.5 opacity-60">({f.count})</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Messages table */}
          {filteredMessages.length === 0 ? (
            <div className="text-center py-16">
              <Mail className="h-12 w-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">
                {messages.length === 0 ? 'No emails sent yet' : 'No emails match your filters'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[2fr_100px_70px_70px_70px_100px] gap-3 px-5 py-2.5 border-b border-gray-100 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <div>Recipient</div>
                <div>Status</div>
                <div className="text-center cursor-pointer hover:text-gray-600" onClick={() => { setSortBy('opens'); setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); }}>
                  Opens {sortBy === 'opens' && (sortDir === 'desc' ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline" />)}
                </div>
                <div className="text-center cursor-pointer hover:text-gray-600" onClick={() => { setSortBy('clicks'); setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); }}>
                  Clicks {sortBy === 'clicks' && (sortDir === 'desc' ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline" />)}
                </div>
                <div className="text-center">Reply</div>
                <div className="text-right cursor-pointer hover:text-gray-600" onClick={() => { setSortBy('date'); setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); }}>
                  Sent {sortBy === 'date' && (sortDir === 'desc' ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline" />)}
                </div>
              </div>

              {/* Rows */}
              {filteredMessages.map((msg: CampaignMessage) => (
                <div key={msg.id} className="grid grid-cols-[2fr_100px_70px_70px_70px_100px] gap-3 px-5 py-3 border-b border-gray-50 hover:bg-blue-50/20 items-center transition-colors">
                  {/* Recipient */}
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {getEmailStatusIcon(msg)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {msg.contact?.firstName || msg.contact?.lastName
                          ? `${msg.contact?.firstName || ''} ${msg.contact?.lastName || ''}`.trim()
                          : msg.contact?.email || 'Unknown'}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{msg.contact?.email || ''}</div>
                      {msg.contact?.company && <div className="text-[10px] text-gray-300 truncate">{msg.contact.company}</div>}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium ${
                        getEmailStatusLabel(msg) === 'Replied' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        getEmailStatusLabel(msg) === 'Clicked' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        getEmailStatusLabel(msg) === 'Opened' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        getEmailStatusLabel(msg) === 'Delivered' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        getEmailStatusLabel(msg) === 'Failed' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {getEmailStatusLabel(msg)}
                    </Badge>
                  </div>

                  {/* Opens */}
                  <div className="text-center">
                    {(msg.openCount || 0) > 0 ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                            <Eye className="h-3 w-3" /> {msg.openCount}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          First opened: {msg.firstOpenedAt ? formatTime(msg.firstOpenedAt) : '-'}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </div>

                  {/* Clicks */}
                  <div className="text-center">
                    {(msg.clickCount || 0) > 0 ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600">
                            <MousePointerClick className="h-3 w-3" /> {msg.clickCount}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          First clicked: {msg.firstClickedAt ? formatTime(msg.firstClickedAt) : '-'}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </div>

                  {/* Reply */}
                  <div className="text-center">
                    {(msg.replyCount || 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                        <Reply className="h-3 w-3" /> {msg.replyCount}
                      </span>
                    ) : msg.repliedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                        <Reply className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </div>

                  {/* Sent time */}
                  <div className="text-right">
                    <span className="text-xs text-gray-400">{msg.sentAt ? formatTime(msg.sentAt) : msg.createdAt ? formatTime(msg.createdAt) : '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {filteredMessages.length > 0 && (
            <div className="text-xs text-gray-400 text-center">
              Showing {filteredMessages.length} of {totalMessages} emails
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && (
        <div>
          {recentEvents.length === 0 ? (
            <div className="text-center py-16">
              <Activity className="h-12 w-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No tracking events yet</p>
              <p className="text-xs text-gray-300 mt-1">Events will appear here as recipients interact with your emails</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                {recentEvents.map((event: TrackingEvent) => (
                  <div key={event.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className={`p-2 rounded-lg ${getEventBgColor(event.type)}`}>
                      {getEventIcon(event.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{getEventLabel(event.type)}</div>
                      <div className="text-xs text-gray-400">
                        {event.contactId && messages.find((m: CampaignMessage) => m.contactId === event.contactId)?.contact?.email || 'Unknown contact'}
                      </div>
                      {event.url && (
                        <div className="text-[10px] text-blue-500 truncate mt-0.5 flex items-center gap-1">
                          <ExternalLink className="h-2.5 w-2.5" /> {event.url}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
