import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function AICommandInterface() {
  const [command, setCommand] = useState("");
  const [isListening, setIsListening] = useState(false);
  const { toast } = useToast();

  const commandMutation = useMutation({
    mutationFn: async (command: string) => {
      const response = await apiRequest("POST", "/api/ai-command", { command });
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: "AI Assistant",
          description: result.message,
        });
        
        // Handle UI actions based on the response
        if (result.uiAction) {
          handleUIAction(result.uiAction, result.data);
        }
      } else {
        toast({
          title: "AI Assistant",
          description: result.message,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to process command. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleUIAction = (action: string, data: any) => {
    switch (action) {
      case 'open_campaign_form':
        // Open campaign creation modal/page
        console.log('Opening campaign form with data:', data);
        break;
      case 'show_analytics_modal':
        // Show analytics in a modal
        console.log('Showing analytics:', data);
        break;
      case 'show_contacts':
        // Navigate to contacts page
        window.location.href = '/contacts';
        break;
      case 'open_contact_import':
        // Open contact import modal
        console.log('Opening contact import');
        break;
      case 'show_llm_settings':
        // Navigate to LLM settings
        window.location.href = '/settings?tab=llm';
        break;
      default:
        console.log('Unhandled UI action:', action);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (command.trim()) {
      commandMutation.mutate(command);
      setCommand("");
    }
  };

  const toggleListening = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setIsListening(!isListening);
      // Speech recognition would be implemented here
      toast({
        title: "Voice Input",
        description: "Speech recognition would be available with proper permissions.",
      });
    } else {
      toast({
        title: "Voice Input",
        description: "Speech recognition is not supported in this browser.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="relative">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center bg-slate-100 rounded-lg px-4 py-2 space-x-2 min-w-80">
          <i className="fas fa-magic text-primary"></i>
          <input 
            type="text" 
            placeholder="Ask AI: 'Create a follow-up campaign for leads..'" 
            className="bg-transparent border-none outline-none flex-1 text-sm"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={commandMutation.isPending}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`p-1 rounded ${isListening ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}
          >
            <i className="fas fa-microphone"></i>
          </button>
          {commandMutation.isPending && (
            <i className="fas fa-spinner fa-spin text-primary"></i>
          )}
        </div>
      </form>
    </div>
  );
}
