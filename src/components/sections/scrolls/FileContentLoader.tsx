'use client';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  content?: string;
  cid?: string;
  hash?: string;
  lastModified: string;
  storage: 'native' | 'ipfs' | 'github' | 'pinata' | 'codeberg' | 'custom' | 'neon';
  parent?: string;
  children?: string[];
  mimeType?: string;
  isExpanded?: boolean;
  requiresAuth?: boolean;
}

interface ConfiguredSource {
  id: string;
  type: string;
  name: string;
  secrets: { [key: string]: string };
  status: 'connected' | 'disconnected' | 'error';
  lastUpdated: string;
  isCustom?: boolean;
}

export class FileContentLoader {
  private configuredSources: ConfiguredSource[] = [];
  
  constructor(configuredSources: ConfiguredSource[]) {
    this.configuredSources = configuredSources;
  }

  /**
   * Load content for a file based on its storage type and source
   */
  async loadFileContent(file: FileItem): Promise<string> {
    // If content is already loaded, return it
    if (file.content) {
      return file.content;
    }

    try {
      switch (file.storage) {
        case 'native':
          return await this.loadNativeFileContent(file);
        case 'github':
          return await this.loadGitHubFileContent(file);
        case 'pinata':
          return await this.loadPinataFileContent(file);
        case 'ipfs':
          return await this.loadIPFSFileContent(file);
        case 'codeberg':
          return await this.loadCodebergFileContent(file);
        case 'neon':
          return await this.loadNeonFileContent(file);
        default:
          throw new Error(`Unsupported storage type: ${file.storage}`);
      }
    } catch (error) {
      console.error(`Error loading content for ${file.name}:`, error);
      throw error;
    }
  }

  /**
   * Save content back to the file's storage location
   */
  async saveFileContent(file: FileItem, content: string): Promise<FileItem> {
    try {
      switch (file.storage) {
        case 'native':
          return await this.saveNativeFileContent(file, content);
        case 'github':
          return await this.saveGitHubFileContent(file, content);
        case 'pinata':
          return await this.savePinataFileContent(file, content);
        case 'ipfs':
          return await this.saveIPFSFileContent(file, content);
        case 'codeberg':
          return await this.saveCodebergFileContent(file, content);
        case 'neon':
          return await this.saveNeonFileContent(file, content);
        default:
          throw new Error(`Unsupported storage type for saving: ${file.storage}`);
      }
    } catch (error) {
      console.error(`Error saving content for ${file.name}:`, error);
      throw error;
    }
  }

  /**
   * Extract metadata from file content for minter auto-fill
   */
  extractFileMetadata(file: FileItem, content: string) {
    try {
      // Try to parse as JSON first (for scroll files)
      if (file.mimeType === 'application/json' || file.name.endsWith('.json')) {
        const jsonData = JSON.parse(content);
        return {
          title: jsonData.title || file.name,
          author: jsonData.author || 'Unknown',
          eth_address: jsonData.eth_address || '',
          abstract: jsonData.abstract || '',
          cid: file.cid || '',
          hash: file.hash || this.generateHash(content),
          content: content
        };
      }

      // For markdown files
      if (file.mimeType === 'text/markdown' || file.name.endsWith('.md')) {
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : file.name;
        
        return {
          title,
          author: 'Unknown',
          eth_address: '',
          abstract: content.substring(0, 200) + '...',
          cid: file.cid || '',
          hash: file.hash || this.generateHash(content),
          content: content
        };
      }

      // For any other text file
      return {
        title: file.name,
        author: 'Unknown',
        eth_address: '',
        abstract: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        cid: file.cid || '',
        hash: file.hash || this.generateHash(content),
        content: content
      };

    } catch (error) {
      console.error('Error extracting metadata:', error);
      return {
        title: file.name,
        author: 'Unknown',
        eth_address: '',
        abstract: 'Unable to parse file content',
        cid: file.cid || '',
        hash: file.hash || this.generateHash(content),
        content: content
      };
    }
  }

  // Native storage (localStorage)
  private async loadNativeFileContent(file: FileItem): Promise<string> {
    // For native files, content should already be stored in the file object
    // This is a fallback for any native files without content
    return file.content || `// Native file: ${file.name}\n// Content not found`;
  }

  private async saveNativeFileContent(file: FileItem, content: string): Promise<FileItem> {
    // For native files, we just update the content and return the updated file
    // The parent component will handle updating the files map
    return {
      ...file,
      content,
      lastModified: new Date().toISOString(),
      size: new Blob([content]).size,
      hash: this.generateHash(content)
    };
  }

