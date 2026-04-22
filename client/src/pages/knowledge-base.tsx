import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BookOpen, Plus, Search, Upload, Trash2, Edit, FileText, Eye,
  Loader2, X, RefreshCw, Tag, Sparkles, File, Globe, Building,
  Award, FileSpreadsheet, Briefcase, MessageSquare, Clock, MoreHorizontal,
  ChevronDown, Download
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const DOC_TYPES = [
  { value: 'general', label: 'General', icon: FileText, color: 'bg-gray-100 text-gray-600' },
  { value: 'case_study', label: 'Case Study', icon: Award, color: 'bg-purple-100 text-purple-700' },
  { value: 'proposal', label: 'Proposal', icon: Briefcase, color: 'bg-blue-100 text-blue-700' },
  { value: 'brochure', label: 'Brochure', icon: BookOpen, color: 'bg-green-100 text-green-700' },
  { value: 'testimonial', label: 'Testimonial', icon: MessageSquare, color: 'bg-amber-100 text-amber-700' },
  { value: 'award', label: 'Award / Achievement', icon: Award, color: 'bg-yellow-100 text-yellow-700' },
  { value: 'pricing', label: 'Pricing', icon: FileSpreadsheet, color: 'bg-emerald-100 text-emerald-700' },
  { value: 'company_profile', label: 'Company Profile', icon: Building, color: 'bg-indigo-100 text-indigo-700' },
  { value: 'product', label: 'Product / Service', icon: Globe, color: 'bg-cyan-100 text-cyan-700' },
  { value: 'faq', label: 'FAQ / Objection Handling', icon: MessageSquare, color: 'bg-rose-100 text-rose-700' },
];

