import { Alert } from 'react-native';

/**
 * Confirmation avant de retirer un plat du batch.
 *
 * Le geste se défait mal — reprendre un plat coûte une génération —, et il est
 * proposé depuis deux écrans : le dimanche et la feuille de choix du planning.
 */
export function confirmBatchRemoval(recipeName: string, mealCount: number, onConfirm: () => void) {
  const meals =
    mealCount > 1 ? `Ses ${mealCount} repas passent` : mealCount === 1 ? 'Son repas passe' : null;
  Alert.alert(
    `Retirer « ${recipeName} » du batch ?`,
    `Il ne sera ni cuisiné dimanche ni acheté.${
      meals ? ` ${meals} à décider : un reste, un repas dehors ou une portion d’un autre plat.` : ''
    }`,
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: onConfirm },
    ],
  );
}
