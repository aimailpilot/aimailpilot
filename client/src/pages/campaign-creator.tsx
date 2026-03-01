import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Send, ArrowLeft, ArrowRight, Eye, Clock, Users, Mail, 
  FileText, Loader2, CheckCircle, AlertCircle, Calendar, Zap, Plus,
  Sparkles, Target, Rocket, Settings, Search
} from "lucide-react";

interface CampaignFormProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function CampaignCreator({ onSuccess, onBack }: CampaignFormProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsCount, setContactsCount] = useState(0);

  const [campaignName, setCampaignName] = useState('');
  const [description, setDescription] = useState('');
  const [emailAccountId, setEmailAccountId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [throttleDelay, setThrottleDelay] = useState(2000);
  const [contactSearch, setContactSearch] = useState('');
  
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const [error, setError] = useState('');
  const [sendResult, setSendResult] = useState<any>(null);

  const personalizationVars = [
    { name: 'firstName', label: 'First Name' },
    { name: 'lastName', label: 'Last Name' },
    { name: 'email', label: 'Email' },
    { name: 'company', label: 'Company' },
    { name: 'jobTitle', label: 'Job Title' },
    { name: 'fullName', label: 'Full Name' },
  ];

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [acctRes, tmplRes, ctcRes] = await Promise.all([
        fetch('/api/email-accounts', { credentials: 'include' }),
        fetch('/api/templates', { credentials: 'include' }),
        fetch('/api/contacts', { credentials: 'include' }),
      ]);
      
      if (acctRes.ok) {
        const accts = await acctRes.json();
        setEmailAccounts(accts);
        if (accts.length > 0) setEmailAccountId(accts[0].id);
      }
      if (tmplRes.ok) setTemplates(await tmplRes.json());
      if (ctcRes.ok) {
        const data = await ctcRes.json();
        setContacts(data.contacts || data);
        setContactsCount(data.total || (data.contacts || data).length);
      }
    } catch (e) { console.error('Failed to fetch data:', e); }
    setLoading(false);
  };

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id);
    const template = templates.find((t: any) => t.id === id);
    if (template) {
      setSubject(template.subject);
      setContent(template.content);
    }
  };

  const insertVariable = (varName: string, target: 'subject' | 'content') => {
    const tag = `{{${varName}}}`;
    if (target === 'subject') setSubject(prev => prev + tag);
    else setContent(prev => prev + tag);
  };

  const handlePreview = async () => {
    try {
      const res = await fetch('/api/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subject, content }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewSubject(data.subject);
        setPreviewHtml(data.content);
        setShowPreview(true);
      }
    } catch (e) { console.error('Preview failed:', e); }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) setSelectedContacts(contacts.filter(c => c.status !== 'unsubscribed').map(c => c.id));
    else setSelectedContacts([]);
  };

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSendCampaign = async () => {
    setError('');
    setSending(true);
    
    try {
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: campaignName, description, emailAccountId,
          templateId: templateId || null, subject, content,
          contactIds: selectAll ? [] : selectedContacts,
          status: scheduleEnabled ? 'scheduled' : 'draft',
          scheduledAt: scheduleEnabled ? scheduledAt : null,
          totalRecipients: selectAll ? contactsCount : selectedContacts.length,
        }),
      });

      if (!createRes.ok) throw new Error('Failed to create campaign');
      const campaign = await createRes.json();

      if (scheduleEnabled && scheduledAt) {
        const schedRes = await fetch(`/api/campaigns/${campaign.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ scheduledAt, delayBetweenEmails: throttleDelay }),
        });
        const schedData = await schedRes.json();
        setSendResult({ ...schedData, campaignId: campaign.id, scheduled: true });
      } else {
        const sendRes = await fetch(`/api/campaigns/${campaign.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ delayBetweenEmails: throttleDelay }),
        });
        const sendData = await sendRes.json();
        setSendResult({ ...sendData, campaignId: campaign.id });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send campaign');
    }
    setSending(false);
  };

  const recipientCount = selectAll ? contactsCount : selectedContacts.length;

  const filteredContacts = contacts.filter(c => {
    if (c.status === 'unsubscribed') return false;
    if (!contactSearch) return true;
    const search = contactSearch.toLowerCase();
    return (c.firstName?.toLowerCase().includes(search) || c.lastName?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search) || c.company?.toLowerCase().includes(search));
  });

  const getAvatarColor = (email: string) => {
    const colors = ['from-blue-400 to-blue-600', 'from-purple-400 to-purple-600', 'from-emerald-400 to-emerald-600', 'from-amber-400 to-amber-600', 'from-pink-400 to-pink-600'];
    const hash = (email || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading campaign data...</span>
        </div>
      </div>
    );
  }

  // Success screen
  if (sendResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <div className="bg-gradient-to-br from-emerald-100 to-emerald-50 p-5 rounded-2xl mb-6 shadow-sm">
          <CheckCircle className="h-16 w-16 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {sendResult.scheduled ? 'Campaign Scheduled!' : 'Campaign Launched!'}
        </h2>
        <p className="text-gray-500 mb-8 text-center max-w-md">
          {sendResult.scheduled 
            ? `Your campaign "${campaignName}" has been scheduled and will start sending at the specified time.`
            : `Your campaign "${campaignName}" is now sending to ${recipientCount} contacts.`
          }
        </p>
        <Button variant="outline" onClick={onSuccess} className="px-6">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Campaigns
        </Button>
      </div>
    );
  }

  const steps = [
    { num: 1, label: 'Setup', icon: Settings, desc: 'Name & account' },
    { num: 2, label: 'Compose', icon: FileText, desc: 'Email content' },
    { num: 3, label: 'Recipients', icon: Users, desc: 'Select contacts' },
    { num: 4, label: 'Review', icon: Rocket, desc: 'Send campaign' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Stepper */}
      <div className="flex items-center justify-between mb-8 bg-white rounded-xl border border-gray-200/80 p-4 shadow-sm">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <div 
              className={`flex items-center gap-3 cursor-pointer transition-all ${step >= s.num ? 'opacity-100' : 'opacity-40'}`}
              onClick={() => s.num < step && setStep(s.num)}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                step === s.num 
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200/50' 
                  : step > s.num 
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' 
                    : 'bg-gray-100 text-gray-400'
              }`}>
                {step > s.num ? <CheckCircle className="h-5 w-5" /> : <s.icon className="h-5 w-5" />}
              </div>
              <div className="hidden sm:block">
                <div className={`text-sm font-semibold ${step === s.num ? 'text-gray-900' : step > s.num ? 'text-emerald-700' : 'text-gray-400'}`}>
                  {s.label}
                </div>
                <div className="text-[10px] text-gray-400">{s.desc}</div>
              </div>
            </div>
            {i < 3 && (
              <div className={`flex-1 h-[2px] mx-3 rounded-full transition-all ${step > s.num ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Setup */}
      {step === 1 && (
        <div className="space-y-5">
          <Card className="border-gray-200/60 shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Campaign Name *</Label>
                <Input placeholder="e.g., Q1 Product Launch" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="mt-1.5 h-11" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Description <span className="text-gray-400 normal-case font-normal">(optional)</span></Label>
                <Textarea placeholder="Brief description of this campaign..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Send From *</Label>
                {emailAccounts.length === 0 ? (
                  <Alert className="mt-1.5 border-amber-200 bg-amber-50">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-sm text-amber-800">
                      No email accounts configured. Please add an SMTP account first in the <strong>Accounts</strong> section.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={emailAccountId} onValueChange={setEmailAccountId}>
                    <SelectTrigger className="mt-1.5 h-11">
                      <SelectValue placeholder="Select email account" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">{a.displayName || a.email}</span>
                            <Badge variant="outline" className="text-[10px] capitalize">{a.provider}</Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Cancel
            </Button>
            <Button onClick={() => setStep(2)} disabled={!campaignName || !emailAccountId} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              Next: Compose <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Compose */}
      {step === 2 && (
        <div className="space-y-5">
          <Card className="border-gray-200/60 shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Use Template <span className="text-gray-400 normal-case font-normal">(optional)</span></Label>
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Start from scratch or select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Start from scratch</SelectItem>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">{t.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Personalization */}
              <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-xl p-3 border border-blue-100/50">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                  <Label className="text-xs font-semibold text-blue-700">Personalization Variables</Label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {personalizationVars.map((v) => (
                    <button key={v.name} onClick={() => insertVariable(v.name, 'content')}
                      className="text-xs px-2.5 py-1 bg-white text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200/70 transition-colors font-medium shadow-sm">
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject Line *</Label>
                <Input placeholder="e.g., Hi {{firstName}}, check this out!" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1.5 h-11" />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Body *</Label>
                <Textarea
                  placeholder={'Write your email content here. Use {{firstName}}, {{company}}, etc. for personalization...'}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={12}
                  className="mt-1.5 font-mono text-sm bg-gray-50"
                />
                <p className="text-[10px] text-gray-400 mt-1.5">Supports HTML. Available variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}, {'{{email}}'}, {'{{jobTitle}}'}</p>
              </div>

              <Button variant="outline" size="sm" onClick={handlePreview}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview Email
              </Button>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!subject || !content} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              Next: Recipients <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Recipients */}
      {step === 3 && (
        <div className="space-y-5">
          <Card className="border-gray-200/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Select Recipients</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {recipientCount} of {contactsCount} contacts selected
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                    <Switch checked={selectAll} onCheckedChange={handleSelectAll} />
                    <Label className="text-xs font-medium text-blue-700">Select all</Label>
                  </div>
                </div>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input 
                  placeholder="Search contacts..." 
                  value={contactSearch} 
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="pl-9 h-9 text-sm bg-gray-50"
                />
              </div>

              <div className="border border-gray-200 rounded-xl divide-y max-h-[380px] overflow-y-auto">
                {filteredContacts.map((contact: any) => (
                  <label
                    key={contact.id}
                    className={`flex items-center px-4 py-3 cursor-pointer transition-colors ${
                      selectedContacts.includes(contact.id) ? 'bg-blue-50/50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(contact.id)}
                      onChange={() => toggleContact(contact.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-3"
                    />
                    <Avatar className="h-8 w-8 mr-3 flex-shrink-0">
                      <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(contact.email)} text-white text-[10px] font-semibold`}>
                        {(contact.firstName?.[0] || '?')}{(contact.lastName?.[0] || '')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900">{contact.firstName} {contact.lastName}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">{contact.status}</Badge>
                      </div>
                      <div className="text-xs text-gray-400 truncate">{contact.email} {contact.company ? `at ${contact.company}` : ''}</div>
                    </div>
                  </label>
                ))}
                {filteredContacts.length === 0 && (
                  <div className="p-8 text-center text-gray-400">
                    <Users className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm">{contactSearch ? 'No contacts match your search' : 'No contacts yet. Import contacts first.'}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button onClick={() => setStep(4)} disabled={recipientCount === 0} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              Next: Review <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Send */}
      {step === 4 && (
        <div className="space-y-5">
          <Card className="border-gray-200/60 shadow-sm">
            <CardContent className="p-6 space-y-6">
              <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-600" />
                Campaign Summary
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Campaign', value: campaignName, icon: Target },
                  { label: 'From', value: emailAccounts.find(a => a.id === emailAccountId)?.email || 'N/A', icon: Mail },
                  { label: 'Subject', value: subject, icon: FileText },
                  { label: 'Recipients', value: `${recipientCount} contacts`, icon: Users },
                ].map((item, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <item.icon className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{item.label}</span>
                    </div>
                    <div className="font-medium text-sm text-gray-900 truncate">{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Scheduling */}
              <div className="border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-blue-50 p-1.5 rounded-lg">
                      <Clock className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Schedule for later</Label>
                      <p className="text-[10px] text-gray-400">Send at a specific date and time</p>
                    </div>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                </div>
                {scheduleEnabled && (
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)} className="mt-2 h-10" />
                )}
              </div>

              {/* Throttle */}
              <div className="border-t border-gray-100 pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="bg-purple-50 p-1.5 rounded-lg">
                    <Zap className="h-4 w-4 text-purple-600" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Sending Speed</Label>
                    <p className="text-[10px] text-gray-400">Slower speeds improve deliverability</p>
                  </div>
                </div>
                <Select value={String(throttleDelay)} onValueChange={(v) => setThrottleDelay(parseInt(v))}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1000">Fast (1 email/sec)</SelectItem>
                    <SelectItem value="2000">Normal (1 email/2 sec)</SelectItem>
                    <SelectItem value="5000">Slow (1 email/5 sec)</SelectItem>
                    <SelectItem value="10000">Very Slow (1 email/10 sec)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={handlePreview}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
              </Button>
              <Button
                onClick={handleSendCampaign}
                disabled={sending || (scheduleEnabled && !scheduledAt)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 min-w-[160px] shadow-md shadow-blue-200/50"
              >
                {sending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</>
                ) : scheduleEnabled ? (
                  <><Calendar className="h-4 w-4 mr-2" /> Schedule Campaign</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" /> Send Now ({recipientCount})</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-emerald-50 p-2 rounded-lg">
                <Eye className="h-4 w-4 text-emerald-600" />
              </div>
              Email Preview
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
