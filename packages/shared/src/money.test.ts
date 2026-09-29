import { describe, expect, it } from 'vitest';
import {
  addKobo,
  amountInWords,
  formatKobo,
  formatKoboPlain,
  integerToWords,
  kobo,
  koboFromDb,
  koboToDb,
  MoneyError,
  multiplyKoboByQuantity,
  parseNairaToKobo,
  splitKobo,
  subtractKobo,
} from './money';

describe('kobo arithmetic uses integers only', () => {
  it('parses Naira input into exact kobo', () => {
    expect(parseNairaToKobo('50,000,000.00')).toBe(5_000_000_000n);
    expect(parseNairaToKobo('1')).toBe(100n);
    expect(parseNairaToKobo('1.5')).toBe(150n);
    expect(parseNairaToKobo('0.01')).toBe(1n);
    expect(parseNairaToKobo('  \u20A64,750,000.25 ')).toBe(475_000_025n);
  });

  it('does not suffer the floating point addition error', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; in kobo it is exact.
    const total = addKobo(parseNairaToKobo('0.10'), parseNairaToKobo('0.20'));
    expect(total).toBe(30n);
    expect(formatKoboPlain(total)).toBe('0.30');
  });

  it('stays exact far beyond the safe float range', () => {
    // 1 quadrillion Naira is 1e17 kobo, well past Number.MAX_SAFE_INTEGER.
    const huge = parseNairaToKobo('1000000000000000.99');
    expect(huge).toBe(100_000_000_000_000_099n);
    expect(huge > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(formatKoboPlain(huge)).toBe('1,000,000,000,000,000.99');
  });

  it('rejects malformed and over-precise amounts', () => {
    expect(() => parseNairaToKobo('')).toThrow(MoneyError);
    expect(() => parseNairaToKobo('abc')).toThrow(MoneyError);
    expect(() => parseNairaToKobo('1.234')).toThrow(MoneyError);
    expect(() => parseNairaToKobo('1e6')).toThrow(MoneyError);
  });

  it('builds and splits kobo', () => {
    expect(kobo(50, 25)).toBe(5025n);
    expect(() => kobo(1, 100)).toThrow(MoneyError);
    expect(splitKobo(5025n)).toEqual({ negative: false, naira: 50n, kobo: 25n });
    expect(splitKobo(-5025n)).toEqual({ negative: true, naira: 50n, kobo: 25n });
  });

  it('adds, subtracts and multiplies by whole quantities', () => {
    expect(addKobo(100n, 250n, 1n)).toBe(351n);
    expect(subtractKobo(1000n, 250n)).toBe(750n);
    expect(multiplyKoboByQuantity(parseNairaToKobo('12500.50'), 1000)).toBe(1_250_050_000n);
    expect(() => multiplyKoboByQuantity(100n, 1.5)).toThrow(MoneyError);
    expect(() => multiplyKoboByQuantity(100n, -1)).toThrow(MoneyError);
  });

  it('round-trips through the database representation', () => {
    expect(koboToDb(5_000_000_000n)).toBe('5000000000');
    expect(koboFromDb('5000000000')).toBe(5_000_000_000n);
    expect(koboFromDb(null)).toBe(0n);
  });
});

describe('formatting', () => {
  it('renders the Naira symbol with thousands separators and two decimals', () => {
    expect(formatKobo(5_000_000_000n)).toBe('\u20A650,000,000.00');
    expect(formatKobo(0n)).toBe('\u20A60.00');
    expect(formatKobo(1n)).toBe('\u20A60.01');
    expect(formatKobo(-475_000_025n)).toBe('-\u20A64,750,000.25');
  });

  it('groups thousands correctly at every boundary', () => {
    expect(formatKoboPlain(100n)).toBe('1.00');
    expect(formatKoboPlain(100_000n)).toBe('1,000.00');
    expect(formatKoboPlain(100_000_000n)).toBe('1,000,000.00');
  });
});

describe('amount in words', () => {
  it('writes whole Naira amounts', () => {
    expect(amountInWords(0n)).toBe('Zero Naira Only');
    expect(amountInWords(parseNairaToKobo('50000000'))).toBe('Fifty Million Naira Only');
    expect(amountInWords(parseNairaToKobo('1'))).toBe('One Naira Only');
    expect(amountInWords(parseNairaToKobo('4500000'))).toBe(
      'Four Million, Five Hundred Thousand Naira Only',
    );
  });

  it('writes Naira with a kobo remainder', () => {
    expect(amountInWords(parseNairaToKobo('4500.50'))).toBe(
      'Four Thousand, Five Hundred Naira and Fifty Kobo Only',
    );
    expect(amountInWords(parseNairaToKobo('0.01'))).toBe('One Kobo Only');
  });

  it('uses "and" inside hundreds and hyphenates compound tens', () => {
    expect(integerToWords(123n)).toBe('One Hundred and Twenty-Three');
    expect(integerToWords(115n)).toBe('One Hundred and Fifteen');
    expect(integerToWords(100n)).toBe('One Hundred');
    expect(integerToWords(0n)).toBe('Zero');
    expect(integerToWords(1_000_000n)).toBe('One Million');
    expect(integerToWords(123_456_789n)).toBe(
      'One Hundred and Twenty-Three Million, Four Hundred and Fifty-Six Thousand, Seven Hundred and Eighty-Nine',
    );
  });

  it('marks negative amounts explicitly rather than dropping the sign', () => {
    expect(amountInWords(-100n)).toBe('Minus One Naira Only');
  });
});
