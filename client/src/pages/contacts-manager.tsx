import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users, Plus, Search, Upload, Trash2, Edit, Download,
  Mail, Building, Briefcase, CheckCircle, Loader2, XCircle, Filter, UserPlus,
  MoreHorizontal, Star, TrendingUp, ArrowUpDown, FileSpreadsheet
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Contact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  status: string;
  score: number;
  tags: string[];
  source: string;
  createdAt: string;
}

export default function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formEmail, setFormEmail] = useState('');
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => { fetchContacts(); }, [search, statusFilter]);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/contacts?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || data);
        setTotal(data.total || (data.contacts || data).length);
      }
    } catch (e) { console.error('Failed to fetch contacts:', e); }
    setLoading(false);
  };

  const handleAddContact = async () => {
    setFormError('');
    if (!formEmail) { setFormError('Email is required'); return; }
    setFormLoading(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ email: formEmail, firstName: formFirstName, lastName: formLastName, company: formCompany, jobTitle: formJobTitle, tags: formTags.split(',').map(t => t.trim()).filter(Boolean), status: 'cold' }),
      });
      if (res.ok) { setShowAddDialog(false); resetForm(); await fetchContacts(); }
      else { const err = await res.json(); setFormError(err.message || 'Failed to add contact'); }
    } catch (e) { setFormError('Network error'); }
    setFormLoading(false);
  };

  const handleEditContact = async () => {
    if (!editContact) return;
    setFormLoading(true);
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ firstName: formFirstName, lastName: formLastName, company: formCompany, jobTitle: formJobTitle, tags: formTags.split(',').map(t => t.trim()).filter(Boolean) }),
      });
      if (res.ok) { setShowEditDialog(false); resetForm(); await fetchContacts(); }
    } catch (e) { /* ignore */ }
    setFormLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    await fetch(`/api/contacts/${id}`, { method: 'DELETE', credentials: 'include' });
    await fetchContacts();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} contacts?`)) return;
    await fetch('/api/contacts/delete-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ids: selectedIds }) });
    setSelectedIds([]);
    await fetchContacts();
  };

  const openEdit = (contact: Contact) => {
    setEditContact(contact); setFormEmail(contact.email); setFormFirstName(contact.firstName);
    setFormLastName(contact.lastName); setFormCompany(contact.company);
    setFormJobTitle(contact.jobTitle); setFormTags(contact.tags?.join(', ') || '');
    setShowEditDialog(true);
  };

  const resetForm = () => {
    setFormEmail(''); setFormFirstName(''); setFormLastName('');
    setFormCompany(''); setFormJobTitle(''); setFormTags('');
    setFormError(''); setEditContact(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = values[i] || ''; });
        return row;
      });
      setCsvHeaders(headers);
      setCsvData(rows);
      const mapping: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase();
        if (lower.includes('email')) mapping.email = h;
        else if (lower.includes('first') && lower.includes('name')) mapping.firstName = h;
        else if (lower.includes('last') && lower.includes('name')) mapping.lastName = h;
        else if (lower === 'name' || lower === 'full name') mapping.firstName = h;
        else if (lower.includes('company') || lower.includes('organization')) mapping.company = h;
        else if (lower.includes('title') || lower.includes('position')) mapping.jobTitle = h;
      });
      setCsvMapping(mapping);
    };
    reader.readAsText(file);
  };

  const handleImportCSV = async () => {
    if (csvData.length === 0 || !csvMapping.email) return;
    setImportLoading(true);
    setImportResult(null);
    const contacts = csvData.map(row => ({
      email: row[csvMapping.email] || '', firstName: row[csvMapping.firstName] || '',
      lastName: row[csvMapping.lastName] || '', company: row[csvMapping.company] || '',
      jobTitle: row[csvMapping.jobTitle] || '',
    })).filter(c => c.email && c.email.includes('@'));
    try {
      const res = await fetch('/api/contacts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ contacts }) });
      if (res.ok) { const result = await res.json(); setImportResult(result); await fetchContacts(); }
    } catch (e) { setImportResult({ success: false, message: 'Import failed' }); }
    setImportLoading(false);
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; dot: string; label: string }> = {
      hot: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Hot' },
      warm: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', label: 'Warm' },
      cold: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Cold' },
      replied: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Replied' },
      unsubscribed: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: 'Unsubscribed' },
    };
    return configs[status] || configs.cold;
  };

  const getInitials = (first: string, last: string) => {
    return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      'from-blue-400 to-blue-600', 'from-purple-400 to-purple-600', 'from-emerald-400 to-emerald-600',
      'from-amber-400 to-amber-600', 'from-pink-400 to-pink-600', 'from-cyan-400 to-cyan-600',
      'from-indigo-400 to-indigo-600', 'from-rose-400 to-rose-600'
    ];
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-blue-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-gray-300';
  };

  const toggleSelect = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const toggleSelectAll = () => { setSelectedIds(selectedIds.length === contacts.length ? [] : contacts.map(c => c.id)); };

  const statusCounts = {
    all: total,
    cold: contacts.filter(c => c.status === 'cold').length,
    warm: contacts.filter(c => c.status === 'warm').length,
    hot: contacts.filter(c => c.status === 'hot').length,
    replied: contacts.filter(c => c.status === 'replied').length,
  };

  return (
    <div className="p-6 space-y-5">
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Contacts', value: total, icon: Users, bg: 'bg-blue-50', text: 'text-blue-600' },
          { label: 'Hot Leads', value: statusCounts.hot, icon: TrendingUp, bg: 'bg-red-50', text: 'text-red-600' },
          { label: 'Warm Leads', value: statusCounts.warm, icon: Star, bg: 'bg-orange-50', text: 'text-orange-600' },
          { label: 'Replied', value: statusCounts.replied, icon: Mail, bg: 'bg-emerald-50', text: 'text-emerald-600' },
        ].map((stat) => (
          <Card key={stat.label} className="border-gray-200/60 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.text}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-[11px] text-gray-400 font-medium">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input 
              placeholder="Search contacts..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="pl-9 h-9 text-sm bg-white border-gray-200 focus:border-blue-300 focus:ring-blue-200" 
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-0.5 bg-gray-100/80 rounded-lg p-0.5">
            {(['all', 'cold', 'warm', 'hot', 'replied'] as const).map((status) => {
              const sc = status !== 'all' ? getStatusConfig(status) : null;
              return (
                <button key={status} onClick={() => setStatusFilter(status)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    statusFilter === status ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {sc && <div className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />}
                  <span className="capitalize">{status}</span>
                  <span className={`text-[10px] ${statusFilter === status ? 'text-gray-400' : 'text-gray-300'}`}>
                    {(statusCounts as any)[status] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setImportResult(null); }}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import
          </Button>
          <Button size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50" onClick={() => { resetForm(); setShowAddDialog(true); }}>
            <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add Contact
          </Button>
        </div>
      </div>

      {/* Contact Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading contacts...</span>
          </div>
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
            <Users className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1.5">No contacts yet</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">Import your contacts from a CSV file or add them manually to get started</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowImportDialog(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Import CSV
            </Button>
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" onClick={() => { resetForm(); setShowAddDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Contact
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[40px_1fr_1fr_130px_90px_80px_48px] gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
            <div className="flex items-center">
              <input type="checkbox" checked={selectedIds.length === contacts.length && contacts.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Contact</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Company</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tags</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Status</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-center">Score</div>
            <div></div>
          </div>

          {/* Table Body */}
          {contacts.map((contact) => {
            const sc = getStatusConfig(contact.status);
            const isSelected = selectedIds.includes(contact.id);
            return (
              <div 
                key={contact.id} 
                className={`grid grid-cols-[40px_1fr_1fr_130px_90px_80px_48px] gap-3 px-4 py-3 border-b border-gray-50 items-center transition-all group ${
                  isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50/80'
                }`}
              >
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    checked={isSelected} 
                    onChange={() => toggleSelect(contact.id)} 
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                  />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9 flex-shrink-0 shadow-sm">
                    <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(contact.email)} text-white text-[11px] font-semibold`}>
                      {getInitials(contact.firstName, contact.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{contact.firstName} {contact.lastName}</div>
                    <div className="text-xs text-gray-400 truncate flex items-center gap-1">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      {contact.email}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  {contact.company ? (
                    <>
                      <div className="text-sm text-gray-700 truncate flex items-center gap-1.5">
                        <Building className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        {contact.company}
                      </div>
                      {contact.jobTitle && (
                        <div className="text-xs text-gray-400 truncate ml-4.5">{contact.jobTitle}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-300">--</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(contact.tags || []).slice(0, 2).map((tag, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">{tag}</span>
                  ))}
                  {(contact.tags || []).length > 2 && (
                    <span className="text-[10px] text-gray-300 px-1">+{contact.tags.length - 2}</span>
                  )}
                </div>
                <div>
                  <Badge variant="outline" className={`text-[10px] font-semibold capitalize ${sc.bg} ${sc.text} border-0 shadow-none`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${sc.dot} mr-1`} />
                    {contact.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-10 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${getScoreColor(contact.score)}`} style={{ width: `${contact.score}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 w-5 text-right">{contact.score}</span>
                  </div>
                </div>
                <div className="flex justify-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => openEdit(contact)}>
                        <Edit className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleDelete(contact.id)} className="text-red-600">
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}

          {/* Table Footer */}
          <div className="px-4 py-3 bg-gray-50/40 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Showing {contacts.length} of {total} contacts
                {selectedIds.length > 0 && <span className="text-blue-600 font-medium ml-2">({selectedIds.length} selected)</span>}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Add Contact Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <UserPlus className="h-4 w-4 text-blue-600" />
              </div>
              Add New Contact
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Add a new contact to your database
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Address *</Label>
              <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="john@example.com" className="mt-1.5 h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">First Name</Label>
                <Input value={formFirstName} onChange={(e) => setFormFirstName(e.target.value)} placeholder="John" className="mt-1.5 h-10" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Last Name</Label>
                <Input value={formLastName} onChange={(e) => setFormLastName(e.target.value)} placeholder="Doe" className="mt-1.5 h-10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Company</Label>
                <Input value={formCompany} onChange={(e) => setFormCompany(e.target.value)} placeholder="Acme Inc." className="mt-1.5 h-10" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Job Title</Label>
                <Input value={formJobTitle} onChange={(e) => setFormJobTitle(e.target.value)} placeholder="Marketing Manager" className="mt-1.5 h-10" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags</Label>
              <Input value={formTags} onChange={(e) => setFormTags(e.target.value)} placeholder="enterprise, tech (comma-separated)" className="mt-1.5 h-10" />
            </div>
            {formError && (
              <Alert variant="destructive" className="py-2">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{formError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAddContact} disabled={formLoading} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <UserPlus className="h-4 w-4 mr-1.5" />} Add Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Edit className="h-4 w-4 text-blue-600" />
              </div>
              Edit Contact
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Update contact information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email</Label>
              <Input value={formEmail} disabled className="bg-gray-50 mt-1.5 h-10 text-gray-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">First Name</Label>
                <Input value={formFirstName} onChange={(e) => setFormFirstName(e.target.value)} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Last Name</Label>
                <Input value={formLastName} onChange={(e) => setFormLastName(e.target.value)} className="mt-1.5 h-10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Company</Label>
                <Input value={formCompany} onChange={(e) => setFormCompany(e.target.value)} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Job Title</Label>
                <Input value={formJobTitle} onChange={(e) => setFormJobTitle(e.target.value)} className="mt-1.5 h-10" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags</Label>
              <Input value={formTags} onChange={(e) => setFormTags(e.target.value)} className="mt-1.5 h-10" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEditContact} disabled={formLoading} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-emerald-50 p-2 rounded-lg">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              </div>
              Import Contacts
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Upload a CSV file to bulk import contacts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div 
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-gradient-to-br from-gray-50/50 to-white hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer group" 
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="bg-blue-50 w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <Upload className="h-6 w-6 text-blue-500" />
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV file here or click to browse</p>
              <p className="text-xs text-gray-400">Supports: email, first_name, last_name, company, job_title columns</p>
              <input type="file" ref={fileInputRef} accept=".csv" onChange={handleFileUpload} className="hidden" />
            </div>

            {csvHeaders.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Map Columns</h4>
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200">{csvData.length} rows found</Badge>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2.5">
                  {['email', 'firstName', 'lastName', 'company', 'jobTitle'].map((field) => (
                    <div key={field} className="flex items-center gap-3">
                      <Label className="w-24 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {field === 'firstName' ? 'First Name' : field === 'lastName' ? 'Last Name' : field === 'jobTitle' ? 'Job Title' : field}
                        {field === 'email' && <span className="text-red-500 ml-0.5">*</span>}
                      </Label>
                      <Select value={csvMapping[field] || ''} onValueChange={(v) => setCsvMapping(prev => ({ ...prev, [field]: v }))}>
                        <SelectTrigger className="h-8 text-sm bg-white"><SelectValue placeholder="Select column" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">-- Skip --</SelectItem>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {csvData.length > 0 && (
                  <div className="border rounded-lg p-3 bg-white">
                    <div className="text-[10px] font-semibold uppercase text-gray-400 mb-2">Preview (first 3 rows)</div>
                    <div className="space-y-1">
                      {csvData.slice(0, 3).map((row, i) => (
                        <div key={i} className="text-xs text-gray-600 flex items-center gap-2">
                          <span className="text-gray-300 w-4">{i+1}.</span>
                          <span className="font-medium">{csvMapping.email && row[csvMapping.email]}</span>
                          {csvMapping.firstName && <span className="text-gray-400">| {row[csvMapping.firstName]}</span>}
                          {csvMapping.lastName && <span className="text-gray-400">{row[csvMapping.lastName]}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {importResult && (
              <Alert className={`${importResult.success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                {importResult.success ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                <AlertDescription className="text-sm">
                  {importResult.message || `Imported ${importResult.imported} contacts, ${importResult.skipped} skipped`}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>{importResult ? 'Done' : 'Cancel'}</Button>
            {!importResult && csvData.length > 0 && (
              <Button onClick={handleImportCSV} disabled={importLoading || !csvMapping.email} className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800">
                {importLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Import {csvData.length} Contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
