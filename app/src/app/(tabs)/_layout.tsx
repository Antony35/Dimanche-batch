import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTintColor: theme.colors.ink,
        headerShadowVisible: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.inkFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.bgRaised,
          borderTopColor: theme.colors.lineSoft,
        },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Aujourd'hui",
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="planning"
        options={{
          title: 'Planning',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: 'Courses',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="historique"
        options={{
          title: 'Historique',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
