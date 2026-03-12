import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Mail, Building, Briefcase, CheckCircle, Loader2, XCircle, Filter, UserPlus, UserMinus, UserCheck,
  MoreHorizontal, Star, TrendingUp, ArrowUpDown, FileSpreadsheet, List, FolderOpen, X, Eye, Tag,
  AlertTriangle, Ban, Link2, Sheet, Pencil, ExternalLink, ShieldX, ListX, LayoutList,
  Copy, ArrowRight, ChevronDown, Info, Sparkles, RefreshCw,
  Phone, Globe, MapPin, Linkedin, DollarSign, Hash, Calendar, Factory,
  Zap, BarChart3, Flame
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  listId?: string;
  customFields?: Record<string, any>;
  createdAt: string;
  // Apollo.io enriched fields
  phone?: string;
  mobilePhone?: string;
  linkedinUrl?: string;
  seniority?: string;
  department?: string;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  industry?: string;
  employeeCount?: string;
  annualRevenue?: string;
  companyLinkedinUrl?: string;
  companyCity?: string;
  companyState?: string;
  companyCountry?: string;
  companyAddress?: string;
  companyPhone?: string;
  secondaryEmail?: string;
  homePhone?: string;
  emailStatus?: string;
  lastActivityDate?: string;
  // Assignment
  assignedTo?: string;
  // Email rating
  emailRating?: number;
  emailRatingGrade?: string;
  emailRatingDetails?: any;
  emailRatingUpdatedAt?: string;
}

interface ContactList {
  id: string;
  name: string;
  source: string;
  headers: string[];
  contactCount: number;
  createdAt: string;
}

type TabType = 'all' | 'unsubscribers' | 'blocklist' | 'lists';

