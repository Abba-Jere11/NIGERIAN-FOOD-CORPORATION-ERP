export function sourceHref(input: {
  procurementRequestId?: string | null;
  intercompanyTransactionId?: string | null;
  payableInvoiceId?: string | null;
  receivableInvoiceId?: string | null;
  customerId?: string | null;
  incomeEntryId?: string | null;
  expenseEntryId?: string | null;
  journalSource?: string | null;
}): { href: string | null; label: string | null } {
  if (input.procurementRequestId) {
    return { href: `/procurement/${input.procurementRequestId}`, label: 'Procurement request' };
  }
  if (input.intercompanyTransactionId) {
    return { href: `/finance/intercompany/${input.intercompanyTransactionId}`, label: 'Inter-company' };
  }
  if (input.payableInvoiceId) {
    return { href: `/finance/payables/${input.payableInvoiceId}`, label: 'Payable' };
  }
  if (input.receivableInvoiceId) {
    return { href: `/finance/receivables`, label: 'Receivable' };
  }
  if (input.incomeEntryId) {
    return { href: `/finance/income/${input.incomeEntryId}`, label: 'Income' };
  }
  if (input.expenseEntryId) {
    return { href: `/finance/expenses/${input.expenseEntryId}`, label: 'Expense' };
  }
  if (input.customerId) {
    return { href: `/finance/customers/${input.customerId}`, label: 'Customer' };
  }
  if (input.journalSource === 'FUNDING_TRANSFER') {
    return { href: `/finance/intercompany`, label: 'Funding transfer' };
  }
  if (input.journalSource?.startsWith('INVENTORY_')) {
    return { href: '/inventory', label: 'Inventory' };
  }
  return { href: null, label: null };
}
