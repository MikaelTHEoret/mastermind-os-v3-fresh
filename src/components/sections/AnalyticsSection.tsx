'use client';

import { BarChart3 } from 'lucide-react';
import { getTheme } from '@/lib/theme-config';

const theme = getTheme('analytics');

export default function AnalyticsSection() {
  return (
    <div 
      className="p-6 h-full flex flex-col items-center justify-center"
      style={{
        background: 'transparent',  // Completely transparent to show sacred geometry
        // Remove backdropFilter to showcase background
        color: theme.textColor
      }}
    >
      <BarChart3 className="h-16 w-16 mb-4" style={{ color: theme.primaryColor }} />
      <h2 className="text-2xl font-bold mb-2" style={{ color: theme.primaryColor }}>
        {theme.name}
      </h2>
      <p className="text-center opacity-80">
        {theme.description} - Coming Soon
      </p>
    </div>
  );
}