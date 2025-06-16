'use client';
import React from 'react';
import styles from './NexusCoreSection.module.scss';

interface NexusCoreSectionProps {
  coreEnergy?: number;
}

export default function NexusCoreSection({
  coreEnergy = 84,
}: NexusCoreSectionProps) {
  return (
    <div className={styles.wrapper}>
      {/* Rotating Core */}
      <div className={styles.rotatingCore}>
        <div className={styles.coreRing}></div>
        <div className={styles.coreCenter}></div>
      </div>

      {/* Development Notice */}
      <div className={styles.developmentNotice}>
        <h2>NEXUS CORE</h2>
        <p>System Integration Hub - In Development</p>
        <div className={styles.energyLevel}>
          Core Energy: {Math.round(coreEnergy)}%
        </div>
      </div>
    </div>
  );
}