import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  REQUIRED_VENDOR_COMPLIANCE,
  canManageVendorRegister,
  canReadVendorRegister,
  type VendorCategoryView,
  type VendorComplianceItemView,
  type VendorListItemView,
  type VendorView,
} from '@nfc/shared';
import { assertCan } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReasonRequiredError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { WorkflowsService } from '../workflows/workflows.service';
import { bankView, parseContacts, stripBankDetails } from './vendors.mapper';
import type {
  AttachComplianceInput,
  BankDetailsInput,
  CreateVendorInput,
  ListVendorsQuery,
  UpdateVendorInput,
  VendorReasonInput,
} from './vendors.dto';

interface VendorRow {
  id: string;
  reference_number: string;
  entity_id: string;
  legal_name: string;
  cac_registration_number: string;
  category_id: string;
  category_key: string;
  category_label: string;
  status: string;
  notes: string | null;
  contacts: unknown;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  activated_at: Date | null;
  activated_by: string | null;
  created_by: string;
  created_at: Date;
  row_version: number;
  compliance_expired: boolean;
}

const VENDOR_SELECT = `
  SELECT v.id, v.reference_number, v.entity_id, v.legal_name, v.cac_registration_number,
         v.category_id, c.key AS category_key, c.label AS category_label, v.status, v.notes,
         v.contacts, v.bank_name, v.account_name, v.account_number, v.activated_at, v.activated_by,
         v.created_by, v.created_at, v.row_version,
         EXISTS (
           SELECT 1 FROM vendor_compliance_documents d
            WHERE d.vendor_id = v.id AND d.required
              AND d.expires_at IS NOT NULL AND d.expires_at < CURRENT_DATE
         ) AS compliance_expired
    FROM vendors v
    JOIN vendor_categories c ON c.id = v.category_id`;

