// secrets-manager.ts - Centralized secrets management utility
import { createHash } from 'crypto';

export interface SecretConfig {
  id: string;
  category: 'blockchain' | 'storage' | 'ai' | 'database' | 'api' | 'auth' | 'deployment';
  service: string;
  key: string;
  value: string;
  description: string;
  required: boolean;
  isActive: boolean;
  lastUsed?: string;
  createdAt: string;
  environment: 'development' | 'production' | 'staging';
  autoSync: boolean;
  encrypted: boolean;
}

export interface ServiceCredentials {
  // Blockchain
  WEB3_PROJECT_ID?: string;
  ETHEREUM_RPC_URL?: string;
  SCROLL_RPC_URL?: string;
  PRIVATE_KEY?: string;
  
  // Storage
  PINATA_API_KEY?: string;
  PINATA_SECRET_KEY?: string;
  PINATA_GATEWAY_URL?: string;
  
  // AI Services
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  
  // Databases
  ASTRA_DB_APPLICATION_TOKEN?: string;
  ASTRA_DB_API_ENDPOINT?: string;
  NEON_DATABASE_URL?: string;
  
  // GitHub/Deployment
  GITHUB_TOKEN?: string;
  VERCEL_TOKEN?: string;
  
  // API
  MASTERMIND_API_URL?: string;
  MASTERMIND_API_KEY?: string;
  JWT_SECRET?: string;
}

class SecretsManager {
  private static instance: SecretsManager;
  private secrets: Map<string, SecretConfig> = new Map();
  private credentials: ServiceCredentials = {};
  private listeners: Array<(credentials: ServiceCredentials) => void> = [];

  private constructor() {
    this.loadSecrets();
  }

  static getInstance(): SecretsManager {
    if (!SecretsManager.instance) {
      SecretsManager.instance = new SecretsManager();
    }
    return SecretsManager.instance;
  }

  // Load secrets from API
  async loadSecrets(): Promise<void> {
    try {
      const response = await fetch('/api/user/secrets?active=true');
      const data = await response.json();
      
      if (data.success) {
        this.secrets.clear();
        this.credentials = {};
        
        data.secrets.forEach((secret: SecretConfig) => {
          this.secrets.set(secret.key, secret);
          this.credentials[secret.key as keyof ServiceCredentials] = secret.value;
        });
        
        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to load secrets:', error);
    }
  }

  // Get specific secret value
  getSecret(key: string): string | undefined {
    const secret = this.secrets.get(key);
    if (secret?.isActive) {
      // Update last used timestamp
      this.updateLastUsed(key);
      return secret.value;
    }
    return undefined;
  }

  // Get all credentials for a specific service category
  getServiceCredentials(category: string): Partial<ServiceCredentials> {
    const serviceSecrets: Partial<ServiceCredentials> = {};
    
    this.secrets.forEach((secret) => {
      if (secret.category === category && secret.isActive) {
        serviceSecrets[secret.key as keyof ServiceCredentials] = secret.value;
      }
    });
    
    return serviceSecrets;
  }

  // Get blockchain credentials for Web3 integration
  getBlockchainCredentials() {
    return {
      projectId: this.getSecret('NEXT_PUBLIC_WEB3_PROJECT_ID'),
      ethereumRpc: this.getSecret('NEXT_PUBLIC_ETHEREUM_RPC_URL'),
      scrollRpc: this.getSecret('NEXT_PUBLIC_SCROLL_RPC_URL'),
      privateKey: this.getSecret('PRIVATE_KEY')
    };
  }

  // Get Pinata credentials for IPFS operations
  getPinataCredentials() {
    return {
      apiKey: this.getSecret('PINATA_API_KEY'),
      secretKey: this.getSecret('PINATA_SECRET_KEY'),
      gatewayUrl: this.getSecret('PINATA_GATEWAY_URL') || 'https://gateway.pinata.cloud'
    };
  }

  // Get Astra DB credentials
  getAstraCredentials() {
    return {
      applicationToken: this.getSecret('ASTRA_DB_APPLICATION_TOKEN'),
      apiEndpoint: this.getSecret('ASTRA_DB_API_ENDPOINT'),
      namespace: this.getSecret('ASTRA_DB_NAMESPACE') || 'default_keyspace'
    };
  }

  // Get GitHub credentials
  getGitHubCredentials() {
    return {
      token: this.getSecret('GITHUB_TOKEN'),
      owner: this.getSecret('GITHUB_OWNER') || 'MikaelTHEoret',
      repo: this.getSecret('GITHUB_REPO') || 'Mastermind_os'
    };
  }

  // Get AI service credentials
  getAICredentials() {
    return {
      openai: this.getSecret('OPENAI_API_KEY'),
      anthropic: this.getSecret('ANTHROPIC_API_KEY')
    };
  }

  // Get all credentials object
  getAllCredentials(): ServiceCredentials {
    return { ...this.credentials };
  }

  // Check if required secrets are configured
  validateRequiredSecrets(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    
    this.secrets.forEach((secret) => {
      if (secret.required && (!secret.isActive || !secret.value)) {
        missing.push(secret.key);
      }
    });
    
    return {
      valid: missing.length === 0,
      missing
    };
  }

  // Update last used timestamp for a secret
  private async updateLastUsed(key: string): Promise<void> {
    const secret = this.secrets.get(key);
    if (secret) {
      try {
        await fetch(`/api/user/secrets/${secret.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastUsed: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error('Failed to update last used timestamp:', error);
      }
    }
  }

  // Subscribe to credential updates
  subscribe(callback: (credentials: ServiceCredentials) => void): void {
    this.listeners.push(callback);
  }

  // Unsubscribe from updates
  unsubscribe(callback: (credentials: ServiceCredentials) => void): void {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  // Notify all listeners of credential updates
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.credentials));
  }

  // Generate environment file content
  generateEnvFile(environment: 'development' | 'production' | 'staging' = 'development'): string {
    const envSecrets = Array.from(this.secrets.values())
      .filter(secret => secret.isActive && secret.environment === environment);
    
    const envContent = envSecrets
      .map(secret => `${secret.key}=${secret.value}`)
      .join('\n');
    
    const header = `# MasterMind OS Environment Configuration\n# Generated: ${new Date().toISOString()}\n# Environment: ${environment.toUpperCase()}\n\n`;
    
    return header + envContent;
  }

  // Sync secrets with local environment (for development)
  async syncWithEnvironment(): Promise<void> {
    try {
      const envContent = this.generateEnvFile();
      
      // In a real app, you would write to .env.local
      console.log('Environment sync:', envContent);
      
      // You could also use a service worker or electron API to write files
      // await writeEnvFile('.env.local', envContent);
      
    } catch (error) {
      console.error('Failed to sync environment:', error);
    }
  }

  // Test connectivity for configured services
  async testConnectivity(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    // Test Pinata connection
    const pinata = this.getPinataCredentials();
    if (pinata.apiKey) {
      try {
        const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
          headers: {
            'pinata_api_key': pinata.apiKey,
            'pinata_secret_api_key': pinata.secretKey || ''
          }
        });
        results.pinata = response.ok;
      } catch {
        results.pinata = false;
      }
    }
    
    // Test Astra DB connection
    const astra = this.getAstraCredentials();
    if (astra.applicationToken && astra.apiEndpoint) {
      try {
        const response = await fetch(`${astra.apiEndpoint}/api/rest/v1/keyspaces`, {
          headers: {
            'X-Cassandra-Token': astra.applicationToken
          }
        });
        results.astra = response.ok;
      } catch {
        results.astra = false;
      }
    }
    
    // Test GitHub connection
    const github = this.getGitHubCredentials();
    if (github.token) {
      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `token ${github.token}`
          }
        });
        results.github = response.ok;
      } catch {
        results.github = false;
      }
    }
    
    return results;
  }
}

