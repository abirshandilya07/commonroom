import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
export default function ThemeToggle({rail = false}: {rail?: boolean}) {
  const {theme, toggle} = useTheme();
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
  return <button type="button" onClick={toggle} aria-label={label} title={label} className={rail ? 'rail-button' : 'icon-button'}>
    {theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}
  </button>;
}
