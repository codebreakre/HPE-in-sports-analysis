// A grid of stat tiles: big value, small label.
import { Paper, SimpleGrid, Text } from "@mantine/core";

export interface Stat {
  label: string;
  value: string | number;
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
      {stats.map((stat) => (
        <Paper key={stat.label} withBorder p="sm">
          <Text fw={700} fz="lg" style={{ fontVariantNumeric: "tabular-nums" }}>{stat.value}</Text>
          <Text size="xs" c="dimmed">{stat.label}</Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
