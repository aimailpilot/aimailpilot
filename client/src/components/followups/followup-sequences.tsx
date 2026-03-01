import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Clock, Mail, MousePointer, Reply, AlertTriangle, Timer, Eye } from "lucide-react";

interface FollowupSequence {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

interface FollowupStep {
  id: string;
  sequenceId: string;
  stepNumber: number;
  trigger: string;
  delayDays: number;
  delayHours: number;
  subject?: string;
  content?: string;
  templateId?: string;
  isActive: boolean;
}

const sequenceSchema = z.object({
  name: z.string().min(1, "Sequence name is required"),
  description: z.string().optional(),
});

const stepSchema = z.object({
  trigger: z.enum(["no_reply", "no_open", "no_click", "opened", "clicked", "replied", "bounced", "time_delay"]),
  delayDays: z.number().min(0).max(30),
  delayHours: z.number().min(0).max(23),
  subject: z.string().min(1, "Subject is required"),
  content: z.string().min(1, "Content is required"),
});

const getTriggerIcon = (trigger: string) => {
  switch (trigger) {
    case "no_reply": return <Reply className="h-4 w-4" />;
    case "no_open": return <Eye className="h-4 w-4" />;
    case "no_click": return <MousePointer className="h-4 w-4" />;
    case "opened": return <Mail className="h-4 w-4" />;
    case "clicked": return <MousePointer className="h-4 w-4" />;
    case "replied": return <Reply className="h-4 w-4" />;
    case "bounced": return <AlertTriangle className="h-4 w-4" />;
    case "time_delay": return <Timer className="h-4 w-4" />;
    default: return <Clock className="h-4 w-4" />;
  }
};

const getTriggerLabel = (trigger: string) => {
  switch (trigger) {
    case "no_reply": return "No Reply";
    case "no_open": return "No Open";
    case "no_click": return "No Click";
    case "opened": return "Email Opened";
    case "clicked": return "Link Clicked";
    case "replied": return "Email Replied";
    case "bounced": return "Email Bounced";
    case "time_delay": return "Time Delay";
    default: return trigger;
  }
};

export function FollowupSequences() {
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isStepDialogOpen, setIsStepDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sequences, isLoading } = useQuery<FollowupSequence[]>({
    queryKey: ["/api/followup-sequences"],
  });

  const { data: steps } = useQuery<FollowupStep[]>({
    queryKey: ["/api/followup-sequences", selectedSequence, "steps"],
    enabled: !!selectedSequence,
  });

