"use client";

import { cx } from "@/lib/format";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headClassName?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  mobile,
  rowClassName,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  mobile?: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <>
      <div className={cx("overflow-x-auto", mobile && "hidden md:block")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="table-head">
              {columns.map((c) => (
                <th key={c.key} className={cx("whitespace-nowrap px-4 py-3 font-semibold first:pl-5 last:pr-5", c.headClassName)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx(onRowClick && "cursor-pointer hover:bg-brand-50/40", rowClassName?.(r))}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-4 py-3.5 align-middle first:pl-5 last:pr-5", c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mobile && (
        <ul className="divide-y divide-line md:hidden">
          {rows.map((r) => (
            <li
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx("px-4 py-3", onRowClick && "cursor-pointer active:bg-slate-50", rowClassName?.(r))}
            >
              {mobile(r)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
