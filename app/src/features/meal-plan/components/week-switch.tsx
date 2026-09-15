import { SegmentedSwitch } from '@/components/ui';

/** Semaine affichée, relative à celle qu'on mange : 0, ou la suivante. */
export type WeekOffset = 0 | 1;

type WeekKey = 'current' | 'next';

export interface WeekSwitchProps {
  value: WeekOffset;
  onChange: (offset: WeekOffset) => void;
}

const OPTIONS = [
  { value: 'current', label: 'Cette semaine' },
  { value: 'next', label: 'Semaine prochaine' },
] as const;

const KEY_BY_OFFSET: Record<WeekOffset, WeekKey> = { 0: 'current', 1: 'next' };
const OFFSET_BY_KEY: Record<WeekKey, WeekOffset> = { current: 0, next: 1 };

/**
 * Bascule entre la semaine en cours et celle à préparer.
 *
 * Les deux coexistent en permanence dans ce cycle : on mange celle du samedi
 * dernier pendant qu'on achète et cuisine la suivante. Chaque écran s'ouvre sur
 * la sienne, mais doit laisser aller voir l'autre.
 */
export function WeekSwitch({ value, onChange }: WeekSwitchProps) {
  return (
    <SegmentedSwitch
      options={OPTIONS}
      value={KEY_BY_OFFSET[value]}
      onChange={(key) => onChange(OFFSET_BY_KEY[key])}
    />
  );
}
