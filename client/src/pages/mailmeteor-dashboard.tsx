import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLocation } from "wouter";
import { 
  Mail, Plus, Search, Users, TrendingUp, BarChart3, 
  FileText, Target, Settings, LogOut, ChevronDown, ChevronRight,
  GitBranch, Zap, Send, Eye, MousePointerClick, Reply,
  Bell, Activity, Inbox, MoreHorizontal, Pause, Play, Trash2,
  ArrowUp, ArrowDown, Calendar, Sparkles, CreditCard, Lightbulb,
  Wrench, PieChart, Link2, Globe, RefreshCw, ExternalLink, XCircle,
  AlertTriangle, Building2, Shield, Flame
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { useCampaigns } from "@/hooks/use-campaigns";
import type { Campaign } from "@/types";
import type { TrackingEvent } from "@/types";

// Import all page components
import EmailAccountSetup from "./email-account-setup";
import CampaignCreator from "./campaign-creator";
import ContactsManager from "./contacts-manager";
import AnalyticsDashboard from "./analytics-dashboard";
import TemplateManager from "./template-manager";
import FollowupSequenceBuilder from "./followup-builder";
import CampaignDetailPage from "./campaign-detail";
import AdvancedSettings from "./advanced-settings";
import AccountSettings from "./account-settings";
import UnifiedInbox from "./unified-inbox";
import TeamManagement from "./team-management";
import SuperAdminDashboard from "./superadmin-dashboard";
import WarmupMonitoring from "./warmup-monitoring";

type ViewType = 'campaigns' | 'templates' | 'contacts' | 'inbox' | 'setup' | 'analytics' | 'verification' | 'tracking' | 'account' | 'billing' | 'followups' | 'insights' | 'tools' | 'campaign-detail' | 'advanced-settings' | 'team' | 'superadmin' | 'warmup';

// Live Tracking Feed component - fetches real tracking events
function LiveTrackingFeed({ dashStats }: { dashStats: any }) {
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/tracking/events?limit=20', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (e) {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getEventConfig = (type: string): { label: string; icon: any; colorClass: string; bgClass: string } => {
    switch (type) {
      case 'sent': return { label: 'Email sent', icon: Send, colorClass: 'text-blue-600', bgClass: 'bg-blue-50' };
      case 'open': return { label: 'Email opened', icon: Eye, colorClass: 'text-emerald-600', bgClass: 'bg-emerald-50' };
      case 'click': return { label: 'Link clicked', icon: MousePointerClick, colorClass: 'text-purple-600', bgClass: 'bg-purple-50' };
      case 'reply': return { label: 'Reply received', icon: Reply, colorClass: 'text-amber-600', bgClass: 'bg-amber-50' };
      case 'bounce': return { label: 'Bounced', icon: XCircle, colorClass: 'text-red-600', bgClass: 'bg-red-50' };
      case 'unsubscribe': return { label: 'Unsubscribed', icon: AlertTriangle, colorClass: 'text-gray-600', bgClass: 'bg-gray-50' };
      default: return { label: type, icon: Mail, colorClass: 'text-gray-600', bgClass: 'bg-gray-50' };
    }
  };

  const sent = dashStats?.totalSent || 0;
  const opened = dashStats?.totalOpened || 0;
  const clicked = dashStats?.totalClicked || 0;
  const replied = dashStats?.totalReplied || 0;
  const maxVal = Math.max(sent, 1);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" /> Live Activity Feed
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">Real-time tracking of email opens, clicks, and replies</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchEvents} className="text-xs">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <Card className="border-gray-200/60">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-600" /> Recent Activity
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="h-10 w-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No tracking events yet</p>
                <p className="text-xs text-gray-300 mt-1">Send a campaign to see live activity</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {events.map((event) => {
                  const config = getEventConfig(event.type);
                  const EventIcon = config.icon;
                  return (
                    <div key={event.id} className="flex items-center gap-3 py-2 hover:bg-gray-50/50 rounded-lg px-2 transition-colors">
                      <div className={`p-2 rounded-lg ${config.bgClass}`}>
                        <EventIcon className={`h-3.5 w-3.5 ${config.colorClass}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{config.label}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {event.contact?.email || 'Unknown contact'}
                          {event.campaignName && <span className="text-gray-300"> &middot; {event.campaignName}</span>}
                        </div>
                        {event.url && (
                          <div className="text-[10px] text-blue-500 truncate mt-0.5 flex items-center gap-1">
                            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" /> {event.url}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(event.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Performance Overview */}
        <Card className="border-gray-200/60">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" /> Overall Performance
            </h3>
            <div className="space-y-5">
              {[
                { label: 'Emails Sent', value: sent, max: maxVal, color: 'bg-blue-500' },
                { label: 'Opens', value: opened, max: maxVal, color: 'bg-emerald-500' },
                { label: 'Clicks', value: clicked, max: maxVal, color: 'bg-purple-500' },
                { label: 'Replies', value: replied, max: maxVal, color: 'bg-amber-500' },
              ].map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-600">{item.label}</span>
                    <span className="text-sm font-bold text-gray-900">{item.value.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.max > 0 ? (item.value / item.max) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function MailMeteorDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [viewMode, setViewMode] = useState<'dashboard' | 'campaign'>('dashboard');
  const [currentView, setCurrentView] = useState<ViewType>('campaigns');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [location, setLocation] = useLocation();
  const [userOrgs, setUserOrgs] = useState<Array<{ id: string; name: string; role: string; isDefault: boolean }>>([]);
  const [currentOrgName, setCurrentOrgName] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  
  const { campaigns, isLoading } = useCampaigns();

  const { data: user } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  // Fetch user profile with org info
  useEffect(() => {
    fetch('/api/auth/user-profile', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.organizations) {
          setUserOrgs(data.organizations);
          setCurrentOrgName(data.organizationName || '');
        }
        if (data?.isSuperAdmin) {
          setIsSuperAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const handleSwitchOrg = async (orgId: string) => {
    try {
      const res = await fetch('/api/organizations/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: orgId }),
      });
      if (res.ok) {
        window.location.reload(); // Reload to refresh all data for new org
      }
    } catch (e) {
      console.error('Failed to switch org:', e);
    }
  };

  const { data: dashStats } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    retry: false,
  });

  // Handle URL query params: ?view=setup&gmail_connected=email@gmail.com
  // This allows OAuth callbacks and deep links to navigate to the correct section
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam && ['campaigns', 'templates', 'contacts', 'inbox', 'setup', 'analytics', 'verification', 'tracking', 'account', 'billing', 'followups', 'insights', 'tools', 'advanced-settings', 'team', 'superadmin', 'warmup'].includes(viewParam)) {
      setCurrentView(viewParam as ViewType);
    }
    // Clean URL params after processing (but keep gmail_connected/error for child components)
    // Don't clean yet - let child components read them first
    // We'll clean after a short delay
    if (viewParam) {
      setTimeout(() => {
        window.history.replaceState({}, '', window.location.pathname);
      }, 500);
    }
  }, []);

  // Fetch inbox unread count for sidebar badge
  const [inboxUnread, setInboxUnread] = useState(0);
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const resp = await fetch('/api/inbox/unread-count', { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          setInboxUnread(data.unread || 0);
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      localStorage.clear();
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/?logout=true';
    } catch (error) {
      window.location.href = '/?logout=true';
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      following_up: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      completed: 'bg-gray-50 text-gray-600 border-gray-200',
      draft: 'bg-slate-50 text-slate-500 border-slate-200',
      scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
      paused: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    const label = status === 'following_up' ? 'Following Up' : status;
    return <Badge variant="outline" className={`font-medium text-xs capitalize ${styles[status] || styles.draft}`}>{label}</Badge>;
  };

  const filters = ["All", "Active", "Scheduled", "Drafts", "Completed", "Paused"];
  
  const filteredCampaigns = campaigns?.filter((campaign: Campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || 
                         (activeFilter === "Active" && (campaign.status === "active" || campaign.status === "following_up")) ||
                         (activeFilter === "Scheduled" && campaign.status === "scheduled") ||
                         (activeFilter === "Drafts" && campaign.status === "draft") ||
                         (activeFilter === "Completed" && campaign.status === "completed") ||
                         (activeFilter === "Paused" && campaign.status === "paused");
    return matchesSearch && matchesFilter;
  }) || [];

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const formatPercentage = (num: number, den: number) => den === 0 ? '0%' : `${((num / den) * 100).toFixed(1)}%`;

  // Campaign actions
  const handlePause = async (id: string) => {
    await fetch(`/api/campaigns/${id}/pause`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };
  const handleResume = async (id: string) => {
    await fetch(`/api/campaigns/${id}/resume`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE', credentials: 'include' });
    window.location.reload();
  };

  // Determine user role from dashboard stats
  const userRole = (dashStats as any)?.userRole || 'member';
  const isAdminOrOwner = userRole === 'owner' || userRole === 'admin';

  const sidebarMainItems = [
    { key: 'campaigns' as ViewType, label: 'Campaigns', icon: Send, count: campaigns?.length },
    { key: 'inbox' as ViewType, label: 'Inbox', icon: Inbox, count: inboxUnread },
    { key: 'templates' as ViewType, label: 'Templates', icon: FileText },
    { key: 'contacts' as ViewType, label: 'Contacts', icon: Users },
  ];

  const insightsSubItems = [
    { key: 'analytics' as ViewType, label: 'Analytics', icon: BarChart3 },
    { key: 'tracking' as ViewType, label: 'Live Feed', icon: Activity },
  ];

  const toolsSubItems = [
    ...(isAdminOrOwner ? [{ key: 'followups' as ViewType, label: 'Automations', icon: Zap }] : []),
    { key: 'setup' as ViewType, label: 'Email Accounts', icon: Inbox },
    ...(isAdminOrOwner ? [{ key: 'warmup' as ViewType, label: 'Warmup', icon: Flame }] : []),
  ];

  const sidebarBottomItems = [
    ...(isSuperAdmin ? [{ key: 'superadmin' as ViewType, label: 'SuperAdmin', icon: Shield }] : []),
    ...(isAdminOrOwner ? [{ key: 'team' as ViewType, label: 'Team', icon: Users }] : []),
    { key: 'account' as ViewType, label: 'Account', icon: Settings },
    ...(isSuperAdmin ? [{ key: 'advanced-settings' as ViewType, label: 'Advanced', icon: Wrench }] : []),
    ...(isAdminOrOwner ? [{ key: 'billing' as ViewType, label: 'Billing', icon: CreditCard }] : []),
  ];

  const getViewTitle = () => {
    if (viewMode === 'campaign') return 'New Campaign';
    const titles: Record<ViewType, string> = {
      campaigns: 'Campaigns', inbox: 'Unified Inbox', templates: 'Templates', contacts: 'Contacts', leads: 'Sales Leads',
      setup: 'Email Accounts', analytics: 'Analytics', followups: 'Automations',
      verification: 'Email Verification', tracking: 'Live Activity Feed',
      account: 'Account', billing: 'Billing', insights: 'Insights', tools: 'Tools',
      'campaign-detail': 'Campaign Detail',
      'advanced-settings': 'Advanced Settings',
      team: 'Team Management',
      superadmin: 'SuperAdmin Console',
      warmup: 'Warmup Monitoring',
    };
    return titles[currentView] || 'Dashboard';
  };

  const getViewDescription = () => {
    const descs: Record<ViewType, string> = {
      campaigns: 'Create and manage your email campaigns',
      inbox: 'All replies from Gmail and Outlook in one place',
      templates: 'Build reusable email templates',
      contacts: 'Manage your contacts and segments',
      leads: 'Prioritized leads with AI-powered outbound drafts',
      setup: 'Connect your email accounts',
      analytics: 'Track your email performance',
      followups: 'Automate follow-up sequences',
      verification: 'Verify email addresses',
      tracking: 'Real-time email activity',
      account: 'Manage your account settings',
      billing: 'Billing and subscription',
      insights: 'Performance insights',
      tools: 'Campaign tools',
      'campaign-detail': 'Campaign tracking details',
      'advanced-settings': 'Configure API integrations and advanced options',
      team: 'Manage your team members, roles, and invitations',
      superadmin: 'Platform-wide management, monitoring, and user administration',
    };
    return descs[currentView] || '';
  };

  // KPI data
  const kpiCards = [
    { label: 'Sent', value: dashStats?.totalSent?.toLocaleString() || '0', icon: Send, color: 'from-blue-500 to-blue-600', lightBg: 'bg-blue-50', lightText: 'text-blue-600' },
    { label: 'Opened', value: dashStats?.openRate ? `${dashStats.openRate}%` : '0%', icon: Eye, color: 'from-emerald-500 to-emerald-600', lightBg: 'bg-emerald-50', lightText: 'text-emerald-600' },
    { label: 'Clicked', value: dashStats?.totalClicked?.toLocaleString() || '0', icon: MousePointerClick, color: 'from-purple-500 to-purple-600', lightBg: 'bg-purple-50', lightText: 'text-purple-600' },
    { label: 'Replied', value: dashStats?.replyRate ? `${dashStats.replyRate}%` : '0%', icon: Reply, color: 'from-amber-500 to-amber-600', lightBg: 'bg-amber-50', lightText: 'text-amber-600' },
  ];

  return (
    <div className="flex h-screen bg-gray-50/50">
      {/* Sidebar - Mailmeteor-style dark navy */}
      <div className={`${sidebarCollapsed ? 'w-[68px]' : 'w-60'} bg-[#1a1f36] flex flex-col transition-all duration-300 ease-in-out`}>
        {/* Logo */}
        <div className={`h-14 flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'px-5'}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-gradient-to-br from-orange-500 to-red-500 p-1.5 rounded-lg flex-shrink-0">
              <Mail className="h-4 w-4 text-white" />
            </div>
            {!sidebarCollapsed && <span className="text-base font-bold text-white truncate">AImailPilot</span>}
          </div>
        </div>

        {/* Organization Switcher */}
        {!sidebarCollapsed && userOrgs.length > 0 && (
          <div className="px-3 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left">
                  <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-300 truncate flex-1">{currentOrgName || 'Select Org'}</span>
                  <ChevronDown className="h-3 w-3 text-gray-500 flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {userOrgs.map(org => (
                  <DropdownMenuItem 
                    key={org.id}
                    onClick={() => handleSwitchOrg(org.id)}
                    className={org.isDefault ? 'bg-blue-50' : ''}
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    <span className="truncate">{org.name}</span>
                    {org.isDefault && <Badge className="ml-auto text-[10px] py-0 px-1.5 bg-blue-100 text-blue-700">Active</Badge>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setCurrentView('team'); setViewMode('dashboard'); }}>
                  <Users className="h-4 w-4 mr-2" />
                  Manage Teams
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2 pt-1 overflow-y-auto">
          <div className="space-y-0.5">
            {sidebarMainItems.map((item) => {
              const isActive = currentView === item.key && viewMode === 'dashboard';
              return sidebarCollapsed ? (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                      className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                        isActive
                          ? 'bg-white/10 text-white' 
                          : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                      }`}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={item.key}
                  onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 text-[13px] ${
                    isActive
                      ? 'bg-blue-600/90 text-white font-semibold' 
                      : 'text-gray-300 hover:bg-white/5 hover:text-white font-medium'
                  }`}
                >
                  <item.icon className={`h-[18px] w-[18px] flex-shrink-0`} />
                  <span className="truncate">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className={`ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400'}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Insights expandable section */}
          <div className="mt-4">
            {!sidebarCollapsed ? (
              <>
                <button onClick={() => setInsightsExpanded(!insightsExpanded)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[13px] text-gray-300 hover:bg-white/5 hover:text-white font-medium transition-all duration-150">
                  <PieChart className="h-[18px] w-[18px] flex-shrink-0" />
                  <span className="truncate">Insights</span>
                  <ChevronRight className={`ml-auto h-3.5 w-3.5 transition-transform duration-200 ${insightsExpanded ? 'rotate-90' : ''}`} />
                </button>
                {insightsExpanded && (
                  <div className="ml-4 space-y-0.5 mt-0.5">
                    {insightsSubItems.map((item) => {
                      const isActive = currentView === item.key && viewMode === 'dashboard';
                      return (
                        <button
                          key={item.key}
                          onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                          className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left text-[12px] ${
                            isActive
                              ? 'bg-blue-600/90 text-white font-semibold'
                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 font-medium'
                          }`}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              insightsSubItems.map((item) => {
                const isActive = currentView === item.key && viewMode === 'dashboard';
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                        className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                          isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                      >
                        <item.icon className="h-[18px] w-[18px]" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })
            )}
          </div>

          {/* Tools expandable section */}
          <div className="mt-1">
            {!sidebarCollapsed ? (
              <>
                <button onClick={() => setToolsExpanded(!toolsExpanded)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[13px] text-gray-300 hover:bg-white/5 hover:text-white font-medium transition-all duration-150">
                  <Wrench className="h-[18px] w-[18px] flex-shrink-0" />
                  <span className="truncate">Tools</span>
                  <ChevronRight className={`ml-auto h-3.5 w-3.5 transition-transform duration-200 ${toolsExpanded ? 'rotate-90' : ''}`} />
                </button>
                {toolsExpanded && (
                  <div className="ml-4 space-y-0.5 mt-0.5">
                    {toolsSubItems.map((item) => {
                      const isActive = currentView === item.key && viewMode === 'dashboard';
                      return (
                        <button
                          key={item.key}
                          onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                          className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left text-[12px] ${
                            isActive
                              ? 'bg-blue-600/90 text-white font-semibold'
                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 font-medium'
                          }`}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              toolsSubItems.map((item) => {
                const isActive = currentView === item.key && viewMode === 'dashboard';
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                        className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                          isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                      >
                        <item.icon className="h-[18px] w-[18px]" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })
            )}
          </div>

          {/* Bottom items: Account, Billing */}
          <div className="mt-4 pt-4 border-t border-white/10 space-y-0.5">
            {sidebarBottomItems.map((item) => {
              const isActive = currentView === item.key && viewMode === 'dashboard';
              const isSuperAdminItem = item.key === 'superadmin';
              return sidebarCollapsed ? (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                      className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                        isSuperAdminItem
                          ? isActive ? 'bg-gradient-to-r from-red-500/30 to-orange-500/30 text-orange-300' : 'text-orange-400 hover:bg-red-500/10 hover:text-orange-300'
                          : isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                      }`}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={item.key}
                  onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all duration-150 text-[13px] ${
                    isSuperAdminItem
                      ? isActive
                        ? 'bg-gradient-to-r from-red-600/90 to-orange-600/90 text-white font-semibold'
                        : 'text-orange-300 hover:bg-red-500/10 hover:text-orange-200 font-medium'
                      : isActive
                        ? 'bg-blue-600/90 text-white font-semibold'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white font-medium'
                  }`}
                >
                  <item.icon className={`h-[18px] w-[18px] flex-shrink-0`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* New Campaign Button at bottom */}
        <div className={`${sidebarCollapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  size="sm"
                  className="w-full bg-blue-600 hover:bg-blue-700 shadow-md h-9"
                  onClick={() => setViewMode('campaign')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Campaign</TooltipContent>
            </Tooltip>
          ) : (
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700 shadow-md font-medium"
              onClick={() => setViewMode('campaign')}
            >
              <Plus className="h-4 w-4 mr-2" />
              New campaign
            </Button>
          )}
        </div>

        {/* Collapse arrow */}
        <div className="px-2 pb-3 flex justify-center">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header - Mailmeteor style */}
        <header className="h-14 bg-white border-b border-gray-200/80 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-52 h-8 text-sm bg-gray-50/80 border-gray-200 focus:bg-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {viewMode === 'campaign' && (
              <Button variant="outline" size="sm" onClick={() => setViewMode('dashboard')} className="text-xs h-7">
                <ChevronRight className="h-3 w-3 mr-1 rotate-180" /> Back
              </Button>
            )}
            <button className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
              <Sparkles className="h-3.5 w-3.5" /> Upgrade plan
            </button>
            <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center">
                  <Avatar className="h-7 w-7">
                    {user?.picture ? <AvatarImage src={user.picture} /> : null}
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white text-[10px] font-semibold">
                      {user?.name?.[0] || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2 border-b">
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-gray-500">{user?.email}</div>
                </div>
                <DropdownMenuItem onClick={() => { setCurrentView('account'); setViewMode('dashboard'); }}>
                  <Settings className="h-4 w-4 mr-2" /> Account
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setCurrentView('billing'); setViewMode('dashboard'); }}>
                  <CreditCard className="h-4 w-4 mr-2" /> Billing
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {/* Campaign Creator */}
          {viewMode === 'campaign' && (
            <CampaignCreator 
              onSuccess={() => { setViewMode('dashboard'); setCurrentView('campaigns'); }} 
              onBack={() => setViewMode('dashboard')}
            />
          )}

          {/* Campaigns List */}
          {viewMode === 'dashboard' && currentView === 'campaigns' && (
            <div className="p-6 space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpiCards.map((kpi) => (
                  <Card key={kpi.label} className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{kpi.label}</span>
                        <div className={`p-2 rounded-xl ${kpi.lightBg}`}>
                          <kpi.icon className={`h-4 w-4 ${kpi.lightText}`} />
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Filter Tabs + New button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
                  {filters.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        activeFilter === filter
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <Button size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm" onClick={() => setViewMode('campaign')}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> New Campaign
                </Button>
              </div>

              {/* Campaigns Table */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-gray-400">Loading campaigns...</span>
                  </div>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
                    <Target className="h-8 w-8 text-gray-300" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">No campaigns yet</h3>
                  <p className="text-sm text-gray-400 mb-6">Create your first email campaign to get started</p>
                  <Button onClick={() => setViewMode('campaign')} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                    <Plus className="h-4 w-4 mr-2" /> Create Campaign
                  </Button>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                  <div className="grid grid-cols-[2fr_80px_80px_80px_80px_80px_80px_44px] gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    <div>Campaign</div>
                    <div>Status</div>
                    <div className="text-right">Sent</div>
                    <div className="text-right">Opens</div>
                    <div className="text-right">Clicks</div>
                    <div className="text-right">Replies</div>
                    <div className="text-right">Date</div>
                    <div></div>
                  </div>

                  {filteredCampaigns.map((campaign: Campaign) => {
                    const openRate = campaign.sentCount ? ((campaign.openedCount || 0) / campaign.sentCount) * 100 : 0;
                    return (
                      <div 
                        key={campaign.id} 
                        className="grid grid-cols-[2fr_80px_80px_80px_80px_80px_80px_44px] gap-2 px-5 py-3.5 border-b border-gray-50 hover:bg-blue-50/30 items-center transition-colors group cursor-pointer"
                        onClick={() => { setSelectedCampaignId(campaign.id); setCurrentView('campaign-detail'); }}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-gray-900 truncate">{campaign.name}</div>
                          {campaign.description && <div className="text-xs text-gray-400 truncate mt-0.5">{campaign.description}</div>}
                        </div>
                        <div>{getStatusBadge(campaign.status)}</div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-700">{(campaign.sentCount || 0).toLocaleString()}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-700">{formatPercentage(campaign.openedCount || 0, campaign.sentCount || 0)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-700">{formatPercentage(campaign.clickedCount || 0, campaign.sentCount || 0)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-700">{formatPercentage(campaign.repliedCount || 0, campaign.sentCount || 0)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-400">{campaign.createdAt ? formatDate(campaign.createdAt) : '-'}</span>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {(campaign.status === 'active' || campaign.status === 'following_up') && (
                                <DropdownMenuItem onClick={() => handlePause(campaign.id)}>
                                  <Pause className="h-3.5 w-3.5 mr-2" /> Pause
                                </DropdownMenuItem>
                              )}
                              {campaign.status === 'paused' && (
                                <DropdownMenuItem onClick={() => handleResume(campaign.id)}>
                                  <Play className="h-3.5 w-3.5 mr-2" /> Resume
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleDelete(campaign.id)} className="text-red-600">
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Templates */}
          {viewMode === 'dashboard' && currentView === 'templates' && <TemplateManager />}

          {/* Unified Inbox */}
          {viewMode === 'dashboard' && currentView === 'inbox' && <UnifiedInbox />}

          {/* Contacts */}
          {viewMode === 'dashboard' && currentView === 'contacts' && <ContactsManager />}


          {/* Follow-ups */}
          {viewMode === 'dashboard' && currentView === 'followups' && <FollowupSequenceBuilder />}

          {/* Email Account Setup */}
          {viewMode === 'dashboard' && currentView === 'setup' && (
            <div className="p-6"><EmailAccountSetup /></div>
          )}

          {/* Analytics */}
          {viewMode === 'dashboard' && currentView === 'analytics' && <AnalyticsDashboard />}

          {/* Campaign Detail */}
          {viewMode === 'dashboard' && currentView === 'campaign-detail' && selectedCampaignId && (
            <CampaignDetailPage 
              campaignId={selectedCampaignId}
              onBack={() => { setCurrentView('campaigns'); setSelectedCampaignId(null); }}
            />
          )}

          {/* Live Tracking */}
          {viewMode === 'dashboard' && currentView === 'tracking' && (
            <LiveTrackingFeed dashStats={dashStats} />
          )}

          {/* Account - Full Account Settings with Quotas, AI Advisor, Reply Tracking */}
          {viewMode === 'dashboard' && currentView === 'account' && (
            <AccountSettings />
          )}

          {/* Billing */}
          {viewMode === 'dashboard' && currentView === 'billing' && (
            <div className="p-6">
              <div className="max-w-2xl space-y-6">
                <Card className="border-gray-200/60 overflow-hidden">
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <CreditCard className="h-5 w-5 text-blue-600" /> Billing & Subscription
                    </h3>
                    <div className="divide-y divide-gray-100">
                      {[
                        { label: 'Current Plan', value: 'AImailPilot Pro', extra: <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 ml-2">Active</Badge> },
                        { label: 'Billing Period', value: 'Monthly' },
                        { label: 'Next Payment', value: 'April 1, 2026' },
                        { label: 'Daily Email Limit', value: '2,000 emails/day' },
                        { label: 'Payment Method', value: '**** **** **** 4242' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between py-3.5">
                          <span className="text-sm text-gray-500">{item.label}</span>
                          <span className="text-sm font-semibold text-gray-900 flex items-center">{item.value}{item.extra}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3 mt-6">
                      <Button variant="outline" size="sm">Change Plan</Button>
                      <Button variant="outline" size="sm">Update Payment</Button>
                      <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50">Cancel Subscription</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Team Management */}
          {viewMode === 'dashboard' && currentView === 'team' && (
            <TeamManagement />
          )}

          {/* SuperAdmin Console */}
          {viewMode === 'dashboard' && currentView === 'superadmin' && isSuperAdmin && (
            <SuperAdminDashboard />
          )}

          {/* Advanced Settings */}
          {viewMode === 'dashboard' && currentView === 'advanced-settings' && (
            <AdvancedSettings />
          )}

          {/* Warmup Monitoring */}
          {viewMode === 'dashboard' && currentView === 'warmup' && (
            <WarmupMonitoring />
          )}
        </main>
      </div>
    </div>
  );
}
