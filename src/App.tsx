import { useEffect, useMemo, useState } from 'react';
import { CalendarScreen } from './features/calendar/CalendarScreen';
import { CalendarPortabilityService } from './domain/portability';
import { CalendarYearProjectService } from './domain/yearProject';
import { TauriCalendarRepository } from './platform/TauriCalendarRepository';
import { TauriWorkspaceManager } from './platform/TauriWorkspaceManager';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('calendar-studio-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const repository = useMemo(() => new TauriCalendarRepository(), []);
  const portability = useMemo(() => new CalendarPortabilityService(repository), [repository]);
  const yearProjects = useMemo(() => new CalendarYearProjectService(repository), [repository]);
  const workspace = useMemo(() => new TauriWorkspaceManager(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('calendar-studio-theme', theme);
  }, [theme]);

  return <CalendarScreen theme={theme} repository={repository} portability={portability} yearProjects={yearProjects} workspace={workspace} onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} />;
}