  const sequenceForm = useForm<z.infer<typeof sequenceSchema>>({
    resolver: zodResolver(sequenceSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const stepForm = useForm<z.infer<typeof stepSchema>>({
    resolver: zodResolver(stepSchema),
    defaultValues: {
      trigger: "no_reply",
      delayDays: 1,
      delayHours: 0,
      subject: "",
      content: "",
    },
  });

  const createSequenceMutation = useMutation({
    mutationFn: async (data: z.infer<typeof sequenceSchema>) => {
      const response = await apiRequest("POST", "/api/followup-sequences", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/followup-sequences"] });
      toast({
        title: "Success",
        description: "Follow-up sequence created successfully",
      });
      setIsCreateDialogOpen(false);
      sequenceForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create follow-up sequence",
        variant: "destructive",
      });
    },
  });

  const createStepMutation = useMutation({
    mutationFn: async (data: z.infer<typeof stepSchema>) => {
      const response = await apiRequest("POST", "/api/followup-steps", {
        ...data,
        sequenceId: selectedSequence,
        stepNumber: (steps?.length || 0) + 1,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/followup-sequences", selectedSequence, "steps"] });
      toast({
        title: "Success",
        description: "Follow-up step created successfully",
      });
      setIsStepDialogOpen(false);
      stepForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create follow-up step",
        variant: "destructive",
      });
    },
  });

  const onCreateSequence = (data: z.infer<typeof sequenceSchema>) => {
    createSequenceMutation.mutate(data);
  };

  const onCreateStep = (data: z.infer<typeof stepSchema>) => {
    createStepMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Follow-up Sequences</h2>
          <p className="text-slate-600">Automate your email follow-ups with smart triggers</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Sequence
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Follow-up Sequence</DialogTitle>
              <DialogDescription>
                Create a new automated follow-up sequence for your campaigns.
              </DialogDescription>
            </DialogHeader>
            <Form {...sequenceForm}>
              <form onSubmit={sequenceForm.handleSubmit(onCreateSequence)} className="space-y-4">
                <FormField
                  control={sequenceForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sequence Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Cold Outreach Follow-up" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={sequenceForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe when to use this sequence..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end space-x-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSequenceMutation.isPending}>
                    {createSequenceMutation.isPending ? "Creating..." : "Create Sequence"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sequences List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Your Sequences</h3>
          {sequences && sequences.length > 0 ? (
            sequences.map((sequence) => (
              <Card
                key={sequence.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedSequence === sequence.id ? "ring-2 ring-blue-500 border-blue-200" : ""
                }`}
                onClick={() => setSelectedSequence(sequence.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{sequence.name}</CardTitle>
                    <Badge variant={sequence.isActive ? "default" : "secondary"}>
                      {sequence.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {sequence.description && (
                    <CardDescription className="text-sm">{sequence.description}</CardDescription>
                  )}
                </CardHeader>
              </Card>
            ))
          ) : (
            <Card className="text-center py-8">
              <CardContent>
                <p className="text-slate-600 mb-4">No follow-up sequences yet</p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Sequence
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Steps List */}
        <div className="space-y-4">
          {selectedSequence ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Sequence Steps</h3>
                <Dialog open={isStepDialogOpen} onOpenChange={setIsStepDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Step
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Add Follow-up Step</DialogTitle>
                      <DialogDescription>
                        Configure when and how this follow-up should be triggered.
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...stepForm}>
                      <form onSubmit={stepForm.handleSubmit(onCreateStep)} className="space-y-4">
                        <FormField
                          control={stepForm.control}
                          name="trigger"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Trigger Condition</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select trigger condition" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="no_reply">No Reply After Delay</SelectItem>
                                  <SelectItem value="no_open">No Open After Delay</SelectItem>
                                  <SelectItem value="no_click">No Click After Delay</SelectItem>
                                  <SelectItem value="opened">Email Opened</SelectItem>
                                  <SelectItem value="clicked">Link Clicked</SelectItem>
                                  <SelectItem value="time_delay">Time Delay Only</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Choose when this follow-up should be triggered
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={stepForm.control}
                            name="delayDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Delay (Days)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" max="30" {...field} onChange={e => field.onChange(+e.target.value)} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={stepForm.control}
                            name="delayHours"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Delay (Hours)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" max="23" {...field} onChange={e => field.onChange(+e.target.value)} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={stepForm.control}
                          name="subject"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email Subject</FormLabel>
                              <FormControl>
                                <Input placeholder="Follow-up: Re: {{originalSubject}}" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={stepForm.control}
                          name="content"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email Content</FormLabel>
                              <FormControl>
                                <Textarea
                                  rows={6}
                                  placeholder="Hi {firstName}, I wanted to follow up on my previous email about..."
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                Use {`{{firstName}}`}, {`{{lastName}}`}, {`{{company}}`} for personalization
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex justify-end space-x-2 pt-4">
                          <Button type="button" variant="outline" onClick={() => setIsStepDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={createStepMutation.isPending}>
                            {createStepMutation.isPending ? "Creating..." : "Add Step"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {steps && steps.length > 0 ? (
                <div className="space-y-3">
                  {steps
                    .sort((a, b) => a.stepNumber - b.stepNumber)
                    .map((step, index) => (
                      <Card key={step.id}>
                        <CardContent className="pt-4">
                          <div className="flex items-start space-x-3">
                            <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full">
                              <span className="text-sm font-medium text-blue-600">{step.stepNumber}</span>
                            </div>
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center space-x-2">
                                {getTriggerIcon(step.trigger)}
                                <span className="font-medium text-slate-900">
                                  {getTriggerLabel(step.trigger)}
                                </span>
                                <Badge variant="outline">
                                  {step.delayDays}d {step.delayHours}h delay
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-600 font-medium">{step.subject}</p>
                              <p className="text-sm text-slate-500 line-clamp-2">{step.content}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              ) : (
                <Card className="text-center py-8">
                  <CardContent>
                    <p className="text-slate-600 mb-4">No steps configured</p>
                    <Button size="sm" onClick={() => setIsStepDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Step
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="text-center py-12">
              <CardContent>
                <Mail className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600">Select a sequence to view and manage its steps</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}