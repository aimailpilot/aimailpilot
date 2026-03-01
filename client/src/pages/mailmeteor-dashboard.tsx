import { useState } from "react";
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
  ArrowUp, ArrowDown, Calendar, Sparkles
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { useCampaigns } from "@/hooks/use-campaigns";
import type { Campaign } from "@/types";

// Import all page components
import EmailAccountSetup from "./email-account-setup";
import CampaignCreator from "./campaign-creator";
import ContactsManager from "./contacts-manager";
import AnalyticsDashboard from "./analytics-dashboard";
import TemplateManager from "./template-manager";
import FollowupSequenceBuilder from "./followup-builder";

type ViewType = 'campaigns' | 'templates' | 'contacts' | 'setup' | 'analytics' | 'verification' | 'tracking' | 'account' | 'billing' | 'followups';

export default function MailMeteorDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [viewMode, setViewMode] = useState<'dashboard' | 'campaign'>('dashboard');
  const [currentView, setCurrentView] = useState<ViewType>('campaigns');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [location, setLocation] = useLocation();
  
  const { campaigns, isLoading } = useCampaigns();

  const { data: user } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const { data: dashStats } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    retry: false,
  });

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
      completed: 'bg-gray-50 text-gray-600 border-gray-200',
      draft: 'bg-slate-50 text-slate-500 border-slate-200',
      scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
      paused: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return <Badge variant="outline" className={`font-medium text-xs capitalize ${styles[status] || styles.draft}`}>{status}</Badge>;
  };

  const filters = ["All", "Active", "Scheduled", "Drafts", "Completed", "Paused"];
  
  const filteredCampaigns = campaigns?.filter((campaign: Campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || 
                         (activeFilter === "Active" && campaign.status === "active") ||
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

  const sidebarItems = [
    { key: 'campaigns' as ViewType, label: 'Campaigns', icon: Target, count: campaigns?.length },
    { key: 'contacts' as ViewType, label: 'Contacts', icon: Users },
    { key: 'templates' as ViewType, label: 'Templates', icon: FileText },
    { key: 'followups' as ViewType, label: 'Automations', icon: Zap },
    { key: 'setup' as ViewType, label: 'Accounts', icon: Inbox },
  ];

  const sidebarBottomItems = [
    { key: 'analytics' as ViewType, label: 'Analytics', icon: BarChart3 },
    { key: 'tracking' as ViewType, label: 'Live Feed', icon: Activity },
    { key: 'account' as ViewType, label: 'Settings', icon: Settings },
  ];

  const getViewTitle = () => {
    if (viewMode === 'campaign') return 'New Campaign';
    const titles: Record<ViewType, string> = {
      campaigns: 'Campaigns', templates: 'Templates', contacts: 'Contacts',
      setup: 'Email Accounts', analytics: 'Analytics', followups: 'Automations',
      verification: 'Email Verification', tracking: 'Live Activity Feed',
      account: 'Settings', billing: 'Billing',
    };
    return titles[currentView] || 'Dashboard';
  };

  const getViewDescription = () => {
    const descs: Record<ViewType, string> = {
      campaigns: 'Create and manage your email campaigns',
      templates: 'Build reusable email templates',
      contacts: 'Manage your contacts and segments',
      setup: 'Connect your email accounts',
      analytics: 'Track your email performance',
      followups: 'Automate follow-up sequences',
      verification: 'Verify email addresses',
      tracking: 'Real-time email activity',
      account: 'Manage your account settings',
      billing: 'Billing and subscription',
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
      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-[68px]' : 'w-60'} bg-white border-r border-gray-200/80 flex flex-col transition-all duration-300 ease-in-out`}>
        {/* Logo */}
        <div className={`h-16 border-b border-gray-100 flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'px-5'}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-md shadow-blue-200/60 flex-shrink-0">
              <Mail className="h-4.5 w-4.5 text-white" />
            </div>
            {!sidebarCollapsed && <span className="text-lg font-bold text-gray-900 truncate">MailFlow</span>}
          </div>
        </div>

        {/* New Campaign Button */}
        <div className={`${sidebarCollapsed ? 'px-2 py-3' : 'px-3 py-4'}`}>
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  size="sm"
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/50 h-9"
                  onClick={() => setViewMode('campaign')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Campaign</TooltipContent>
            </Tooltip>
          ) : (
            <Button 
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/50 font-medium"
              onClick={() => setViewMode('campaign')}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Campaign
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 overflow-y-auto">
          <div className="space-y-0.5">
            {sidebarItems.map((item) => {
              const isActive = currentView === item.key && viewMode === 'dashboard';
              return sidebarCollapsed ? (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                      className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                        isActive
                          ? 'bg-blue-50 text-blue-700' 
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
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
                      ? 'bg-blue-50 text-blue-700 font-semibold' 
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-medium'
                  }`}
                >
                  <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? 'text-blue-600' : ''}`} />
                  <span className="truncate">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className={`ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 mb-2">
            {!sidebarCollapsed && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300 px-3 mb-1.5">Insights</div>
            )}
            <div className="space-y-0.5">
              {sidebarBottomItems.map((item) => {
                const isActive = currentView === item.key && viewMode === 'dashboard';
                return sidebarCollapsed ? (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                        className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-all duration-150 ${
                          isActive
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
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
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-medium'
                    }`}
                  >
                    <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? 'text-blue-600' : ''}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* User Profile at bottom */}
        <div className={`border-t border-gray-100 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`w-full flex items-center gap-2.5 rounded-lg hover:bg-gray-50 transition-colors ${sidebarCollapsed ? 'justify-center p-2' : 'p-2'}`}>
                <Avatar className="h-8 w-8 flex-shrink-0">
                  {user?.picture ? <AvatarImage src={user.picture} /> : null}
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white text-xs font-semibold">
                    {user?.name?.[0] || 'U'}
                  </AvatarFallback>
                </Avatar>
                {!sidebarCollapsed && (
                  <>
                    <div className="text-left min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">{user?.name || 'User'}</div>
                      <div className="text-[11px] text-gray-400 truncate">{user?.email}</div>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={sidebarCollapsed ? "center" : "end"} side={sidebarCollapsed ? "right" : "top"} className="w-56">
              <div className="px-3 py-2 border-b">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-gray-500">{user?.email}</div>
              </div>
              <DropdownMenuItem onClick={() => { setCurrentView('account'); setViewMode('dashboard'); }}>
                <Settings className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200/80 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{getViewTitle()}</h1>
              {viewMode === 'dashboard' && (
                <p className="text-xs text-gray-400 truncate">{getViewDescription()}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'campaign' && (
              <Button variant="outline" size="sm" onClick={() => setViewMode('dashboard')}>
                <ChevronRight className="h-3.5 w-3.5 mr-1 rotate-180" /> Back
              </Button>
            )}
            {viewMode === 'dashboard' && currentView === 'campaigns' && (
              <div className="relative mr-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
                <Input
                  placeholder="Search campaigns..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-56 h-9 text-sm bg-gray-50/80 border-gray-200 focus:bg-white"
                />
              </div>
            )}
            <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full" />
            </button>
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
                  <div className="grid grid-cols-[2fr_80px_90px_90px_90px_90px_44px] gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    <div>Campaign</div>
                    <div>Status</div>
                    <div className="text-right">Sent</div>
                    <div className="text-right">Opens</div>
                    <div className="text-right">Clicks</div>
                    <div className="text-right">Date</div>
                    <div></div>
                  </div>

                  {filteredCampaigns.map((campaign: Campaign) => {
                    const openRate = campaign.sentCount ? ((campaign.openedCount || 0) / campaign.sentCount) * 100 : 0;
                    return (
                      <div key={campaign.id} className="grid grid-cols-[2fr_80px_90px_90px_90px_90px_44px] gap-3 px-5 py-3.5 border-b border-gray-50 hover:bg-blue-50/30 items-center transition-colors group">
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
                          <span className="text-xs text-gray-400">{campaign.createdAt ? formatDate(campaign.createdAt) : '-'}</span>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {campaign.status === 'active' && (
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

          {/* Live Tracking */}
          {viewMode === 'dashboard' && currentView === 'tracking' && (
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-gray-200/60">
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-600" /> Recent Activity
                    </h3>
                    <div className="space-y-3">
                      {[
                        { action: 'Email opened', contact: 'john@techcorp.com', time: '2 min ago', icon: Eye, color: 'text-emerald-600 bg-emerald-50' },
                        { action: 'Link clicked', contact: 'jane@startup.io', time: '5 min ago', icon: MousePointerClick, color: 'text-purple-600 bg-purple-50' },
                        { action: 'Email sent', contact: 'mike@enterprise.com', time: '8 min ago', icon: Send, color: 'text-blue-600 bg-blue-50' },
                        { action: 'Reply received', contact: 'sarah@consulting.com', time: '12 min ago', icon: Reply, color: 'text-amber-600 bg-amber-50' },
                        { action: 'Email opened', contact: 'david@agency.co', time: '15 min ago', icon: Eye, color: 'text-emerald-600 bg-emerald-50' },
                      ].map((event, i) => (
                        <div key={i} className="flex items-center gap-3 py-2">
                          <div className={`p-2 rounded-lg ${event.color.split(' ')[1]}`}>
                            <event.icon className={`h-3.5 w-3.5 ${event.color.split(' ')[0]}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900">{event.action}</div>
                            <div className="text-xs text-gray-400">{event.contact}</div>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{event.time}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-gray-200/60">
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" /> Today's Performance
                    </h3>
                    <div className="space-y-5">
                      {[
                        { label: 'Emails Sent', value: 47, max: 100, color: 'bg-blue-500' },
                        { label: 'Opens', value: 32, max: 47, color: 'bg-emerald-500' },
                        { label: 'Clicks', value: 12, max: 47, color: 'bg-purple-500' },
                        { label: 'Replies', value: 5, max: 47, color: 'bg-amber-500' },
                      ].map((item, i) => (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-medium text-gray-600">{item.label}</span>
                            <span className="text-sm font-bold text-gray-900">{item.value}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${(item.value / item.max) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Account */}
          {viewMode === 'dashboard' && currentView === 'account' && (
            <div className="p-6">
              <div className="max-w-2xl space-y-6">
                <Card className="border-gray-200/60 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-16 w-16 border-2 border-white/30">
                        {user?.picture ? <AvatarImage src={user.picture} /> : null}
                        <AvatarFallback className="bg-white/20 text-white text-xl font-bold">
                          {user?.name?.[0] || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h2 className="text-xl font-bold text-white">{user?.name || 'Demo User'}</h2>
                        <p className="text-blue-100 text-sm">{user?.email || 'demo@mailflow.app'}</p>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <div className="divide-y divide-gray-100">
                      {[
                        { label: 'Plan', value: 'MailFlow Pro', extra: <Badge className="bg-blue-50 text-blue-700 border-blue-200 ml-2">Active</Badge> },
                        { label: 'Daily Quota', value: '2,000 emails/day' },
                        { label: 'Provider', value: user?.provider === 'google' ? 'Google' : user?.provider === 'microsoft' ? 'Microsoft' : 'Demo' },
                        { label: 'Member Since', value: 'March 2026' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between py-3.5">
                          <span className="text-sm text-gray-500">{item.label}</span>
                          <span className="text-sm font-semibold text-gray-900 flex items-center">{item.value}{item.extra}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-gray-200/60">
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" className="justify-start h-auto py-3" onClick={() => setCurrentView('setup')}>
                        <Inbox className="h-4 w-4 mr-2 text-blue-600" />
                        <div className="text-left">
                          <div className="text-sm font-medium">Email Accounts</div>
                          <div className="text-xs text-gray-400">Manage SMTP connections</div>
                        </div>
                      </Button>
                      <Button variant="outline" className="justify-start h-auto py-3" onClick={() => setCurrentView('analytics')}>
                        <BarChart3 className="h-4 w-4 mr-2 text-purple-600" />
                        <div className="text-left">
                          <div className="text-sm font-medium">Analytics</div>
                          <div className="text-xs text-gray-400">View performance data</div>
                        </div>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
