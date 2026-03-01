import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  GitBranch, Plus, Edit, Trash2, Clock, Mail, MousePointerClick,
  Reply, ArrowDown, Loader2, Zap, PlayCircle
} from "lucide-react";

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

  // Sequence form
  const [seqName, setSeqName] = useState('');
  const [seqDesc, setSeqDesc] = useState('');
  const [editSequence, setEditSequence] = useState<FollowupSequence | null>(null);

  // Step form
  const [stepTrigger, setStepTrigger] = useState('no_reply');
  const [stepDelayDays, setStepDelayDays] = useState(2);
  const [stepDelayHours, setStepDelayHours] = useState(0);
  const [stepSubject, setStepSubject] = useState('');
  const [stepContent, setStepContent] = useState('');
  const [editStep, setEditStep] = useState<FollowupStep | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const triggers = [
    { value: 'no_reply', label: 'No Reply', icon: Reply, desc: 'Contact has not replied' },
    { value: 'no_open', label: 'No Open', icon: Mail, desc: 'Email was not opened' },
    { value: 'time_delay', label: 'Time Delay', icon: Clock, desc: 'Wait then send' },
    { value: 'opened', label: 'Opened', icon: Mail, desc: 'Email was opened' },
    { value: 'clicked', label: 'Link Clicked', icon: MousePointerClick, desc: 'A link was clicked' },
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
        // Refresh selected sequence
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Follow-up Sequences</h2>
          <p className="text-sm text-gray-500">Automate follow-up emails based on recipient actions</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setEditSequence(null); setSeqName(''); setSeqDesc(''); setShowCreateDialog(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New Sequence
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sequences List */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-500 uppercase">Sequences</h3>
          {loading ? (
            <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto" /></div>
          ) : sequences.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <GitBranch className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No sequences yet</p>
              </CardContent>
            </Card>
          ) : (
            sequences.map((seq) => (
              <Card 
                key={seq.id} 
                className={`cursor-pointer transition-all ${selectedSequence?.id === seq.id ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md'}`}
                onClick={() => setSelectedSequence(seq)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-gray-900 text-sm">{seq.name}</h4>
                    <div className="flex items-center space-x-1">
                      <Badge variant={seq.isActive ? 'default' : 'secondary'} className={seq.isActive ? 'bg-green-100 text-green-700' : ''}>
                        {seq.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                  {seq.description && <p className="text-xs text-gray-500 mb-2">{seq.description}</p>}
                  <div className="text-xs text-gray-400">
                    {seq.steps?.length || 0} steps
                  </div>
                  <div className="flex mt-2 space-x-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setEditSequence(seq); setSeqName(seq.name); setSeqDesc(seq.description); setShowCreateDialog(true); }}>
                      <Edit className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); handleDeleteSequence(seq.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Sequence Steps (Visual Builder) */}
        <div className="lg:col-span-2">
          {selectedSequence ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">{selectedSequence.name} - Steps</h3>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => openStepEditor()}>
                  <Plus className="h-4 w-4 mr-1" /> Add Step
                </Button>
              </div>

              {/* Visual Step Flow */}
              <div className="space-y-0">
                {/* Initial email step */}
                <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-medium">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-blue-900">Initial Campaign Email</div>
                    <div className="text-xs text-blue-700">Sent when campaign starts</div>
                  </div>
                </div>

                {(selectedSequence.steps || []).map((step, i) => {
                  const triggerInfo = getTriggerInfo(step.trigger);
                  return (
                    <React.Fragment key={step.id}>
                      {/* Connector */}
                      <div className="flex items-center justify-center py-1">
                        <div className="flex flex-col items-center">
                          <ArrowDown className="h-4 w-4 text-gray-400" />
                          <div className="text-xs text-gray-400 bg-white px-2">
                            {step.delayDays > 0 ? `${step.delayDays}d` : ''}{step.delayHours > 0 ? ` ${step.delayHours}h` : ''} wait
                          </div>
                        </div>
                      </div>

                      {/* Step card */}
                      <div className="flex items-start space-x-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-colors">
                        <div className="bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center text-sm font-medium text-gray-600 flex-shrink-0">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              <triggerInfo.icon className="h-3 w-3 mr-1" />
                              {triggerInfo.label}
                            </Badge>
                            {!step.isActive && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                          </div>
                          <div className="font-medium text-sm text-gray-900 truncate">{step.subject || 'No subject'}</div>
                          <div className="text-xs text-gray-500 mt-0.5 truncate">
                            {step.content ? step.content.replace(/<[^>]*>/g, '').substring(0, 80) + '...' : 'No content'}
                          </div>
                        </div>
                        <div className="flex space-x-1 flex-shrink-0">
                          <Button variant="ghost" size="sm" className="h-7" onClick={() => openStepEditor(step)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-red-500" onClick={() => handleDeleteStep(step.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}

                {(!selectedSequence.steps || selectedSequence.steps.length === 0) && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg mt-4">
                    <Zap className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No follow-up steps yet</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => openStepEditor()}>
                      <Plus className="h-4 w-4 mr-1" /> Add First Step
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <GitBranch className="h-12 w-12 mb-3" />
              <p className="text-sm">Select a sequence to view and edit steps</p>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Sequence Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editSequence ? 'Edit Sequence' : 'New Sequence'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={seqName} onChange={(e) => setSeqName(e.target.value)} placeholder="e.g., No-Reply Follow-up" /></div>
            <div><Label>Description</Label><Textarea value={seqDesc} onChange={(e) => setSeqDesc(e.target.value)} rows={2} placeholder="Description..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateSequence} disabled={formLoading || !seqName} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editSequence ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Step Dialog */}
      <Dialog open={showStepDialog} onOpenChange={setShowStepDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editStep ? 'Edit Step' : 'Add Follow-up Step'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Trigger Condition</Label>
              <Select value={stepTrigger} onValueChange={setStepTrigger}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {triggers.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center"><t.icon className="h-4 w-4 mr-2" />{t.label} - {t.desc}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Wait Days</Label><Input type="number" min={0} value={stepDelayDays} onChange={(e) => setStepDelayDays(parseInt(e.target.value) || 0)} /></div>
              <div><Label>Wait Hours</Label><Input type="number" min={0} max={23} value={stepDelayHours} onChange={(e) => setStepDelayHours(parseInt(e.target.value) || 0)} /></div>
            </div>
            <div><Label>Subject *</Label><Input value={stepSubject} onChange={(e) => setStepSubject(e.target.value)} placeholder="Re: {{previousSubject}}" /></div>
            <div><Label>Email Content</Label><Textarea value={stepContent} onChange={(e) => setStepContent(e.target.value)} rows={6} className="font-mono text-sm" placeholder="<p>Hi {{firstName}},</p>\n<p>Just following up...</p>" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStepDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateStep} disabled={formLoading || !stepSubject} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editStep ? 'Save Step' : 'Add Step'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
