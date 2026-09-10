'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  parseLocalNodePairingFragment,
  submitLocalNodePairing,
} from '@/lib/node-pairing/client.mjs';
import styles from './pair.module.css';

type PairingResult =
  | { ok: true; state: 'pending'; nodeId: string }
  | { ok: false; status: number; code: string };

type ViewState =
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'failed'; conflict: boolean };

async function beginPairing(fragment: string): Promise<PairingResult> {
  const credential = parseLocalNodePairingFragment(fragment);
  return submitLocalNodePairing(credential) as Promise<PairingResult>;
}

export default function NodePairingPage() {
  const [view, setView] = useState<ViewState>({ phase: 'connecting' });
  const attempt = useRef<Promise<PairingResult> | null>(null);

  useLayoutEffect(() => {
    if (attempt.current === null) {
      const fragment = window.location.hash;
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
      attempt.current = beginPairing(fragment);
    }

    let current = true;
    void attempt.current.then((result) => {
      if (!current) return;
      if (result.ok) {
        setView({ phase: 'connected' });
      } else {
        setView({ phase: 'failed', conflict: result.code === 'NODE_PAIRING_STATE_CONFLICT' });
      }
    }).catch(() => {
      if (current) setView({ phase: 'failed', conflict: false });
    });
    return () => {
      current = false;
    };
  }, []);

  const failed = view.phase === 'failed';
  return (
    <main className={styles.shell}>
      <section
        className={styles.card}
        aria-live="polite"
        role={failed ? 'alert' : 'status'}
      >
        <div className={styles.mark} aria-hidden="true">M</div>
        <p className={styles.eyebrow}>MASTERMIND FAMILY NODE</p>
        {view.phase === 'connecting' ? (
          <>
            <h1>Connecting this computer</h1>
            <p>The protected local identity is being prepared automatically.</p>
            <div className={styles.pulse} aria-hidden="true" />
          </>
        ) : null}
        {view.phase === 'connected' ? (
          <>
            <h1>Pairing accepted</h1>
            <p>Mastermind will finish the connection automatically. You can close this tab.</p>
            <span className={styles.success}>READY</span>
          </>
        ) : null}
        {failed ? (
          <>
            <h1>{view.conflict ? 'This computer is already paired' : 'Pairing could not be completed'}</h1>
            <p>
              {view.conflict
                ? 'Its existing protected Family Node identity was left unchanged.'
                : 'Return to Mastermind and choose Pair this PC again. No manual code is needed.'}
            </p>
            <Link className={styles.link} href="/">Return to Mastermind</Link>
          </>
        ) : null}
      </section>
    </main>
  );
}
