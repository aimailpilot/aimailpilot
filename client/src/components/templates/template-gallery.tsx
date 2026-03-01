import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import type { EmailTemplate } from "@/types";

interface TemplateGalleryProps {
  templates: EmailTemplate[];
  isLoading: boolean;
}

export function TemplateGallery({ templates, isLoading }: TemplateGalleryProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [location, setLocation] = useLocation();

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'outreach': return 'bg-blue-100 text-blue-800';
      case 'followup': return 'bg-green-100 text-green-800';
      case 'nurture': return 'bg-purple-100 text-purple-800';
      case 'sales': return 'bg-red-100 text-red-800';
      case 'partnership': return 'bg-yellow-100 text-yellow-800';
      case 'customer-success': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'outreach': return 'fa-paper-plane';
      case 'followup': return 'fa-reply';
      case 'nurture': return 'fa-heart';
      case 'sales': return 'fa-dollar-sign';
      case 'partnership': return 'fa-handshake';
      case 'customer-success': return 'fa-star';
      default: return 'fa-envelope';
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(9)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
              <div className="flex justify-between items-center mt-4">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-8 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <i className="fas fa-layer-group text-slate-300 text-6xl mb-4"></i>
          <h3 className="text-lg font-medium text-slate-900 mb-2">No templates found</h3>
          <p className="text-slate-600 mb-4">
            Create your first email template to get started with campaigns
          </p>
          <Button 
            className="bg-primary hover:bg-blue-700"
            onClick={() => setLocation("/templates/new")}
          >
            <i className="fas fa-plus mr-2"></i>
            Create Your First Template
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((template) => (
          <Card key={template.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg font-semibold text-slate-900 line-clamp-2">
                    {template.name}
                  </CardTitle>
                  <p className="text-sm text-slate-600 line-clamp-1 mt-1">
                    {template.subject}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <i className="fas fa-ellipsis-v"></i>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setSelectedTemplate(template)}>
                      <i className="fas fa-eye mr-2"></i>
                      Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-edit mr-2"></i>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-copy mr-2"></i>
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-rocket mr-2"></i>
                      Use in Campaign
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      <i className="fas fa-trash mr-2"></i>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-lg border-l-4 border-primary">
                  <p className="text-sm text-slate-700 line-clamp-3">
                    {template.content.substring(0, 150)}...
                  </p>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {template.category && (
                      <Badge className={getCategoryColor(template.category)}>
                        <i className={`fas ${getCategoryIcon(template.category)} mr-1 text-xs`}></i>
                        {template.category}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-500">
                    {template.usageCount} uses
                  </div>
                </div>
                
                {template.variables && template.variables.length > 0 && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-xs text-slate-500 mb-1">Variables:</p>
                    <div className="flex flex-wrap gap-1">
                      {template.variables.slice(0, 3).map((variable, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {variable}
                        </Badge>
                      ))}
                      {template.variables.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{template.variables.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    Created {new Date(template.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    Preview
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Template Preview Dialog */}
      <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{selectedTemplate?.name}</span>
              <div className="flex items-center space-x-2">
                {selectedTemplate?.category && (
                  <Badge className={getCategoryColor(selectedTemplate.category)}>
                    <i className={`fas ${getCategoryIcon(selectedTemplate.category)} mr-1 text-xs`}></i>
                    {selectedTemplate.category}
                  </Badge>
                )}
                <Badge variant="outline">
                  {selectedTemplate?.usageCount} uses
                </Badge>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          {selectedTemplate && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-slate-900 mb-2">Subject Line</h4>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-slate-700">{selectedTemplate.subject}</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-slate-900 mb-2">Email Content</h4>
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">
                    {selectedTemplate.content}
                  </pre>
                </div>
              </div>
              
              {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                <div>
                  <h4 className="font-medium text-slate-900 mb-2">Available Variables</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.variables.map((variable, index) => (
                      <Badge key={index} variant="outline">
                        {`{{${variable}}}`}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm text-slate-500 mt-2">
                    These variables will be automatically replaced with contact-specific information
                  </p>
                </div>
              )}
              
              <div className="flex items-center justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                  Close
                </Button>
                <Button variant="outline">
                  <i className="fas fa-edit mr-2"></i>
                  Edit Template
                </Button>
                <Button className="bg-primary hover:bg-blue-700">
                  <i className="fas fa-rocket mr-2"></i>
                  Use in Campaign
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
