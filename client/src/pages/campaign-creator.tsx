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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Send, ArrowLeft, ArrowRight, Eye, Clock, Users, Mail, 
  FileText, Loader2, CheckCircle, AlertCircle, Calendar, Zap, Plus
} from "lucide-react";

interface CampaignFormProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function CampaignCreator({ onSuccess, onBack }: CampaignFormProps) {
  const [step, setStep] = useState(1); // 1=setup, 2=compose, 3=recipients, 4=review
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Email accounts
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsCount, setContactsCount] = useState(0);

  // Campaign form data
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
  
  // Preview
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const [error, setError] = useState('');
  const [sendResult, setSendResult] = useState<any>(null);

  // Personalization variables
  const personalizationVars = [
    { name: 'firstName', label: 'First Name' },
    { name: 'lastName', label: 'Last Name' },
    { name: 'email', label: 'Email' },
    { name: 'company', label: 'Company' },
    { name: 'jobTitle', label: 'Job Title' },
    { name: 'fullName', label: 'Full Name' },
  ];

  useEffect(() => {
    fetchData();
  }, []);

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
    if (target === 'subject') {
      setSubject(prev => prev + tag);
    } else {
      setContent(prev => prev + tag);
    }
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
    if (checked) {
      setSelectedContacts(contacts.filter(c => c.status !== 'unsubscribed').map(c => c.id));
    } else {
      setSelectedContacts([]);
    }
  };

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSendCampaign = async () => {
    setError('');
    setSending(true);
    
    try {
      // 1. Create the campaign
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: campaignName,
          description,
          emailAccountId,
          templateId: templateId || null,
          subject,
          content,
          contactIds: selectAll ? [] : selectedContacts,
          status: scheduleEnabled ? 'scheduled' : 'draft',
          scheduledAt: scheduleEnabled ? scheduledAt : null,
          totalRecipients: selectAll ? contactsCount : selectedContacts.length,
        }),
      });

      if (!createRes.ok) {
        throw new Error('Failed to create campaign');
      }

      const campaign = await createRes.json();

      // 2. Send or schedule the campaign
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Success screen
  if (sendResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16">
        <div className="bg-green-100 p-4 rounded-full mb-6">
          <CheckCircle className="h-16 w-16 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {sendResult.scheduled ? 'Campaign Scheduled!' : 'Campaign Launched!'}
        </h2>
        <p className="text-gray-600 mb-6 text-center max-w-md">
          {sendResult.scheduled 
            ? `Your campaign "${campaignName}" has been scheduled. It will start sending at the specified time.`
            : `Your campaign "${campaignName}" is now sending to ${recipientCount} contacts.`
          }
        </p>
        <div className="flex space-x-3">
          <Button variant="outline" onClick={onSuccess}>Back to Campaigns</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-8">
        {[
          { num: 1, label: 'Setup' },
          { num: 2, label: 'Compose' },
          { num: 3, label: 'Recipients' },
          { num: 4, label: 'Review & Send' },
        ].map((s, i) => (
          <React.Fragment key={s.num}>
            <div 
              className={`flex items-center cursor-pointer ${step >= s.num ? 'text-blue-600' : 'text-gray-400'}`}
              onClick={() => s.num < step && setStep(s.num)}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s.num ? 'bg-blue-600 text-white' : step > s.num ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
              }`}>
                {step > s.num ? '✓' : s.num}
              </div>
              <span className="ml-2 text-sm font-medium hidden sm:inline">{s.label}</span>
            </div>
            {i < 3 && <div className={`flex-1 h-0.5 mx-4 ${step > s.num ? 'bg-blue-600' : 'bg-gray-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Setup */}
      {step === 1 && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <Label className="text-sm font-medium">Campaign Name *</Label>
                <Input
                  placeholder="e.g., Q1 Product Launch"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Description (optional)</Label>
                <Textarea
                  placeholder="Brief description of this campaign..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Send From *</Label>
                {emailAccounts.length === 0 ? (
                  <Alert className="mt-1">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No email accounts configured. Please add an SMTP account first in the Email & Import section.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={emailAccountId} onValueChange={setEmailAccountId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select email account" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center">
                            <span>{a.displayName || a.email}</span>
                            <Badge variant="outline" className="ml-2 text-xs">{a.provider}</Badge>
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
            <Button 
              onClick={() => setStep(2)}
              disabled={!campaignName || !emailAccountId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Next: Compose <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Compose Email */}
      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              {/* Template selector */}
              <div>
                <Label className="text-sm font-medium">Use Template (optional)</Label>
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Start from scratch or select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Start from scratch</SelectItem>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center">
                          <FileText className="h-4 w-4 mr-2" />
                          {t.name}
                          <Badge variant="secondary" className="ml-2 text-xs">{t.category}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Personalization variables */}
              <div>
                <Label className="text-xs text-gray-500">Insert personalization</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {personalizationVars.map((v) => (
                    <button
                      key={v.name}
                      onClick={() => insertVariable(v.name, 'content')}
                      className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 border border-blue-200"
                    >
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div>
                <Label className="text-sm font-medium">Subject Line *</Label>
                <Input
                  placeholder="e.g., Hi {{firstName}}, check this out!"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* Content */}
              <div>
                <Label className="text-sm font-medium">Email Body *</Label>
                <Textarea
                  placeholder="Write your email content here. Use {{firstName}}, {{company}}, etc. for personalization..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={12}
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">Supports HTML. Personalization variables: {`{{firstName}}`}, {`{{lastName}}`}, {`{{company}}`}, {`{{email}}`}, {`{{jobTitle}}`}</p>
              </div>

              <Button variant="outline" onClick={handlePreview}>
                <Eye className="h-4 w-4 mr-2" /> Preview Email
              </Button>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button 
              onClick={() => setStep(3)}
              disabled={!subject || !content}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Next: Recipients <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Select Recipients */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium text-gray-900">Select Recipients</h3>
                  <p className="text-sm text-gray-500">{recipientCount} contacts selected</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch checked={selectAll} onCheckedChange={handleSelectAll} />
                  <Label className="text-sm">Select all ({contactsCount} contacts)</Label>
                </div>
              </div>

              <div className="border rounded-lg divide-y max-h-[400px] overflow-y-auto">
                {contacts.filter(c => c.status !== 'unsubscribed').map((contact: any) => (
                  <label
                    key={contact.id}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(contact.id)}
                      onChange={() => toggleContact(contact.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 mr-3"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center">
                        <span className="font-medium text-sm text-gray-900">
                          {contact.firstName} {contact.lastName}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">{contact.status}</Badge>
                      </div>
                      <div className="text-xs text-gray-500">{contact.email} {contact.company ? `• ${contact.company}` : ''}</div>
                    </div>
                  </label>
                ))}
                {contacts.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    <p>No contacts yet. Import contacts first.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button 
              onClick={() => setStep(4)}
              disabled={recipientCount === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Next: Review <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Send */}
      {step === 4 && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-6">
              <h3 className="font-semibold text-lg text-gray-900">Campaign Summary</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 uppercase">Campaign</div>
                  <div className="font-medium">{campaignName}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 uppercase">From</div>
                  <div className="font-medium">{emailAccounts.find(a => a.id === emailAccountId)?.email || 'N/A'}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 uppercase">Subject</div>
                  <div className="font-medium">{subject}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 uppercase">Recipients</div>
                  <div className="font-medium flex items-center">
                    <Users className="h-4 w-4 mr-1" /> {recipientCount} contacts
                  </div>
                </div>
              </div>

              {/* Scheduling */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <Label>Schedule for later</Label>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                </div>
                {scheduleEnabled && (
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                )}
              </div>

              {/* Throttle Settings */}
              <div className="border-t pt-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Zap className="h-4 w-4 text-gray-500" />
                  <Label className="text-sm font-medium">Sending Speed</Label>
                </div>
                <Select value={String(throttleDelay)} onValueChange={(v) => setThrottleDelay(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1000">Fast (1 email/sec)</SelectItem>
                    <SelectItem value="2000">Normal (1 email/2 sec)</SelectItem>
                    <SelectItem value="5000">Slow (1 email/5 sec)</SelectItem>
                    <SelectItem value="10000">Very Slow (1 email/10 sec)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">Slower speeds help with deliverability and avoid spam filters.</p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <div className="flex space-x-3">
              <Button variant="outline" onClick={handlePreview}>
                <Eye className="h-4 w-4 mr-2" /> Preview
              </Button>
              <Button
                onClick={handleSendCampaign}
                disabled={sending || (scheduleEnabled && !scheduledAt)}
                className="bg-blue-600 hover:bg-blue-700 min-w-[160px]"
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
            <DialogTitle>Email Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
