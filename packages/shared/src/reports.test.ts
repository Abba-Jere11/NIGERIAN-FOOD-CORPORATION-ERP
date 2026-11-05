import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_GRANTS } from './permissions';
import { visibleReportCategories } from './reports';

describe('the reports hub catalog', () => {
  it('hides every business category from the Administrator', () => {
    expect(visibleReportCategories(DEFAULT_ROLE_GRANTS.administrator)).toEqual([]);
  });

  it('lets a GM open procurement, finance and inventory', () => {
    const categories = visibleReportCategories(DEFAULT_ROLE_GRANTS.gm);
    expect(categories.map((row) => row.key)).toEqual(['procurement', 'finance', 'inventory']);
    expect(categories.find((row) => row.key === 'inventory')?.available).toBe(true);
  });

  it('shows inventory reports to the Procurement Manager', () => {
    const categories = visibleReportCategories(DEFAULT_ROLE_GRANTS.inventory_officer);
    expect(categories.map((row) => row.key)).toEqual(['inventory']);
    expect(categories[0]?.available).toBe(true);
  });

  it('lets the MD open procurement, finance and the inventory shell', () => {
    const keys = visibleReportCategories(DEFAULT_ROLE_GRANTS.md).map((row) => row.key);
    expect(keys).toEqual(['procurement', 'finance', 'inventory']);
  });
});
