import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Plus, Search, Upload, Trash2, Edit, Download,
  Mail, Building, Briefcase, CheckCircle, Loader2, XCircle, Filter
} from "lucide-react";

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

  // Add contact form
  const [formEmail, setFormEmail] = useState('');
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // CSV import
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: formEmail,
          firstName: formFirstName,
          lastName: formLastName,
          company: formCompany,
          jobTitle: formJobTitle,
          tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
          status: 'cold',
        }),
      });
      if (res.ok) {
        setShowAddDialog(false);
        resetForm();
        await fetchContacts();
      } else {
        const err = await res.json();
        setFormError(err.message || 'Failed to add contact');
      }
    } catch (e) { setFormError('Network error'); }
    setFormLoading(false);
  };

  const handleEditContact = async () => {
    if (!editContact) return;
    setFormLoading(true);
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: formFirstName,
          lastName: formLastName,
          company: formCompany,
          jobTitle: formJobTitle,
          tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        setShowEditDialog(false);
        resetForm();
        await fetchContacts();
      }
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
    await fetch('/api/contacts/delete-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ids: selectedIds }),
    });
    setSelectedIds([]);
    await fetchContacts();
  };

  const openEdit = (contact: Contact) => {
    setEditContact(contact);
    setFormEmail(contact.email);
    setFormFirstName(contact.firstName);
    setFormLastName(contact.lastName);
    setFormCompany(contact.company);
    setFormJobTitle(contact.jobTitle);
    setFormTags(contact.tags?.join(', ') || '');
    setShowEditDialog(true);
  };

  const resetForm = () => {
    setFormEmail(''); setFormFirstName(''); setFormLastName('');
    setFormCompany(''); setFormJobTitle(''); setFormTags('');
    setFormError(''); setEditContact(null);
  };

  // CSV Import
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

      // Auto-map common fields
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
      email: row[csvMapping.email] || '',
      firstName: row[csvMapping.firstName] || '',
      lastName: row[csvMapping.lastName] || '',
      company: row[csvMapping.company] || '',
      jobTitle: row[csvMapping.jobTitle] || '',
    })).filter(c => c.email && c.email.includes('@'));

    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contacts }),
      });
      if (res.ok) {
        const result = await res.json();
        setImportResult(result);
        await fetchContacts();
      }
    } catch (e) { setImportResult({ success: false, message: 'Import failed' }); }
    setImportLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hot': return 'bg-red-50 text-red-700 border-red-200';
      case 'warm': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'cold': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'replied': return 'bg-green-50 text-green-700 border-green-200';
      case 'unsubscribed': return 'bg-gray-100 text-gray-600 border-gray-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === contacts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(contacts.map(c => c.id));
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Contacts</h2>
          <p className="text-sm text-gray-500">{total} contacts total</p>
        </div>
        <div className="flex space-x-2">
          {selectedIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600 border-red-200">
              <Trash2 className="h-4 w-4 mr-1" /> Delete ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setImportResult(null); }}>
            <Upload className="h-4 w-4 mr-2" /> Import CSV
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowAddDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Contact
          </Button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center space-x-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
            <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contacts Table */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" /></div>
      ) : contacts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No contacts yet</h3>
            <p className="text-gray-500 mb-4 text-center">Import contacts from a CSV file or add them manually.</p>
            <div className="flex space-x-3">
              <Button variant="outline" onClick={() => setShowImportDialog(true)}>
                <Upload className="h-4 w-4 mr-2" /> Import CSV
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowAddDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Add Contact
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200">
          {/* Table Header */}
          <div className="grid grid-cols-[40px_1fr_1fr_1fr_100px_100px_80px] gap-3 px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-500">
            <div>
              <input
                type="checkbox"
                checked={selectedIds.length === contacts.length && contacts.length > 0}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded"
              />
            </div>
            <div>Name / Email</div>
            <div>Company</div>
            <div>Tags</div>
            <div>Status</div>
            <div>Score</div>
            <div></div>
          </div>

          {/* Table Rows */}
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="grid grid-cols-[40px_1fr_1fr_1fr_100px_100px_80px] gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 items-center text-sm"
            >
              <div>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(contact.id)}
                  onChange={() => toggleSelect(contact.id)}
                  className="h-4 w-4 rounded"
                />
              </div>
              <div>
                <div className="font-medium text-gray-900">{contact.firstName} {contact.lastName}</div>
                <div className="text-xs text-gray-500">{contact.email}</div>
              </div>
              <div className="text-gray-600">
                <div>{contact.company || '-'}</div>
                <div className="text-xs text-gray-400">{contact.jobTitle || ''}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(contact.tags || []).slice(0, 3).map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
              <div>
                <Badge variant="outline" className={getStatusColor(contact.status)}>{contact.status}</Badge>
              </div>
              <div>
                <div className="flex items-center">
                  <div className="w-12 bg-gray-200 rounded-full h-1.5 mr-2">
                    <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${contact.score}%` }} />
                  </div>
                  <span className="text-xs">{contact.score}</span>
                </div>
              </div>
              <div className="flex space-x-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(contact)}>
                  <Edit className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(contact.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Contact Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Email *</Label>
              <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={formFirstName} onChange={(e) => setFormFirstName(e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={formLastName} onChange={(e) => setFormLastName(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Company</Label><Input value={formCompany} onChange={(e) => setFormCompany(e.target.value)} /></div>
              <div><Label>Job Title</Label><Input value={formJobTitle} onChange={(e) => setFormJobTitle(e.target.value)} /></div>
            </div>
            <div><Label>Tags (comma-separated)</Label><Input value={formTags} onChange={(e) => setFormTags(e.target.value)} placeholder="tech, enterprise" /></div>
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAddContact} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Add Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Email</Label><Input value={formEmail} disabled className="bg-gray-50" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={formFirstName} onChange={(e) => setFormFirstName(e.target.value)} /></div>
              <div><Label>Last Name</Label><Input value={formLastName} onChange={(e) => setFormLastName(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Company</Label><Input value={formCompany} onChange={(e) => setFormCompany(e.target.value)} /></div>
              <div><Label>Job Title</Label><Input value={formJobTitle} onChange={(e) => setFormJobTitle(e.target.value)} /></div>
            </div>
            <div><Label>Tags (comma-separated)</Label><Input value={formTags} onChange={(e) => setFormTags(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEditContact} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Contacts from CSV</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* File upload */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 mb-2">Upload a CSV file with your contacts</p>
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                Choose CSV File
              </Button>
              <p className="text-xs text-gray-400 mt-2">Expected columns: email, first_name, last_name, company, job_title</p>
            </div>

            {/* Column mapping */}
            {csvHeaders.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Map CSV columns to contact fields</h4>
                <p className="text-xs text-gray-500">{csvData.length} rows found</p>
                
                {['email', 'firstName', 'lastName', 'company', 'jobTitle'].map((field) => (
                  <div key={field} className="flex items-center space-x-3">
                    <Label className="w-24 text-sm capitalize">{field === 'firstName' ? 'First Name' : field === 'lastName' ? 'Last Name' : field === 'jobTitle' ? 'Job Title' : field}</Label>
                    <Select value={csvMapping[field] || ''} onValueChange={(v) => setCsvMapping(prev => ({ ...prev, [field]: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- Skip --</SelectItem>
                        {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}

                {/* Preview */}
                {csvData.length > 0 && (
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <h5 className="text-xs font-medium text-gray-600 mb-2">Preview (first 3 rows)</h5>
                    {csvData.slice(0, 3).map((row, i) => (
                      <div key={i} className="text-xs text-gray-700 mb-1">
                        {csvMapping.email && row[csvMapping.email]} {csvMapping.firstName && `• ${row[csvMapping.firstName]}`} {csvMapping.company && `• ${row[csvMapping.company]}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Import result */}
            {importResult && (
              <Alert className={importResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                {importResult.success ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                <AlertDescription>
                  {importResult.message || `Imported ${importResult.imported} contacts, ${importResult.skipped} skipped`}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              {importResult ? 'Done' : 'Cancel'}
            </Button>
            {!importResult && csvData.length > 0 && (
              <Button onClick={handleImportCSV} disabled={importLoading || !csvMapping.email} className="bg-blue-600 hover:bg-blue-700">
                {importLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                Import {csvData.length} Contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
