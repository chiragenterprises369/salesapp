'use client';

import { Clock, Moon, Sun, SunMoon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/common/popover';
import { ScheduleFields, THEME_MODE_LABEL, ThemeModeRadio } from '@/components/common/theme-mode-picker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

/**
 * Top-bar theme control (all panels and auth pages): System, Light, Dark, Scheduled (+ hours).
 * Changes apply instantly and are saved to the user's settings when signed in.
 */
export function ThemeToggle({ size = 'icon', className }: { size?: 'icon' | 'icon-touch'; className?: string }) {
  const { preference, resolved, timeZone, setPreference } = useTheme();
  const Icon = preference.mode === 'scheduled' ? Clock : preference.mode === 'system' ? SunMoon : resolved === 'dark' ? Moon : Sun;
  const label = `Theme: ${THEME_MODE_LABEL[preference.mode]}${preference.mode === 'system' || preference.mode === 'scheduled' ? `, ${resolved} now` : ''}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size={size} aria-label={label} title={label} className={cn(className)}>
          <Icon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" aria-label="Theme">
        <p className="mb-2 px-1 text-xs font-medium text-muted">Theme</p>
        <ThemeModeRadio label="Theme" value={preference.mode} onValueChange={(mode) => void setPreference({ mode })} />
        {preference.mode === 'scheduled' && (
          <div className="mt-3 border-t border-border px-1 pt-3">
            <ScheduleFields
              darkFrom={preference.darkFrom}
              darkTo={preference.darkTo}
              timeZone={timeZone}
              onChange={(patch) => void setPreference(patch)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
