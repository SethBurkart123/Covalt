import type { ComponentRenderer } from "../engine";
import { asNumber, asString, renderValue } from "./_shared";

interface Column {
  header?: string;
  key?: string;
  width?: number;
}

function asColumns(value: unknown): Column[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return {};
    const e = entry as Record<string, unknown>;
    return {
      header: asString(e.header),
      key: asString(e.key),
      width: asNumber(e.width),
    };
  });
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      out.push(entry as Record<string, unknown>);
    }
  }
  return out;
}

export const Table: ComponentRenderer = ({ props }) => {
  const columns = asColumns(props.columns);
  const rows = asRows(props.rows);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr>
            {columns.map((column, idx) => (
              <th
                key={`col-${column.key ?? column.header ?? idx}`}
                className="h-9 px-3 text-left font-medium text-foreground"
                style={{ width: column.width ? `${column.width}ch` : undefined }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={`row-${rowIdx}`} className="border-t">
              {columns.map((column, colIdx) => (
                <td
                  key={`cell-${rowIdx}-${colIdx}`}
                  className="px-3 py-2 align-top text-muted-foreground"
                >
                  {renderValue(column.key ? row[column.key] : "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
