'use client';

import { useMemo, type CSSProperties } from 'react';
import type { PPTTableElement, TableCell, TableCellBorder } from '@openmaic/dsl';
import { getTableSubThemeColor } from '../../utils/element';
import { getTextStyle } from './tableUtils';

function cellBorderCss(b?: TableCellBorder): string | undefined {
  if (!b || b.width <= 0) return undefined;
  const style = b.style === 'dashed' || b.style === 'dotted' ? b.style : 'solid';
  return `${b.width}px ${style} ${b.color}`;
}

interface StaticTableProps {
  elementInfo: PPTTableElement;
}

function isRuntimeTableCell(value: unknown): value is TableCell {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRuntimeTableRow(row: unknown): TableCell[] {
  const cells = Array.isArray(row) ? row : [row];
  return cells.filter(isRuntimeTableCell);
}

export function StaticTable({ elementInfo }: StaticTableProps) {
  const { width, data, colWidths, cellMinHeight, rowHeights, outline, theme } = elementInfo;
  const tableData = useMemo(
    () => (Array.isArray(data) ? data.map(normalizeRuntimeTableRow) : []),
    [data],
  );
  const tableColWidths = useMemo(() => (Array.isArray(colWidths) ? colWidths : []), [colWidths]);
  const tableRowHeights = useMemo(
    () => (Array.isArray(rowHeights) ? rowHeights : []),
    [rowHeights],
  );
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeCellMinHeight =
    Number.isFinite(cellMinHeight) && cellMinHeight >= 0 ? cellMinHeight : 40;

  const [subThemeDark, subThemeLight] = useMemo(() => {
    if (!theme) return ['', ''];
    return getTableSubThemeColor(theme.color);
  }, [theme]);

  const borderStyle = useMemo(() => {
    if (!outline) return 'none';
    const w = outline.width ?? 1;
    const c = outline.color ?? '#000';
    const s = outline.style === 'dashed' ? 'dashed' : 'solid';
    return `${w}px ${s} ${c}`;
  }, [outline]);

  const getCellBg = (
    rowIdx: number,
    colIdx: number,
    cellBackcolor?: string,
  ): string | undefined => {
    if (cellBackcolor) return cellBackcolor;
    if (!theme) return undefined;

    const rowCount = tableData.length;
    const colCount = tableData[0]?.length ?? 0;

    if (theme.rowHeader && rowIdx === 0) return theme.color;
    if (theme.rowFooter && rowIdx === rowCount - 1) return theme.color;
    if (theme.colHeader && colIdx === 0) return subThemeDark;
    if (theme.colFooter && colIdx === colCount - 1) return subThemeDark;

    const effectiveRow = theme.rowHeader ? rowIdx - 1 : rowIdx;
    if (effectiveRow >= 0 && effectiveRow % 2 === 0) return subThemeLight;

    return undefined;
  };

  const getHeaderTextColor = (rowIdx: number): string | undefined => {
    if (!theme) return undefined;
    const rowCount = tableData.length;
    if (theme.rowHeader && rowIdx === 0) return '#fff';
    if (theme.rowFooter && rowIdx === rowCount - 1) return '#fff';
    return undefined;
  };

  return (
    <table
      className="slide-renderer-prose"
      style={{
        width: '100%',
        height: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
      }}
    >
      <colgroup>
        {tableColWidths.map((w, i) => (
          <col key={i} style={{ width: `${(Number.isFinite(w) ? w : 1) * safeWidth}px` }} />
        ))}
      </colgroup>
      <tbody>
        {tableData.map((row, rowIdx) => {
          const rowHeight = Number.isFinite(tableRowHeights[rowIdx])
            ? tableRowHeights[rowIdx]
            : safeCellMinHeight;

          return (
            <tr key={rowIdx} style={{ height: `${rowHeight}px` }}>
              {row.map((cell, colIdx) => {
                // parser side (transformParsedToSlides) 已经把 hMerge/vMerge
                // continuation 单元格剔除了，data[r] 只剩 top-left cells；浏览器
                // 的 HTML table layout 通过 td.colSpan/rowSpan 自动算正确位置，
                // 不需要再手动算 hiddenCells（旧实现用 data-index 比对 grid-coord
                // key，混了两种坐标系，把 colspan 跨过的 grid-coord 等于另一格
                // 的 data-index 时会误隐藏，slide 26 表头 "权重"/"好" 就是中招）。
                const bgColor = getCellBg(rowIdx, colIdx, cell.style?.backcolor);
                const headerColor = getHeaderTextColor(rowIdx);
                const textStyle = getTextStyle(cell.style);
                const colspan =
                  Number.isFinite(cell.colspan) && cell.colspan > 0 ? cell.colspan : 1;
                const rowspan =
                  Number.isFinite(cell.rowspan) && cell.rowspan > 0 ? cell.rowspan : 1;

                if (headerColor && !cell.style?.color) {
                  textStyle.color = headerColor;
                }

                // 单元格自带逐边描边时按边渲染（未定义的边不画）；否则回退到
                // 表级 outline 套四边的旧行为，保留真·网格表格的表现。
                const cellBorders = cell.borders;
                const borderCss: CSSProperties =
                  cellBorders &&
                  (cellBorders.top || cellBorders.bottom || cellBorders.left || cellBorders.right)
                    ? {
                        borderTop: cellBorderCss(cellBorders.top) ?? 'none',
                        borderBottom: cellBorderCss(cellBorders.bottom) ?? 'none',
                        borderLeft: cellBorderCss(cellBorders.left) ?? 'none',
                        borderRight: cellBorderCss(cellBorders.right) ?? 'none',
                      }
                    : { border: borderStyle };

                return (
                  <td
                    key={`${rowIdx}:${colIdx}:${cell.id || 'cell'}`}
                    colSpan={colspan > 1 ? colspan : undefined}
                    rowSpan={rowspan > 1 ? rowspan : undefined}
                    style={{
                      ...borderCss,
                      backgroundColor: bgColor,
                      ...textStyle,
                    }}
                  >
                    <div
                      className="slide-renderer-cell-text"
                      style={{
                        minHeight: `${Math.max(0, rowHeight - 4)}px`,
                        padding: cell.padding,
                        display: 'flex',
                        flexDirection: 'column',
                        lineHeight: 1,
                        justifyContent:
                          cell.vAlign === 'top'
                            ? 'flex-start'
                            : cell.vAlign === 'bottom'
                              ? 'flex-end'
                              : 'center',
                      }}
                      // cell.text is already final HTML (transformParsedToSlides
                      // escapes text + converts \n/spaces and keeps <p> positioning
                      // styles). Do NOT run formatText here — its space→&nbsp;
                      // replacement corrupts style attributes like
                      // `margin-left: calc(42px + 0.25em)` → the title indent is
                      // lost and collides with the cell's left icon (slide 5).
                      dangerouslySetInnerHTML={{
                        __html: typeof cell.text === 'string' ? cell.text : '',
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
