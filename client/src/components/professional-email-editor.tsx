import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bold, Italic, Underline, Type, Paperclip, Link, List, ListOrdered, AlignLeft, Code } from "lucide-react";

interface ProfessionalEmailEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

export function ProfessionalEmailEditor({ 
  content, 
  onChange, 
  placeholder = "Enter your email content here...",
  minHeight = "300px",
  className = ""
}: ProfessionalEmailEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const insertText = (before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    
    const newText = content.substring(0, start) + before + selectedText + after + content.substring(end);
    onChange(newText);
    
    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>
      {/* MailMeteor-style Toolbar */}
      <div className="flex items-center px-3 py-2 border-b border-gray-200 bg-white">
        {/* Bold, Italic, Underline */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100" 
          onClick={() => insertText('**', '**')}
          data-testid="toolbar-bold"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100" 
          onClick={() => insertText('*', '*')}
          data-testid="toolbar-italic"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100" 
          onClick={() => insertText('<u>', '</u>')}
          data-testid="toolbar-underline"
        >
          <Underline className="h-4 w-4" />
        </Button>
        
        {/* Color Picker */}
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100 relative">
          <Type className="h-4 w-4" />
          <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-3 h-1 bg-red-500 rounded-sm"></div>
        </Button>
        
        {/* Font dropdown */}
        <Select defaultValue="Arial" onValueChange={(value) => {
          textareaRef.current?.focus();
        }}>
          <SelectTrigger className="w-20 h-8 border-0 bg-transparent text-xs hover:bg-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Arial">Arial</SelectItem>
            <SelectItem value="Georgia">Georgia</SelectItem>
            <SelectItem value="Times">Times</SelectItem>
            <SelectItem value="Courier">Courier</SelectItem>
          </SelectContent>
        </Select>
        
        {/* Font Size dropdown */}
        <Select defaultValue="Normal" onValueChange={(value) => {
          textareaRef.current?.focus();
        }}>
          <SelectTrigger className="w-16 h-8 border-0 bg-transparent text-xs hover:bg-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Small">Small</SelectItem>
            <SelectItem value="Normal">Normal</SelectItem>
            <SelectItem value="Large">Large</SelectItem>
            <SelectItem value="Huge">Huge</SelectItem>
          </SelectContent>
        </Select>
        
        {/* Attach and Link */}
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100" data-testid="toolbar-attach">
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100"
          onClick={() => {
            const url = prompt('Enter URL:');
            if (url) {
              insertText(`[link](${url})`);
            }
          }}
          data-testid="toolbar-link"
        >
          <Link className="h-4 w-4" />
        </Button>
        
        {/* Image */}
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21,15 16,10 5,21"/>
          </svg>
        </Button>
        
        {/* Divider */}
        <div className="h-4 w-px bg-gray-300 mx-1" />
        
        {/* Lists */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100" 
          onClick={() => insertText('\n• ')}
          data-testid="toolbar-list"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100" 
          onClick={() => insertText('\n1. ')}
          data-testid="toolbar-numbered-list"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        
        {/* Alignment */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100"
          onClick={() => textareaRef.current?.focus()}
        >
          <AlignLeft className="h-4 w-4" />
        </Button>
        
        {/* Code */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100"
          onClick={() => insertText('`', '`')}
        >
          <Code className="h-4 w-4" />
        </Button>
        
        {/* Clear formatting */}
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 w-8 p-0 hover:bg-gray-100"
          onClick={() => {
            // Simple text cleanup - remove common markdown
            const cleanText = content
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/\*(.*?)\*/g, '$1')
              .replace(/<u>(.*?)<\/u>/g, '$1')
              .replace(/`(.*?)`/g, '$1')
              .replace(/\[(.*?)\]\(.*?\)/g, '$1');
            onChange(cleanText);
            textareaRef.current?.focus();
          }}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 2l3 6 3-6M6 18h8M6 10h8M6 14h8"/>
            <path d="m18 6 4 4-4 4"/>
          </svg>
        </Button>
      </div>

      {/* Content Editor */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-none px-4 py-4 text-gray-900 border-0 focus:outline-none bg-white focus:ring-0"
          style={{ 
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '14px', 
            lineHeight: '1.5',
            minHeight
          }}
          data-testid="editor-content"
        />
      </div>
    </div>
  );
}