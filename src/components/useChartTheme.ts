import { useEffect, useState } from 'react';

/** ECharts uses resolved colors, so redraw when the system or user theme changes. */
export function useChartTheme() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => setVersion((v) => v + 1);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', changed);
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { scheme.removeEventListener('change', changed); observer.disconnect(); };
  }, []);
  return version;
}
