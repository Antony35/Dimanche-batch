import { SegmentedSwitch } from '@/components/ui';

export interface WeekSwitchProps {
  /** Vrai si la semaine affichée est celle qu'on mange. */
  showingCurrent: boolean;
  onChange: (showCurrent: boolean) => void;
}

const OPTIONS = [
  { value: 'current', label: 'Cette semaine' },
  { value: 'upcoming', label: 'Semaine prochaine' },
] as const;

/**
 * Bascule entre la semaine en cours et celle à préparer.
 *
 * Les deux coexistent en permanence dans ce cycle : on mange celle du samedi
 * dernier pendant qu'on achète et cuisine la suivante. Chaque écran s'ouvre sur
 * la sienne, mais doit laisser aller voir l'autre.
 */
export function WeekSwitch({ showingCurrent, onChange }: WeekSwitchProps) {
  return (
    <SegmentedSwitch
      options={OPTIONS}
      value={showingCurrent ? 'current' : 'upcoming'}
      onChange={(value) => onChange(value === 'current')}
    />
  );
}
