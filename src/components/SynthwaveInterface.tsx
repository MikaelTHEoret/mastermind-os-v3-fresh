'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, Brain, Cpu, Database, 
  Globe, Monitor, Network, Puzzle,
  Sparkles, Zap, TrendingUp, Target
} from 'lucide-react';

export default function SynthwaveInterface() {
  const [systemTime, setSystemTime] = useState(new Date());
  const [metrics, setMetrics] = useState({
    cpu: 67,
    memory: 51,
    pendingTasks: 12,
    processingTasks: 5,
    completedTasks: 847
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setSystemTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const metricsTimer = setInterval(() => {
      setMetrics(prev => ({
        ...prev,
        cpu: Math.max(60, Math.min(90, prev.cpu + (Math.random() - 0.5) * 10)),
        pendingTasks: Math.max(8, prev.pendingTasks + Math.floor((Math.random() - 0.5) * 4)),
        processingTasks: Math.max(3, prev.processingTasks + Math.floor((Math.random() - 0.5) * 2)),
        completedTasks: prev.completedTasks + Math.floor(Math.random() * 3)
      }));
    }, 3000);
    return () => clearInterval(metricsTimer);
  }, []);

  return (
    <div className="h-full bg-gradient-to-br from-black via-zinc-900 to-black p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-4">
            ⚡ NEXUS CORE ⚡
          </h1>
          <p className="text-zinc-400">Central command interface for consciousness-driven development</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
          
          {/* Autonomous Agents Panel */}
          <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-6 overflow-y-auto">
            <h3 className="text-lg font-bold text-cyan-400 mb-6 flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AUTONOMOUS AGENTS
            </h3>
            
            <div className="space-y-4">
              <Card className="bg-black/40 border-cyan-500/30 hover:border-cyan-500/70 transition-all">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm text-cyan-400">TASK_EXECUTOR_001</CardTitle>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/50">ACTIVE</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">CPU:</span>
                      <span className="text-cyan-400 font-bold">73%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Tasks:</span>
                      <span className="text-cyan-400 font-bold">3</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-cyan-500/30 hover:border-cyan-500/70 transition-all">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm text-cyan-400">NEURAL_PROCESSOR_002</CardTitle>
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">PROCESSING</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">CPU:</span>
                      <span className="text-cyan-400 font-bold">89%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Tasks:</span>
                      <span className="text-cyan-400 font-bold">7</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-cyan-500/30 hover:border-cyan-500/70 transition-all">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm text-cyan-400">MEMORY_MANAGER_003</CardTitle>
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50">OPTIMIZING</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">CPU:</span>
                      <span className="text-cyan-400 font-bold">45%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Tasks:</span>
                      <span className="text-cyan-400 font-bold">2</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Nexus Core Main */}
          <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-8 text-center">
            <h2 className="text-2xl font-bold text-cyan-400 mb-6">NEXUS CORE ORCHESTRATION</h2>
            
            {/* Core Energy Display */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <Card className="bg-black/40 border-cyan-500/30">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-cyan-400">75%</div>
                  <div className="text-xs text-zinc-400 mt-1">CORE ENERGY</div>
                </CardContent>
              </Card>
              
              <Card className="bg-black/40 border-purple-500/30">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-purple-400">8</div>
                  <div className="text-xs text-zinc-400 mt-1">ACTIVE NODES</div>
                </CardContent>
              </Card>
              
              <Card className="bg-black/40 border-green-500/30">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-400">8</div>
                  <div className="text-xs text-zinc-400 mt-1">AGENTS</div>
                </CardContent>
              </Card>
            </div>

            {/* Core Circle */}
            <div className="relative mx-auto mb-8">
              <div className="w-48 h-48 rounded-full border-2 border-cyan-500/60 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 mx-auto relative animate-pulse">
                <div className="absolute inset-8 rounded-full border border-purple-500/40 bg-gradient-to-br from-purple-500/30 to-cyan-500/30">
                  <div className="absolute inset-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-400 shadow-lg shadow-cyan-500/50">
                  </div>
                </div>
              </div>
            </div>
            
            {/* Control Buttons */}
            <div className="grid grid-cols-1 gap-3">
              <Button 
                variant="outline"
                className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:border-red-400"
              >
                DISABLE CORE
              </Button>
              <Button 
                variant="outline"
                className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-400"
              >
                OPTIMIZE MATRIX
              </Button>
              <Button 
                variant="outline"
                className="border-purple-500/50 text-purple-400 hover:bg-purple-500/20 hover:border-purple-400"
              >
                NEURAL SYNC
              </Button>
            </div>
          </div>

          {/* Metrics Panel */}
          <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-6 overflow-y-auto">
            <h3 className="text-lg font-bold text-cyan-400 mb-6 flex items-center gap-2">
              <Activity className="h-5 w-5" />
              SYSTEM METRICS
            </h3>
            
            <div className="space-y-6">
              
              {/* System Resources */}
              <Card className="bg-black/40 border-cyan-500/30">
                <CardHeader>
                  <CardTitle className="text-sm text-cyan-400 flex items-center gap-2">
                    <Cpu className="h-4 w-4" />
                    SYSTEM RESOURCES
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-400">CPU Usage:</span>
                      <span className="text-cyan-400 font-bold">{Math.round(metrics.cpu)}%</span>
                    </div>
                    <div className="w-full bg-zinc-700/50 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${metrics.cpu}%` }}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-zinc-400">Memory:</span>
                      <span className="text-cyan-400 font-bold">8.2GB / 16GB</span>
                    </div>
                    <div className="w-full bg-zinc-700/50 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                        style={{ width: '51%' }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Task Queue */}
              <Card className="bg-black/40 border-cyan-500/30">
                <CardHeader>
                  <CardTitle className="text-sm text-cyan-400 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    TASK QUEUE
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Pending:</span>
                    <span className="text-orange-400 font-bold">{metrics.pendingTasks}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Processing:</span>
                    <span className="text-yellow-400 font-bold">{metrics.processingTasks}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Completed:</span>
                    <span className="text-green-400 font-bold">{metrics.completedTasks}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Neural Network */}
              <Card className="bg-black/40 border-cyan-500/30">
                <CardHeader>
                  <CardTitle className="text-sm text-cyan-400 flex items-center gap-2">
                    <Network className="h-4 w-4" />
                    NEURAL NETWORK
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Active Nodes:</span>
                    <span className="text-cyan-400 font-bold">847</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Connections:</span>
                    <span className="text-green-400 font-bold">4,329</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Latency:</span>
                    <span className="text-cyan-400 font-bold">23ms</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}