  // GitHub integration
  private async loadGitHubFileContent(file: FileItem): Promise<string> {
    const sourceConfig = this.findSourceConfigForFile(file);
    if (!sourceConfig) {
      throw new Error('GitHub source configuration not found');
    }

    const { personal_access_token } = sourceConfig.secrets;
    
    // Extract repo and file path from file.path
    // Format: /repoOwner/repoName/filename
    const pathParts = file.path.split('/').filter(p => p);
    if (pathParts.length < 3) {
      throw new Error('Invalid GitHub file path');
    }

    const repoOwner = pathParts[0];
    const repoName = pathParts[1];
    const filePath = pathParts.slice(2).join('/');

    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${personal_access_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // GitHub returns content as base64 encoded
    if (data.content) {
      return atob(data.content.replace(/\n/g, ''));
    }

    throw new Error('No content found in GitHub file');
  }

  private async saveGitHubFileContent(file: FileItem, content: string): Promise<FileItem> {
    const sourceConfig = this.findSourceConfigForFile(file);
    if (!sourceConfig) {
      throw new Error('GitHub source configuration not found');
    }

    const { personal_access_token } = sourceConfig.secrets;
    
    // Extract repo and file path
    const pathParts = file.path.split('/').filter(p => p);
    const repoOwner = pathParts[0];
    const repoName = pathParts[1];
    const filePath = pathParts.slice(2).join('/');

    // First, get the current file SHA (required for updates)
    const getUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
    const getResponse = await fetch(getUrl, {
      headers: {
        'Authorization': `Bearer ${personal_access_token}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    let sha: string | undefined;
    if (getResponse.ok) {
      const currentFile = await getResponse.json();
      sha = currentFile.sha;
    }

    // Update the file
    const updateUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
    const updateData = {
      message: `Update ${file.name} via Scroll Forge`,
      content: btoa(content), // Base64 encode content
      ...(sha && { sha }) // Include SHA if file exists
    };

    const updateResponse = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${personal_access_token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to save to GitHub: ${updateResponse.statusText}`);
    }

    return {
      ...file,
      content,
      lastModified: new Date().toISOString(),
      size: new Blob([content]).size,
      hash: this.generateHash(content)
    };
  }

  // Pinata IPFS integration
  private async loadPinataFileContent(file: FileItem): Promise<string> {
    if (!file.cid) {
      throw new Error('No CID found for Pinata file');
    }

    // Load content from IPFS using the CID
    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${file.cid}`;
    
    const response = await fetch(ipfsUrl);
    if (!response.ok) {
      throw new Error(`Failed to load from IPFS: ${response.statusText}`);
    }

    return await response.text();
  }

  private async savePinataFileContent(file: FileItem, content: string): Promise<FileItem> {
    const sourceConfig = this.findSourceConfigForFile(file);
    if (!sourceConfig) {
      throw new Error('Pinata source configuration not found');
    }

    const { api_key, api_secret, jwt } = sourceConfig.secrets;
    
    // Create form data for file upload
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('file', blob, file.name);
    
    // Add metadata
    const metadata = JSON.stringify({
      name: file.name,
      keyvalues: {
        type: 'scroll-forge-file',
        original_id: file.id,
        updated: new Date().toISOString()
      }
    });
    formData.append('pinataMetadata', metadata);

    // Upload to Pinata
    const headers: Record<string, string> = {};
    
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
    } else if (api_key && api_secret) {
      headers['pinata_api_key'] = api_key;
      headers['pinata_secret_api_key'] = api_secret;
    }

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers,
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Pinata upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      ...file,
      content,
      cid: result.IpfsHash,
      lastModified: new Date().toISOString(),
      size: new Blob([content]).size,
      hash: this.generateHash(content)
    };
  }

  // Generic IPFS loading
  private async loadIPFSFileContent(file: FileItem): Promise<string> {
    if (!file.cid) {
      throw new Error('No CID found for IPFS file');
    }

    // Try multiple IPFS gateways
    const gateways = [
      `https://ipfs.io/ipfs/${file.cid}`,
      `https://gateway.pinata.cloud/ipfs/${file.cid}`,
      `https://cloudflare-ipfs.com/ipfs/${file.cid}`
    ];

    for (const gateway of gateways) {
      try {
        const response = await fetch(gateway);
        if (response.ok) {
          return await response.text();
        }
      } catch (error) {
        console.warn(`Failed to load from gateway ${gateway}:`, error);
      }
    }

    throw new Error('Failed to load content from any IPFS gateway');
  }

  private async saveIPFSFileContent(file: FileItem, content: string): Promise<FileItem> {
    // For generic IPFS, we'd need to use a service like Pinata or run our own node
    // For now, throw an error suggesting to use Pinata
    throw new Error('Direct IPFS saving not supported. Please use Pinata integration.');
  }

  // Codeberg integration (similar to GitHub)
  private async loadCodebergFileContent(file: FileItem): Promise<string> {
    const sourceConfig = this.findSourceConfigForFile(file);
    if (!sourceConfig) {
      throw new Error('Codeberg source configuration not found');
    }

    const { access_token } = sourceConfig.secrets;
    
    const pathParts = file.path.split('/').filter(p => p);
    const repoOwner = pathParts[0];
    const repoName = pathParts[1];
    const filePath = pathParts.slice(2).join('/');

    const apiUrl = `https://codeberg.org/api/v1/repos/${repoOwner}/${repoName}/contents/${filePath}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Codeberg API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.content) {
      return atob(data.content.replace(/\n/g, ''));
    }

    throw new Error('No content found in Codeberg file');
  }

  private async saveCodebergFileContent(file: FileItem, content: string): Promise<FileItem> {
    // Similar implementation to GitHub but using Codeberg API
    throw new Error('Codeberg file saving not yet implemented');
  }

  // Neon database integration
  private async loadNeonFileContent(file: FileItem): Promise<string> {
    // For now, return mock SQL content
    return `-- Neon Database File: ${file.name}
-- This is a placeholder for actual database integration
-- TODO: Implement actual Neon database content loading

SELECT * FROM ${file.name.replace('.sql', '')} LIMIT 10;`;
  }

  private async saveNeonFileContent(file: FileItem, content: string): Promise<FileItem> {
    // For now, just update the content locally
    return {
      ...file,
      content,
      lastModified: new Date().toISOString(),
      size: new Blob([content]).size
    };
  }

  // Helper methods
  private findSourceConfigForFile(file: FileItem): ConfiguredSource | null {
    // Extract source ID from file ID pattern: source-{sourceId}-...
    const match = file.id.match(/^source-([^-]+)/);
    if (!match) return null;
    
    const sourceId = match[1];
    return this.configuredSources.find(s => s.id === sourceId) || null;
  }

  private generateHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
  }
}
