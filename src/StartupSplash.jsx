import { useEffect, useState } from 'react';
import './StartupSplash.css';

export default function StartupSplash({ isLoading, onComplete }) {
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [isTakingLonger, setIsTakingLonger] = useState(false);
  const [continueRequested, setContinueRequested] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minimum = window.setTimeout(() => setMinimumElapsed(true), reducedMotion ? 0 : 1100);
    const slowNotice = window.setTimeout(() => setIsTakingLonger(true), 6500);
    return () => {
      window.clearTimeout(minimum);
      window.clearTimeout(slowNotice);
    };
  }, []);

  useEffect(() => {
    if (!minimumElapsed || (isLoading && !continueRequested)) return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setIsLeaving(true);
    const timer = window.setTimeout(() => onComplete(false), reducedMotion ? 0 : 320);
    return () => window.clearTimeout(timer);
  }, [minimumElapsed, continueRequested, isLoading, onComplete]);

  return (
    <div className={`startup-splash${isLeaving ? ' startup-splash--leaving' : ''}`}>
      <div className="startup-splash__content">
        <div className="startup-splash__emblem">
        <img className="startup-splash__logo" src="/icons/kole-512.png"
          width="512" height="512" alt="KOLE Trucking LLC" />
        </div>
        <p className="startup-splash__name">Kole Connect Mobile</p>
        <p className="startup-splash__tagline">Built for the Road.</p>
        <div className="startup-splash__route" aria-hidden="true"><span /></div>
        <p className="startup-splash__status" role="status" aria-live="polite">
          {isLoading
            ? 'Checking today’s work…'
            : 'Welcome aboard.'}
        </p>
        {isLoading && isTakingLonger && (
          <div className="startup-splash__slow">
            <p>You can keep waiting or continue while loading finishes.</p>
            <button type="button" disabled={isLeaving} onClick={() => setContinueRequested(true)}>
              Continue to app
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
