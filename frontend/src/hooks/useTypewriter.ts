import { useState, useEffect, useCallback } from 'react';

export function useTypewriter(text: string, speed = 35, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const delayTimer = setTimeout(() => setStarted(true), startDelay);
    return () => clearTimeout(delayTimer);
  }, [startDelay]);

  useEffect(() => {
    if (!started) return;
    if (displayed.length >= text.length) {
      setDone(true);
      return;
    }
    const timer = setTimeout(() => {
      setDisplayed(text.slice(0, displayed.length + 1));
    }, speed);
    return () => clearTimeout(timer);
  }, [displayed, text, speed, started]);

  const reset = useCallback(() => {
    setDisplayed('');
    setDone(false);
    setStarted(false);
  }, []);

  return { displayed, done, reset };
}
