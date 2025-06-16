'use client';
import React, { useEffect } from 'react';
import clsx from 'clsx';
import styles from './NexusCoreSection.module.scss';
import CircuitHexButton from './CircuitHexButton';

interface NexusCoreSectionProps {
  coreEnergy?: number;
  connectionNodes?: number;
  activeAgents?: number;
}

export default function NexusCoreSection({
  coreEnergy = 84,
  connectionNodes = 8,
  activeAgents = 6,
}: NexusCoreSectionProps) {
  useEffect(() => {
    if (!document.getElementById('burst-overlay')) {
      const el = document.createElement('div');
      el.id = 'burst-overlay';
      document.body.append(el);
    }
  }, []);

  function triggerPulse(key: 'core' | 'nodes' | 'agents') {
    const burst = document.createElement('div');
    burst.className = styles[`burst-${key}`];
    document.getElementById('burst-overlay')?.appendChild(burst);
    setTimeout(() => burst.remove(), 1000);

    const path = document.getElementById(`flow_${key}`);
    if (path) {
      path.classList.add(styles.flowActive);
      setTimeout(() => path.classList.remove(styles.flowActive), 800);
    }
  }

  return (
    <div className={styles.wrapper}>
      {/* Enhanced Circuit Flow Overlay */}
      <svg className={styles.overlaySvg}>
        <path
          id="flow_core"
          d="M200,640 C320,640 500,600 640,640"
          className={clsx(styles.pathCore, styles.pathCommon)}
        />
        <path
          id="flow_nodes"
          d="M200,740 C320,740 500,720 640,740"
          className={clsx(styles.pathNodes, styles.pathCommon)}
        />
        <path
          id="flow_agents"
          d="M200,840 C320,840 500,780 640,840"
          className={clsx(styles.pathAgents, styles.pathCommon)}
        />
      </svg>

      {/* Interactive Circuit Hex Buttons */}
      <CircuitHexButton
        label={`${Math.round(coreEnergy)}%`}
        x={200}
        y={640}
        onClick={() => triggerPulse('core')}
        color="#00ffff"
      />
      <CircuitHexButton
        label={`${connectionNodes}`}
        x={200}
        y={740}
        onClick={() => triggerPulse('nodes')}
        color="#ff00ff"
      />
      <CircuitHexButton
        label={`${activeAgents}`}
        x={200}
        y={840}
        onClick={() => triggerPulse('agents')}
        color="#ffff00"
      />

      {/* Original Enhanced Nexus Core content would go here */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '400px',
        height: '400px',
        border: '2px solid #00ffff',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0, 255, 255, 0.1) 0%, transparent 70%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        color: '#00ffff',
        fontFamily: 'Orbitron, monospace',
        zIndex: 5
      }}>
        NEXUS CORE
      </div>
    </div>
  );
}