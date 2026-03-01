import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, Zap, Shield, Globe } from "lucide-react";

const schedulingSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timeZone: z.string().default("UTC"),
  sendDays: z.array(z.string()).min(1, "Select at least one sending day"),
  emailDelaySeconds: z.number().min(1).max(3600),
  maxEmailsPerHour: z.number().min(1).max(1000),
  scheduledAt: z.string().optional(),
});

type SchedulingFormData = z.infer<typeof schedulingSchema>;

interface SchedulingFormProps {
  initialData?: Partial<SchedulingFormData>;
  onSubmit: (data: SchedulingFormData) => void;
  onCancel?: () => void;
}

const DAYS_OF_WEEK = [
  { id: 'monday', label: 'Monday', short: 'Mon' },
  { id: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { id: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { id: 'thursday', label: 'Thursday', short: 'Thu' },
  { id: 'friday', label: 'Friday', short: 'Fri' },
  { id: 'saturday', label: 'Saturday', short: 'Sat' },
  { id: 'sunday', label: 'Sunday', short: 'Sun' },
];

const POPULAR_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (US)', offset: 'UTC-5/-4' },
  { value: 'America/Chicago', label: 'Central Time (US)', offset: 'UTC-6/-5' },
  { value: 'America/Denver', label: 'Mountain Time (US)', offset: 'UTC-7/-6' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)', offset: 'UTC-8/-7' },
  { value: 'Europe/London', label: 'London Time (UK)', offset: 'UTC+0/+1' },
  { value: 'Europe/Paris', label: 'Central European Time', offset: 'UTC+1/+2' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time', offset: 'UTC+9' },
  { value: 'Asia/Kolkata', label: 'India Standard Time', offset: 'UTC+5:30' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time', offset: 'UTC+10/+11' },
  { value: 'UTC', label: 'Coordinated Universal Time', offset: 'UTC+0' }
];

const DELAY_PRESETS = [
  { seconds: 30, label: '30 seconds', description: 'Safe for most providers' },
  { seconds: 60, label: '1 minute', description: 'Conservative approach' },
  { seconds: 120, label: '2 minutes', description: 'Very safe, slower sending' },
  { seconds: 300, label: '5 minutes', description: 'Maximum safety' },
];

const HOURLY_RATE_PRESETS = [
  { rate: 50, label: '50/hour', description: 'Conservative rate' },
  { rate: 100, label: '100/hour', description: 'Balanced approach' },
  { rate: 200, label: '200/hour', description: 'Aggressive but safe' },
  { rate: 300, label: '300/hour', description: 'High volume' },
];

export function SchedulingForm({ initialData, onSubmit, onCancel }: SchedulingFormProps) {
  const [selectedDelayPreset, setSelectedDelayPreset] = useState<number | null>(null);
  const [selectedRatePreset, setSelectedRatePreset] = useState<number | null>(null);

  const form = useForm<SchedulingFormData>({
    resolver: zodResolver(schedulingSchema),
    defaultValues: {
      startTime: initialData?.startTime || "09:00",
      endTime: initialData?.endTime || "17:00",
      timeZone: initialData?.timeZone || "UTC",
      sendDays: initialData?.sendDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      emailDelaySeconds: initialData?.emailDelaySeconds || 30,
      maxEmailsPerHour: initialData?.maxEmailsPerHour || 100,
      scheduledAt: initialData?.scheduledAt || "",
    },
  });

  const handleSubmit = (data: SchedulingFormData) => {
    onSubmit(data);
  };

  const handleDelayPresetClick = (seconds: number) => {
    form.setValue("emailDelaySeconds", seconds);
    setSelectedDelayPreset(seconds);
  };

  const handleRatePresetClick = (rate: number) => {
    form.setValue("maxEmailsPerHour", rate);
    setSelectedRatePreset(rate);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Time Zone and Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Globe className="h-5 w-5" />
              <span>Time Zone & Schedule</span>
            </CardTitle>
            <CardDescription>
              Configure when your emails should be sent based on your local time
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="timeZone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time Zone</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select your time zone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {POPULAR_TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          <div>
                            <div className="font-medium">{tz.label}</div>
                            <div className="text-sm text-slate-500">{tz.offset}</div>
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
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormDescription>
                      Earliest time to send emails
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormDescription>
                      Latest time to send emails
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="sendDays"
              render={() => (
                <FormItem>
                  <FormLabel>Sending Days</FormLabel>
                  <div className="grid grid-cols-4 gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <FormField
                        key={day.id}
                        control={form.control}
                        name="sendDays"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={day.id}
                              className="flex flex-row items-center space-x-2 space-y-0"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(day.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, day.id])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== day.id
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal">
                                {day.short}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormDescription>
                    Select the days when emails can be sent
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Email Rate & Cadence */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Zap className="h-5 w-5" />
              <span>Email Rate & Cadence</span>
            </CardTitle>
            <CardDescription>
              Control the sending speed to avoid spam filters and maintain good reputation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <FormField
                control={form.control}
                name="emailDelaySeconds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delay Between Emails (seconds)</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="1" 
                        max="3600"
                        {...field}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                          setSelectedDelayPreset(null);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Minimum time between sending each email
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-2 mt-3">
                {DELAY_PRESETS.map((preset) => (
                  <button
                    key={preset.seconds}
                    type="button"
                    className={`p-3 text-left rounded-lg border text-sm transition-colors ${
                      selectedDelayPreset === preset.seconds || form.watch('emailDelaySeconds') === preset.seconds
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    onClick={() => handleDelayPresetClick(preset.seconds)}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="text-slate-500">{preset.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <FormField
                control={form.control}
                name="maxEmailsPerHour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum Emails Per Hour</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="1" 
                        max="1000"
                        {...field}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                          setSelectedRatePreset(null);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Overall hourly sending limit
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-2 mt-3">
                {HOURLY_RATE_PRESETS.map((preset) => (
                  <button
                    key={preset.rate}
                    type="button"
                    className={`p-3 text-left rounded-lg border text-sm transition-colors ${
                      selectedRatePreset === preset.rate || form.watch('maxEmailsPerHour') === preset.rate
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    onClick={() => handleRatePresetClick(preset.rate)}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="text-slate-500">{preset.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Optional Scheduled Start */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <span>Campaign Start</span>
            </CardTitle>
            <CardDescription>
              Optionally schedule when this campaign should begin
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="scheduledAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scheduled Start Time (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Leave empty to start immediately (within sending window)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-blue-700">
              <Shield className="h-5 w-5" />
              <span>Sending Summary</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span>Time Zone:</span>
              <Badge variant="outline">{form.watch('timeZone')}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Sending Window:</span>
              <Badge variant="outline">
                {form.watch('startTime')} - {form.watch('endTime')}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Active Days:</span>
              <Badge variant="outline">
                {form.watch('sendDays')?.length || 0} days/week
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Email Delay:</span>
              <Badge variant="outline">{form.watch('emailDelaySeconds')}s</Badge>
            </div>
            <div className="flex justify-between">
              <span>Max Rate:</span>
              <Badge variant="outline">{form.watch('maxEmailsPerHour')}/hour</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Form Actions */}
        <div className="flex justify-end space-x-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Apply Scheduling Settings
          </button>
        </div>
      </form>
    </Form>
  );
}