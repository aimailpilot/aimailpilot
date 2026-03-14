import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  FileText, Plus, Edit, Trash2, Copy, Eye, Loader2, Search, Folder,
  MoreHorizontal, Code, Sparkles, Tag, Clock, Hash, Brain, Wand2,
  X, Bold, Italic, Underline, Link, Image, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Type, Strikethrough, ChevronDown,
  Monitor, Info, User, Users, Star, TrendingUp, AlertTriangle, Mail,
  MessageSquare, MousePointer, Shield, ArrowUpDown, ChevronRight
} from "lucide-react";

interface TemplateCreator {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
}

interface TemplateScore {
  total: number;
  openRate: number;
  replyRate: number;
  clickRate: number;
  spamScore: number;
  campaignsUsed: number;
  grade: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  subject: string;
  content: string;
  variables: string[];
  usageCount: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  creator?: TemplateCreator | null;
  score?: TemplateScore;
}

type TabView = 'mine' | 'team';
type SortField = 'name' | 'updatedAt' | 'score' | 'usageCount';
type SortDir = 'asc' | 'desc';

export default function TemplateManager() {
  const [myTemplates, setMyTemplates] = useState<Template[]>([]);
  const [teamTemplates, setTeamTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<TabView>('mine');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewContact, setPreviewContact] = useState<any>(null);

  // Form
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('general');
  const [formSubject, setFormSubject] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Editor mode: 'visual' or 'html'
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('visual');
  const editorRef = useRef<HTMLDivElement>(null);

  // AI Generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showAiSection, setShowAiSection] = useState(false);
  const [aiFormat, setAiFormat] = useState<'text' | 'html' | 'both'>('html');
  const [aiResult, setAiResult] = useState<{ content: string; model: string; provider: string; textContent?: string; htmlContent?: string; format?: string } | null>(null);
  const [aiError, setAiError] = useState('');

  const categories = ['general', 'onboarding', 'follow-up', 'marketing', 'outreach', 'newsletter', 'transactional'];

  const personalizationVars = [
    { name: 'firstName', label: 'First Name', icon: '👤' },
    { name: 'lastName', label: 'Last Name', icon: '👤' },
    { name: 'email', label: 'Email', icon: '📧' },
    { name: 'company', label: 'Company', icon: '🏢' },
    { name: 'jobTitle', label: 'Job Title', icon: '💼' },
    { name: 'fullName', label: 'Full Name', icon: '🙋' },
    { name: 'senderName', label: 'Sender Name', icon: '✉️' },
  ];

  useEffect(() => { fetchAllTemplates(); }, []);

  const fetchAllTemplates = async () => {
    setLoading(true);
    try {
      const [mineRes, teamRes] = await Promise.all([
        fetch('/api/templates/mine', { credentials: 'include' }),
        fetch('/api/templates/team', { credentials: 'include' }),
      ]);
      if (mineRes.ok) setMyTemplates(await mineRes.json());
      if (teamRes.ok) setTeamTemplates(await teamRes.json());
    } catch (e) { console.error('Failed to fetch templates:', e); }
    setLoading(false);
  };

  // Store pending content for the editor to pick up after dialog opens
  const pendingContentRef = useRef<string>('');

  const openEditor = (template?: Template) => {
    if (template) {
      setEditTemplate(template);
      setFormName(template.name);
      setFormCategory(template.category);
      setFormSubject(template.subject);
      setFormContent(template.content);
      pendingContentRef.current = template.content || '';
    } else {
      setEditTemplate(null);
      setFormName('');
      setFormCategory('general');
      setFormSubject('');
      setFormContent('');
      pendingContentRef.current = '';
    }
    setEditorMode('visual');
    setShowEditor(true);
  };

  // When editor dialog opens or mode switches, populate content editable
  // Use pendingContentRef to avoid dependency on formContent (which causes stale reads)
  useEffect(() => {
    if (showEditor && editorMode === 'visual') {
      // Wait for the DOM to render the contentEditable div
      const timer = setTimeout(() => {
        if (editorRef.current) {
          const content = pendingContentRef.current || formContent || '';
          editorRef.current.innerHTML = content;
        }
      }, 50);
      // Also set after a longer delay in case the dialog animation hasn't completed
      const timer2 = setTimeout(() => {
        if (editorRef.current) {
          const content = pendingContentRef.current || formContent || '';
          // Only set if editor is still empty (don't overwrite user typing)
          if (!editorRef.current.innerHTML || editorRef.current.innerHTML === '<br>') {
            editorRef.current.innerHTML = content;
          }
        }
      }, 300);
      return () => { clearTimeout(timer); clearTimeout(timer2); };
    }
  }, [showEditor, editorMode]);

  const handleSave = async () => {
    if (!formName || !formSubject) return;
    setFormLoading(true);
    
    const vars = (formContent + formSubject).match(/\{\{(\w+)\}\}/g) || [];
    const variables = [...new Set(vars.map(v => v.replace(/[{}]/g, '')))];

    try {
      const url = editTemplate ? `/api/templates/${editTemplate.id}` : '/api/templates';
      const method = editTemplate ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formName,
          category: formCategory,
          subject: formSubject,
          content: formContent,
          variables,
        }),
      });
      if (res.ok) {
        setShowEditor(false);
        await fetchAllTemplates();
      }
    } catch (e) { console.error('Save failed:', e); }
    setFormLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/templates/${id}`, { method: 'DELETE', credentials: 'include' });
    await fetchAllTemplates();
  };

  const handleDuplicate = async (template: Template) => {
    try {
      await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: `${template.name} (copy)`,
          category: template.category,
          subject: template.subject,
          content: template.content,
          variables: template.variables,
        }),
      });
      await fetchAllTemplates();
    } catch (e) { console.error('Duplicate failed:', e); }
  };

  const handlePreview = async (template: Template) => {
    try {
      const res = await fetch('/api/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subject: template.subject, content: template.content }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewSubject(data.subject);
        setPreviewHtml(data.content);
        setPreviewContact(data.contact);
        setShowPreview(true);
      }
    } catch (e) { /* ignore */ }
  };

  const handlePreviewForm = async () => {
    try {
      const res = await fetch('/api/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subject: formSubject, content: formContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewSubject(data.subject);
        setPreviewHtml(data.content);
        setPreviewContact(data.contact);
        setShowPreview(true);
      }
    } catch (e) { /* ignore */ }
  };

  const insertVariable = (varName: string) => {
    if (editorMode === 'html') {
      setFormContent(prev => prev + `{{${varName}}}`);
    } else if (editorRef.current) {
      document.execCommand('insertText', false, `{{${varName}}}`);
      editorRef.current.focus();
      setFormContent(editorRef.current.innerHTML);
    } else {
      setFormContent(prev => prev + `{{${varName}}}`);
    }
  };

  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    if (editorRef.current) {
      setFormContent(editorRef.current.innerHTML);
    }
  };

  const toggleEditorMode = () => {
    if (editorMode === 'visual') {
      if (editorRef.current) setFormContent(editorRef.current.innerHTML);
      setEditorMode('html');
    } else {
      setEditorMode('visual');
      pendingContentRef.current = formContent || '';
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = formContent || '';
      }, 50);
    }
  };

  const currentTemplates = activeTab === 'mine' ? myTemplates : teamTemplates;

  const filteredTemplates = currentTemplates.filter(t => {
    const matchesSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || 
      t.category.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      (t.creator?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const sortedTemplates = [...filteredTemplates].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'name': return dir * a.name.localeCompare(b.name);
      case 'updatedAt': return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      case 'score': return dir * ((a.score?.total || 0) - (b.score?.total || 0));
      case 'usageCount': return dir * ((a.usageCount || 0) - (b.usageCount || 0));
      default: return 0;
    }
  });

  const getCategoryConfig = (cat: string) => {
    const configs: Record<string, { bg: string; text: string; border: string; icon: string }> = {
      onboarding: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: '🚀' },
      'follow-up': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: '🔄' },
      marketing: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '📣' },
      outreach: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '🎯' },
      newsletter: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', icon: '📰' },
      transactional: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '📋' },
      general: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '📝' },
    };
    return configs[cat] || configs.general;
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'B': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'C': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'D': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'F': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-500 border-gray-200';
    }
  };

  const getInitials = (creator?: TemplateCreator | null) => {
    if (!creator) return '?';
    const f = creator.firstName?.[0] || '';
    const l = creator.lastName?.[0] || '';
    if (f || l) return (f + l).toUpperCase();
    return (creator.name?.[0] || creator.email?.[0] || '?').toUpperCase();
  };

  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500',
      'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
      'bg-teal-500', 'bg-cyan-500'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const uniqueCategories = ['all', ...new Set([...myTemplates, ...teamTemplates].map(t => t.category))];

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-sm bg-white border-gray-200" />
          </div>
          <div className="flex items-center gap-0.5 bg-gray-100/80 rounded-lg p-0.5">
            {uniqueCategories.slice(0, 6).map((cat) => (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
                  categoryFilter === cat ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>
        <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50" size="sm" onClick={() => openEditor()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Template
        </Button>
      </div>

      {/* Tabs: My Templates | Team Templates */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('mine')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'mine'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <User className="h-4 w-4" />
          My Templates
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
            activeTab === 'mine' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {myTemplates.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('team')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'team'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Users className="h-4 w-4" />
          Team Templates
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
            activeTab === 'team' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {teamTemplates.length}
          </span>
        </button>
      </div>

      {/* Templates List View */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading templates...</span>
          </div>
        </div>
      ) : sortedTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            {activeTab === 'mine' ? <FileText className="h-8 w-8 text-blue-400" /> : <Users className="h-8 w-8 text-blue-400" />}
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">
            {activeTab === 'mine' ? 'No templates yet' : 'No team templates'}
          </h3>
          <p className="text-sm text-gray-400 mb-5 max-w-sm text-center">
            {activeTab === 'mine'
              ? 'Create reusable email templates with personalization variables'
              : 'Other team members have not created templates yet'}
          </p>
          {activeTab === 'mine' && (
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" size="sm" onClick={() => openEditor()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Template
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* List Header */}
          <div className="grid grid-cols-[1fr_140px_100px_100px_80px_48px] gap-3 px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-gray-700 text-left">
              Template {sortField === 'name' && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <span>Creator</span>
            <button onClick={() => toggleSort('score')} className="flex items-center gap-1 hover:text-gray-700">
              Score {sortField === 'score' && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button onClick={() => toggleSort('usageCount')} className="flex items-center gap-1 hover:text-gray-700">
              Usage {sortField === 'usageCount' && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button onClick={() => toggleSort('updatedAt')} className="flex items-center gap-1 hover:text-gray-700">
              Date {sortField === 'updatedAt' && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <span></span>
          </div>

          {/* Template Rows */}
          {sortedTemplates.map((template) => {
            const catConfig = getCategoryConfig(template.category);
            const score = template.score;
            const isTeam = activeTab === 'team';

            return (
              <div key={template.id} className="grid grid-cols-[1fr_140px_100px_100px_80px_48px] gap-3 px-4 py-3 border-b border-gray-50 hover:bg-blue-50/30 transition-colors group items-center">
                {/* Template Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="font-semibold text-gray-900 text-sm truncate">{template.name}</h4>
                    <Badge variant="outline" className={`text-[10px] font-medium shrink-0 ${catConfig.bg} ${catConfig.text} ${catConfig.border}`}>
                      <span className="mr-0.5">{catConfig.icon}</span> {template.category}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{template.subject}</p>
                  {template.variables?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {template.variables.slice(0, 3).map(v => (
                        <span key={v} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium border border-blue-100">{`{{${v}}}`}</span>
                      ))}
                      {template.variables.length > 3 && <span className="text-[9px] text-gray-400">+{template.variables.length - 3}</span>}
                    </div>
                  )}
                </div>

                {/* Creator */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-6 h-6 rounded-full ${getAvatarColor(template.creator?.name || template.creator?.email || '?')} flex items-center justify-center shrink-0`}>
                    <span className="text-[10px] font-bold text-white">{getInitials(template.creator)}</span>
                  </div>
                  <span className="text-xs text-gray-600 truncate">{template.creator?.name || 'Unknown'}</span>
                </div>

                {/* Score */}
                <div className="flex items-center gap-1.5">
                  {score && score.grade !== 'N/A' ? (
                    <>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getGradeColor(score.grade)}`}>
                        {score.grade}
                      </span>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                          <Mail className="h-2.5 w-2.5 text-gray-400" />
                          <span className="text-[10px] text-gray-500">{score.openRate}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MessageSquare className="h-2.5 w-2.5 text-gray-400" />
                          <span className="text-[10px] text-gray-500">{score.replyRate}%</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px] text-gray-400 italic">No data</span>
                  )}
                </div>

                {/* Usage */}
                <div className="flex items-center gap-1">
                  <Hash className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-600">{template.usageCount || 0}</span>
                  {score && score.campaignsUsed > 0 && (
                    <span className="text-[10px] text-gray-400">({score.campaignsUsed} camp.)</span>
                  )}
                </div>

                {/* Date */}
                <span className="text-[10px] text-gray-400">
                  {new Date(template.updatedAt || template.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => handlePreview(template)}>
                      <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                    </DropdownMenuItem>
                    {isTeam ? (
                      <>
                        <DropdownMenuItem onClick={() => handleDuplicate(template)}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Copy to My Templates
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          // Open editor with a copy (not editing original)
                          setEditTemplate(null);
                          setFormName(`${template.name} (copy)`);
                          setFormCategory(template.category);
                          setFormSubject(template.subject);
                          setFormContent(template.content);
                          pendingContentRef.current = template.content || '';
                          setEditorMode('visual');
                          setShowEditor(true);
                        }}>
                          <Edit className="h-3.5 w-3.5 mr-2" /> Edit as Copy
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <>
                        <DropdownMenuItem onClick={() => openEditor(template)}>
                          <Edit className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(template)}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDelete(template.id)} className="text-red-600">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          {/* Score Legend Footer */}
          <div className="px-4 py-2.5 bg-gray-50/50 border-t border-gray-100 flex items-center gap-4 text-[10px] text-gray-400">
            <span className="font-medium text-gray-500">Score:</span>
            <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> Opens</span>
            <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Replies</span>
            <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" /> Clicks</span>
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Spam check</span>
            <span className="ml-auto">
              Grade: <span className="font-semibold text-emerald-600">A</span>=80+
              <span className="font-semibold text-blue-600 ml-1">B</span>=60+
              <span className="font-semibold text-yellow-600 ml-1">C</span>=40+
              <span className="font-semibold text-orange-600 ml-1">D</span>=20+
            </span>
          </div>
        </div>
      )}

      {/* Template Editor Dialog - Full featured with HTML mode */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-hidden p-0 gap-0">
          {/* Editor Header */}
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 bg-gradient-to-r from-white to-gray-50/80">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-xl shadow-sm shadow-blue-200">
                {editTemplate ? <Edit className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4 text-white" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {editTemplate ? 'Edit Template' : 'Create Template'}
                </h2>
                <p className="text-[11px] text-gray-400">Design reusable email templates with personalization</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowEditor(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[calc(95vh-130px)]">
            <div className="px-6 py-5 space-y-5">
              {/* Template Metadata - Compact row */}
              <div className="grid grid-cols-[1fr_1fr_160px] gap-3">
                <div>
                  <Label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Template Name *</Label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Welcome Email" className="h-9 text-sm border-gray-200 focus:border-blue-400 focus:ring-blue-100" />
                </div>
                <div>
                  <Label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Subject Line *</Label>
                  <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="e.g., Hi {{firstName}}, welcome!" className="h-9 text-sm border-gray-200 focus:border-blue-400 focus:ring-blue-100" />
                </div>
                <div>
                  <Label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Category</Label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => (
                        <SelectItem key={c} value={c}>
                          <span className="flex items-center gap-1.5"><span>{getCategoryConfig(c).icon}</span>{c.charAt(0).toUpperCase() + c.slice(1)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* AI Write + Variables Row */}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setShowAiSection(!showAiSection)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all font-medium ${
                    showAiSection ? 'bg-purple-100 text-purple-700 border border-purple-300 shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-purple-50 hover:text-purple-600 border border-gray-200'
                  }`}>
                  <Sparkles className="h-3 w-3" /> AI Write
                </button>
                <div className="h-4 w-px bg-gray-200" />
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Variables:</span>
                {personalizationVars.map((v) => (
                  <button key={v.name} onClick={() => insertVariable(v.name)}
                    className="text-[11px] px-2 py-1 bg-blue-50/80 text-blue-600 rounded-md hover:bg-blue-100 border border-blue-100/80 transition-colors font-medium">
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>

              {/* AI Generation Section */}
              {showAiSection && (
                <div className="mb-3 p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-200/60 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                      <Brain className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-gray-800">AI Template Generator</span>
                      <p className="text-[10px] text-gray-500">Powered by Azure OpenAI</p>
                    </div>
                    <button onClick={() => setShowAiSection(false)} className="ml-auto p-1 hover:bg-purple-100 rounded-lg">
                      <X className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                  </div>

                  {/* Format selector */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5 block">Email Format</label>
                    <div className="flex gap-1.5">
                      {[
                        { value: 'text', label: 'Text Email', icon: '📝', desc: 'Plain text only' },
                        { value: 'html', label: 'HTML Email', icon: '🎨', desc: 'Rich HTML markup' },
                        { value: 'both', label: 'Both', icon: '📋', desc: 'Text + HTML versions' },
                      ].map(f => (
                        <button key={f.value}
                          onClick={() => setAiFormat(f.value as any)}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all border text-center ${
                            aiFormat === f.value
                              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-purple-50 hover:border-purple-300'
                          }`}>
                          <span className="block">{f.icon} {f.label}</span>
                          <span className={`block text-[9px] mt-0.5 ${aiFormat === f.value ? 'text-purple-200' : 'text-gray-400'}`}>{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prompt textarea */}
                  <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                    placeholder="e.g., Professional welcome email for new SaaS users that highlights the 3 key features and includes a CTA for scheduling a demo..."
                    className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2.5 bg-white outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 resize-none h-20 transition-all"
                  />

                  <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 whitespace-nowrap transition-all shadow-sm"
                    disabled={aiGenerating || !aiPrompt.trim()}
                    onClick={async () => {
                      if (!aiPrompt.trim()) return;
                      setAiGenerating(true); setAiError(''); setAiResult(null);
                      try {
                        const res = await fetch('/api/llm/generate', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                          body: JSON.stringify({ prompt: aiPrompt, type: 'template', format: aiFormat, context: { category: formCategory, name: formName } }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setAiResult({ content: data.content, model: data.model, provider: data.provider, textContent: data.textContent, htmlContent: data.htmlContent, format: data.format });
                          if (data.provider === 'demo' && data.note) setAiError(data.note);
                        } else { setAiError('Generation failed. Check Azure OpenAI configuration in Advanced Settings for your current organization.'); }
                      } catch (e) { console.error('AI generation failed:', e); setAiError('Could not reach server'); }
                      setAiGenerating(false);
                    }}>
                    {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    {aiGenerating ? 'Writing...' : `Generate ${aiFormat === 'both' ? 'Text + HTML' : aiFormat === 'text' ? 'Text' : 'HTML'} Template`}
                  </button>

                  {aiError && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 border border-red-100">{aiError}</div>}

                  {/* AI Result */}
                  {aiResult && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-gray-500">
                          {aiResult.provider === 'azure-openai' ? '✨ Azure OpenAI' : '🎭 Demo Mode'}
                          {aiResult.format && <span className="ml-1.5 text-purple-500">({aiResult.format === 'both' ? 'Text + HTML' : aiResult.format})</span>}
                        </span>
                      </div>

                      {aiResult.format === 'both' && aiResult.textContent && aiResult.htmlContent ? (
                        <div className="space-y-2">
                          <div>
                            <div className="text-[10px] font-semibold text-gray-600 mb-1">📝 Text Version</div>
                            <div className="text-xs text-gray-700 bg-white rounded-lg p-3 max-h-24 overflow-y-auto whitespace-pre-wrap border border-gray-200 shadow-inner font-mono">{aiResult.textContent}</div>
                            <div className="flex gap-1.5 mt-1.5">
                              <button onClick={() => {
                                setFormContent(aiResult.textContent!);
                                if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.textContent!;
                              }} className="flex-1 text-[11px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium border border-purple-200">Use Text</button>
                              <button onClick={() => navigator.clipboard.writeText(aiResult.textContent!)} className="text-[11px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 border border-gray-200">Copy</button>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold text-gray-600 mb-1">🎨 HTML Version</div>
                            <div className="text-xs text-gray-700 bg-white rounded-lg p-3 max-h-24 overflow-y-auto whitespace-pre-wrap border border-gray-200 shadow-inner">{aiResult.htmlContent}</div>
                            <div className="flex gap-1.5 mt-1.5">
                              <button onClick={() => {
                                setFormContent(aiResult.htmlContent!);
                                if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.htmlContent!;
                              }} className="flex-1 text-[11px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium border border-purple-200">Use HTML</button>
                              <button onClick={() => navigator.clipboard.writeText(aiResult.htmlContent!)} className="text-[11px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 border border-gray-200">Copy</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xs text-gray-700 bg-white rounded-lg p-3 max-h-32 overflow-y-auto whitespace-pre-wrap border border-gray-200 shadow-inner">{aiResult.content}</div>
                          <div className="flex gap-1.5 mt-1.5">
                            <button onClick={() => {
                              setFormContent(aiResult.content);
                              if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.content;
                              const subjectMatch = aiResult.content.match(/Subject:\s*(.+)/i);
                              if (subjectMatch && !formSubject) setFormSubject(subjectMatch[1].trim());
                            }} className="flex-1 text-[11px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium border border-purple-200">Use Content</button>
                            <button onClick={() => navigator.clipboard.writeText(aiResult.content)} className="text-[11px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 border border-gray-200">Copy</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quick prompt suggestions */}
                  {!aiResult && (
                    <div>
                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">Quick prompts</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { text: 'Welcome onboarding email for new users', emoji: '👋' },
                          { text: 'Cold outreach for SaaS product to decision makers', emoji: '🚀' },
                          { text: 'Follow-up after meeting with key takeaways', emoji: '📝' },
                          { text: 'Product launch announcement with CTA', emoji: '🎉' },
                          { text: 'Re-engagement email for churned users', emoji: '🔄' },
                          { text: 'Partnership proposal for complementary business', emoji: '🤝' },
                        ].map(p => (
                          <button key={p.text} onClick={() => setAiPrompt(p.text)}
                            className="text-[11px] px-2.5 py-1 bg-white text-gray-600 rounded-lg border border-purple-200 hover:bg-purple-100 hover:text-purple-700 transition-colors flex items-center gap-1">
                            <span>{p.emoji}</span> {p.text}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Editor with toolbar */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
                {/* Toolbar / Developer mode */}
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-100 bg-gray-50/50">
                  {editorMode === 'visual' ? (
                    <div className="flex items-center gap-0.5 flex-wrap flex-1">
                      <TbBtn icon={<Bold className="h-3.5 w-3.5" />} onClick={() => execCmd('bold')} title="Bold" />
                      <TbBtn icon={<Italic className="h-3.5 w-3.5" />} onClick={() => execCmd('italic')} title="Italic" />
                      <TbBtn icon={<Underline className="h-3.5 w-3.5" />} onClick={() => execCmd('underline')} title="Underline" />
                      <TbBtn icon={<Strikethrough className="h-3.5 w-3.5" />} onClick={() => execCmd('strikeThrough')} title="Strikethrough" />
                      <div className="w-px h-4 bg-gray-200 mx-0.5" />
                      <TbBtn icon={<Link className="h-3.5 w-3.5" />} onClick={() => { const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); }} title="Link" />
                      <TbBtn icon={<Image className="h-3.5 w-3.5" />} onClick={() => { const url = prompt('Image URL:'); if (url) execCmd('insertImage', url); }} title="Image" />
                      <div className="w-px h-4 bg-gray-200 mx-0.5" />
                      <TbBtn icon={<ListOrdered className="h-3.5 w-3.5" />} onClick={() => execCmd('insertOrderedList')} title="Numbered list" />
                      <TbBtn icon={<List className="h-3.5 w-3.5" />} onClick={() => execCmd('insertUnorderedList')} title="Bullet list" />
                      <TbBtn icon={<AlignLeft className="h-3.5 w-3.5" />} onClick={() => execCmd('justifyLeft')} title="Align left" />
                      <TbBtn icon={<AlignCenter className="h-3.5 w-3.5" />} onClick={() => execCmd('justifyCenter')} title="Center" />
                      <div className="w-px h-4 bg-gray-200 mx-0.5" />
                      <TbBtn icon={<Type className="h-3.5 w-3.5" />} onClick={() => execCmd('removeFormat')} title="Clear formatting" />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500 font-medium flex items-center gap-1.5">
                      <Code className="h-3.5 w-3.5" /> HTML Source
                    </span>
                  )}

                  <button onClick={toggleEditorMode}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      editorMode === 'html'
                        ? 'bg-gray-800 text-white shadow-sm'
                        : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}>
                    <Code className="h-3 w-3" />
                    {editorMode === 'html' ? 'Visual' : 'HTML'}
                  </button>
                </div>

                {/* Content area */}
                {editorMode === 'visual' ? (
                  <div
                    ref={editorRef}
                    contentEditable
                    onInput={() => { if (editorRef.current) { setFormContent(editorRef.current.innerHTML); pendingContentRef.current = editorRef.current.innerHTML; } }}
                    className="min-h-[320px] max-h-[450px] overflow-y-auto p-5 text-sm text-gray-800 outline-none leading-relaxed [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300 [&:empty]:before:italic [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
                    data-placeholder="Start composing your email template here... Use the toolbar above or type HTML directly."
                    suppressContentEditableWarning
                  />
                ) : (
                  <textarea
                    value={formContent}
                    onChange={(e) => { setFormContent(e.target.value); pendingContentRef.current = e.target.value; }}
                    className="w-full min-h-[320px] max-h-[450px] p-5 text-[13px] font-mono leading-relaxed bg-[#1e1e2e] text-[#cdd6f4] outline-none resize-y border-0 selection:bg-blue-800/50"
                    placeholder="<p>Hi {{firstName}},</p>&#10;&#10;<p>Your HTML email content here...</p>"
                    spellCheck={false}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Sticky Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50/80">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {formContent && (
                <span>{formContent.length} chars</span>
              )}
              {(formContent + formSubject).match(/\{\{(\w+)\}\}/g) && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {[...new Set((formContent + formSubject).match(/\{\{(\w+)\}\}/g)?.map(v => v.replace(/[{}]/g, '')))].length} variables
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowEditor(false)} className="text-gray-500">Cancel</Button>
              <Button variant="outline" size="sm" onClick={handlePreviewForm} disabled={!formContent}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
              </Button>
              <Button size="sm" onClick={handleSave} disabled={formLoading || !formName || !formSubject}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50 px-5">
                {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                {editTemplate ? 'Save Changes' : 'Create Template'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog - Full email preview with rendered HTML */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Monitor className="h-4 w-4 text-blue-600" />
              </div>
              Email Preview
            </DialogTitle>
            <DialogDescription>This is how the email will look. Variables are replaced with sample data.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Subject */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Subject Line</div>
              <div className="font-semibold text-gray-900">{previewSubject}</div>
            </div>
            {/* Email body */}
            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="p-6">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }}
                  className="prose prose-sm max-w-none text-gray-800 [&_a]:text-blue-600 [&_img]:max-w-full" />
              </div>
            </div>
            {/* Preview info */}
            {previewContact && (
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                <Info className="h-3.5 w-3.5" />
                <span>Sample contact: {previewContact.firstName} {previewContact.lastName} ({previewContact.email})</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TbBtn({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors">
      {icon}
    </button>
  );
}
