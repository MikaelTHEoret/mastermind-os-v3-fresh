import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userSecrets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getIronSession } from 'iron-session';
import CryptoJS from 'crypto-js';

// Define session data interface
interface SessionData {
  userId?: string;
  username?: string;
  email?: string;
}

const sessionOptions = {
  password: process.env.SECRET_KEY!,
  cookieName: 'mastermind-session',
  ttl: 60 * 60 * 24 * 7, // 7 days
};

async function getUserSecret(userId: string, serviceName: string): Promise<string | null> {
  try {
    const secret = await db
      .select()
      .from(userSecrets)
      .where(and(
        eq(userSecrets.userId, userId),
        eq(userSecrets.serviceName, serviceName),
        eq(userSecrets.isActive, true)
      ))
      .limit(1);

    if (secret.length === 0) {
      return null;
    }

    // Decrypt the secret
    const encryptionKey = process.env.ENCRYPTION_KEY!;
    const iv = CryptoJS.enc.Hex.parse(secret[0].encryptedIv);
    const decrypted = CryptoJS.AES.decrypt(secret[0].encryptedValue, encryptionKey, { iv });
    
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error decrypting secret:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { repo, path, branch = 'main' } = await request.json();

    if (!repo || !path) {
      return NextResponse.json(
        { error: 'Repository and file path are required' },
        { status: 400 }
      );
    }

    // Validate repo format (owner/repo)
    const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
    if (!repoPattern.test(repo)) {
      return NextResponse.json(
        { error: 'Invalid repository format. Use: owner/repo-name' },
        { status: 400 }
      );
    }

    // Get user's GitHub token (optional for public repos)
    const githubToken = await getUserSecret(session.userId, 'github_token');

    // Prepare GitHub API headers
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MastermindOS-ScrollMinter/1.0',
    };

    if (githubToken) {
      headers['Authorization'] = `Bearer ${githubToken}`;
    }

    // Fetch file from GitHub
    const githubUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
    const response = await fetch(githubUrl, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'File not found. Check repository, path, and branch.' },
          { status: 404 }
        );
      } else if (response.status === 403) {
        return NextResponse.json(
          { error: 'Access denied. Repository may be private - add GitHub token.' },
          { status: 403 }
        );
      } else {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }
    }

    const data = await response.json();

    // Handle directory case
    if (Array.isArray(data)) {
      return NextResponse.json(
        { error: 'Path points to a directory, not a file' },
        { status: 400 }
      );
    }

    // Decode base64 content
    if (data.encoding !== 'base64') {
      return NextResponse.json(
        { error: 'Unsupported file encoding' },
        { status: 400 }
      );
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    // Validate JSON content
    let jsonData;
    try {
      jsonData = JSON.parse(content);
    } catch (parseError) {
      return NextResponse.json(
        { error: 'File is not valid JSON' },
        { status: 400 }
      );
    }

    // Extract metadata for scroll validation
    const fileInfo = {
      name: data.name,
      size: data.size,
      sha: data.sha,
      path: data.path,
      url: data.html_url,
      lastModified: data.sha // GitHub doesn't provide direct timestamp
    };

    // Generate content hash for integrity using SHA256
    const contentHash = CryptoJS.SHA256(content).toString();

    // Log the GitHub access for the user
    await logUserActivity(session.userId, 'github_file_access', {
      repo,
      path,
      branch,
      file_sha: data.sha,
      file_size: data.size,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      content,
      jsonData,
      fileInfo,
      contentHash,
      metadata: {
        source: 'github',
        repository: repo,
        path,
        branch,
        sha: data.sha
      }
    });

  } catch (error) {
    console.error('GitHub integration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load from GitHub' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions);
    
    if (!session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const repo = searchParams.get('repo');

    if (!repo) {
      return NextResponse.json(
        { error: 'Repository parameter is required' },
        { status: 400 }
      );
    }

    // Get user's GitHub token
    const githubToken = await getUserSecret(session.userId, 'github_token');

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MastermindOS-ScrollMinter/1.0',
    };

    if (githubToken) {
      headers['Authorization'] = `Bearer ${githubToken}`;
    }

    // List repository contents to help user find files
    const response = await fetch(`https://api.github.com/repos/${repo}/contents`, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const contents = await response.json();

    // Filter for JSON files
    const jsonFiles = contents
      .filter((item: any) => item.type === 'file' && item.name.endsWith('.json'))
      .map((item: any) => ({
        name: item.name,
        path: item.path,
        size: item.size,
        url: item.html_url
      }));

    return NextResponse.json({
      success: true,
      repository: repo,
      jsonFiles,
      totalFiles: contents.length
    });

  } catch (error) {
    console.error('Error listing GitHub repository:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list repository' },
      { status: 500 }
    );
  }
}

async function logUserActivity(userId: string, action: string, details: any) {
  try {
    // This would integrate with your audit log system
    console.log(`User Activity: ${userId} - ${action}`, details);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
}
