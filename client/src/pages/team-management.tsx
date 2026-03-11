import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { 
  Users, Plus, Crown, Shield, Eye, UserMinus, 
  Mail, Clock, Building2, CheckCircle, XCircle,
  AlertTriangle, RefreshCw, Copy, UserPlus
} from "lucide-react";

interface OrgMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  isDefault: number;
  joinedAt: string;
  invitedBy: string | null;
  email: string;
  firstName: string;
  lastName: string;
  userActive: number;
}

interface OrgInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  invitedBy: string;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface Organization {
  id: string;
  name: string;
  domain: string;
  memberCount: number;
  userRole: string;
}

interface PendingInvite {
  id: string;
  organizationId: string;
  orgName: string;
  email: string;
  role: string;
  token: string;
  createdAt: string;
}

const roleConfig: Record<string, { label: string; icon: any; color: string; description: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-amber-100 text-amber-800', description: 'Full control, billing, and ownership' },
  admin: { label: 'Admin', icon: Shield, color: 'bg-blue-100 text-blue-800', description: 'Manage team, settings, and campaigns' },
  member: { label: 'Member', icon: Users, color: 'bg-green-100 text-green-800', description: 'Create and manage campaigns' },
  viewer: { label: 'Viewer', icon: Eye, color: 'bg-gray-100 text-gray-800', description: 'View-only access' },
};

export default function TeamManagement() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showOrgEditDialog, setShowOrgEditDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [orgName, setOrgName] = useState('');
  const [orgDomain, setOrgDomain] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [orgRes, membersRes, invitesRes, pendingRes] = await Promise.all([
        fetch('/api/organizations/current', { credentials: 'include' }),
        fetch('/api/team/members', { credentials: 'include' }),
        fetch('/api/invitations', { credentials: 'include' }),
        fetch('/api/invitations/pending', { credentials: 'include' }),
      ]);
      
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrg(orgData);
        setOrgName(orgData.name);
        setOrgDomain(orgData.domain || '');
      }
      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvitations(await invitesRes.json());
      if (pendingRes.ok) setPendingInvites(await pendingRes.json());
    } catch (e) {
      console.error('Failed to fetch team data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setError('');
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.emailSent) {
          setSuccess(`Invitation email sent to ${inviteEmail}`);
        } else {
          setSuccess(`Invitation created for ${inviteEmail}. ${data.emailError || 'Email notification could not be sent — share the invite link manually.'}`);
        }
        setInviteEmail('');
        setShowInviteDialog(false);
        fetchData();
        setTimeout(() => setSuccess(''), 6000);
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to send invitation');
      }
    } catch (e) {
      setError('Failed to send invitation');
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/team/members/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        fetchData();
        setSuccess('Role updated successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to update role');
        setTimeout(() => setError(''), 3000);
      }
    } catch (e) {
      setError('Failed to update role');
    }
  };

  const handleRemoveMember = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this organization?`)) return;
    try {
      const res = await fetch(`/api/team/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchData();
        setSuccess('Member removed');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to remove member');
        setTimeout(() => setError(''), 3000);
      }
    } catch (e) {
      setError('Failed to remove member');
    }
  };

  const handleCancelInvitation = async (id: string) => {
    try {
      const res = await fetch(`/api/invitations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchData();
        setSuccess('Invitation cancelled');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (e) {
      setError('Failed to cancel invitation');
    }
  };

  const handleAcceptInvite = async (token: string) => {
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to accept invitation');
      }
    } catch (e) {
      setError('Failed to accept invitation');
    }
  };

  const handleUpdateOrg = async () => {
    try {
      const res = await fetch('/api/organizations/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: orgName, domain: orgDomain }),
      });
      if (res.ok) {
        setShowOrgEditDialog(false);
        fetchData();
        setSuccess('Organization updated');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (e) {
      setError('Failed to update organization');
    }
  };

  const isAdmin = org?.userRole === 'owner' || org?.userRole === 'admin';

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700">
          <CheckCircle className="h-4 w-4" />
          {success}
        </div>
      )}

      {/* Pending Invitations for Current User */}
      {pendingInvites.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              You have pending invitations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between bg-white rounded-lg p-3 border">
                  <div>
                    <span className="font-medium">{invite.orgName}</span>
                    <span className="text-sm text-gray-500 ml-2">as {roleConfig[invite.role]?.label || invite.role}</span>
                  </div>
                  <Button size="sm" onClick={() => handleAcceptInvite(invite.token)}>
                    Accept
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Organization Info */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organization
            </CardTitle>
            {isAdmin && (
              <Dialog open={showOrgEditDialog} onOpenChange={setShowOrgEditDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">Edit</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Organization</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Organization Name</Label>
                      <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="My Organization" />
                    </div>
                    <div>
                      <Label>Domain</Label>
                      <Input value={orgDomain} onChange={e => setOrgDomain(e.target.value)} placeholder="example.com" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowOrgEditDialog(false)}>Cancel</Button>
                    <Button onClick={handleUpdateOrg}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Name</p>
              <p className="font-medium">{org?.name || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Domain</p>
              <p className="font-medium">{org?.domain || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Members</p>
              <p className="font-medium">{members.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Your Role</p>
              <Badge className={roleConfig[org?.userRole || 'member']?.color}>
                {roleConfig[org?.userRole || 'member']?.label}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members
              <Badge variant="secondary">{members.length}</Badge>
            </CardTitle>
            {isAdmin && (
              <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1">
                    <UserPlus className="h-4 w-4" />
                    Invite Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite Team Member</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Email Address</Label>
                      <Input 
                        type="email" 
                        value={inviteEmail} 
                        onChange={e => setInviteEmail(e.target.value)} 
                        placeholder="colleague@company.com"
                      />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin - Manage team & settings</SelectItem>
                          <SelectItem value="member">Member - Create & manage campaigns</SelectItem>
                          <SelectItem value="viewer">Viewer - View-only access</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setShowInviteDialog(false); setError(''); }}>Cancel</Button>
                    <Button onClick={handleInvite} disabled={!inviteEmail}>Send Invitation</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.map((member) => {
              const config = roleConfig[member.role] || roleConfig.member;
              const RoleIcon = config.icon;
              const initials = `${(member.firstName || '?')[0]}${(member.lastName || '?')[0]}`.toUpperCase();
              
              return (
                <div key={member.userId} className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-medium">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {member.firstName} {member.lastName}
                        </p>
                        <Badge className={config.color} variant="secondary">
                          <RoleIcon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{member.email}</p>
                    </div>
                  </div>
                  
                  {isAdmin && member.userId !== members.find(m => m.role === 'owner' && members.filter(x => x.role === 'owner').length === 1)?.userId && (
                    <div className="flex items-center gap-2">
                      <Select 
                        value={member.role} 
                        onValueChange={(value) => handleUpdateRole(member.userId, value)}
                      >
                        <SelectTrigger className="w-32 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {org?.userRole === 'owner' && <SelectItem value="owner">Owner</SelectItem>}
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                        onClick={() => handleRemoveMember(member.userId, member.email)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Pending Invitations
              <Badge variant="secondary">{invitations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3 px-4 rounded-lg bg-amber-50/50 border border-amber-100">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{inv.email}</p>
                      <p className="text-sm text-gray-500">
                        Invited as {roleConfig[inv.role]?.label || inv.role} &middot; Expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleCancelInvitation(inv.id)}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Roles Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(roleConfig).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <div key={key} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={config.color}>
                      <Icon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600">{config.description}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
