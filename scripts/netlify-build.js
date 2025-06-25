const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Netlify-compatible Next.js build...');

// Set environment variables for Netlify
process.env.SKIP_TYPE_CHECK = 'true';
process.env.SKIP_LINT = 'true';
process.env.NODE_ENV = 'production';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.CI = 'true';

console.log('✅ Environment variables configured for Netlify');

try {
  console.log('📁 Checking project structure...');
  
  // Check if key directories exist
  const srcDir = path.join(process.cwd(), 'src');
  const libDir = path.join(srcDir, 'lib');
  const apiDir = path.join(srcDir, 'app', 'api');
  
  console.log('🔍 src directory exists:', fs.existsSync(srcDir));
  console.log('🔍 lib directory exists:', fs.existsSync(libDir));
  console.log('🔍 API directory exists:', fs.existsSync(apiDir));
  
  if (fs.existsSync(libDir)) {
    const libContents = fs.readdirSync(libDir);
    console.log('📂 lib contents:', libContents.join(', '));
    
    // Check for specific lib files
    const requiredFiles = ['auth.ts', 'db'];
    for (const file of requiredFiles) {
      const filePath = path.join(libDir, file);
      const exists = fs.existsSync(filePath);
      console.log(`🔍 ${file} exists:`, exists);
    }
  }
  
  // Check tsconfig.json
  console.log('🔍 Checking TypeScript configuration...');
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    console.log('📋 TypeScript baseUrl:', tsconfig.compilerOptions?.baseUrl);
    console.log('📋 TypeScript paths:', JSON.stringify(tsconfig.compilerOptions?.paths, null, 2));
  }
  
  console.log('🏗️ Running Next.js build (standalone mode)...');
  
  // Run the build with proper error handling
  const buildResult = execSync('npx next build', { 
    stdio: 'pipe',
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_TYPE_CHECK: 'true',
      SKIP_LINT: 'true'
    }
  });
  
  console.log('📝 Build output:');
  console.log(buildResult.toString());

  console.log('📦 Checking build output...');
  
  // Check if .next exists
  const nextDir = path.join(process.cwd(), '.next');
  if (fs.existsSync(nextDir)) {
    console.log('✅ .next directory created successfully');
    
    // List contents
    const contents = fs.readdirSync(nextDir);
    console.log('📂 Build output contents:', contents.join(', '));
    
    // Check for standalone output
    const standaloneDir = path.join(nextDir, 'standalone');
    console.log('🔍 Standalone directory exists:', fs.existsSync(standaloneDir));
    
    // Check for server directory
    const serverDir = path.join(nextDir, 'server');
    console.log('🔍 Server directory exists:', fs.existsSync(serverDir));
    
  } else {
    console.error('❌ .next directory not found!');
    process.exit(1);
  }

  console.log('🎉 Netlify build completed successfully!');
  
} catch (error) {
  console.error('❌ Build failed:', error.message);
  if (error.stdout) {
    console.error('STDOUT:', error.stdout.toString());
  }
  if (error.stderr) {
    console.error('STDERR:', error.stderr.toString());
  }
  process.exit(1);
}