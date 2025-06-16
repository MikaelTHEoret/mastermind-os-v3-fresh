'use client';
import React, { useEffect } from 'react';
import clsx from 'clsx';
import styles from './NexusCoreSection.module.scss';

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

      {/* Simple Metric Buttons */}
      <div className={styles.metricButtons}>
        <button
          className={styles.metricButton}
          onClick={() => triggerPulse('core')}
          style={{ color: '#00ffff' }}
        >
          Core: {Math.round(coreEnergy)}%
        </button>
        <button
          className={styles.metricButton}
          onClick={() => triggerPulse('nodes')}
          style={{ color: '#ff00ff' }}
        >
          Nodes: {connectionNodes}
        </button>
        <button
          className={styles.metricButton}
          onClick={() => triggerPulse('agents')}
          style={{ color: '#ffff00' }}
        >
          Agents: {activeAgents}
        </button>
      </div>

      {/* Original Enhanced Nexus Core content */}
      <div className={styles.nexusCore}>
        NEXUS CORE
      </div>
    </div>
  );
}