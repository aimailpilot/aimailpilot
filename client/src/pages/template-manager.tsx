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
  Monitor, Info
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  category: string;
  subject: string;
  content: string;
  variables: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
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

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/templates', { credentials: 'include' });
      if (res.ok) setTemplates(await res.json());
    } catch (e) { console.error('Failed to fetch templates:', e); }
    setLoading(false);
  };

  const openEditor = (template?: Template) => {
    if (template) {
      setEditTemplate(template);
      setFormName(template.name);
      setFormCategory(template.category);
      setFormSubject(template.subject);
      setFormContent(template.content);
    } else {
      setEditTemplate(null);
      setFormName('');
      setFormCategory('general');
      setFormSubject('');
      setFormContent('');
    }
    setEditorMode('visual');
    setShowEditor(true);
  };

  // When editor dialog opens, populate content editable
  useEffect(() => {
    if (showEditor && editorMode === 'visual' && editorRef.current) {
      editorRef.current.innerHTML = formContent || '';
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
        await fetchTemplates();
      }
    } catch (e) { console.error('Save failed:', e); }
    setFormLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/templates/${id}`, { method: 'DELETE', credentials: 'include' });
    await fetchTemplates();
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
      await fetchTemplates();
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

  // Preview current form content
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
      // Going to HTML - capture from contentEditable
      if (editorRef.current) {
        setFormContent(editorRef.current.innerHTML);
      }
      setEditorMode('html');
    } else {
      // Going to visual - apply HTML content
      setEditorMode('visual');
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = formContent || '';
        }
      }, 50);
    }
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || 
      t.category.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
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

  const uniqueCategories = ['all', ...new Set(templates.map(t => t.category))];

  return (
    <div className="p-6 space-y-5">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-sm bg-white border-gray-200" />
          </div>
          <div className="flex items-center gap-0.5 bg-gray-100/80 rounded-lg p-0.5">
            {uniqueCategories.slice(0, 6).map((cat) => (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
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

      {/* Templates Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading templates...</span>
          </div>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
            <FileText className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1.5">No templates yet</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">Create reusable email templates with personalization variables</p>
          <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" onClick={() => openEditor()}>
            <Plus className="h-4 w-4 mr-2" /> Create Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => {
            const catConfig = getCategoryConfig(template.category);
            return (
              <Card key={template.id} className="group border-gray-200/60 shadow-sm hover:shadow-md hover:border-blue-200/50 transition-all duration-200">
                <CardContent className="p-0">
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 truncate text-sm">{template.name}</h4>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="outline" className={`text-[10px] font-medium ${catConfig.bg} ${catConfig.text} ${catConfig.border}`}>
                            <span className="mr-0.5">{catConfig.icon}</span> {template.category}
                          </Badge>
                          {template.usageCount > 0 && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Hash className="h-3 w-3" /> Used {template.usageCount}x</span>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => handlePreview(template)}><Eye className="h-3.5 w-3.5 mr-2" /> Preview</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditor(template)}><Edit className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(template)}><Copy className="h-3.5 w-3.5 mr-2" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(template.id)} className="text-red-600"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">Subject</div>
                      <div className="text-sm text-gray-700 truncate">{template.subject}</div>
                    </div>
                    {template.variables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {template.variables.slice(0, 4).map(v => (
                          <span key={v} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium border border-blue-100">{`{{${v}}}`}</span>
                        ))}
                        {template.variables.length > 4 && <span className="text-[10px] text-gray-400 px-1">+{template.variables.length - 4} more</span>}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/30">
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(template.updatedAt || template.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handlePreview(template)}><Eye className="h-3 w-3 mr-1" /> Preview</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEditor(template)}><Edit className="h-3 w-3 mr-1" /> Edit</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Template Editor Dialog - Full featured with HTML mode */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
          {/* Editor Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Code className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {editTemplate ? 'Edit Template' : 'New template'}
                </h2>
                <p className="text-xs text-gray-400">Build a reusable email template with HTML and personalization variables</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePreviewForm} disabled={!formContent}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
              </Button>
              <Button size="sm" onClick={handleSave} disabled={formLoading || !formName || !formSubject}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                {editTemplate ? 'Save' : 'Save'}
              </Button>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Template Name *</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Welcome Email" className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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

            {/* Subject Line */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject Line *</Label>
              <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="e.g., Hi {{firstName}}, welcome!" className="mt-1.5" />
            </div>

            {/* Developer mode toggle + Editor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Content</Label>
                <div className="flex items-center gap-2">
                  {/* AI Generate button */}
                  <button onClick={() => setShowAiSection(!showAiSection)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all font-medium ${
                      showAiSection ? 'bg-purple-100 text-purple-700 border border-purple-300 shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-purple-50 hover:text-purple-600 border border-gray-200'
                    }`}>
                    <Sparkles className="h-3 w-3" /> AI Write
                  </button>
                </div>
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
                          if (data.provider === 'demo' && data.note) {
                            setAiError(data.note);
                          }
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

              {/* Personalization Variables */}
              <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-xl p-3 border border-blue-100/50 mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                  <Label className="text-xs font-semibold text-blue-700">Personalization Variables</Label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {personalizationVars.map((v) => (
                    <button key={v.name} onClick={() => insertVariable(v.name)}
                      className="text-xs px-2.5 py-1 bg-white text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200/70 transition-colors font-medium shadow-sm">
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor with toolbar */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {/* Toolbar / Developer mode */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50/80">
                  {editorMode === 'visual' ? (
                    <div className="flex items-center gap-0.5 flex-wrap flex-1">
                      <TbBtn icon={<Bold className="h-3.5 w-3.5" />} onClick={() => execCmd('bold')} title="Bold" />
                      <TbBtn icon={<Italic className="h-3.5 w-3.5" />} onClick={() => execCmd('italic')} title="Italic" />
                      <TbBtn icon={<Underline className="h-3.5 w-3.5" />} onClick={() => execCmd('underline')} title="Underline" />
                      <TbBtn icon={<Strikethrough className="h-3.5 w-3.5" />} onClick={() => execCmd('strikeThrough')} title="Strikethrough" />
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                      <TbBtn icon={<Link className="h-3.5 w-3.5" />} onClick={() => { const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); }} title="Link" />
                      <TbBtn icon={<Image className="h-3.5 w-3.5" />} onClick={() => { const url = prompt('Image URL:'); if (url) execCmd('insertImage', url); }} title="Image" />
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                      <TbBtn icon={<ListOrdered className="h-3.5 w-3.5" />} onClick={() => execCmd('insertOrderedList')} title="Numbered list" />
                      <TbBtn icon={<List className="h-3.5 w-3.5" />} onClick={() => execCmd('insertUnorderedList')} title="Bullet list" />
                      <TbBtn icon={<AlignLeft className="h-3.5 w-3.5" />} onClick={() => execCmd('justifyLeft')} title="Align left" />
                      <TbBtn icon={<AlignCenter className="h-3.5 w-3.5" />} onClick={() => execCmd('justifyCenter')} title="Center" />
                      <div className="w-px h-4 bg-gray-200 mx-1" />
                      <TbBtn icon={<Type className="h-3.5 w-3.5" />} onClick={() => execCmd('removeFormat')} title="Clear formatting" />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500 font-medium">HTML Source Editor</span>
                  )}

                  <button onClick={toggleEditorMode}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      editorMode === 'html'
                        ? 'bg-gray-800 text-white'
                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}>
                    <Code className="h-3.5 w-3.5" />
                    Developer mode {'</>'}
                    {editorMode === 'html' && (
                      <span onClick={(e) => { e.stopPropagation(); toggleEditorMode(); }} className="ml-1 p-0.5 rounded hover:bg-gray-700 cursor-pointer">
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                </div>

                {/* Content area */}
                {editorMode === 'visual' ? (
                  <div
                    ref={editorRef}
                    contentEditable
                    onInput={() => { if (editorRef.current) setFormContent(editorRef.current.innerHTML); }}
                    className="min-h-[280px] max-h-[400px] overflow-y-auto p-5 text-sm text-gray-900 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300"
                    data-placeholder="Compose your email template..."
                    suppressContentEditableWarning
                  />
                ) : (
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    className="w-full min-h-[280px] max-h-[400px] p-5 text-sm font-mono bg-gray-900 text-gray-100 outline-none resize-y border-0"
                    placeholder="<p>Hi {{firstName}},</p>&#10;<p>Your HTML email content here...</p>"
                    spellCheck={false}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50/50">
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handlePreviewForm} disabled={!formContent}>
                <Eye className="h-4 w-4 mr-1.5" /> Preview
              </Button>
              <Button onClick={handleSave} disabled={formLoading || !formName || !formSubject}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
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
