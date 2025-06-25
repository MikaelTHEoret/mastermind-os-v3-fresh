// 🌀 Validation Status Component
// Real-time validation feedback for Web3 integration

'use client';

import { CheckCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';

interface ValidationStatusProps {
  label: string;
  value: string;
  validationFn: (value: string) => boolean;
  validMessage?: string;
  invalidMessage?: string;
  isLoading?: boolean;
  showDetails?: boolean;
}

export default function ValidationStatus({
  label,
  value,
  validationFn,
  validMessage = 'Valid',
  invalidMessage = 'Invalid',
  isLoading = false,
  showDetails = false
}: ValidationStatusProps) {
  
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: 'rgba(100, 100, 100, 0.1)',
        border: '1px solid rgba(100, 100, 100, 0.3)',
        borderRadius: '4px',
        fontSize: '12px'
      }}>
        <Loader2 style={{ width: '14px', height: '14px' }} className="animate-spin" />
        <span>Validating {label}...</span>
      </div>
    );
  }

  if (!value || value.trim().length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: 'rgba(100, 100, 100, 0.1)',
        border: '1px solid rgba(100, 100, 100, 0.3)',
        borderRadius: '4px',
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.6)'
      }}>
        <Info style={{ width: '14px', height: '14px' }} />
        <span>{label} required</span>
      </div>
    );
  }

  const isValid = validationFn(value);
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      background: isValid ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)',
      border: `1px solid ${isValid ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 68, 68, 0.3)'}`,
      borderRadius: '4px',
      fontSize: '12px',
      color: isValid ? 'rgba(0, 255, 136, 1)' : 'rgba(255, 68, 68, 1)'
    }}>
      {isValid ? (
        <CheckCircle style={{ width: '14px', height: '14px' }} />
      ) : (
        <AlertTriangle style={{ width: '14px', height: '14px' }} />
      )}
      <span>{isValid ? validMessage : invalidMessage}</span>
      {showDetails && (
        <span style={{ opacity: 0.7, fontSize: '11px' }}>
          ({value.substring(0, 10)}...)
        </span>
      )}
    </div>
  );
}
