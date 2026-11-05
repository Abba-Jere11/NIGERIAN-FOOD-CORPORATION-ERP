import { inflateRawSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  BankStatementView,
  BankTransactionView,
  LedgerEntryView,
  ReconciliationReportView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { JournalsService } from './journals.service';
import type { BankTransferInput, ReconcileInput } from './finance.dto';

@Injectable()
export class TreasuryService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly journals: JournalsService,
  ) {}

  async listTransactions(actor: ActorContext, accountId: string): Promise<BankTransactionView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.bank_account.view')) {
      throw new ForbiddenError('You cannot view bank transactions.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        account_id: string;
        entity_id: string;
        kind: string;
        amount_kobo: string;
        occurred_on: Date;
        narration: string;
        journal_id: string | null;
        transfer_id: string | null;
      }>(
        `SELECT id, account_id, entity_id, kind, amount_kobo::text, occurred_on, narration, journal_id, transfer_id
           FROM bank_transactions WHERE account_id = $1 ORDER BY occurred_on, created_at`,
        [accountId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        entityId: row.entity_id,
        kind: row.kind,
        amountKobo: Number(row.amount_kobo),
        occurredOn: row.occurred_on.toISOString().slice(0, 10),
        narration: row.narration,
        journalId: row.journal_id,
        transferId: row.transfer_id,
      }));
    });
  }

  async transfer(actor: ActorContext, input: BankTransferInput): Promise<{ id: string; journalId: string | null }> {
    assertCan(actor, 'finance.bank.manage', input.entityId);
    if (input.sourceAccountId === input.destinationAccountId) {
      throw new ValidationFailedError('The source and destination accounts must be different.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const accounts = await tx.client.query<{
        id: string;
        entity_id: string;
        gl_account_id: string | null;
      }>(
        `SELECT id, entity_id, gl_account_id FROM entity_bank_accounts WHERE id = ANY($1::uuid[])`,
        [[input.sourceAccountId, input.destinationAccountId]],
      );
      const source = accounts.rows.find((row) => row.id === input.sourceAccountId);
      const dest = accounts.rows.find((row) => row.id === input.destinationAccountId);
      if (!source || !dest) throw new NotFoundError('A bank account was not found.');
      if (source.entity_id !== input.entityId || dest.entity_id !== input.entityId) {
        throw new ValidationFailedError('Own-account transfers must stay inside one entity.');
      }
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO bank_transfers (
           entity_id, source_account_id, destination_account_id, amount_kobo, occurred_on, narration, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          input.entityId,
          input.sourceAccountId,
          input.destinationAccountId,
          input.amountKobo,
          input.occurredOn,
          input.narration.trim(),
          actor.ref,
        ],
      );
      const transferId = inserted.rows[0]?.id;
      if (!transferId) throw new Error('The transfer was not recorded.');
      let journalId: string | null = null;
      if (source.gl_account_id && dest.gl_account_id) {
        const journal = await this.journals.createInTx(tx, actor, {
          entityId: input.entityId,
          fiscalPeriodId: input.fiscalPeriodId,
          narration: input.narration.trim(),
          idempotencyKey: `bank-transfer-${transferId}`,
          source: 'BANK_TRANSFER',
          lines: [
            { accountId: dest.gl_account_id, debitKobo: input.amountKobo, creditKobo: 0 },
            { accountId: source.gl_account_id, debitKobo: 0, creditKobo: input.amountKobo },
          ],
        });
        const submitted = await this.journals.submitInTx(tx, actor, journal.id, journal.rowVersion);
        journalId = submitted.id;
        await tx.client.query(`UPDATE bank_transfers SET journal_id = $1 WHERE id = $2`, [journalId, transferId]);
      }
      const txns = await tx.client.query<{ id: string }>(
        `INSERT INTO bank_transactions (
           account_id, entity_id, kind, amount_kobo, occurred_on, narration, journal_id, transfer_id, created_by
         ) VALUES
           ($1, $3, 'TRANSFER_OUT', $4, $5, $6, $7, $8, $9),
           ($2, $3, 'TRANSFER_IN', $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.sourceAccountId,
          input.destinationAccountId,
          input.entityId,
          input.amountKobo,
          input.occurredOn,
          input.narration.trim(),
          journalId,
          transferId,
          actor.ref,
        ],
      );
      for (const txn of txns.rows) {
        await tx.indexSearch({
          recordType: 'BANK_TXN',
          recordId: txn.id,
          referenceNumber: transferId,
          title: input.narration.trim(),
          searchableText: `${input.narration} transfer ${input.amountKobo}`,
          entityId: input.entityId,
          permissionKey: 'finance.view',
        });
      }
      await tx.audit({
        action: 'create',
        subjectType: 'bank_transfer',
        subjectId: transferId,
        subjectLabel: input.narration,
        entityId: input.entityId,
        newValue: { amountKobo: input.amountKobo },
      });
      return { id: transferId, journalId };
    });
  }

  async importStatement(
    actor: ActorContext,
    accountId: string,
    filename: string,
    buffer: Buffer,
    mapping: { dateColumn: string; descriptionColumn: string; amountColumn: string },
  ): Promise<BankStatementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const account = await tx.client.query<{ entity_id: string }>(
        `SELECT entity_id FROM entity_bank_accounts WHERE id = $1`,
        [accountId],
      );
      const row = account.rows[0];
      if (!row) throw new NotFoundError('That bank account does not exist.');
      assertCan(actor, 'finance.bank.manage', row.entity_id);
      const rows = parseSpreadsheet(buffer, filename);
      if (rows.length < 2) throw new ValidationFailedError('The statement file has no data rows.');
      const header = rows[0] ?? [];
      const dateIdx = header.findIndex((cell) => cell.toLowerCase() === mapping.dateColumn.toLowerCase());
      const descIdx = header.findIndex((cell) => cell.toLowerCase() === mapping.descriptionColumn.toLowerCase());
      const amountIdx = header.findIndex((cell) => cell.toLowerCase() === mapping.amountColumn.toLowerCase());
      if (dateIdx < 0 || descIdx < 0 || amountIdx < 0) {
        throw new ValidationFailedError('The column mapping does not match the file header.');
      }
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO bank_statements (account_id, entity_id, reference, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [accountId, row.entity_id, filename.slice(0, 120), actor.ref],
      );
      const statementId = inserted.rows[0]?.id;
      if (!statementId) throw new Error('The statement was not imported.');
      for (const cells of rows.slice(1)) {
        const amount = parseAmount(cells[amountIdx] ?? '');
        if (amount === 0) continue;
        await tx.client.query(
          `INSERT INTO bank_statement_lines (
             statement_id, entity_id, occurred_on, description, amount_kobo, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [statementId, row.entity_id, cells[dateIdx], cells[descIdx] || 'Statement line', amount, actor.ref],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'bank_statement',
        subjectId: statementId,
        subjectLabel: filename,
        entityId: row.entity_id,
        newValue: { accountId },
      });
      return this.getStatementInTx(tx, statementId);
    });
  }

  async listStatements(actor: ActorContext, accountId: string): Promise<BankStatementView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.reconcile')) {
      throw new ForbiddenError('You cannot view bank statements.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM bank_statements WHERE account_id = $1 ORDER BY imported_at DESC`,
        [accountId],
      );
      const views: BankStatementView[] = [];
      for (const row of ids.rows) views.push(await this.getStatementInTx(tx, row.id));
      return views;
    });
  }

  async match(actor: ActorContext, input: ReconcileInput): Promise<void> {
    if (!input.bankTransactionId && !input.journalLineId) {
      throw new ValidationFailedError('A match needs a bank transaction or a journal line.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const line = await tx.client.query<{ entity_id: string }>(
        `SELECT entity_id FROM bank_statement_lines WHERE id = $1`,
        [input.statementLineId],
      );
      const row = line.rows[0];
      if (!row) throw new NotFoundError('That statement line does not exist.');
      assertCan(actor, 'finance.reconcile', row.entity_id);
      await tx.client.query(
        `INSERT INTO bank_reconciliation_matches (
           entity_id, statement_line_id, bank_transaction_id, journal_line_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
        [row.entity_id, input.statementLineId, input.bankTransactionId ?? null, input.journalLineId ?? null, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'bank_reconciliation',
        subjectId: input.statementLineId,
        subjectLabel: 'Match',
        entityId: row.entity_id,
        newValue: { matched: true },
      });
    });
  }

  async unmatch(actor: ActorContext, statementLineId: string, reason: string): Promise<void> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{ id: string; entity_id: string }>(
        `SELECT id, entity_id FROM bank_reconciliation_matches
          WHERE statement_line_id = $1 AND unmatched_at IS NULL
          FOR UPDATE`,
        [statementLineId],
      );
      const row = current.rows[0];
      if (!row) throw new ConflictError('That line is not matched.');
      assertCan(actor, 'finance.reconcile', row.entity_id);
      await tx.client.query(
        `UPDATE bank_reconciliation_matches
            SET unmatched_at = now(), unmatched_reason = $2, updated_by = $3
          WHERE id = $1`,
        [row.id, reason.trim(), actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'bank_reconciliation',
        subjectId: statementLineId,
        subjectLabel: 'Unmatch',
        entityId: row.entity_id,
        reason: reason.trim(),
        newValue: { matched: false },
      });
    });
  }

  async report(actor: ActorContext, accountId: string, periodId?: string): Promise<ReconciliationReportView> {
    if (!can(actor, 'finance.reconcile') && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view reconciliation.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const account = await tx.client.query<{ gl_account_id: string | null; entity_id: string }>(
        `SELECT gl_account_id, entity_id FROM entity_bank_accounts WHERE id = $1`,
        [accountId],
      );
      const bank = account.rows[0];
      if (!bank) throw new NotFoundError('That bank account does not exist.');
      const lines = await tx.client.query<{
        id: string;
        statement_id: string;
        occurred_on: Date;
        description: string;
        amount_kobo: string;
        match_id: string | null;
      }>(
        `SELECT l.id, l.statement_id, l.occurred_on, l.description, l.amount_kobo::text,
                m.id AS match_id
           FROM bank_statement_lines l
           JOIN bank_statements s ON s.id = l.statement_id
           LEFT JOIN bank_reconciliation_matches m
             ON m.statement_line_id = l.id AND m.unmatched_at IS NULL
          WHERE s.account_id = $1
          ORDER BY l.occurred_on`,
        [accountId],
      );
      const matches = await tx.client.query<{
        statement_line_id: string;
        bank_transaction_id: string | null;
        journal_line_id: string | null;
      }>(
        `SELECT m.statement_line_id, m.bank_transaction_id, m.journal_line_id
           FROM bank_reconciliation_matches m
           JOIN bank_statement_lines l ON l.id = m.statement_line_id
           JOIN bank_statements s ON s.id = l.statement_id
          WHERE s.account_id = $1 AND m.unmatched_at IS NULL`,
        [accountId],
      );
      let unmatchedLedger: LedgerEntryView[] = [];
      if (bank.gl_account_id) {
        unmatchedLedger = (
          await this.journals.ledger(actor, bank.gl_account_id, periodId)
        ).filter(
          (entry) => !matches.rows.some((match) => match.journal_line_id === entry.journalLineId),
        );
      }
      const unmatchedStatement = lines.rows
        .filter((line) => !line.match_id)
        .map((line) => ({
          id: line.id,
          statementId: line.statement_id,
          occurredOn: line.occurred_on.toISOString().slice(0, 10),
          description: line.description,
          amountKobo: Number(line.amount_kobo),
          matched: false,
        }));
      return {
        accountId,
        periodId: periodId ?? null,
        matchedCount: matches.rows.length,
        unmatchedStatementCount: unmatchedStatement.length,
        unmatchedLedgerCount: unmatchedLedger.length,
        matched: matches.rows.map((row) => ({
          statementLineId: row.statement_line_id,
          bankTransactionId: row.bank_transaction_id,
          journalLineId: row.journal_line_id,
        })),
        unmatchedStatement,
        unmatchedLedger,
      };
    });
  }

  private async getStatementInTx(tx: TxScope, id: string): Promise<BankStatementView> {
    const header = await tx.client.query<{
      id: string;
      account_id: string;
      reference: string;
      imported_at: Date;
    }>(`SELECT id, account_id, reference, imported_at FROM bank_statements WHERE id = $1`, [id]);
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That statement does not exist.');
    const lines = await tx.client.query<{
      id: string;
      occurred_on: Date;
      description: string;
      amount_kobo: string;
      match_id: string | null;
    }>(
      `SELECT l.id, l.occurred_on, l.description, l.amount_kobo::text, m.id AS match_id
         FROM bank_statement_lines l
         LEFT JOIN bank_reconciliation_matches m
           ON m.statement_line_id = l.id AND m.unmatched_at IS NULL
        WHERE l.statement_id = $1
        ORDER BY l.occurred_on`,
      [id],
    );
    return {
      id: row.id,
      accountId: row.account_id,
      reference: row.reference,
      importedAt: row.imported_at.toISOString(),
      lines: lines.rows.map((line) => ({
        id: line.id,
        statementId: id,
        occurredOn: line.occurred_on.toISOString().slice(0, 10),
        description: line.description,
        amountKobo: Number(line.amount_kobo),
        matched: Boolean(line.match_id),
      })),
    };
  }
}

function parseSpreadsheet(buffer: Buffer, filename: string): string[][] {
  if (filename.toLowerCase().endsWith('.xlsx') || buffer.subarray(0, 2).toString() === 'PK') {
    return parseXlsx(buffer);
  }
  return parseCsv(buffer.toString('utf8'));
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

function parseXlsx(buffer: Buffer): string[][] {
  const zip = readZipStore(buffer);
  const sheet = zip['xl/worksheets/sheet1.xml'];
  const strings = zip['xl/sharedStrings.xml'];
  if (!sheet) throw new ValidationFailedError('The workbook has no first sheet.');
  const shared = strings ? extractSharedStrings(strings.toString('utf8')) : [];
  const rows: string[][] = [];
  const rowMatches = sheet.toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g);
  for (const row of rowMatches) {
    const cells: string[] = [];
    const cellMatches = row[1]?.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g) ?? [];
    for (const cell of cellMatches) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      if (attrs.includes('t="s"')) {
        const index = Number((body.match(/<v>(\d+)<\/v>/) ?? [])[1] ?? -1);
        cells.push(shared[index] ?? '');
      } else {
        cells.push((body.match(/<v>([^<]*)<\/v>/) ?? [])[1] ?? '');
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) throw new ValidationFailedError('The workbook is empty.');
  return rows;
}

function extractSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1] ?? '');
    return texts.join('');
  });
}

function readZipStore(zip: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) break;
    const method = zip.readUInt16LE(offset + 8);
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extra;
    const data = zip.subarray(dataStart, dataStart + compressed);
    if (method === 0) files[name] = data;
    else if (method === 8) {
      files[name] = inflateRawSync(data);
    }
    offset = dataStart + compressed;
  }
  return files;
}

function parseAmount(value: string): number {
  const cleaned = value.replace(/[₦,\s]/g, '');
  if (cleaned === '') return 0;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira)) throw new ValidationFailedError(`The amount "${value}" is not a number.`);
  return Math.round(naira * 100);
}
