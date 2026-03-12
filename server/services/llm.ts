import { storage } from "../storage";

/*
Follow these instructions when using this blueprint:
- Note that the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
- Note that the newest Gemini model series is "gemini-2.5-flash" or gemini-2.5-pro"
- Note that the newest Anthropic model is "claude-sonnet-4-20250514"
*/

interface LLMProvider {
  generateEmail(prompt: string, context: any): Promise<string>;
  generateReply(originalEmail: string, context: any): Promise<string>;
}

class OpenAIProvider implements LLMProvider {
  private client: any;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o", baseURL?: string) {
    // Lazy-load OpenAI at construction time (already inside try/catch in LLMService)
    const OpenAI = require("openai").default || require("openai");
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
  }

  async generateEmail(prompt: string, context: any): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You are an expert email marketing copywriter. Generate personalized, professional email content that drives engagement and responses."
        },
        {
          role: "user",
          content: `${prompt}\n\nContext: ${JSON.stringify(context)}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    return response.choices[0].message.content || "";
  }

  async generateReply(originalEmail: string, context: any): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You are a professional email assistant. Generate appropriate, contextual replies to emails."
        },
        {
          role: "user",
          content: `Generate a reply to this email: ${originalEmail}\n\nContext: ${JSON.stringify(context)}`
        }
      ],
      temperature: 0.6,
      max_tokens: 500,
    });

    return response.choices[0].message.content || "";
  }
}

class GeminiProvider implements LLMProvider {
  private client: any;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.5-pro") {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generateEmail(prompt: string, context: any): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.model });
    
    const response = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text: `You are an expert email marketing copywriter. Generate personalized, professional email content that drives engagement and responses.\n\n${prompt}\n\nContext: ${JSON.stringify(context)}`
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      }
    });

    return response.response.text() || "";
  }

  async generateReply(originalEmail: string, context: any): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.model });
    
    const response = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text: `You are a professional email assistant. Generate appropriate, contextual replies to emails.\n\nGenerate a reply to this email: ${originalEmail}\n\nContext: ${JSON.stringify(context)}`
        }]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 500,
      }
    });

    return response.response.text() || "";
  }
}

class AnthropicProvider implements LLMProvider {
  private client: any;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-20250514") {
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateEmail(prompt: string, context: any): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      temperature: 0.7,
      system: "You are an expert email marketing copywriter. Generate personalized, professional email content that drives engagement and responses.",
      messages: [{
        role: "user",
        content: `${prompt}\n\nContext: ${JSON.stringify(context)}`
      }]
    });

    return response.content[0].type === 'text' ? response.content[0].text : "";
  }

  async generateReply(originalEmail: string, context: any): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      temperature: 0.6,
      system: "You are a professional email assistant. Generate appropriate, contextual replies to emails.",
      messages: [{
        role: "user",
        content: `Generate a reply to this email: ${originalEmail}\n\nContext: ${JSON.stringify(context)}`
      }]
    });

    return response.content[0].type === 'text' ? response.content[0].text : "";
  }
}

export class LLMService {
  private providers: Map<string, LLMProvider> = new Map();
  private initialized = false;

  constructor() {
    // Defer initialization to avoid crashing the server if packages are missing
    this.initProviders();
  }

  private initProviders() {
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      const geminiKey = process.env.GEMINI_API_KEY;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;

      if (openaiKey) {
        try {
          this.providers.set('openai', new OpenAIProvider(openaiKey));
        } catch (e) {
          console.warn('[LLM] Failed to initialize OpenAI provider:', (e as Error).message);
        }
      }
      if (geminiKey) {
        try {
          this.providers.set('gemini', new GeminiProvider(geminiKey));
        } catch (e) {
          console.warn('[LLM] Failed to initialize Gemini provider:', (e as Error).message);
        }
      }
      if (anthropicKey) {
        try {
          this.providers.set('anthropic', new AnthropicProvider(anthropicKey));
        } catch (e) {
          console.warn('[LLM] Failed to initialize Anthropic provider:', (e as Error).message);
        }
      }

      this.initialized = true;
      console.log(`[LLM] Initialized ${this.providers.size} provider(s): ${Array.from(this.providers.keys()).join(', ') || 'none'}`);
    } catch (error) {
      console.warn('[LLM] Failed to initialize providers (non-fatal):', (error as Error).message);
      this.initialized = true; // Mark as initialized even on failure so we don't retry
    }
  }

  async generatePersonalizedEmail(
    organizationId: string,
    contactData: any,
    templateContent: string,
    campaignContext: any
  ): Promise<string> {
    try {
      const llmConfig = await storage.getPrimaryLlmConfiguration(organizationId);
      if (!llmConfig) {
        throw new Error('No LLM configuration found');
      }

      // Try to load provider dynamically from DB config if not in env
      let provider = this.providers.get(llmConfig.provider);
      if (!provider) {
        // Attempt dynamic loading from API settings
        provider = await this.loadProviderFromSettings(organizationId, llmConfig);
      }
      if (!provider) {
        throw new Error(`LLM provider ${llmConfig.provider} not available`);
      }

      const prompt = `
        Personalize the following email template for the recipient:
        
        Template: ${templateContent}
        
        Recipient Information:
        - Name: ${contactData.firstName} ${contactData.lastName}
        - Company: ${contactData.company}
        - Job Title: ${contactData.jobTitle}
        - Email: ${contactData.email}
        
        Campaign Context: ${campaignContext.description}
        
        Please make the email highly personalized and relevant to the recipient's role and company.
        Keep the core message but adapt the language, examples, and call-to-action to be more relevant.
        Maintain a professional tone that matches the original template's style.
      `;

      return await provider.generateEmail(prompt, {
        contact: contactData,
        campaign: campaignContext,
        template: templateContent
      });
    } catch (error) {
      console.error('Error generating personalized email:', error);
      throw error;
    }
  }

  async generateEmailReply(
    organizationId: string,
    originalEmail: string,
    context: any
  ): Promise<string> {
    try {
      const llmConfig = await storage.getPrimaryLlmConfiguration(organizationId);
      if (!llmConfig) {
        throw new Error('No LLM configuration found');
      }

      let provider = this.providers.get(llmConfig.provider);
      if (!provider) {
        provider = await this.loadProviderFromSettings(organizationId, llmConfig);
      }
      if (!provider) {
        throw new Error(`LLM provider ${llmConfig.provider} not available`);
      }

      return await provider.generateReply(originalEmail, context);
    } catch (error) {
      console.error('Error generating email reply:', error);
      throw error;
    }
  }

  async getProviderStatus(): Promise<Array<{ provider: string; status: string; error?: string }>> {
    const statuses = [];
    
    for (const [providerName, provider] of Array.from(this.providers.entries())) {
      try {
        // Test the provider with a simple request
        await provider.generateEmail("Test", {});
        statuses.push({ provider: providerName, status: 'online' });
      } catch (error) {
        statuses.push({ 
          provider: providerName, 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return statuses;
  }

  /**
   * Load Azure OpenAI provider dynamically from database settings.
   * This enables using Azure OpenAI without environment variables.
   */
  async loadAzureProvider(organizationId: string): Promise<boolean> {
    try {
      const settings = await storage.getApiSettings(organizationId);
      const endpoint = settings.azure_openai_endpoint;
      const apiKey = settings.azure_openai_api_key;
      const deploymentName = settings.azure_openai_deployment;

      if (!endpoint || !apiKey || !deploymentName) {
        return false;
      }

      // Azure OpenAI uses a different base URL format
      const baseURL = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}`;
      const azureProvider = new OpenAIProvider(apiKey, deploymentName, baseURL);
      this.providers.set('azure-openai', azureProvider);
      return true;
    } catch (error) {
      console.error('Failed to load Azure OpenAI provider:', error);
      return false;
    }
  }

  /**
   * Attempt to load a provider dynamically from org API settings (for API keys stored in DB)
   */
  private async loadProviderFromSettings(organizationId: string, llmConfig: any): Promise<LLMProvider | null> {
    try {
      const settings = await storage.getApiSettings(organizationId);
      
      if (llmConfig.provider === 'openai' && settings.openai_api_key) {
        const provider = new OpenAIProvider(settings.openai_api_key, llmConfig.model || 'gpt-4o');
        this.providers.set('openai', provider);
        return provider;
      }
      if (llmConfig.provider === 'gemini' && settings.gemini_api_key) {
        const provider = new GeminiProvider(settings.gemini_api_key, llmConfig.model || 'gemini-2.5-pro');
        this.providers.set('gemini', provider);
        return provider;
      }
      if (llmConfig.provider === 'anthropic' && settings.anthropic_api_key) {
        const provider = new AnthropicProvider(settings.anthropic_api_key, llmConfig.model || 'claude-sonnet-4-20250514');
        this.providers.set('anthropic', provider);
        return provider;
      }
      if (llmConfig.provider === 'azure-openai') {
        const loaded = await this.loadAzureProvider(organizationId);
        return loaded ? (this.providers.get('azure-openai') || null) : null;
      }
    } catch (e) {
      console.warn(`[LLM] Failed to load provider ${llmConfig.provider} from settings:`, (e as Error).message);
    }
    return null;
  }
}
