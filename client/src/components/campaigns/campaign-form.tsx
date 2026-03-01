import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecipientSelector } from "./recipient-selector";
import { FileSpreadsheet } from "lucide-react";
import type { EmailTemplate, ContactSegment, EmailAccount, LlmConfiguration, FollowupSequence } from "@/types";

const campaignSchema = z.object({
  name: z.string().min(1, "Campaign name is required"),
  description: z.string().optional(),
  templateId: z.string().min(1, "Template is required"),
  segmentId: z.string().min(1, "Segment is required"),
  emailAccountId: z.string().min(1, "Email account is required"),
  llmConfigId: z.string().optional(),
  followupSequenceId: z.string().optional(),
  scheduledAt: z.string().optional(),
  
  // Advanced scheduling
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timeZone: z.string().default("UTC"),
  sendDays: z.array(z.string()).default(["monday", "tuesday", "wednesday", "thursday", "friday"]),
  emailDelaySeconds: z.number().default(30),
  maxEmailsPerHour: z.number().default(100),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

interface CampaignFormProps {
  onSuccess?: () => void;
}

export function CampaignForm({ onSuccess }: CampaignFormProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [showRecipientSelector, setShowRecipientSelector] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<any[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: templates } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/templates"],
  });

  const { data: followupSequences } = useQuery<FollowupSequence[]>({
    queryKey: ["/api/followup-sequences"],
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: "",
      description: "",
      templateId: "",
      segmentId: "",
      emailAccountId: "",
      llmConfigId: "",
      followupSequenceId: "",
      scheduledAt: "",
      startTime: "09:00",
      endTime: "17:00",
      timeZone: "UTC",
      sendDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      emailDelaySeconds: 30,
      maxEmailsPerHour: 100,
    },
  });

  // Get steps for selected follow-up sequence
  const selectedFollowupId = watch("followupSequenceId");
  const { data: followupSteps } = useQuery<any[]>({
    queryKey: ["/api/followup-sequences", selectedFollowupId, "steps"],
    enabled: !!selectedFollowupId,
  });

  const { data: segments } = useQuery<ContactSegment[]>({
    queryKey: ["/api/segments"],
    queryFn: async () => {
      // For now, return empty array as segments endpoint doesn't exist yet
      return [];
    },
  });

  const { data: emailAccounts } = useQuery<EmailAccount[]>({
    queryKey: ["/api/email-accounts"],
  });

  const { data: llmConfigs } = useQuery<LlmConfiguration[]>({
    queryKey: ["/api/llm-configs"],
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (data: CampaignFormData) => {
      const response = await apiRequest("POST", "/api/campaigns", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({
        title: "Success",
        description: "Campaign created successfully",
      });
      onSuccess?.();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create campaign",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CampaignFormData) => {
    createCampaignMutation.mutate(data);
  };

  const selectedTemplate = templates?.find(t => t.id === watch("templateId"));
  const selectedSegment = segments?.find(s => s.id === watch("segmentId"));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="template">Template</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Campaign Name *</Label>
                <Input
                  id="name"
                  {...register("name")}
                  placeholder="e.g., Q1 Product Launch Outreach"
                />
                {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...register("description")}
                  placeholder="Brief description of your campaign goals..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="template" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Select Email Template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Template *</Label>
                <Select onValueChange={(value) => setValue("templateId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an email template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates?.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div>
                          <div className="font-medium">{template.name}</div>
                          {template.category && (
                            <div className="text-sm text-slate-500 capitalize">{template.category}</div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.templateId && <p className="text-sm text-red-600">{errors.templateId.message}</p>}
              </div>
              
              {selectedTemplate && (
                <div className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-900 mb-2">Template Preview</h4>
                  <div className="text-sm space-y-2">
                    <div>
                      <span className="font-medium">Subject: </span>
                      <span className="text-slate-700">{selectedTemplate.subject}</span>
                    </div>
                    <div>
                      <span className="font-medium">Content Preview: </span>
                      <p className="text-slate-700 line-clamp-3">
                        {selectedTemplate.content.substring(0, 200)}...
                      </p>
                    </div>
                    {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                      <div>
                        <span className="font-medium">Variables: </span>
                        <span className="text-slate-600">
                          {selectedTemplate.variables.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audience" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Target Audience</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label>Contact Segment *</Label>
                  <Select onValueChange={(value) => setValue("segmentId", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a contact segment" />
                    </SelectTrigger>
                    <SelectContent>
                      {(segments || []).map((segment) => (
                        <SelectItem key={segment.id} value={segment.id}>
                          <div>
                            <div className="font-medium">{segment.name}</div>
                            <div className="text-sm text-slate-500">
                              {segment.contactCount} contacts
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.segmentId && <p className="text-sm text-red-600">{errors.segmentId.message}</p>}
                </div>
                <div className="flex flex-col justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowRecipientSelector(true)}
                    className="whitespace-nowrap"
                    data-testid="button-select-recipients"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Select recipients
                  </Button>
                </div>
              </div>
              
              {selectedRecipients.length > 0 && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="font-medium text-green-900 mb-2">Imported Recipients</h4>
                  <p className="text-sm text-green-700">
                    {selectedRecipients.length} contacts imported from Google Sheets
                  </p>
                </div>
              )}
              

              {selectedSegment && (
                <div className="p-4 bg-slate-50 rounded-lg">
                  <h4 className="font-medium text-slate-900 mb-2">Segment Details</h4>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="font-medium">Name: </span>
                      <span className="text-slate-700">{selectedSegment.name}</span>
                    </div>
                    <div>
                      <span className="font-medium">Contacts: </span>
                      <span className="text-slate-700">{selectedSegment.contactCount}</span>
                    </div>
                    {selectedSegment.description && (
                      <div>
                        <span className="font-medium">Description: </span>
                        <span className="text-slate-700">{selectedSegment.description}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="followups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Follow-up Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Follow-up Sequence</Label>
                <Select onValueChange={(value) => setValue("followupSequenceId", value)}>
                  <SelectTrigger data-testid="select-followup-sequence">
                    <SelectValue placeholder="Select a follow-up sequence" />
                  </SelectTrigger>
                  <SelectContent>
                    {followupSequences?.map((sequence) => (
                      <SelectItem key={sequence.id} value={sequence.id}>
                        <div>
                          <div className="font-medium">{sequence.name}</div>
                          {sequence.description && (
                            <div className="text-sm text-slate-500">{sequence.description}</div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-slate-500 mt-1">
                  Automated follow-ups based on recipient actions and timing
                </p>
              </div>

              {watch("followupSequenceId") && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Follow-up Preview</h4>
                  <p className="text-sm text-blue-700 mb-3">
                    This sequence will automatically send follow-up emails based on recipient behavior:
                  </p>
                  <div className="space-y-2 text-sm">
                    {followupSteps?.length ? (
                      followupSteps.map((step: any, index: number) => (
                        <div key={step.id} className="flex items-center space-x-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                          <span>
                            {step.trigger === 'no_reply' ? 'No reply' : 
                             step.trigger === 'no_open' ? 'No open' : 
                             step.trigger === 'time_delay' ? 'Time delay' : 
                             step.trigger} after {step.delayDays} days
                            {step.delayHours > 0 && ` ${step.delayHours} hours`} → 
                            {step.subject || `Follow-up ${index + 1}`}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span>Loading follow-up steps...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!followupSequences?.length && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h4 className="font-medium text-yellow-900 mb-2">No Follow-up Sequences</h4>
                  <p className="text-sm text-yellow-700 mb-3">
                    Create follow-up sequences to automatically nurture leads based on their engagement.
                  </p>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      // Navigate to follow-up sequences page
                      window.location.href = '/followup-sequences';
                    }}
                  >
                    Create Follow-up Sequence
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduling" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Smart Scheduling & Rate Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Time Zone</Label>
                  <Select onValueChange={(value) => setValue("timeZone", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC (Coordinated Universal Time)</SelectItem>
                      <SelectItem value="America/New_York">Eastern Time (US)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (US)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (US)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time (US)</SelectItem>
                      <SelectItem value="Europe/London">London Time (UK)</SelectItem>
                      <SelectItem value="Europe/Paris">Central European Time</SelectItem>
                      <SelectItem value="Asia/Tokyo">Japan Standard Time</SelectItem>
                      <SelectItem value="Asia/Kolkata">India Standard Time</SelectItem>
                      <SelectItem value="Australia/Sydney">Australian Eastern Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="startTime">Start Time</Label>
                  <Input
                    id="startTime"
                    type="time"
                    {...register("startTime")}
                  />
                  <p className="text-xs text-slate-500 mt-1">Earliest sending time</p>
                </div>
                
                <div>
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    {...register("endTime")}
                  />
                  <p className="text-xs text-slate-500 mt-1">Latest sending time</p>
                </div>
              </div>

              <div>
                <Label>Sending Days</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => (
                    <label key={day} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        value={day}
                        defaultChecked={["monday", "tuesday", "wednesday", "thursday", "friday"].includes(day)}
                        onChange={(e) => {
                          const currentDays = watch("sendDays") || [];
                          if (e.target.checked) {
                            setValue("sendDays", [...currentDays, day]);
                          } else {
                            setValue("sendDays", currentDays.filter(d => d !== day));
                          }
                        }}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm capitalize">{day}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">Select days when emails can be sent</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="emailDelaySeconds">Email Delay (seconds)</Label>
                  <Input
                    id="emailDelaySeconds"
                    type="number"
                    min="1"
                    max="3600"
                    {...register("emailDelaySeconds", { valueAsNumber: true })}
                  />
                  <p className="text-xs text-slate-500 mt-1">Delay between each email</p>
                </div>
                
                <div>
                  <Label htmlFor="maxEmailsPerHour">Max Emails/Hour</Label>
                  <Input
                    id="maxEmailsPerHour"
                    type="number"
                    min="1"
                    max="1000"
                    {...register("maxEmailsPerHour", { valueAsNumber: true })}
                  />
                  <p className="text-xs text-slate-500 mt-1">Overall hourly limit</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">Smart Rate Control</h4>
                <p className="text-sm text-blue-700">
                  Our system automatically adjusts sending rates to avoid spam filters and maintain good sender reputation. 
                  Emails will only be sent during your specified time window and days.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campaign Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Email Account *</Label>
                <Select onValueChange={(value) => setValue("emailAccountId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sending email account" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailAccounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div>
                          <div className="font-medium capitalize">{account.provider}</div>
                          <div className="text-sm text-slate-500">{account.email}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.emailAccountId && <p className="text-sm text-red-600">{errors.emailAccountId.message}</p>}
              </div>

              <div>
                <Label>AI Provider (Optional)</Label>
                <Select onValueChange={(value) => setValue("llmConfigId", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Use default AI provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {llmConfigs?.map((config) => (
                      <SelectItem key={config.id} value={config.id}>
                        <div>
                          <div className="font-medium capitalize">{config.provider} - {config.model}</div>
                          {config.isPrimary && (
                            <div className="text-sm text-green-600">Primary Provider</div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              <div>
                <Label>Schedule (Optional)</Label>
                <Input
                  type="datetime-local"
                  {...register("scheduledAt")}
                  className="block"
                />
                <p className="text-sm text-slate-500 mt-1">
                  Leave empty to start campaign immediately
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex space-x-2">
          {activeTab !== "basic" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const tabs = ["basic", "template", "audience", "followups", "scheduling", "settings"];
                const currentIndex = tabs.indexOf(activeTab);
                if (currentIndex > 0) {
                  setActiveTab(tabs[currentIndex - 1]);
                }
              }}
            >
              Previous
            </Button>
          )}
          {activeTab !== "settings" && (
            <Button
              type="button"
              onClick={() => {
                const tabs = ["basic", "template", "audience", "followups", "scheduling", "settings"];
                const currentIndex = tabs.indexOf(activeTab);
                if (currentIndex < tabs.length - 1) {
                  setActiveTab(tabs[currentIndex + 1]);
                }
              }}
            >
              Next
            </Button>
          )}
        </div>
        
        {activeTab === "settings" && (
          <div className="space-x-2">
            <Button type="button" variant="outline">
              Save as Draft
            </Button>
            <Button 
              type="submit" 
              className="bg-primary hover:bg-blue-700"
              disabled={createCampaignMutation.isPending}
            >
              {createCampaignMutation.isPending ? "Creating..." : "Create Campaign"}
            </Button>
          </div>
        )}
      </div>

      <RecipientSelector
        open={showRecipientSelector}
        onOpenChange={setShowRecipientSelector}
        onRecipientsSelected={(recipients) => {
          setSelectedRecipients(recipients);
          // Optionally create a temporary segment for these recipients
        }}
        emailAccounts={emailAccounts || []}
      />
    </form>
  );
}
