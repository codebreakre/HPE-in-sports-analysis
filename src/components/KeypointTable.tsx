// Mean confidence and visible rate (conf ≥ 0.5) for each of the 17 keypoints.
import { Progress, Table } from "@mantine/core";
import type { KeypointStat } from "../types";

export function KeypointTable({ stats }: { stats: KeypointStat[] }) {
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table striped highlightOnHover verticalSpacing={6} style={{ fontVariantNumeric: "tabular-nums" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Keypoint</Table.Th>
            <Table.Th>Mean confidence</Table.Th>
            <Table.Th>Visible (conf ≥ 0.5)</Table.Th>
            <Table.Th w="30%" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {stats.map((k) => (
            <Table.Tr key={k.name}>
              <Table.Td>{k.name}</Table.Td>
              <Table.Td>{k.meanConf.toFixed(3)}</Table.Td>
              <Table.Td>{(k.visibleRate * 100).toFixed(1)}%</Table.Td>
              <Table.Td>
                <Progress value={k.visibleRate * 100} size="sm" aria-label={`${k.name} visible rate`} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
