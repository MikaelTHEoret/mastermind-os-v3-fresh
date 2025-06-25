// Type declarations for enterprise components
import React from 'react';

declare module '@/components/enterprise/AnalyticsDashboard' {
  const AnalyticsDashboard: React.ComponentType;
  export default AnalyticsDashboard;
}

declare module '@/components/enterprise/OrganizationManagement' {
  const OrganizationManagement: React.ComponentType;
  export default OrganizationManagement;
}

declare module '@/components/enterprise/AgentScalingSystem' {
  const AgentScalingSystem: React.ComponentType;
  export default AgentScalingSystem;
}

// Export for convenience
export {};