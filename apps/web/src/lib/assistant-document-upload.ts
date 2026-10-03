export const maximumAssistantPdfBytes = 30 * 1024 * 1024;

export function validateAssistantPdfUpload(input: {
  fileName: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}) {
  if (!input.fileName.toLowerCase().endsWith(".pdf"))
    return "Sono supportati solo documenti PDF (.pdf).";
  if (
    input.mimeType &&
    !["application/pdf", "application/x-pdf", "application/octet-stream"].includes(
      input.mimeType.toLowerCase(),
    )
  )
    return "Il tipo di file non corrisponde a un PDF.";
  if (input.size === 0)
    return "Il PDF è vuoto. Seleziona un file con contenuto.";
  if (input.size > maximumAssistantPdfBytes)
    return "Il PDF supera il limite di 30 MB.";
  if (Buffer.from(input.bytes).subarray(0, 1024).indexOf(Buffer.from("%PDF-")) === -1)
    return "Il file selezionato non contiene un’intestazione PDF valida.";
  return null;
}