export default function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showContactDetail, setShowContactDetail] = useState(false);
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email rating state
  const [ratingLoading, setRatingLoading] = useState<string | null>(null); // contactId or 'batch'
  const [batchRatingProgress, setBatchRatingProgress] = useState<{ processed: number; total: number } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<TabType>('all');

  // Contact lists
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);

  // Form state
  const [formEmail, setFormEmail] = useState('');
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // CSV import state
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [importLoading, setImportLoading] = useState(false);
  const [importListName, setImportListName] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importToExistingList, setImportToExistingList] = useState<string>('');
  const [aiMappingLoading, setAiMappingLoading] = useState(false);
  const [aiMappingError, setAiMappingError] = useState('');
  const [showAllFields, setShowAllFields] = useState(false);

  // Lead assignment state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTargetUserId, setAssignTargetUserId] = useState('');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [userRole, setUserRole] = useState('admin');
  const [assignFilterUserId, setAssignFilterUserId] = useState('');
  const [assignmentStats, setAssignmentStats] = useState<any>(null);

  // Create list dialog state
  const [showCreateListDialog, setShowCreateListDialog] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');
  const [createListLoading, setCreateListLoading] = useState(false);

  // Rename list dialog
  const [showRenameListDialog, setShowRenameListDialog] = useState(false);
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameListValue, setRenameListValue] = useState('');

  // Google Sheets import state
  const [showGoogleSheetsDialog, setShowGoogleSheetsDialog] = useState(false);
  const [gsUrl, setGsUrl] = useState('');
  const [gsSheets, setGsSheets] = useState<any[]>([]);
  const [gsSelectedSheet, setGsSelectedSheet] = useState<any>(null);
  const [gsData, setGsData] = useState<any[]>([]);
  const [gsHeaders, setGsHeaders] = useState<string[]>([]);
  const [gsMapping, setGsMapping] = useState<Record<string, string>>({});
  const [gsLoading, setGsLoading] = useState(false);
  const [gsDataLoading, setGsDataLoading] = useState(false);
  const [gsImportLoading, setGsImportLoading] = useState(false);
  const [gsListName, setGsListName] = useState('');
  const [gsSheetTitle, setGsSheetTitle] = useState('');
  const [gsError, setGsError] = useState('');
  const [gsImportResult, setGsImportResult] = useState<any>(null);
  const [gsToExistingList, setGsToExistingList] = useState<string>('');

  // Quick Send Email state
  const [showSendEmailDialog, setShowSendEmailDialog] = useState(false);
  const [sendEmailAccountId, setSendEmailAccountId] = useState('');
  const [sendEmailSubject, setSendEmailSubject] = useState('');
  const [sendEmailContent, setSendEmailContent] = useState('');
  const [sendEmailAccounts, setSendEmailAccounts] = useState<any[]>([]);
  const [sendEmailLoading, setSendEmailLoading] = useState(false);
  const [sendEmailResult, setSendEmailResult] = useState<any>(null);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Handle return from Gmail OAuth flow - auto-open Google Sheets dialog with success message
  const [gmailConnectMsg, setGmailConnectMsg] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get('gmail_connected');
    if (gmailConnected) {
      setGmailConnectMsg(`Gmail account ${gmailConnected} connected! You can now import Google Sheets.`);
      setShowGoogleSheetsDialog(true);
      // Clear the message after a while
      setTimeout(() => setGmailConnectMsg(''), 10000);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [debouncedSearch, statusFilter, activeListId, activeTab, assignFilterUserId]);
  useEffect(() => { fetchContactLists(); fetchTeamMembers(); }, []);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);

      // Tab-based filtering
      if (activeTab === 'unsubscribers') {
        params.set('status', 'unsubscribed');
      } else if (activeTab === 'blocklist') {
        params.set('status', 'bounced');
      } else if (activeTab === 'lists' && activeListId) {
        params.set('listId', activeListId);
        if (statusFilter !== 'all') params.set('status', statusFilter);
      } else if (activeTab === 'all') {
        if (statusFilter !== 'all') params.set('status', statusFilter);
      }

      // Lead assignment filter (admin only)
      if (assignFilterUserId) params.set('assignedTo', assignFilterUserId);

      params.set('limit', '200');
      const res = await fetch(`/api/contacts?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || data);
        setTotal(data.total || (data.contacts || data).length);
      }
    } catch (e) { console.error('Failed to fetch contacts:', e); }
    setLoading(false);
  };

  const fetchContactLists = async () => {
    try {
      const res = await fetch('/api/contact-lists', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setContactLists(data);
      }
    } catch (e) { console.error('Failed to fetch contact lists:', e); }
  };

  const fetchTeamMembers = async () => {
    try {
      const [membersRes, profileRes] = await Promise.all([
        fetch('/api/team/members', { credentials: 'include' }),
        fetch('/api/auth/user-profile', { credentials: 'include' }),
      ]);
      if (membersRes.ok) setTeamMembers(await membersRes.json());
      if (profileRes.ok) {
        const profile = await profileRes.json();
        setUserRole(profile.role || 'member');
      }
      // Fetch assignment stats if admin
      try {
        const statsRes = await fetch('/api/contacts/assignment-stats', { credentials: 'include' });
        if (statsRes.ok) setAssignmentStats(await statsRes.json());
      } catch {}
    } catch (e) { console.error('Failed to fetch team data:', e); }
  };

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  const handleAssignContacts = async () => {
    if (!assignTargetUserId || selectedIds.length === 0) return;
    try {
      const res = await fetch('/api/contacts/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contactIds: selectedIds, userId: assignTargetUserId }),
      });
      if (res.ok) {
        setShowAssignDialog(false);
        setSelectedIds([]);
        setAssignTargetUserId('');
        await fetchContacts();
        await fetchTeamMembers();
      }
    } catch (e) { console.error('Failed to assign contacts:', e); }
  };

  const handleUnassignContacts = async (ids: string[]) => {
    try {
      const res = await fetch('/api/contacts/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contactIds: ids }),
      });
      if (res.ok) {
        setSelectedIds([]);
        await fetchContacts();
        await fetchTeamMembers();
      }
    } catch (e) { console.error('Failed to unassign contacts:', e); }
  };

  const handleAutoAssign = async () => {
    const memberIds = teamMembers.filter(m => m.role !== 'viewer').map(m => m.userId);
    if (memberIds.length === 0) return;
    try {
      const res = await fetch('/api/contacts/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ memberIds }),
      });
      if (res.ok) {
        await fetchContacts();
        await fetchTeamMembers();
      }
    } catch (e) { console.error('Failed to auto-assign:', e); }
  };

  const handleAddContact = async () => {
    setFormError('');
    if (!formEmail) { setFormError('Email is required'); return; }
    setFormLoading(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          email: formEmail, firstName: formFirstName, lastName: formLastName,
          company: formCompany, jobTitle: formJobTitle,
          tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
          status: 'cold',
          listId: activeTab === 'lists' && activeListId ? activeListId : undefined,
        }),
      });
      if (res.ok) { setShowAddDialog(false); resetForm(); await fetchContacts(); await fetchContactLists(); }
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
    await fetchContactLists();
  };

  // Quick Send Email
  const openSendEmailDialog = async () => {
    if (selectedIds.length === 0) { alert('Select contacts first'); return; }
    setSendEmailSubject(''); setSendEmailContent(''); setSendEmailResult(null); setSendEmailLoading(false);
    try {
      const res = await fetch('/api/email-accounts', { credentials: 'include' });
      if (res.ok) {
        const accounts = await res.json();
        setSendEmailAccounts(accounts);
        if (accounts.length > 0 && !sendEmailAccountId) setSendEmailAccountId(accounts[0].id);
      }
    } catch (e) { console.error('Failed to load email accounts:', e); }
    setShowSendEmailDialog(true);
  };

  const handleSendEmail = async () => {
    if (!sendEmailAccountId || !sendEmailSubject.trim() || !sendEmailContent.trim()) return;
    setSendEmailLoading(true); setSendEmailResult(null);
    try {
      const res = await fetch('/api/contacts/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ contactIds: selectedIds, emailAccountId: sendEmailAccountId, subject: sendEmailSubject, content: sendEmailContent }),
      });
      const data = await res.json();
      setSendEmailResult(data);
    } catch (e) { setSendEmailResult({ success: false, error: 'Failed to send emails' }); }
    setSendEmailLoading(false);
  };


  const handleDeleteList = async (listId: string) => {
    if (!confirm('Delete this list? Contacts will remain but lose their list association.')) return;
    await fetch(`/api/contact-lists/${listId}`, { method: 'DELETE', credentials: 'include' });
    if (activeListId === listId) setActiveListId(null);
    await fetchContactLists();
  };

  const handleRenameList = async () => {
    if (!renameListId || !renameListValue.trim()) return;
    setCreateListLoading(true);
    try {
      await fetch(`/api/contact-lists/${renameListId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ name: renameListValue.trim() }),
      });
      setShowRenameListDialog(false);
      await fetchContactLists();
    } catch (e) { /* ignore */ }
    setCreateListLoading(false);
  };

  const openEdit = (contact: Contact) => {
    setEditContact(contact); setFormEmail(contact.email); setFormFirstName(contact.firstName);
    setFormLastName(contact.lastName); setFormCompany(contact.company);
    setFormJobTitle(contact.jobTitle); setFormTags(contact.tags?.join(', ') || '');
    setShowEditDialog(true);
  };

  const openDetail = (contact: Contact) => {
    setDetailContact(contact);
    setShowContactDetail(true);
  };

  const resetForm = () => {
    setFormEmail(''); setFormFirstName(''); setFormLastName('');
    setFormCompany(''); setFormJobTitle(''); setFormTags('');
    setFormError(''); setEditContact(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    // Auto-set list name from file name (without extension)
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    if (!importListName) setImportListName(nameWithoutExt);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let text = event.target?.result as string;
        if (!text) return;
        // Strip BOM if present
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          console.warn('[CSV] File has fewer than 2 lines');
          return;
        }
        const headers = parseCSVLine(lines[0]).filter(h => h.trim());
        if (headers.length === 0) {
          console.warn('[CSV] No headers found');
          return;
        }
        const rows = lines.slice(1).map(line => {
          const values = parseCSVLine(line);
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h] = values[i] || ''; });
          return row;
        }).filter(row => Object.values(row).some(v => v.trim()));

        console.log('[CSV] Parsed:', headers.length, 'columns,', rows.length, 'rows');
        setCsvHeaders(headers);
        setCsvData(rows);

        const mapping: Record<string, string> = {};
        let extraMapped = false;
        headers.forEach(h => {
          const lower = h.toLowerCase().trim();
          // Key fields
          if (lower.includes('email') || lower === 'e-mail') mapping.email = h;
          else if ((lower.includes('first') && lower.includes('name')) || lower === 'first') mapping.firstName = h;
          else if ((lower.includes('last') && lower.includes('name')) || lower === 'last' || lower === 'surname') mapping.lastName = h;
          else if (lower === 'name' || lower === 'full name' || lower === 'fullname') mapping.firstName = h;
          else if (lower.includes('company') || lower.includes('organization') || lower === 'org') mapping.company = h;
          else if (lower.includes('title') || lower.includes('position') || lower === 'role' || lower.includes('designation')) mapping.jobTitle = h;
          // Extended fields
          else if ((lower === 'phone' || lower === 'phone number' || lower === 'work phone' || lower === 'direct phone' || lower === 'work direct phone') && !mapping.phone) { mapping.phone = h; extraMapped = true; }
          else if ((lower === 'mobile' || lower === 'mobile phone' || lower === 'cell' || lower === 'cell phone') && !mapping.mobilePhone) { mapping.mobilePhone = h; extraMapped = true; }
          else if ((lower.includes('linkedin') && !lower.includes('company')) && !mapping.linkedinUrl) { mapping.linkedinUrl = h; extraMapped = true; }
          else if ((lower.includes('company') && lower.includes('linkedin')) && !mapping.companyLinkedinUrl) { mapping.companyLinkedinUrl = h; extraMapped = true; }
          else if ((lower === 'seniority' || lower === 'level' || lower === 'management level') && !mapping.seniority) { mapping.seniority = h; extraMapped = true; }
          else if ((lower === 'department' || lower === 'departments' || lower === 'function') && !mapping.department) { mapping.department = h; extraMapped = true; }
          else if ((lower === 'city' || lower === 'person city') && !mapping.city) { mapping.city = h; extraMapped = true; }
          else if ((lower === 'state' || lower === 'person state' || lower === 'region') && !mapping.state) { mapping.state = h; extraMapped = true; }
          else if ((lower === 'country' || lower === 'person country') && !mapping.country) { mapping.country = h; extraMapped = true; }
          else if ((lower === 'website' || lower === 'domain' || lower === 'company website') && !mapping.website) { mapping.website = h; extraMapped = true; }
          else if ((lower === 'industry' || lower === 'company industry') && !mapping.industry) { mapping.industry = h; extraMapped = true; }
          else if ((lower.includes('employee') || lower === 'headcount' || lower === 'company size' || lower === '# employees') && !mapping.employeeCount) { mapping.employeeCount = h; extraMapped = true; }
          else if ((lower.includes('revenue')) && !mapping.annualRevenue) { mapping.annualRevenue = h; extraMapped = true; }
          else if ((lower === 'tags' || lower === 'labels') && !mapping.tags) { mapping.tags = h; extraMapped = true; }
          else if ((lower === 'email status' || lower === 'email confidence') && !mapping.emailStatus) { mapping.emailStatus = h; extraMapped = true; }
          else if ((lower === 'company city' || lower === 'hq city') && !mapping.companyCity) { mapping.companyCity = h; extraMapped = true; }
          else if ((lower === 'company state' || lower === 'hq state') && !mapping.companyState) { mapping.companyState = h; extraMapped = true; }
          else if ((lower === 'company country' || lower === 'hq country') && !mapping.companyCountry) { mapping.companyCountry = h; extraMapped = true; }
          else if ((lower === 'company phone') && !mapping.companyPhone) { mapping.companyPhone = h; extraMapped = true; }
          else if ((lower === 'company address' || lower === 'hq address' || lower === 'address') && !mapping.companyAddress) { mapping.companyAddress = h; extraMapped = true; }
          else if ((lower === 'secondary email' || lower === 'alternate email' || lower === 'other email' || lower === 'personal email') && !mapping.secondaryEmail) { mapping.secondaryEmail = h; extraMapped = true; }
          else if ((lower === 'home phone' || lower === 'personal phone') && !mapping.homePhone) { mapping.homePhone = h; extraMapped = true; }
        });
        setCsvMapping(mapping);
        if (extraMapped) setShowAllFields(true);
        console.log('[CSV] Auto-mapped:', mapping);
      } catch (err) {
        console.error('[CSV] Parse error:', err);
      }
    };
    reader.readAsText(file);
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleImportCSV = async () => {
    if (csvData.length === 0 || !csvMapping.email) return;
    setImportLoading(true);
    setImportResult(null);

    const contacts = csvData.map(row => {
      const contact: Record<string, any> = {};
      // Apply all field mappings (not just key fields)
      for (const [field, csvHeader] of Object.entries(csvMapping)) {
        if (csvHeader && csvHeader.trim() && row[csvHeader]) {
          contact[field] = (row[csvHeader] || '').trim();
        }
      }
      // Pass unmapped columns through with original header names
      const mappedColumns = new Set(Object.values(csvMapping).filter(Boolean));
      csvHeaders.forEach(header => {
        if (!mappedColumns.has(header) && row[header]) contact[header] = row[header].trim();
      });
      return contact;
    }).filter(c => c.email && c.email.includes('@'));

    try {
      const listName = (importToExistingList && importToExistingList !== '_select')
        ? undefined
        : (importListName || importFileName || 'Imported Contacts');

      const res = await fetch('/api/contacts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          contacts,
          listName,
          existingListId: (importToExistingList && importToExistingList !== '_select') ? importToExistingList : undefined,
          headers: csvHeaders,
          source: 'csv',
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setImportResult(result);
        await fetchContacts();
        await fetchContactLists();
      }
    } catch (e) { setImportResult({ success: false, message: 'Import failed' }); }
    setImportLoading(false);
  };

  // ========== AI COLUMN MAPPING ==========
  const handleAiMapColumns = async (
    headers: string[], 
    data: any[], 
    setMapping: (fn: any) => void
  ) => {
    setAiMappingLoading(true);
    setAiMappingError('');
    try {
      const sampleRows = data.slice(0, 3).map(row => {
        const sample: Record<string, string> = {};
        headers.forEach(h => { sample[h] = row[h] || ''; });
        return sample;
      });

      const res = await fetch('/api/contacts/ai-map-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ csvHeaders: headers, sampleRows }),
      });

      const result = await res.json();
      if (result.success && result.mapping) {
        setMapping((prev: any) => ({ ...prev, ...result.mapping }));
        setShowAllFields(true); // Auto-expand to show all mapped fields
      } else {
        setAiMappingError(result.message || 'AI mapping failed');
      }
    } catch (e) {
      setAiMappingError('Failed to connect to AI service');
    }
    setAiMappingLoading(false);
  };

  // ========== CREATE LIST ==========
  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    setCreateListLoading(true);
    try {
      const res = await fetch('/api/contact-lists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (res.ok) {
        const list = await res.json();
        setShowCreateListDialog(false);
        setNewListName('');
        setNewListDescription('');
        await fetchContactLists();
        // Switch to Your Lists tab and select the new list
        setActiveTab('lists');
        setActiveListId(list.id);
      }
    } catch (e) { /* ignore */ }
    setCreateListLoading(false);
  };

  // ========== GOOGLE SHEETS IMPORT ==========
  const handleGsFetchInfo = async () => {
    if (!gsUrl.trim()) return;
    setGsLoading(true); setGsError(''); setGsSheets([]); setGsSelectedSheet(null); setGsData([]); setGsImportResult(null);
    try {
      const res = await fetch('/api/sheets/fetch-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ url: gsUrl.trim() }),
      });
      const data = await res.json();
      if (data.valid && data.sheets?.length > 0) {
        setGsSheets(data.sheets);
        setGsSelectedSheet(data.sheets[0]);
        // Auto-set list name from the spreadsheet title
        const autoName = data.title || data.sheets[0]?.name || 'Google Sheet Import';
        setGsSheetTitle(autoName);
        setGsListName(autoName);
        // Auto-load the first sheet's data
        handleGsLoadData(data.sheets[0], data.title);
      } else {
        setGsError(data.error || 'Could not access the spreadsheet. Make sure it is shared publicly.');
      }
    } catch (e) {
      setGsError('Failed to connect to Google Sheets');
    }
    setGsLoading(false);
  };

  const handleGsLoadData = async (sheet: any, sheetTitle?: string) => {
    setGsSelectedSheet(sheet); setGsDataLoading(true); setGsData([]); setGsHeaders([]);
    try {
      const res = await fetch('/api/sheets/fetch-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ url: gsUrl.trim(), gid: sheet.id, sheetName: sheet.name }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[GS] fetch-data response keys:', Object.keys(data));

        // Backend returns: { headers, values (raw CSV rows), contacts (mapped), totalRows, validContacts, allHeaders, columnMapping }
        // We need headers and row objects for the column mapping UI
        const hdrs = data.headers || data.allHeaders || [];

        // Build row objects from raw CSV values (values[0] = headers, rest = data rows)
        let rowObjects: Record<string, string>[] = [];
        if (data.values && data.values.length > 1) {
          const headerRow = data.values[0];
          rowObjects = data.values.slice(1).map((row: string[]) => {
            const obj: Record<string, string> = {};
            headerRow.forEach((h: string, i: number) => { obj[h] = row[i] || ''; });
            return obj;
          });
        } else if (data.contacts && data.contacts.length > 0) {
          // Fallback: use the pre-mapped contacts array
          rowObjects = data.contacts;
        } else if (data.rows && data.rows.length > 0) {
          // Legacy format
          rowObjects = data.rows;
        }

        if (hdrs.length > 0 && rowObjects.length > 0) {
          setGsHeaders(hdrs);
          setGsData(rowObjects);

          // Auto-map columns: prefer backend's columnMapping, then do client-side detection
          const mapping: Record<string, string> = {};
          if (data.columnMapping) {
            if (data.columnMapping.email) mapping.email = data.columnMapping.email;
            if (data.columnMapping.firstName) mapping.firstName = data.columnMapping.firstName;
            if (data.columnMapping.lastName) mapping.lastName = data.columnMapping.lastName;
            if (data.columnMapping.company) mapping.company = data.columnMapping.company;
          }
          // Fill in any missing mappings with client-side heuristics
          hdrs.forEach((h: string) => {
            const lower = h.toLowerCase();
            if (!mapping.email && (lower.includes('email') || lower === 'e-mail')) mapping.email = h;
            else if (!mapping.firstName && ((lower.includes('first') && lower.includes('name')) || lower === 'first')) mapping.firstName = h;
            else if (!mapping.lastName && ((lower.includes('last') && lower.includes('name')) || lower === 'last' || lower === 'surname')) mapping.lastName = h;
            else if (!mapping.firstName && (lower === 'name' || lower === 'full name')) mapping.firstName = h;
            else if (!mapping.company && (lower.includes('company') || lower.includes('organization'))) mapping.company = h;
            else if (!mapping.jobTitle && (lower.includes('title') || lower.includes('position') || lower.includes('designation'))) mapping.jobTitle = h;
          });
          setGsMapping(mapping);

          // Auto-set list name: prefer sheet title, then sheet tab name
          const title = sheetTitle || gsSheetTitle;
          const autoName = title || sheet.name || 'Google Sheet Import';
          if (!gsListName || gsListName === 'Google Sheet Import') setGsListName(autoName);
        } else if (hdrs.length > 0) {
          // Headers found but no data rows
          setGsHeaders(hdrs);
          setGsData([]);
        }
      }
    } catch (e) {
      console.error('[GS] Error loading sheet data:', e);
    }
    setGsDataLoading(false);
  };

  const handleGsImport = async () => {
    if (gsData.length === 0 || !gsMapping.email) return;
    setGsImportLoading(true); setGsImportResult(null);
    const contacts = gsData.map(row => {
      const contact: Record<string, any> = {};
      // Apply all field mappings (not just key fields)
      for (const [field, csvHeader] of Object.entries(gsMapping)) {
        if (csvHeader && csvHeader.trim() && row[csvHeader]) {
          contact[field] = (row[csvHeader] || '').trim();
        }
      }
      // Pass unmapped columns through with original header names
      const mappedCols = new Set(Object.values(gsMapping).filter(Boolean));
      gsHeaders.forEach(h => { if (!mappedCols.has(h) && row[h]) contact[h] = row[h].trim(); });
      return contact;
    }).filter(c => c.email && c.email.includes('@'));

    try {
      const listName = (gsToExistingList && gsToExistingList !== '_select')
        ? undefined
        : (gsListName || gsSelectedSheet?.name || 'Google Sheet Import');

      const res = await fetch('/api/contacts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          contacts,
          listName,
          existingListId: (gsToExistingList && gsToExistingList !== '_select') ? gsToExistingList : undefined,
          headers: gsHeaders,
          source: 'google_sheets',
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setGsImportResult(result);
        await fetchContacts(); await fetchContactLists();
      } else {
        setGsImportResult({ success: false, message: 'Import failed' });
      }
    } catch (e) { setGsImportResult({ success: false, message: 'Network error' }); }
    setGsImportLoading(false);
  };

  // Helpers
  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; dot: string; label: string; icon: any }> = {
      hot: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Hot', icon: TrendingUp },
      warm: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', label: 'Warm', icon: Star },
      cold: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Cold', icon: Mail },
      replied: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Replied', icon: CheckCircle },
      bounced: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-400', label: 'Bounced', icon: Ban },
      unsubscribed: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: 'Unsubscribed', icon: ShieldX },
    };
    return configs[status] || configs.cold;
  };

  const getInitials = (first: string, last: string) => `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();

  const getAvatarColor = (email: string) => {
    const colors = [
      'from-blue-400 to-blue-600', 'from-purple-400 to-purple-600', 'from-emerald-400 to-emerald-600',
      'from-amber-400 to-amber-600', 'from-pink-400 to-pink-600', 'from-cyan-400 to-cyan-600',
      'from-indigo-400 to-indigo-600', 'from-rose-400 to-rose-600'
    ];
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const getRatingBadge = (rating?: number, grade?: string) => {
    if (!rating && rating !== 0) return null;
    const gradeColors: Record<string, string> = {
      'A+': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'A': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'B+': 'bg-green-50 text-green-700 border-green-200',
      'B': 'bg-lime-50 text-lime-700 border-lime-200',
      'C+': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'C': 'bg-amber-50 text-amber-700 border-amber-200',
      'D': 'bg-orange-50 text-orange-700 border-orange-200',
      'E': 'bg-red-50 text-red-600 border-red-200',
      'F': 'bg-gray-100 text-gray-500 border-gray-200',
    };
    const g = grade || 'F';
    const cls = gradeColors[g] || gradeColors['F'];
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${cls}`}>
            {g} <span className="font-normal text-[9px] opacity-70">{rating}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Email Rating: {rating}/100 (Grade {g})</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const calculateSingleRating = async (contactId: string, useAI: boolean = false) => {
    setRatingLoading(contactId);
    try {
      const res = await fetch(`/api/contacts/${contactId}/rating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ useAI }),
      });
      if (res.ok) {
        const data = await res.json();
        // Update local contact data
        setContacts(prev => prev.map(c => c.id === contactId ? { ...c, emailRating: data.rating, emailRatingGrade: data.grade, emailRatingDetails: data.details } : c));
        if (detailContact?.id === contactId) {
          setDetailContact(prev => prev ? { ...prev, emailRating: data.rating, emailRatingGrade: data.grade, emailRatingDetails: data.details } : prev);
        }
      }
    } catch (e) { console.error('Rating calculation failed:', e); }
    setRatingLoading(null);
  };

  const toggleSelect = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const toggleSelectAll = () => { setSelectedIds(selectedIds.length === contacts.length ? [] : contacts.map(c => c.id)); };

  const activeList = contactLists.find(l => l.id === activeListId);

  const totalBounced = contacts.filter(c => c.status === 'bounced').length;
  const totalUnsub = contacts.filter(c => c.status === 'unsubscribed').length;

  // Tab counts (from the full set)
  const [tabCounts, setTabCounts] = useState({ all: 0, unsubscribers: 0, blocklist: 0, lists: 0 });
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [allRes, unsubRes, bouncedRes] = await Promise.all([
          fetch('/api/contacts?limit=1', { credentials: 'include' }),
          fetch('/api/contacts?status=unsubscribed&limit=1', { credentials: 'include' }),
          fetch('/api/contacts?status=bounced&limit=1', { credentials: 'include' }),
        ]);
        const allData = allRes.ok ? await allRes.json() : { total: 0 };
        const unsubData = unsubRes.ok ? await unsubRes.json() : { total: 0 };
        const bouncedData = bouncedRes.ok ? await bouncedRes.json() : { total: 0 };
        setTabCounts({
          all: allData.total || 0,
          unsubscribers: unsubData.total || 0,
          blocklist: bouncedData.total || 0,
          lists: contactLists.length,
        });
      } catch {}
    };
    fetchCounts();
  }, [contacts, contactLists]);

  // Format date helper
  const fmtDate = (d: string) => {
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d));
    } catch { return d; }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* ── Page Header ── */}
      <div className="px-6 pt-6 pb-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Contacts</h1>
            <p className="text-sm text-gray-400 mt-0.5">Manage your email lists, contacts, and subscriptions</p>
          </div>

          {/* Actions dropdown */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 text-gray-600 border-gray-200" onClick={() => fetchContacts()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                  Actions <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => { resetForm(); setShowAddDialog(true); }}>
                  <UserPlus className="h-4 w-4 mr-2 text-blue-500" /> Add Contact
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setNewListName(''); setNewListDescription(''); setShowCreateListDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2 text-green-500" /> Create List
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setCsvMapping({}); setImportResult(null); setImportListName(''); setImportFileName(''); setImportToExistingList(''); setAiMappingError(''); setShowAllFields(false); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                  <Upload className="h-4 w-4 mr-2 text-violet-500" /> Import CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  setGsUrl(''); setGsSheets([]); setGsSelectedSheet(null); setGsData([]); setGsHeaders([]);
                  setGsMapping({}); setGsListName(''); setGsSheetTitle(''); setGsError(''); setGsImportResult(null); setGsToExistingList('');
                  setAiMappingError(''); setShowAllFields(false);
                  setShowGoogleSheetsDialog(true);
                }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> Import Google Sheets
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { if (selectedIds.length > 0) { setShowAssignDialog(true); } else { alert('Select contacts first to assign them'); } }}>
                      <UserPlus className="h-4 w-4 mr-2 text-indigo-500" /> Assign Selected
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAutoAssign}>
                      <Zap className="h-4 w-4 mr-2 text-amber-500" /> Auto-Assign All
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openSendEmailDialog}>
                  <Mail className="h-4 w-4 mr-2 text-blue-500" /> Send Email {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={async () => {
                  if (ratingLoading) return;
                  setRatingLoading('batch');
                  setBatchRatingProgress({ processed: 0, total: contacts.length });
                  try {
                    const res = await fetch('/api/contacts/batch-rating', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                      body: JSON.stringify({ useAI: false }),
                    });
                    if (res.ok) { const data = await res.json(); setBatchRatingProgress({ processed: data.processed, total: data.processed + data.errors }); }
                    fetchContacts();
                  } catch (e) { console.error('Batch rating failed:', e); }
                  setTimeout(() => { setRatingLoading(null); setBatchRatingProgress(null); }, 2000);
                }}>
                  <BarChart3 className="h-4 w-4 mr-2 text-orange-500" /> {ratingLoading === 'batch' ? 'Calculating...' : 'Calculate Ratings'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  if (ratingLoading) return;
                  setRatingLoading('batch-ai');
                  try {
                    const res = await fetch('/api/contacts/batch-rating', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                      body: JSON.stringify({ useAI: true }),
                    });
                    if (res.ok) { const data = await res.json(); setBatchRatingProgress({ processed: data.processed, total: data.processed + data.errors }); }
                    fetchContacts();
                  } catch (e) { console.error('AI batch rating failed:', e); }
                  setTimeout(() => { setRatingLoading(null); setBatchRatingProgress(null); }, 2000);
                }}>
                  <Sparkles className="h-4 w-4 mr-2 text-purple-500" /> {ratingLoading === 'batch-ai' ? 'AI Scoring...' : 'AI Rate (Azure OpenAI)'}
                </DropdownMenuItem>
                {selectedIds.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleBulkDelete} className="text-red-600">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Selected ({selectedIds.length})
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center border-b border-gray-200">
          {([
            { key: 'all' as TabType, label: 'All', count: tabCounts.all, icon: Users },
            { key: 'unsubscribers' as TabType, label: 'Unsubscribers', count: tabCounts.unsubscribers, icon: ShieldX },
            { key: 'blocklist' as TabType, label: 'Blocklist', count: tabCounts.blocklist, icon: Ban },
            { key: 'lists' as TabType, label: 'Your lists', count: tabCounts.lists, icon: LayoutList },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setActiveListId(null); setSelectedIds([]); setSearch(''); setStatusFilter('all'); }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all -mb-[1px] ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* ── Lists tab ── */}
        {activeTab === 'lists' && !activeListId && (
          <div className="space-y-4">
            {/* Lists header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search lists..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-72 text-sm border-gray-200"
                />
              </div>
              <Button size="sm" onClick={() => { setNewListName(''); setNewListDescription(''); setShowCreateListDialog(true); }}
                className="h-9 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create List
              </Button>
            </div>

            {contactLists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="bg-gradient-to-br from-violet-50 to-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
                  <LayoutList className="h-10 w-10 text-violet-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1.5">No lists yet</h3>
                <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">Create a contact list to organize your contacts into groups for email campaigns</p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setImportResult(null); setImportListName(''); }}>
                    <Upload className="h-4 w-4 mr-2" /> Import CSV
                  </Button>
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setNewListName(''); setShowCreateListDialog(true); }}>
                    <Plus className="h-4 w-4 mr-2" /> Create List
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                {/* List table header */}
                <div className="grid grid-cols-[1fr_120px_120px_120px_48px] gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">List Name</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Source</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-center">Contacts</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Created</div>
                  <div></div>
                </div>
                {contactLists
                  .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()))
                  .map(list => (
                  <div
                    key={list.id}
                    className="grid grid-cols-[1fr_120px_120px_120px_48px] gap-4 px-5 py-3.5 border-b border-gray-50 items-center hover:bg-blue-50/30 cursor-pointer transition-all group"
                    onClick={() => setActiveListId(list.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="bg-violet-50 p-2 rounded-lg">
                        <List className="h-4 w-4 text-violet-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{list.name}</div>
                        {list.headers && list.headers.length > 0 && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            {list.headers.slice(0, 4).join(', ')}{list.headers.length > 4 ? ` +${list.headers.length - 4}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <Badge variant="outline" className={`text-[10px] font-medium capitalize ${
                        list.source === 'google_sheets' ? 'bg-green-50 text-green-600 border-green-200'
                          : list.source === 'csv' ? 'bg-blue-50 text-blue-600 border-blue-200'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}>
                        {list.source === 'google_sheets' ? 'Google Sheets' : list.source === 'csv' ? 'CSV' : list.source || 'Manual'}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <span className="text-sm font-bold text-gray-900">{list.contactCount}</span>
                    </div>
                    <div className="text-xs text-gray-400">{fmtDate(list.createdAt)}</div>
                    <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setActiveListId(list.id)}>
                            <Eye className="h-3.5 w-3.5 mr-2" /> View Contacts
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setRenameListId(list.id); setRenameListValue(list.name); setShowRenameListDialog(true); }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDeleteList(list.id)} className="text-red-600">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Active list view (within lists tab) ── */}
        {activeTab === 'lists' && activeListId && activeList && (
          <div className="space-y-4">
            {/* Breadcrumb back */}
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveListId(null)} className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Back to all lists
              </button>
              <span className="text-gray-300">/</span>
              <span className="text-sm font-semibold text-gray-700">{activeList.name}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => { setRenameListId(activeList.id); setRenameListValue(activeList.name); setShowRenameListDialog(true); }}>
                    <Pencil className="h-3 w-3 text-gray-400 hover:text-blue-500 transition-colors" />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Rename list</p></TooltipContent>
              </Tooltip>
            </div>

            {/* List info banner */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-100 rounded-xl">
              <div className="bg-violet-100 p-2.5 rounded-xl">
                <FolderOpen className="h-5 w-5 text-violet-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-violet-900">{activeList.name}</h3>
                <div className="text-xs text-violet-500 flex items-center gap-3 mt-0.5">
                  <span>{activeList.contactCount} contacts</span>
                  <span>Source: {activeList.source === 'google_sheets' ? 'Google Sheets' : activeList.source || 'Manual'}</span>
                  {activeList.headers?.length > 0 && <span>{activeList.headers.length} columns</span>}
                </div>
              </div>
              {activeList.headers && activeList.headers.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap max-w-xs">
                  {activeList.headers.slice(0, 4).map((h, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded font-mono">{h}</span>
                  ))}
                  {activeList.headers.length > 4 && (
                    <span className="text-[9px] text-violet-400">+{activeList.headers.length - 4}</span>
                  )}
                </div>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-violet-400 hover:text-red-500" onClick={() => setActiveListId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {renderContactsTable()}
          </div>
        )}

        {/* ── All / Unsubscribers / Blocklist tabs ── */}
        {(activeTab === 'all' || activeTab === 'unsubscribers' || activeTab === 'blocklist') && (
          <div className="space-y-4">
            {/* Info banners for special tabs */}
            {activeTab === 'unsubscribers' && (
              <Alert className="border-amber-200 bg-amber-50">
                <ShieldX className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-700">
                  These contacts have unsubscribed and will be <strong>automatically excluded</strong> from all future email campaigns, even if they are selected as recipients.
                </AlertDescription>
              </Alert>
            )}
            {activeTab === 'blocklist' && (
              <Alert className="border-red-200 bg-red-50">
                <Ban className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-sm text-red-700">
                  These contacts have bounced and are on the blocklist. They will be <strong>automatically excluded</strong> from all future email campaigns to protect your sender reputation.
                </AlertDescription>
              </Alert>
            )}

            {/* Assignment Stats Panel (admin only, all tab) */}
            {isAdmin && activeTab === 'all' && assignmentStats && assignmentStats.total > 0 && (
              <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-blue-600" /> Lead Assignment Overview
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">Total: <strong className="text-gray-800">{assignmentStats.total}</strong></span>
                    <span className="text-green-600">Assigned: <strong>{assignmentStats.assigned}</strong></span>
                    <span className="text-orange-500">Unassigned: <strong>{assignmentStats.unassigned}</strong></span>
                  </div>
                </div>
                {assignmentStats.byUser && assignmentStats.byUser.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {assignmentStats.byUser.map((u: any) => (
                      <button
                        key={u.userId}
                        onClick={() => { setAssignFilterUserId(u.userId); setSelectedIds([]); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                          assignFilterUserId === u.userId
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[8px] bg-gradient-to-br from-blue-400 to-indigo-500 text-white">
                            {(u.firstName || u.email?.charAt(0) || '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{u.firstName || u.email?.split('@')[0]}</span>
                        <Badge variant="secondary" className="h-4 text-[10px] px-1.5">{u.contactCount}</Badge>
                      </button>
                    ))}
                    {assignmentStats.unassigned > 0 && (
                      <button
                        onClick={() => { setAssignFilterUserId('unassigned'); setSelectedIds([]); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                          assignFilterUserId === 'unassigned'
                            ? 'border-orange-300 bg-orange-50 text-orange-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-medium">Unassigned</span>
                        <Badge variant="secondary" className="h-4 text-[10px] px-1.5">{assignmentStats.unassigned}</Badge>
                      </button>
                    )}
                    {assignFilterUserId && (
                      <button
                        onClick={() => { setAssignFilterUserId(''); setSelectedIds([]); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all"
                      >
                        <X className="h-3 w-3" /> Clear filter
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {renderContactsTable()}
          </div>
        )}
      </div>

      {/* ====== DIALOGS ====== */}

      {/* Contact Detail Dialog */}
      <Dialog open={showContactDetail} onOpenChange={setShowContactDetail}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {detailContact && (
                <>
                  <Avatar className="h-10 w-10 shadow-sm">
                    <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(detailContact.email)} text-white text-sm font-semibold`}>
                      {getInitials(detailContact.firstName, detailContact.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-base">{detailContact.firstName} {detailContact.lastName}</div>
                    <div className="text-xs text-gray-400 font-normal">{detailContact.email}</div>
                  </div>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">Contact details</DialogDescription>
          </DialogHeader>
          {detailContact && (
            <div className="space-y-4 py-2">
              {/* Bounced/Unsubscribed warning */}
              {(detailContact.status === 'bounced' || detailContact.status === 'unsubscribed') && (
                <Alert className={detailContact.status === 'bounced' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}>
                  {detailContact.status === 'bounced' ? <Ban className="h-4 w-4 text-red-500" /> : <ShieldX className="h-4 w-4 text-amber-500" />}
                  <AlertDescription className={`text-sm ${detailContact.status === 'bounced' ? 'text-red-700' : 'text-amber-700'}`}>
                    This contact is <strong>{detailContact.status}</strong> and will be automatically excluded from all future campaigns.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Company', value: detailContact.company, icon: Building },
                  { label: 'Job Title', value: detailContact.jobTitle, icon: Briefcase },
                  { label: 'Status', value: detailContact.status, icon: CheckCircle },
                  { label: 'Score', value: detailContact.score, icon: Star },
                  { label: 'Source', value: detailContact.source || 'manual', icon: Download },
                  { label: 'Phone', value: detailContact.phone, icon: Phone },
                  { label: 'Mobile', value: detailContact.mobilePhone, icon: Phone },
                  { label: 'Home Phone', value: detailContact.homePhone, icon: Phone },
                  { label: 'Secondary Email', value: detailContact.secondaryEmail, icon: Mail },
                  { label: 'Seniority', value: detailContact.seniority, icon: TrendingUp },
                  { label: 'Department', value: detailContact.department, icon: Users },
                  { label: 'Email Status', value: detailContact.emailStatus, icon: Mail },
                ].filter(f => f.value).map((field, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
                    <field.icon className="h-3.5 w-3.5 text-gray-400 mt-0.5" />
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{field.label}</div>
                      <div className="text-sm text-gray-700 capitalize">{String(field.value)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Email Engagement Rating */}
              <div className="border border-gray-100 rounded-xl p-3 bg-gradient-to-br from-gray-50/50 to-white">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Email Rating</div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-gray-500 hover:text-blue-600"
                      disabled={ratingLoading === detailContact.id}
                      onClick={() => calculateSingleRating(detailContact.id, false)}>
                      {ratingLoading === detailContact.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Calculate
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-purple-500 hover:text-purple-700"
                      disabled={ratingLoading === detailContact.id}
                      onClick={() => calculateSingleRating(detailContact.id, true)}>
                      <Sparkles className="h-3 w-3 mr-1" /> AI Rate
                    </Button>
                  </div>
                </div>
                {detailContact.emailRating || detailContact.emailRatingGrade ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        {getRatingBadge(detailContact.emailRating, detailContact.emailRatingGrade)}
                      </div>
                      <div className="flex-1">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${
                            (detailContact.emailRating || 0) >= 75 ? 'bg-emerald-500' :
                            (detailContact.emailRating || 0) >= 50 ? 'bg-yellow-500' :
                            (detailContact.emailRating || 0) >= 25 ? 'bg-orange-500' : 'bg-red-400'
                          }`} style={{ width: `${detailContact.emailRating || 0}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-gray-600 min-w-[35px] text-right">{detailContact.emailRating}/100</span>
                    </div>
                    {detailContact.emailRatingDetails && (
                      <div className="grid grid-cols-4 gap-1.5 mt-2">
                        {[
                          { label: 'Sent', val: detailContact.emailRatingDetails.totalSent, score: detailContact.emailRatingDetails.sentScore },
                          { label: 'Opens', val: detailContact.emailRatingDetails.totalOpened, score: detailContact.emailRatingDetails.openScore },
                          { label: 'Clicks', val: detailContact.emailRatingDetails.totalClicked, score: detailContact.emailRatingDetails.clickScore },
                          { label: 'Replies', val: detailContact.emailRatingDetails.totalReplied, score: detailContact.emailRatingDetails.replyScore },
                        ].map((m, i) => (
                          <div key={i} className="text-center p-1.5 bg-white rounded-lg border border-gray-100">
                            <div className="text-[10px] text-gray-400 uppercase">{m.label}</div>
                            <div className="text-sm font-bold text-gray-800">{m.val ?? 0}</div>
                            <div className="text-[9px] text-gray-400">+{m.score ?? 0}pts</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {detailContact.emailRatingDetails?.replyQualityLabel && detailContact.emailRatingDetails.replyQualityLabel !== 'N/A' && (
                      <div className="flex items-center gap-2 mt-1 px-2 py-1.5 bg-purple-50 rounded-lg">
                        <Sparkles className="h-3 w-3 text-purple-500" />
                        <span className="text-[11px] text-purple-700">AI Reply Quality: <strong>{detailContact.emailRatingDetails.replyQualityLabel}</strong> (+{detailContact.emailRatingDetails.replyQualityScore}pts)</span>
                      </div>
                    )}
                    {detailContact.emailRatingUpdatedAt && (
                      <div className="text-[9px] text-gray-300 text-right mt-1">Last calculated: {fmtDate(detailContact.emailRatingUpdatedAt)}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-3 text-xs text-gray-400">
                    <BarChart3 className="h-5 w-5 mx-auto mb-1 text-gray-300" />
                    No rating yet. Click Calculate to score this contact.
                  </div>
                )}
              </div>

              {/* LinkedIn & Website */}
              {(detailContact.linkedinUrl || detailContact.website) && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><Globe className="h-3 w-3" /> Links</div>
                  <div className="space-y-1.5">
                    {detailContact.linkedinUrl && (
                      <a href={detailContact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg text-sm text-blue-700 hover:bg-blue-100 transition">
                        <Linkedin className="h-4 w-4" /> {detailContact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '').replace(/\/$/, '') || 'LinkedIn Profile'}
                      </a>
                    )}
                    {detailContact.website && (
                      <a href={detailContact.website.startsWith('http') ? detailContact.website : `https://${detailContact.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition">
                        <Globe className="h-4 w-4" /> {detailContact.website}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Location */}
              {(detailContact.city || detailContact.state || detailContact.country) && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</div>
                  <div className="p-2.5 bg-gray-50 rounded-lg text-sm text-gray-700">
                    {[detailContact.city, detailContact.state, detailContact.country].filter(Boolean).join(', ')}
                  </div>
                </div>
              )}

              {/* Company Info */}
              {(detailContact.industry || detailContact.employeeCount || detailContact.annualRevenue || detailContact.companyCity || detailContact.companyPhone || detailContact.companyLinkedinUrl) && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><Factory className="h-3 w-3" /> Company Details</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Industry', value: detailContact.industry },
                      { label: 'Employees', value: detailContact.employeeCount },
                      { label: 'Revenue', value: detailContact.annualRevenue },
                      { label: 'HQ Location', value: [detailContact.companyCity, detailContact.companyState, detailContact.companyCountry].filter(Boolean).join(', ') },
                      { label: 'Address', value: detailContact.companyAddress },
                      { label: 'Company Phone', value: detailContact.companyPhone },
                    ].filter(f => f.value).map((f, i) => (
                      <div key={i} className="p-2 bg-gray-50 rounded text-xs">
                        <div className="text-gray-400 uppercase font-semibold tracking-wide text-[10px]">{f.label}</div>
                        <div className="text-gray-700 mt-0.5">{f.value}</div>
                      </div>
                    ))}
                  </div>
                  {detailContact.companyLinkedinUrl && (
                    <a href={detailContact.companyLinkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 mt-2 bg-blue-50 rounded-lg text-xs text-blue-700 hover:bg-blue-100 transition">
                      <Linkedin className="h-3.5 w-3.5" /> Company LinkedIn
                    </a>
                  )}
                </div>
              )}

              {/* Last Activity */}
              {detailContact.lastActivityDate && (
                <div className="flex items-center gap-2 p-2.5 bg-amber-50 rounded-lg">
                  <Calendar className="h-3.5 w-3.5 text-amber-500" />
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Last Activity</div>
                    <div className="text-sm text-gray-700">{detailContact.lastActivityDate}</div>
                  </div>
                </div>
              )}

              {detailContact.tags && detailContact.tags.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detailContact.tags.map((tag, i) => (
                      <Badge key={i} variant="outline" className="text-xs bg-gray-50">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {detailContact.listId && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><List className="h-3 w-3" /> Import List</div>
                  <div className="flex items-center gap-2 p-2.5 bg-violet-50 rounded-lg">
                    <FolderOpen className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-violet-700">{contactLists.find(l => l.id === detailContact.listId)?.name || 'Unknown List'}</span>
                  </div>
                </div>
              )}

              {detailContact.customFields && Object.keys(detailContact.customFields).length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2 flex items-center gap-1"><FileSpreadsheet className="h-3 w-3" /> Additional Data</div>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                    {Object.entries(detailContact.customFields).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 font-mono">{key}</span>
                        <span className="text-gray-700 font-medium truncate max-w-[200px]">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-gray-300 pt-2">
                Created: {fmtDate(detailContact.createdAt)} &middot; ID: {detailContact.id.slice(0, 8)}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowContactDetail(false); if (detailContact) openEdit(detailContact); }}>
              <Edit className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowContactDetail(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contact Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg"><UserPlus className="h-4 w-4 text-blue-600" /></div>
              Add New Contact
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Add a new contact to your database</DialogDescription>
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
            <Button onClick={handleAddContact} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
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
              <div className="bg-blue-50 p-2 rounded-lg"><Edit className="h-4 w-4 text-blue-600" /></div>
              Edit Contact
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Update contact information</DialogDescription>
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
            <Button onClick={handleEditContact} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Contact List Dialog */}
      <Dialog open={showCreateListDialog} onOpenChange={setShowCreateListDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">Create a contact list</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Organize your contacts into named lists for targeted campaigns</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <Label className="text-sm font-medium text-gray-700">Name</Label>
              <Input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="List name"
                className="mt-1.5 h-10"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateList(); }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowCreateListDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreateList}
              disabled={createListLoading || !newListName.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createListLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename List Dialog */}
      <Dialog open={showRenameListDialog} onOpenChange={setShowRenameListDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Enter a new name for this contact list</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Label className="text-sm font-medium text-gray-700">Name</Label>
            <Input
              value={renameListValue}
              onChange={(e) => setRenameListValue(e.target.value)}
              className="mt-1.5 h-10"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameList(); }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowRenameListDialog(false)}>Cancel</Button>
            <Button onClick={handleRenameList} disabled={createListLoading || !renameListValue.trim()} className="bg-blue-600 hover:bg-blue-700">
              {createListLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-emerald-50 p-2 rounded-lg"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /></div>
              Import from CSV
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Upload a CSV file to import contacts. All columns will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Save to list options */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Save to list</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => setImportToExistingList('')}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    !importToExistingList ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5 inline mr-1.5" /> Create new list
                </button>
                <button
                  onClick={() => setImportToExistingList('_select')}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    importToExistingList ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" /> Add to existing list
                </button>
              </div>
              {!importToExistingList ? (
                <Input
                  value={importListName}
                  onChange={(e) => setImportListName(e.target.value)}
                  placeholder="e.g., Tech Leads Q4, Conference Attendees..."
                  className="h-10"
                />
              ) : (
                <Select value={importToExistingList === '_select' ? undefined : importToExistingList} onValueChange={(v) => setImportToExistingList(v)}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Choose a list..." /></SelectTrigger>
                  <SelectContent>
                    {contactLists.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name} ({l.contactCount} contacts)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* File Upload */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center bg-gradient-to-br from-gray-50/50 to-white hover:border-blue-300 hover:bg-blue-50/20 transition-all cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="bg-blue-50 w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <Upload className="h-6 w-6 text-blue-500" />
              </div>
              {importFileName ? (
                <>
                  <p className="text-sm font-semibold text-gray-700 mb-1">{importFileName}</p>
                  <p className="text-xs text-gray-400">Click to choose a different file</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV file here or click to browse</p>
                  <p className="text-xs text-gray-400">Supports .csv files with any columns</p>
                </>
              )}
              <input type="file" ref={fileInputRef} accept=".csv" onChange={handleFileUpload} onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} className="hidden" />
            </div>

            {csvHeaders.length > 0 && renderColumnMapping(csvHeaders, csvData, csvMapping, setCsvMapping, 'csv')}

            {importResult && (
              <Alert className={`${importResult.success !== false ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                {importResult.success !== false ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                <AlertDescription className="text-sm">
                  {importResult.message || `Imported ${importResult.imported} contacts, ${importResult.skipped} skipped`}
                  {importResult.listName && (
                    <span className="block text-xs mt-1 text-emerald-600">Saved to list: "{importResult.listName}"</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>{importResult ? 'Done' : 'Cancel'}</Button>
            {!importResult && csvData.length > 0 && (
              <Button onClick={handleImportCSV} disabled={importLoading || !csvMapping.email} className="bg-emerald-600 hover:bg-emerald-700">
                {importLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Import {csvData.length} Contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Google Sheets Import Dialog */}
      <Dialog open={showGoogleSheetsDialog} onOpenChange={setShowGoogleSheetsDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-green-50 p-2 rounded-lg"><FileSpreadsheet className="h-4 w-4 text-green-600" /></div>
              Import from Google Sheets
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Paste a Google Sheets URL. Your connected Gmail account will be used to access the sheet. If the sheet is not in your account, share it with "Anyone with the link".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Gmail connected success message */}
            {gmailConnectMsg && (
              <Alert className="py-2 bg-green-50 border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-sm text-green-700">
                  {gmailConnectMsg}
                </AlertDescription>
              </Alert>
            )}
            {/* URL input */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Google Sheets URL</Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  value={gsUrl}
                  onChange={(e) => setGsUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="h-10 flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleGsFetchInfo(); }}
                />
                <Button size="sm" onClick={handleGsFetchInfo} disabled={gsLoading || !gsUrl.trim()} className="h-10 px-4 bg-green-600 hover:bg-green-700">
                  {gsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {gsError && (
              <Alert variant="destructive" className="py-2">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {gsError}
                  {(gsError.includes('connect') || gsError.includes('log in') || gsError.includes('Cannot access') || gsError.includes('permission') || gsError.includes('Permission') || gsError.includes('re-authenticate') || gsError.includes('Re-authenticate')) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 h-7 text-xs bg-white text-red-700 border-red-200 hover:bg-red-50"
                      onClick={() => window.location.href = '/api/auth/gmail-connect?returnTo=contacts'}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> Re-authenticate Gmail
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Sheet selector */}
            {gsSheets.length > 0 && (
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Select Sheet</Label>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {gsSheets.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => handleGsLoadData(s)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                        gsSelectedSheet?.id === s.id ? 'bg-green-100 text-green-700 shadow-sm ring-1 ring-green-200' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* List name (auto-populated from sheet name) */}
            {gsSheets.length > 0 && (
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Save to list</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGsToExistingList('')}
                    className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      !gsToExistingList ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5 inline mr-1.5" /> Create new list
                  </button>
                  <button
                    onClick={() => setGsToExistingList('_select')}
                    className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      gsToExistingList ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" /> Add to existing list
                  </button>
                </div>
                {!gsToExistingList ? (
                  <div>
                    <Input value={gsListName} onChange={(e) => setGsListName(e.target.value)} placeholder="e.g., My Contact List" className="h-10" />
                    {gsSheetTitle && gsListName === gsSheetTitle && (
                      <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Auto-saved with Google Sheet name: "{gsSheetTitle}"
                      </p>
                    )}
                  </div>
                ) : (
                  <Select value={gsToExistingList === '_select' ? undefined : gsToExistingList} onValueChange={(v) => setGsToExistingList(v)}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Choose a list..." /></SelectTrigger>
                    <SelectContent>
                      {contactLists.map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.contactCount} contacts)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {gsDataLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-green-500" />
                <span className="ml-2 text-sm text-gray-500">Loading sheet data...</span>
              </div>
            )}

            {/* Data loaded summary */}
            {gsHeaders.length > 0 && gsData.length > 0 && !gsDataLoading && (
              <Alert className="border-green-200 bg-green-50 py-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-sm text-green-700">
                  Loaded <strong>{gsData.length}</strong> rows with <strong>{gsHeaders.length}</strong> columns from sheet "{gsSelectedSheet?.name || 'Sheet'}"
                </AlertDescription>
              </Alert>
            )}

            {gsHeaders.length > 0 && !gsDataLoading && renderColumnMapping(gsHeaders, gsData, gsMapping, setGsMapping, 'sheets')}

            {gsImportResult && (
              <Alert className={`${gsImportResult.success !== false ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                {gsImportResult.success !== false ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                <AlertDescription className="text-sm">
                  {gsImportResult.message || `Imported ${gsImportResult.imported} contacts`}
                  {gsImportResult.listName && (
                    <span className="block text-xs mt-1 text-emerald-600">Saved to list: "{gsImportResult.listName}"</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowGoogleSheetsDialog(false)}>{gsImportResult ? 'Done' : 'Cancel'}</Button>
            {!gsImportResult && gsData.length > 0 && gsMapping.email && (
              <Button onClick={handleGsImport} disabled={gsImportLoading} className="bg-green-600 hover:bg-green-700">
                {gsImportLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Import {gsData.length} Contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== ASSIGN LEADS DIALOG ====== */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-indigo-50 p-2 rounded-lg"><UserPlus className="h-4 w-4 text-indigo-600" /></div>
              Assign Leads to Team Member
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Assign {selectedIds.length} selected contact{selectedIds.length !== 1 ? 's' : ''} to a team member.
              Assigned contacts will appear in the member's dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Select Team Member</Label>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {teamMembers.filter((m: any) => m.role !== 'viewer').map((member: any) => (
                  <button
                    key={member.userId}
                    onClick={() => setAssignTargetUserId(member.userId)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                      assignTargetUserId === member.userId
                        ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(member.email)} text-white text-xs font-semibold`}>
                        {(member.firstName || member.email?.charAt(0) || '?').charAt(0).toUpperCase()}
                        {(member.lastName || '').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {member.firstName || member.email?.split('@')[0]} {member.lastName || ''}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{member.email}</div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {member.role}
                    </Badge>
                    {assignTargetUserId === member.userId && (
                      <CheckCircle className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAssignDialog(false); setAssignTargetUserId(''); }}>Cancel</Button>
            <Button
              onClick={async () => {
                await handleAssignContacts();
                setShowAssignDialog(false);
                setAssignTargetUserId('');
                setSelectedIds([]);
                fetchTeamMembers(); // Refresh assignment stats
              }}
              disabled={!assignTargetUserId}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Assign {selectedIds.length} Contact{selectedIds.length !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== SEND EMAIL DIALOG ==================== */}
      <Dialog open={showSendEmailDialog} onOpenChange={setShowSendEmailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg"><Mail className="h-4 w-4 text-blue-600" /></div>
              Send Email to {selectedIds.length} Contact{selectedIds.length !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Compose and send an email to selected contacts. Use {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}, {'{{jobTitle}}'} for personalization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* From Account */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">From</Label>
              <Select value={sendEmailAccountId} onValueChange={setSendEmailAccountId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select email account" />
                </SelectTrigger>
                <SelectContent>
                  {sendEmailAccounts.map((acc: any) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <span className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-gray-400" />
                        {acc.email} <Badge variant="secondary" className="text-[10px] ml-1">{acc.authMethod === 'oauth' ? 'OAuth' : 'SMTP'}</Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sendEmailAccounts.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No email accounts found. Add one in Account settings.</p>
              )}
            </div>

            {/* Subject */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Subject</Label>
              <Input
                value={sendEmailSubject} onChange={e => setSendEmailSubject(e.target.value)}
                placeholder="e.g., Quick question about {{company}}"
                className="h-9 text-sm"
              />
            </div>

            {/* Content */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Email Content (HTML)</Label>
              <textarea
                value={sendEmailContent} onChange={e => setSendEmailContent(e.target.value)}
                placeholder={"Hi {{firstName}},\n\nI wanted to reach out about...\n\nBest regards"}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none h-40 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all font-mono"
              />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {['{{firstName}}', '{{lastName}}', '{{company}}', '{{jobTitle}}', '{{email}}'].map(v => (
                  <button key={v} onClick={() => setSendEmailContent(prev => prev + v)} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 border border-blue-100">
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Result */}
            {sendEmailResult && (
              <Alert className={sendEmailResult.sent > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <AlertDescription className="text-sm">
                  {sendEmailResult.error ? (
                    <span className="text-red-700">{sendEmailResult.error}</span>
                  ) : (
                    <span className={sendEmailResult.sent > 0 ? 'text-green-700' : 'text-red-700'}>
                      ✅ Sent: {sendEmailResult.sent} | ❌ Failed: {sendEmailResult.failed} | Total: {sendEmailResult.total}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSendEmailDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSendEmail}
              disabled={sendEmailLoading || !sendEmailAccountId || !sendEmailSubject.trim() || !sendEmailContent.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sendEmailLoading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending...</> : <><Mail className="h-3.5 w-3.5 mr-1.5" /> Send to {selectedIds.length} Contact{selectedIds.length !== 1 ? 's' : ''}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ========== SHARED RENDER HELPERS ==========

  function renderColumnMapping(
    headers: string[], data: any[],
    mapping: Record<string, string>,
    setMapping: (fn: any) => void,
    type: 'csv' | 'sheets'
  ) {
    // Define all available contact fields organized in sections
    const fieldSections = [
      {
        label: 'Key Fields',
        fields: [
          { key: 'email', label: 'Email', icon: Mail, required: true },
          { key: 'firstName', label: 'First Name', icon: Users },
          { key: 'lastName', label: 'Last Name', icon: Users },
          { key: 'company', label: 'Company', icon: Building },
          { key: 'jobTitle', label: 'Job Title', icon: Briefcase },
        ],
      },
      {
        label: 'Contact Details',
        fields: [
          { key: 'phone', label: 'Phone', icon: Phone },
          { key: 'mobilePhone', label: 'Mobile Phone', icon: Phone },
          { key: 'homePhone', label: 'Home Phone', icon: Phone },
          { key: 'secondaryEmail', label: 'Secondary Email', icon: Mail },
          { key: 'linkedinUrl', label: 'LinkedIn URL', icon: Linkedin },
          { key: 'seniority', label: 'Seniority', icon: TrendingUp },
          { key: 'department', label: 'Department', icon: Users },
          { key: 'emailStatus', label: 'Email Status', icon: Mail },
          { key: 'lastActivityDate', label: 'Last Activity', icon: Calendar },
        ],
      },
      {
        label: 'Location',
        fields: [
          { key: 'city', label: 'City', icon: MapPin },
          { key: 'state', label: 'State', icon: MapPin },
          { key: 'country', label: 'Country', icon: Globe },
          { key: 'website', label: 'Website', icon: Globe },
        ],
      },
      {
        label: 'Company Info',
        fields: [
          { key: 'industry', label: 'Industry', icon: Factory },
          { key: 'employeeCount', label: 'Employee Count', icon: Hash },
          { key: 'annualRevenue', label: 'Annual Revenue', icon: DollarSign },
          { key: 'companyLinkedinUrl', label: 'Company LinkedIn', icon: Linkedin },
          { key: 'companyCity', label: 'Company City', icon: MapPin },
          { key: 'companyState', label: 'Company State', icon: MapPin },
          { key: 'companyCountry', label: 'Company Country', icon: Globe },
          { key: 'companyAddress', label: 'Company Address', icon: MapPin },
          { key: 'companyPhone', label: 'Company Phone', icon: Phone },
        ],
      },
      {
        label: 'Other',
        fields: [
          { key: 'tags', label: 'Tags', icon: Tag },
          { key: 'status', label: 'Lead Status', icon: Star },
          { key: 'score', label: 'Lead Score', icon: Hash },
        ],
      },
    ];

    const allMappedCount = Object.values(mapping).filter(v => v && v.trim()).length;
    const keyFields = fieldSections[0].fields;
    const extraSections = fieldSections.slice(1);

    return (
      <div className="space-y-3">
        {/* Detected Columns */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Detected Columns ({headers.length})</h4>
            <Badge className={type === 'sheets' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>{data.length} rows</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg">
            {headers.map((h, i) => {
              const isMapped = Object.values(mapping).includes(h);
              return (
                <span key={i} className={`text-[10px] px-2 py-1 rounded-md font-mono ${
                  isMapped ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' : 'bg-white text-gray-500 ring-1 ring-gray-200'
                }`}>
                  {h} {isMapped && <CheckCircle className="h-2.5 w-2.5 ml-1 inline" />}
                </span>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Green = mapped to contact field ({allMappedCount}/{headers.length} mapped). Unmapped columns are saved as custom fields.
          </p>
        </div>

        {/* AI Auto-Map + Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-violet-200 text-violet-700 hover:bg-violet-50"
            disabled={aiMappingLoading}
            onClick={() => handleAiMapColumns(headers, data, setMapping)}
          >
            {aiMappingLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            )}
            {aiMappingLoading ? 'AI Mapping...' : 'AI Auto-Map'}
          </Button>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3.5 w-3.5 text-gray-400" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">Uses Azure OpenAI (configured in Advanced Settings) to intelligently map your CSV columns to contact fields based on header names and sample data.</p>
            </TooltipContent>
          </Tooltip>
          {aiMappingError && (
            <span className="text-[10px] text-red-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {aiMappingError}
            </span>
          )}
        </div>

        {/* Key Fields Section */}
        <div>
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Map Key Columns</h4>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2.5">
            {keyFields.map((field) => (
              <div key={field.key} className="flex items-center gap-3">
                <Label className="w-28 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <field.icon className="h-3 w-3 text-gray-400" />
                  {field.label}
                  {field.required && <span className="text-red-500">*</span>}
                </Label>
                <Select value={mapping[field.key] || '__skip__'} onValueChange={(v) => setMapping((prev: any) => ({ ...prev, [field.key]: v === '__skip__' ? '' : v }))}>
                  <SelectTrigger className="h-8 text-sm bg-white"><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__skip__">-- Skip --</SelectItem>
                    {headers.filter(h => h && h.trim()).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Expand/Collapse All Fields */}
        <button
          onClick={() => setShowAllFields(!showAllFields)}
          className="flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full justify-center py-2 border border-dashed border-blue-200 rounded-lg hover:bg-blue-50/50"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllFields ? 'rotate-180' : ''}`} />
          {showAllFields ? 'Hide additional fields' : `Map all columns (${extraSections.reduce((sum, s) => sum + s.fields.length, 0)} more fields)`}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllFields ? 'rotate-180' : ''}`} />
        </button>

        {/* Additional Field Sections (collapsible) */}
        {showAllFields && (
          <div className="space-y-3">
            {extraSections.map((section) => {
              const mappedInSection = section.fields.filter(f => mapping[f.key] && mapping[f.key].trim()).length;
              return (
                <div key={section.label}>
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                    {section.label}
                    {mappedInSection > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-full font-semibold">
                        {mappedInSection} mapped
                      </span>
                    )}
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2.5">
                    {section.fields.map((field) => (
                      <div key={field.key} className="flex items-center gap-3">
                        <Label className="w-28 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 shrink-0">
                          <field.icon className="h-3 w-3 text-gray-400" />
                          {field.label}
                        </Label>
                        <Select value={mapping[field.key] || '__skip__'} onValueChange={(v) => setMapping((prev: any) => ({ ...prev, [field.key]: v === '__skip__' ? '' : v }))}>
                          <SelectTrigger className={`h-8 text-sm bg-white ${mapping[field.key] ? 'ring-1 ring-emerald-200' : ''}`}>
                            <SelectValue placeholder="Select column" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">-- Skip --</SelectItem>
                            {headers.filter(h => h && h.trim()).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Unmapped Columns - show CSV columns not mapped to any field */}
        {(() => {
          const allFieldKeys = fieldSections.flatMap(s => s.fields.map(f => f.key));
          const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
          const unmappedHeaders = headers.filter(h => h && h.trim() && !mappedHeaders.has(h));
          // Available fields that haven't been assigned yet
          const usedFields = new Set(Object.entries(mapping).filter(([_, v]) => v && v.trim()).map(([k]) => k));
          const availableFields = allFieldKeys.filter(k => !usedFields.has(k));

          if (unmappedHeaders.length === 0) return null;

          return (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                Unmapped Columns
                <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-full font-semibold">
                  {unmappedHeaders.length} remaining
                </span>
              </h4>
              <p className="text-[10px] text-gray-400 mb-2">
                These columns are not mapped to any contact field. Assign them to a field or they will be saved as custom data.
              </p>
              <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 space-y-2">
                {unmappedHeaders.map((header) => {
                  // Check if this header has been assigned via reverse mapping
                  const assignedField = Object.entries(mapping).find(([_, v]) => v === header)?.[0];
                  return (
                    <div key={header} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 flex items-center gap-1.5">
                        <span className="text-[10px] px-2 py-1 bg-white text-gray-600 rounded font-mono ring-1 ring-gray-200 truncate max-w-[140px]" title={header}>
                          {header}
                        </span>
                      </div>
                      <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                      <Select
                        value={assignedField || '__custom__'}
                        onValueChange={(v) => {
                          if (v === '__custom__') {
                            // Remove any existing mapping for this header
                            setMapping((prev: any) => {
                              const next = { ...prev };
                              for (const key of Object.keys(next)) {
                                if (next[key] === header) delete next[key];
                              }
                              return next;
                            });
                          } else {
                            // Set the mapping: field -> header
                            setMapping((prev: any) => {
                              const next = { ...prev };
                              // Remove any previous mapping for this header
                              for (const key of Object.keys(next)) {
                                if (next[key] === header) delete next[key];
                              }
                              next[v] = header;
                              return next;
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm bg-white">
                          <SelectValue placeholder="Save as custom field" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom__">
                            <span className="text-gray-400">Save as custom field</span>
                          </SelectItem>
                          {availableFields.map(f => {
                            const fieldDef = fieldSections.flatMap(s => s.fields).find(fd => fd.key === f);
                            return (
                              <SelectItem key={f} value={f}>
                                {fieldDef?.label || f}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Data Preview */}
        {data.length > 0 && (
          <div className="border rounded-lg p-3 bg-white">
            <div className="text-[10px] font-semibold uppercase text-gray-400 mb-2">Preview (first 3 rows)</div>
            <div className="space-y-1.5">
              {data.slice(0, 3).map((row, i) => (
                <div key={i} className="text-xs text-gray-600 flex items-center gap-2 p-1.5 bg-gray-50/80 rounded">
                  <span className="text-gray-300 w-4">{i+1}.</span>
                  <span className="font-medium text-gray-800">{mapping.email && row[mapping.email]}</span>
                  {mapping.firstName && <span className="text-gray-400">| {row[mapping.firstName]}</span>}
                  {mapping.lastName && <span className="text-gray-400">{row[mapping.lastName]}</span>}
                  {mapping.company && <span className="text-gray-300">@ {row[mapping.company]}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderContactsTable() {
    const isSpecialTab = activeTab === 'unsubscribers' || activeTab === 'blocklist';
    return (
      <div className="space-y-3">
        {/* Search & Filter bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="Search by name, email, company..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm bg-white border-gray-200"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter by Team Member (admin only) */}
            {isAdmin && !isSpecialTab && teamMembers.length > 0 && (
              <Select value={assignFilterUserId || '_all'} onValueChange={(v) => { setAssignFilterUserId(v === '_all' ? '' : v); setSelectedIds([]); }}>
                <SelectTrigger className="h-9 w-[180px] text-xs border-gray-200 bg-white">
                  <div className="flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-gray-400" />
                    <SelectValue placeholder="All Members" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Members</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers.map((m: any) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.firstName || m.email?.split('@')[0]} {m.lastName || ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Status Filter (for All and Lists tab only) */}
            {!isSpecialTab && (
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
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setShowAssignDialog(true)} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Assign ({selectedIds.length})
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => handleUnassignContacts(selectedIds)} className="text-orange-600 border-orange-200 hover:bg-orange-50">
                  <UserMinus className="h-3.5 w-3.5 mr-1.5" /> Unassign
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete ({selectedIds.length})
              </Button>
              <Button variant="outline" size="sm" onClick={openSendEmailDialog} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Send Email ({selectedIds.length})
              </Button>
            </div>
          )}
        </div>

        {/* Search results indicator */}
        {debouncedSearch && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/60 border border-amber-100 rounded-lg">
            <Search className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs text-amber-700">Found <strong>{contacts.length}</strong> results for "<strong>{debouncedSearch}</strong>"</span>
            <button onClick={() => setSearch('')} className="ml-auto text-xs text-amber-500 hover:text-amber-700 font-medium">Clear</button>
          </div>
        )}

        {/* Table */}
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
              {isSpecialTab ? (
                activeTab === 'unsubscribers' ? <ShieldX className="h-10 w-10 text-amber-400" /> : <Ban className="h-10 w-10 text-red-400" />
              ) : (
                <Users className="h-10 w-10 text-blue-400" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1.5">
              {isSpecialTab
                ? `No ${activeTab === 'unsubscribers' ? 'unsubscribers' : 'blocked contacts'}`
                : (debouncedSearch ? 'No matching contacts' : 'No contacts yet')
              }
            </h3>
            <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">
              {isSpecialTab
                ? `Great news! No contacts are ${activeTab === 'unsubscribers' ? 'unsubscribed' : 'on the blocklist'}.`
                : (debouncedSearch ? `No contacts match "${debouncedSearch}"` : 'Import your contacts from a CSV file or add them manually')
              }
            </p>
            {!isSpecialTab && !debouncedSearch && (
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setImportResult(null); setImportListName(''); }}>
                  <Upload className="h-4 w-4 mr-2" /> Import CSV
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowAddDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Add Contact
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
            {/* Table Header */}
            <div className={`grid ${isSpecialTab
              ? 'grid-cols-[40px_1fr_160px_48px]'
              : isAdmin ? 'grid-cols-[40px_1fr_1fr_80px_100px_100px_100px_48px]' : 'grid-cols-[40px_1fr_1fr_80px_130px_100px_48px]'
            } gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60`}>
              <div className="flex items-center">
                <input type="checkbox" checked={selectedIds.length === contacts.length && contacts.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600" />
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {isSpecialTab ? 'Email address' : 'Contact'}
              </div>
              {!isSpecialTab && <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Company</div>}
              {!isSpecialTab && <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1"><BarChart3 className="h-2.5 w-2.5" /> Rating</div>}
              {!isSpecialTab && isAdmin && <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1"><UserCheck className="h-2.5 w-2.5" /> Assigned</div>}
              {!isSpecialTab && <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tags</div>}
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                Created <ArrowUpDown className="h-2.5 w-2.5" />
              </div>
              <div></div>
            </div>

            {/* Rows */}
            {contacts.map((contact) => {
              const sc = getStatusConfig(contact.status);
              const isSelected = selectedIds.includes(contact.id);
              const isFlagged = contact.status === 'bounced' || contact.status === 'unsubscribed';
              const assignedMember = contact.assignedTo ? teamMembers.find((m: any) => m.userId === contact.assignedTo) : null;

              return (
                <div
                  key={contact.id}
                  onClick={() => openDetail(contact)}
                  className={`grid ${isSpecialTab
                    ? 'grid-cols-[40px_1fr_160px_48px]'
                    : isAdmin ? 'grid-cols-[40px_1fr_1fr_80px_100px_100px_100px_48px]' : 'grid-cols-[40px_1fr_1fr_80px_130px_100px_48px]'
                  } gap-3 px-4 py-3 border-b border-gray-50 items-center transition-all group cursor-pointer ${
                    isSelected ? 'bg-blue-50/50' : isFlagged ? 'bg-red-50/20' : 'hover:bg-gray-50/80'
                  }`}
                >
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(contact.id)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600" />
                  </div>

                  {/* Contact / Email column */}
                  <div className="flex items-center gap-3 min-w-0">
                    {!isSpecialTab && (
                      <Avatar className="h-8 w-8 flex-shrink-0 shadow-sm">
                        <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(contact.email)} text-white text-[11px] font-semibold`}>
                          {getInitials(contact.firstName, contact.lastName)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className="min-w-0">
                      {!isSpecialTab && (contact.firstName || contact.lastName) && (
                        <div className="text-sm font-semibold text-gray-900 truncate flex items-center gap-2">
                          {contact.firstName} {contact.lastName}
                          {isFlagged && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className={`text-[9px] font-semibold capitalize ${sc.bg} ${sc.text} border-0 shadow-none py-0 px-1.5`}>
                                  <div className={`w-1 h-1 rounded-full ${sc.dot} mr-1`} />
                                  {contact.status}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">This contact is {contact.status} and will be excluded from all campaigns</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {!isFlagged && (
                            <Badge variant="outline" className={`text-[9px] font-semibold capitalize ${sc.bg} ${sc.text} border-0 shadow-none py-0 px-1.5`}>
                              <div className={`w-1 h-1 rounded-full ${sc.dot} mr-1`} />
                              {contact.status}
                            </Badge>
                          )}
                        </div>
                      )}
                      <div className={`${isSpecialTab ? 'text-sm text-gray-900' : 'text-xs text-gray-400'} truncate`}>
                        {contact.email}
                      </div>
                    </div>
                  </div>

                  {/* Company (not in special tabs) */}
                  {!isSpecialTab && (
                    <div className="min-w-0">
                      {contact.company ? (
                        <>
                          <div className="text-sm text-gray-700 truncate flex items-center gap-1.5">
                            <Building className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            {contact.company}
                          </div>
                          {contact.jobTitle && <div className="text-xs text-gray-400 truncate ml-4.5">{contact.jobTitle}</div>}
                        </>
                      ) : <span className="text-xs text-gray-300">--</span>}
                    </div>
                  )}

                  {/* Email Rating (not in special tabs) */}
                  {!isSpecialTab && (
                    <div className="flex items-center">
                      {contact.emailRating || contact.emailRatingGrade
                        ? getRatingBadge(contact.emailRating, contact.emailRatingGrade)
                        : <span className="text-[10px] text-gray-300">--</span>
                      }
                    </div>
                  )}

                  {/* Assigned To (admin only, not in special tabs) */}
                  {!isSpecialTab && isAdmin && (
                    <div className="flex items-center">
                      {assignedMember ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <div className="flex items-center gap-1.5">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="text-[8px] bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
                                  {(assignedMember.firstName || assignedMember.email?.charAt(0) || '?').charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-[10px] text-gray-600 truncate max-w-[60px]">
                                {assignedMember.firstName || assignedMember.email?.split('@')[0]}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{assignedMember.email}</p></TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[10px] text-gray-300">--</span>
                      )}
                    </div>
                  )}

                  {/* Tags (not in special tabs) */}
                  {!isSpecialTab && (
                    <div className="flex flex-wrap gap-1">
                      {contactLists.find(l => l.id === contact.listId) && (
                        <span className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-500 rounded-full font-medium flex items-center gap-0.5">
                          <List className="h-2.5 w-2.5" />{contactLists.find(l => l.id === contact.listId)?.name}
                        </span>
                      )}
                      {(contact.tags || []).slice(0, 1).map((tag, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Created date */}
                  <div className="text-xs text-gray-400">{fmtDate(contact.createdAt)}</div>

                  {/* Actions */}
                  <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openDetail(contact)}>
                          <Eye className="h-3.5 w-3.5 mr-2" /> View Details
                        </DropdownMenuItem>
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
      </div>
    );
  }
}
