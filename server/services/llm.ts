import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from '@anthropic-ai/sdk';
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
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
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
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.5-pro") {
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
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-20250514") {
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

  constructor() {
    // Initialize providers if API keys are available
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (openaiKey) {
      this.providers.set('openai', new OpenAIProvider(openaiKey));
    }
    if (geminiKey) {
      this.providers.set('gemini', new GeminiProvider(geminiKey));
    }
    if (anthropicKey) {
      this.providers.set('anthropic', new AnthropicProvider(anthropicKey));
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

      const provider = this.providers.get(llmConfig.provider);
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

      const provider = this.providers.get(llmConfig.provider);
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
}
