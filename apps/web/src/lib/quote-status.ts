export function isApprovedQuoteStatus(status: string) {
  return status === 'ACCEPTED' || status === 'APPROVED';
}
