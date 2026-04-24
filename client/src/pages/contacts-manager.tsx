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
  Phone, Smartphone, Globe, MapPin, Linkedin, DollarSign, Hash, Calendar, Factory,
  Zap, BarChart3, Flame, Wand2, FileText, Bold, Italic, Underline, Link,
  ListOrdered, AlignLeft, Code, Type, MailCheck, ShieldCheck,
  Clock, MessageSquare, PhoneCall, Send, Target, Trophy, XOctagon, CalendarClock, CheckCircle2
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ApolloSyncDialog from "@/components/apollo-sync-dialog";

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
  // Email verification
  emailVerificationStatus?: string;
  emailVerifiedAt?: string;
  // Pipeline
  pipelineStage?: string;
  nextActionDate?: string;
  nextActionType?: string;
  // Lead Intelligence (enriched from AI scan)
  leadBucket?: string;
  leadConfidence?: number;
  aiReasoning?: string;
  suggestedAction?: string;
  lastEmailDate?: string;
  leadTotalEmails?: number;
  leadTotalReceived?: number;
  leadTotalSent?: number;
  leadAccountEmail?: string;
}

interface ContactList {
  id: string;
  name: string;
  source: string;
  headers: string[];
  contactCount: number;
  uploadedBy?: string;
  uploadedByName?: string;
  allocatedTo?: string;
  allocatedToName?: string;
  createdAt: string;
}

type TabType = 'all' | 'unsubscribers' | 'blocklist' | 'lists' | 'follow-ups' | 'hot-leads';

// Searchable list picker — replaces plain Select in import modals when org has many lists
function SearchableListPicker({ lists, value, search, onSearchChange, onChange }: {
  lists: { id: string; name: string; contactCount: number }[];
  value: string; search: string;
  onSearchChange: (s: string) => void;
  onChange: (id: string) => void;
}) {
  const filtered = search.trim()
    ? lists.filter(l => l.name.toLowerCase().includes(search.trim().toLowerCase()))
    : lists;
  const selected = lists.find(l => l.id === value);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search lists..."
          className="h-9 w-full pl-9 pr-3 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <div className="border border-gray-200 rounded-lg bg-white max-h-44 overflow-y-auto divide-y divide-gray-50">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">No lists found</p>
        ) : filtered.map(l => (
          <button
            key={l.id}
            type="button"
            onClick={() => onChange(l.id)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-blue-50 transition-colors ${value === l.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
          >
            <span className="truncate">{l.name}</span>
            <span className="text-xs text-gray-400 ml-2 shrink-0">{l.contactCount} contacts</span>
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-blue-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Selected: <strong>{selected.name}</strong>
        </p>
      )}
    </div>
  );
}

