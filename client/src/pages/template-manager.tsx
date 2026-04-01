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
  MessageSquare, MousePointer, Shield, ArrowUpDown, ChevronRight,
  ArrowLeft, Save, Palette, Smartphone, Send, CheckCircle
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
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [testEmailAccountId, setTestEmailAccountId] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [testError, setTestError] = useState('');
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);

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

  // Deliverability analysis state
  const [showDeliverability, setShowDeliverability] = useState(false);
  const [deliverabilityLoading, setDeliverabilityLoading] = useState(false);
  const [deliverabilityResult, setDeliverabilityResult] = useState<{
    score: number; grade: string; wordCount: number; linkCount: number; imageCount: number;
    personalizationCount: number; spamWordsFound: string[];
    issues: { severity: 'critical' | 'warning' | 'info'; category: string; message: string; fix?: string }[];
    aiSuggestions: string[];
  } | null>(null);
  const deliverabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixChanges, setFixChanges] = useState<string[]>([]);

  const analyzeDeliverability = async (subj?: string, cont?: string) => {
    const s = subj ?? formSubject;
    const c = cont ?? formContent;
    if (!s && !c) { setDeliverabilityResult(null); return; }
    setDeliverabilityLoading(true);
    try {
      const res = await fetch('/api/templates/analyze-deliverability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ subject: s, content: c }),
      });
      if (res.ok) setDeliverabilityResult(await res.json());
    } catch { /* ignore */ }
    setDeliverabilityLoading(false);
  };

  const autoFixDeliverability = async () => {
    if (!deliverabilityResult || deliverabilityResult.issues.length === 0) return;
    setFixLoading(true);
    setFixChanges([]);
    try {
      const res = await fetch('/api/templates/fix-deliverability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ subject: formSubject, content: formContent, issues: deliverabilityResult.issues }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setFormSubject(data.subject);
          setFormContent(data.content);
          pendingContentRef.current = data.content;
          if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = data.content;
          setFixChanges(data.changes || []);
          // Re-analyze after fix
          setTimeout(() => analyzeDeliverability(data.subject, data.content), 500);
        }
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to auto-fix');
      }
    } catch { alert('Failed to connect to AI service'); }
    setFixLoading(false);
  };

  // Debounced auto-analysis when content or subject changes
  useEffect(() => {
    if (!showDeliverability) return;
    if (deliverabilityTimerRef.current) clearTimeout(deliverabilityTimerRef.current);
    deliverabilityTimerRef.current = setTimeout(() => analyzeDeliverability(), 1500);
    return () => { if (deliverabilityTimerRef.current) clearTimeout(deliverabilityTimerRef.current); };
  }, [formSubject, formContent, showDeliverability]);

  // Highlight spam words in visual editor using CSS Custom Highlight API or fallback
  useEffect(() => {
    if (!editorRef.current || editorMode !== 'visual') return;
    const spamWords = deliverabilityResult?.spamWordsFound || [];
    const editor = editorRef.current;

    // Remove existing highlights
    editor.querySelectorAll('mark[data-spam-highlight]').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });

    // Add highlights if deliverability panel is open and there are spam words
    if (!showDeliverability || spamWords.length === 0) return;

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    for (const node of textNodes) {
      const text = node.textContent || '';
      const pattern = spamWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      if (!pattern) continue;
      const regex = new RegExp(`(${pattern})`, 'gi');
      if (!regex.test(text)) continue;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const mark = document.createElement('mark');
        mark.setAttribute('data-spam-highlight', 'true');
        mark.style.cssText = 'background:#fecaca;color:#991b1b;border-radius:2px;padding:0 2px;cursor:help';
        mark.title = `Spam trigger: "${match[0]}" — consider rephrasing`;
        mark.textContent = match[0];
        frag.appendChild(mark);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }, [showDeliverability, deliverabilityResult?.spamWordsFound, editorMode]);

  const categories = ['general', 'onboarding', 'follow-up', 'marketing', 'outreach', 'newsletter', 'transactional'];

  const personalizationVars = [
    { name: 'firstName', label: 'First Name' },
    { name: 'lastName', label: 'Last Name' },
    { name: 'email', label: 'Email' },
    { name: 'company', label: 'Company' },
    { name: 'jobTitle', label: 'Job Title' },
    { name: 'fullName', label: 'Full Name' },
    { name: 'senderName', label: 'Sender Name' },
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

  // Store pending content for the editor
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
    setShowAiSection(false);
    setShowDeliverability(false);
    setDeliverabilityResult(null);
    setAiResult(null);
    setAiError('');
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditTemplate(null);
  };

  // When editor opens or mode switches, populate content editable
  useEffect(() => {
    if (showEditor && editorMode === 'visual') {
      const timer = setTimeout(() => {
        if (editorRef.current) {
          const content = pendingContentRef.current || formContent || '';
          editorRef.current.innerHTML = content;
        }
      }, 50);
      const timer2 = setTimeout(() => {
        if (editorRef.current) {
          const content = pendingContentRef.current || formContent || '';
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
        closeEditor();
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

  // Fetch email accounts when preview opens
  useEffect(() => {
    if (showPreview && emailAccounts.length === 0) {
      fetch('/api/email-accounts', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(accounts => {
          setEmailAccounts(accounts || []);
          if (accounts?.length > 0 && !testEmailAccountId) {
            setTestEmailAccountId(accounts[0].id);
          }
        })
        .catch(() => {});
    }
    if (!showPreview) {
      setTestSent(false);
      setTestError('');
    }
  }, [showPreview]);

  const sendTestEmail = async () => {
    if (!testEmail || !testEmailAccountId) return;
    setTestSending(true);
    setTestSent(false);
    setTestError('');
    try {
      const res = await fetch('/api/campaigns/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountId: testEmailAccountId,
          toEmail: testEmail,
          subject: previewSubject,
          content: previewHtml,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestSent(true);
        setTimeout(() => setTestSent(false), 4000);
      } else {
        setTestError(data.error || 'Failed to send test email');
      }
    } catch {
      setTestError('Failed to send test email');
    }
    setTestSending(false);
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

  // ============================================================
  // FULL-PAGE EDITOR VIEW (replaces the template list when open)
  // ============================================================
  if (showEditor) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {/* Top Bar - like Mailmeteor */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={closeEditor}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors font-medium">
              <ArrowLeft className="h-4 w-4" />
              Templates
            </button>
            <div className="w-px h-5 bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              {editTemplate ? 'Edit' : 'New'} Template
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-sm gap-1.5">
                  Actions <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handlePreviewForm} disabled={!formContent}>
                  <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate({ ...editTemplate!, name: formName, category: formCategory, subject: formSubject, content: formContent })} disabled={!editTemplate}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                {editTemplate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { handleDelete(editTemplate.id); closeEditor(); }} className="text-red-600">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete template
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" onClick={handlePreviewForm} disabled={!formContent} className="text-sm">
              <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
            </Button>
            <Button size="sm" onClick={handleSave} disabled={formLoading || !formName || !formSubject}
              className="bg-blue-600 hover:bg-blue-700 text-sm px-4">
              {formLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Template Name - editable inline like Mailmeteor */}
        <div className="px-6 pt-4 pb-2 bg-white shrink-0">
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Template name"
            className="text-2xl font-bold text-gray-900 w-full outline-none placeholder-gray-300 bg-transparent"
          />
        </div>

        {/* Subject Line */}
        <div className="px-6 pb-3 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400 font-medium shrink-0">Subject</span>
            <div className="flex-1 relative">
              <input
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="Enter subject line..."
                className={`w-full text-sm text-gray-700 outline-none placeholder-gray-300 bg-transparent py-1.5 ${
                  showDeliverability && deliverabilityResult?.spamWordsFound?.some(w => formSubject.toLowerCase().includes(w)) ? 'text-transparent caret-gray-700' : ''
                }`}
              />
              {/* Spam word highlight overlay for subject */}
              {showDeliverability && deliverabilityResult?.spamWordsFound && deliverabilityResult.spamWordsFound.some(w => formSubject.toLowerCase().includes(w)) && (
                <div className="absolute inset-0 pointer-events-none text-sm py-1.5 whitespace-pre" aria-hidden="true"
                  dangerouslySetInnerHTML={{
                    __html: deliverabilityResult.spamWordsFound.reduce(
                      (text, word) => text.replace(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
                        '<mark style="background:#fecaca;color:#991b1b;border-radius:2px;padding:0 2px">$1</mark>'),
                      formSubject.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    ),
                  }}
                />
              )}
            </div>
            <Select value={formCategory} onValueChange={setFormCategory}>
              <SelectTrigger className="w-36 h-8 text-xs border-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-1.5">{getCategoryConfig(c).icon} {c.charAt(0).toUpperCase() + c.slice(1)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 bg-gray-50/80 shrink-0">
          {editorMode === 'visual' ? (
            <div className="flex items-center gap-0.5 flex-wrap">
              <TbBtn icon={<Bold className="h-4 w-4" />} onClick={() => execCmd('bold')} title="Bold" />
              <TbBtn icon={<Italic className="h-4 w-4" />} onClick={() => execCmd('italic')} title="Italic" />
              <TbBtn icon={<Underline className="h-4 w-4" />} onClick={() => execCmd('underline')} title="Underline" />
              <TbBtn icon={<Strikethrough className="h-4 w-4" />} onClick={() => execCmd('strikeThrough')} title="Strikethrough" />
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <TbBtn icon={<Link className="h-4 w-4" />} onClick={() => { const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); }} title="Link" />
              <TbBtn icon={<Image className="h-4 w-4" />} onClick={() => { const url = prompt('Image URL:'); if (url) execCmd('insertImage', url); }} title="Image" />
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <TbBtn icon={<ListOrdered className="h-4 w-4" />} onClick={() => execCmd('insertOrderedList')} title="Numbered list" />
              <TbBtn icon={<List className="h-4 w-4" />} onClick={() => execCmd('insertUnorderedList')} title="Bullet list" />
              <TbBtn icon={<AlignLeft className="h-4 w-4" />} onClick={() => execCmd('justifyLeft')} title="Align left" />
              <TbBtn icon={<AlignCenter className="h-4 w-4" />} onClick={() => execCmd('justifyCenter')} title="Center" />
              <TbBtn icon={<AlignRight className="h-4 w-4" />} onClick={() => execCmd('justifyRight')} title="Align right" />
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <TbBtn icon={<Type className="h-4 w-4" />} onClick={() => execCmd('removeFormat')} title="Clear formatting" />
              <div className="w-px h-5 bg-gray-200 mx-1" />

              {/* Personalization variables dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-100 transition-colors">
                    <span>{'{}'}</span> Variables <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-44">
                  {personalizationVars.map(v => (
                    <DropdownMenuItem key={v.name} onClick={() => insertVariable(v.name)}>
                      <code className="text-xs text-blue-600 mr-2">{`{{${v.name}}}`}</code>
                      <span className="text-gray-400 text-xs">{v.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Code className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">HTML Source</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={() => { setShowDeliverability(!showDeliverability); if (!showDeliverability && !deliverabilityResult) analyzeDeliverability(); }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-all font-medium ${
                showDeliverability ? 'bg-green-100 text-green-700 border border-green-300' : 'text-gray-500 hover:bg-green-50 hover:text-green-600 border border-transparent'
              }`}>
              <Shield className="h-3.5 w-3.5" /> Deliverability
            </button>
            <button onClick={() => setShowAiSection(!showAiSection)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-all font-medium ${
                showAiSection ? 'bg-purple-100 text-purple-700 border border-purple-300' : 'text-gray-500 hover:bg-purple-50 hover:text-purple-600 border border-transparent'
              }`}>
              <Sparkles className="h-3.5 w-3.5" /> AI Write
            </button>
            <button onClick={toggleEditorMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                editorMode === 'html'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:bg-gray-200 border border-transparent'
              }`}>
              <Code className="h-3.5 w-3.5" />
              {'</>'}
            </button>
          </div>
        </div>

        {/* AI Section (collapsible, above editor) */}
        {showAiSection && (
          <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200/50 shrink-0">
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                    <Brain className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">AI Template Generator</span>
                </div>
                <button onClick={() => setShowAiSection(false)} className="p-1 hover:bg-purple-100 rounded">
                  <X className="h-3.5 w-3.5 text-gray-400" />
                </button>
              </div>

              <div className="flex gap-1.5">
                {(['text', 'html', 'both'] as const).map(f => (
                  <button key={f} onClick={() => setAiFormat(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      aiFormat === f ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-purple-50'
                    }`}>
                    {f === 'text' ? 'Text' : f === 'html' ? 'HTML' : 'Both'}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Describe the email you want to create..."
                  className="flex-1 text-sm border border-purple-200 rounded-lg px-3 py-2 bg-white outline-none focus:border-purple-400 resize-none h-16" />
                <button className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 self-end"
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
                      } else { setAiError('Generation failed. Check Azure OpenAI config.'); }
                    } catch (e) { setAiError('Could not reach server'); }
                    setAiGenerating(false);
                  }}>
                  {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Generate
                </button>
              </div>

              {aiError && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2 border border-red-100">{aiError}</div>}

              {aiResult && (
                <div className="space-y-2">
                  {aiResult.format === 'both' && aiResult.textContent && aiResult.htmlContent ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] font-semibold text-gray-600 mb-1">Text Version</div>
                        <div className="text-xs text-gray-700 bg-white rounded-lg p-2 max-h-20 overflow-y-auto whitespace-pre-wrap border">{aiResult.textContent}</div>
                        <button onClick={() => {
                          setFormContent(aiResult.textContent!); pendingContentRef.current = aiResult.textContent!;
                          if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.textContent!;
                        }} className="mt-1 w-full text-[11px] px-3 py-1 bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 font-medium border border-purple-200">Use Text</button>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-gray-600 mb-1">HTML Version</div>
                        <div className="text-xs text-gray-700 bg-white rounded-lg p-2 max-h-20 overflow-y-auto whitespace-pre-wrap border">{aiResult.htmlContent}</div>
                        <button onClick={() => {
                          setFormContent(aiResult.htmlContent!); pendingContentRef.current = aiResult.htmlContent!;
                          if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.htmlContent!;
                        }} className="mt-1 w-full text-[11px] px-3 py-1 bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 font-medium border border-purple-200">Use HTML</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-gray-700 bg-white rounded-lg p-2 max-h-24 overflow-y-auto whitespace-pre-wrap border">{aiResult.content}</div>
                      <button onClick={() => {
                        setFormContent(aiResult.content); pendingContentRef.current = aiResult.content;
                        if (editorRef.current && editorMode === 'visual') editorRef.current.innerHTML = aiResult.content;
                      }} className="mt-1 text-[11px] px-4 py-1 bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 font-medium border border-purple-200">Use Content</button>
                    </div>
                  )}
                </div>
              )}

              {!aiResult && (
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Welcome onboarding email', 'Cold outreach to decision makers',
                    'Follow-up after meeting', 'Product launch announcement',
                    'Re-engagement for churned users', 'Partnership proposal',
                  ].map(p => (
                    <button key={p} onClick={() => setAiPrompt(p)}
                      className="text-[11px] px-2.5 py-1 bg-white text-gray-500 rounded-md border border-purple-200 hover:bg-purple-100 hover:text-purple-700 transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Editor Area + Deliverability Side Panel */}
        <div className="flex-1 overflow-hidden flex">
          {/* Editor */}
          <div className={`flex-1 overflow-hidden bg-white transition-all duration-300 ${showDeliverability ? 'min-w-0' : ''}`}>
            {editorMode === 'visual' ? (
              <div
                ref={editorRef}
                contentEditable
                onInput={() => { if (editorRef.current) { setFormContent(editorRef.current.innerHTML); pendingContentRef.current = editorRef.current.innerHTML; } }}
                className="h-full overflow-y-auto px-8 py-6 text-sm text-gray-800 outline-none leading-relaxed max-w-4xl mx-auto [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300 [&:empty]:before:italic [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
                data-placeholder="Start composing your email template here..."
                suppressContentEditableWarning
              />
            ) : (
              <textarea
                value={formContent}
                onChange={(e) => { setFormContent(e.target.value); pendingContentRef.current = e.target.value; }}
                className="w-full h-full px-8 py-6 text-[13px] font-mono leading-relaxed bg-[#1e1e2e] text-[#cdd6f4] outline-none resize-none border-0 selection:bg-blue-800/50"
                placeholder="<p>Hi {{firstName}},</p>&#10;&#10;<p>Your HTML email content here...</p>"
                spellCheck={false}
              />
            )}
          </div>

          {/* Deliverability Side Panel */}
          {showDeliverability && (
            <div className="w-[340px] shrink-0 border-l border-green-200/50 bg-gradient-to-b from-green-50 to-emerald-50 overflow-y-auto">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                      <Shield className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-xs font-bold text-gray-800">Deliverability</span>
                    {deliverabilityLoading && <Loader2 className="h-3 w-3 animate-spin text-green-600" />}
                  </div>
                  <button onClick={() => setShowDeliverability(false)} className="p-1 hover:bg-green-100 rounded">
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5">
                  {deliverabilityResult && deliverabilityResult.issues.length > 0 && (
                    <button onClick={autoFixDeliverability} disabled={fixLoading}
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md hover:from-purple-700 hover:to-indigo-700 font-medium disabled:opacity-50">
                      {fixLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      Auto-fix
                    </button>
                  )}
                  <button onClick={() => analyzeDeliverability()} className="text-[11px] px-2.5 py-1 bg-white border border-green-200 rounded-md text-green-700 hover:bg-green-50 font-medium">
                    Re-analyze
                  </button>
                </div>

                {deliverabilityResult ? (
                  <div className="space-y-3">
                    {/* Score */}
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center font-bold ${
                        deliverabilityResult.grade === 'A' ? 'bg-green-100 text-green-700' :
                        deliverabilityResult.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                        deliverabilityResult.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        <span className="text-xl leading-none">{deliverabilityResult.grade}</span>
                        <span className="text-[9px] font-medium opacity-70">{deliverabilityResult.score}/100</span>
                      </div>

                      {/* Quick Stats - 2x2 grid */}
                      <div className="flex-1 grid grid-cols-2 gap-1.5">
                        {[
                          { label: 'Words', value: deliverabilityResult.wordCount, good: deliverabilityResult.wordCount >= 50 && deliverabilityResult.wordCount <= 200 },
                          { label: 'Links', value: deliverabilityResult.linkCount, good: deliverabilityResult.linkCount <= 3 },
                          { label: 'Images', value: deliverabilityResult.imageCount, good: deliverabilityResult.imageCount <= 2 },
                          { label: 'Vars', value: deliverabilityResult.personalizationCount, good: deliverabilityResult.personalizationCount >= 1 },
                        ].map(s => (
                          <div key={s.label} className={`rounded-lg px-2 py-1.5 text-center border ${s.good ? 'bg-white border-green-200' : 'bg-white border-orange-200'}`}>
                            <div className={`text-sm font-bold ${s.good ? 'text-green-700' : 'text-orange-600'}`}>{s.value}</div>
                            <div className="text-[9px] text-gray-500 font-medium">{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Issues */}
                    {deliverabilityResult.issues.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Issues ({deliverabilityResult.issues.length})</div>
                        {deliverabilityResult.issues.map((issue, i) => (
                          <div key={i} className={`rounded-lg px-2.5 py-2 text-[11px] border ${
                            issue.severity === 'critical' ? 'bg-red-50 border-red-200' :
                            issue.severity === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                            'bg-blue-50 border-blue-200'
                          }`}>
                            <div className="flex items-start gap-1.5">
                              <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${
                                issue.severity === 'critical' ? 'bg-red-500' : issue.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-400'
                              }`}>
                                {issue.severity === 'critical' ? '!' : issue.severity === 'warning' ? '!' : 'i'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-gray-700">{issue.category}</span>
                                <span className="text-gray-500"> — </span>
                                <span className="text-gray-600">{issue.message}</span>
                                {issue.fix && <div className="text-gray-500 mt-0.5 text-[10px]">Tip: {issue.fix}</div>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {deliverabilityResult.issues.length === 0 && (
                      <div className="bg-green-100 border border-green-200 rounded-lg px-3 py-2.5 text-[11px] text-green-800 font-medium">
                        No issues found — your email looks good!
                      </div>
                    )}

                    {/* AI Suggestions */}
                    {deliverabilityResult.aiSuggestions.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1">
                          <Sparkles className="h-2.5 w-2.5 text-purple-500" /> AI Suggestions
                        </div>
                        {deliverabilityResult.aiSuggestions.map((tip, i) => (
                          <div key={i} className="flex items-start gap-1.5 bg-white border border-purple-200 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-700">
                            <span className="text-purple-500 font-bold mt-px">{i + 1}.</span>
                            <span>{tip}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Changes applied by auto-fix */}
                    {fixChanges.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1">
                          <Wand2 className="h-2.5 w-2.5 text-green-500" /> Changes Applied
                        </div>
                        <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
                          {fixChanges.map((change, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-[11px] text-green-800 py-0.5">
                              <span className="text-green-500 mt-0.5">&#10003;</span>
                              <span>{change}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500 text-center py-6">
                    {deliverabilityLoading ? 'Analyzing...' : 'Add subject and content, then click Re-analyze'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Preview Dialog (still a dialog for overlay) */}
        <Dialog open={showPreview} onOpenChange={(open) => { setShowPreview(open); if (!open) setPreviewMode('desktop'); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-blue-600" /> Email Preview
                  </DialogTitle>
                  <DialogDescription>Variables are replaced with sample data.</DialogDescription>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setPreviewMode('desktop')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewMode === 'desktop' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Monitor className="h-3.5 w-3.5" /> Desktop
                  </button>
                  <button
                    onClick={() => setPreviewMode('mobile')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewMode === 'mobile' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Smartphone className="h-3.5 w-3.5" /> Mobile
                  </button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Subject Line</div>
                <div className="font-semibold text-gray-900">{previewSubject}</div>
              </div>
              <div className={`flex justify-center ${previewMode === 'mobile' ? 'bg-gray-100 rounded-xl p-6' : ''}`}>
                <div className={`border border-gray-200 rounded-xl bg-white overflow-hidden transition-all duration-300 ${previewMode === 'mobile' ? 'w-[375px] shadow-xl rounded-[2rem] border-[8px] border-gray-800 relative' : 'w-full'}`}>
                  {previewMode === 'mobile' && (
                    <div className="bg-gray-800 text-center py-2">
                      <div className="w-20 h-1.5 bg-gray-600 rounded-full mx-auto" />
                    </div>
                  )}
                  <div className={previewMode === 'mobile' ? 'p-4 max-h-[500px] overflow-y-auto' : 'p-6'}>
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }}
                      className={`prose max-w-none text-gray-800 [&_a]:text-blue-600 [&_img]:max-w-full ${previewMode === 'mobile' ? 'prose-sm text-[13px]' : 'prose-sm'}`} />
                  </div>
                  {previewMode === 'mobile' && (
                    <div className="bg-gray-800 text-center py-3">
                      <div className="w-10 h-10 border-2 border-gray-600 rounded-full mx-auto" />
                    </div>
                  )}
                </div>
              </div>
              {previewContact && (
                <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                  <Info className="h-3.5 w-3.5" />
                  <span>Sample: {previewContact.firstName} {previewContact.lastName} ({previewContact.email})</span>
                </div>
              )}

              {/* Send Test Email Section */}
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Send Test Email
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={testEmailAccountId}
                    onChange={(e) => setTestEmailAccountId(e.target.value)}
                    className="h-9 text-sm border border-gray-200 rounded-lg px-2 bg-white min-w-[180px]"
                  >
                    {emailAccounts.length === 0 && <option value="">No accounts</option>}
                    {emailAccounts.map((acc: any) => (
                      <option key={acc.id} value={acc.id}>{acc.name || acc.email}</option>
                    ))}
                  </select>
                  <Input
                    type="email"
                    placeholder="recipient@example.com"
                    value={testEmail}
                    onChange={(e) => { setTestEmail(e.target.value); setTestError(''); }}
                    className="h-9 text-sm flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={sendTestEmail}
                    disabled={testSending || !testEmail || !testEmailAccountId}
                    className="h-9 px-4"
                  >
                    {testSending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : testSent ? <CheckCircle className="h-3.5 w-3.5 mr-1.5 text-green-300" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                    {testSending ? 'Sending...' : testSent ? 'Sent!' : 'Send Test'}
                  </Button>
                </div>
                {testError && <p className="text-xs text-red-500 mt-2">{testError}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreview(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ============================================================
  // TEMPLATE LIST VIEW (normal view when editor is closed)
  // ============================================================
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
              <div key={template.id} className="grid grid-cols-[1fr_140px_100px_100px_80px_48px] gap-3 px-4 py-3 border-b border-gray-50 hover:bg-blue-50/30 transition-colors group items-center cursor-pointer"
                onClick={() => openEditor(template)}>
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
                <div onClick={(e) => e.stopPropagation()}>
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

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={(open) => { setShowPreview(open); if (!open) setPreviewMode('desktop'); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-600" /> Email Preview
                </DialogTitle>
                <DialogDescription>Variables are replaced with sample data.</DialogDescription>
              </div>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewMode === 'desktop' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button
                  onClick={() => setPreviewMode('mobile')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewMode === 'mobile' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Mobile
                </button>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Subject Line</div>
              <div className="font-semibold text-gray-900">{previewSubject}</div>
            </div>
            <div className={`flex justify-center ${previewMode === 'mobile' ? 'bg-gray-100 rounded-xl p-6' : ''}`}>
              <div className={`border border-gray-200 rounded-xl bg-white overflow-hidden transition-all duration-300 ${previewMode === 'mobile' ? 'w-[375px] shadow-xl rounded-[2rem] border-[8px] border-gray-800 relative' : 'w-full'}`}>
                {previewMode === 'mobile' && (
                  <div className="bg-gray-800 text-center py-2">
                    <div className="w-20 h-1.5 bg-gray-600 rounded-full mx-auto" />
                  </div>
                )}
                <div className={previewMode === 'mobile' ? 'p-4 max-h-[500px] overflow-y-auto' : 'p-6'}>
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }}
                    className={`prose max-w-none text-gray-800 [&_a]:text-blue-600 [&_img]:max-w-full ${previewMode === 'mobile' ? 'prose-sm text-[13px]' : 'prose-sm'}`} />
                </div>
                {previewMode === 'mobile' && (
                  <div className="bg-gray-800 text-center py-3">
                    <div className="w-10 h-10 border-2 border-gray-600 rounded-full mx-auto" />
                  </div>
                )}
              </div>
            </div>
            {previewContact && (
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                <Info className="h-3.5 w-3.5" />
                <span>Sample: {previewContact.firstName} {previewContact.lastName} ({previewContact.email})</span>
              </div>
            )}

            {/* Send Test Email Section */}
            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
              <div className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Send Test Email
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={testEmailAccountId}
                  onChange={(e) => setTestEmailAccountId(e.target.value)}
                  className="h-9 text-sm border border-gray-200 rounded-lg px-2 bg-white min-w-[180px]"
                >
                  {emailAccounts.length === 0 && <option value="">No accounts</option>}
                  {emailAccounts.map((acc: any) => (
                    <option key={acc.id} value={acc.id}>{acc.name || acc.email}</option>
                  ))}
                </select>
                <Input
                  type="email"
                  placeholder="recipient@example.com"
                  value={testEmail}
                  onChange={(e) => { setTestEmail(e.target.value); setTestError(''); }}
                  className="h-9 text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={sendTestEmail}
                  disabled={testSending || !testEmail || !testEmailAccountId}
                  className="h-9 px-4"
                >
                  {testSending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : testSent ? <CheckCircle className="h-3.5 w-3.5 mr-1.5 text-green-300" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                  {testSending ? 'Sending...' : testSent ? 'Sent!' : 'Send Test'}
                </Button>
              </div>
              {testError && <p className="text-xs text-red-500 mt-2">{testError}</p>}
            </div>
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
