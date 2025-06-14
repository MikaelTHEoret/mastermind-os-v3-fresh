import { StackHandler } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '../../../stack'

export default function Handler(props: any) {
  // If Stack Auth is not configured, show a configuration message
  if (!isStackAuthEnabled) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 border border-cyan-500/30 rounded-lg bg-black/50">
          <h1 className="text-xl font-bold text-cyan-400 mb-4">Authentication Setup Required</h1>
          <p className="text-cyan-300 mb-4">
            Stack Auth is not configured. To enable authentication:
          </p>
          <ol className="text-cyan-200 text-sm space-y-2">
            <li>1. Create a project at Stack Auth Dashboard</li>
            <li>2. Add environment variables to your deployment platform</li>
            <li>3. Configure NEXT_PUBLIC_STACK_PROJECT_ID and STACK_SECRET_SERVER_KEY</li>
          </ol>
          <a 
            href="/"
            className="inline-block mt-4 px-4 py-2 bg-cyan-600 text-black rounded hover:bg-cyan-500 transition-colors"
          >
            Return to App
          </a>
        </div>
      </div>
    )
  }

  return <StackHandler fullPage app={stackServerApp} {...props} />
}