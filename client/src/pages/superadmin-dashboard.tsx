import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, Users, Building2, BarChart3, Mail, Activity, Search,
  MoreVertical, UserCheck, UserX, ShieldCheck, ShieldOff, Eye,
  Trash2, AlertTriangle, TrendingUp, ArrowUpRight, Globe, Clock,
  Send, MousePointerClick, Reply, FileText, Crown, RefreshCw,
  ChevronLeft, ChevronRight
} from "lucide-react";

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [userSearch, setUserSearch] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [userPage, setUserPage] = useState(0);
  const [orgPage, setOrgPage] = useState(0);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'user' | 'org'; id: string; name: string } | null>(null);
  const pageSize = 20;

  // Fetch platform stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/superadmin/stats'],
    queryFn: async () => {
      const res = await fetch('/api/superadmin/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch users
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['/api/superadmin/users', userSearch, userPage],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(userPage * pageSize) });
      if (userSearch) params.set('search', userSearch);
      const res = await fetch(`/api/superadmin/users?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch organizations
  const { data: orgsData, isLoading: orgsLoading } = useQuery({
    queryKey: ['/api/superadmin/organizations', orgSearch, orgPage],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(orgPage * pageSize) });
      if (orgSearch) params.set('search', orgSearch);
      const res = await fetch(`/api/superadmin/organizations?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Toggle user active
  const toggleUserActive = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/superadmin/users/${userId}/toggle-active`, {
        method: 'PUT', credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/stats'] });
      toast({ title: "User status updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Toggle superadmin
  const toggleSuperAdmin = useMutation({
    mutationFn: async ({ userId, isSuperAdmin }: { userId: string; isSuperAdmin: boolean }) => {
      const res = await fetch(`/api/superadmin/users/${userId}/superadmin`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuperAdmin }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/stats'] });
      toast({ title: "SuperAdmin status updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Delete org
  const deleteOrg = useMutation({
    mutationFn: async (orgId: string) => {
      const res = await fetch(`/api/superadmin/organizations/${orgId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/organizations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/superadmin/stats'] });
      setDeleteTarget(null);
      toast({ title: "Organization deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Impersonate user
  const impersonate = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/superadmin/impersonate/${userId}`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.message); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Impersonating user", description: `Viewing as ${data.user.email} in ${data.organization.name}` });
      setTimeout(() => window.location.reload(), 1000);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n || 0);
  };

  const formatDate = (d: string) => {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SuperAdmin Console</h1>
            <p className="text-sm text-gray-500">Platform-wide management and monitoring</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          queryClient.invalidateQueries({ queryKey: ['/api/superadmin'] });
        }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="organizations" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Organizations
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Users
          </TabsTrigger>
        </TabsList>

        {/* ========== OVERVIEW TAB ========== */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Users', value: stats?.totalUsers, icon: Users, color: 'blue', sub: `${stats?.recentUsers || 0} new this week` },
              { label: 'Organizations', value: stats?.totalOrgs, icon: Building2, color: 'purple', sub: `${stats?.activeUsers || 0} active users` },
              { label: 'Emails Sent', value: stats?.totalEmailsSent, icon: Send, color: 'emerald', sub: `${stats?.recentEmails || 0} this week` },
              { label: 'Campaigns', value: stats?.totalCampaigns, icon: Mail, color: 'amber', sub: `${stats?.activeCampaigns || 0} active` },
            ].map(({ label, value, icon: Icon, color, sub }) => (
              <Card key={label} className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-4 px-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`h-9 w-9 rounded-lg bg-${color}-50 flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 text-${color}-600`} />
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-gray-300" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{formatNumber(value || 0)}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Engagement Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Opens', value: stats?.totalOpens, icon: Eye, color: 'text-sky-600 bg-sky-50' },
              { label: 'Clicks', value: stats?.totalClicks, icon: MousePointerClick, color: 'text-violet-600 bg-violet-50' },
              { label: 'Replies', value: stats?.totalReplies, icon: Reply, color: 'text-green-600 bg-green-50' },
              { label: 'Templates', value: stats?.totalTemplates, icon: FileText, color: 'text-orange-600 bg-orange-50' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="border-0 shadow-sm">
                <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${color.split(' ')[1]} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`h-5 w-5 ${color.split(' ')[0]}`} />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-gray-900">{formatNumber(value || 0)}</div>
                    <div className="text-xs text-gray-500">{label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Top Organizations */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                Top Organizations by Email Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead className="text-right">Emails Sent</TableHead>
                    <TableHead className="text-right">Contacts</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(stats?.topOrgs || []).map((org: any) => (
                    <TableRow key={org.id} className="cursor-pointer hover:bg-gray-50" onClick={() => { setSelectedOrg(org); setActiveTab('organizations'); }}>
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell className="text-gray-500">{org.domain || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(org.emailsSent)}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(org.contacts)}</TableCell>
                      <TableCell className="text-right font-mono">{org.members}</TableCell>
                    </TableRow>
                  ))}
                  {(!stats?.topOrgs || stats.topOrgs.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-gray-400 py-8">No organizations yet</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Platform Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-red-500" />
                  Platform Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">SuperAdmins</span><span className="font-medium">{stats?.superAdmins || 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Email Accounts</span><span className="font-medium">{stats?.totalEmailAccounts || 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Active Campaigns</span><span className="font-medium">{stats?.activeCampaigns || 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Contacts</span><span className="font-medium">{formatNumber(stats?.totalContacts || 0)}</span></div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  This Week
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">New Users</span><Badge variant="outline" className="bg-blue-50 text-blue-700">{stats?.recentUsers || 0}</Badge></div>
                <div className="flex justify-between"><span className="text-gray-500">New Campaigns</span><Badge variant="outline" className="bg-purple-50 text-purple-700">{stats?.recentCampaigns || 0}</Badge></div>
                <div className="flex justify-between"><span className="text-gray-500">Emails Sent</span><Badge variant="outline" className="bg-emerald-50 text-emerald-700">{formatNumber(stats?.recentEmails || 0)}</Badge></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========== ORGANIZATIONS TAB ========== */}
        <TabsContent value="organizations" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search organizations by name or domain..."
                className="pl-9"
                value={orgSearch}
                onChange={(e) => { setOrgSearch(e.target.value); setOrgPage(0); }}
              />
            </div>
            <Badge variant="outline" className="text-gray-500">{orgsData?.total || 0} total</Badge>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead className="text-center">Members</TableHead>
                    <TableHead className="text-center">Campaigns</TableHead>
                    <TableHead className="text-center">Contacts</TableHead>
                    <TableHead className="text-center">Email Accts</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(orgsData?.organizations || []).map((org: any) => (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{org.domain || '-'}</TableCell>
                      <TableCell className="text-center">{org.memberCount || 0}</TableCell>
                      <TableCell className="text-center">{org.campaignCount || 0}</TableCell>
                      <TableCell className="text-center">{formatNumber(org.contactCount || 0)}</TableCell>
                      <TableCell className="text-center">{org.emailAccountCount || 0}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={org.activeCampaigns > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'}>
                          {org.activeCampaigns || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm text-gray-500">{formatDate(org.createdAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedOrg(org)}>
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => setDeleteTarget({ type: 'org', id: org.id, name: org.name })}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete Organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!orgsData?.organizations || orgsData.organizations.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-8">No organizations found</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {orgsData && orgsData.total > pageSize && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Showing {orgPage * pageSize + 1}-{Math.min((orgPage + 1) * pageSize, orgsData.total)} of {orgsData.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={orgPage === 0} onClick={() => setOrgPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button variant="outline" size="sm" disabled={(orgPage + 1) * pageSize >= orgsData.total} onClick={() => setOrgPage(p => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ========== USERS TAB ========== */}
        <TabsContent value="users" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search users by email or name..."
                className="pl-9"
                value={userSearch}
                onChange={(e) => { setUserSearch(e.target.value); setUserPage(0); }}
              />
            </div>
            <Badge variant="outline" className="text-gray-500">{usersData?.total || 0} total</Badge>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Organizations</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Role</TableHead>
                    <TableHead className="text-right">Joined</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(usersData?.users || []).map((user: any) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                            {(user.firstName || user.email)?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-sm">
                              {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unknown'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">{user.email}</TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-500 max-w-[200px] truncate" title={user.orgNames}>
                          {user.orgNames || 'None'}
                        </div>
                        <div className="text-xs text-gray-400">{user.orgCount || 0} org(s)</div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {user.isSuperAdmin ? (
                          <Badge className="bg-gradient-to-r from-red-500 to-orange-500 text-white border-0">
                            <Crown className="h-3 w-3 mr-1" /> SuperAdmin
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">{user.role}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-gray-500">{formatDate(user.createdAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => impersonate.mutate(user.id)}>
                              <Eye className="h-4 w-4 mr-2" /> Impersonate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleUserActive.mutate(user.id)}>
                              {user.isActive ? (
                                <><UserX className="h-4 w-4 mr-2" /> Disable User</>
                              ) : (
                                <><UserCheck className="h-4 w-4 mr-2" /> Enable User</>
                              )}
                            </DropdownMenuItem>
                            {user.isSuperAdmin ? (
                              <DropdownMenuItem onClick={() => toggleSuperAdmin.mutate({ userId: user.id, isSuperAdmin: false })}>
                                <ShieldOff className="h-4 w-4 mr-2" /> Remove SuperAdmin
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => toggleSuperAdmin.mutate({ userId: user.id, isSuperAdmin: true })}>
                                <ShieldCheck className="h-4 w-4 mr-2" /> Make SuperAdmin
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!usersData?.users || usersData.users.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-gray-400 py-8">No users found</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {usersData && usersData.total > pageSize && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Showing {userPage * pageSize + 1}-{Math.min((userPage + 1) * pageSize, usersData.total)} of {usersData.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={userPage === 0} onClick={() => setUserPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button variant="outline" size="sm" disabled={(userPage + 1) * pageSize >= usersData.total} onClick={() => setUserPage(p => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === 'org' ? (
                <>
                  This will permanently delete the organization <strong>{deleteTarget?.name}</strong> and ALL of its data:
                  campaigns, contacts, templates, email accounts, tracking events, and member associations.
                  <br /><br />
                  <strong className="text-red-600">This action cannot be undone.</strong>
                </>
              ) : (
                <>
                  Are you sure you want to delete user <strong>{deleteTarget?.name}</strong>?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget?.type === 'org') deleteOrg.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Org Details Dialog */}
      <Dialog open={!!selectedOrg} onOpenChange={() => setSelectedOrg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-purple-600" />
              {selectedOrg?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedOrg?.domain || 'No domain'} &middot; Created {formatDate(selectedOrg?.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><span className="text-gray-500">Members</span><div className="text-lg font-bold">{selectedOrg?.memberCount || 0}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><span className="text-gray-500">Campaigns</span><div className="text-lg font-bold">{selectedOrg?.campaignCount || 0}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><span className="text-gray-500">Contacts</span><div className="text-lg font-bold">{formatNumber(selectedOrg?.contactCount || 0)}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><span className="text-gray-500">Email Accounts</span><div className="text-lg font-bold">{selectedOrg?.emailAccountCount || 0}</div></div>
          </div>
          <div className="text-xs text-gray-400">ID: {selectedOrg?.id}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
