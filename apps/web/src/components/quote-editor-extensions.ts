'use client';

import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TableCell, TableHeader } from '@tiptap/extension-table';

const cellBackground = {
  default: null,
  parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs.backgroundColor
      ? { style: `background-color: ${attrs.backgroundColor}` }
      : {},
};
export const DocumentTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: cellBackground };
  },
});
export const DocumentTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: cellBackground };
  },
});

export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 480,
        parseHTML: (element) =>
          Math.min(
            1000,
            Math.max(
              40,
              parseInt(element.getAttribute('width') || '480', 10) || 480,
            ),
          ),
      },
      align: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || 'left',
        renderHTML: (attrs) => ({ 'data-align': attrs.align }),
      },
    };
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-page-break': 'true' }),
  ],
});

export const ParagraphIndent = Extension.create({
  name: 'paragraphIndent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) =>
              Math.min(
                160,
                Math.max(0, parseInt(element.style.marginLeft, 10) || 0),
              ),
            renderHTML: (attrs) =>
              attrs.indent ? { style: `margin-left: ${attrs.indent}px` } : {},
          },
        },
      },
    ];
  },
});