// Autocomplete text input — shows matching suggestions as user types, click to fill
function AutocompleteInput({ value, onChange, placeholder, suggestions, width }: {
  value: string; onChange: (v: string) => void; placeholder: string; suggestions: string[]; width: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const term = value.toLowerCase();
  const matches = term.length < 1 ? [] : suggestions
    .filter(s => s && s.toLowerCase().includes(term))
    .slice(0, 8);

  return (
    <div ref={ref} className="relative" style={{ width }}>
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none z-10" />
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-8 w-full pl-6 pr-2 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {open && matches.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto" style={{ minWidth: width }}>
          {matches.map(s => (
            <button
              key={s}
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 hover:text-blue-700 truncate"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-select dropdown with checkboxes — stores selections as string array, sends comma-joined to backend
function MultiSelectDropdown({ options, selected, onChange, placeholder, width }: {
  options: string[]; selected: string[]; onChange: (vals: string[]) => void; placeholder: string; width: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val: string) => {
    const next = selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val];
    onChange(next);
  };

  const label = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected[0]} +${selected.length - 1}`;

  return (
    <div ref={ref} className="relative" style={{ width }}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`h-8 w-full flex items-center justify-between px-3 text-xs border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${selected.length > 0 ? 'border-blue-400 text-blue-700 font-medium' : 'border-gray-200 text-gray-500'}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 ml-1 shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-56 overflow-y-auto" style={{ minWidth: width }}>
          {selected.length > 0 && (
            <button
              onMouseDown={e => { e.preventDefault(); onChange([]); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 border-b border-gray-100"
            >
              Clear selection
            </button>
          )}
          {options.map(opt => (
            <button
              key={opt}
              onMouseDown={e => { e.preventDefault(); toggle(opt); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-blue-50 hover:text-blue-700"
            >
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected.includes(opt) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                {selected.includes(opt) && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
              </span>
              <span className="truncate">{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContactsManager() {
  const { toast } = useToast();
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

  // Email verification state
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ total: number; verified: number; invalid: number; risky: number } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<TabType>('all');

  // Contact lists
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [listCampaigns, setListCampaigns] = useState<any[]>([]);
  const [listCampaignsLoading, setListCampaignsLoading] = useState(false);
  const [showListCampaigns, setShowListCampaigns] = useState(false);

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
  const [importListSearch, setImportListSearch] = useState('');
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
  
  // Assign list to member dialog state
  const [showAssignListDialog, setShowAssignListDialog] = useState(false);
  const [assignListId, setAssignListId] = useState('');
  const [assignListTargetUserId, setAssignListTargetUserId] = useState('');

  // Pipeline & Activity Log state
  const [activities, setActivities] = useState<any[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [showLogActivity, setShowLogActivity] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: 'call', outcome: '', notes: '', nextActionDate: '', nextActionType: '' });
  const [activitySaving, setActivitySaving] = useState(false);
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [followUpContacts, setFollowUpContacts] = useState<any[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Pagination & sorting
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const pageSize = 50;

  // Advanced filters
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [seniorityFilter, setSeniorityFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [employeeRange, setEmployeeRange] = useState('');
  const [emailVerification, setEmailVerification] = useState('');
  const [emailRatingGrade, setEmailRatingGrade] = useState('');
  const [tagsFilter, setTagsFilter] = useState('');
  const [leadFilterValue, setLeadFilterValue] = useState('');
  const [filterOptions, setFilterOptions] = useState<{ companies: string[]; designations: string[]; cities: string[]; countries: string[]; industries: string[]; departments: string[]; seniorities: string[]; tags: string[] }>({ companies: [], designations: [], cities: [], countries: [], industries: [], departments: [], seniorities: [], tags: [] });
  const [showFilters, setShowFilters] = useState(false);

  // === PR1: Column customization, density, select-all-matching ===
  type ColId = 'contact' | 'company' | 'designation' | 'pipeline' | 'mobile' | 'phone' | 'linkedin' | 'location' | 'nextAction' | 'lastRemark' | 'assigned' | 'quick';
  interface ColDef { id: ColId; label: string; width: number; visible: boolean; sortKey?: string; adminOnly?: boolean; }
  const DEFAULT_COLUMNS: ColDef[] = [
    { id: 'contact',     label: 'Contact',     width: 220, visible: true,  sortKey: 'firstName' },
    { id: 'company',     label: 'Company',     width: 150, visible: true,  sortKey: 'company' },
    { id: 'designation', label: 'Designation', width: 150, visible: true,  sortKey: 'jobTitle' },
    { id: 'pipeline',    label: 'Pipeline',    width: 120, visible: true,  sortKey: 'pipelineStage' },
    { id: 'mobile',      label: 'Mobile',      width: 115, visible: true,  sortKey: 'mobilePhone' },
    { id: 'phone',       label: 'Phone',       width: 115, visible: true,  sortKey: 'phone' },
    { id: 'linkedin',    label: 'LinkedIn',    width: 50,  visible: true },
    { id: 'location',    label: 'Location',    width: 130, visible: true,  sortKey: 'city' },
    { id: 'nextAction',  label: 'Next Action', width: 120, visible: true,  sortKey: 'nextActionDate' },
    { id: 'lastRemark',  label: 'Last Remark', width: 180, visible: true },
    { id: 'assigned',    label: 'Assigned',    width: 60,  visible: true,  adminOnly: true },
    { id: 'quick',       label: 'Quick',       width: 110, visible: true },
  ];
  const COL_STORAGE_KEY = 'aim_contacts_columns_v1';
  const DENSITY_STORAGE_KEY = 'aim_contacts_density_v1';
  const [columns, setColumns] = useState<ColDef[]>(() => {
    try {
      const raw = localStorage.getItem(COL_STORAGE_KEY);
      if (!raw) return DEFAULT_COLUMNS;
      const saved = JSON.parse(raw) as ColDef[];
      // merge: keep default order for unknown ids, apply saved width/visible
      const map = new Map(saved.map(c => [c.id, c]));
      const merged = DEFAULT_COLUMNS.map(d => ({ ...d, ...(map.get(d.id) || {}) }));
      // append any saved columns not in default (future-proofing) — none for now
      // reorder: saved order first
      const savedOrder = saved.map(c => c.id).filter(id => merged.find(m => m.id === id));
      const inOrder = savedOrder.map(id => merged.find(m => m.id === id)!).filter(Boolean);
      const rest = merged.filter(m => !savedOrder.includes(m.id));
      return [...inOrder, ...rest];
    } catch { return DEFAULT_COLUMNS; }
  });
  useEffect(() => {
    try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(columns)); } catch {}
  }, [columns]);
  const [density, setDensity] = useState<'comfortable' | 'compact' | 'condensed'>(() => {
    try { return (localStorage.getItem(DENSITY_STORAGE_KEY) as any) || 'comfortable'; } catch { return 'comfortable'; }
  });
  useEffect(() => { try { localStorage.setItem(DENSITY_STORAGE_KEY, density); } catch {} }, [density]);
  const [selectAllMatching, setSelectAllMatching] = useState(false); // true = all `total` contacts selected across pages
  const resizingColRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null);

  // PR2: Add-to-List dialog state
  const [showAddToListDialog, setShowAddToListDialog] = useState(false);
  const [addToListMode, setAddToListMode] = useState<'new' | 'existing'>('new');
  const [addToListExistingId, setAddToListExistingId] = useState('');
  const [addToListNewName, setAddToListNewName] = useState('');
  const [addToListNewDesc, setAddToListNewDesc] = useState('');
  const [addToListSearch, setAddToListSearch] = useState('');
  const [addToListSaving, setAddToListSaving] = useState(false);

  // PR2: Saved views state
  interface SavedView { id: string; name: string; createdAt: string; data: any; }
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');

  // PR2: Inline-edit state (one cell at a time)
  const [inlineEdit, setInlineEdit] = useState<{ contactId: string; field: 'nextAction' } | null>(null);

  // PR2: Keyboard nav — active row index (within current page)
  const [activeRowIdx, setActiveRowIdx] = useState<number>(-1);

  const setColWidth = (id: ColId, width: number) => {
    setColumns(prev => prev.map(c => c.id === id ? { ...c, width: Math.max(40, Math.min(600, width)) } : c));
  };
  const toggleColVisible = (id: ColId) => {
    setColumns(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  };
  const moveCol = (id: ColId, dir: -1 | 1) => {
    setColumns(prev => {
      const idx = prev.findIndex(c => c.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[to]] = [copy[to], copy[idx]];
      return copy;
    });
  };
  const resetColumns = () => setColumns(DEFAULT_COLUMNS);

  const startColResize = (e: React.MouseEvent, id: ColId) => {
    e.preventDefault(); e.stopPropagation();
    const col = columns.find(c => c.id === id);
    if (!col) return;
    resizingColRef.current = { id, startX: e.clientX, startW: col.width };
    const onMove = (ev: MouseEvent) => {
      const r = resizingColRef.current;
      if (!r) return;
      setColWidth(r.id, r.startW + (ev.clientX - r.startX));
    };
    const onUp = () => {
      resizingColRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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
  const [showApolloSyncDialog, setShowApolloSyncDialog] = useState(false);
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
  const [gsListSearch, setGsListSearch] = useState('');

  // AI Context Draft state
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftResult, setDraftResult] = useState<{ draft: string; contextUsed?: any } | null>(null);
  const [draftTone, setDraftTone] = useState('professional');
  const [draftInstructions, setDraftInstructions] = useState('');

  // Quick Send Email state
  const [showSendEmailDialog, setShowSendEmailDialog] = useState(false);
  const [sendEmailAccountId, setSendEmailAccountId] = useState('');
  const [sendEmailSubject, setSendEmailSubject] = useState('');
  const [sendEmailContent, setSendEmailContent] = useState('');
  const [sendEmailAccounts, setSendEmailAccounts] = useState<any[]>([]);
  const [sendEmailLoading, setSendEmailLoading] = useState(false);
  const [sendEmailResult, setSendEmailResult] = useState<any>(null);
  const [sendEmailMode, setSendEmailMode] = useState<'manual' | 'template' | 'ai'>('manual');
  const [sendEmailTemplates, setSendEmailTemplates] = useState<any[]>([]);
  const [sendEmailTemplateSearch, setSendEmailTemplateSearch] = useState('');
  const [sendEmailAiPrompt, setSendEmailAiPrompt] = useState('');
  const [sendEmailAiGenerating, setSendEmailAiGenerating] = useState(false);
  const sendEmailEditorRef = useRef<HTMLDivElement>(null);
  const [sendEmailEditorMode, setSendEmailEditorMode] = useState<'visual' | 'html'>('visual');

  // Hot Leads tab state
  const [hotLeads, setHotLeads] = useState<any[]>([]);
  const [hotLeadsTotal, setHotLeadsTotal] = useState(0);
  const [hotLeadsLoading, setHotLeadsLoading] = useState(false);
  const [hotLeadsBucket, setHotLeadsBucket] = useState('all');
  const [hotLeadsBucketCounts, setHotLeadsBucketCounts] = useState<Record<string, number>>({});
  const [hotLeadsPage, setHotLeadsPage] = useState(1);
  const [hotLeadsSearch, setHotLeadsSearch] = useState('');

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

  useEffect(() => { fetchContacts(); }, [debouncedSearch, statusFilter, activeListId, activeTab, assignFilterUserId, currentPage, sortBy, sortOrder, pipelineFilter, companyFilter, locationFilter, designationFilter, keywordFilter, seniorityFilter, industryFilter, employeeRange, emailVerification, emailRatingGrade, tagsFilter, leadFilterValue]);
  useEffect(() => { fetchContactLists(); fetchTeamMembers(); fetchFollowUps(); fetchFilterOptions(); fetchHotLeadsCounts(); }, []);

  // PR2: Keyboard navigation (j/k/arrows/Enter/e/c)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!contacts || contacts.length === 0) return;
      const key = e.key;
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setActiveRowIdx(i => {
          const next = Math.min(contacts.length - 1, (i < 0 ? 0 : i + 1));
          requestAnimationFrame(() => {
            const el = document.querySelector(`[data-row-idx="${next}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
      } else if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setActiveRowIdx(i => {
          const next = Math.max(0, (i < 0 ? 0 : i - 1));
          requestAnimationFrame(() => {
            const el = document.querySelector(`[data-row-idx="${next}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
      } else if (key === 'Enter') {
        if (activeRowIdx >= 0 && activeRowIdx < contacts.length) {
          e.preventDefault();
          openDetail(contacts[activeRowIdx]);
        }
      } else if (key === 'x' || key === ' ') {
        if (activeRowIdx >= 0 && activeRowIdx < contacts.length) {
          e.preventDefault();
          toggleSelect(contacts[activeRowIdx].id);
        }
      } else if (key === 'e') {
        const c = contacts[activeRowIdx];
        if (c?.email) { e.preventDefault(); window.location.href = `mailto:${c.email}`; }
      } else if (key === 'c') {
        const c = contacts[activeRowIdx] as any;
        const phone = c?.mobilePhone || c?.phone;
        if (phone) { e.preventDefault(); window.location.href = `tel:${phone}`; }
      } else if (key === 'Escape') {
        setActiveRowIdx(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contacts, activeRowIdx]);
  useEffect(() => {
    if (activeListId) {
      setListCampaigns([]);
      setShowListCampaigns(false);
      setListCampaignsLoading(true);
      fetch(`/api/contact-lists/${activeListId}/campaigns`, { credentials: 'include' })
        .then(r => r.json()).then(data => { setListCampaigns(Array.isArray(data) ? data : []); })
        .catch(() => setListCampaigns([]))
        .finally(() => setListCampaignsLoading(false));
    }
  }, [activeListId]);

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

      // Advanced filters
      if (pipelineFilter && pipelineFilter !== 'all') params.set('pipelineStage', pipelineFilter);
      if (companyFilter) params.set('company', companyFilter);
      if (locationFilter) params.set('location', locationFilter);
      if (designationFilter) params.set('designation', designationFilter);
      if (keywordFilter) params.set('keywordFilter', keywordFilter);
      if (seniorityFilter) params.set('seniorityFilter', seniorityFilter);
      if (industryFilter) params.set('industryFilter', industryFilter);
      if (employeeRange) params.set('employeeRange', employeeRange);
      if (emailVerification) params.set('emailVerification', emailVerification);
      if (emailRatingGrade) params.set('emailRatingGrade', emailRatingGrade);
      if (tagsFilter) params.set('tagsFilter', tagsFilter);
      if (leadFilterValue) params.set('leadFilter', leadFilterValue);

      // Pagination & sorting
      params.set('limit', String(pageSize));
      params.set('offset', String((currentPage - 1) * pageSize));
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);

      const res = await fetch(`/api/contacts?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.contacts || []);
        setContacts(list);
        setTotal(data.total ?? list.length);
      } else {
        console.error('Failed to fetch contacts:', res.status, await res.text().catch(() => ''));
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

  const fetchHotLeads = async () => {
    setHotLeadsLoading(true);
    try {
      const params = new URLSearchParams();
      if (hotLeadsBucket && hotLeadsBucket !== 'all') params.set('bucket', hotLeadsBucket);
      if (hotLeadsSearch) params.set('search', hotLeadsSearch);
      params.set('limit', '25');
      params.set('offset', String((hotLeadsPage - 1) * 25));
      const res = await fetch(`/api/contacts/hot-leads?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHotLeads(data.leads || []);
        setHotLeadsTotal(data.total || 0);
        setHotLeadsBucketCounts(data.bucketCounts || {});
      }
    } catch (e) { console.error('Failed to fetch hot leads:', e); }
    setHotLeadsLoading(false);
  };

  const handleAiDraft = async () => {
    if (!detailContact) return;
    setDraftLoading(true);
    setDraftResult(null);
    try {
      const res = await fetch('/api/context/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contactId: detailContact.id,
          contactEmail: detailContact.email,
          tone: draftTone,
          customInstructions: draftInstructions || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraftResult(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setDraftResult({ draft: `Error: ${err.message || 'Failed to generate draft'}` });
      }
    } catch (e: any) {
      setDraftResult({ draft: `Error: ${e.message}` });
    }
    setDraftLoading(false);
  };

  const fetchHotLeadsCounts = async () => {
    try {
      const res = await fetch('/api/contacts/hot-leads?limit=1', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHotLeadsBucketCounts(data.bucketCounts || {});
      }
    } catch {}
  };

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

  const handleAssignListToMember = async () => {
    if (!assignListId || !assignListTargetUserId) return;
    try {
      const res = await fetch(`/api/contact-lists/${assignListId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: assignListTargetUserId }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Successfully assigned ${data.assigned} contacts to team member.`);
        setShowAssignListDialog(false);
        setAssignListId('');
        setAssignListTargetUserId('');
        await fetchContacts();
        await fetchContactLists();
        await fetchTeamMembers();
      }
    } catch (e) { console.error('Failed to assign list:', e); }
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

  // Verify selected contacts or current list
  const handleVerifyEmails = async (mode: 'selected' | 'list' | 'all') => {
    if (verifyLoading) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      if (mode === 'selected' && selectedIds.length > 0) {
        const res = await fetch('/api/contacts/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ contactIds: selectedIds }),
        });
        if (res.ok) { setVerifyResult(await res.json()); await fetchContacts(); }
        else { const err = await res.json(); alert(err.message || 'Verification failed'); }
      } else {
        const res = await fetch('/api/contacts/verify-list', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ listId: mode === 'list' ? activeListId : null, statusFilter: 'unverified' }),
        });
        if (res.ok) { setVerifyResult(await res.json()); await fetchContacts(); }
        else { const err = await res.json(); alert(err.message || 'Verification failed'); }
      }
    } catch (e) { alert('Failed to verify emails'); }
    setVerifyLoading(false);
    setTimeout(() => setVerifyResult(null), 5000);
  };

  // Quick Send Email
  const openSendEmailDialog = async () => {
    if (selectedIds.length === 0) { alert('Select contacts first'); return; }
    setSendEmailSubject(''); setSendEmailContent(''); setSendEmailResult(null); setSendEmailLoading(false);
    setSendEmailMode('manual'); setSendEmailTemplateSearch(''); setSendEmailAiPrompt('');
    setSendEmailEditorMode('visual');
    try {
      const [accRes, tplRes] = await Promise.all([
        fetch('/api/email-accounts', { credentials: 'include' }),
        fetch('/api/templates/mine', { credentials: 'include' }),
      ]);
      if (accRes.ok) {
        const accounts = await accRes.json();
        setSendEmailAccounts(accounts);
        if (accounts.length > 0 && !sendEmailAccountId) setSendEmailAccountId(accounts[0].id);
      }
      if (tplRes.ok) {
        const templates = await tplRes.json();
        // Also fetch team templates
        const teamRes = await fetch('/api/templates/team', { credentials: 'include' });
        const teamTemplates = teamRes.ok ? await teamRes.json() : [];
        setSendEmailTemplates([...templates, ...teamTemplates]);
      }
    } catch (e) { console.error('Failed to load email accounts/templates:', e); }
    setShowSendEmailDialog(true);
    setTimeout(() => {
      if (sendEmailEditorRef.current) sendEmailEditorRef.current.innerHTML = '';
    }, 100);
  };

  const handleAiGenerate = async () => {
    if (!sendEmailAiPrompt.trim()) return;
    setSendEmailAiGenerating(true);
    try {
      const res = await fetch('/api/llm/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ prompt: sendEmailAiPrompt, type: 'template', format: 'html' }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.content || '';
        setSendEmailContent(content);
        if (data.subject) setSendEmailSubject(data.subject);
        setSendEmailMode('manual');
        setSendEmailEditorMode('visual');
        setTimeout(() => {
          if (sendEmailEditorRef.current) sendEmailEditorRef.current.innerHTML = content;
        }, 50);
      }
    } catch (e) { console.error('AI generation failed:', e); }
    setSendEmailAiGenerating(false);
  };

  const applyTemplate = (template: any) => {
    setSendEmailSubject(template.subject || '');
    setSendEmailContent(template.content || '');
    setSendEmailMode('manual');
    setSendEmailEditorMode('visual');
    setTimeout(() => {
      if (sendEmailEditorRef.current) sendEmailEditorRef.current.innerHTML = template.content || '';
    }, 50);
  };

  const handleSendEmail = async () => {
    // Sync content from visual editor before sending
    const content = (sendEmailEditorMode === 'visual' && sendEmailEditorRef.current)
      ? sendEmailEditorRef.current.innerHTML
      : sendEmailContent;
    if (!sendEmailAccountId || !sendEmailSubject.trim() || !content.trim()) return;
    setSendEmailContent(content);
    setSendEmailLoading(true); setSendEmailResult(null);
    try {
      const res = await fetch('/api/contacts/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ contactIds: selectedIds, emailAccountId: sendEmailAccountId, subject: sendEmailSubject, content }),
      });
      const data = await res.json();
      setSendEmailResult(data);
    } catch (e) { setSendEmailResult({ success: false, error: 'Failed to send emails' }); }
    setSendEmailLoading(false);
  };


  const handleDeleteList = async (listId: string) => {
    const deleteContacts = confirm('Delete this list AND all its contacts?\n\nClick OK to delete list + contacts (allows re-import).\nClick Cancel to keep contacts.');
    await fetch(`/api/contact-lists/${listId}?deleteContacts=${deleteContacts}`, { method: 'DELETE', credentials: 'include' });
    if (activeListId === listId) setActiveListId(null);
    await fetchContactLists();
    if (deleteContacts) await fetchContacts();
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
    fetchActivities(contact.id);
  };

  // Pipeline & Activity helpers
  const PIPELINE_STAGES = [
    { value: 'new', label: 'New', color: 'bg-gray-100 text-gray-700', icon: Target },
    { value: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700', icon: Send },
    { value: 'interested', label: 'Interested', color: 'bg-cyan-100 text-cyan-700', icon: Flame },
    { value: 'meeting_scheduled', label: 'Meeting Scheduled', color: 'bg-purple-100 text-purple-700', icon: CalendarClock },
    { value: 'meeting_done', label: 'Meeting Done', color: 'bg-indigo-100 text-indigo-700', icon: CheckCircle },
    { value: 'proposal_sent', label: 'Proposal Sent', color: 'bg-orange-100 text-orange-700', icon: FileText },
    { value: 'won', label: 'Won', color: 'bg-emerald-100 text-emerald-700', icon: Trophy },
    { value: 'lost', label: 'Lost', color: 'bg-red-100 text-red-700', icon: XOctagon },
  ];

  const ACTIVITY_TYPES = [
    { value: 'call', label: 'Call', icon: PhoneCall },
    { value: 'meeting', label: 'Meeting', icon: Users },
    { value: 'email', label: 'Email', icon: Mail },
    { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
    { value: 'note', label: 'Note', icon: FileText },
    { value: 'proposal', label: 'Proposal', icon: Send },
  ];

  const OUTCOMES = ['interested', 'not_interested', 'follow_up', 'no_answer', 'voicemail', 'converted', 'rejected'];

  const fetchActivities = async (contactId: string) => {
    setActivitiesLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activities`, { credentials: 'include' });
      if (res.ok) setActivities(await res.json());
    } catch { /* ignore */ }
    setActivitiesLoading(false);
  };

  // Deal dialog state (shown when moving to 'won')
  const [showDealDialog, setShowDealDialog] = useState(false);
  const [dealFormContactId, setDealFormContactId] = useState('');
  const [dealFormValue, setDealFormValue] = useState('');
  const [dealFormNotes, setDealFormNotes] = useState('');

  const updatePipeline = async (contactId: string, pipelineStage: string, nextActionDate?: string, nextActionType?: string, dealValue?: number, dealNotes?: string) => {
    // If moving to 'won' and no deal value provided, show dialog first
    if (pipelineStage === 'won' && dealValue === undefined) {
      setDealFormContactId(contactId);
      setDealFormValue('');
      setDealFormNotes('');
      setShowDealDialog(true);
      return;
    }
    setPipelineSaving(true);
    try {
      await fetch(`/api/contacts/${contactId}/pipeline`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ pipelineStage, nextActionDate: nextActionDate || undefined, nextActionType: nextActionType || undefined, dealValue, dealNotes }),
      });
      if (detailContact) setDetailContact({ ...detailContact, pipelineStage, nextActionDate, nextActionType, dealValue: dealValue || detailContact.dealValue, dealNotes: dealNotes || detailContact.dealNotes } as any);
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, pipelineStage, nextActionDate, nextActionType, dealValue: dealValue ?? (c as any).dealValue, dealNotes: dealNotes ?? (c as any).dealNotes } as any : c));
    } catch { /* ignore */ }
    setPipelineSaving(false);
  };

  const submitDealAndClose = () => {
    const val = parseFloat(dealFormValue) || 0;
    updatePipeline(dealFormContactId, 'won', undefined, undefined, val, dealFormNotes);
    setShowDealDialog(false);
  };

  const logActivity = async () => {
    if (!detailContact) return;
    setActivitySaving(true);
    try {
      const res = await fetch(`/api/contacts/${detailContact.id}/activities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(activityForm),
      });
      if (res.ok) {
        setShowLogActivity(false);
        setActivityForm({ type: 'call', outcome: '', notes: '', nextActionDate: '', nextActionType: '' });
        toast({ title: "Activity saved", description: "The activity has been logged successfully." });
        await fetchActivities(detailContact.id);
        // Refresh contact to get updated pipeline stage
        const cRes = await fetch(`/api/contacts/${detailContact.id}`, { credentials: 'include' });
        if (cRes.ok) { const c = await cRes.json(); setDetailContact(c); }
        // Refresh follow-ups list so completed/rescheduled items update immediately
        fetchFollowUps();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Failed to save activity", description: err.message || "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save activity", description: "Network error. Please try again.", variant: "destructive" });
    }
    setActivitySaving(false);
  };

  const fetchFollowUps = async () => {
    setFollowUpLoading(true);
    try {
      const res = await fetch('/api/contacts/follow-ups', { credentials: 'include' });
      if (res.ok) setFollowUpContacts(await res.json());
    } catch { /* ignore */ }
    setFollowUpLoading(false);
  };

  const fetchFilterOptions = async () => {
    try {
      const res = await fetch('/api/contacts/filter-options', { credentials: 'include' });
      if (res.ok) setFilterOptions(await res.json());
    } catch { /* ignore */ }
  };

  const handleSort = (col: string) => {
    if (sortBy === col) { setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }
    else { setSortBy(col); setSortOrder('asc'); }
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('all'); setPipelineFilter('all');
    setCompanyFilter(''); setLocationFilter(''); setDesignationFilter('');
    setKeywordFilter(''); setSeniorityFilter(''); setIndustryFilter('');
    setEmployeeRange(''); setEmailVerification(''); setEmailRatingGrade('');
    setTagsFilter(''); setAssignFilterUserId(''); setLeadFilterValue(''); setCurrentPage(1);
  };

  const hasActiveFilters = pipelineFilter !== 'all' || companyFilter || locationFilter || designationFilter || !!keywordFilter || !!seniorityFilter || !!industryFilter || !!employeeRange || !!emailVerification || !!emailRatingGrade || !!tagsFilter || !!leadFilterValue;

  const totalPages = Math.ceil(total / pageSize);

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

  const LEAD_BUCKET_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
    hot_lead: { label: 'Hot Lead', bg: 'bg-red-100', text: 'text-red-700', icon: '🔥' },
    warm_lead: { label: 'Warm', bg: 'bg-orange-100', text: 'text-orange-700', icon: '🌡' },
    past_customer: { label: 'Past Customer', bg: 'bg-purple-100', text: 'text-purple-700', icon: '💎' },
    churned: { label: 'Churned', bg: 'bg-gray-200', text: 'text-gray-700', icon: '📉' },
    active_conversation: { label: 'Active', bg: 'bg-green-100', text: 'text-green-700', icon: '💬' },
    cold_outreach: { label: 'Cold Outreach', bg: 'bg-blue-100', text: 'text-blue-700', icon: '📧' },
    newsletter: { label: 'Newsletter', bg: 'bg-cyan-100', text: 'text-cyan-700', icon: '📰' },
    vendor: { label: 'Vendor', bg: 'bg-slate-100', text: 'text-slate-600', icon: '🏢' },
    internal: { label: 'Internal', bg: 'bg-indigo-100', text: 'text-indigo-700', icon: '🏠' },
    job_applicant: { label: 'Applicant', bg: 'bg-teal-100', text: 'text-teal-700', icon: '📋' },
    unknown: { label: 'Unknown', bg: 'bg-gray-100', text: 'text-gray-500', icon: '❓' },
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
        setContacts(prev => prev.map(c => c.id === contactId ? { ...c, emailRating: data.rating, emailRatingGrade: data.grade, emailRatingDetails: data.details } : c));
        if (detailContact?.id === contactId) {
          setDetailContact(prev => prev ? { ...prev, emailRating: data.rating, emailRatingGrade: data.grade, emailRatingDetails: data.details } : prev);
        }
        toast({ title: "Rating calculated", description: `Score: ${data.rating}/100 (Grade ${data.grade})` });
      } else {
        toast({ title: "Rating failed", description: "Could not calculate rating.", variant: "destructive" });
      }
    } catch (e) { console.error('Rating calculation failed:', e); toast({ title: "Rating failed", description: "Network error.", variant: "destructive" }); }
    setRatingLoading(null);
  };

  const toggleSelect = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); setSelectAllMatching(false); };
  const toggleSelectAll = () => { setSelectedIds(selectedIds.length === contacts.length ? [] : contacts.map(c => c.id)); setSelectAllMatching(false); };

  // PR2: build current filter payload (used by add-to-list select-all-matching path)
  const buildFilterPayload = () => ({
    search: debouncedSearch || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    listId: activeListId || undefined,
    assignedTo: assignFilterUserId || undefined,
    pipelineStage: pipelineFilter !== 'all' ? pipelineFilter : undefined,
    company: companyFilter || undefined,
    location: locationFilter || undefined,
    designation: designationFilter || undefined,
    keywordFilter: keywordFilter || undefined,
    seniorityFilter: seniorityFilter || undefined,
    industryFilter: industryFilter || undefined,
    employeeRange: employeeRange || undefined,
    emailVerification: emailVerification || undefined,
    emailRatingGrade: emailRatingGrade || undefined,
    tagsFilter: tagsFilter || undefined,
    leadFilter: leadFilterValue || undefined,
  });

  // PR2: Add selected contacts to a new or existing list
  const submitAddToList = async () => {
    if (addToListMode === 'new' && !addToListNewName.trim()) { toast({ title: 'List name required', variant: 'destructive' }); return; }
    if (addToListMode === 'existing' && !addToListExistingId) { toast({ title: 'Pick a list', variant: 'destructive' }); return; }
    setAddToListSaving(true);
    try {
      const body: any = {};
      if (addToListMode === 'new') body.newList = { name: addToListNewName.trim(), description: addToListNewDesc.trim() || undefined };
      else body.listId = addToListExistingId;
      if (selectAllMatching) body.filter = buildFilterPayload();
      else body.contactIds = selectedIds;

      const res = await fetch('/api/contact-lists/add-contacts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to add');
      toast({
        title: `Added ${data.added} contact${data.added === 1 ? '' : 's'} to "${data.listName}"`,
        description: data.moved > 0 ? `${data.moved} were moved from another list.` : undefined,
      });
      setShowAddToListDialog(false);
      setAddToListNewName(''); setAddToListNewDesc(''); setAddToListExistingId(''); setAddToListSearch('');
      setSelectedIds([]); setSelectAllMatching(false);
      await fetchContacts();
      await fetchContactLists();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setAddToListSaving(false);
    }
  };

  // PR2: Saved views — load/save/delete
  const fetchSavedViews = async () => {
    try {
      const res = await fetch('/api/my/contact-views', { credentials: 'include' });
      if (res.ok) setSavedViews(await res.json());
    } catch {}
  };
  useEffect(() => { fetchSavedViews(); }, []);

  const saveCurrentView = async () => {
    if (!saveViewName.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    const data = {
      filters: {
        search, statusFilter, pipelineFilter, companyFilter, locationFilter,
        designationFilter, keywordFilter, seniorityFilter, industryFilter,
        employeeRange, emailVerification, emailRatingGrade, tagsFilter,
        leadFilterValue, assignFilterUserId, activeListId, activeTab,
      },
      sort: { sortBy, sortOrder },
      columns, density,
    };
    try {
      const res = await fetch('/api/my/contact-views', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveViewName.trim(), data }),
      });
      if (!res.ok) throw new Error('Save failed');
      await fetchSavedViews();
      setShowSaveViewDialog(false);
      setSaveViewName('');
      toast({ title: `View "${saveViewName.trim()}" saved` });
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  };

  const applyView = (v: SavedView) => {
    const d = v.data || {};
    if (d.filters) {
      setSearch(d.filters.search || '');
      setStatusFilter(d.filters.statusFilter || 'all');
      setPipelineFilter(d.filters.pipelineFilter || 'all');
      setCompanyFilter(d.filters.companyFilter || '');
      setLocationFilter(d.filters.locationFilter || '');
      setDesignationFilter(d.filters.designationFilter || '');
      setKeywordFilter(d.filters.keywordFilter || '');
      setSeniorityFilter(d.filters.seniorityFilter || '');
      setIndustryFilter(d.filters.industryFilter || '');
      setEmployeeRange(d.filters.employeeRange || '');
      setEmailVerification(d.filters.emailVerification || '');
      setEmailRatingGrade(d.filters.emailRatingGrade || '');
      setTagsFilter(d.filters.tagsFilter || '');
      setLeadFilterValue(d.filters.leadFilterValue || '');
      setAssignFilterUserId(d.filters.assignFilterUserId || '');
      setActiveListId(d.filters.activeListId || '');
      if (d.filters.activeTab) setActiveTab(d.filters.activeTab);
    }
    if (d.sort) { setSortBy(d.sort.sortBy || 'createdAt'); setSortOrder(d.sort.sortOrder || 'desc'); }
    if (Array.isArray(d.columns)) setColumns(d.columns);
    if (d.density) setDensity(d.density);
    setCurrentPage(1);
    toast({ title: `Applied view "${v.name}"` });
  };

  const deleteView = async (id: string, name: string) => {
    if (!confirm(`Delete view "${name}"?`)) return;
    try {
      const res = await fetch(`/api/my/contact-views/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Delete failed');
      await fetchSavedViews();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  };

  // PR2: Inline update for nextAction date
  const updateNextAction = async (contactId: string, date: string) => {
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextActionDate: date || null }),
      });
      if (!res.ok) throw new Error('Update failed');
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, nextActionDate: date || null } as any : c));
      setInlineEdit(null);
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  };

  // PR1: CSV export of current filtered view (respects visible columns)
  const exportVisibleCsv = () => {
    const visCols = columns.filter(c => c.visible && c.id !== 'quick');
    const headers = ['Email', ...visCols.map(c => c.label)];
    const rows = contacts.map(ct => {
      const cells: string[] = [ct.email || ''];
      for (const col of visCols) {
        let v = '';
        switch (col.id) {
          case 'contact':    v = `${ct.firstName || ''} ${ct.lastName || ''}`.trim(); break;
          case 'company':    v = ct.company || ''; break;
          case 'designation':v = ct.jobTitle || ''; break;
          case 'pipeline':   v = (ct as any).pipelineStage || 'new'; break;
          case 'mobile':     v = ct.mobilePhone || ''; break;
          case 'phone':      v = (ct as any).phone || ''; break;
          case 'linkedin':   v = (ct as any).linkedinUrl || ''; break;
          case 'location':   v = [(ct as any).city, (ct as any).country].filter(Boolean).join(', '); break;
          case 'nextAction': v = (ct as any).nextActionDate ? `${(ct as any).nextActionDate} ${(ct as any).nextActionType || ''}`.trim() : ''; break;
          case 'lastRemark': v = (ct as any).lastRemark || ''; break;
          case 'assigned': {
            const m = (ct as any).assignedTo ? teamMembers.find((tm: any) => tm.userId === (ct as any).assignedTo) : null;
            v = m ? (m.firstName || m.email?.split('@')[0] || '') : '';
            break;
          }
        }
        cells.push(v);
      }
      return cells;
    });
    const csv = [headers, ...rows].map(r =>
      r.map(c => {
        const s = String(c ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
                  <DropdownMenuItem onClick={() => setShowApolloSyncDialog(true)}>
                    <Zap className="h-4 w-4 mr-2 text-purple-600" /> Sync from Apollo
                  </DropdownMenuItem>
                )}
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
                  toast({ title: "Calculating ratings...", description: "This may take a moment for large lists." });
                  try {
                    const res = await fetch('/api/contacts/batch-rating', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                      body: JSON.stringify({ useAI: false }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setBatchRatingProgress({ processed: data.total || 0, total: data.total || 0 });
                      toast({ title: "Rating started", description: `Rating ${data.total || 0} contacts in background. Refresh in a minute to see results.` });
                    } else {
                      toast({ title: "Rating failed", description: "Server error. Please try again.", variant: "destructive" });
                    }
                    // Auto-refresh after 30s to pick up background results
                    setTimeout(() => fetchContacts(), 30000);
                  } catch (e) { console.error('Batch rating failed:', e); toast({ title: "Rating failed", description: "Network error.", variant: "destructive" }); }
                  setTimeout(() => { setRatingLoading(null); setBatchRatingProgress(null); }, 3000);
                }}>
                  <BarChart3 className="h-4 w-4 mr-2 text-orange-500" /> {ratingLoading === 'batch' ? 'Calculating...' : 'Calculate Ratings'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  if (ratingLoading) return;
                  setRatingLoading('batch-ai');
                  toast({ title: "AI Rating in progress...", description: "Azure OpenAI is scoring reply quality." });
                  try {
                    const res = await fetch('/api/contacts/batch-rating', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                      body: JSON.stringify({ useAI: true }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setBatchRatingProgress({ processed: data.total || 0, total: data.total || 0 });
                      toast({ title: "AI Rating started", description: `Scoring ${data.total || 0} contacts with Azure OpenAI in background. Refresh in a few minutes.` });
                    } else {
                      toast({ title: "AI Rating failed", description: "Server error. Please try again.", variant: "destructive" });
                    }
                    // Auto-refresh after 60s for AI rating (takes longer)
                    setTimeout(() => fetchContacts(), 60000);
                  } catch (e) { console.error('AI batch rating failed:', e); toast({ title: "AI Rating failed", description: "Network error.", variant: "destructive" }); }
                  setTimeout(() => { setRatingLoading(null); setBatchRatingProgress(null); }, 3000);
                }}>
                  <Sparkles className="h-4 w-4 mr-2 text-purple-500" /> {ratingLoading === 'batch-ai' ? 'AI Scoring...' : 'AI Rate (Azure OpenAI)'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleVerifyEmails(selectedIds.length > 0 ? 'selected' : activeListId ? 'list' : 'all')} disabled={verifyLoading}>
                  <MailCheck className="h-4 w-4 mr-2 text-emerald-500" />
                  {verifyLoading ? 'Verifying...' : selectedIds.length > 0 ? `Verify Selected (${selectedIds.length})` : activeListId ? 'Verify This List' : 'Verify All Unverified'}
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

        {/* Verification result/progress banner */}
        {(verifyLoading || verifyResult) && (
          <div className={`mx-4 mt-2 px-4 py-2 rounded-lg border text-sm flex items-center gap-2 ${
            verifyLoading ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            {verifyLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Verifying emails... This may take a while (1 email/sec)</>
            ) : verifyResult && (
              <>
                <ShieldCheck className="h-4 w-4" />
                Verified {verifyResult.total} emails: <strong className="text-green-600">{verifyResult.verified} valid</strong>,
                <strong className="text-red-600">{verifyResult.invalid} invalid</strong>,
                <strong className="text-amber-600">{verifyResult.risky} risky</strong>
                <button onClick={() => setVerifyResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600"><X className="h-3.5 w-3.5" /></button>
              </>
            )}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex items-center border-b border-gray-200">
          {([
            { key: 'all' as TabType, label: 'All', count: tabCounts.all, icon: Users },
            { key: 'unsubscribers' as TabType, label: 'Unsubscribers', count: tabCounts.unsubscribers, icon: ShieldX },
            { key: 'blocklist' as TabType, label: 'Blocklist', count: tabCounts.blocklist, icon: Ban },
            { key: 'lists' as TabType, label: 'Your lists', count: tabCounts.lists, icon: LayoutList },
            { key: 'follow-ups' as TabType, label: 'Follow-ups', count: followUpContacts.length, icon: CalendarClock },
            { key: 'hot-leads' as TabType, label: 'AI Leads', count: Object.values(hotLeadsBucketCounts).reduce((a, b) => a + b, 0), icon: Flame },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setActiveListId(null); setSelectedIds([]); setSearch(''); setStatusFilter('all'); setCurrentPage(1); if (tab.key === 'follow-ups') fetchFollowUps(); if (tab.key === 'hot-leads') fetchHotLeads(); }}
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
                <div className="grid grid-cols-[1fr_100px_100px_120px_100px_100px_48px] gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">List Name</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Source</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Uploaded By</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Allocated To</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-center">Contacts</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Created</div>
                  <div></div>
                </div>
                {contactLists
                  .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()))
                  .map(list => (
                  <div
                    key={list.id}
                    className="grid grid-cols-[1fr_100px_100px_120px_100px_100px_48px] gap-4 px-5 py-3.5 border-b border-gray-50 items-center hover:bg-blue-50/30 cursor-pointer transition-all group"
                    onClick={() => { setActiveListId(list.id); setCurrentPage(1); }}
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
                    <div className="text-xs text-gray-500 truncate">
                      {list.uploadedByName || <span className="text-gray-300">-</span>}
                    </div>
                    <div className="text-xs truncate">
                      {list.allocatedToName
                        ? <span className="text-indigo-600 font-medium">{list.allocatedToName}</span>
                        : <span className="text-gray-300">-</span>}
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
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setActiveListId(list.id)}>
                            <Eye className="h-3.5 w-3.5 mr-2" /> View Contacts
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setRenameListId(list.id); setRenameListValue(list.name); setShowRenameListDialog(true); }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                          </DropdownMenuItem>
                          {isAdmin && teamMembers.length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => { setAssignListId(list.id); setAssignListTargetUserId(''); setShowAssignListDialog(true); }}>
                                <UserPlus className="h-3.5 w-3.5 mr-2" /> Allocate to Member
                              </DropdownMenuItem>
                            </>
                          )}
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

            {/* Campaigns collapsible panel */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                onClick={() => setShowListCampaigns(v => !v)}
              >
                <span className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                  <span>Campaigns using this list</span>
                  {listCampaignsLoading
                    ? <span className="text-gray-400">Loading...</span>
                    : <span className="bg-indigo-100 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{listCampaigns.length}</span>
                  }
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${showListCampaigns ? 'rotate-180' : ''}`} />
              </button>
              {showListCampaigns && (
                <div className="divide-y divide-gray-50">
                  {listCampaigns.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-400">No campaigns found for this list.</div>
                  ) : listCampaigns.map((camp: any) => (
                    <div key={camp.id} className="grid grid-cols-[1fr_90px_110px_80px] gap-3 px-4 py-2.5 items-center hover:bg-gray-50">
                      <div className="text-xs font-medium text-gray-800 truncate">{camp.name}</div>
                      <div>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${
                          camp.status === 'active' ? 'bg-green-100 text-green-700'
                          : camp.status === 'completed' ? 'bg-blue-100 text-blue-700'
                          : camp.status === 'paused' ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-500'
                        }`}>{camp.status}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{camp.createdByName || '-'}</div>
                      <div className="text-xs text-gray-400 text-right">{camp.sentCount ?? 0} sent</div>
                    </div>
                  ))}
                </div>
              )}
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
                <AlertDescription className="text-sm text-red-700 flex items-center justify-between">
                  <span>These contacts have bounced and are on the blocklist. They will be <strong>automatically excluded</strong> from all future email campaigns to protect your sender reputation.</span>
                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    {selectedIds.length > 0 && (
                      <button
                        className="px-3 py-1.5 text-xs font-medium bg-white border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 transition-all"
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/contacts/unbounce', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                              body: JSON.stringify({ contactIds: selectedIds }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              alert(`${data.updated} contact(s) removed from blocklist`);
                              setSelectedIds([]);
                              window.location.reload();
                            }
                          } catch { alert('Failed to unbounce contacts'); }
                        }}
                      >
                        Unbounce Selected ({selectedIds.length})
                      </button>
                    )}
                  </div>
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

        {/* ── Follow-ups tab ── */}
        {activeTab === 'follow-ups' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Today's Follow-ups</h3>
                <p className="text-sm text-gray-500">Contacts with actions due today or overdue</p>
              </div>
              <Button size="sm" variant="outline" onClick={fetchFollowUps} disabled={followUpLoading}>
                {followUpLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Refresh
              </Button>
            </div>
            {followUpLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : followUpContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
                  <CheckCircle className="h-10 w-10 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1.5">All caught up!</h3>
                <p className="text-sm text-gray-400">No follow-ups due today. Log activities on contacts to schedule follow-ups.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {followUpContacts.map((c: any) => {
                  const isOverdue = c.nextActionDate && new Date(c.nextActionDate) < new Date(new Date().toISOString().split('T')[0]);
                  const stage = PIPELINE_STAGES.find(s => s.value === (c.pipelineStage || 'new'));
                  return (
                    <div key={c.id}
                      onClick={() => openDetail(c)}
                      className={`flex items-center gap-4 p-3 rounded-xl border cursor-pointer hover:shadow-sm transition ${isOverdue ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'}`}>
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(c.email)} text-white text-xs font-semibold`}>
                          {getInitials(c.firstName, c.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{c.firstName} {c.lastName}</span>
                          {stage && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${stage.color}`}>{stage.label}</span>}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{c.company ? `${c.company} · ` : ''}{c.email}</div>
                        {c.lastRemark && <div className="text-xs text-gray-400 mt-0.5 truncate italic">"{c.lastRemark}"</div>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                          {isOverdue ? 'Overdue' : 'Today'}
                        </div>
                        <div className="text-[10px] text-gray-400 capitalize">{c.nextActionType || 'follow-up'}</div>
                        {c.nextActionDate && <div className="text-[10px] text-gray-300">{new Date(c.nextActionDate).toLocaleDateString()}</div>}
                        {c.assignedToName && <div className="text-[10px] text-indigo-500 font-medium mt-0.5">{c.assignedToName}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AI Leads (Hot Leads) tab ── */}
        {activeTab === 'hot-leads' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" /> AI Lead Intelligence
                </h3>
                <p className="text-sm text-gray-500">Contacts classified by AI from your email history scan</p>
              </div>
              <Button size="sm" variant="outline" onClick={fetchHotLeads} disabled={hotLeadsLoading}>
                {hotLeadsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Refresh
              </Button>
            </div>

            {/* Bucket filter pills */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all', label: 'All Actionable', icon: '📊' },
                { key: 'hot_lead', label: 'Hot Leads', icon: '🔥' },
                { key: 'warm_lead', label: 'Warm Leads', icon: '🌡' },
                { key: 'past_customer', label: 'Past Customers', icon: '💎' },
                { key: 'churned', label: 'Churned', icon: '📉' },
                { key: 'active_conversation', label: 'Active', icon: '💬' },
                { key: 'cold_outreach', label: 'Cold Outreach', icon: '📧' },
              ].map(b => (
                <button key={b.key}
                  onClick={() => { setHotLeadsBucket(b.key); setHotLeadsPage(1); setTimeout(fetchHotLeads, 50); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    hotLeadsBucket === b.key
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  <span>{b.icon}</span> {b.label}
                  {hotLeadsBucketCounts[b.key] ? (
                    <span className={`text-[10px] px-1 rounded-full ${hotLeadsBucket === b.key ? 'bg-white/20' : 'bg-gray-200'}`}>
                      {hotLeadsBucketCounts[b.key]}
                    </span>
                  ) : null}
                </button>
              ))}
              <div className="ml-auto relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <Input
                  placeholder="Search leads..."
                  value={hotLeadsSearch}
                  onChange={(e) => { setHotLeadsSearch(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchHotLeads(); }}
                  className="pl-8 h-8 w-48 text-xs"
                />
              </div>
            </div>

            {/* Leads list */}
            {hotLeadsLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : hotLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="bg-gradient-to-br from-orange-50 to-amber-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
                  <Sparkles className="h-10 w-10 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1.5">No AI leads found</h3>
                <p className="text-sm text-gray-400 text-center max-w-sm">
                  Run the AI Lead Intelligence scan from the Lead Opportunities page to classify your contacts from email history.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {hotLeads.map((lead: any) => {
                  const bucketCfg = LEAD_BUCKET_CONFIG[lead.bucket] || LEAD_BUCKET_CONFIG.unknown;
                  return (
                    <div key={lead.id} className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:shadow-sm transition cursor-pointer"
                      onClick={() => {
                        if (lead.contactId) {
                          const c = { id: lead.contactId, email: lead.contactEmail, firstName: lead.firstName || lead.contactName?.split(' ')[0] || '', lastName: lead.lastName || lead.contactName?.split(' ').slice(1).join(' ') || '', company: lead.contactCompany || lead.company || '', jobTitle: lead.jobTitle || '', status: lead.contactStatus || 'cold' } as any;
                          openDetail(c);
                        }
                      }}>
                      <Avatar className="h-10 w-10 flex-shrink-0 shadow-sm">
                        <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(lead.contactEmail)} text-white text-xs font-semibold`}>
                          {(lead.contactName || lead.contactEmail || '?')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {lead.contactName || lead.contactEmail}
                          </span>
                          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${bucketCfg.bg} ${bucketCfg.text}`}>
                            {bucketCfg.icon} {bucketCfg.label}
                          </span>
                          <span className="text-[10px] text-gray-400">{lead.confidence}% confidence</span>
                          {lead.pipelineStage && lead.pipelineStage !== 'new' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium capitalize">{lead.pipelineStage.replace('_', ' ')}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mb-1.5">
                          {lead.contactEmail}
                          {(lead.contactCompany || lead.company) && <span className="ml-2 text-gray-400">at {lead.contactCompany || lead.company}</span>}
                          {lead.jobTitle && <span className="ml-2 text-gray-400">({lead.jobTitle})</span>}
                        </div>
                        {lead.aiReasoning && (
                          <p className="text-xs text-gray-600 mb-1 line-clamp-2">{lead.aiReasoning}</p>
                        )}
                        {lead.suggestedAction && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Zap className="h-3 w-3 text-amber-500" />
                            <span className="text-xs text-amber-700 font-medium">{lead.suggestedAction}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 space-y-1">
                        <div className="text-[10px] text-gray-400">
                          {lead.totalEmails || 0} emails ({lead.totalReceived || 0} received)
                        </div>
                        {lead.lastEmailDate && (
                          <div className="text-[10px] text-gray-300">
                            Last: {new Date(lead.lastEmailDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        )}
                        {lead.accountEmail && (
                          <div className="text-[10px] text-gray-300 truncate max-w-[120px]" title={lead.accountEmail}>
                            via {lead.accountEmail.split('@')[0]}
                          </div>
                        )}
                        {/* Engagement indicators from contacts table */}
                        {(lead.totalOpened > 0 || lead.totalClicked > 0 || lead.totalReplied > 0) && (
                          <div className="flex items-center gap-2 justify-end mt-1">
                            {lead.totalOpened > 0 && <span className="text-[9px] text-green-600" title="Opens">{lead.totalOpened} opens</span>}
                            {lead.totalClicked > 0 && <span className="text-[9px] text-blue-600" title="Clicks">{lead.totalClicked} clicks</span>}
                            {lead.totalReplied > 0 && <span className="text-[9px] text-purple-600" title="Replies">{lead.totalReplied} replies</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Pagination */}
                {hotLeadsTotal > 25 && (
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-xs text-gray-400">Showing {((hotLeadsPage - 1) * 25) + 1}-{Math.min(hotLeadsPage * 25, hotLeadsTotal)} of {hotLeadsTotal}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" disabled={hotLeadsPage <= 1} onClick={() => { setHotLeadsPage(p => p - 1); setTimeout(fetchHotLeads, 50); }} className="h-7 text-xs">Prev</Button>
                      <span className="text-xs text-gray-500 px-2">Page {hotLeadsPage}</span>
                      <Button variant="outline" size="sm" disabled={hotLeadsPage * 25 >= hotLeadsTotal} onClick={() => { setHotLeadsPage(p => p + 1); setTimeout(fetchHotLeads, 50); }} className="h-7 text-xs">Next</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
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

              {/* AI Lead Intelligence Card */}
              {detailContact.leadBucket && detailContact.leadBucket !== 'unknown' && (() => {
                const cfg = LEAD_BUCKET_CONFIG[detailContact.leadBucket] || LEAD_BUCKET_CONFIG.unknown;
                return (
                  <div className={`border rounded-xl p-3 ${cfg.bg} border-opacity-50`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">AI Lead Intelligence</span>
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} ml-auto`}>
                        {cfg.icon} {cfg.label} ({detailContact.leadConfidence}%)
                      </span>
                    </div>
                    {detailContact.aiReasoning && (
                      <p className="text-xs text-gray-700 mb-1.5">{detailContact.aiReasoning}</p>
                    )}
                    {detailContact.suggestedAction && (
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-3 w-3 text-amber-500" />
                        <span className="text-xs text-amber-800 font-medium">{detailContact.suggestedAction}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                      {detailContact.leadTotalEmails != null && <span>{detailContact.leadTotalEmails} total emails</span>}
                      {detailContact.leadTotalReceived != null && <span>{detailContact.leadTotalReceived} received</span>}
                      {detailContact.lastEmailDate && <span>Last: {new Date(detailContact.lastEmailDate).toLocaleDateString()}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Pipeline Stage */}
              <div className="border border-gray-100 rounded-xl p-3 bg-gradient-to-br from-blue-50/30 to-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide flex items-center gap-1"><Target className="h-3 w-3" /> Pipeline Stage</div>
                  {pipelineSaving && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PIPELINE_STAGES.map(stage => (
                    <button key={stage.value}
                      onClick={() => updatePipeline(detailContact.id, stage.value)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition ${
                        detailContact.pipelineStage === stage.value || (!(detailContact.pipelineStage) && stage.value === 'new')
                          ? stage.color + ' border-current shadow-sm'
                          : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                      }`}>
                      <stage.icon className="h-3 w-3" />
                      {stage.label}
                    </button>
                  ))}
                </div>
                {/* Next Action */}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                  <Clock className="h-3 w-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Next Action:</span>
                  {detailContact.nextActionDate ? (
                    <span className={`text-xs font-medium ${new Date(detailContact.nextActionDate) < new Date(new Date().toISOString().split('T')[0]) ? 'text-red-600' : 'text-gray-700'}`}>
                      {new Date(detailContact.nextActionDate).toLocaleDateString()} — <span className="capitalize">{detailContact.nextActionType || 'follow-up'}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">None scheduled</span>
                  )}
                </div>
                {/* Deal Value — shown for won/lost contacts */}
                {(detailContact.pipelineStage === 'won' || detailContact.pipelineStage === 'lost') && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold">Deal:</span>
                    <span className={`text-xs font-bold ${detailContact.pipelineStage === 'won' ? 'text-green-700' : 'text-red-500'}`}>
                      {(detailContact as any).dealValue ? `₹${Number((detailContact as any).dealValue).toLocaleString('en-IN')}` : 'No value set'}
                    </span>
                    {(detailContact as any).dealNotes && <span className="text-[10px] text-gray-500">— {(detailContact as any).dealNotes}</span>}
                    {(detailContact as any).dealClosedAt && <span className="text-[10px] text-gray-400 ml-auto">{new Date((detailContact as any).dealClosedAt).toLocaleDateString()}</span>}
                  </div>
                )}
              </div>

              {/* Activity Log */}
              <div className="border border-gray-100 rounded-xl p-3 bg-gradient-to-br from-gray-50/50 to-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Activity Log</div>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-blue-600 hover:text-blue-700"
                    onClick={() => { setShowLogActivity(true); setActivityForm({ type: 'call', outcome: '', notes: '', nextActionDate: '', nextActionType: '' }); }}>
                    <Plus className="h-3 w-3 mr-1" /> Log Activity
                  </Button>
                </div>

                {/* Log Activity Form (inline) */}
                {showLogActivity && (
                  <div className="mb-3 p-2.5 bg-blue-50 rounded-lg border border-blue-100 space-y-2">
                    <div className="flex gap-2">
                      <Select value={activityForm.type} onValueChange={v => setActivityForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={activityForm.outcome} onValueChange={v => setActivityForm(f => ({ ...f, outcome: v }))}>
                        <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Outcome" /></SelectTrigger>
                        <SelectContent>
                          {OUTCOMES.map(o => (
                            <SelectItem key={o} value={o} className="text-xs capitalize">{o.replace(/_/g, ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      placeholder="Notes / remarks..."
                      value={activityForm.notes}
                      onChange={e => setActivityForm(f => ({ ...f, notes: e.target.value }))}
                      className="text-xs h-16 resize-none"
                    />
                    <div className="flex gap-2">
                      <Input type="date" className="h-8 text-xs flex-1"
                        value={activityForm.nextActionDate}
                        onChange={e => setActivityForm(f => ({ ...f, nextActionDate: e.target.value }))}
                        placeholder="Next follow-up date" />
                      <Select value={activityForm.nextActionType} onValueChange={v => setActivityForm(f => ({ ...f, nextActionType: v }))}>
                        <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Next action" /></SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogActivity(false)}>Cancel</Button>
                      <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" disabled={activitySaving} onClick={logActivity}>
                        {activitySaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        {activitySaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                {activitiesLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
                ) : activities.length === 0 ? (
                  <div className="text-center py-4 text-xs text-gray-400">
                    <MessageSquare className="h-5 w-5 mx-auto mb-1 text-gray-300" />
                    No activities logged yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {activities.slice(0, 10).map((a: any) => {
                      const aType = ACTIVITY_TYPES.find(t => t.value === a.type);
                      const Icon = aType?.icon || FileText;
                      return (
                        <div key={a.id} className="flex gap-2 p-2 rounded-lg hover:bg-gray-50 transition">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                            <Icon className="h-3 w-3 text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-700 capitalize">{a.type}</span>
                              {a.outcome && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{a.outcome.replace(/_/g, ' ')}</span>}
                            </div>
                            {a.notes && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.notes}</div>}
                            <div className="text-[10px] text-gray-300 mt-0.5">
                              {new Date(a.createdAt).toLocaleDateString()} {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {a.userFirstName && ` · ${a.userFirstName}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

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
                  { label: 'Email Verified', value: detailContact.emailVerificationStatus && detailContact.emailVerificationStatus !== 'unverified' ? `${detailContact.emailVerificationStatus}${detailContact.emailVerifiedAt ? ' (' + new Date(detailContact.emailVerifiedAt).toLocaleDateString() + ')' : ''}` : null, icon: MailCheck },
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
                {detailContact.emailRatingUpdatedAt ? (
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
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => { setShowContactDetail(false); if (detailContact) openEdit(detailContact); }}>
              <Edit className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => { setDraftResult(null); setDraftInstructions(''); setShowDraftDialog(true); }}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> AI Draft Email
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowContactDetail(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Context-Aware Draft Dialog */}
      <Dialog open={showDraftDialog} onOpenChange={setShowDraftDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" /> AI Draft Email
            </DialogTitle>
            <DialogDescription>
              Generate a context-aware email using your knowledge base, email history, and lead intelligence data
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Tone selector */}
            <div>
              <Label className="text-xs font-medium">Tone</Label>
              <div className="flex gap-1.5 mt-1.5">
                {['professional', 'friendly', 'concise', 'formal', 'persuasive'].map(t => (
                  <button key={t} onClick={() => setDraftTone(t)}
                    className={`text-xs px-3 py-1.5 rounded-lg capitalize transition ${
                      draftTone === t ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>{t}</button>
                ))}
              </div>
            </div>

            {/* Custom instructions */}
            <div>
              <Label className="text-xs font-medium">Custom Instructions (optional)</Label>
              <Textarea
                value={draftInstructions}
                onChange={e => setDraftInstructions(e.target.value)}
                placeholder="e.g., Mention our recent award, propose a meeting next week, focus on their need for email automation..."
                className="mt-1 min-h-[60px] text-sm"
              />
            </div>

            {/* Generate button */}
            <Button onClick={handleAiDraft} disabled={draftLoading} className="w-full bg-purple-600 hover:bg-purple-700 text-white">
              {draftLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              {draftLoading ? 'Generating with context...' : 'Generate Draft'}
            </Button>

            {/* Result */}
            {draftResult && (
              <div className="space-y-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">{draftResult.draft}</pre>
                </div>

                {/* Context used indicator */}
                {draftResult.contextUsed && (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                    <span className="font-semibold text-gray-500">Context used:</span>
                    {draftResult.contextUsed.docsCount > 0 && (
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                        {draftResult.contextUsed.docsCount} docs
                        {draftResult.contextUsed.docNames?.length > 0 && ` (${draftResult.contextUsed.docNames.slice(0, 2).join(', ')})`}
                      </span>
                    )}
                    {draftResult.contextUsed.emailHistoryCount > 0 && (
                      <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-full">
                        {draftResult.contextUsed.emailHistoryCount} past emails
                      </span>
                    )}
                    {draftResult.contextUsed.leadBucket && (
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full">
                        AI: {draftResult.contextUsed.leadBucket}
                      </span>
                    )}
                    {draftResult.contextUsed.activitiesCount > 0 && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">
                        {draftResult.contextUsed.activitiesCount} activities
                      </span>
                    )}
                  </div>
                )}

                {/* Copy button */}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    navigator.clipboard.writeText(draftResult.draft);
                  }}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy to Clipboard
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleAiDraft} disabled={draftLoading}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Regenerate
                  </Button>
                </div>
              </div>
            )}
          </div>
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
                <SearchableListPicker
                  lists={contactLists}
                  value={importToExistingList === '_select' ? '' : importToExistingList}
                  search={importListSearch}
                  onSearchChange={setImportListSearch}
                  onChange={v => { setImportToExistingList(v); setImportListSearch(''); }}
                />
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

      {/* Apollo Sync Dialog */}
      <ApolloSyncDialog
        open={showApolloSyncDialog}
        onOpenChange={setShowApolloSyncDialog}
        contactLists={contactLists.map((l: any) => ({ id: l.id, name: l.name }))}
        onSyncComplete={() => { fetchContacts(); fetchContactLists(); }}
      />

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
                  <SearchableListPicker
                    lists={contactLists}
                    value={gsToExistingList === '_select' ? '' : gsToExistingList}
                    search={gsListSearch}
                    onSearchChange={setGsListSearch}
                    onChange={v => { setGsToExistingList(v); setGsListSearch(''); }}
                  />
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

      {/* ====== PR2: ADD-TO-LIST DIALOG ====== */}
      <Dialog open={showAddToListDialog} onOpenChange={setShowAddToListDialog}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Add {selectAllMatching ? total : selectedIds.length} contact{(selectAllMatching ? total : selectedIds.length) === 1 ? '' : 's'} to a list</DialogTitle>
            <DialogDescription>
              {selectAllMatching
                ? `All ${total} contacts matching your current filters will be added.`
                : `${selectedIds.length} selected contact${selectedIds.length === 1 ? '' : 's'} will be added.`}
              {' '}Note: contacts can only belong to one list, so they'll be moved if already in another list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Tab toggle */}
            <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg">
              <button onClick={() => setAddToListMode('new')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${addToListMode === 'new' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                New List
              </button>
              <button onClick={() => setAddToListMode('existing')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${addToListMode === 'existing' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                Existing List
              </button>
            </div>

            {addToListMode === 'new' ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">List name <span className="text-red-500">*</span></Label>
                  <Input value={addToListNewName} onChange={e => setAddToListNewName(e.target.value)} placeholder="e.g. Hot AI Leads - March" autoFocus />
                </div>
                <div>
                  <Label className="text-xs">Description (optional)</Label>
                  <Textarea value={addToListNewDesc} onChange={e => setAddToListNewDesc(e.target.value)} placeholder="What's this list for?" rows={2} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Pick a list</Label>
                <Input placeholder="Search your lists..." value={addToListSearch} onChange={e => setAddToListSearch(e.target.value)} className="h-8 text-xs" />
                <div className="max-h-60 overflow-y-auto border rounded-lg divide-y bg-white">
                  {contactLists
                    .filter(l => !addToListSearch || l.name.toLowerCase().includes(addToListSearch.toLowerCase()))
                    .map(l => (
                      <button key={l.id} onClick={() => setAddToListExistingId(l.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs ${addToListExistingId === l.id ? 'bg-purple-50' : 'bg-white hover:bg-gray-50'}`}>
                        <div className="truncate">
                          <div className="font-medium text-gray-900 truncate">{l.name}</div>
                          <div className="text-[10px] text-gray-400">{l.contactCount || 0} contacts</div>
                        </div>
                        {addToListExistingId === l.id && <CheckCircle className="h-4 w-4 text-purple-600 shrink-0" />}
                      </button>
                    ))}
                  {contactLists.filter(l => !addToListSearch || l.name.toLowerCase().includes(addToListSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-gray-400 bg-white">No lists found</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddToListDialog(false)} disabled={addToListSaving}>Cancel</Button>
            <Button onClick={submitAddToList} disabled={addToListSaving} className="bg-purple-600 hover:bg-purple-700">
              {addToListSaving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Adding...</> : <>Add to List</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== PR2: SAVE VIEW DIALOG ====== */}
      <Dialog open={showSaveViewDialog} onOpenChange={setShowSaveViewDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>Saves your current filters, sort, columns, and density so you can quickly switch back.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">View name</Label>
            <Input value={saveViewName} onChange={e => setSaveViewName(e.target.value)} placeholder="e.g. Hot Leads Pune" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveViewDialog(false)}>Cancel</Button>
            <Button onClick={saveCurrentView}>Save View</Button>
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

      {/* ==================== ASSIGN LIST TO MEMBER DIALOG ==================== */}
      <Dialog open={showAssignListDialog} onOpenChange={setShowAssignListDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-green-50 p-2 rounded-lg"><UserPlus className="h-4 w-4 text-green-600" /></div>
              Allocate Entire List to Member
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              All contacts in "{contactLists.find(l => l.id === assignListId)?.name}" will be assigned to the selected team member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Select Team Member</Label>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {teamMembers.filter((m: any) => m.role !== 'viewer').map((member: any) => (
                  <button
                    key={member.userId}
                    onClick={() => setAssignListTargetUserId(member.userId)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                      assignListTargetUserId === member.userId
                        ? 'border-green-300 bg-green-50 ring-1 ring-green-200'
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
                    {assignListTargetUserId === member.userId && (
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAssignListDialog(false); setAssignListTargetUserId(''); }}>Cancel</Button>
            <Button
              onClick={handleAssignListToMember}
              disabled={!assignListTargetUserId}
              className="bg-green-600 hover:bg-green-700"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Allocate Entire List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== SEND EMAIL DIALOG ==================== */}
      <Dialog open={showSendEmailDialog} onOpenChange={setShowSendEmailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg"><Mail className="h-4 w-4 text-blue-600" /></div>
              Send Email to {selectedIds.length} Contact{selectedIds.length !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Choose a template, use AI, or write manually. Use {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}, {'{{jobTitle}}'} for personalization.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
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

            {/* Mode Tabs */}
            <div className="flex items-center gap-1 border-b border-gray-200">
              {([
                { key: 'manual', icon: Pencil, label: 'Write' },
                { key: 'template', icon: FileText, label: 'Template' },
                { key: 'ai', icon: Wand2, label: 'AI Write' },
              ] as const).map(({ key, icon: Icon, label }) => (
                <button key={key} onClick={() => setSendEmailMode(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                    sendEmailMode === key
                      ? 'text-blue-600 border-blue-600'
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                  }`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            {/* Template Selection Mode */}
            {sendEmailMode === 'template' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    value={sendEmailTemplateSearch} onChange={e => setSendEmailTemplateSearch(e.target.value)}
                    placeholder="Search templates..."
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {sendEmailTemplates
                    .filter(t => !sendEmailTemplateSearch || t.name?.toLowerCase().includes(sendEmailTemplateSearch.toLowerCase()) || t.subject?.toLowerCase().includes(sendEmailTemplateSearch.toLowerCase()))
                    .map((t: any) => (
                      <button key={t.id} onClick={() => applyTemplate(t)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors group">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-medium text-gray-900 truncate">{t.name}</h4>
                              {t.category && (
                                <Badge variant="outline" className="text-[9px] shrink-0">{t.category}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{t.subject}</p>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500 shrink-0 ml-2" />
                        </div>
                      </button>
                    ))}
                  {sendEmailTemplates.filter(t => !sendEmailTemplateSearch || t.name?.toLowerCase().includes(sendEmailTemplateSearch.toLowerCase())).length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-gray-400">
                      {sendEmailTemplates.length === 0 ? 'No templates found. Create one in Templates.' : 'No matching templates.'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI Write Mode */}
            {sendEmailMode === 'ai' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5 block">Describe the email you want to write</Label>
                  <textarea
                    value={sendEmailAiPrompt} onChange={e => setSendEmailAiPrompt(e.target.value)}
                    placeholder="e.g., Write a cold outreach email to introduce our AI marketing platform to CEOs. Keep it short and professional."
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none h-24 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['Cold outreach to decision makers', 'Follow-up after no reply', 'Meeting request', 'Product introduction', 'Partnership proposal'].map(s => (
                    <button key={s} onClick={() => setSendEmailAiPrompt(s)}
                      className="text-[10px] px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 border border-purple-100 font-medium">
                      {s}
                    </button>
                  ))}
                </div>
                <Button onClick={handleAiGenerate} disabled={sendEmailAiGenerating || !sendEmailAiPrompt.trim()}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white">
                  {sendEmailAiGenerating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating...</> : <><Wand2 className="h-3.5 w-3.5 mr-1.5" /> Generate Email</>}
                </Button>
              </div>
            )}

            {/* Manual Write / Editor Mode (shown for manual, and after template/AI selection) */}
            {sendEmailMode === 'manual' && (
              <div className="space-y-3">
                {/* Subject */}
                <div>
                  <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 block">Subject</Label>
                  <Input
                    value={sendEmailSubject} onChange={e => setSendEmailSubject(e.target.value)}
                    placeholder="e.g., Quick question about {{company}}"
                    className="h-9 text-sm"
                  />
                </div>

                {/* Editor Toolbar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Content</Label>
                    <button onClick={() => {
                      if (sendEmailEditorMode === 'visual') {
                        setSendEmailEditorMode('html');
                        if (sendEmailEditorRef.current) setSendEmailContent(sendEmailEditorRef.current.innerHTML);
                      } else {
                        setSendEmailEditorMode('visual');
                        setTimeout(() => {
                          if (sendEmailEditorRef.current) sendEmailEditorRef.current.innerHTML = sendEmailContent;
                        }, 50);
                      }
                    }} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-medium flex items-center gap-1">
                      <Code className="h-3 w-3" /> {sendEmailEditorMode === 'visual' ? 'HTML' : 'Visual'}
                    </button>
                  </div>

                  {sendEmailEditorMode === 'visual' ? (
                    <>
                      <div className="flex items-center gap-0.5 px-2 py-1.5 border border-b-0 border-gray-200 rounded-t-lg bg-gray-50">
                        {[
                          { cmd: 'bold', icon: Bold, title: 'Bold' },
                          { cmd: 'italic', icon: Italic, title: 'Italic' },
                          { cmd: 'underline', icon: Underline, title: 'Underline' },
                        ].map(({ cmd, icon: Icon, title }) => (
                          <button key={cmd} title={title} onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }}
                            className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
                            <Icon className="h-3.5 w-3.5" />
                          </button>
                        ))}
                        <div className="w-px h-5 bg-gray-200 mx-1" />
                        <button title="Insert Link" onMouseDown={e => { e.preventDefault(); const url = prompt('Enter URL:'); if (url) document.execCommand('createLink', false, url); }}
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
                          <Link className="h-3.5 w-3.5" />
                        </button>
                        <button title="Ordered List" onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList'); }}
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
                          <ListOrdered className="h-3.5 w-3.5" />
                        </button>
                        <button title="Unordered List" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList'); }}
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-600">
                          <List className="h-3.5 w-3.5" />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1" />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-[11px] font-medium">
                              <Type className="h-3 w-3" /> Variables <ChevronDown className="h-2.5 w-2.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-40">
                            {['firstName', 'lastName', 'email', 'company', 'jobTitle', 'fullName'].map(v => (
                              <DropdownMenuItem key={v} onClick={() => {
                                document.execCommand('insertText', false, `{{${v}}}`);
                                if (sendEmailEditorRef.current) setSendEmailContent(sendEmailEditorRef.current.innerHTML);
                              }}>
                                <span className="text-xs">{`{{${v}}}`}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div
                        ref={sendEmailEditorRef}
                        contentEditable
                        onInput={() => { if (sendEmailEditorRef.current) setSendEmailContent(sendEmailEditorRef.current.innerHTML); }}
                        className="w-full text-sm border border-gray-200 rounded-b-lg px-4 py-3 min-h-[200px] max-h-[300px] overflow-y-auto outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all leading-relaxed [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300 [&:empty]:before:italic [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-1 [&_li]:my-0.5"
                        data-placeholder="Hi {{firstName}}, &#10;&#10;Write your email content here..."
                        suppressContentEditableWarning
                      />
                    </>
                  ) : (
                    <textarea
                      value={sendEmailContent} onChange={e => setSendEmailContent(e.target.value)}
                      placeholder={"<p>Hi {{firstName}},</p>\n\n<p>Your email content here...</p>"}
                      className="w-full text-sm border border-gray-200 rounded-lg px-4 py-3 resize-none min-h-[200px] max-h-[300px] outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all font-mono text-[13px] bg-[#1e1e2e] text-[#cdd6f4]"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Result */}
            {sendEmailResult && (
              <Alert className={sendEmailResult.sent > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <AlertDescription className="text-sm">
                  {sendEmailResult.error ? (
                    <span className="text-red-700">{sendEmailResult.error}</span>
                  ) : (
                    <span className={sendEmailResult.sent > 0 ? 'text-green-700' : 'text-red-700'}>
                      Sent: {sendEmailResult.sent} | Failed: {sendEmailResult.failed} | Total: {sendEmailResult.total}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setShowSendEmailDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSendEmail}
              disabled={sendEmailLoading || !sendEmailAccountId || !sendEmailSubject.trim() || !sendEmailContent.trim() || sendEmailMode !== 'manual'}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sendEmailLoading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending...</> : <><Mail className="h-3.5 w-3.5 mr-1.5" /> Send to {selectedIds.length} Contact{selectedIds.length !== 1 ? 's' : ''}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deal Value Dialog — shown when moving contact to 'Won' */}
      <Dialog open={showDealDialog} onOpenChange={setShowDealDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" /> Deal Won
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Enter the deal details for this closed sale</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Deal Value (₹)</label>
              <Input
                type="number"
                placeholder="e.g. 50000"
                value={dealFormValue}
                onChange={e => setDealFormValue(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Deal Notes (optional)</label>
              <Input
                placeholder="What was sold? e.g. Annual subscription"
                value={dealFormNotes}
                onChange={e => setDealFormNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => { setShowDealDialog(false); updatePipeline(dealFormContactId, 'won', undefined, undefined, 0, ''); }}>
              Skip
            </Button>
            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={submitDealAndClose}>
              Save Deal
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
    const isAdmin = userRole === 'owner' || userRole === 'admin';
    const SortHeader = ({ col, label, icon: Icon }: { col: string; label: string; icon?: any }) => (
      <button onClick={() => handleSort(col)} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1 hover:text-gray-600 transition group">
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {label}
        {sortBy === col ? (
          <span className="text-blue-500 text-[10px] font-bold">{sortOrder === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50 transition" />
        )}
      </button>
    );

    // PR1: Column layout is now driven by `columns` state (widths/visibility/order).
    // Visible cols (filtering admin-only for non-admins, and in special tabs we keep original simple layout)
    const visibleCols = columns.filter(c => c.visible && (!c.adminOnly || isAdmin));
    const gridTemplate = isSpecialTab
      ? '40px 1fr 160px 48px'
      : `40px ${visibleCols.map(c => `${c.width}px`).join(' ')} 40px`;
    const totalTableWidth = isSpecialTab ? 1200 : 40 + visibleCols.reduce((s, c) => s + c.width, 0) + 40 + 32;
    const rowPadY = density === 'condensed' ? 'py-1' : density === 'compact' ? 'py-1.5' : 'py-2.5';
    const rowTextSize = density === 'condensed' ? 'text-[11px]' : 'text-xs';

    return (
      <div className="space-y-3">
        {/* Search & Filter bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="Search name, email, company, city, tags..."
                value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                className="pl-9 h-9 text-sm bg-white border-gray-200"
              />
              {search && (
                <button onClick={() => { setSearch(''); setCurrentPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Status Filter pills */}
            {!isSpecialTab && (
              <div className="flex items-center gap-0.5 bg-gray-100/80 rounded-lg p-0.5">
                {(['all', 'cold', 'warm', 'hot', 'replied'] as const).map((s) => {
                  const sc2 = s !== 'all' ? getStatusConfig(s) : null;
                  return (
                    <button key={s} onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                        statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}>
                      {sc2 && <div className={`w-1.5 h-1.5 rounded-full ${sc2.dot}`} />}
                      <span className="capitalize">{s}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Filter toggle */}
            {!isSpecialTab && (
              <Button variant={showFilters || hasActiveFilters ? 'default' : 'outline'} size="sm" className={`h-9 text-xs ${hasActiveFilters ? 'bg-blue-600' : ''}`}
                onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-3.5 w-3.5 mr-1" /> Filters
                {hasActiveFilters && <span className="ml-1 bg-white/20 px-1.5 rounded-full text-[10px]">ON</span>}
              </Button>
            )}

            {/* PR2: Saved views dropdown */}
            {!isSpecialTab && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 text-xs">
                    <Star className="h-3.5 w-3.5 mr-1" /> Views
                    {savedViews.length > 0 && <span className="ml-1 text-gray-400">({savedViews.length})</span>}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setShowSaveViewDialog(true); }} className="text-xs">
                    <Plus className="h-3 w-3 mr-2" /> Save current view
                  </DropdownMenuItem>
                  {savedViews.length > 0 && <DropdownMenuSeparator />}
                  {savedViews.map(v => (
                    <div key={v.id} className="flex items-center px-2 py-1 hover:bg-gray-50 group">
                      <button onClick={() => applyView(v)} className="flex-1 text-left text-xs truncate">{v.name}</button>
                      <button onClick={() => deleteView(v.id, v.name)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 ml-2" title="Delete view">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {savedViews.length === 0 && (
                    <div className="px-2 py-1.5 text-[11px] text-gray-400 italic">No saved views yet</div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Batch actions */}
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
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Email ({selectedIds.length})
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowAddToListDialog(true); setAddToListMode('new'); }} className="text-purple-600 border-purple-200 hover:bg-purple-50">
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" /> Add to List ({selectAllMatching ? total : selectedIds.length})
              </Button>
            </div>
          )}
        </div>

        {/* Filter panel — two rows */}
        {showFilters && !isSpecialTab && (
          <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
            {/* Row 1: autocomplete text inputs + location + AI leads + member */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Job title autocomplete */}
              <AutocompleteInput
                value={designationFilter}
                onChange={v => { setDesignationFilter(v); setCurrentPage(1); }}
                placeholder="Job title keyword..."
                suggestions={filterOptions.designations}
                width={155}
              />
              {/* Keyword autocomplete (industries + departments) */}
              <AutocompleteInput
                value={keywordFilter}
                onChange={v => { setKeywordFilter(v); setCurrentPage(1); }}
                placeholder="Keyword: AI, telecom, cyber..."
                suggestions={[...filterOptions.industries, ...filterOptions.departments]}
                width={190}
              />
              {/* Tag autocomplete */}
              <AutocompleteInput
                value={tagsFilter}
                onChange={v => { setTagsFilter(v); setCurrentPage(1); }}
                placeholder="Tag keyword..."
                suggestions={filterOptions.tags}
                width={135}
              />
              <Select value={locationFilter || '_all'} onValueChange={v => { setLocationFilter(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[140px] text-xs bg-white"><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Locations</SelectItem>
                  {filterOptions.cities.slice(0, 30).map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                  {filterOptions.countries.slice(0, 30).map(c => <SelectItem key={`country-${c}`} value={c} className="text-xs font-medium">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={leadFilterValue || '_all'} onValueChange={v => { setLeadFilterValue(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[140px] text-xs bg-white"><SelectValue placeholder="AI Lead Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Leads</SelectItem>
                  <SelectItem value="hot_leads">Hot Leads</SelectItem>
                  <SelectItem value="warm_leads">Warm Leads</SelectItem>
                  <SelectItem value="past_customer">Past Customers</SelectItem>
                  <SelectItem value="engaged">Engaged</SelectItem>
                  <SelectItem value="cold">Gone Cold</SelectItem>
                  <SelectItem value="never_contacted">Never Contacted</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && teamMembers.length > 0 && (
                <Select value={assignFilterUserId || '_all'} onValueChange={v => { setAssignFilterUserId(v === '_all' ? '' : v); setCurrentPage(1); }}>
                  <SelectTrigger className="h-8 w-[140px] text-xs bg-white"><SelectValue placeholder="Assigned to" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All Members</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {teamMembers.map((m: any) => (
                      <SelectItem key={m.userId} value={m.userId} className="text-xs">{m.firstName || m.email?.split('@')[0]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {/* Row 2: structured dropdowns */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={pipelineFilter} onValueChange={v => { setPipelineFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[135px] text-xs bg-white"><SelectValue placeholder="Pipeline" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  {PIPELINE_STAGES.map(s => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={companyFilter || '_all'} onValueChange={v => { setCompanyFilter(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[145px] text-xs bg-white"><SelectValue placeholder="Company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Companies</SelectItem>
                  {filterOptions.companies.slice(0, 50).map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* Seniority multi-select with checkboxes */}
              <MultiSelectDropdown
                options={filterOptions.seniorities.length > 0 ? filterOptions.seniorities : ['C-Suite', 'VP', 'Director', 'Manager', 'Head', 'Staff', 'Entry', 'Intern', 'Founder', 'Owner']}
                selected={seniorityFilter ? seniorityFilter.split(',').map(s => s.trim()).filter(Boolean) : []}
                onChange={vals => { setSeniorityFilter(vals.join(',')); setCurrentPage(1); }}
                placeholder="All Seniority"
                width={140}
              />
              <Select value={industryFilter || '_all'} onValueChange={v => { setIndustryFilter(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[145px] text-xs bg-white"><SelectValue placeholder="Industry" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Industries</SelectItem>
                  {filterOptions.industries.slice(0, 60).map(i => <SelectItem key={i} value={i} className="text-xs">{i}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={employeeRange || '_all'} onValueChange={v => { setEmployeeRange(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[135px] text-xs bg-white"><SelectValue placeholder="Company size" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Any size</SelectItem>
                  <SelectItem value="1-10" className="text-xs">1–10 employees</SelectItem>
                  <SelectItem value="11-50" className="text-xs">11–50 employees</SelectItem>
                  <SelectItem value="51-200" className="text-xs">51–200 employees</SelectItem>
                  <SelectItem value="201-1000" className="text-xs">201–1000 employees</SelectItem>
                  <SelectItem value="1000+" className="text-xs">1000+ employees</SelectItem>
                </SelectContent>
              </Select>
              <Select value={emailVerification || '_all'} onValueChange={v => { setEmailVerification(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[135px] text-xs bg-white"><SelectValue placeholder="Email status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Any email status</SelectItem>
                  <SelectItem value="verified" className="text-xs">Verified</SelectItem>
                  <SelectItem value="unverified" className="text-xs">Unverified</SelectItem>
                  <SelectItem value="risky" className="text-xs">Risky</SelectItem>
                  <SelectItem value="invalid" className="text-xs">Invalid</SelectItem>
                </SelectContent>
              </Select>
              <Select value={emailRatingGrade || '_all'} onValueChange={v => { setEmailRatingGrade(v === '_all' ? '' : v); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[120px] text-xs bg-white"><SelectValue placeholder="Email rating" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Any rating</SelectItem>
                  <SelectItem value="A" className="text-xs">A — Excellent</SelectItem>
                  <SelectItem value="B" className="text-xs">B — Good</SelectItem>
                  <SelectItem value="C" className="text-xs">C — Average</SelectItem>
                  <SelectItem value="D" className="text-xs">D — Poor</SelectItem>
                  <SelectItem value="F" className="text-xs">F — Very Poor</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <button onClick={clearAllFilters} className="text-xs text-red-500 hover:text-red-700 font-medium ml-auto flex items-center gap-1">
                  <X className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search / filter results indicator — shown whenever a filter or search is active */}
        {(debouncedSearch || hasActiveFilters) && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/70 border border-blue-100 rounded-lg">
            <Search className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="text-xs text-blue-700">
              {loading ? (
                <span className="text-blue-400">Searching…</span>
              ) : (
                <>Found <strong>{total.toLocaleString()}</strong> contact{total !== 1 ? 's' : ''}
                {debouncedSearch && <> matching "<strong>{debouncedSearch}</strong>"</>}
                {hasActiveFilters && <span className="text-blue-500 ml-1">(filters active)</span>}
                {total > pageSize && <span className="text-blue-400 ml-1">— page {currentPage} of {Math.ceil(total / pageSize)}</span>}
                </>
              )}
            </span>
            <button onClick={clearAllFilters} className="ml-auto text-xs text-blue-500 hover:text-blue-700 font-medium shrink-0">Clear all</button>
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
                : (debouncedSearch || hasActiveFilters ? 'No matching contacts' : 'No contacts yet')
              }
            </h3>
            <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">
              {isSpecialTab
                ? `Great news! No contacts are ${activeTab === 'unsubscribers' ? 'unsubscribed' : 'on the blocklist'}.`
                : (debouncedSearch || hasActiveFilters ? 'Try adjusting your search or filters' : 'Import your contacts from a CSV file or add them manually')
              }
            </p>
            {!isSpecialTab && !debouncedSearch && !hasActiveFilters && (
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => { setShowImportDialog(true); setCsvData([]); setCsvHeaders([]); setImportResult(null); setImportListName(''); }}>
                  <Upload className="h-4 w-4 mr-2" /> Import CSV
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowAddDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Add Contact
                </Button>
              </div>
            )}
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-x-auto">
            {/* Select-all-matching banner */}
            {!isSpecialTab && selectedIds.length > 0 && selectedIds.length === contacts.length && total > contacts.length && (
              <div className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">
                {selectAllMatching ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>All <strong>{total}</strong> contacts matching the current filter are selected.</span>
                    <button onClick={() => setSelectAllMatching(false)} className="font-semibold underline hover:text-blue-900">Clear selection</button>
                  </>
                ) : (
                  <>
                    <span>All <strong>{contacts.length}</strong> on this page selected.</span>
                    <button onClick={() => setSelectAllMatching(true)} className="font-semibold underline hover:text-blue-900">Select all {total} matching</button>
                  </>
                )}
              </div>
            )}
            {/* Table Header (dynamic columns) */}
            <div
              className="grid gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 sticky top-0 z-10"
              style={{ gridTemplateColumns: gridTemplate, minWidth: `${totalTableWidth}px` }}
            >
              <div className="flex items-center sticky left-4 z-20 bg-gray-50">
                <input type="checkbox"
                  checked={selectedIds.length === contacts.length && contacts.length > 0}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600" />
              </div>
              {isSpecialTab ? (
                <>
                  <SortHeader col="firstName" label="Email" />
                  <div />
                  <div />
                </>
              ) : (
                <>
                  {visibleCols.map((col, idx) => {
                    const iconMap: Record<string, any> = { company: Building, designation: Briefcase, pipeline: Target, mobile: Smartphone, phone: Phone, location: MapPin, nextAction: Clock };
                    const Icon = iconMap[col.id];
                    const stickyCls = idx === 0 ? 'sticky z-10 bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]' : '';
                    const stickyStyle = idx === 0 ? { left: '56px' } : undefined;
                    return (
                      <div key={col.id} style={stickyStyle} className={`relative flex items-center gap-1 group/col min-w-0 ${stickyCls}`}>
                        {col.sortKey ? (
                          <SortHeader col={col.sortKey} label={col.label} icon={Icon} />
                        ) : (
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                            {Icon && <Icon className="h-2.5 w-2.5" />}
                            {col.id === 'linkedin' ? <Linkedin className="h-2.5 w-2.5" /> : col.id === 'lastRemark' ? <><MessageSquare className="h-2.5 w-2.5" /> {col.label}</> : col.id === 'assigned' ? <UserCheck className="h-2.5 w-2.5" /> : col.label}
                          </div>
                        )}
                        {/* Column ops menu (reorder / hide) */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="opacity-0 group-hover/col:opacity-60 hover:opacity-100 ml-auto p-0.5" title="Column options">
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="text-xs">
                            <DropdownMenuItem onClick={() => moveCol(col.id, -1)} disabled={idx === 0}>Move left</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => moveCol(col.id, 1)} disabled={idx === visibleCols.length - 1}>Move right</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleColVisible(col.id)}>Hide column</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setColWidth(col.id, DEFAULT_COLUMNS.find(d => d.id === col.id)?.width || 120)}>Reset width</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {/* Resize handle (right edge) */}
                        <div
                          onMouseDown={(e) => startColResize(e, col.id)}
                          className="absolute right-0 top-0 bottom-0 w-1.5 -mr-1 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/70 z-20"
                          title="Drag to resize"
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-gray-400 hover:text-gray-600" title="Table options">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Columns</div>
                        {columns.filter(c => !c.adminOnly || isAdmin).map(c => (
                          <DropdownMenuItem key={c.id} onSelect={(e) => { e.preventDefault(); toggleColVisible(c.id); }} className="text-xs flex items-center gap-2">
                            <input type="checkbox" checked={c.visible} readOnly className="h-3 w-3" />
                            <span>{c.label}</span>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Density</div>
                        {(['comfortable','compact','condensed'] as const).map(d => (
                          <DropdownMenuItem key={d} onSelect={(e) => { e.preventDefault(); setDensity(d); }} className="text-xs flex items-center gap-2">
                            <input type="radio" checked={density === d} readOnly className="h-3 w-3" />
                            <span className="capitalize">{d}</span>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={exportVisibleCsv} className="text-xs">
                          <Download className="h-3 w-3 mr-2" /> Export CSV (this page)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={resetColumns} className="text-xs text-gray-500">
                          <RefreshCw className="h-3 w-3 mr-2" /> Reset columns
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>

            {/* Rows */}
            {contacts.map((contact, rowIdx) => {
              const sc = getStatusConfig(contact.status);
              const isSelected = selectedIds.includes(contact.id);
              const isFlagged = contact.status === 'bounced' || contact.status === 'unsubscribed';
              const isActiveRow = rowIdx === activeRowIdx;
              const assignedMember = contact.assignedTo ? teamMembers.find((m: any) => m.userId === contact.assignedTo) : null;
              const stage = PIPELINE_STAGES.find(s => s.value === (contact.pipelineStage || 'new'));
              const isOverdue = contact.nextActionDate && new Date(contact.nextActionDate) < new Date(new Date().toISOString().split('T')[0]);

              // PR1: cell renderers keyed by column id (for dynamic rendering below)
              const renderCell = (colId: ColId) => {
                switch (colId) {
                  case 'contact': return (
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className={`${density === 'condensed' ? 'h-6 w-6' : 'h-8 w-8'} flex-shrink-0 shadow-sm`}>
                        <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(contact.email)} text-white text-[11px] font-semibold`}>
                          {getInitials(contact.firstName, contact.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        {(contact.firstName || contact.lastName) ? (
                          <div className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                            {contact.firstName} {contact.lastName}
                            <Badge variant="outline" className={`text-[9px] font-semibold capitalize ${sc.bg} ${sc.text} border-0 shadow-none py-0 px-1.5`}>
                              <div className={`w-1 h-1 rounded-full ${sc.dot} mr-1`} />{contact.status}
                            </Badge>
                            {contact.emailVerificationStatus && contact.emailVerificationStatus !== 'unverified' && (
                              <span title={`Email: ${contact.emailVerificationStatus}`} className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                                contact.emailVerificationStatus === 'valid' ? 'bg-green-500' :
                                contact.emailVerificationStatus === 'invalid' ? 'bg-red-500' :
                                contact.emailVerificationStatus === 'risky' ? 'bg-amber-500' :
                                contact.emailVerificationStatus === 'disposable' ? 'bg-orange-500' :
                                contact.emailVerificationStatus === 'spamtrap' ? 'bg-red-700' : 'bg-gray-300'
                              }`} />
                            )}
                            {contact.emailRatingUpdatedAt && (
                              <span title={`Rating: ${contact.emailRating ?? 0}/100 (${contact.emailRatingGrade || 'F'})`} className={`text-[9px] font-bold px-1 py-0 rounded ${
                                (contact.emailRating ?? 0) >= 75 ? 'bg-emerald-100 text-emerald-700' :
                                (contact.emailRating ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                (contact.emailRating ?? 0) >= 25 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-600'
                              }`}>{contact.emailRatingGrade || 'F'}</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-900 truncate">{contact.email}</div>
                        )}
                        {contact.leadBucket && contact.leadBucket !== 'unknown' && (() => {
                          const cfg = LEAD_BUCKET_CONFIG[contact.leadBucket] || LEAD_BUCKET_CONFIG.unknown;
                          return (
                            <Tooltip>
                              <TooltipTrigger>
                                <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0 rounded-full ${cfg.bg} ${cfg.text}`}>
                                  <span className="text-[8px]">{cfg.icon}</span> {cfg.label}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs">
                                <p className="text-xs font-semibold mb-1">{cfg.icon} {cfg.label} ({contact.leadConfidence}% confidence)</p>
                                {contact.aiReasoning && <p className="text-xs text-gray-600 mb-1">{contact.aiReasoning}</p>}
                                {contact.suggestedAction && <p className="text-xs text-blue-600">Suggested: {contact.suggestedAction}</p>}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    </div>
                  );
                  case 'company': return <div className={`text-sm text-gray-700 truncate min-w-0`}>{contact.company || <span className="text-xs text-gray-300">--</span>}</div>;
                  case 'designation': return <div className={`${rowTextSize} text-gray-500 truncate min-w-0`}>{contact.jobTitle || <span className="text-gray-300">--</span>}</div>;
                  case 'pipeline': return (
                    <div className="flex items-center gap-1 min-w-0" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={`text-[10px] px-2 py-1 rounded-full font-medium ${stage?.color || 'bg-gray-100 text-gray-500'} hover:opacity-80 transition truncate`}>
                            {stage?.label || 'New'}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-40">
                          {PIPELINE_STAGES.map(s => (
                            <DropdownMenuItem key={s.value} onClick={() => updatePipeline(contact.id, s.value)} className="text-xs">
                              <s.icon className="h-3 w-3 mr-2" /> {s.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {contact.pipelineStage !== 'won' && (
                        <button title="Mark as Won" onClick={() => updatePipeline(contact.id, 'won')} className="p-1 rounded hover:bg-emerald-50 text-emerald-600 transition"><Trophy className="h-3.5 w-3.5" /></button>
                      )}
                      {contact.pipelineStage !== 'lost' && (
                        <button title="Mark as Lost" onClick={() => updatePipeline(contact.id, 'lost')} className="p-1 rounded hover:bg-red-50 text-red-500 transition"><XOctagon className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  );
                  case 'mobile': return <div className={`${rowTextSize} text-gray-600 truncate`}>{contact.mobilePhone || <span className="text-gray-300">--</span>}</div>;
                  case 'phone': return <div className={`${rowTextSize} text-gray-600 truncate`}>{contact.phone || <span className="text-gray-300">--</span>}</div>;
                  case 'linkedin': return (
                    <div className="flex items-center justify-center">
                      {contact.linkedinUrl ? (
                        <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800 transition" title={contact.linkedinUrl}><Linkedin className="h-3.5 w-3.5" /></a>
                      ) : <span className="text-gray-300 text-xs">--</span>}
                    </div>
                  );
                  case 'location': return (
                    <div className={`${rowTextSize} text-gray-600 truncate`}>
                      {[contact.city, contact.country].filter(Boolean).join(', ') || <span className="text-gray-300">--</span>}
                    </div>
                  );
                  case 'nextAction': {
                    const isEditing = inlineEdit?.contactId === contact.id && inlineEdit.field === 'nextAction';
                    if (isEditing) {
                      return (
                        <div className={`${rowTextSize}`} onClick={e => e.stopPropagation()}>
                          <Input
                            type="date"
                            defaultValue={contact.nextActionDate ? String(contact.nextActionDate).slice(0, 10) : ''}
                            autoFocus
                            onBlur={(e) => updateNextAction(contact.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                              if (e.key === 'Escape') setInlineEdit(null);
                            }}
                            className="h-6 text-xs px-1"
                          />
                        </div>
                      );
                    }
                    return (
                      <div className={`${rowTextSize} truncate cursor-pointer hover:bg-yellow-50/50 rounded px-1 -mx-1`}
                        onClick={e => { e.stopPropagation(); setInlineEdit({ contactId: contact.id, field: 'nextAction' }); }}
                        title="Click to set Next Action date">
                        {contact.nextActionDate ? (
                          <span className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                            {new Date(contact.nextActionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            <span className="text-gray-400 capitalize ml-1">{contact.nextActionType || ''}</span>
                          </span>
                        ) : <span className="text-gray-300 hover:text-gray-500">+ set</span>}
                      </div>
                    );
                  }
                  case 'lastRemark': return (
                    <div className={`${rowTextSize} text-gray-500 truncate italic`} title={(contact as any).lastRemark || ''}>
                      {(contact as any).lastRemark || <span className="text-gray-300 not-italic">--</span>}
                    </div>
                  );
                  case 'assigned': return (
                    <div className="flex items-center">
                      {assignedMember ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[8px] bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
                                {(assignedMember.firstName || assignedMember.email?.charAt(0) || '?').charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{assignedMember.firstName || assignedMember.email?.split('@')[0]}</p></TooltipContent>
                        </Tooltip>
                      ) : <span className="text-[10px] text-gray-300">--</span>}
                    </div>
                  );
                  case 'quick': return (
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      {contact.mobilePhone && (
                        <a href={`tel:${contact.mobilePhone}`} className="p-1 rounded hover:bg-green-50 text-green-600" title={`Call ${contact.mobilePhone}`}><PhoneCall className="h-3.5 w-3.5" /></a>
                      )}
                      {contact.mobilePhone && (
                        <a href={`https://wa.me/${(contact.mobilePhone || '').replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-emerald-50 text-emerald-600" title="WhatsApp"><MessageSquare className="h-3.5 w-3.5" /></a>
                      )}
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="p-1 rounded hover:bg-blue-50 text-blue-600" title={`Email ${contact.email}`}><Mail className="h-3.5 w-3.5" /></a>
                      )}
                    </div>
                  );
                }
              };

              return (
                <div
                  key={contact.id}
                  data-row-idx={rowIdx}
                  onClick={() => { setActiveRowIdx(rowIdx); openDetail(contact); }}
                  className={`grid gap-2 px-4 ${rowPadY} border-b border-gray-50 items-center transition-all group cursor-pointer ${
                    isSelected ? 'bg-blue-50/50' : isFlagged ? 'bg-red-50/20' : 'hover:bg-gray-50/80'
                  } ${isActiveRow ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/40' : ''}`}
                  style={{ gridTemplateColumns: gridTemplate, minWidth: `${totalTableWidth}px` }}
                >
                  <div className={`flex items-center sticky left-4 z-[5] ${isSelected ? 'bg-blue-50' : isFlagged ? 'bg-red-50/40' : isActiveRow ? 'bg-blue-50/80' : 'bg-white group-hover:bg-gray-50'}`} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(contact.id)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600" />
                  </div>

                  {isSpecialTab ? (
                    <>
                      <div className="text-sm text-gray-900 truncate">{contact.email}</div>
                      <div />
                      <div />
                    </>
                  ) : (
                    <>
                      {visibleCols.map((col, cIdx) => (
                        <div
                          key={col.id}
                          style={cIdx === 0 ? { left: '56px' } : undefined}
                          className={cIdx === 0 ? `sticky z-[4] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${isSelected ? 'bg-blue-50' : isFlagged ? 'bg-red-50/40' : isActiveRow ? 'bg-blue-50/80' : 'bg-white group-hover:bg-gray-50'}` : ''}
                        >
                          {renderCell(col.id)}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Row-actions cell (always last) */}
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
                        {contact.status !== 'bounced' && (
                          <DropdownMenuItem onClick={async () => {
                            if (confirm(`Mark ${contact.email} as bounced?`)) {
                              try {
                                await fetch('/api/contacts/mark-bounced', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ contactId: contact.id }) });
                                fetchContacts();
                              } catch (e) { console.error(e); }
                            }
                          }} className="text-amber-600">
                            <Ban className="h-3.5 w-3.5 mr-2" /> Mark Bounced
                          </DropdownMenuItem>
                        )}
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

            {/* Pagination Footer */}
            <div className="px-4 py-3 bg-gray-50/40 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Showing {Math.min((currentPage - 1) * pageSize + 1, total)}–{Math.min(currentPage * pageSize, total)} of {total} contacts
                  {selectedIds.length > 0 && <span className="text-blue-600 font-medium ml-2">({selectedIds.length} selected)</span>}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={currentPage === 1}
                      onClick={() => { setCurrentPage(currentPage - 1); setSelectedIds([]); }}>
                      Previous
                    </Button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 7) { page = i + 1; }
                      else if (currentPage <= 4) { page = i + 1; }
                      else if (currentPage >= totalPages - 3) { page = totalPages - 6 + i; }
                      else { page = currentPage - 3 + i; }
                      return (
                        <button key={page} onClick={() => { setCurrentPage(page); setSelectedIds([]); }}
                          className={`h-7 w-7 rounded text-xs font-medium transition ${
                            currentPage === page ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                          }`}>
                          {page}
                        </button>
                      );
                    })}
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={currentPage === totalPages}
                      onClick={() => { setCurrentPage(currentPage + 1); setSelectedIds([]); }}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}