// Export singleton instance
export const secretsManager = SecretsManager.getInstance();

// React hook for using secrets in components
export function useSecrets() {
  const [credentials, setCredentials] = useState<ServiceCredentials>({});
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const updateCredentials = (newCredentials: ServiceCredentials) => {
      setCredentials(newCredentials);
      setLoading(false);
    };
    
    // Subscribe to updates
    secretsManager.subscribe(updateCredentials);
    
    // Initial load
    secretsManager.loadSecrets().then(() => {
      setCredentials(secretsManager.getAllCredentials());
      setLoading(false);
    });
    
    return () => {
      secretsManager.unsubscribe(updateCredentials);
    };
  }, []);
  
  return {
    credentials,
    loading,
    getSecret: (key: string) => secretsManager.getSecret(key),
    getBlockchainCredentials: () => secretsManager.getBlockchainCredentials(),
    getPinataCredentials: () => secretsManager.getPinataCredentials(),
    getAstraCredentials: () => secretsManager.getAstraCredentials(),
    getGitHubCredentials: () => secretsManager.getGitHubCredentials(),
    getAICredentials: () => secretsManager.getAICredentials(),
    validateRequired: () => secretsManager.validateRequiredSecrets(),
    reload: () => secretsManager.loadSecrets(),
    testConnectivity: () => secretsManager.testConnectivity()
  };
}

// Helper functions for specific integrations
export const SecretsIntegration = {
  // Configure Pinata client
  configurePinata: () => {
    const creds = secretsManager.getPinataCredentials();
    return {
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
      gatewayUrl: creds.gatewayUrl
    };
  },
  
  // Configure Web3 provider
  configureWeb3: () => {
    const creds = secretsManager.getBlockchainCredentials();
    return {
      projectId: creds.projectId,
      ethereumRpc: creds.ethereumRpc,
      scrollRpc: creds.scrollRpc
    };
  },
  
  // Configure Astra DB client
  configureAstra: () => {
    const creds = secretsManager.getAstraCredentials();
    return {
      applicationToken: creds.applicationToken,
      apiEndpoint: creds.apiEndpoint,
      namespace: creds.namespace
    };
  },
  
  // Configure GitHub client
  configureGitHub: () => {
    const creds = secretsManager.getGitHubCredentials();
    return {
      token: creds.token,
      owner: creds.owner,
      repo: creds.repo
    };
  }
};

import { useState, useEffect } from 'react';