interface OrgDocument {
  id: string;
  name: string;
  docType: string;
  source: string;
  contentPreview: string;
  summary: string;
  tags: string[];
  metadata: any;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('all');
  const [docTypeCounts, setDocTypeCounts] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Add/Edit dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editDoc, setEditDoc] = useState<OrgDocument | null>(null);
  const [formName, setFormName] = useState('');
  const [formDocType, setFormDocType] = useState('general');
  const [formContent, setFormContent] = useState('');
  const [formSummary, setFormSummary] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // View dialog
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDocuments(); fetchDocTypeCounts(); }, [search, docTypeFilter, currentPage]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String((currentPage - 1) * pageSize));
      if (search) params.set('search', search);
      if (docTypeFilter && docTypeFilter !== 'all') params.set('docType', docTypeFilter);

      const res = await fetch(`/api/context/documents?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
        setTotal(data.total || 0);
      }
    } catch (e) { console.error('Failed to fetch documents:', e); }
    setLoading(false);
  };

  const fetchDocTypeCounts = async () => {
    try {
      const res = await fetch('/api/context/doc-types', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const counts: Record<string, number> = {};
        for (const item of data) counts[item.docType] = item.cnt;
        setDocTypeCounts(counts);
      }
    } catch {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isTextFile =
      ['text/', 'application/json', 'application/csv', 'text/csv', 'text/html', 'text/markdown', 'application/xml']
        .some(t => file.type.includes(t))
      || /\.(txt|csv|md|html|json|xml|yml|yaml)$/i.test(file.name);

    if (!isTextFile) {
      alert(
        `"${file.name}" is not a supported text format.\n\n` +
        `Supported: .txt, .csv, .md, .html, .json, .xml, .yml\n\n` +
        `For PDF or Word documents, please open the file, copy the text, and paste it into the "Add Document" dialog.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        setFormContent(content);
        setFormName(file.name.replace(/\.[^/.]+$/, ''));
        setShowAddDialog(true);
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) {
      setFormError('Name and content are required');
      return;
    }
    setFormLoading(true);
    setFormError('');

    try {
      const body: any = {
        name: formName.trim(),
        docType: formDocType,
        content: formContent,
        summary: formSummary.trim(),
        tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
        source: 'upload',
      };

      let res;
      if (editDoc) {
        res = await fetch(`/api/context/documents/${editDoc.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/context/documents', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        setShowAddDialog(false);
        resetForm();
        fetchDocuments();
        fetchDocTypeCounts();
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.message || 'Failed to save document');
      }
    } catch (e: any) {
      setFormError(e.message || 'Failed to save');
    }
    setFormLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/context/documents/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { fetchDocuments(); fetchDocTypeCounts(); }
    } catch (e) { console.error('Delete failed:', e); }
  };

  const openView = async (doc: OrgDocument) => {
    setViewLoading(true);
    setViewDoc(null);
    try {
      const res = await fetch(`/api/context/documents/${doc.id}`, { credentials: 'include' });
      if (res.ok) setViewDoc(await res.json());
    } catch {}
    setViewLoading(false);
  };

  const openEdit = async (doc: OrgDocument) => {
    try {
      const res = await fetch(`/api/context/documents/${doc.id}`, { credentials: 'include' });
      if (res.ok) {
        const full = await res.json();
        setEditDoc(full);
        setFormName(full.name);
        setFormDocType(full.docType);
        setFormContent(full.content || '');
        setFormSummary(full.summary || '');
        setFormTags((full.tags || []).join(', '));
        setShowAddDialog(true);
      }
    } catch {}
  };

  const resetForm = () => {
    setEditDoc(null);
    setFormName(''); setFormDocType('general'); setFormContent('');
    setFormSummary(''); setFormTags(''); setFormError('');
  };

  const totalDocs = Object.values(docTypeCounts).reduce((a, b) => a + b, 0);
  const totalPages = Math.ceil(total / pageSize);

  const getDocTypeConfig = (type: string) => DOC_TYPES.find(d => d.value === type) || DOC_TYPES[0];

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const fmtDate = (d: string) => {
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(d));
    } catch { return d; }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-blue-600" /> Knowledge Base
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Upload company documents to power AI-driven email drafts, proposals, and context-aware replies
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { fetchDocuments(); fetchDocTypeCounts(); }}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.csv,.md,.html,.json,.xml,.yml" className="hidden" />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload File
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { resetForm(); setShowAddDialog(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Document
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Total:</span>
            <span className="font-semibold text-gray-900">{totalDocs} documents</span>
          </div>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex items-center gap-1.5 flex-wrap">
            {DOC_TYPES.filter(dt => docTypeCounts[dt.value]).map(dt => (
              <button key={dt.value}
                onClick={() => { setDocTypeFilter(docTypeFilter === dt.value ? 'all' : dt.value); setCurrentPage(1); }}
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full transition ${
                  docTypeFilter === dt.value ? 'bg-blue-600 text-white' : dt.color
                }`}>
                <dt.icon className="h-2.5 w-2.5" /> {dt.label} ({docTypeCounts[dt.value]})
              </button>
            ))}
            {docTypeFilter !== 'all' && (
              <button onClick={() => { setDocTypeFilter('all'); setCurrentPage(1); }} className="text-[10px] text-gray-400 hover:text-gray-600 ml-1">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            placeholder="Search documents by name, content, or tags..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-9 h-9 text-sm bg-white border-gray-200"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Documents list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
              <BookOpen className="h-10 w-10 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1.5">
              {search || docTypeFilter !== 'all' ? 'No matching documents' : 'No documents yet'}
            </h3>
            <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">
              {search || docTypeFilter !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Upload case studies, proposals, brochures, and company info. The AI will use these to draft better emails and proposals.'
              }
            </p>
            {!search && docTypeFilter === 'all' && (
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Upload File
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowAddDialog(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Add Document
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map(doc => {
              const dtConfig = getDocTypeConfig(doc.docType);
              return (
                <div key={doc.id}
                  className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:shadow-sm transition cursor-pointer group"
                  onClick={() => openView(doc)}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${dtConfig.color}`}>
                    <dtConfig.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900 truncate">{doc.name}</span>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${dtConfig.color} border-0`}>
                        {dtConfig.label}
                      </Badge>
                    </div>
                    {doc.summary ? (
                      <p className="text-xs text-gray-500 line-clamp-2 mb-1.5">{doc.summary}</p>
                    ) : doc.contentPreview ? (
                      <p className="text-xs text-gray-400 line-clamp-1 mb-1.5">{doc.contentPreview}...</p>
                    ) : null}
                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                      {doc.tags && doc.tags.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Tag className="h-2.5 w-2.5" /> {doc.tags.slice(0, 3).join(', ')}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {fmtDate(doc.updatedAt || doc.createdAt)}
                      </span>
                      {doc.fileSize > 0 && <span>{fmtSize(doc.fileSize)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(doc)}>
                          <Edit className="h-3.5 w-3.5 text-gray-400" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p className="text-xs">Edit</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(doc.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p className="text-xs">Delete</p></TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-gray-400">
                  Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, total)} of {total}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)} className="h-7 text-xs">Prev</Button>
                  <span className="text-xs text-gray-500 px-2">Page {currentPage} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} className="h-7 text-xs">Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Document Dialog */}
      <Dialog open={showAddDialog} onOpenChange={v => { if (!v) { setShowAddDialog(false); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editDoc ? <Edit className="h-5 w-5 text-blue-500" /> : <Plus className="h-5 w-5 text-blue-500" />}
              {editDoc ? 'Edit Document' : 'Add Document'}
            </DialogTitle>
            <DialogDescription>
              {editDoc ? 'Update this document in your knowledge base' : 'Add a document to your knowledge base. AI will use this for drafting emails and proposals.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-medium">Document Name *</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Acme Corp Case Study" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium">Document Type</Label>
                <Select value={formDocType} onValueChange={setFormDocType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(dt => (
                      <SelectItem key={dt.value} value={dt.value}>
                        <span className="flex items-center gap-2"><dt.icon className="h-3.5 w-3.5" /> {dt.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium">Content *</Label>
              <Textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                placeholder="Paste your document content here... Case studies, proposals, company info, pricing details, testimonials, etc."
                className="mt-1 min-h-[200px] font-mono text-xs"
              />
              <p className="text-[10px] text-gray-400 mt-1">{formContent.length.toLocaleString()} characters</p>
            </div>

            <div>
              <Label className="text-xs font-medium">Summary (auto-generated if empty)</Label>
              <Textarea
                value={formSummary}
                onChange={e => setFormSummary(e.target.value)}
                placeholder="Brief summary of this document — AI will generate one if left empty"
                className="mt-1 min-h-[60px] text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-medium">Tags (comma-separated)</Label>
              <Input
                value={formTags}
                onChange={e => setFormTags(e.target.value)}
                placeholder="e.g., SaaS, enterprise, email marketing, case study"
                className="mt-1"
              />
              <p className="text-[10px] text-gray-400 mt-1">Tags help the AI find relevant documents when drafting emails for specific industries or topics</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              {editDoc ? 'Update' : 'Save & Index'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Document Dialog */}
      <Dialog open={!!viewDoc || viewLoading} onOpenChange={v => { if (!v) { setViewDoc(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : viewDoc && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => { const cfg = getDocTypeConfig(viewDoc.docType); return <cfg.icon className="h-5 w-5 text-blue-500" />; })()}
                  {viewDoc.name}
                  <Badge variant="outline" className={`text-[10px] ml-2 ${getDocTypeConfig(viewDoc.docType).color} border-0`}>
                    {getDocTypeConfig(viewDoc.docType).label}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Added {fmtDate(viewDoc.createdAt)} {viewDoc.fileSize > 0 ? `| ${fmtSize(viewDoc.fileSize)}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {viewDoc.summary && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <div className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI Summary
                    </div>
                    <p className="text-sm text-blue-900">{viewDoc.summary}</p>
                  </div>
                )}

                {viewDoc.tags && viewDoc.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="h-3 w-3 text-gray-400" />
                    {viewDoc.tags.map((t: string, i: number) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t}</span>
                    ))}
                  </div>
                )}

                <div>
                  <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">Content</div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{viewDoc.content}</pre>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { openEdit(viewDoc); setViewDoc(null); }}>
                  <Edit className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                <Button variant="outline" onClick={() => setViewDoc(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