@Injectable()
export class VendorsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly workflows: WorkflowsService,
  ) {}

  async categories(actor: ActorContext): Promise<VendorCategoryView[]> {
    this.assertCanRead(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<VendorCategoryView>(
        `SELECT id, key, label FROM vendor_categories ORDER BY sort_order, label`,
      );
      return result.rows;
    });
  }

  async list(actor: ActorContext, query: Partial<ListVendorsQuery> = {}): Promise<VendorListItemView[]> {
    this.assertCanRead(actor);
    const manage = canManageVendorRegister(actor.permissions);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<VendorRow>(
        `${VENDOR_SELECT}
          WHERE ($1::text IS NULL OR v.status = $1)
            AND ($2::text IS NULL OR c.key = $2)
            AND ($3::text IS NULL OR v.legal_name ILIKE '%' || $3 || '%'
                 OR v.reference_number ILIKE '%' || $3 || '%'
                 OR v.cac_registration_number ILIKE '%' || $3 || '%')
            AND ($4::boolean OR v.status = 'ACTIVE')
          ORDER BY v.legal_name`,
        [query.status ?? null, query.category ?? null, query.q ?? null, manage],
      );
      return result.rows.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        legalName: row.legal_name,
        cacRegistrationNumber: row.cac_registration_number,
        categoryKey: row.category_key,
        categoryLabel: row.category_label,
        status: row.status,
        complianceExpired: row.compliance_expired,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  async get(actor: ActorContext, id: string): Promise<VendorView> {
    this.assertCanRead(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const row = await this.loadRow(tx, id);
      if (!canManageVendorRegister(actor.permissions) && row.status !== 'ACTIVE') {
        throw new NotFoundError('That vendor was not found.');
      }
      return stripBankDetails(await this.toView(tx, row, actor), actor);
    });
  }

  async create(actor: ActorContext, input: CreateVendorInput): Promise<VendorView> {
    assertCan(actor, 'vendor.create');
    return this.unitOfWork.write(actor, async (tx) => {
      const entityId = await this.holdingEntityId(tx);
      const warnings = await this.duplicateWarnings(tx, {
        cac: input.cacRegistrationNumber,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        legalName: input.legalName,
      });
      const allocated = await tx.client.query<{ ref: string }>(
        `SELECT app.next_reference('VND') AS ref`,
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The vendor reference was not allocated.');

      const inserted = await this.insertVendor(tx, actor, {
        entityId,
        reference,
        input,
      });
      const row = await this.loadRow(tx, inserted);
      await this.indexVendor(tx, row);
      await tx.appendTimeline({
        subjectType: 'VENDOR',
        subjectId: row.id,
        text: `Vendor ${row.reference_number} created as a draft.`,
        href: `/vendors/${row.id}`,
        entityId: row.entity_id,
      });
      await tx.audit({
        action: 'create',
        subjectType: 'vendor',
        subjectId: row.id,
        subjectLabel: row.legal_name,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { status: row.status, cac: row.cac_registration_number },
      });
      const view = await this.toView(tx, row, actor);
      return stripBankDetails({ ...view, warnings: [...view.warnings, ...warnings] }, actor);
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateVendorInput): Promise<VendorView> {
    assertCan(actor, 'vendor.create');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockRow(tx, id);
      if (current.status !== 'DRAFT') {
        throw new ConflictError('Only a draft vendor can be edited. Bank changes on an Active vendor use re-verification.');
      }
      this.assertRowVersion(current, input.rowVersion);
      const warnings = await this.duplicateWarnings(tx, {
        cac: input.cacRegistrationNumber,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        legalName: input.legalName,
        excludeId: id,
      });
      try {
        await tx.client.query(
          `UPDATE vendors
              SET legal_name = $1,
                  cac_registration_number = $2,
                  category_id = $3,
                  notes = $4,
                  contacts = $5::jsonb,
                  bank_name = $6,
                  account_name = $7,
                  account_number = $8,
                  updated_by = $9
            WHERE id = $10 AND row_version = $11`,
          [
            input.legalName.trim(),
            input.cacRegistrationNumber.trim(),
            input.categoryId,
            input.notes?.trim() || null,
            JSON.stringify(input.contacts ?? parseContacts(current.contacts)),
            emptyToNull(input.bankName),
            emptyToNull(input.accountName),
            emptyToNull(input.accountNumber),
            actor.ref,
            id,
            current.row_version,
          ],
        );
      } catch (error) {
        throwUnique(error);
      }
      if (hasBank(input) && bankChanged(current, input)) {
        await tx.client.query(
          `INSERT INTO vendor_bank_account_versions (
             vendor_id, entity_id, bank_name, account_name, account_number, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            current.entity_id,
            input.bankName?.trim(),
            input.accountName?.trim(),
            input.accountNumber?.trim(),
            actor.ref,
          ],
        );
      }
      const row = await this.loadRow(tx, id);
      await this.indexVendor(tx, row);
      await tx.audit({
        action: 'edit',
        subjectType: 'vendor',
        subjectId: row.id,
        subjectLabel: row.legal_name,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        oldValue: { legalName: current.legal_name, cac: current.cac_registration_number },
        newValue: { legalName: row.legal_name, cac: row.cac_registration_number },
      });
      const view = await this.toView(tx, row, actor);
      return stripBankDetails({ ...view, warnings: [...view.warnings, ...warnings] }, actor);
    });
  }

  async submit(actor: ActorContext, id: string): Promise<VendorView> {
    assertCan(actor, 'vendor.create');
    await this.workflows.startVendorOnboarding(actor, id);
    return this.get(actor, id);
  }

  async suspend(actor: ActorContext, id: string, input: VendorReasonInput): Promise<VendorView> {
    assertCan(actor, 'vendor.suspend');
    return this.setStatus(actor, id, 'SUSPENDED', input, 'edit');
  }

  async blacklist(actor: ActorContext, id: string, input: VendorReasonInput): Promise<VendorView> {
    assertCan(actor, 'vendor.blacklist');
    return this.setStatus(actor, id, 'BLACKLISTED', input, 'edit');
  }

  async reactivate(actor: ActorContext, id: string, input: VendorReasonInput): Promise<VendorView> {
    assertCan(actor, 'vendor.activate');
    return this.setStatus(actor, id, 'ACTIVE', input, 'approve');
  }

  async attachCompliance(
    actor: ActorContext,
    vendorId: string,
    input: AttachComplianceInput,
  ): Promise<VendorView> {
    assertCan(actor, 'vendor.create');
    if (!input.documentId) {
      throw new ValidationFailedError('A document id is required.');
    }
    const required =
      input.required ??
      (REQUIRED_VENDOR_COMPLIANCE as readonly string[]).includes(input.complianceType);
    return this.unitOfWork.write(actor, async (tx) => {
      const vendor = await this.lockRow(tx, vendorId);
      if (!['DRAFT', 'PENDING_REVIEW', 'PENDING_REVERIFICATION', 'ACTIVE'].includes(vendor.status)) {
        throw new ConflictError('Compliance documents cannot be attached in this status.');
      }
      await tx.client.query(
        `INSERT INTO vendor_compliance_documents (
           vendor_id, entity_id, document_id, compliance_type, required, expires_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          vendorId,
          vendor.entity_id,
          input.documentId,
          input.complianceType,
          required,
          input.expiresAt ?? null,
          actor.ref,
        ],
      );
      await tx.audit({
        action: 'upload',
        subjectType: 'vendor',
        subjectId: vendor.id,
        subjectLabel: vendor.legal_name,
        subjectReferenceNumber: vendor.reference_number,
        entityId: vendor.entity_id,
        newValue: { complianceType: input.complianceType, documentId: input.documentId },
      });
      const row = await this.loadRow(tx, vendorId);
      return stripBankDetails(await this.toView(tx, row, actor), actor);
    });
  }

  async changeBank(actor: ActorContext, id: string, input: BankDetailsInput): Promise<VendorView> {
    assertCan(actor, 'vendor.create');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockRow(tx, id);
      this.assertRowVersion(current, input.rowVersion);
      if (current.status !== 'ACTIVE' && current.status !== 'PENDING_REVERIFICATION') {
        throw new ConflictError('Bank details can only be changed on an Active vendor.');
      }
      await tx.client.query(
        `UPDATE vendors
            SET bank_name = $1,
                account_name = $2,
                account_number = $3,
                status = 'PENDING_REVERIFICATION',
                updated_by = $4
          WHERE id = $5 AND row_version = $6`,
        [input.bankName.trim(), input.accountName.trim(), input.accountNumber.trim(), actor.ref, id, current.row_version],
      );
      await tx.client.query(
        `INSERT INTO vendor_bank_account_versions (
           vendor_id, entity_id, bank_name, account_name, account_number, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, current.entity_id, input.bankName.trim(), input.accountName.trim(), input.accountNumber.trim(), actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'vendor',
        subjectId: current.id,
        subjectLabel: current.legal_name,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        reason: 'Bank details changed; re-verification required.',
        oldValue: { status: current.status, accountNumber: current.account_number },
        newValue: { status: 'PENDING_REVERIFICATION' },
      });
      await tx.appendTimeline({
        subjectType: 'VENDOR',
        subjectId: current.id,
        text: 'Bank details changed. Waiting for a different user to re-verify.',
        href: `/vendors/${current.id}`,
        entityId: current.entity_id,
      });
      const row = await this.loadRow(tx, id);
      await this.indexVendor(tx, row);
      return stripBankDetails(await this.toView(tx, row, actor), actor);
    });
  }

  async approveBank(actor: ActorContext, id: string, rowVersion: number): Promise<VendorView> {
    assertCan(actor, 'vendor.activate');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockRow(tx, id);
      this.assertRowVersion(current, rowVersion);
      if (current.status !== 'PENDING_REVERIFICATION') {
        throw new ConflictError('There is no bank re-verification waiting.');
      }
      if (current.created_by === actor.ref) {
        throw new ForbiddenError('The user who created this vendor cannot approve the bank details.');
      }
      const latest = await tx.client.query<{ created_by: string }>(
        `SELECT created_by FROM vendor_bank_account_versions
          WHERE vendor_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [id],
      );
      if (latest.rows[0]?.created_by === actor.ref) {
        throw new ForbiddenError('A different user must approve the bank-detail change.');
      }
      await tx.client.query(
        `UPDATE vendors
            SET status = 'ACTIVE',
                activated_at = coalesce(activated_at, now()),
                activated_by = coalesce(activated_by, $1),
                updated_by = $1
          WHERE id = $2 AND row_version = $3`,
        [actor.ref, id, current.row_version],
      );
      await tx.audit({
        action: 'approve',
        subjectType: 'vendor',
        subjectId: current.id,
        subjectLabel: current.legal_name,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: current.status },
        newValue: { status: 'ACTIVE' },
      });
      await tx.appendTimeline({
        subjectType: 'VENDOR',
        subjectId: current.id,
        text: 'Bank details re-verified. Vendor is Active.',
        href: `/vendors/${current.id}`,
        entityId: current.entity_id,
      });
      const row = await this.loadRow(tx, id);
      await this.indexVendor(tx, row);
      return stripBankDetails(await this.toView(tx, row, actor), actor);
    });
  }

  private async setStatus(
    actor: ActorContext,
    id: string,
    status: 'SUSPENDED' | 'BLACKLISTED' | 'ACTIVE',
    input: VendorReasonInput,
    auditAction: 'edit' | 'approve',
  ): Promise<VendorView> {
    if (!input.reason.trim()) throw new ReasonRequiredError(status.toLowerCase());
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockRow(tx, id);
      this.assertRowVersion(current, input.rowVersion);
      if (status === 'ACTIVE' && current.status !== 'SUSPENDED') {
        throw new ConflictError('Only a suspended vendor can be reactivated this way.');
      }
      if (status !== 'ACTIVE' && !['ACTIVE', 'PENDING_REVERIFICATION', 'SUSPENDED'].includes(current.status)) {
        throw new ConflictError('This vendor cannot change status from here.');
      }
      await tx.client.query(
        `UPDATE vendors SET status = $1, updated_by = $2 WHERE id = $3 AND row_version = $4`,
        [status, actor.ref, id, current.row_version],
      );
      await tx.audit({
        action: auditAction,
        subjectType: 'vendor',
        subjectId: current.id,
        subjectLabel: current.legal_name,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        reason: input.reason.trim(),
        oldValue: { status: current.status },
        newValue: { status },
      });
      await tx.appendTimeline({
        subjectType: 'VENDOR',
        subjectId: current.id,
        text: `Status set to ${status}. ${input.reason.trim()}`,
        href: `/vendors/${current.id}`,
        entityId: current.entity_id,
      });
      await tx.publish({
        eventType: 'vendor.suspended',
        subjectType: 'VENDOR',
        subjectId: current.id,
        entityId: current.entity_id,
        payload: {
          type: 'vendor.suspended',
          reference: current.reference_number,
          title: current.legal_name,
          reason: `${status}: ${input.reason.trim()}`,
          href: `/vendors/${current.id}`,
        },
      });
      const row = await this.loadRow(tx, id);
      await this.indexVendor(tx, row);
      return stripBankDetails(await this.toView(tx, row, actor), actor);
    });
  }

  private assertCanRead(actor: ActorContext): void {
    if (canReadVendorRegister(actor.permissions)) return;
    throw new ForbiddenError('Your role does not permit this action.', { permission: 'vendor.view' });
  }

  private assertRowVersion(row: VendorRow, expected: number): void {
    if (row.row_version !== expected) {
      throw new StaleRecordError('This vendor has changed. Refresh and try again.', {
        rowVersion: row.row_version,
      });
    }
  }

  private async holdingEntityId(tx: TxScope): Promise<string> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM entities WHERE code = 'NFC'`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new ValidationFailedError('The holding entity is not seeded.');
    return id;
  }

  private async loadRow(tx: TxScope, id: string): Promise<VendorRow> {
    const result = await tx.client.query<VendorRow>(`${VENDOR_SELECT} WHERE v.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That vendor was not found.');
    return row;
  }

  private async lockRow(tx: TxScope, id: string): Promise<VendorRow> {
    const result = await tx.client.query<VendorRow>(
      `${VENDOR_SELECT} WHERE v.id = $1 FOR UPDATE OF v`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That vendor was not found.');
    return row;
  }

  private async insertVendor(
    tx: TxScope,
    actor: ActorContext,
    args: { entityId: string; reference: string; input: CreateVendorInput },
  ): Promise<string> {
    try {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO vendors (
           reference_number, entity_id, legal_name, cac_registration_number, category_id, status,
           notes, contacts, bank_name, account_name, account_number, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7::jsonb, $8, $9, $10, $11, $11)
         RETURNING id`,
        [
          args.reference,
          args.entityId,
          args.input.legalName.trim(),
          args.input.cacRegistrationNumber.trim(),
          args.input.categoryId,
          args.input.notes?.trim() || null,
          JSON.stringify(args.input.contacts ?? []),
          emptyToNull(args.input.bankName),
          emptyToNull(args.input.accountName),
          emptyToNull(args.input.accountNumber),
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The vendor was not created.');
      if (hasBank(args.input)) {
        await tx.client.query(
          `INSERT INTO vendor_bank_account_versions (
             vendor_id, entity_id, bank_name, account_name, account_number, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            args.entityId,
            args.input.bankName?.trim(),
            args.input.accountName?.trim(),
            args.input.accountNumber?.trim(),
            actor.ref,
          ],
        );
      }
      return id;
    } catch (error) {
      throwUnique(error);
    }
  }

  private async duplicateWarnings(
    tx: TxScope,
    input: {
      cac: string;
      bankName?: string | null;
      accountNumber?: string | null;
      legalName: string;
      excludeId?: string;
    },
  ): Promise<string[]> {
    const warnings: string[] = [];
    const cac = await tx.client.query<{ legal_name: string }>(
      `SELECT legal_name FROM vendors
        WHERE lower(btrim(cac_registration_number)) = lower(btrim($1))
          AND status <> 'BLACKLISTED'
          AND ($2::uuid IS NULL OR id <> $2)
        LIMIT 1`,
      [input.cac, input.excludeId ?? null],
    );
    if (cac.rows[0]) {
      throw new ConflictError(
        `A vendor with this CAC registration is already on the register (${cac.rows[0].legal_name}).`,
      );
    }
    if (input.bankName && input.accountNumber) {
      const bank = await tx.client.query<{ legal_name: string }>(
        `SELECT legal_name FROM vendors
          WHERE lower(btrim(bank_name)) = lower(btrim($1))
            AND btrim(account_number) = btrim($2)
            AND status <> 'BLACKLISTED'
            AND ($3::uuid IS NULL OR id <> $3)
          LIMIT 1`,
        [input.bankName, input.accountNumber, input.excludeId ?? null],
      );
      if (bank.rows[0]) {
        if (bank.rows[0].legal_name.trim().toLowerCase() === input.legalName.trim().toLowerCase()) {
          throw new ConflictError(
            `A vendor with this bank account is already on the register (${bank.rows[0].legal_name}).`,
          );
        }
        warnings.push(
          `This bank account is also recorded for ${bank.rows[0].legal_name}. The register still refuses the duplicate.`,
        );
      }
    }
    return warnings;
  }

  private async toView(tx: TxScope, row: VendorRow, _actor: ActorContext): Promise<VendorView> {
    const docs = await tx.client.query<{
      id: string;
      compliance_type: string;
      required: boolean;
      document_id: string;
      document_reference: string | null;
      title: string | null;
      expires_at: Date | null;
    }>(
      `SELECT c.id, c.compliance_type, c.required, c.document_id, c.expires_at,
              d.reference_number AS document_reference, d.title
         FROM vendor_compliance_documents c
         LEFT JOIN documents d ON d.id = c.document_id
        WHERE c.vendor_id = $1
        ORDER BY c.created_at`,
      [row.id],
    );
    const compliance: VendorComplianceItemView[] = docs.rows.map((doc) => {
      const expiresAt = doc.expires_at ? doc.expires_at.toISOString().slice(0, 10) : null;
      const expired = Boolean(doc.expires_at && doc.expires_at < new Date());
      return {
        id: doc.id,
        complianceType: doc.compliance_type,
        required: doc.required,
        documentId: doc.document_id,
        documentReference: doc.document_reference,
        title: doc.title ?? doc.compliance_type,
        expiresAt,
        expired,
      };
    });
    const present = new Set(compliance.map((item) => item.complianceType));
    const warnings: string[] = [];
    for (const type of REQUIRED_VENDOR_COMPLIANCE) {
      if (!present.has(type)) warnings.push(`${type.replaceAll('_', ' ')} is required before onboarding.`);
    }
    if (!row.bank_name || !row.account_name || !row.account_number) {
      warnings.push('Bank details are required before onboarding.');
    }
    if (row.compliance_expired) warnings.push('A required compliance document has expired.');
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      legalName: row.legal_name,
      cacRegistrationNumber: row.cac_registration_number,
      categoryId: row.category_id,
      categoryKey: row.category_key,
      categoryLabel: row.category_label,
      status: row.status,
      notes: row.notes,
      contacts: parseContacts(row.contacts),
      bank: bankView(row.bank_name, row.account_name, row.account_number),
      complianceExpired: row.compliance_expired,
      compliance,
      activatedAt: row.activated_at?.toISOString() ?? null,
      activatedBy: row.activated_by,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      rowVersion: row.row_version,
      entityId: row.entity_id,
      warnings,
    };
  }

  private async indexVendor(tx: TxScope, row: VendorRow): Promise<void> {
    await tx.indexSearch({
      recordType: 'VENDOR',
      recordId: row.id,
      referenceNumber: row.reference_number,
      title: row.legal_name,
      searchableText: `${row.legal_name} ${row.cac_registration_number} ${row.category_key} ${row.reference_number}`,
      entityId: row.entity_id,
      permissionKey: 'vendor.view',
    });
  }
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function hasBank(input: { bankName?: string | null; accountName?: string | null; accountNumber?: string | null }): boolean {
  return Boolean(emptyToNull(input.bankName) && emptyToNull(input.accountName) && emptyToNull(input.accountNumber));
}

function bankChanged(
  current: VendorRow,
  input: { bankName?: string | null; accountName?: string | null; accountNumber?: string | null },
): boolean {
  return (
    (current.bank_name ?? '') !== (emptyToNull(input.bankName) ?? '') ||
    (current.account_name ?? '') !== (emptyToNull(input.accountName) ?? '') ||
    (current.account_number ?? '') !== (emptyToNull(input.accountNumber) ?? '')
  );
}

function throwUnique(error: unknown): never {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === '23505' && pg.constraint === 'vendors_cac_active_key') {
    throw new ConflictError('A vendor with this CAC registration number is already on the register.');
  }
  if (pg.code === '23505' && pg.constraint === 'vendors_bank_active_key') {
    throw new ConflictError('A vendor with this bank account is already on the register.');
  }
  throw error;
}
