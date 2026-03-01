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
  SpellCheck, Palette
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
  delayUnit: 'hours' | 'days' | 'weeks';
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

  // Template dialog
  const [templateTab, setTemplateTab] = useState<'recent' | 'all'>('recent');

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
          setContacts(data.contacts || data || []);
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
  }, [activeStepIndex]);

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
    setShowTemplates(false);
  };

  // Insert variable
  const insertVariable = (varName: string) => {
    execCmd('insertText', `{{${varName}}}`);
  };

  // Recipient count
  const recipientCount = selectedContacts.length;
  const selectedAccount = emailAccounts.find(a => a.id === emailAccountId);

  // Send campaign
  const handleSend = async () => {
    setError('');
    if (!emailAccountId) { setError('Please select a sender account'); return; }
    if (!steps[0].subject) { setError('Please enter a subject line'); return; }
    if (recipientCount === 0) { setError('Please select recipients'); return; }

    setSending(true);
    try {
      const name = campaignName || `Campaign ${new Date().toLocaleDateString()}`;
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name, emailAccountId,
          subject: steps[0].subject, content: steps[0].content,
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

  // Autopilot summary
  const getAutopilotSummary = () => {
    const activeDays = Object.entries(autopilot.days).filter(([, v]) => v.enabled).length;
    // Average hours per active day
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
              onClick={() => {
                /* preview */
              }}>
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
              <div className="flex items-center px-5 py-3 border-b border-gray-100">
                <span className="text-sm text-gray-400 w-16 flex-shrink-0">From</span>
                <select
                  value={emailAccountId}
                  onChange={e => setEmailAccountId(e.target.value)}
                  className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-0 outline-none cursor-pointer appearance-none"
                >
                  {emailAccounts.length === 0 && <option value="">No accounts — add one in Accounts</option>}
                  {emailAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.displayName || a.email} &lt;{a.email}&gt;
                    </option>
                  ))}
                </select>
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
                          if (testEmail) {
                            alert(`Test email would be sent to ${testEmail}`);
                          }
                          setShowMoreMenu(false); 
                        } },
                        { label: 'Select recipients', action: () => { setShowRecipients(true); setShowMoreMenu(false); } },
                      ].map(item => (
                        <button key={item.label} onClick={item.action}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
              {/* Bcc row */}
              {showBcc && (
                <div className="flex items-center px-5 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0">Bcc</span>
                  <input value={bccValue} onChange={e => setBccValue(e.target.value)}
                    placeholder="bcc@example.com" className="flex-1 text-sm bg-transparent border-0 outline-none" />
                  <button onClick={() => { setShowBcc(false); setBccValue(''); }} className="text-gray-300 hover:text-gray-500"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {/* Reply-to row */}
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
                  <button onClick={() => setShowRecipients(true)}
                    className="text-sm font-medium text-blue-600 border border-blue-300 rounded-lg px-3 py-1 hover:bg-blue-50 transition-colors">
                    Select recipients
                  </button>
                  {recipientCount > 0 && (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200">{recipientCount} selected</Badge>
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

            {/* Follow-up condition bar (for steps > 0) */}
            {activeStepIndex > 0 && activeStep && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4 px-5 py-3 flex items-center gap-3 flex-wrap">
                <select value={activeStep.condition}
                  onChange={e => updateActiveStep({ condition: e.target.value as any })}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                  <option value="if_no_reply">If no reply</option>
                  <option value="if_no_click">If no click</option>
                  <option value="if_no_open">If no open</option>
                  <option value="if_opened">If opened</option>
                  <option value="if_clicked">If clicked</option>
                  <option value="if_replied">If replied</option>
                  <option value="no_matter_what">No matter what</option>
                </select>
                <span className="text-sm text-gray-500">after</span>
                <input type="number" min={1} max={365} value={activeStep.delayValue}
                  onChange={e => updateActiveStep({ delayValue: parseInt(e.target.value) || 1 })}
                  className="w-16 text-sm text-center border border-gray-200 rounded-lg px-2 py-1.5" />
                <select value={activeStep.delayUnit}
                  onChange={e => updateActiveStep({ delayUnit: e.target.value as any })}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                </select>
                <span className="text-sm text-gray-500">send this email</span>
              </div>
            )}

            {/* Rich Text Editor */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 flex-wrap bg-gray-50/50">
                <ToolbarBtn icon={<Bold className="h-4 w-4" />} onClick={() => execCmd('bold')} title="Bold" />
                <ToolbarBtn icon={<Italic className="h-4 w-4" />} onClick={() => execCmd('italic')} title="Italic" />
                <ToolbarBtn icon={<Underline className="h-4 w-4" />} onClick={() => execCmd('underline')} title="Underline" />
                {/* Font color with dropdown indicator */}
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
                <ToolbarBtn icon={<SpellCheck className="h-4 w-4" />} onClick={() => {}} title="Spell check" />
                <ToolbarBtn icon={<Paperclip className="h-4 w-4" />} onClick={() => {}} title="Attach" />
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
                  <option>Sans Serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Arial">Arial</option>
                </select>
                {/* Font size */}
                <select className="text-xs border-0 bg-transparent text-gray-500 cursor-pointer outline-none px-1"
                  onChange={e => execCmd('fontSize', e.target.value)}>
                  <option value="3">Tт</option>
                  <option value="1">Small</option>
                  <option value="3">Normal</option>
                  <option value="5">Large</option>
                  <option value="7">Huge</option>
                </select>
                <ToolbarSep />
                <ToolbarBtn icon={<ListOrdered className="h-4 w-4" />} onClick={() => execCmd('insertOrderedList')} title="Numbered list" />
                <ToolbarBtn icon={<List className="h-4 w-4" />} onClick={() => execCmd('insertUnorderedList')} title="Bullet list" />
                <ToolbarBtn icon={<AlignLeft className="h-4 w-4" />} onClick={() => execCmd('justifyLeft')} title="Align left" />
                <ToolbarBtn icon={<AlignCenter className="h-4 w-4" />} onClick={() => execCmd('justifyCenter')} title="Center" />
                <ToolbarBtn icon={<AlignRight className="h-4 w-4" />} onClick={() => execCmd('justifyRight')} title="Align right" />
                <ToolbarSep />
                <ToolbarBtn icon={<Code className="h-4 w-4" />} onClick={() => execCmd('formatBlock', 'pre')} title="Code" />
                <ToolbarBtn icon={<Type className="h-3.5 w-3.5" />} onClick={() => execCmd('removeFormat')} title="Clear formatting" />
              </div>

              {/* Content editable area */}
              <div
                ref={editorRef}
                contentEditable
                onInput={handleEditorInput}
                className="min-h-[300px] p-5 text-sm text-gray-900 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300"
                data-placeholder="Compose your email..."
                suppressContentEditableWarning
              />
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
          <button className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500 hover:text-yellow-600 transition-colors" title="AI Assistant">
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
                      <button onClick={(e) => e.stopPropagation()}
                        className="p-0.5 rounded hover:bg-gray-200 text-gray-300 hover:text-gray-500 opacity-0 group-hover/step:opacity-100 transition-opacity">
                        <MoreVertical className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 flex items-center gap-2">
                    {i === 0 ? (
                      'Will be sent immediately'
                    ) : (
                      <>
                        <Zap className="h-3 w-3" />
                        {conditionLabels[step.condition]}
                        <Clock className="h-3 w-3 ml-1" />
                        {step.delayValue} {step.delayUnit}
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ==================== DIALOGS ==================== */}

      {/* SELECT RECIPIENTS DIALOG */}
      <Dialog open={showRecipients} onOpenChange={setShowRecipients}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <div className="flex min-h-[420px]">
            {/* Left tabs */}
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
                    recipientTab === tab.key
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Right content */}
            <div className="flex-1 p-6 flex flex-col">
              {/* Google Sheets */}
              {recipientTab === 'sheets' && (
                <div className="space-y-4 flex-1">
                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Spreadsheet</Label>
                    <Input placeholder="Copy/paste spreadsheet URL" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Sheet</Label>
                    <select className="w-full h-10 border border-gray-200 rounded-md px-3 text-sm" value={sheetName} onChange={e => setSheetName(e.target.value)}>
                      <option value="">Select a sheet</option>
                      <option value="Sheet1">Sheet1</option>
                      <option value="Contacts">Contacts</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Import CSV */}
              {recipientTab === 'csv' && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="border-2 border-dashed border-blue-200 rounded-2xl p-10 text-center w-full bg-blue-50/30">
                    <Upload className="h-10 w-10 text-blue-400 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 mb-4">Drag a CSV file here or click the button below to upload your mailing list</p>
                    <Button className="bg-blue-600 hover:bg-blue-700">
                      <Upload className="h-4 w-4 mr-2" /> Import a CSV
                    </Button>
                  </div>
                </div>
              )}

              {/* Contact list */}
              {recipientTab === 'contacts' && (
                <div className="space-y-4 flex-1">
                  <div>
                    <Label className="text-sm text-gray-600 mb-1.5 block">Select a list</Label>
                    <select className="w-full h-10 border border-gray-200 rounded-md px-3 text-sm"
                      value={contactListFilter} onChange={e => {
                        setContactListFilter(e.target.value);
                        if (e.target.value === 'all') {
                          setSelectedContacts(contacts.filter(c => c.status !== 'unsubscribed').map(c => c.id));
                        }
                      }}>
                      <option value="">Select a list</option>
                      <option value="all">All contacts ({contacts.length})</option>
                    </select>
                  </div>
                  {selectedContacts.length > 0 && (
                    <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                      <CheckCircle className="h-4 w-4 inline mr-1.5" />
                      {selectedContacts.length} contacts selected
                    </div>
                  )}
                </div>
              )}

              {/* Copy/paste */}
              {recipientTab === 'paste' && (
                <div className="flex-1 flex flex-col">
                  <Textarea
                    placeholder="Enter one email address per line"
                    value={pasteEmails}
                    onChange={e => setPasteEmails(e.target.value)}
                    className="flex-1 min-h-[280px] resize-none"
                  />
                </div>
              )}

              {/* Footer */}
              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
                <Button variant="outline" onClick={() => setShowRecipients(false)}>Close</Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => {
                  if (recipientTab === 'paste' && pasteEmails.trim()) {
                    const emails = pasteEmails.split('\n').map(e => e.trim()).filter(e => e.includes('@'));
                    // Find matching contacts or create temp ones
                    const matched = contacts.filter(c => emails.includes(c.email));
                    if (matched.length > 0) setSelectedContacts(matched.map(c => c.id));
                  }
                  setShowRecipients(false);
                }}>Next</Button>
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
            <DialogDescription>
              Improve your deliverability with these sending options{' '}
              <a href="#" className="text-blue-600 hover:underline">(why it's important)</a>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-8 mt-2">
            {/* Left: Schedule */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Send only on</div>
                <div className="text-xs text-gray-400">Turn off</div>
              </div>
              <div className="space-y-2">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                  const dayConfig = autopilot.days[day];
                  return (
                    <div key={day} className={`flex items-center gap-3 ${!dayConfig.enabled ? 'opacity-50' : ''}`}>
                      <input type="checkbox"
                        checked={dayConfig.enabled}
                        onChange={e => setAutopilot(prev => ({
                          ...prev,
                          days: { ...prev.days, [day]: { ...prev.days[day], enabled: e.target.checked } }
                        }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 w-24">{day}</span>
                      <input type="time" value={dayConfig.startTime}
                        onChange={e => setAutopilot(prev => ({
                          ...prev,
                          days: { ...prev.days, [day]: { ...prev.days[day], startTime: e.target.value } }
                        }))}
                        disabled={!dayConfig.enabled}
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-20 disabled:bg-gray-50 disabled:text-gray-400" />
                      <span className="text-xs text-gray-400">to</span>
                      <input type="time" value={dayConfig.endTime}
                        onChange={e => setAutopilot(prev => ({
                          ...prev,
                          days: { ...prev.days, [day]: { ...prev.days[day], endTime: e.target.value } }
                        }))}
                        disabled={!dayConfig.enabled}
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-20 disabled:bg-gray-50 disabled:text-gray-400" />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-3 text-[11px] text-gray-400">
                <span>📍</span> Based on your timezone
              </div>
            </div>

            {/* Right: Rate */}
            <div className="w-56">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sending rate</div>

              <label className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked className="h-4 w-4 rounded border-gray-300 text-blue-600" readOnly />
                <span className="text-sm text-gray-700">Max emails per day:</span>
              </label>
              <Input type="number" value={autopilot.maxPerDay}
                onChange={e => setAutopilot(prev => ({ ...prev, maxPerDay: parseInt(e.target.value) || 100 }))}
                className="mb-3 h-9" />

              <label className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked className="h-4 w-4 rounded border-gray-300 text-blue-600" readOnly />
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
                <div className="text-xs text-gray-400 mb-1">Sending will start on</div>
                <div className="text-sm font-semibold text-gray-900 mb-3">
                  {(() => {
                    const now = new Date();
                    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    // Find next enabled day
                    for (let i = 0; i < 7; i++) {
                      const check = new Date(now.getTime() + (i + 1) * 86400000);
                      const dayName = dayNames[check.getDay()];
                      if (autopilot.days[dayName]?.enabled) {
                        return `${check.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}, ${autopilot.days[dayName].startTime.replace(':', ':')} AM`;
                      }
                    }
                    return 'No active days selected';
                  })()}
                </div>
                <div className="text-xs text-gray-400 mb-1">Summary</div>
                <div className="text-sm text-gray-600">
                  With the current settings, if you send {recipientCount || 100} emails, it will take about{' '}
                  <span className="font-semibold underline decoration-dotted">
                    {(() => {
                      const { dailyCapacity } = getAutopilotSummary();
                      const count = recipientCount || 100;
                      const totalMinutes = count * (autopilot.delayUnit === 'minutes' ? autopilot.delayBetween : autopilot.delayBetween / 60);
                      if (totalMinutes < 60) return `${Math.ceil(totalMinutes)} minutes`;
                      if (totalMinutes < 1440) return `${Math.ceil(totalMinutes / 60)} hours`;
                      return `${Math.ceil(count / (dailyCapacity || 100))} ${Math.ceil(count / (dailyCapacity || 100)) === 1 ? 'day' : 'days'}`;
                    })()}
                  </span>.
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowAutopilot(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => {
              setAutopilot(prev => ({ ...prev, enabled: true }));
              setShowAutopilot(false);
            }}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SCHEDULE SEND DIALOG */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-xs p-0">
          <CalendarPicker
            selected={schedule.date}
            time={schedule.time}
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
          <DialogHeader>
            <DialogTitle>Insert a template</DialogTitle>
          </DialogHeader>
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
            ) : (
              templates.map((t: any) => (
                <button key={t.id} onClick={() => insertTemplate(t)}
                  className="w-full text-left px-3 py-3 text-sm text-gray-700 hover:bg-blue-50 rounded-lg transition-colors truncate">
                  {t.name}
                </button>
              ))
            )}
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
  selected: Date | null;
  time: string;
  onSelect: (d: Date) => void;
  onTimeChange: (t: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleString('default', { month: 'long' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const isSelected = (day: number) => {
    if (!selected) return false;
    return selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
  };
  const isToday = (day: number) => {
    return today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="p-4">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-bold text-gray-900">{monthName} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-[10px] text-gray-400 font-medium text-center py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((day, i) => (
          <button key={i} disabled={!day}
            onClick={() => day && onSelect(new Date(viewYear, viewMonth, day))}
            className={`h-8 w-8 text-xs rounded-full flex items-center justify-center mx-auto transition-colors ${
              !day ? '' :
              isSelected(day) ? 'bg-blue-600 text-white font-bold' :
              isToday(day) ? 'bg-blue-100 text-blue-700 font-semibold' :
              'text-gray-700 hover:bg-gray-100'
            }`}>
            {day || ''}
          </button>
        ))}
      </div>

      {/* Selected info + time */}
      <div className="mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {selected ? selected.toLocaleDateString('en-US', { weekday: 'long' }) : 'Select a date'}
            </div>
            <div className="text-xs text-gray-400">
              {selected ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
            </div>
          </div>
          <input type="time" value={time} onChange={e => onTimeChange(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-24" />
        </div>

        <Button onClick={onApply} className="w-full bg-blue-600 hover:bg-blue-700 mb-2" disabled={!selected}>Apply</Button>
        <Button variant="outline" onClick={onCancel} className="w-full">Cancel</Button>
      </div>
    </div>
  );
}
