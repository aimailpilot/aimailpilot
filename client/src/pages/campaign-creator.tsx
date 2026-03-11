import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Send, Eye, Clock, Users, Mail, FileText, Loader2, CheckCircle,
  AlertCircle, Calendar, Zap, Plus, Sparkles, Info, Bold, Italic,
  Underline, Link, Image, Code, List, ListOrdered, AlignLeft,
  AlignCenter, AlignRight, Type, Paperclip, Strikethrough, X,
  MoreVertical, ChevronDown, ChevronLeft, ChevronRight, Upload,
  Copy, Table, Trash2, ArrowLeft, Settings2, Rocket, Pencil,
  SpellCheck, Palette, Brain, Wand2, Play, Monitor, BarChart3
} from "lucide-react";

// ==================== TYPES ====================
interface CampaignFormProps {
  onSuccess: () => void;
  onBack: () => void;
}

interface SequenceStep {
  id: string;
  subject: string;
  content: string;
  condition: 'immediate' | 'if_no_reply' | 'if_no_click' | 'if_no_open' | 'if_opened' | 'if_clicked' | 'if_replied' | 'no_matter_what';
  delayValue: number;
  delayUnit: 'minutes' | 'hours' | 'days' | 'weeks';
}

interface DaySchedule {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

interface AutopilotConfig {
  enabled: boolean;
  days: { [key: string]: DaySchedule };
  maxPerDay: number;
  delayBetween: number;
  delayUnit: 'seconds' | 'minutes';
}

interface ScheduleConfig {
  enabled: boolean;
  date: Date | null;
  time: string;
}

// ==================== MAIN COMPONENT ====================
export default function CampaignCreator({ onSuccess, onBack }: CampaignFormProps) {
  // Data
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactLists, setContactLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [error, setError] = useState('');

  // Campaign fields
  const [emailAccountId, setEmailAccountId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [trackEmails, setTrackEmails] = useState(true);
  const [unsubscribeLink, setUnsubscribeLink] = useState(false);

  // Sequence steps
  const [steps, setSteps] = useState<SequenceStep[]>([
    { id: 'step-1', subject: '', content: '', condition: 'immediate', delayValue: 0, delayUnit: 'days' }
  ]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  // Editor mode: 'visual' or 'html'
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('visual');
  const [htmlSource, setHtmlSource] = useState('');

  // Preview
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<{ previews: Array<{ stepIndex: number; subject: string; content: string; condition: string; delayValue: number; delayUnit: string }>; contact: any } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewActiveStep, setPreviewActiveStep] = useState(0);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Dialogs
  const [showRecipients, setShowRecipients] = useState(false);
  const [showAutopilot, setShowAutopilot] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showReplyTo, setShowReplyTo] = useState(false);
  const [ccValue, setCcValue] = useState('');
  const [bccValue, setBccValue] = useState('');
  const [replyToValue, setReplyToValue] = useState('');

  // Autopilot
  const [autopilot, setAutopilot] = useState<AutopilotConfig>({
    enabled: false,
    days: {
      Monday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Tuesday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Wednesday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Thursday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Friday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Saturday: { enabled: true, startTime: '09:00', endTime: '17:00' },
      Sunday: { enabled: false, startTime: '09:00', endTime: '20:00' },
    },
    maxPerDay: 400, delayBetween: 5, delayUnit: 'minutes',
  });

  // Schedule
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    enabled: false, date: null, time: '09:00',
  });

  // Recipients dialog
  const [recipientTab, setRecipientTab] = useState<'sheets' | 'csv' | 'contacts' | 'paste'>('contacts');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [pasteEmails, setPasteEmails] = useState('');
  const [contactListFilter, setContactListFilter] = useState('all');

  // Google Sheets integration
  const [sheetValidating, setSheetValidating] = useState(false);
  const [sheetValid, setSheetValid] = useState<boolean | null>(null);
  const [sheetError, setSheetError] = useState('');
  const [availableSheets, setAvailableSheets] = useState<{ id: number; name: string; index: number }[]>([]);
  const [sheetContacts, setSheetContacts] = useState<any[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetPreview, setSheetPreview] = useState<{ headers: string[]; values: string[][]; totalRows: number; validContacts: number } | null>(null);

  // Save sheet contacts as a contact list
  const [saveAsContactList, setSaveAsContactList] = useState(true);
  const [sheetListName, setSheetListName] = useState('');
  const [sheetListMode, setSheetListMode] = useState<'new' | 'existing'>('new');
  const [sheetExistingListId, setSheetExistingListId] = useState('');
  const [sheetImportResult, setSheetImportResult] = useState<{ message: string; listName: string } | null>(null);

  // Template dialog
  const [templateTab, setTemplateTab] = useState<'recent' | 'all'>('recent');

  // Quota & AI recommendation for account
  const [accountQuotas, setAccountQuotas] = useState<Record<string, { dailyLimit: number; dailySent: number; remaining: number; usagePercent: number; provider: string }>>({});
  const [aiRecBanner, setAiRecBanner] = useState<{ accountId: string; email: string; reason: string; provider: string } | null>(null);
  const [loadingAiRec, setLoadingAiRec] = useState(false);

  // AI Generation
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiType, setAiType] = useState<'template' | 'campaign' | 'subject' | 'personalize'>('campaign');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{ content: string; model: string; provider: string } | null>(null);
  const [aiError, setAiError] = useState('');

  // Editor ref
  const editorRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close more menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  // Fetch data
  useEffect(() => {
    (async () => {
      try {
        const [acctRes, tmplRes, ctcRes, listRes] = await Promise.all([
          fetch('/api/email-accounts', { credentials: 'include' }),
          fetch('/api/templates', { credentials: 'include' }),
          fetch('/api/contacts?limit=10000', { credentials: 'include' }),
          fetch('/api/contact-lists', { credentials: 'include' }),
        ]);
        // Fetch quotas
        const quotaRes = await fetch('/api/email-accounts/quota-summary', { credentials: 'include' }).catch(() => null);
        if (quotaRes?.ok) {
          const qData = await quotaRes.json();
          const qMap: Record<string, any> = {};
          (qData.accounts || []).forEach((a: any) => {
            qMap[a.id] = { dailyLimit: a.dailyLimit, dailySent: a.dailySent, remaining: a.remaining, usagePercent: a.usagePercent, provider: a.provider };
          });
          setAccountQuotas(qMap);
        }

        if (acctRes.ok) {
          const accts = await acctRes.json();
          setEmailAccounts(accts);
          if (accts.length > 0) setEmailAccountId(accts[0].id);
        }
        if (tmplRes.ok) setTemplates(await tmplRes.json());
        if (ctcRes.ok) {
          const data = await ctcRes.json();
          setContacts(data.contacts || data || []);
        }
        if (listRes.ok) {
          const lists = await listRes.json();
          setContactLists(Array.isArray(lists) ? lists : []);
        }
      } catch (e) { console.error('Fetch failed:', e); }
      setLoading(false);
    })();
  }, []);

  // Active step helpers
  const activeStep = steps[activeStepIndex];
  const updateActiveStep = (updates: Partial<SequenceStep>) => {
    setSteps(prev => prev.map((s, i) => i === activeStepIndex ? { ...s, ...updates } : s));
  };

  // Editor commands
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  // Sync editor content
  const handleEditorInput = () => {
    if (editorRef.current) {
      updateActiveStep({ content: editorRef.current.innerHTML });
    }
  };

  // When switching steps, sync editor
  useEffect(() => {
    if (editorRef.current && activeStep) {
      editorRef.current.innerHTML = activeStep.content || '';
    }
    if (activeStep) {
      setHtmlSource(activeStep.content || '');
    }
  }, [activeStepIndex]);

  // Switch between visual and HTML modes
  const toggleEditorMode = () => {
    if (editorMode === 'visual') {
      // Going to HTML mode - capture current visual content
      const currentHtml = editorRef.current?.innerHTML || activeStep?.content || '';
      setHtmlSource(currentHtml);
      setEditorMode('html');
    } else {
      // Going back to visual - apply HTML source
      updateActiveStep({ content: htmlSource });
      if (editorRef.current) {
        editorRef.current.innerHTML = htmlSource;
      }
      setEditorMode('visual');
    }
  };

  // Add follow-up step
  const addFollowUp = () => {
    const newStep: SequenceStep = {
      id: `step-${steps.length + 1}`,
      subject: '', content: '',
      condition: 'if_no_reply', delayValue: 3, delayUnit: 'days',
    };
    setSteps(prev => [...prev, newStep]);
    setActiveStepIndex(steps.length);
  };

  // Remove step
  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
    if (activeStepIndex >= index && activeStepIndex > 0) {
      setActiveStepIndex(activeStepIndex - 1);
    }
  };

  // Insert template
  const insertTemplate = (template: any) => {
    updateActiveStep({ subject: template.subject || '', content: template.content || '' });
    if (editorRef.current) editorRef.current.innerHTML = template.content || '';
    setHtmlSource(template.content || '');
    setShowTemplates(false);
  };

  // Insert variable
  const insertVariable = (varName: string) => {
    if (editorMode === 'html') {
      setHtmlSource(prev => prev + `{{${varName}}}`);
      updateActiveStep({ content: htmlSource + `{{${varName}}}` });
    } else {
      execCmd('insertText', `{{${varName}}}`);
    }
  };

  // Recipient count
  const recipientCount = selectedContacts.length;
  const selectedAccount = emailAccounts.find(a => a.id === emailAccountId);
  const selectedQuota = emailAccountId ? accountQuotas[emailAccountId] : null;

  // AI account recommendation
  const handleAiRecommend = async () => {
    setLoadingAiRec(true);
    setAiRecBanner(null);
    try {
      const res = await fetch('/api/email-accounts/recommend', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientCount: recipientCount || 100,
          campaignType: 'marketing',
          campaignName: campaignName || 'Email Campaign',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.recommendedAccountId) {
          setAiRecBanner({ accountId: data.recommendedAccountId, email: data.recommendedAccountEmail, reason: data.reason, provider: data.provider });
        }
      }
    } catch (e) {}
    setLoadingAiRec(false);
  };

  // Preview email - now previews ALL steps
  const handleShowPreview = async () => {
    setPreviewLoading(true);
    setShowPreview(true);
    setPreviewActiveStep(0);
    setTestResult(null);
    setTestEmailAddress(selectedAccount?.email || '');
    try {
      // Sync current step content if in HTML mode
      const syncedSteps = steps.map((s, i) => ({
        subject: s.subject,
        content: i === activeStepIndex && editorMode === 'html' ? htmlSource : s.content,
        condition: s.condition,
        delayValue: s.delayValue,
        delayUnit: s.delayUnit,
      }));
      const res = await fetch('/api/campaigns/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ steps: syncedSteps }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewData(data);
      }
    } catch (e) {
      console.error('Preview failed:', e);
    }
    setPreviewLoading(false);
  };

  // Send test email
  const handleSendTestEmail = async () => {
    if (!testEmailAddress.trim() || !emailAccountId) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const syncedSteps = steps.map((s, i) => ({
        subject: s.subject,
        content: i === activeStepIndex && editorMode === 'html' ? htmlSource : s.content,
        condition: s.condition,
        delayValue: s.delayValue,
        delayUnit: s.delayUnit,
      }));
      const res = await fetch('/api/campaigns/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountId,
          toEmail: testEmailAddress.trim(),
          steps: syncedSteps,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: `Test email sent to ${testEmailAddress} (${data.stepsIncluded} step${data.stepsIncluded > 1 ? 's' : ''} included)` });
      } else {
        setTestResult({ success: false, message: data.error || 'Failed to send test email' });
      }
    } catch (e) {
      setTestResult({ success: false, message: 'Failed to send test email' });
    }
    setSendingTest(false);
  };

  // Send campaign
  const handleSend = async () => {
    setError('');
    if (!emailAccountId) { setError('Please select a sender account'); return; }
    if (!steps[0].subject) { setError('Please enter a subject line'); return; }
    if (recipientCount === 0) { setError('Please select recipients'); return; }

    // If in HTML mode, sync content first
    if (editorMode === 'html') {
      updateActiveStep({ content: htmlSource });
    }

    setSending(true);
    try {
      const name = campaignName || `Campaign ${new Date().toLocaleDateString()}`;
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name, emailAccountId,
          subject: steps[0].subject,
          content: editorMode === 'html' ? htmlSource : steps[0].content,
          contactIds: selectedContacts,
          totalRecipients: recipientCount,
          status: schedule.enabled ? 'scheduled' : 'draft',
          trackOpens: trackEmails, trackClicks: trackEmails,
          includeUnsubscribe: unsubscribeLink,
        }),
      });
      if (!createRes.ok) throw new Error('Failed to create campaign');
      const campaign = await createRes.json();

      // Create follow-up steps if any
      for (let i = 1; i < steps.length; i++) {
        const step = steps[i];
        await fetch(`/api/followup-sequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            campaignId: campaign.id, name: `Follow-up ${i}`,
            trigger: step.condition, subject: step.subject, content: step.content,
            delayValue: step.delayValue, delayUnit: step.delayUnit, stepOrder: i,
          }),
        });
      }

      if (schedule.enabled && schedule.date) {
        const dt = new Date(schedule.date);
        const [h, m] = schedule.time.split(':').map(Number);
        dt.setHours(h, m);
        await fetch(`/api/campaigns/${campaign.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ scheduledAt: dt.toISOString(), delayBetweenEmails: autopilot.delayBetween * (autopilot.delayUnit === 'minutes' ? 60000 : 1000) }),
        });
        setSendResult({ scheduled: true, campaignId: campaign.id });
      } else {
        await fetch(`/api/campaigns/${campaign.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ delayBetweenEmails: autopilot.delayBetween * (autopilot.delayUnit === 'minutes' ? 60000 : 1000) }),
        });
        setSendResult({ campaignId: campaign.id });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send');
    }
    setSending(false);
  };

  // Focus name input when editing
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Auto-clear error when recipients are selected
  useEffect(() => {
    if (selectedContacts.length > 0 && error === 'Please select recipients') {
      setError('');
    }
  }, [selectedContacts.length]);

  // Google Sheets: validate URL and fetch sheet names
  const validateSheetUrl = useCallback(async (url: string) => {
    if (!url || !url.includes('docs.google.com/spreadsheets')) {
      setSheetValid(null); setAvailableSheets([]); setSheetError(''); return;
    }
    setSheetValidating(true); setSheetValid(null); setSheetError('');
    setAvailableSheets([]); setSheetContacts([]); setSheetPreview(null); setSheetName('');
    try {
      const res = await fetch('/api/sheets/fetch-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok && data.valid) { setSheetValid(true); setAvailableSheets(data.sheets || []); }
      else { setSheetValid(false); setSheetError(data.error || 'Cannot access spreadsheet'); }
    } catch (e) { setSheetValid(false); setSheetError('Failed to validate URL'); }
    setSheetValidating(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { if (sheetUrl) validateSheetUrl(sheetUrl); }, 800);
    return () => clearTimeout(timer);
  }, [sheetUrl, validateSheetUrl]);

  const fetchSheetData = useCallback(async (selectedSheet: string) => {
    if (!sheetUrl || !selectedSheet) return;
    setSheetLoading(true); setSheetContacts([]); setSheetPreview(null); setSheetImportResult(null);
    try {
      const selectedSheetObj = availableSheets.find(s => s.name === selectedSheet);
      const res = await fetch('/api/sheets/fetch-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ url: sheetUrl, sheetName: selectedSheet, gid: selectedSheetObj?.id ?? 0 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSheetPreview({ headers: data.headers || [], values: data.values || [], totalRows: data.totalRows || 0, validContacts: data.validContacts || 0 });
        setSheetContacts(data.contacts || []);
        // Default list name from sheet name
        if (!sheetListName.trim()) setSheetListName(selectedSheet || 'Google Sheets Import');
      } else { setSheetError(data.error || 'Failed to fetch sheet data'); }
    } catch (e) { setSheetError('Failed to load sheet data'); }
    setSheetLoading(false);
  }, [sheetUrl, availableSheets, sheetListName]);

  const importSheetContacts = async () => {
    if (sheetContacts.length === 0) return;
    try {
      setSheetLoading(true); setSheetError(''); setSheetImportResult(null);
      // Build list name from sheet name or default
      const importListName = sheetListName.trim() || sheetName || 'Google Sheets Import';
      const importBody: any = {
        contacts: sheetContacts,
        source: 'google_sheets',
        headers: sheetPreview?.headers || [],
      };
      if (saveAsContactList) {
        if (sheetListMode === 'existing' && sheetExistingListId) {
          importBody.existingListId = sheetExistingListId;
        } else {
          importBody.listName = importListName;
        }
      }
      const importRes = await fetch('/api/contacts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(importBody),
      });
      const result = await importRes.json();
      if (importRes.ok) {
        // Re-fetch all contacts with high limit to find the imported ones
        const ctcRes = await fetch('/api/contacts?limit=10000', { credentials: 'include' });
        if (ctcRes.ok) {
          const data = await ctcRes.json();
          const allContacts = data.contacts || data || [];
          setContacts(allContacts);
          // Match imported contacts by email
          const importedEmails = new Set(sheetContacts.map((c: any) => c.email?.toLowerCase()).filter(Boolean));
          const matchedIds = allContacts
            .filter((c: any) => c.email && importedEmails.has(c.email.toLowerCase()))
            .map((c: any) => c.id);
          setSelectedContacts(matchedIds);
        }
        // Re-fetch contact lists
        const listRes = await fetch('/api/contact-lists', { credentials: 'include' });
        if (listRes.ok) {
          const lists = await listRes.json();
          setContactLists(Array.isArray(lists) ? lists : []);
        }
        setSheetImportResult({ message: result.message || `Imported ${result.imported} contacts`, listName: result.listName || '' });
        setError('');
        // Don't close dialog — let user see the result and close manually
      } else { setSheetError(result.message || 'Failed to import contacts'); }
    } catch (e) { setSheetError('Failed to import contacts'); }
    finally { setSheetLoading(false); }
  };

  // Autopilot summary
  const getAutopilotSummary = () => {
    const activeDays = Object.entries(autopilot.days).filter(([, v]) => v.enabled).length;
    let totalHours = 0;
    Object.values(autopilot.days).forEach(d => {
      if (d.enabled) {
        const [sh, sm] = d.startTime.split(':').map(Number);
        const [eh, em] = d.endTime.split(':').map(Number);
        totalHours += (eh + em / 60) - (sh + sm / 60);
      }
    });
    const avgHoursPerDay = activeDays > 0 ? totalHours / activeDays : 8;
    const emailsPerHour = autopilot.delayUnit === 'minutes' ? 60 / autopilot.delayBetween : 3600 / autopilot.delayBetween;
    const dailyCapacity = Math.min(autopilot.maxPerDay, Math.floor(emailsPerHour * avgHoursPerDay));
    return { activeDays, dailyCapacity };
  };

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
      </div>
    );
  }

  // Success
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
            ? 'Your campaign has been scheduled and will start sending at the specified time.'
            : `Your campaign is now sending to ${recipientCount} contacts.`}
        </p>
        <Button variant="outline" onClick={onSuccess}><ArrowLeft className="h-4 w-4 mr-2" /> Back to Campaigns</Button>
      </div>
    );
  }

  const conditionLabels: Record<string, string> = {
    immediate: 'Will be sent immediately',
    if_no_reply: 'If no reply', if_no_click: 'If no click', if_no_open: 'If no open',
    if_opened: 'If opened', if_clicked: 'If clicked', if_replied: 'If replied',
    no_matter_what: 'No matter what',
  };

  return (
    <div className="flex h-full">
      {/* ==================== MAIN EDITOR AREA ==================== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {isEditingName ? (
              <input
                ref={nameInputRef}
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={e => { if (e.key === 'Enter') setIsEditingName(false); }}
                className="text-xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 outline-none py-0.5 min-w-[200px]"
                placeholder="New campaign"
              />
            ) : (
              <button onClick={() => setIsEditingName(true)} className="flex items-center gap-2 group">
                <h1 className="text-xl font-bold text-gray-900">{campaignName || 'New campaign'}</h1>
                <Pencil className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={handleShowPreview}>
              <Eye className="h-3.5 w-3.5 mr-1.5" /> Show preview
            </Button>
            <Button size="sm" onClick={handleSend} disabled={sending}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm">
              {sending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send emails
            </Button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            <button onClick={() => setError('')} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Email form area */}
        <div className="flex-1 px-6 py-5">
          <div className="max-w-3xl mx-auto">
            {/* From / To / Subject fields */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4">
              {/* From */}
              <div className="border-b border-gray-100">
                <div className="flex items-center px-5 py-3">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0">From</span>
                  <select
                    value={emailAccountId}
                    onChange={e => { setEmailAccountId(e.target.value); setAiRecBanner(null); }}
                    className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-0 outline-none cursor-pointer appearance-none"
                  >
                    {emailAccounts.length === 0 && <option value="">No accounts -- add one in Accounts</option>}
                    {emailAccounts.map(a => {
                      const q = accountQuotas[a.id];
                      return (
                        <option key={a.id} value={a.id}>
                          {a.displayName || a.email} &lt;{a.email}&gt;{q ? ` [${q.remaining}/${q.dailyLimit} left]` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {/* AI Recommend button */}
                  <button
                    onClick={handleAiRecommend}
                    disabled={loadingAiRec || emailAccounts.length === 0}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md border border-purple-200 mr-2 transition-colors disabled:opacity-50"
                    title="AI Recommend best account"
                  >
                    {loadingAiRec ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                    AI
                  </button>
                  {/* Three-dot menu */}
                <div className="relative" ref={moreMenuRef}>
                  <button onClick={() => setShowMoreMenu(!showMoreMenu)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-52 z-50">
                      {[
                        { label: 'Insert a template', action: () => { setShowTemplates(true); setShowMoreMenu(false); } },
                        { label: 'Cc', action: () => { setShowCc(true); setShowMoreMenu(false); } },
                        { label: 'Bcc', action: () => { setShowBcc(true); setShowMoreMenu(false); } },
                        { label: 'Reply to', action: () => { setShowReplyTo(true); setShowMoreMenu(false); } },
                        { label: 'Send a test email', action: () => {
                          const testEmail = prompt('Enter test email address:', selectedAccount?.email || '');
                          if (testEmail) { alert(`Test email would be sent to ${testEmail}`); }
                          setShowMoreMenu(false);
                        } },
                        { label: 'Select recipients', action: () => { setShowRecipients(true); setShowMoreMenu(false); } },
                      ].map(item => (
                        <button key={item.label} onClick={item.action}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          {item.label}
                        </button>
                      ))}
                      <div className="border-t border-gray-100 my-1" />
                      <button onClick={addFollowUp}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                        Send another email
                      </button>
                      {activeStepIndex > 0 && (
                        <button onClick={() => { removeStep(activeStepIndex); setShowMoreMenu(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                          Remove step
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

                {/* Quota indicator bar for selected account */}
                {selectedQuota && (
                  <div className="px-5 py-2 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 flex-shrink-0">Quota:</span>
                      <div className="flex-1 max-w-[200px]">
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${
                              selectedQuota.usagePercent >= 90 ? 'bg-red-500' : 
                              selectedQuota.usagePercent >= 70 ? 'bg-amber-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.max(selectedQuota.usagePercent, 2)}%` }}
                          />
                        </div>
                      </div>
                      <span className={`text-xs font-medium ${
                        selectedQuota.usagePercent >= 90 ? 'text-red-600' : 
                        selectedQuota.usagePercent >= 70 ? 'text-amber-600' : 'text-green-600'
                      }`}>
                        {selectedQuota.remaining.toLocaleString()} of {selectedQuota.dailyLimit.toLocaleString()} remaining
                      </span>
                      {selectedQuota.usagePercent >= 80 && (
                        <span className="text-[10px] text-red-500 font-medium flex items-center gap-0.5">
                          <AlertCircle className="h-3 w-3" /> Near limit
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* AI Recommendation banner */}
                {aiRecBanner && (
                  <div className="px-5 py-2 border-b border-purple-100 bg-purple-50/70">
                    <div className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5 text-purple-600 flex-shrink-0" />
                      <span className="text-xs text-purple-700 flex-1">{aiRecBanner.reason}</span>
                      {aiRecBanner.accountId !== emailAccountId && (
                        <button 
                          onClick={() => { setEmailAccountId(aiRecBanner.accountId); setAiRecBanner(null); }}
                          className="text-xs font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 px-2 py-0.5 rounded transition-colors"
                        >
                          Switch to {aiRecBanner.email}
                        </button>
                      )}
                      <button onClick={() => setAiRecBanner(null)} className="text-purple-400 hover:text-purple-600">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Cc row */}
              {showCc && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0">Cc</span>
                  <input value={ccValue} onChange={e => setCcValue(e.target.value)}
                    placeholder="cc@example.com" className="flex-1 text-sm bg-transparent border-0 outline-none" />
                  <button onClick={() => { setShowCc(false); setCcValue(''); }} className="text-gray-300 hover:text-gray-500"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {showBcc && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0">Bcc</span>
                  <input value={bccValue} onChange={e => setBccValue(e.target.value)}
                    placeholder="bcc@example.com" className="flex-1 text-sm bg-transparent border-0 outline-none" />
                  <button onClick={() => { setShowBcc(false); setBccValue(''); }} className="text-gray-300 hover:text-gray-500"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {showReplyTo && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0">Reply to</span>
                  <input value={replyToValue} onChange={e => setReplyToValue(e.target.value)}
                    placeholder="reply@example.com" className="flex-1 text-sm bg-transparent border-0 outline-none" />
                  <button onClick={() => { setShowReplyTo(false); setReplyToValue(''); }} className="text-gray-300 hover:text-gray-500"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}

              {/* To */}
              <div className="flex items-center px-5 py-3 border-b border-gray-100">
                <span className="text-sm text-gray-400 w-16 flex-shrink-0">To</span>
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  {recipientCount > 0 ? (
                    <>
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-semibold">
                        {recipientCount} recipient{recipientCount !== 1 ? 's' : ''}
                      </Badge>
                      <button onClick={() => setShowRecipients(true)}
                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium">
                        Edit
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setShowRecipients(true)}
                      className="text-sm font-medium text-blue-600 border border-blue-300 rounded-lg px-3 py-1 hover:bg-blue-50 transition-colors">
                      Select recipients
                    </button>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div className="flex items-center px-5 py-3">
                <span className="text-sm text-gray-400 w-16 flex-shrink-0">Subject</span>
                <input
                  value={activeStep?.subject || ''}
                  onChange={e => updateActiveStep({ subject: e.target.value })}
                  placeholder="Enter your email subject"
                  className="flex-1 text-sm bg-transparent border-0 outline-none text-gray-900 placeholder:text-gray-300"
                />
              </div>
            </div>

            {/* Follow-up condition bar (for steps > 0) - Mailmeteor style sentence builder */}
            {activeStepIndex > 0 && activeStep && (
              <div className="bg-white rounded-xl border border-blue-200 shadow-sm mb-4 px-5 py-3.5 flex items-center gap-2.5 flex-wrap">
                <select value={activeStep.condition}
                  onChange={e => updateActiveStep({ condition: e.target.value as any })}
                  className="text-sm font-medium border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-800 focus:border-blue-400 outline-none cursor-pointer">
                  <option value="if_no_reply">if no reply</option>
                  <option value="if_no_click">if no click</option>
                  <option value="if_no_open">if no open</option>
                  <option value="if_opened">if opened</option>
                  <option value="if_clicked">if clicked</option>
                  <option value="if_replied">if replied</option>
                  <option value="no_matter_what">no matter what</option>
                </select>
                <span className="text-sm text-gray-500 font-medium">after</span>
                <input type="number" min={1} max={365} value={activeStep.delayValue}
                  onChange={e => updateActiveStep({ delayValue: parseInt(e.target.value) || 1 })}
                  className="w-16 text-sm text-center font-medium border border-gray-200 rounded-lg px-2 py-1.5 focus:border-blue-400 outline-none" />
                <select value={activeStep.delayUnit}
                  onChange={e => updateActiveStep({ delayUnit: e.target.value as any })}
                  className="text-sm font-medium border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-800 focus:border-blue-400 outline-none cursor-pointer">
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                </select>
                <div className="flex items-center gap-1.5 text-sm text-blue-600 font-medium">
                  <Play className="h-3 w-3 fill-blue-600" />
                  <span>send this email</span>
                </div>
              </div>
            )}

            {/* Rich Text / HTML Editor */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Developer mode toggle + Toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50/80">
                {editorMode === 'visual' ? (
                  <div className="flex items-center gap-0.5 flex-wrap flex-1">
                    <ToolbarBtn icon={<Bold className="h-4 w-4" />} onClick={() => execCmd('bold')} title="Bold" />
                    <ToolbarBtn icon={<Italic className="h-4 w-4" />} onClick={() => execCmd('italic')} title="Italic" />
                    <ToolbarBtn icon={<Underline className="h-4 w-4" />} onClick={() => execCmd('underline')} title="Underline" />
                    {/* Font color */}
                    <div className="relative group">
                      <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 flex items-center gap-0" title="Font color">
                        <span className="font-bold text-sm leading-none">A</span>
                        <span className="block h-0.5 w-3 bg-red-500 -mt-0.5 ml-px"></span>
                        <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                      </button>
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 hidden group-hover:grid grid-cols-6 gap-1 z-50 w-36">
                        {['#000000','#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#718096','#e2e8f0'].map(color => (
                          <button key={color} onClick={() => execCmd('foreColor', color)}
                            className="w-5 h-5 rounded border border-gray-200 hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    </div>
                    <ToolbarSep />
                    <ToolbarBtn icon={<Strikethrough className="h-4 w-4" />} onClick={() => execCmd('strikeThrough')} title="Strikethrough" />
                    <ToolbarBtn icon={<Link className="h-4 w-4" />} onClick={() => {
                      const url = prompt('Enter URL:');
                      if (url) execCmd('createLink', url);
                    }} title="Link" />
                    <ToolbarBtn icon={<Image className="h-4 w-4" />} onClick={() => {
                      const url = prompt('Enter image URL:');
                      if (url) execCmd('insertImage', url);
                    }} title="Image" />
                    {/* Merge tags */}
                    <div className="relative group">
                      <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 flex items-center gap-0.5 text-sm font-mono" title="Variables">
                        {'{ }'} <ChevronDown className="h-3 w-3" />
                      </button>
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44 hidden group-hover:block z-50">
                        {['firstName', 'lastName', 'email', 'company', 'jobTitle', 'fullName'].map(v => (
                          <button key={v} onClick={() => insertVariable(v)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-gray-700 font-mono">
                            {`{{${v}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <ToolbarSep />
                    {/* Font family */}
                    <select className="text-xs border-0 bg-transparent text-gray-500 cursor-pointer outline-none px-1"
                      onChange={e => execCmd('fontName', e.target.value)}>
                      <option>Sans Serif</option><option value="serif">Serif</option>
                      <option value="monospace">Monospace</option><option value="Georgia">Georgia</option>
                      <option value="Arial">Arial</option>
                    </select>
                    <ToolbarSep />
                    <ToolbarBtn icon={<ListOrdered className="h-4 w-4" />} onClick={() => execCmd('insertOrderedList')} title="Numbered list" />
                    <ToolbarBtn icon={<List className="h-4 w-4" />} onClick={() => execCmd('insertUnorderedList')} title="Bullet list" />
                    <ToolbarBtn icon={<AlignLeft className="h-4 w-4" />} onClick={() => execCmd('justifyLeft')} title="Align left" />
                    <ToolbarBtn icon={<AlignCenter className="h-4 w-4" />} onClick={() => execCmd('justifyCenter')} title="Center" />
                    <ToolbarBtn icon={<AlignRight className="h-4 w-4" />} onClick={() => execCmd('justifyRight')} title="Align right" />
                    <ToolbarSep />
                    <ToolbarBtn icon={<Type className="h-3.5 w-3.5" />} onClick={() => execCmd('removeFormat')} title="Clear formatting" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-gray-500 font-medium">HTML Source Editor</span>
                    {/* Variables in HTML mode */}
                    <div className="relative group">
                      <button className="p-1 rounded hover:bg-gray-200 text-gray-500 flex items-center gap-0.5 text-xs font-mono" title="Insert Variable">
                        {'{{ }}'} <ChevronDown className="h-3 w-3" />
                      </button>
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44 hidden group-hover:block z-50">
                        {['firstName', 'lastName', 'email', 'company', 'jobTitle', 'fullName'].map(v => (
                          <button key={v} onClick={() => insertVariable(v)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-gray-700 font-mono">
                            {`{{${v}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Developer mode toggle button */}
                <button
                  onClick={toggleEditorMode}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    editorMode === 'html'
                      ? 'bg-gray-800 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Code className="h-3.5 w-3.5" />
                  Developer mode {'</>'}
                  {editorMode === 'html' && (
                    <button onClick={(e) => { e.stopPropagation(); toggleEditorMode(); }} className="ml-1 p-0.5 rounded hover:bg-gray-700">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </button>
              </div>

              {/* Content area - Visual or HTML */}
              {editorMode === 'visual' ? (
                <div
                  ref={editorRef}
                  contentEditable
                  onInput={handleEditorInput}
                  className="min-h-[300px] p-5 text-sm text-gray-900 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300"
                  data-placeholder="Compose your email..."
                  suppressContentEditableWarning
                />
              ) : (
                <textarea
                  value={htmlSource}
                  onChange={e => {
                    setHtmlSource(e.target.value);
                    updateActiveStep({ content: e.target.value });
                  }}
                  className="w-full min-h-[300px] p-5 text-sm font-mono bg-gray-900 text-gray-100 outline-none resize-y border-0"
                  placeholder="<p>Enter your HTML email code here...</p>"
                  spellCheck={false}
                />
              )}
            </div>

            {/* Add follow-up button */}
            <div className="flex justify-center mt-6 mb-4">
              <button onClick={addFollowUp}
                className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors shadow-sm flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add a follow-up email
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== RIGHT PANEL ==================== */}
      <div className="w-64 border-l border-gray-200 bg-white flex-shrink-0 overflow-y-auto relative">
        {/* AI Sparkle button */}
        <div className="absolute top-3 right-3">
          <button onClick={() => setShowAiPanel(!showAiPanel)} className={`p-1.5 rounded-lg transition-colors ${showAiPanel ? 'bg-yellow-100 text-yellow-600' : 'hover:bg-yellow-50 text-yellow-500 hover:text-yellow-600'}`} title="AI Assistant">
            <Sparkles className="h-5 w-5" />
          </button>
        </div>

        {/* Settings Section */}
        <div className="p-5 pt-4">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Settings</h3>

          {/* Schedule send */}
          <button onClick={() => setShowSchedule(true)}
            className="w-full flex items-center justify-between py-2.5 text-sm text-gray-700 hover:text-blue-600 transition-colors group">
            <span>Schedule send</span>
            <Calendar className="h-4 w-4 text-gray-300 group-hover:text-blue-500" />
          </button>

          {schedule.enabled && schedule.date && (
            <div className="ml-0 mb-1 text-[11px] text-blue-600 bg-blue-50 rounded px-2 py-1">
              {schedule.date.toLocaleDateString()} at {schedule.time}
            </div>
          )}

          {/* Autopilot */}
          <button onClick={() => setShowAutopilot(true)}
            className="w-full flex items-center justify-between py-2.5 text-sm text-gray-700 hover:text-blue-600 transition-colors group">
            <span className="flex items-center gap-1.5">Autopilot <Info className="h-3 w-3 text-gray-300" /></span>
            <Settings2 className="h-4 w-4 text-gray-300 group-hover:text-blue-500" />
          </button>

          {autopilot.enabled && (
            <div className="ml-0 mb-1 text-[11px] text-purple-600 bg-purple-50 rounded px-2 py-1">
              {autopilot.maxPerDay}/day, {autopilot.delayBetween} {autopilot.delayUnit} delay
            </div>
          )}

          {/* Track emails */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-gray-700 flex items-center gap-1.5">Track emails <Info className="h-3 w-3 text-gray-300" /></span>
            <Switch checked={trackEmails} onCheckedChange={setTrackEmails} />
          </div>

          {/* Unsubscribe link */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-gray-700 flex items-center gap-1.5">Unsubscribe link <Info className="h-3 w-3 text-gray-300" /></span>
            <Switch checked={unsubscribeLink} onCheckedChange={setUnsubscribeLink} />
          </div>
        </div>

        {/* AI Generation Panel */}
        {showAiPanel && (
          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                <Brain className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">AI Email Writer</h3>
                <p className="text-[10px] text-gray-400">Powered by Azure OpenAI</p>
              </div>
              <button onClick={() => setShowAiPanel(false)} className="ml-auto p-1 hover:bg-gray-100 rounded-lg">
                <X className="h-3.5 w-3.5 text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-3">
              {/* Type selector as pills */}
              <div>
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5 block">What to generate</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: 'campaign', label: 'Email Body', icon: '✉️' },
                    { value: 'subject', label: 'Subject Lines', icon: '💡' },
                    { value: 'personalize', label: 'Personalize', icon: '🎯' },
                    { value: 'template', label: 'Full Template', icon: '📝' },
                  ].map(t => (
                    <button key={t.value}
                      onClick={() => setAiType(t.value as any)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                        aiType === t.value
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt area */}
              <div>
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
                  {aiType === 'subject' ? 'Describe your email topic' : 'Describe what the email should say'}
                </label>
                <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  placeholder={aiType === 'subject' ? 'e.g., SaaS product launch for HR managers at mid-size companies...' : 'e.g., Cold outreach to CTOs about our AI analytics platform, highlight ROI and offer free trial...'}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2.5 resize-none h-24 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all" />
              </div>

              {/* Generate button */}
              <button
                onClick={async () => {
                  if (!aiPrompt.trim()) return;
                  setAiGenerating(true); setAiError(''); setAiResult(null);
                  try {
                    const res = await fetch('/api/llm/generate', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                      body: JSON.stringify({ prompt: aiPrompt, type: aiType, context: { subject: activeStep?.subject, recipients: selectedContacts.length } }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setAiResult({ content: data.content, model: data.model, provider: data.provider });
                    } else { setAiError('Generation failed. Configure Azure OpenAI in Advanced Settings.'); }
                  } catch { setAiError('Could not reach server'); }
                  finally { setAiGenerating(false); }
                }}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
              >
                {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {aiGenerating ? 'Writing with AI...' : 'Generate with AI'}
              </button>

              {aiError && <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 border border-red-100">{aiError}</div>}

              {aiResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-gray-500">
                      {aiResult.provider === 'azure-openai' ? '✨ Azure OpenAI' : '🎭 Demo Mode'}
                    </span>
                    <button onClick={() => navigator.clipboard.writeText(aiResult.content)} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                      Copy
                    </button>
                  </div>
                  <div className="text-xs text-gray-700 bg-white rounded-lg p-3 max-h-36 overflow-y-auto whitespace-pre-wrap border border-gray-200 shadow-inner">
                    {aiResult.content}
                  </div>
                  <div className="flex gap-1.5">
                    {aiType === 'subject' ? (
                      <button onClick={() => {
                        const lines = aiResult.content.split('\n').filter(l => l.trim());
                        const firstLine = lines[0]?.replace(/^\d+[\.\)]\s*/, '').replace(/^["']|["']$/g, '').trim();
                        if (firstLine) updateActiveStep({ subject: firstLine });
                      }} className="flex-1 text-[11px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium border border-purple-200 transition-colors">
                        Use first suggestion
                      </button>
                    ) : (
                      <>
                        <button onClick={() => {
                          updateActiveStep({ content: aiResult.content });
                          if (editorRef.current) editorRef.current.innerHTML = aiResult.content;
                          setHtmlSource(aiResult.content);
                        }} className="flex-1 text-[11px] px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium border border-purple-200 transition-colors">
                          Replace content
                        </button>
                        <button onClick={() => {
                          const curr = activeStep?.content || '';
                          const updated = curr + '\n' + aiResult.content;
                          updateActiveStep({ content: updated });
                          if (editorRef.current) editorRef.current.innerHTML = updated;
                          setHtmlSource(updated);
                        }} className="flex-1 text-[11px] px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium border border-gray-200 transition-colors">
                          Append
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Quick prompt suggestions */}
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Quick prompts</p>
                {[
                  { text: 'Cold outreach for SaaS product to CTOs', emoji: '🚀' },
                  { text: 'Follow-up after demo call, highlight key features', emoji: '📞' },
                  { text: 'Re-engagement email for inactive users with special offer', emoji: '🔄' },
                  { text: 'Partnership proposal to complementary businesses', emoji: '🤝' },
                  { text: 'Event invitation with early bird registration', emoji: '📅' },
                  { text: 'Customer feedback request after purchase', emoji: '⭐' },
                ].map(p => (
                  <button key={p.text} onClick={() => setAiPrompt(p.text)}
                    className="w-full text-left text-[11px] text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-1.5">
                    <span>{p.emoji}</span> {p.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Sequence Section */}
        {steps.length > 0 && (
          <div className="border-t border-gray-100 p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Sequence</h3>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <button key={step.id}
                  onClick={() => setActiveStepIndex(i)}
                  className={`w-full text-left p-3 rounded-xl border transition-all group/step ${
                    activeStepIndex === i
                      ? 'border-blue-300 bg-blue-50/50 shadow-sm'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-900">
                      {i + 1}. {step.subject ? step.subject.slice(0, 20) + (step.subject.length > 20 ? '...' : '') : '(no content)'}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {i > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                          className="p-0.5 rounded hover:bg-red-100 text-gray-300 hover:text-red-500 opacity-0 group-hover/step:opacity-100 transition-opacity">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                    {i === 0 ? (
                      'Will be sent immediately'
                    ) : (
                      <>
                        <Zap className="h-3 w-3 text-blue-500" />
                        <span>{conditionLabels[step.condition]}</span>
                        <Clock className="h-3 w-3 ml-0.5 text-gray-400" />
                        <span>{step.delayValue} {step.delayUnit}</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ==================== EMAIL PREVIEW DIALOG (Full Sequence) ==================== */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
          <DialogTitle className="sr-only">Email Preview</DialogTitle>
          <DialogDescription className="sr-only">Preview your complete email sequence with all follow-ups</DialogDescription>
          <div className="flex h-[80vh]">
            {/* Left sidebar - Step navigation */}
            <div className="w-64 border-r border-gray-200 bg-gray-50/80 flex flex-col flex-shrink-0">
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="bg-blue-100 p-1.5 rounded-lg">
                    <Monitor className="h-4 w-4 text-blue-600" />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">Email Preview</h3>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Preview your complete email sequence</p>
              </div>

              {/* Steps list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {previewData?.previews?.map((preview, i) => (
                  <button key={i}
                    onClick={() => setPreviewActiveStep(i)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      previewActiveStep === i
                        ? 'border-blue-300 bg-white shadow-sm'
                        : 'border-transparent hover:border-gray-200 hover:bg-white'
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        i === 0 ? 'bg-blue-600' : 'bg-indigo-500'
                      }`}>
                        {i + 1}
                      </div>
                      <span className="text-xs font-semibold text-gray-900 truncate flex-1">
                        {preview.subject || '(No subject)'}
                      </span>
                    </div>
                    <div className="ml-8 text-[10px] text-gray-400 flex items-center gap-1">
                      {i === 0 ? (
                        <span className="flex items-center gap-1">
                          <Send className="h-2.5 w-2.5" /> Sent immediately
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {conditionLabels[preview.condition] || preview.condition} after {preview.delayValue} {preview.delayUnit}
                        </span>
                      )}
                    </div>
                  </button>
                )) || (
                  <div className="text-center py-6 text-xs text-gray-400">Loading...</div>
                )}
              </div>

              {/* Send test email section */}
              <div className="border-t border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Mail className="h-3.5 w-3.5 text-gray-500" />
                  <span className="text-xs font-bold text-gray-700">Send Test Email</span>
                </div>
                <input
                  type="email"
                  value={testEmailAddress}
                  onChange={e => { setTestEmailAddress(e.target.value); setTestResult(null); }}
                  placeholder="Enter email address"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2 outline-none focus:border-blue-400 bg-white"
                />
                <button
                  onClick={handleSendTestEmail}
                  disabled={sendingTest || !testEmailAddress.trim() || !emailAccountId}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {sendingTest ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="h-3 w-3" /> Send test ({previewData?.previews?.length || 1} step{(previewData?.previews?.length || 1) > 1 ? 's' : ''})</>
                  )}
                </button>
                {testResult && (
                  <div className={`mt-2 text-[11px] p-2 rounded-lg flex items-start gap-1.5 ${
                    testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {testResult.success ? <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                    <span>{testResult.message}</span>
                  </div>
                )}
                {!emailAccountId && (
                  <p className="mt-1.5 text-[10px] text-amber-600">Select a sender account first</p>
                )}
              </div>
            </div>

            {/* Right content - Email preview */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {previewLoading ? (
                <div className="flex items-center justify-center flex-1">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
                    <span className="text-sm text-gray-400">Loading preview...</span>
                  </div>
                </div>
              ) : previewData && previewData.previews && previewData.previews[previewActiveStep] ? (
                <>
                  {/* Step info bar */}
                  <div className="px-5 py-3 border-b border-gray-100 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        previewActiveStep === 0 ? 'bg-blue-600' : 'bg-indigo-500'
                      }`}>
                        {previewActiveStep + 1}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {previewActiveStep === 0 ? 'Initial Email' : `Follow-up ${previewActiveStep}`}
                        </div>
                        <div className="text-[11px] text-gray-400 flex items-center gap-1">
                          {previewActiveStep === 0 ? (
                            <><Send className="h-2.5 w-2.5" /> Will be sent immediately</>
                          ) : (
                            <><Clock className="h-2.5 w-2.5" /> {conditionLabels[previewData.previews[previewActiveStep].condition] || previewData.previews[previewActiveStep].condition} after {previewData.previews[previewActiveStep].delayValue} {previewData.previews[previewActiveStep].delayUnit}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={previewActiveStep === 0}
                        onClick={() => setPreviewActiveStep(prev => Math.max(0, prev - 1))}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-xs text-gray-400 font-medium min-w-[60px] text-center">
                        {previewActiveStep + 1} of {previewData.previews.length}
                      </span>
                      <button
                        disabled={previewActiveStep >= previewData.previews.length - 1}
                        onClick={() => setPreviewActiveStep(prev => Math.min(previewData.previews.length - 1, prev + 1))}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Email content area */}
                  <div className="flex-1 overflow-y-auto p-5">
                    {/* Email envelope header */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-14">From:</span>
                        <span className="text-sm text-gray-700 font-medium">
                          {selectedAccount?.displayName || selectedAccount?.email || 'Sender'} &lt;{selectedAccount?.email || 'sender@example.com'}&gt;
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-14">To:</span>
                        <span className="text-sm text-gray-700">{previewData.contact?.email || 'john@example.com'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-14">Subject:</span>
                        <span className="text-sm text-gray-900 font-semibold">{previewData.previews[previewActiveStep].subject || '(No subject)'}</span>
                      </div>
                    </div>

                    {/* Email body */}
                    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                      <div className="p-6">
                        <div
                          dangerouslySetInnerHTML={{ __html: previewData.previews[previewActiveStep].content }}
                          className="prose prose-sm max-w-none text-gray-800 [&_a]:text-blue-600 [&_img]:max-w-full"
                        />
                        {!previewData.previews[previewActiveStep].content && (
                          <p className="text-gray-400 italic text-sm">No content in this step</p>
                        )}
                      </div>
                    </div>

                    {/* Preview info */}
                    <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mt-4">
                      <Info className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>Sample contact: {previewData.contact?.firstName} {previewData.contact?.lastName} ({previewData.contact?.email})</span>
                    </div>
                  </div>

                  {/* Bottom bar with sequence visualization */}
                  {previewData.previews.length > 1 && (
                    <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3">
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {previewData.previews.map((preview, i) => (
                          <React.Fragment key={i}>
                            <button
                              onClick={() => setPreviewActiveStep(i)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                                previewActiveStep === i
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                              }`}>
                              <span className="font-bold">{i + 1}</span>
                              <span className="max-w-[80px] truncate">{preview.subject || 'No subject'}</span>
                            </button>
                            {i < previewData.previews.length - 1 && (
                              <div className="flex items-center gap-1 text-gray-300 flex-shrink-0">
                                <div className="w-4 h-px bg-gray-300" />
                                <Clock className="h-2.5 w-2.5" />
                                <span className="text-[9px]">{previewData.previews[i + 1].delayValue}{previewData.previews[i + 1].delayUnit[0]}</span>
                                <div className="w-4 h-px bg-gray-300" />
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center flex-1 text-gray-400">No preview data available</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== OTHER DIALOGS ==================== */}

      {/* SELECT RECIPIENTS DIALOG */}
      <Dialog open={showRecipients} onOpenChange={setShowRecipients}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <div className="flex min-h-[420px]">
            <div className="w-48 border-r border-gray-100 py-4 flex-shrink-0">
              <h3 className="px-4 text-base font-bold text-gray-900 mb-3">Select recipients</h3>
              {([
                { key: 'sheets' as const, label: 'Google Sheets', icon: <Table className="h-4 w-4" /> },
                { key: 'csv' as const, label: 'Import a CSV', icon: <Upload className="h-4 w-4" /> },
                { key: 'contacts' as const, label: 'Contact list', icon: <Users className="h-4 w-4" /> },
                { key: 'paste' as const, label: 'Copy / paste', icon: <Copy className="h-4 w-4" /> },
              ]).map(tab => (
                <button key={tab.key} onClick={() => setRecipientTab(tab.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                    recipientTab === tab.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 p-6 flex flex-col">
              {recipientTab === 'sheets' && (
                <div className="space-y-4 flex-1 overflow-auto">
                  {/* Success banner after import */}
                  {sheetImportResult && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-green-800 flex-1">
                        <p className="font-medium">{sheetImportResult.message}</p>
                        {sheetImportResult.listName && <p className="text-green-600 text-xs mt-0.5">Saved to list: "{sheetImportResult.listName}"</p>}
                        <p className="text-green-600 text-xs mt-1"><strong>{selectedContacts.length}</strong> contacts selected as recipients</p>
                      </div>
                      <button onClick={() => { setShowRecipients(false); }} className="text-green-600 hover:text-green-800 text-xs font-medium underline flex-shrink-0">Done</button>
                    </div>
                  )}

                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Spreadsheet</Label>
                    <div className="relative">
                      <Input placeholder="Copy/paste spreadsheet URL" value={sheetUrl}
                        onChange={e => { setSheetUrl(e.target.value); setSheetError(''); setSheetValid(null); setAvailableSheets([]); setSheetContacts([]); setSheetPreview(null); setSheetName(''); setSheetImportResult(null); }}
                        className={`pr-10 ${sheetValid === true ? 'border-green-400' : sheetValid === false ? 'border-red-400' : ''}`} />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {sheetValidating && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                        {sheetValid === true && <CheckCircle className="h-4 w-4 text-green-500" />}
                        {sheetValid === false && <AlertCircle className="h-4 w-4 text-red-400" />}
                      </div>
                    </div>
                    {sheetValid === true && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Spreadsheet connected</p>}
                    {sheetError && <p className="text-xs text-red-500 mt-1">{sheetError}</p>}
                    {!sheetUrl && <p className="text-xs text-gray-400 mt-1.5">Paste the URL of a Google Sheets spreadsheet.</p>}
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Sheet</Label>
                    <select className={`w-full h-10 border rounded-md px-3 text-sm ${availableSheets.length === 0 ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed' : 'border-gray-200 bg-white'}`}
                      value={sheetName} onChange={e => { setSheetName(e.target.value); setSheetError(''); setSheetImportResult(null); if (e.target.value) fetchSheetData(e.target.value); }}
                      disabled={availableSheets.length === 0}>
                      <option value="">Select a sheet</option>
                      {availableSheets.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  {sheetLoading && <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 text-blue-500 animate-spin mr-2" /><span className="text-sm text-gray-500">Loading contacts...</span></div>}
                  {sheetPreview && !sheetLoading && (
                    <div className="space-y-3">
                      <Badge className="bg-green-50 text-green-700 border-green-200">{sheetPreview.validContacts} contacts found</Badge>
                      {sheetContacts.length > 0 && (
                        <>
                          <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="max-h-32 overflow-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 sticky top-0"><tr>
                                  <th className="px-3 py-2 text-left text-gray-500 font-semibold">Email</th>
                                  <th className="px-3 py-2 text-left text-gray-500 font-semibold">Name</th>
                                </tr></thead>
                                <tbody className="divide-y divide-gray-100">
                                  {sheetContacts.slice(0, 6).map((c: any, i: number) => (
                                    <tr key={i} className="hover:bg-blue-50/30">
                                      <td className="px-3 py-1.5 text-gray-700 font-medium">{c.email}</td>
                                      <td className="px-3 py-1.5 text-gray-600">{c.firstName || ''} {c.lastName || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {sheetContacts.length > 6 && <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-400 text-center border-t">... and {sheetContacts.length - 6} more</div>}
                          </div>

                          {/* Save as Contact List section */}
                          <div className="border border-blue-100 bg-blue-50/40 rounded-lg p-3 space-y-2.5">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id="saveAsList" checked={saveAsContactList} onChange={e => setSaveAsContactList(e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5" />
                              <label htmlFor="saveAsList" className="text-xs font-medium text-gray-700">Save as contact list</label>
                            </div>
                            {saveAsContactList && (
                              <div className="space-y-2 pl-5">
                                <div className="flex gap-3">
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input type="radio" name="listMode" checked={sheetListMode === 'new'} onChange={() => { setSheetListMode('new'); setSheetExistingListId(''); }}
                                      className="text-blue-600 focus:ring-blue-500 h-3 w-3" />
                                    <span className="text-xs text-gray-600">Create new list</span>
                                  </label>
                                  {contactLists.length > 0 && (
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input type="radio" name="listMode" checked={sheetListMode === 'existing'} onChange={() => setSheetListMode('existing')}
                                        className="text-blue-600 focus:ring-blue-500 h-3 w-3" />
                                      <span className="text-xs text-gray-600">Add to existing list</span>
                                    </label>
                                  )}
                                </div>
                                {sheetListMode === 'new' && (
                                  <Input placeholder="List name (e.g. Q1 Leads)" value={sheetListName}
                                    onChange={e => setSheetListName(e.target.value)}
                                    className="h-8 text-xs" />
                                )}
                                {sheetListMode === 'existing' && contactLists.length > 0 && (
                                  <select className="w-full h-8 border border-gray-200 rounded-md px-2 text-xs bg-white"
                                    value={sheetExistingListId} onChange={e => setSheetExistingListId(e.target.value)}>
                                    <option value="">Select a list</option>
                                    {contactLists.map((l: any) => (
                                      <option key={l.id} value={l.id}>{l.name} ({l.contactCount || 0} contacts)</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {recipientTab === 'csv' && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="border-2 border-dashed border-blue-200 rounded-2xl p-10 text-center w-full bg-blue-50/30">
                    <Upload className="h-10 w-10 text-blue-400 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 mb-4">Drag a CSV file here or click the button below</p>
                    <Button className="bg-blue-600 hover:bg-blue-700"><Upload className="h-4 w-4 mr-2" /> Import a CSV</Button>
                  </div>
                </div>
              )}
              {recipientTab === 'contacts' && (
                <div className="space-y-4 flex-1">
                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Select a list</Label>
                    <select className="w-full h-10 border border-gray-200 rounded-md px-3 text-sm"
                      value={contactListFilter} onChange={e => {
                        setContactListFilter(e.target.value);
                        if (e.target.value === 'all') {
                          const validContacts = contacts.filter((c: any) => c.status !== 'unsubscribed');
                          setSelectedContacts(validContacts.map((c: any) => c.id));
                        } else if (e.target.value && e.target.value !== '') {
                          // Filter contacts by listId
                          const listContacts = contacts.filter((c: any) => c.listId === e.target.value && c.status !== 'unsubscribed');
                          setSelectedContacts(listContacts.map((c: any) => c.id));
                        } else { setSelectedContacts([]); }
                      }}>
                      <option value="">Select a list</option>
                      <option value="all">All contacts ({contacts.length})</option>
                      {contactLists.map((l: any) => (
                        <option key={l.id} value={l.id}>{l.name} ({l.contactCount || 0})</option>
                      ))}
                    </select>
                  </div>
                  {selectedContacts.length > 0 && (
                    <>
                      <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 flex-shrink-0" />
                        <span><strong>{selectedContacts.length}</strong> contact{selectedContacts.length !== 1 ? 's' : ''} selected</span>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {contacts.filter((c: any) => selectedContacts.includes(c.id)).slice(0, 10).map((c: any) => (
                          <div key={c.id} className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-100 rounded-lg">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
                              {(c.firstName?.[0] || c.email?.[0] || '?').toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
                                {c.firstName || c.lastName ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : c.email}
                                {c.emailRatingGrade && (
                                  <span className={`inline-flex items-center text-[9px] font-bold px-1 py-0 rounded border ${
                                    ['A+','A','B+'].includes(c.emailRatingGrade) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    ['B','C+','C'].includes(c.emailRatingGrade) ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                    'bg-gray-100 text-gray-500 border-gray-200'
                                  }`}>
                                    <BarChart3 className="h-2 w-2 mr-0.5" />{c.emailRatingGrade}
                                  </span>
                                )}
                              </div>
                              {(c.firstName || c.lastName) && <div className="text-xs text-gray-400 truncate">{c.email}</div>}
                            </div>
                            <button onClick={() => setSelectedContacts(prev => prev.filter(id => id !== c.id))}
                              className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 flex-shrink-0">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {recipientTab === 'paste' && (
                <div className="flex-1 flex flex-col">
                  <Textarea placeholder="Enter one email address per line" value={pasteEmails} onChange={e => setPasteEmails(e.target.value)} className="flex-1 min-h-[280px] resize-none" />
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
                <Button variant="outline" onClick={() => setShowRecipients(false)}>
                  {sheetImportResult || selectedContacts.length > 0 ? 'Done' : 'Close'}
                </Button>
                {!sheetImportResult && (
                <Button className="bg-blue-600 hover:bg-blue-700"
                  disabled={
                    sheetLoading ||
                    (recipientTab === 'sheets' && sheetContacts.length === 0) ||
                    (recipientTab === 'contacts' && selectedContacts.length === 0) ||
                    (recipientTab === 'paste' && !pasteEmails.trim())
                  }
                  onClick={async () => {
                    if (recipientTab === 'sheets' && sheetContacts.length > 0) { await importSheetContacts(); return; }
                    if (recipientTab === 'paste' && pasteEmails.trim()) {
                      const emails = pasteEmails.split('\n').map(e => e.trim()).filter(e => e.includes('@'));
                      // First try to match existing contacts
                      const matched = contacts.filter((c: any) => emails.includes(c.email));
                      const matchedEmails = new Set(matched.map((c: any) => c.email));
                      const unmatchedEmails = emails.filter(e => !matchedEmails.has(e));

                      // Create contacts for unmatched emails via bulk import
                      let newIds: string[] = [];
                      if (unmatchedEmails.length > 0) {
                        try {
                          const importRes = await fetch('/api/contacts/import', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                              contacts: unmatchedEmails.map(email => ({ email })),
                              source: 'paste',
                            }),
                          });
                          if (importRes.ok) {
                            // Re-fetch contacts to get the new IDs
                            const refreshRes = await fetch('/api/contacts?limit=10000', { credentials: 'include' });
                            if (refreshRes.ok) {
                              const refreshData = await refreshRes.json();
                              const allContacts = refreshData.contacts || refreshData;
                              const newMatched = allContacts.filter((c: any) => unmatchedEmails.includes(c.email));
                              newIds = newMatched.map((c: any) => c.id);
                            }
                          }
                        } catch (e) {
                          console.error('Failed to import pasted contacts:', e);
                        }
                      }

                      const allIds = [...matched.map((c: any) => c.id), ...newIds];
                      if (allIds.length > 0) {
                        setSelectedContacts(allIds);
                      } else {
                        setError('No valid contacts could be created from pasted emails');
                      }
                    }
                    if (selectedContacts.length > 0 || (recipientTab === 'paste' && pasteEmails.trim())) { setError(''); }
                    setShowRecipients(false);
                  }}>
                  {sheetLoading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Importing...</> :
                   recipientTab === 'sheets' && sheetContacts.length > 0 ? `Import & select ${sheetContacts.length} contacts` : 'Confirm'}
                </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AUTOPILOT DIALOG */}
      <Dialog open={showAutopilot} onOpenChange={setShowAutopilot}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Autopilot</DialogTitle>
            <DialogDescription>Improve your deliverability with these sending options.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-8 mt-2">
            <div className="flex-1">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Send only on</div>
              <div className="space-y-2">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                  const dayConfig = autopilot.days[day];
                  return (
                    <div key={day} className={`flex items-center gap-3 ${!dayConfig.enabled ? 'opacity-50' : ''}`}>
                      <input type="checkbox" checked={dayConfig.enabled}
                        onChange={e => setAutopilot(prev => ({ ...prev, days: { ...prev.days, [day]: { ...prev.days[day], enabled: e.target.checked } } }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 w-24">{day}</span>
                      <input type="time" value={dayConfig.startTime}
                        onChange={e => setAutopilot(prev => ({ ...prev, days: { ...prev.days, [day]: { ...prev.days[day], startTime: e.target.value } } }))}
                        disabled={!dayConfig.enabled}
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-20 disabled:bg-gray-50" />
                      <span className="text-xs text-gray-400">to</span>
                      <input type="time" value={dayConfig.endTime}
                        onChange={e => setAutopilot(prev => ({ ...prev, days: { ...prev.days, [day]: { ...prev.days[day], endTime: e.target.value } } }))}
                        disabled={!dayConfig.enabled}
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-20 disabled:bg-gray-50" />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="w-56">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sending rate</div>
              <label className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-700">Max emails per day:</span>
              </label>
              <Input type="number" value={autopilot.maxPerDay}
                onChange={e => setAutopilot(prev => ({ ...prev, maxPerDay: parseInt(e.target.value) || 100 }))}
                className="mb-3 h-9" />
              <label className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-700">Delay between emails:</span>
              </label>
              <div className="flex gap-2 mb-5">
                <Input type="number" value={autopilot.delayBetween}
                  onChange={e => setAutopilot(prev => ({ ...prev, delayBetween: parseInt(e.target.value) || 1 }))}
                  className="h-9 w-20" />
                <select value={autopilot.delayUnit}
                  onChange={e => setAutopilot(prev => ({ ...prev, delayUnit: e.target.value as any }))}
                  className="h-9 border border-gray-200 rounded-md px-2 text-sm flex-1">
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                </select>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <div className="text-xs text-gray-400 mb-1">Summary</div>
                <div className="text-sm text-gray-600">
                  If you send {recipientCount || 100} emails, it will take about{' '}
                  <span className="font-semibold underline decoration-dotted">
                    {(() => {
                      const { dailyCapacity } = getAutopilotSummary();
                      const count = recipientCount || 100;
                      const totalMinutes = count * (autopilot.delayUnit === 'minutes' ? autopilot.delayBetween : autopilot.delayBetween / 60);
                      if (totalMinutes < 60) return `${Math.ceil(totalMinutes)} minutes`;
                      if (totalMinutes < 1440) return `${Math.ceil(totalMinutes / 60)} hours`;
                      return `${Math.ceil(count / (dailyCapacity || 100))} days`;
                    })()}
                  </span>.
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowAutopilot(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setAutopilot(prev => ({ ...prev, enabled: true })); setShowAutopilot(false); }}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SCHEDULE SEND DIALOG */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-xs p-0">
          <CalendarPicker
            selected={schedule.date} time={schedule.time}
            onSelect={(date) => setSchedule(prev => ({ ...prev, date }))}
            onTimeChange={(time) => setSchedule(prev => ({ ...prev, time }))}
            onApply={() => { setSchedule(prev => ({ ...prev, enabled: true })); setShowSchedule(false); }}
            onCancel={() => setShowSchedule(false)}
          />
        </DialogContent>
      </Dialog>

      {/* INSERT TEMPLATE DIALOG */}
      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Insert a template</DialogTitle></DialogHeader>
          <div className="flex gap-4 border-b border-gray-100 mb-3">
            <button onClick={() => setTemplateTab('recent')}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${templateTab === 'recent' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              Recent
            </button>
            <button onClick={() => setTemplateTab('all')}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${templateTab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              All
            </button>
          </div>
          <div className="space-y-0.5 max-h-80 overflow-y-auto">
            {templates.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">No templates yet. Create one in the Templates section.</div>
            ) : templates.map((t: any) => (
              <button key={t.id} onClick={() => insertTemplate(t)}
                className="w-full text-left px-3 py-3 text-sm text-gray-700 hover:bg-blue-50 rounded-lg transition-colors truncate">
                {t.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== SUB-COMPONENTS ====================

function ToolbarBtn({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors">
      {icon}
    </button>
  );
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-gray-200 mx-1" />;
}

// ==================== CALENDAR PICKER ====================
function CalendarPicker({ selected, time, onSelect, onTimeChange, onApply, onCancel }: {
  selected: Date | null; time: string;
  onSelect: (d: Date) => void; onTimeChange: (t: string) => void;
  onApply: () => void; onCancel: () => void;
}) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleString('default', { month: 'long' });
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };
  const isSelected = (day: number) => selected ? selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear : false;
  const isToday = (day: number) => today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-bold text-gray-900">{monthName} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-[10px] text-gray-400 font-medium text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0">
        {cells.map((day, i) => (
          <button key={i} disabled={!day}
            onClick={() => day && onSelect(new Date(viewYear, viewMonth, day))}
            className={`h-8 w-8 text-xs rounded-full flex items-center justify-center mx-auto transition-colors ${
              !day ? '' : isSelected(day) ? 'bg-blue-600 text-white font-bold' : isToday(day) ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
            }`}>{day || ''}</button>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">{selected ? selected.toLocaleDateString('en-US', { weekday: 'long' }) : 'Select a date'}</div>
            <div className="text-xs text-gray-400">{selected ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--'}</div>
          </div>
          <input type="time" value={time} onChange={e => onTimeChange(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-24" />
        </div>
        <Button onClick={onApply} className="w-full bg-blue-600 hover:bg-blue-700 mb-2" disabled={!selected}>Apply</Button>
        <Button variant="outline" onClick={onCancel} className="w-full">Cancel</Button>
      </div>
    </div>
  );
}
