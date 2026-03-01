import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { 
  Bold, 
  Italic, 
  Underline, 
  Type, 
  Link, 
  Image, 
  List, 
  Minus,
  AlignLeft,
  MoreHorizontal,
  ChevronDown,
  Code,
  Mail,
  Target,
  FileText,
  Users,
  TrendingUp,
  BarChart3,
  Settings,
  CreditCard,
  Shield
} from "lucide-react";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function NewTemplate() {
  const [location, setLocation] = useLocation();
  const [templateForm, setTemplateForm] = useState({
    name: "",
    subject: "",
    content: "",
    category: "general",
  });
  const [showPreview, setShowPreview] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createTemplateMutation = useMutation({
    mutationFn: async (templateData: any) => {
      const response = await apiRequest("POST", "/api/templates", templateData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Success",
        description: "Template saved successfully",
      });
      setLocation("/templates");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save template",
        variant: "destructive",
      });
    },
  });

  const handleSaveTemplate = () => {
    if (!templateForm.name || !templateForm.subject || !templateForm.content) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createTemplateMutation.mutate(templateForm);
  };

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, href: '/' },
    { key: 'templates', label: 'Templates', icon: FileText, href: '/templates', active: true },
    { key: 'contacts', label: 'Contacts', icon: Users, href: '/contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, href: '/setup' },
  ];

  const sidebarBottomItems = [
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'verification', label: 'Email verification', icon: Shield },
    { key: 'tracking', label: 'Live tracking', icon: TrendingUp },
    { key: 'account', label: 'Account', icon: Settings },
    { key: 'billing', label: 'Billing', icon: CreditCard },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* AImailagent Sidebar */}
      <div className="w-64 bg-blue-600 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-blue-500">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-xl font-semibold">AImailagent</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setLocation(item.href)}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-left transition-colors ${
                  item.active 
                    ? 'bg-blue-500 text-white' 
                    : 'text-blue-100 hover:bg-blue-500 hover:text-white'
                }`}
                data-testid={`nav-${item.key}`}
              >
                <item.icon className="h-5 w-5 mr-3" />
                {item.label}
                {item.key === 'contacts' && (
                  <span className="ml-auto text-xs bg-blue-500 px-2 py-1 rounded">2.4k</span>
                )}
              </button>
            ))}
          </div>

          {/* More Section */}
          <div className="mt-8">
            <div className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-3 px-3">
              More
            </div>
            <div className="space-y-2">
              {sidebarBottomItems.map((item) => (
                <button
                  key={item.key}
                  className="w-full flex items-center px-3 py-2 rounded-lg text-left text-blue-100 hover:bg-blue-500 hover:text-white transition-colors"
                  data-testid={`nav-${item.key}`}
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom Action */}
        <div className="p-4 border-t border-blue-500">
          <button className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-400 transition-colors">
            <Mail className="h-4 w-4 mr-2" />
            New campaign
          </button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-500 uppercase tracking-wide">Template</span>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setLocation("/")}
              className="text-gray-600"
            >
              ← Back
            </Button>
          </div>
          
          <div className="flex items-center justify-between mt-2">
            <h1 className="text-2xl font-semibold text-gray-900">New template</h1>
            
            <div className="flex items-center space-x-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Actions <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Duplicate</DropdownMenuItem>
                  <DropdownMenuItem>Export</DropdownMenuItem>
                  <DropdownMenuItem>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                Show preview
              </Button>
              
              <Button 
                size="sm"
                onClick={handleSaveTemplate}
                disabled={createTemplateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Save template
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6">
          <div className="max-w-4xl mx-auto">
            {/* Subject Field */}
            <div className="mb-6">
              <Input
                placeholder="Subject"
                value={templateForm.subject}
                onChange={(e) => setTemplateForm(prev => ({ ...prev, subject: e.target.value }))}
                className="text-base border-gray-300 h-12"
              />
            </div>

            {/* Rich Text Editor Toolbar */}
            <div className="border rounded-t-lg bg-white">
              <div className="flex items-center px-3 py-2 border-b">
                <div className="flex items-center space-x-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Underline className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Type className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                <div className="flex items-center space-x-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Image className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Link className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                <div className="flex items-center space-x-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <List className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Minus className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-sm">
                      Sans Serif <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>Sans Serif</DropdownMenuItem>
                    <DropdownMenuItem>Serif</DropdownMenuItem>
                    <DropdownMenuItem>Monospace</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <AlignLeft className="h-4 w-4" />
                </Button>
                
                <div className="w-px h-6 bg-gray-300 mx-2" />
                
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Code className="h-4 w-4" />
                </Button>
                
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Content Editor */}
              <div className="min-h-[400px] p-4">
                <textarea
                  placeholder="Start writing your email template..."
                  value={templateForm.content}
                  onChange={(e) => setTemplateForm(prev => ({ ...prev, content: e.target.value }))}
                  className="w-full h-full min-h-[350px] resize-none border-0 outline-none text-base leading-relaxed"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">Template Preview</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowPreview(false)}
              >
                ×
              </Button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <strong>Subject:</strong> {templateForm.subject || "No subject"}
              </div>
              <div className="prose max-w-none">
                <div dangerouslySetInnerHTML={{ __html: templateForm.content.replace(/\n/g, '<br>') }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}