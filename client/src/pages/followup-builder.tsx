import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  GitBranch, Plus, Edit, Trash2, Clock, Mail, MousePointerClick,
  Reply, ArrowDown, Loader2, Zap, PlayCircle, MoreHorizontal,
  ChevronRight, Timer, Workflow, Sparkles
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface FollowupStep {
  id: string;
  stepNumber: number;
  trigger: string;
  delayDays: number;
  delayHours: number;
  subject: string;
  content: string;
  isActive: boolean;
}

interface FollowupSequence {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  steps: FollowupStep[];
  createdAt: string;
}

export default function FollowupSequenceBuilder() {
  const [sequences, setSequences] = useState<FollowupSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showStepDialog, setShowStepDialog] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<FollowupSequence | null>(null);

  const [seqName, setSeqName] = useState('');
  const [seqDesc, setSeqDesc] = useState('');
  const [editSequence, setEditSequence] = useState<FollowupSequence | null>(null);

  const [stepTrigger, setStepTrigger] = useState('no_reply');
  const [stepDelayDays, setStepDelayDays] = useState(2);
  const [stepDelayHours, setStepDelayHours] = useState(0);
  const [stepSubject, setStepSubject] = useState('');
  const [stepContent, setStepContent] = useState('');
  const [editStep, setEditStep] = useState<FollowupStep | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const triggers = [
    { value: 'no_reply', label: 'No Reply', icon: Reply, desc: 'Contact has not replied', color: 'text-orange-600', bg: 'bg-orange-50' },
    { value: 'no_open', label: 'No Open', icon: Mail, desc: 'Email was not opened', color: 'text-red-600', bg: 'bg-red-50' },
    { value: 'time_delay', label: 'Time Delay', icon: Clock, desc: 'Wait then send', color: 'text-blue-600', bg: 'bg-blue-50' },
    { value: 'opened', label: 'Opened', icon: Mail, desc: 'Email was opened', color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { value: 'clicked', label: 'Link Clicked', icon: MousePointerClick, desc: 'A link was clicked', color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  useEffect(() => { fetchSequences(); }, []);

  const fetchSequences = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/followup-sequences', { credentials: 'include' });
      if (res.ok) setSequences(await res.json());
    } catch (e) { console.error('Failed to fetch:', e); }
    setLoading(false);
  };

  const handleCreateSequence = async () => {
    if (!seqName) return;
    setFormLoading(true);
    try {
      const url = editSequence ? `/api/followup-sequences/${editSequence.id}` : '/api/followup-sequences';
      const method = editSequence ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: seqName, description: seqDesc }),
      });
      if (res.ok) {
        setShowCreateDialog(false);
        setSeqName(''); setSeqDesc(''); setEditSequence(null);
        await fetchSequences();
      }
    } catch (e) { /* ignore */ }
    setFormLoading(false);
  };

  const handleDeleteSequence = async (id: string) => {
    if (!confirm('Delete this sequence?')) return;
    await fetch(`/api/followup-sequences/${id}`, { method: 'DELETE', credentials: 'include' });
    if (selectedSequence?.id === id) setSelectedSequence(null);
    await fetchSequences();
  };

  const handleCreateStep = async () => {
    if (!selectedSequence || !stepSubject) return;
    setFormLoading(true);
    try {
      const url = editStep 
        ? `/api/followup-steps/${editStep.id}` 
        : `/api/followup-sequences/${selectedSequence.id}/steps`;
      const method = editStep ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trigger: stepTrigger,
          delayDays: stepDelayDays,
          delayHours: stepDelayHours,
          subject: stepSubject,
          content: stepContent,
          stepNumber: editStep ? editStep.stepNumber : (selectedSequence.steps?.length || 0) + 1,
        }),
      });
      if (res.ok) {
        setShowStepDialog(false);
        resetStepForm();
        await fetchSequences();
        const updated = await fetch(`/api/followup-sequences`, { credentials: 'include' });
        if (updated.ok) {
          const seqs = await updated.json();
          setSequences(seqs);
          const sel = seqs.find((s: any) => s.id === selectedSequence.id);
          if (sel) setSelectedSequence(sel);
        }
      }
    } catch (e) { /* ignore */ }
    setFormLoading(false);
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('Delete this step?')) return;
    await fetch(`/api/followup-steps/${stepId}`, { method: 'DELETE', credentials: 'include' });
    await fetchSequences();
    if (selectedSequence) {
      const res = await fetch('/api/followup-sequences', { credentials: 'include' });
      if (res.ok) {
        const seqs = await res.json();
        setSequences(seqs);
        const sel = seqs.find((s: any) => s.id === selectedSequence.id);
        if (sel) setSelectedSequence(sel);
      }
    }
  };

  const openStepEditor = (step?: FollowupStep) => {
    if (step) {
      setEditStep(step);
      setStepTrigger(step.trigger);
      setStepDelayDays(step.delayDays);
      setStepDelayHours(step.delayHours);
      setStepSubject(step.subject);
      setStepContent(step.content);
    } else {
      resetStepForm();
    }
    setShowStepDialog(true);
  };

  const resetStepForm = () => {
    setEditStep(null);
    setStepTrigger('no_reply');
    setStepDelayDays(2);
    setStepDelayHours(0);
    setStepSubject('');
    setStepContent('');
  };

  const getTriggerInfo = (trigger: string) => {
    return triggers.find(t => t.value === trigger) || triggers[0];
  };

  const formatDelay = (days: number, hours: number) => {
    const parts = [];
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    return parts.join(' ') || 'Immediately';
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">
          Automate follow-up emails based on recipient behavior and time delays
        </div>
        <Button 
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50" 
          size="sm"
          onClick={() => { setEditSequence(null); setSeqName(''); setSeqDesc(''); setShowCreateDialog(true); }}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Sequence
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Sequences List */}
        <div className="space-y-3">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1">
            Sequences ({sequences.length})
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sequences.length === 0 ? (
            <Card className="border-gray-200/60 shadow-sm">
              <CardContent className="p-6 text-center">
                <div className="bg-gray-100 w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Workflow className="h-6 w-6 text-gray-300" />
                </div>
                <p className="text-sm text-gray-500 mb-1 font-medium">No sequences yet</p>
                <p className="text-xs text-gray-400 mb-3">Create your first automation</p>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => { setEditSequence(null); setSeqName(''); setSeqDesc(''); setShowCreateDialog(true); }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create
                </Button>
              </CardContent>
            </Card>
          ) : (
            sequences.map((seq) => (
              <Card 
                key={seq.id} 
                className={`cursor-pointer transition-all border-gray-200/60 shadow-sm ${
                  selectedSequence?.id === seq.id 
                    ? 'ring-2 ring-blue-500 shadow-md border-blue-200' 
                    : 'hover:shadow-md hover:border-gray-300'
                }`}
                onClick={() => setSelectedSequence(seq)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 text-sm truncate">{seq.name}</h4>
                      {seq.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{seq.description}</p>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditSequence(seq); setSeqName(seq.name); setSeqDesc(seq.description); setShowCreateDialog(true); }}>
                          <Edit className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDeleteSequence(seq.id); }} className="text-red-600">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={seq.isActive ? 'default' : 'secondary'} className={`text-[10px] ${seq.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200 border' : ''}`}>
                      {seq.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {seq.steps?.length || 0} steps
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Sequence Steps (Visual Builder) */}
        <div>
          {selectedSequence ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{selectedSequence.name}</h3>
                  <p className="text-xs text-gray-400">{selectedSequence.steps?.length || 0} follow-up steps configured</p>
                </div>
                <Button size="sm" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm" onClick={() => openStepEditor()}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Step
                </Button>
              </div>

              {/* Visual Step Flow */}
              <div className="space-y-0">
                {/* Initial email */}
                <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200/60">
                  <div className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-xl w-10 h-10 flex items-center justify-center shadow-md shadow-blue-200/50 flex-shrink-0">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-blue-900">Initial Campaign Email</div>
                    <div className="text-xs text-blue-600/70">Sent when campaign starts</div>
                  </div>
                </div>

                {(selectedSequence.steps || []).map((step, i) => {
                  const triggerInfo = getTriggerInfo(step.trigger);
                  return (
                    <React.Fragment key={step.id}>
                      {/* Connector */}
                      <div className="flex items-center justify-center py-1.5 relative">
                        <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-gray-200" />
                        <div className="flex flex-col items-center z-10">
                          <div className="w-6 h-6 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center">
                            <Timer className="h-3 w-3 text-gray-400" />
                          </div>
                          <div className="text-[10px] text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-100 mt-0.5 font-medium">
                            Wait {formatDelay(step.delayDays, step.delayHours)}
                          </div>
                        </div>
                      </div>

                      {/* Step card */}
                      <div className="flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-200/80 hover:border-blue-200 hover:shadow-md transition-all group">
                        <div className={`${triggerInfo.bg} rounded-xl w-10 h-10 flex items-center justify-center flex-shrink-0`}>
                          <triggerInfo.icon className={`h-5 w-5 ${triggerInfo.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={`text-[10px] font-medium ${triggerInfo.bg} ${triggerInfo.color} border-0`}>
                              {triggerInfo.label}
                            </Badge>
                            <span className="text-[10px] text-gray-300">Step {i + 1}</span>
                            {!step.isActive && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
                          </div>
                          <div className="font-medium text-sm text-gray-900 truncate">{step.subject || 'No subject'}</div>
                          <div className="text-xs text-gray-400 mt-0.5 truncate">
                            {step.content ? step.content.replace(/<[^>]*>/g, '').substring(0, 100) : 'No content'}
                          </div>
                        </div>
                        <div className="flex gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openStepEditor(step)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => handleDeleteStep(step.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}

                {(!selectedSequence.steps || selectedSequence.steps.length === 0) && (
                  <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl mt-3 bg-gray-50/30">
                    <div className="bg-gray-100 w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="h-7 w-7 text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 mb-1">No follow-up steps yet</p>
                    <p className="text-xs text-gray-400 mb-4">Add steps to automate your follow-up emails</p>
                    <Button variant="outline" size="sm" onClick={() => openStepEditor()}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add First Step
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 text-gray-400 bg-gray-50/30 rounded-xl border border-dashed border-gray-200">
              <div className="bg-gray-100 w-16 h-16 rounded-xl flex items-center justify-center mb-4">
                <Workflow className="h-8 w-8 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500 mb-1">Select a sequence</p>
              <p className="text-xs text-gray-400">Choose a sequence from the left to view and edit its steps</p>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Sequence Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Workflow className="h-4 w-4 text-blue-600" />
              </div>
              {editSequence ? 'Edit Sequence' : 'New Sequence'}
            </DialogTitle>
            <DialogDescription>
              {editSequence ? 'Update your automation sequence' : 'Create a new follow-up automation sequence'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sequence Name *</Label>
              <Input value={seqName} onChange={(e) => setSeqName(e.target.value)} placeholder="e.g., No-Reply Follow-up" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Description</Label>
              <Textarea value={seqDesc} onChange={(e) => setSeqDesc(e.target.value)} rows={2} placeholder="What does this sequence do?" className="mt-1.5" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateSequence} disabled={formLoading || !seqName} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editSequence ? 'Save Changes' : 'Create Sequence'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Step Dialog */}
      <Dialog open={showStepDialog} onOpenChange={setShowStepDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-purple-50 p-2 rounded-lg">
                <Zap className="h-4 w-4 text-purple-600" />
              </div>
              {editStep ? 'Edit Step' : 'Add Follow-up Step'}
            </DialogTitle>
            <DialogDescription>
              Configure when and what to send as a follow-up
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Trigger Condition</Label>
              <Select value={stepTrigger} onValueChange={setStepTrigger}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {triggers.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center gap-2">
                        <div className={`${t.bg} p-1 rounded`}>
                          <t.icon className={`h-3.5 w-3.5 ${t.color}`} />
                        </div>
                        <div>
                          <span className="font-medium">{t.label}</span>
                          <span className="text-gray-400 ml-1.5 text-xs">{t.desc}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Wait Duration</Label>
              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <div className="relative">
                  <Input type="number" min={0} value={stepDelayDays} onChange={(e) => setStepDelayDays(parseInt(e.target.value) || 0)} className="pr-12" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">days</span>
                </div>
                <div className="relative">
                  <Input type="number" min={0} max={23} value={stepDelayHours} onChange={(e) => setStepDelayHours(parseInt(e.target.value) || 0)} className="pr-14" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">hours</span>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Subject Line *</Label>
              <Input value={stepSubject} onChange={(e) => setStepSubject(e.target.value)} placeholder='Re: {{previousSubject}}' className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Content</Label>
              <Textarea 
                value={stepContent} 
                onChange={(e) => setStepContent(e.target.value)} 
                rows={6} 
                className="font-mono text-sm mt-1.5 bg-gray-50" 
                placeholder={'<p>Hi {{firstName}},</p>\n<p>Just following up on my previous email...</p>'} 
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowStepDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateStep} disabled={formLoading || !stepSubject} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              {formLoading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editStep ? 'Save Step' : 'Add Step'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
