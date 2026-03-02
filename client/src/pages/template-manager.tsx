import React, { useState, useEffect } from "react";
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
  MoreHorizontal, Code, Sparkles, Tag, Clock, Hash, Brain, Wand2
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

  // Form
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('general');
  const [formSubject, setFormSubject] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // AI Generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showAiSection, setShowAiSection] = useState(false);

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
    setShowEditor(true);
  };

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
        setShowPreview(true);
      }
    } catch (e) { /* ignore */ }
  };

  const insertVariable = (varName: string) => {
    setFormContent(prev => prev + `{{${varName}}}`);
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
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input 
              placeholder="Search templates..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="pl-9 h-9 text-sm bg-white border-gray-200" 
            />
          </div>

          {/* Category Filter */}
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
        <Button 
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50" 
          size="sm"
          onClick={() => openEditor()}
        >
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
          <p className="text-sm text-gray-400 mb-6 max-w-sm text-center">
            Create reusable email templates with personalization variables to speed up your campaigns
          </p>
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
                  {/* Card Header */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 truncate text-sm">{template.name}</h4>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="outline" className={`text-[10px] font-medium ${catConfig.bg} ${catConfig.text} ${catConfig.border}`}>
                            <span className="mr-0.5">{catConfig.icon}</span> {template.category}
                          </Badge>
                          {template.usageCount > 0 && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                              <Hash className="h-3 w-3" /> Used {template.usageCount}x
                            </span>
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
                          <DropdownMenuItem onClick={() => handlePreview(template)}>
                            <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                          </DropdownMenuItem>
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    
                    {/* Subject Line */}
                    <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">Subject</div>
                      <div className="text-sm text-gray-700 truncate">{template.subject}</div>
                    </div>

                    {/* Variables */}
                    {template.variables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {template.variables.slice(0, 4).map(v => (
                          <span key={v} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium border border-blue-100">{`{{${v}}}`}</span>
                        ))}
                        {template.variables.length > 4 && (
                          <span className="text-[10px] text-gray-400 px-1">+{template.variables.length - 4} more</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/30">
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(template.updatedAt || template.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handlePreview(template)}>
                        <Eye className="h-3 w-3 mr-1" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEditor(template)}>
                        <Edit className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Template Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Code className="h-4 w-4 text-blue-600" />
              </div>
              {editTemplate ? 'Edit Template' : 'Create New Template'}
            </DialogTitle>
            <DialogDescription>
              {editTemplate ? 'Update your email template' : 'Build a reusable email template with personalization variables'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                        <span className="flex items-center gap-1.5">
                          <span>{getCategoryConfig(c).icon}</span>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Personalization Variables */}
            <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-xl p-3 border border-blue-100/50">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                <Label className="text-xs font-semibold text-blue-700">Personalization Variables</Label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {personalizationVars.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVariable(v.name)}
                    className="text-xs px-2.5 py-1 bg-white text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200/70 transition-colors font-medium shadow-sm"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject Line *</Label>
              <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="e.g., Hi {{firstName}}, welcome!" className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Content (HTML)</Label>
                <button
                  onClick={() => setShowAiSection(!showAiSection)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium ${
                    showAiSection 
                      ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' 
                      : 'bg-gray-100 text-gray-600 hover:bg-yellow-50 hover:text-yellow-600 border border-gray-200'
                  }`}
                >
                  <Sparkles className="h-3 w-3" /> AI Generate
                </button>
              </div>

              {/* AI Generation Section */}
              {showAiSection && (
                <div className="mb-3 p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-yellow-200/60 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="h-4 w-4 text-yellow-600" />
                    <span className="text-xs font-semibold text-yellow-800">AI Template Generator</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      placeholder="Describe the email template... (e.g., 'welcome email for new SaaS users')"
                      className="flex-1 text-xs border border-yellow-200 rounded-lg px-3 py-2 bg-white outline-none focus:border-yellow-400"
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.closest('.space-y-2')?.querySelector<HTMLButtonElement>('button.ai-gen-btn')?.click(); }}
                    />
                    <button
                      className="ai-gen-btn flex items-center gap-1 px-3 py-2 text-xs font-medium bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50 whitespace-nowrap"
                      disabled={aiGenerating || !aiPrompt.trim()}
                      onClick={async () => {
                        if (!aiPrompt.trim()) return;
                        setAiGenerating(true);
                        try {
                          const res = await fetch('/api/llm/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ prompt: aiPrompt, type: 'template', context: { category: formCategory, name: formName } }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setFormContent(data.content);
                            // Try to extract subject from generated content
                            const subjectMatch = data.content.match(/Subject:\s*(.+)/i);
                            if (subjectMatch && !formSubject) {
                              setFormSubject(subjectMatch[1].trim());
                            }
                          }
                        } catch (e) { console.error('AI generation failed:', e); }
                        setAiGenerating(false);
                      }}
                    >
                      {aiGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      {aiGenerating ? 'Generating...' : 'Generate'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {['Welcome onboarding email', 'Cold outreach for SaaS', 'Follow-up after meeting', 'Product launch announcement'].map(p => (
                      <button key={p} onClick={() => setAiPrompt(p)}
                        className="text-[10px] px-2 py-0.5 bg-white text-yellow-700 rounded-full border border-yellow-200 hover:bg-yellow-100 transition-colors">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={14}
                className="font-mono text-sm bg-gray-50"
                placeholder="<p>Hi {{firstName}},</p>\n<p>Your email content here...</p>"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={formLoading || !formName || !formSubject} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-emerald-50 p-2 rounded-lg">
                <Eye className="h-4 w-4 text-emerald-600" />
              </div>
              Template Preview
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Subject Line</div>
              <div className="font-medium text-gray-900">{previewSubject}</div>
            </div>
            <div className="border border-gray-200 rounded-xl p-5 bg-white">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
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
