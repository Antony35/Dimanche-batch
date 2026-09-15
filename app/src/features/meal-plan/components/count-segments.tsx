import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export interface CountSegmentsProps {
  choices: readonly number[];
  value: number;
  onChange: (count: number) => void;
  /** Pour la lecture d'écran : « 4 plats ». */
  unit: string;
}

/**
 * Une rangée de chiffres dont un seul est choisi.
 *
 * Partagée par les deux réglages de la génération : ils se lisent côte à côte,
 * et deux rangées dessinées différemment feraient croire à deux sortes de
 * choix.
 */
export function CountSegments({ choices, value, onChange, unit }: CountSegmentsProps) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {choices.map((count) => {
        const active = count === value;
        return (
          <Pressable
            key={count}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${count} ${unit}`}
            onPress={() => onChange(count)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: active ? theme.colors.accent : theme.colors.line,
              backgroundColor: active ? theme.colors.accentSoft : 'transparent',
            }}
          >
            <Text
              variant="bodyStrong"
              style={{ color: active ? theme.colors.accent : theme.colors.inkSoft }}
            >
              {count}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
