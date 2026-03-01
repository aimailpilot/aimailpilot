import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Plus, Edit, Trash2, Copy, Eye, Loader2, Search, Folder
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
    
    // Extract variables
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

  const filteredTemplates = templates.filter(t => 
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || 
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      onboarding: 'bg-green-50 text-green-700 border-green-200',
      'follow-up': 'bg-orange-50 text-orange-700 border-orange-200',
      marketing: 'bg-purple-50 text-purple-700 border-purple-200',
      outreach: 'bg-blue-50 text-blue-700 border-blue-200',
      newsletter: 'bg-pink-50 text-pink-700 border-pink-200',
      transactional: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    };
    return colors[cat] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Templates</h2>
          <p className="text-sm text-gray-500">{templates.length} templates</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => openEditor()}>
          <Plus className="h-4 w-4 mr-2" /> New Template
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" /></div>
      ) : filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No templates yet</h3>
            <p className="text-gray-500 mb-4">Create reusable email templates with personalization variables.</p>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => openEditor()}>
              <Plus className="h-4 w-4 mr-2" /> Create Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 truncate">{template.name}</h4>
                    <Badge variant="outline" className={`mt-1 text-xs ${getCategoryColor(template.category)}`}>
                      {template.category}
                    </Badge>
                  </div>
                </div>
                
                <div className="text-sm text-gray-600 mb-2 truncate">
                  <strong>Subject:</strong> {template.subject}
                </div>
                
                <div className="text-xs text-gray-400 mb-3">
                  {template.variables?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {template.variables.map(v => (
                        <span key={v} className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-xs">{`{{${v}}}`}</span>
                      ))}
                    </div>
                  )}
                  Used {template.usageCount || 0} times
                </div>
                
                <div className="flex items-center space-x-1 border-t pt-2">
                  <Button variant="ghost" size="sm" onClick={() => handlePreview(template)}>
                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEditor(template)}>
                    <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(template)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(template.id)} className="text-red-500 hover:text-red-700 ml-auto">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Template Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTemplate ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Template Name *</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Welcome Email" />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Personalization */}
            <div>
              <Label className="text-xs text-gray-500">Insert personalization variable</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {personalizationVars.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVariable(v.name)}
                    className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Subject Line *</Label>
              <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="e.g., Hi {{firstName}}, welcome!" />
            </div>
            <div>
              <Label>Email Content (HTML)</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={14}
                className="font-mono text-sm"
                placeholder="<p>Hi {{firstName}},</p>\n<p>Your email content here...</p>"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={formLoading || !formName || !formSubject} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Template Preview</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500">Subject</div>
              <div className="font-medium">{previewSubject}</div>
            </div>
            <div className="border rounded-lg p-4">
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
