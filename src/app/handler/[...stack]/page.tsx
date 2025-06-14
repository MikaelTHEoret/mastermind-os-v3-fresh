import { StackHandler } from '@stackframe/stack'
import { stackServerApp, isStackAuthEnabled } from '../../../stack'

export default function Handler(props: any) {
  // If Stack Auth is not configured, show a configuration message
  if (!isStackAuthEnabled || !stackServerApp) {
    return (
      <div className="min-h-screen bg-black text-cyan-400 flex items-center justify-center">
        <div className="text-center max-w-md p-8 border border-cyan-400/30 rounded-lg">
          <h1 className="text-2xl font-bold mb-4">Authentication Setup Required</h1>
          <p className="mb-4">
            Stack Auth is not configured. To enable authentication:
          </p>
          <ol className="text-left list-decimal list-inside space-y-2 text-sm">
            <li>Create a project at <a href="https://app.stack-auth.com" className="text-cyan-300 underline">Stack Auth Dashboard</a></li>
            <li>Add environment variables to your deployment platform</li>
            <li>Configure NEXT_PUBLIC_STACK_PROJECT_ID and STACK_SECRET_SERVER_KEY</li>
          </ol>
          <div className="mt-6">
            <a 
              href="/" 
              className="bg-cyan-400 text-black px-4 py-2 rounded hover:bg-cyan-300 transition-colors"
            >
              Return to App
            </a>
          </div>
        </div>
      </div>
    )
  }

  return <StackHandler fullPage app={stackServerApp} {...props} />
}