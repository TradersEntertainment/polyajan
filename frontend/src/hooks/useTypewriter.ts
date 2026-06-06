import { useState, useEffect, useCallback } from 'react';

export function useTypewriter(text: string, speed = 35, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);

  const done = started && displayed.length >= text.length;

  useEffect(() => {
    const delayTimer = setTimeout(() => setStarted(true), startDelay);
    return () => clearTimeout(delayTimer);
  }, [startDelay]);

  useEffect(() => {
    if (!started) return;
    if (displayed.length >= text.length) {
      return;
    }
    const timer = setTimeout(() => {
      setDisplayed(text.slice(0, displayed.length + 1));
    }, speed);
    return () => clearTimeout(timer);
  }, [displayed, text, speed, started]);

  const reset = useCallback(() => {
    setDisplayed('');
    setStarted(false);
  }, []);

  return { displayed, done, reset };
}
