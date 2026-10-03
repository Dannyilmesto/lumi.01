type ExportItem = {
  id: string;
  productId: string | null;
  category: string;
  code: string | null;
  description: string;
  quantity: string;
  widthMm: number | null;
  heightMm: number | null;
  unit: string;
  configuration: unknown;
  pricingStatus: string;
  unitPrice: string | null;
  totalPrice: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
};

export type ExportQuote = {
  id: string;
  organizationId: string;
  customerId: string | null;
  title: string;
  status: string;
  currency: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
  } | null;
  items: ExportItem[];
  messages: Array<{
    id: string;
    role: string;
    content: string;
    sources: unknown;
    createdAt: Date;
  }>;
};

export function quoteExportJson(quote: ExportQuote) {
  return {
    id: quote.id,
    organizationId: quote.organizationId,
    customerId: quote.customerId,
    title: quote.title,
    status: quote.status,
    currency: quote.currency,
    totals: {
      subtotal: quote.subtotal,
      discount: quote.discount,
      tax: quote.tax,
      total: quote.total,
    },
    customer: quote.customer,
    items: quote.items,
    messages: quote.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    deletedAt: quote.deletedAt?.toISOString() ?? null,
  };
}

const quoteColumns: Array<[string, keyof ReturnType<typeof quoteExportJson>]> =
  [
    ['ID preventivo', 'id'],
    ['Titolo', 'title'],
    ['Stato', 'status'],
    ['Valuta', 'currency'],
    ['Subtotale', 'totals'],
    ['Sconto', 'totals'],
    ['Imposte', 'totals'],
    ['Totale', 'totals'],
    ['Cliente', 'customer'],
    ['Email cliente', 'customer'],
    ['Telefono cliente', 'customer'],
    ['Indirizzo cliente', 'customer'],
    ['Note cliente', 'customer'],
    ['Creato il', 'createdAt'],
    ['Aggiornato il', 'updatedAt'],
    ['Eliminato il', 'deletedAt'],
  ];

const itemHeaders = [
  ...quoteColumns.map(([label]) => label),
  'Categoria',
  'Codice',
  'Descrizione voce',
  'Quantità',
  'Larghezza mm',
  'Altezza mm',
  'Unità',
  'Configurazione',
  'Stato prezzo',
  'Prezzo unitario',
  'Totale voce',
];

function quoteRow(quote: ExportQuote) {
  return [
    quote.id,
    quote.title,
    quote.status,
    quote.currency,
    quote.subtotal,
    quote.discount,
    quote.tax,
    quote.total,
    quote.customer?.name ?? '',
    quote.customer?.email ?? '',
    quote.customer?.phone ?? '',
    quote.customer?.address ?? '',
    quote.customer?.notes ?? '',
    quote.createdAt.toISOString(),
    quote.updatedAt.toISOString(),
    quote.deletedAt?.toISOString() ?? '',
  ];
}

function csvCell(value: unknown) {
  let text =
    value == null ? '' : typeof value === 'string' ? value : String(value);
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function quoteExportCsv(quotes: ExportQuote[]) {
  const rows: unknown[][] = [itemHeaders];
  for (const quote of quotes) {
    const base = quoteRow(quote);
    if (quote.items.length === 0) {
      rows.push([...base, '', '', '', '', '', '', '', '', '', '', '']);
      continue;
    }
    for (const item of quote.items) {
      rows.push([
        ...base,
        item.category,
        item.code ?? '',
        item.description,
        item.quantity,
        item.widthMm ?? '',
        item.heightMm ?? '',
        item.unit,
        JSON.stringify(item.configuration),
        item.pricingStatus,
        item.unitPrice ?? '',
        item.totalPrice ?? '',
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

type SheetCell = string | number | null;

function excelColumn(index: number) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function xmlSafe(value: string) {
  const valid = Array.from(value)
    .filter((char) => {
      const point = char.codePointAt(0) ?? 0;
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 32 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
    .join('');
  return valid
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function worksheetXml(rows: SheetCell[][]) {
  const content = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          if (value === null || value === '') return '';
          const cellRef = `${excelColumn(columnIndex)}${rowIndex + 1}`;
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${cellRef}" t="n"><v>${value}</v></c>`;
          }
          return `<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${xmlSafe(String(value))}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${content}</sheetData></worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let current = index;
  for (let bit = 0; bit < 8; bit += 1) {
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries: Array<[string, string]>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [fileName, text] of entries) {
    const name = Buffer.from(fileName, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localFileData = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFileData.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localFileData, centralDirectory, end]);
}

function excelValue(value: string | number | null | undefined): SheetCell {
  if (typeof value === 'number' || value == null) return value ?? null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

export function quoteExportXlsx(quotes: ExportQuote[]) {
  const quoteRows: SheetCell[][] = [quoteColumns.map(([label]) => label)];
  const itemRows: SheetCell[][] = [itemHeaders];
  for (const quote of quotes) {
    quoteRows.push(
      quoteRow(quote).map((value, index) =>
        index >= 4 && index <= 7 ? excelValue(value) : value,
      ),
    );
    const base = quoteRow(quote);
    const items = quote.items.length ? quote.items : [null];
    for (const item of items) {
      itemRows.push([
        ...base.map((value, index) =>
          index >= 4 && index <= 7 ? excelValue(value) : value,
        ),
        item?.category ?? '',
        item?.code ?? '',
        item?.description ?? '',
        item ? excelValue(item.quantity) : '',
        item?.widthMm ?? '',
        item?.heightMm ?? '',
        item?.unit ?? '',
        item ? JSON.stringify(item.configuration) : '',
        item?.pricingStatus ?? '',
        item?.unitPrice ? excelValue(item.unitPrice) : '',
        item?.totalPrice ? excelValue(item.totalPrice) : '',
      ]);
    }
  }

  return zipStored([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Preventivi" sheetId="1" r:id="rId1"/><sheet name="Voci" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    ],
    ['xl/worksheets/sheet1.xml', worksheetXml(quoteRows)],
    ['xl/worksheets/sheet2.xml', worksheetXml(itemRows)],
  ]);
}
