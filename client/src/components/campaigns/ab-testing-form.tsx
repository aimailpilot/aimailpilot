import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TestTube, BarChart3, Users, Target } from "lucide-react";

const abTestSchema = z.object({
  enabled: z.boolean().default(false),
  testType: z.enum(["subject", "content", "sender", "timing"]).default("subject"),
  splitPercentage: z.number().min(10).max(90).default(50),
  winnerCriteria: z.enum(["open_rate", "click_rate", "reply_rate", "conversion"]).default("open_rate"),
  testDuration: z.number().min(1).max(7).default(24), // hours
  variants: z.array(z.object({
    name: z.string(),
    subject: z.string().optional(),
    content: z.string().optional(),
    senderName: z.string().optional(),
    sendTime: z.string().optional(),
  })).min(2).max(5),
});

type ABTestFormData = z.infer<typeof abTestSchema>;

interface ABTestingFormProps {
  initialData?: Partial<ABTestFormData>;
  onSubmit: (data: ABTestFormData) => void;
  onCancel?: () => void;
}

const TEST_TYPES = [
  {
    value: "subject",
    label: "Subject Line",
    description: "Test different subject lines to improve open rates",
    icon: TestTube
  },
  {
    value: "content",
    label: "Email Content", 
    description: "Test different email content variations",
    icon: BarChart3
  },
  {
    value: "sender",
    label: "Sender Name",
    description: "Test different sender names for better recognition",
    icon: Users
  },
  {
    value: "timing",
    label: "Send Timing",
    description: "Test different sending times for optimal engagement",
    icon: Target
  }
];

const WINNER_CRITERIA = [
  { value: "open_rate", label: "Open Rate", description: "Highest percentage of emails opened" },
  { value: "click_rate", label: "Click Rate", description: "Highest percentage of links clicked" },
  { value: "reply_rate", label: "Reply Rate", description: "Highest percentage of replies received" },
  { value: "conversion", label: "Conversion", description: "Highest conversion to desired action" },
];

export function ABTestingForm({ initialData, onSubmit, onCancel }: ABTestingFormProps) {
  const [testType, setTestType] = useState(initialData?.testType || "subject");
  const [variants, setVariants] = useState(initialData?.variants || [
    { name: "Variant A", subject: "", content: "", senderName: "", sendTime: "" },
    { name: "Variant B", subject: "", content: "", senderName: "", sendTime: "" }
  ]);

  const form = useForm<ABTestFormData>({
    resolver: zodResolver(abTestSchema),
    defaultValues: {
      enabled: initialData?.enabled || false,
      testType: initialData?.testType || "subject",
      splitPercentage: initialData?.splitPercentage || 50,
      winnerCriteria: initialData?.winnerCriteria || "open_rate",
      testDuration: initialData?.testDuration || 24,
      variants: variants,
    },
  });

  const handleSubmit = (data: ABTestFormData) => {
    onSubmit({ ...data, variants });
  };

  const addVariant = () => {
    if (variants.length < 5) {
      const newVariants = [...variants, {
        name: `Variant ${String.fromCharCode(65 + variants.length)}`,
        subject: "",
        content: "",
        senderName: "",
        sendTime: ""
      }];
      setVariants(newVariants);
      form.setValue("variants", newVariants);
    }
  };

  const removeVariant = (index: number) => {
    if (variants.length > 2) {
      const newVariants = variants.filter((_, i) => i !== index);
      setVariants(newVariants);
      form.setValue("variants", newVariants);
    }
  };

  const updateVariant = (index: number, field: string, value: string) => {
    const newVariants = [...variants];
    newVariants[index] = { ...newVariants[index], [field]: value };
    setVariants(newVariants);
    form.setValue("variants", newVariants);
  };

  const isEnabled = form.watch("enabled");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TestTube className="h-5 w-5" />
              <span>A/B Testing Configuration</span>
            </CardTitle>
            <CardDescription>
              Test different variations of your email campaign to optimize performance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable A/B Testing</FormLabel>
                    <FormDescription>
                      Split your audience and test different variations automatically
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {isEnabled && (
              <>
                <FormField
                  control={form.control}
                  name="testType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Test Type</FormLabel>
                      <Select onValueChange={(value) => {
                        field.onChange(value);
                        setTestType(value as any);
                      }} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select what to test" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TEST_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              <div className="flex items-center space-x-2">
                                <type.icon className="h-4 w-4" />
                                <div>
                                  <div className="font-medium">{type.label}</div>
                                  <div className="text-sm text-slate-500">{type.description}</div>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="splitPercentage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Traffic Split (%)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="10"
                            max="90"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          Percentage for Variant A (remaining goes to Variant B)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="testDuration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Test Duration (hours)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            max="168"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          How long to run the test before declaring a winner
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="winnerCriteria"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Winner Criteria</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="How to determine the winner" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {WINNER_CRITERIA.map((criteria) => (
                            <SelectItem key={criteria.value} value={criteria.value}>
                              <div>
                                <div className="font-medium">{criteria.label}</div>
                                <div className="text-sm text-slate-500">{criteria.description}</div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-medium">Test Variants</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addVariant}
                      disabled={variants.length >= 5}
                    >
                      Add Variant
                    </Button>
                  </div>

                  <div className="grid gap-4">
                    {variants.map((variant, index) => (
                      <Card key={index} className="p-4">
                        <div className="flex items-center justify-between mb-4">
                          <Badge variant="outline">{variant.name}</Badge>
                          {variants.length > 2 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeVariant(index)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Remove
                            </Button>
                          )}
                        </div>

                        {testType === "subject" && (
                          <div>
                            <label className="text-sm font-medium">Subject Line</label>
                            <Input
                              placeholder="Enter subject line for this variant"
                              value={variant.subject || ""}
                              onChange={(e) => updateVariant(index, "subject", e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        )}

                        {testType === "content" && (
                          <div>
                            <label className="text-sm font-medium">Email Content</label>
                            <Textarea
                              placeholder="Enter email content for this variant"
                              value={variant.content || ""}
                              onChange={(e) => updateVariant(index, "content", e.target.value)}
                              rows={4}
                              className="mt-1"
                            />
                          </div>
                        )}

                        {testType === "sender" && (
                          <div>
                            <label className="text-sm font-medium">Sender Name</label>
                            <Input
                              placeholder="Enter sender name for this variant"
                              value={variant.senderName || ""}
                              onChange={(e) => updateVariant(index, "senderName", e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        )}

                        {testType === "timing" && (
                          <div>
                            <label className="text-sm font-medium">Send Time</label>
                            <Input
                              type="time"
                              value={variant.sendTime || ""}
                              onChange={(e) => updateVariant(index, "sendTime", e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">Test Preview</h4>
                  <div className="text-sm text-blue-700 space-y-1">
                    <div>• {form.watch("splitPercentage")}% of recipients will get Variant A</div>
                    <div>• {100 - form.watch("splitPercentage")}% of recipients will get Variant B</div>
                    <div>• Test will run for {form.watch("testDuration")} hours</div>
                    <div>• Winner will be determined by {WINNER_CRITERIA.find(c => c.value === form.watch("winnerCriteria"))?.label}</div>
                    <div>• After test completion, all remaining recipients get the winning variant</div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-3">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit">
            {isEnabled ? "Configure A/B Test" : "Continue Without Testing"}
          </Button>
        </div>
      </form>
    </Form>
  );
}