import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Bold, Italic, Underline, Type, Paperclip, Link, 
  List, ListOrdered, AlignLeft, Code, X, Calendar as CalendarIcon,
  Clock, Settings as SettingsIcon, Eye, Send, ChevronDown, Info,
  FileSpreadsheet, Upload, Users, Copy, Plus, Check, CheckCircle, AlertCircle
} from "lucide-react";
import { ProfessionalEmailEditor } from "./professional-email-editor";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { EmailAccount, EmailTemplate } from "@/types";

interface MailMeteorCampaignFormProps {
  onSuccess?: () => void;
}

export function MailMeteorCampaignForm({ onSuccess }: MailMeteorCampaignFormProps) {
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [recipientList, setRecipientList] = useState("");
  const [scheduleDate, setScheduleDate] = useState<Date>();
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [showAutopilotModal, setShowAutopilotModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState("17:00");
  const [autopilotSettings, setAutopilotSettings] = useState({
    sendOnDays: {
      monday: { enabled: true, startTime: "09:00", endTime: "21:00" },
      tuesday: { enabled: true, startTime: "09:00", endTime: "21:00" },
      wednesday: { enabled: true, startTime: "09:00", endTime: "21:00" },
      thursday: { enabled: true, startTime: "09:00", endTime: "21:00" },
      friday: { enabled: true, startTime: "09:00", endTime: "21:00" },
      saturday: { enabled: false, startTime: "09:00", endTime: "21:00" },
      sunday: { enabled: false, startTime: "09:00", endTime: "21:00" },
    },
    maxEmailsPerDay: 500,
    maxEmailsEnabled: true,
    delayBetweenEmails: 2,
    delayEnabled: true,
  });
  const [trackEmails, setTrackEmails] = useState(true);
  const [unsubscribeLink, setUnsubscribeLink] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [selectedRecipientMethod, setSelectedRecipientMethod] = useState("");
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState("");
  const [selectedSheet, setSelectedSheet] = useState("");
  const [availableSheets, setAvailableSheets] = useState<{id: number, name: string}[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetData, setSheetData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [recipientCount, setRecipientCount] = useState(0);
  const [googleSheetsConnected, setGoogleSheetsConnected] = useState(false);
  const [showGoogleConnectModal, setShowGoogleConnectModal] = useState(false);
  
  // Force localStorage clear on component mount AND every time component shows
  useEffect(() => {
    console.log('🧹 FORCE CLEARING ALL CACHED AUTH DATA...');
    // Clear ALL localStorage data to prevent any cached auth state
    localStorage.clear();
    setGoogleSheetsConnected(false);
    console.log('🧹 ALL CACHE CLEARED - WILL CHECK FRESH AUTH STATUS');
  }, []);

  // Check Google Sheets connection status
  useEffect(() => {
    const checkGoogleSheetsAuth = async () => {
      try {
        console.log('🔍 CHECKING FRESH GOOGLE SHEETS AUTH STATUS...');
        const response = await fetch('/api/auth/google/status', {
          // Force no cache
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        console.log('📡 Auth check response status:', response.status);
        if (response.ok) {
          const data = await response.json();
          console.log('✅ FRESH AUTH STATUS RECEIVED:', data);
          console.log('🔄 Setting googleSheetsConnected to:', data.connected);
          setGoogleSheetsConnected(data.connected);
          
          // DON'T store in localStorage to prevent caching issues
          // Just dispatch event for real-time sync
          window.dispatchEvent(new CustomEvent('googleSheetsConnectionChange', { detail: { connected: data.connected } }));
        } else {
          console.log('❌ AUTH STATUS CHECK FAILED');
          setGoogleSheetsConnected(false);
          window.dispatchEvent(new CustomEvent('googleSheetsConnectionChange', { detail: { connected: false } }));
        }
      } catch (error) {
        console.error('❌ ERROR CHECKING GOOGLE SHEETS AUTH:', error);
        setGoogleSheetsConnected(false);
        window.dispatchEvent(new CustomEvent('googleSheetsConnectionChange', { detail: { connected: false } }));
      }
    };

    console.log('🚀 STARTING FRESH AUTH CHECK...');
    checkGoogleSheetsAuth();
    
    // Check URL parameter for successful connection
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === 'true') {
      // Re-check the actual connection status after redirect
      setTimeout(() => {
        checkGoogleSheetsAuth();
      }, 1000); // Give server more time to process
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Listen for connection changes from other components
    const handleConnectionChange = (event: any) => {
      console.log('Main form: Received connection change event:', event.detail);
      setGoogleSheetsConnected(event.detail.connected);
    };

    window.addEventListener('googleSheetsConnectionChange', handleConnectionChange);

    return () => {
      window.removeEventListener('googleSheetsConnectionChange', handleConnectionChange);
    };
  }, []);

  // Extract spreadsheet ID from URL
  const extractSpreadsheetId = (url: string) => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  };

  // Fetch sheets when URL changes
  React.useEffect(() => {
    const fetchSheets = async () => {
      const spreadsheetId = extractSpreadsheetId(googleSheetsUrl);
      if (!spreadsheetId) {
        setAvailableSheets([]);
        setSelectedSheet("");
        return;
      }

      setSheetsLoading(true);
      try {
        const response = await fetch(`/api/sheets/${spreadsheetId}/info`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const data = await response.json();
          setAvailableSheets(data.sheets || []);
        } else {
          const errorData = await response.json();
          console.error('Error response:', errorData);
          setAvailableSheets([]);
          
          // Show user-friendly error message
          if (response.status === 401) {
            toast({
              title: "Authentication Required",
              description: "Please log in with Google to access your spreadsheets",
              variant: "destructive",
            });
          } else if (response.status === 403) {
            toast({
              title: "Access Denied",
              description: "Please check the sharing settings of your Google Sheet",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Error",
              description: "Failed to load spreadsheet. Please check the URL and try again.",
              variant: "destructive",
            });
          }
        }
      } catch (error) {
        console.error('Error fetching sheets:', error);
        setAvailableSheets([]);
        toast({
          title: "Connection Error",
          description: "Failed to connect to Google Sheets. Please try again.",
          variant: "destructive",
        });
      } finally {
        setSheetsLoading(false);
      }
    };

    if (googleSheetsUrl) {
      const timeoutId = setTimeout(fetchSheets, 500); // Debounce
      return () => clearTimeout(timeoutId);
    } else {
      setAvailableSheets([]);
      setSelectedSheet("");
    }
  }, [googleSheetsUrl]);

  // Load sheet data when sheet is selected
  React.useEffect(() => {
    const loadSheetData = async () => {
      const spreadsheetId = extractSpreadsheetId(googleSheetsUrl);
      if (!spreadsheetId || !selectedSheet) {
        setSheetData([]);
        setRecipientCount(0);
        return;
      }

      setDataLoading(true);
      try {
        const response = await fetch(`/api/sheets/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId,
            sheetName: selectedSheet
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          setSheetData(data.values || []);
          
          // Count recipients (rows with email)
          if (data.values && data.values.length > 1) {
            const headers = data.values[0];
            const emailColumnIndex = headers.findIndex((header: string) => 
              header.toLowerCase().includes('email')
            );
            
            const validRows = data.values.slice(1).filter((row: any[]) => 
              row[emailColumnIndex] && row[emailColumnIndex].includes('@')
            );
            setRecipientCount(validRows.length);
            
            toast({
              title: "Sheet Loaded",
              description: `Found ${validRows.length} recipients in "${selectedSheet}"`,
            });
          } else {
            setRecipientCount(0);
          }
        } else {
          console.error('Error loading sheet data');
          setSheetData([]);
          setRecipientCount(0);
          toast({
            title: "Error",
            description: "Failed to load sheet data. Please try again.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Error loading sheet data:', error);
        setSheetData([]);
        setRecipientCount(0);
      } finally {
        setDataLoading(false);
      }
    };

    if (selectedSheet && googleSheetsUrl) {
      loadSheetData();
    }
  }, [selectedSheet, googleSheetsUrl]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportCSVClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      // Handle CSV file upload
      console.log('CSV file selected:', file.name);
      toast({
        title: "CSV file selected",
        description: `File: ${file.name}`,
      });
    }
  };
  const [followUpEmails, setFollowUpEmails] = useState<Array<{
    id: string;
    subject: string;
    content: string;
    delayDays: number;
    sameThread: boolean;
    condition: 'always' | 'not_opened' | 'not_clicked' | 'clicked';
  }>>([]);
  
  const { toast } = useToast();

  const { data: emailAccounts } = useQuery<EmailAccount[]>({
    queryKey: ["/api/email-accounts"],
  });

  // Set default email account when accounts are loaded
  React.useEffect(() => {
    if (emailAccounts && emailAccounts.length > 0 && !selectedAccount) {
      const defaultAccount = emailAccounts[0];
      setSelectedAccount(defaultAccount.id);
    }
  }, [emailAccounts, selectedAccount]);

  const handleSubmit = async () => {
    if (!subject || !content || !selectedAccount) {
      toast({
        title: "Missing Information",
        description: "Please fill in subject, content, and select an email account",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Convert autopilot settings to campaign format
      const enabledDays = Object.entries(autopilotSettings.sendOnDays)
        .filter(([_, settings]) => settings.enabled)
        .map(([day, _]) => day);
      
      // Calculate email delay in seconds from minutes
      const emailDelaySeconds = autopilotSettings.delayEnabled 
        ? autopilotSettings.delayBetweenEmails * 60 
        : 30; // Default 30 seconds
      
      // Calculate max emails per hour from daily limit
      const maxEmailsPerHour = autopilotSettings.maxEmailsEnabled
        ? Math.min(Math.floor(autopilotSettings.maxEmailsPerDay / 8), 1000) // Spread across 8 hours
        : 100; // Default 100 per hour

      const campaignData = {
        name: subject, // Use subject as campaign name
        subject,
        content,
        emailAccountId: selectedAccount,
        status: 'draft',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        scheduledAt: scheduleDate?.toISOString(),
        // Autopilot scheduling settings
        sendDays: enabledDays,
        startTime: autopilotSettings.sendOnDays.monday.startTime, // Use monday as default
        endTime: autopilotSettings.sendOnDays.monday.endTime,
        emailDelaySeconds,
        maxEmailsPerHour,
        timeZone: 'UTC',
        // Additional settings
        trackEmails,
        unsubscribeLink,
        autopilotEnabled,
        googleSheetsUrl: googleSheetsUrl || undefined,
        recipientMethod: selectedRecipientMethod,
        followUpEmails: followUpEmails.map(followUp => ({
          ...followUp,
          // Ensure threading logic: same subject = same thread, different subject = new thread
          threadId: followUp.sameThread ? 'main-thread' : `thread-${followUp.id}`
        }))
      };

      await apiRequest("POST", "/api/campaigns", campaignData);
      
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      
      toast({
        title: "Campaign Created",
        description: "Your campaign has been created successfully",
      });
      
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create campaign. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Main Composer */}
      <div className="flex-1 p-6 space-y-6">
        {/* From Field - MailMeteor Style */}
        <div className="flex items-center space-x-4">
          <Label className="text-sm text-gray-700 w-16">From</Label>
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="flex-1" data-testid="select-from">
              <SelectValue>
                {selectedAccount && emailAccounts && (() => {
                  const account = emailAccounts.find(acc => acc.id === selectedAccount);
                  return account ? `${account.email} <${account.email}>` : "Select sender email";
                })()}
              </SelectValue>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </SelectTrigger>
            <SelectContent>
              {emailAccounts?.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex items-center space-x-2">
                    <span>{account.email}</span>
                    <span className="text-gray-500 text-sm">&lt;{account.email}&gt;</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* To Field - MailMeteor Style */}
        <div className="flex items-center space-x-4">
          <Label className="text-sm text-gray-700 w-16">To</Label>
          <div className="flex-1 flex items-center space-x-2">
            {recipientCount > 0 ? (
              <div className="flex items-center space-x-2">
                <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-md text-sm font-medium">
                  {recipientCount} recipients
                </span>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowRecipientModal(true)}
                  className="text-blue-600 hover:text-blue-700"
                  data-testid="button-edit-recipients"
                >
                  Edit
                </Button>
              </div>
            ) : (
              <Button 
                variant="outline" 
                className="w-full justify-start text-left h-10 text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={() => setShowRecipientModal(true)}
                data-testid="button-select-recipients"
              >
                Select recipients
              </Button>
            )}
          </div>
        </div>

        {/* Subject Field - MailMeteor Style */}
        <div className="flex items-center space-x-4">
          <Label className="text-sm text-gray-700 w-16">Subject</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter your email subject"
            className="flex-1"
            data-testid="input-subject"
          />
        </div>

        {/* MailMeteor-style Email Editor */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <ProfessionalEmailEditor
            content={content}
            onChange={setContent}
            placeholder="Enter your email content here..."
            minHeight="300px"
            className="border-0 rounded-none"
          />
            
          {/* MailMeteor Follow-up Button - Exact styling */}
          <div className="flex justify-center py-6 bg-white border-t border-gray-100">
            <Button 
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium"
              onClick={() => {
                const newFollowUp = {
                  id: `followup-${Date.now()}`,
                  subject: subject,
                  content: "",
                  delayDays: 3,
                  sameThread: true,
                  condition: 'not_opened' as const
                };
                setFollowUpEmails(prev => [...prev, newFollowUp]);
              }}
              data-testid="button-add-followup"
            >
              Add a follow-up email
            </Button>
          </div>
        </div>

        {/* Inline Follow-up Emails */}
        {followUpEmails.map((followUp, index) => (
          <div key={followUp.id} className="mt-6 border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Follow-up email #{index + 1}</h3>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setFollowUpEmails(prev => prev.filter(f => f.id !== followUp.id));
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Subject */}
            <div className="mb-4">
              <Label className="text-sm text-gray-600">Subject</Label>
              <Input
                value={followUp.subject}
                onChange={(e) => {
                  const newSubject = e.target.value;
                  const sameAsOriginal = newSubject === subject;
                  setFollowUpEmails(prev => prev.map(f => 
                    f.id === followUp.id 
                      ? { ...f, subject: newSubject, sameThread: sameAsOriginal }
                      : f
                  ));
                }}
                placeholder="Follow-up subject"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">
                {followUp.sameThread 
                  ? "✓ Will continue same email thread" 
                  : "⚠ Will start new email thread (different subject)"}
              </p>
            </div>

            {/* MailMeteor-style Condition Bar - Above Editor */}
            <div className="bg-gray-50 border border-gray-200 rounded-t-lg p-3 border-b-0">
              <div className="flex items-center space-x-2 text-sm">
                <Select 
                  value={followUp.condition}
                  onValueChange={(value) => {
                    setFollowUpEmails(prev => prev.map(f => 
                      f.id === followUp.id 
                        ? { ...f, condition: value as any }
                        : f
                    ));
                  }}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_opened">If no reply</SelectItem>
                    <SelectItem value="not_clicked">If no click</SelectItem>
                    <SelectItem value="always">No matter what</SelectItem>
                  </SelectContent>
                </Select>
                
                <span className="text-gray-600">after</span>
                
                <Input
                  type="number"
                  value={followUp.delayDays}
                  className="w-12 h-8 text-center text-xs"
                  min="1"
                  onChange={(e) => {
                    setFollowUpEmails(prev => prev.map(f => 
                      f.id === followUp.id 
                        ? { ...f, delayDays: parseInt(e.target.value) || 1 }
                        : f
                    ));
                  }}
                />
                
                <span className="text-gray-600">days</span>
                
                <Button 
                  className="bg-gray-700 hover:bg-gray-800 text-white text-xs h-8 px-3"
                  size="sm"
                >
                  send this email
                </Button>
              </div>
            </div>
            
            {/* Content Editor - Connects to condition bar */}
            <div className="border border-gray-200 rounded-b-lg border-t-0">
              <ProfessionalEmailEditor
                content={followUp.content}
                onChange={(newContent) => {
                  setFollowUpEmails(prev => prev.map(f => 
                    f.id === followUp.id 
                      ? { ...f, content: newContent }
                      : f
                  ));
                }}
                placeholder="Enter follow-up email content..."
                minHeight="200px"
                className="border-0 rounded-none rounded-b-lg"
              />
            </div>
          </div>
        ))}

        {/* Bottom Actions */}
        <div className="flex items-center justify-between pt-4">
          <Button 
            variant="outline" 
            onClick={() => setShowPreview(true)}
            data-testid="button-preview"
          >
            <Eye className="h-4 w-4 mr-2" />
            Show preview
          </Button>
          
          <div className="flex space-x-3">
            <Button variant="outline" onClick={onSuccess}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-send-emails"
            >
              <Send className="h-4 w-4 mr-2" />
              {recipientCount > 0 ? `Send ${recipientCount} emails` : "Send emails"}
            </Button>
          </div>
        </div>
      </div>

      {/* Settings Sidebar - MailMeteor exact copy */}
      <div className="w-80 bg-white border-l border-gray-200 p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Settings</h3>
          
          {/* Schedule send */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-gray-700">Schedule send</Label>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowScheduleModal(true)}
                data-testid="button-schedule"
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Autopilot */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Label className="text-sm text-gray-700">Autopilot</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowAutopilotModal(true)}
                  data-testid="button-autopilot-info"
                >
                  <Info className="h-3 w-3 text-gray-400" />
                </Button>
              </div>
              <Switch 
                checked={autopilotEnabled}
                onCheckedChange={setAutopilotEnabled}
                data-testid="switch-autopilot"
              />
            </div>
            
            {/* Track emails */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Label className="text-sm text-gray-700">Track emails</Label>
                <Button variant="ghost" size="sm">
                  <Info className="h-3 w-3 text-gray-400" />
                </Button>
              </div>
              <Switch 
                checked={trackEmails}
                onCheckedChange={setTrackEmails}
                data-testid="switch-track-emails"
              />
            </div>
            
            {/* Unsubscribe link */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Label className="text-sm text-gray-700">Unsubscribe link</Label>
                <Button variant="ghost" size="sm">
                  <Info className="h-3 w-3 text-gray-400" />
                </Button>
              </div>
              <Switch 
                checked={unsubscribeLink}
                onCheckedChange={setUnsubscribeLink}
                data-testid="switch-unsubscribe"
              />
            </div>
          </div>
        </div>

        {/* Sequence */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Sequence</h3>
          <div className="space-y-2">
            {/* Main Email */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <div className="bg-blue-600 text-white text-xs font-medium rounded-full w-5 h-5 flex items-center justify-center">
                  1
                </div>
                <div className="flex-1">
                  <div className="text-sm text-blue-900 font-medium">{subject || "(no subject)"}</div>
                  <div className="text-xs text-blue-700">Will be sent immediately</div>
                </div>
              </div>
            </div>
            
            {/* Follow-up Emails */}
            {followUpEmails.map((followUp, index) => {
              const conditionText = {
                'not_opened': 'If no reply',
                'not_clicked': 'If no click', 
                'always': 'No matter what'
              }[followUp.condition as keyof typeof conditionText] || 'If no reply';
              
              return (
                <div key={followUp.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <div className="bg-gray-600 text-white text-xs font-medium rounded-full w-5 h-5 flex items-center justify-center">
                      {index + 2}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-gray-900 font-medium">
                        {followUp.subject || "(no content)"}
                      </div>
                      <div className="text-xs text-gray-600">
                        + {conditionText} + {followUp.delayDays} days
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">Preview campaign</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowPreview(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="text-center text-gray-500">No recipients</div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-2">{subject || "(no subject)"}</div>
                  <div className="text-sm">
                    <div className="font-medium">From: {selectedAccount ? emailAccounts?.find(a => a.id === selectedAccount)?.email : "Select account"}</div>
                    <div>To: Select recipients</div>
                  </div>
                </div>
                <div className="text-center">
                  <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-send-test">
                    Send test email
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">Schedule send</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowScheduleModal(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <Label className="text-sm text-gray-700">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? selectedDate.toDateString() : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div>
                <Label className="text-sm text-gray-700">Time</Label>
                <Input
                  type="time"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="w-full"
                />
              </div>
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setShowScheduleModal(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (selectedDate) {
                      const [hours, minutes] = selectedTime.split(':');
                      const scheduledDateTime = new Date(selectedDate);
                      scheduledDateTime.setHours(parseInt(hours), parseInt(minutes));
                      setScheduleDate(scheduledDateTime);
                    }
                    setShowScheduleModal(false);
                  }}
                >
                  Schedule
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Autopilot Modal */}
      {showAutopilotModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">Autopilot</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowAutopilotModal(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-gray-600 mb-6">
                Improve your deliverability with these sending options{" "}
                <a href="#" className="text-blue-600 underline">(why it's important)</a>.
              </p>

              {/* Two Column Layout - Exact MailMeteor Style */}
              <div className="grid grid-cols-2 gap-12 mb-6">
                {/* Left Column - Send only on */}
                <div>
                  <h4 className="font-medium text-sm mb-4 text-gray-700">Send only on</h4>
                  <div className="space-y-3">
                    {Object.entries(autopilotSettings.sendOnDays).map(([day, settings]) => (
                      <div key={day} className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Checkbox 
                            checked={settings.enabled}
                            onCheckedChange={(checked) => {
                              setAutopilotSettings(prev => ({
                                ...prev,
                                sendOnDays: {
                                  ...prev.sendOnDays,
                                  [day]: { ...settings, enabled: checked as boolean }
                                }
                              }));
                            }}
                          />
                          <span className="text-sm capitalize text-gray-700">{day}</span>
                        </div>
                        
                        {settings.enabled ? (
                          <div className="flex items-center space-x-2">
                            <Input 
                              type="time" 
                              value={settings.startTime}
                              onChange={(e) => {
                                setAutopilotSettings(prev => ({
                                  ...prev,
                                  sendOnDays: {
                                    ...prev.sendOnDays,
                                    [day]: { ...settings, startTime: e.target.value }
                                  }
                                }));
                              }}
                              className="w-18 h-8 text-xs border-gray-300 rounded-md"
                            />
                            <span className="text-xs text-gray-500">to</span>
                            <Input 
                              type="time" 
                              value={settings.endTime}
                              onChange={(e) => {
                                setAutopilotSettings(prev => ({
                                  ...prev,
                                  sendOnDays: {
                                    ...prev.sendOnDays,
                                    [day]: { ...settings, endTime: e.target.value }
                                  }
                                }));
                              }}
                              className="w-18 h-8 text-xs border-gray-300 rounded-md"
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Turn off</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column - Sending rate */}
                <div>
                  <h4 className="font-medium text-sm mb-4 text-gray-700">Sending rate</h4>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        checked={autopilotSettings.maxEmailsEnabled}
                        onCheckedChange={(checked) => {
                          setAutopilotSettings(prev => ({ ...prev, maxEmailsEnabled: checked as boolean }));
                        }}
                        id="max-per-day" 
                      />
                      <div className="flex-1">
                        <Label htmlFor="max-per-day" className="text-sm text-gray-700 cursor-pointer">
                          Max emails per day
                        </Label>
                        <div className="flex items-center space-x-2 mt-2">
                          <Input
                            type="number"
                            value={autopilotSettings.maxEmailsPerDay}
                            onChange={(e) => {
                              setAutopilotSettings(prev => ({
                                ...prev,
                                maxEmailsPerDay: parseInt(e.target.value) || 500
                              }));
                            }}
                            className="w-20 h-8 text-xs"
                            min="1"
                            max="1000"
                            disabled={!autopilotSettings.maxEmailsEnabled}
                          />
                          <span className="text-xs text-gray-500">emails</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        checked={autopilotSettings.delayEnabled}
                        onCheckedChange={(checked) => {
                          setAutopilotSettings(prev => ({ ...prev, delayEnabled: checked as boolean }));
                        }}
                        id="delay-between" 
                      />
                      <div className="flex-1">
                        <Label htmlFor="delay-between" className="text-sm text-gray-700 cursor-pointer">
                          Delay between emails
                        </Label>
                        <div className="flex items-center space-x-2 mt-2">
                          <Input
                            type="number"
                            value={autopilotSettings.delayBetweenEmails}
                            onChange={(e) => {
                              setAutopilotSettings(prev => ({
                                ...prev,
                                delayBetweenEmails: parseInt(e.target.value) || 2
                              }));
                            }}
                            className="w-20 h-8 text-xs"
                            min="1"
                            max="60"
                            disabled={!autopilotSettings.delayEnabled}
                          />
                          <span className="text-xs text-gray-500">minutes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timezone Notice */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <Clock className="h-4 w-4" />
                  <span>⏱ Based on your timezone</span>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h4 className="font-medium text-sm mb-3 text-blue-900">Summary</h4>
                <div className="text-sm text-blue-800">
                  {(() => {
                    const enabledDays = Object.entries(autopilotSettings.sendOnDays)
                      .filter(([_, settings]) => settings.enabled).length;
                    const totalEmails = 100; // This would come from actual recipient count
                    
                    if (enabledDays === 0) {
                      return "Please select at least one day to send emails.";
                    }
                    
                    let estimatedHours = 0;
                    
                    // Calculate based on enabled settings
                    if (autopilotSettings.maxEmailsEnabled && autopilotSettings.delayEnabled) {
                      // Both rate limiting methods enabled - use the more restrictive one
                      const dailyLimit = Math.floor(autopilotSettings.maxEmailsPerDay / enabledDays);
                      const delayHours = (autopilotSettings.delayBetweenEmails / 60); // Convert minutes to hours
                      const hoursFromDelay = totalEmails * delayHours;
                      const hoursFromDaily = totalEmails / (dailyLimit / 24); // Emails per hour
                      estimatedHours = Math.max(hoursFromDelay, hoursFromDaily);
                    } else if (autopilotSettings.maxEmailsEnabled) {
                      // Only daily limit enabled
                      const dailyLimit = Math.floor(autopilotSettings.maxEmailsPerDay / enabledDays);
                      estimatedHours = totalEmails / (dailyLimit / 24); // Spread across 24 hours
                    } else if (autopilotSettings.delayEnabled) {
                      // Only delay enabled
                      estimatedHours = (totalEmails * autopilotSettings.delayBetweenEmails) / 60;
                    } else {
                      // No rate limiting - immediate send
                      estimatedHours = 0.1; // Almost immediate
                    }
                    
                    const roundedHours = Math.ceil(estimatedHours);
                    
                    return `With the current settings, if you send ${totalEmails} emails, it will take about ${roundedHours} ${roundedHours === 1 ? 'hour' : 'hours'}.`;
                  })()
                  }
                </div>
              </div>
            </div>
            
            {/* Fixed bottom buttons area */}
            <div className="border-t bg-gray-50 p-4 shrink-0">
              <div className="flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setShowAutopilotModal(false)}>
                  Cancel
                </Button>
                <Button 
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    setAutopilotEnabled(true);
                    setShowAutopilotModal(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MailMeteor Original Design - Recipient Selection Modal */}
      {showRecipientModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-3xl h-[500px] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b bg-white">
              <h3 className="text-lg font-medium text-gray-900">Select recipients</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowRecipientModal(false)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="flex h-full">
              {/* Left Sidebar - Exact MailMeteor Options */}
              <div className="w-72 border-r bg-white">
                <div className="p-0">
                  {/* Google Sheets Option - Blue when selected */}
                  <button
                    className={`w-full px-4 py-3 text-left flex items-center space-x-3 transition-colors border-b border-gray-100 ${
                      selectedRecipientMethod === 'Google Sheets'
                        ? 'bg-blue-500 text-white'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onClick={async () => {
                      setSelectedRecipientMethod('Google Sheets');
                      // Check if Google is connected, if not show the "First time here?" modal
                      if (!googleSheetsConnected) {
                        try {
                          const response = await fetch('/api/auth/google/status');
                          const data = await response.json();
                          if (!data.connected) {
                            // Show the "First time here?" modal like MailMeteor
                            setShowGoogleConnectModal(true);
                          }
                        } catch (error) {
                          console.error('Error checking auth:', error);
                          setShowGoogleConnectModal(true);
                        }
                      }
                    }}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedRecipientMethod === 'Google Sheets' 
                        ? 'bg-white bg-opacity-20' 
                        : 'bg-blue-500'
                    }`}>
                      <FileSpreadsheet className={`h-5 w-5 ${
                        selectedRecipientMethod === 'Google Sheets' 
                          ? 'text-white' 
                          : 'text-white'
                      }`} />
                    </div>
                    <span className="font-medium">Google Sheets</span>
                  </button>

                  {/* Import CSV Option */}
                  <button
                    className={`w-full px-4 py-3 text-left flex items-center space-x-3 transition-colors border-b border-gray-100 ${
                      selectedRecipientMethod === 'Import a CSV'
                        ? 'bg-blue-500 text-white'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onClick={() => setSelectedRecipientMethod('Import a CSV')}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedRecipientMethod === 'Import a CSV' 
                        ? 'bg-white bg-opacity-20' 
                        : 'bg-gray-500'
                    }`}>
                      <Upload className={`h-5 w-5 ${
                        selectedRecipientMethod === 'Import a CSV' 
                          ? 'text-white' 
                          : 'text-white'
                      }`} />
                    </div>
                    <span className="font-medium">Import a CSV</span>
                  </button>

                  {/* Contact List Option */}
                  <button
                    className={`w-full px-4 py-3 text-left flex items-center space-x-3 transition-colors border-b border-gray-100 ${
                      selectedRecipientMethod === 'Contact list'
                        ? 'bg-blue-500 text-white'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onClick={() => setSelectedRecipientMethod('Contact list')}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedRecipientMethod === 'Contact list' 
                        ? 'bg-white bg-opacity-20' 
                        : 'bg-gray-500'
                    }`}>
                      <Users className={`h-5 w-5 ${
                        selectedRecipientMethod === 'Contact list' 
                          ? 'text-white' 
                          : 'text-white'
                      }`} />
                    </div>
                    <span className="font-medium">Contact list</span>
                  </button>

                  {/* Copy/paste Option */}
                  <button
                    className={`w-full px-4 py-3 text-left flex items-center space-x-3 transition-colors ${
                      selectedRecipientMethod === 'Copy / paste'
                        ? 'bg-blue-500 text-white'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onClick={() => setSelectedRecipientMethod('Copy / paste')}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedRecipientMethod === 'Copy / paste' 
                        ? 'bg-white bg-opacity-20' 
                        : 'bg-gray-500'
                    }`}>
                      <Copy className={`h-5 w-5 ${
                        selectedRecipientMethod === 'Copy / paste' 
                          ? 'text-white' 
                          : 'text-white'
                      }`} />
                    </div>
                    <span className="font-medium">Copy / paste</span>
                  </button>
                </div>
              </div>

              {/* Right Content Area - Exact MailMeteor Layout */}
              <div className="flex-1 p-6 bg-white">
                {selectedRecipientMethod === 'Google Sheets' && (
                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-6">Spreadsheet</h4>
                    
                    {/* Connection Status and Connect Button */}
                    <div className="flex items-center justify-between p-3 border rounded-md mb-6">
                      {googleSheetsConnected ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <span className="text-sm text-green-800">Google Sheets connected</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                          <span className="text-sm text-orange-800">Google Sheets not connected</span>
                        </div>
                      )}
                      
                      <Button
                        onClick={() => window.location.href = '/api/auth/google'}
                        variant={googleSheetsConnected ? "outline" : "default"}
                        size="sm"
                        className={googleSheetsConnected ? "" : "bg-blue-600 hover:bg-blue-700"}
                        data-testid="button-connect-google-sheets"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        {googleSheetsConnected ? 'Reconnect' : 'Connect Google Sheets'}
                      </Button>
                    </div>
                    
                    <div className="space-y-6">
                      <div>
                        <Label className="text-sm text-gray-600 mb-3 block">Spreadsheet</Label>
                        <Input
                          placeholder="https://docs.google.com/spreadsheets/d/..."
                          value={googleSheetsUrl}
                          onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                          className="w-full h-10 px-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          disabled={!googleSheetsConnected}
                        />
                        {!googleSheetsConnected && (
                          <p className="text-xs text-gray-500 mt-1">
                            Connect your Google account first to access spreadsheets
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {googleSheetsConnected && (
                      <div>
                        <Label className="text-sm text-gray-600 mb-3 block">Sheet</Label>
                        <Select 
                          value={selectedSheet} 
                          onValueChange={setSelectedSheet}
                          disabled={sheetsLoading || availableSheets.length === 0}
                        >
                          <SelectTrigger className="w-full h-10 border-gray-300 rounded-md">
                            <SelectValue placeholder={
                              sheetsLoading ? "Loading sheets..." : 
                              availableSheets.length === 0 ? "Enter a valid Google Sheets URL first" :
                              "Select a sheet"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {availableSheets.map((sheet) => (
                              <SelectItem key={sheet.id} value={sheet.name}>
                                {sheet.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {availableSheets.length > 0 && (
                          <p className="text-xs text-green-600 mt-1">
                            Found {availableSheets.length} sheet(s) in spreadsheet
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedRecipientMethod === 'Import a CSV' && (
                  <div className="h-full flex flex-col">
                    {/* Drag and Drop Area - Exact MailMeteor Style */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-full max-w-md text-center">
                        <div className="border-2 border-dashed border-blue-300 rounded-lg p-12 bg-blue-50">
                          <div className="flex flex-col items-center space-y-4">
                            <div className="w-16 h-16 bg-blue-500 rounded-lg flex items-center justify-center">
                              <Upload className="h-8 w-8 text-white" />
                            </div>
                            <div>
                              <p className="text-gray-700 font-medium mb-1">
                                Drag a CSV file here or click the button below
                              </p>
                              <p className="text-gray-600 text-sm">
                                to upload your mailing list
                              </p>
                            </div>
                            <Button 
                              className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                              onClick={handleImportCSVClick}
                            >
                              Import a CSV
                            </Button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".csv"
                              onChange={handleFileChange}
                              className="hidden"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedRecipientMethod === 'Contact list' && (
                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-6">Select a list</h4>
                    <div className="space-y-4">
                      <div>
                        <Select>
                          <SelectTrigger className="w-full h-10 border-gray-300 rounded-md">
                            <SelectValue placeholder="Select a list" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="select-list" disabled className="text-gray-400">Select a list</SelectItem>
                            <SelectItem value="all-contacts">All contacts</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {selectedRecipientMethod === 'Copy / paste' && (
                  <div className="h-full flex flex-col">
                    <div className="flex-1">
                      <textarea
                        placeholder="Enter one email address per line"
                        className="w-full h-full p-4 border-2 border-blue-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-blue-50"
                        style={{ minHeight: '300px' }}
                      />
                    </div>
                    {/* Bottom right indicators - like MailMeteor */}
                    <div className="flex justify-end mt-4 space-x-2">
                      <div className="flex items-center space-x-1">
                        <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs">✓</span>
                        </div>
                        <span className="text-xs text-gray-600">0</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                          <X className="h-2 w-2 text-white" />
                        </div>
                        <span className="text-xs text-gray-600">0</span>
                      </div>
                    </div>
                  </div>
                )}

                {!selectedRecipientMethod && (
                  <div className="text-center py-16 text-gray-500">
                    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Users className="h-10 w-10 text-gray-400" />
                    </div>
                    <p className="text-base">Choose a method from the left to import recipients</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer - Exact MailMeteor Style */}
            <div className="border-t bg-gray-50 px-6 py-4">
              <div className="flex justify-between items-center">
                {/* Recipient Count Display */}
                {selectedRecipientMethod === 'Google Sheets' && recipientCount > 0 && (
                  <div className="text-sm text-gray-600">
                    {recipientCount} recipients in your contacts list
                  </div>
                )}
                {selectedRecipientMethod !== 'Google Sheets' && (
                  <div></div>
                )}
                
                <div className="flex space-x-3">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowRecipientModal(false)}
                    className="px-6 py-2 text-sm rounded-md border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Close
                  </Button>
                  <Button 
                    className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                    onClick={() => {
                      if (selectedRecipientMethod === 'Google Sheets' && recipientCount > 0) {
                        setShowPreview(true);
                      } else {
                        setShowRecipientModal(false);
                      }
                    }}
                    disabled={!selectedRecipientMethod}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal - Show Google Sheets Data */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b">
                <h3 className="text-lg font-semibold text-gray-900">Select recipients</h3>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-auto p-6">
                {sheetData.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          {sheetData[0]?.slice(0, 4).map((header: string, index: number) => (
                            <th key={index} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              {header}
                            </th>
                          ))}
                          {sheetData[0]?.length > 4 && (
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              {sheetData[0].length - 4} more...
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {sheetData.slice(1, 5).map((row: any[], rowIndex: number) => (
                          <tr key={rowIndex} className="hover:bg-gray-50">
                            {row.slice(0, 4).map((cell: any, cellIndex: number) => (
                              <td key={cellIndex} className="px-4 py-2 text-gray-900">
                                {cell || '--'}
                              </td>
                            ))}
                            {row.length > 4 && (
                              <td className="px-4 py-2 text-gray-500">--</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    No data available
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="border-t bg-gray-50 px-6 py-4">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-gray-600">
                    {recipientCount} recipients in your contacts list
                  </div>
                  <div className="flex space-x-3">
                    <Button
                      variant="outline"
                      onClick={() => setShowPreview(false)}
                      className="px-6 py-2"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={() => {
                        setShowPreview(false);
                        setShowRecipientModal(false);
                      }}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Connect Modal - "First time here?" */}
      {showGoogleConnectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">First time here?</h3>
                <button
                  onClick={() => setShowGoogleConnectModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div>
                <p className="text-gray-600">
                  AImailagent needs to connect to your Google account to send emails on your behalf and provide a stellar experience.{' '}
                  <a href="#" className="text-blue-600 hover:underline">
                    Learn about how we manage privacy
                  </a>
                  .
                </p>
              </div>
              <div className="mt-6 flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setShowGoogleConnectModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setShowGoogleConnectModal(false);
                    window.location.href = '/api/auth/google';
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Connect to Google
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}