/**
 * Money for the NFC Mini ERP.
 *
 * Convention A7: money is an integer number of kobo, represented as `bigint`.
 * Floating point is never used for money anywhere in this system - not for
 * storage, not for arithmetic, not for parsing user input. `parseFloat` and
 * `Number.parseFloat` are banned by lint rule for this reason.
 */

/** An integer number of kobo. 100 kobo = 1 Naira. */
export type Kobo = bigint;

export const KOBO_PER_NAIRA = 100n;
export const NAIRA_SYMBOL = '\u20A6';
export const DEFAULT_CURRENCY = 'NGN';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Builds kobo from whole Naira and a kobo remainder (0-99). */
export function kobo(naira: bigint | number, koboPart: bigint | number = 0n): Kobo {
  const n = BigInt(naira);
  const k = BigInt(koboPart);
  if (k < 0n || k >= KOBO_PER_NAIRA) {
    throw new MoneyError(`Kobo part must be between 0 and 99, received ${k}`);
  }
  return n < 0n ? n * KOBO_PER_NAIRA - k : n * KOBO_PER_NAIRA + k;
}

/**
 * Parses a human-entered amount in Naira into kobo by decimal string
 * manipulation. Accepts thousands separators and at most two decimal places.
 */
export function parseNairaToKobo(input: string): Kobo {
  const raw = input.trim().replace(/[\s,]/g, '').replace(NAIRA_SYMBOL, '');
  if (raw === '') throw new MoneyError('Amount is required');
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new MoneyError(
      `"${input}" is not a valid amount. Use digits with at most two decimal places, for example 50000000.00`,
    );
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.');
  const fraction = fractionPart.padEnd(2, '0');
  const magnitude = BigInt(wholePart) * KOBO_PER_NAIRA + BigInt(fraction);
  return negative ? -magnitude : magnitude;
}

/** Splits kobo into its sign, whole Naira and kobo remainder. */
export function splitKobo(amount: Kobo): { negative: boolean; naira: bigint; kobo: bigint } {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  return {
    negative,
    naira: magnitude / KOBO_PER_NAIRA,
    kobo: magnitude % KOBO_PER_NAIRA,
  };
}

function groupDigits(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

function groupThousands(value: bigint): string {
  return groupDigits(value.toString());
}

/**
 * Re-formats a money input while the user types: thousands are grouped
 * (`1000000` → `1,000,000`), at most two decimal places are kept, and anything
 * that is not a digit, the first decimal point or a leading minus is dropped.
 * `caret` is the cursor position in `input`; the returned caret sits after the
 * same digit in the formatted text, so typing in the middle of a number works.
 */
export function formatNairaTyping(input: string, caret: number = input.length): { text: string; caret: number } {
  const negative = input.trimStart().startsWith('-');
  let whole = '';
  let fraction = '';
  let seenPoint = false;
  let wholeBeforeCaret = 0;
  let fractionBeforeCaret = 0;
  let pointBeforeCaret = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    const beforeCaret = i < caret;
    if (ch >= '0' && ch <= '9') {
      if (seenPoint) {
        if (fraction.length < 2) {
          fraction += ch;
          if (beforeCaret) fractionBeforeCaret += 1;
        }
      } else {
        whole += ch;
        if (beforeCaret) wholeBeforeCaret += 1;
      }
    } else if (ch === '.' && !seenPoint) {
      seenPoint = true;
      if (beforeCaret) pointBeforeCaret = true;
    }
  }

  const stripped = whole.replace(/^0+(?=\d)/, '');
  wholeBeforeCaret = Math.max(0, wholeBeforeCaret - (whole.length - stripped.length));
  const wholeText = stripped === '' && seenPoint ? '0' : stripped;
  if (stripped === '' && seenPoint && pointBeforeCaret) wholeBeforeCaret = 1;
  const grouped = groupDigits(wholeText);
  const sign = negative ? '-' : '';
  const text = `${sign}${grouped}${seenPoint ? `.${fraction}` : ''}`;

  if (pointBeforeCaret) {
    return { text, caret: sign.length + grouped.length + 1 + fractionBeforeCaret };
  }
  let position = 0;
  let digits = 0;
  while (position < grouped.length && digits < wholeBeforeCaret) {
    if (grouped.charAt(position) !== ',') digits += 1;
    position += 1;
  }
  return { text, caret: sign.length + position };
}

/** Formats kobo without a currency symbol, e.g. `50,000,000.00`. */
export function formatKoboPlain(amount: Kobo): string {
  const { negative, naira, kobo: koboPart } = splitKobo(amount);
  const body = `${groupThousands(naira)}.${koboPart.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Formats stored kobo for a money input. Whole Naira stay whole
 * (`50000000` → `500,000`); a decimal appears only when there is a kobo remainder.
 */
export function formatNairaInputFromKobo(amount: Kobo): string {
  const { negative, naira, kobo: koboPart } = splitKobo(amount);
  const whole = groupThousands(naira);
  const body = koboPart === 0n ? whole : `${whole}.${koboPart.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Formats kobo for display, e.g. `₦50,000,000.00`. */
export function formatKobo(amount: Kobo): string {
  const { negative } = splitKobo(amount);
  const body = `${NAIRA_SYMBOL}${formatKoboPlain(negative ? -amount : amount)}`;
  return negative ? `-${body}` : body;
}

export function addKobo(...amounts: Kobo[]): Kobo {
  return amounts.reduce<Kobo>((total, amount) => total + amount, 0n);
}

export function subtractKobo(from: Kobo, amount: Kobo): Kobo {
  return from - amount;
}

/**
 * Multiplies a unit price by an integer quantity. Quantities that are not
 * whole numbers are rejected rather than silently rounded, because a
 * procurement total must be exactly reproducible on the server (rule M6.4).
 */
export function multiplyKoboByQuantity(unitPrice: Kobo, quantity: bigint | number): Kobo {
  if (typeof quantity === 'number' && !Number.isInteger(quantity)) {
    throw new MoneyError(`Quantity must be a whole number, received ${quantity}`);
  }
  const q = BigInt(quantity);
  if (q < 0n) throw new MoneyError(`Quantity cannot be negative, received ${quantity}`);
  return unitPrice * q;
}

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

const SCALES = [
  '',
  'Thousand',
  'Million',
  'Billion',
  'Trillion',
  'Quadrillion',
  'Quintillion',
] as const;

function belowHundredToWords(value: number): string {
  if (value < 20) return ONES[value] as string;
  const tens = TENS[Math.floor(value / 10)] as string;
  const ones = value % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones] as string}`;
}

function belowThousandToWords(value: number): string {
  if (value < 100) return belowHundredToWords(value);
  const hundreds = `${ONES[Math.floor(value / 100)] as string} Hundred`;
  const remainder = value % 100;
  return remainder === 0 ? hundreds : `${hundreds} and ${belowHundredToWords(remainder)}`;
}

/** Converts a non-negative integer to English words. */
export function integerToWords(value: bigint): string {
  if (value < 0n) throw new MoneyError('integerToWords expects a non-negative value');
  if (value === 0n) return 'Zero';

  const groups: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    groups.push(Number(remaining % 1000n));
    remaining /= 1000n;
  }
  if (groups.length > SCALES.length) {
    throw new MoneyError('Amount is too large to express in words');
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i] as number;
    if (group === 0) continue;
    const scale = SCALES[i] as string;
    parts.push(
      scale === '' ? belowThousandToWords(group) : `${belowThousandToWords(group)} ${scale}`,
    );
  }
  return parts.join(', ');
}

/**
 * Renders an amount in words for memos and payment documents, e.g.
 * `Fifty Million Naira Only` or `Four Thousand, Five Hundred Naira and Fifty Kobo Only`.
 */
export function amountInWords(amount: Kobo): string {
  const { negative, naira, kobo: koboPart } = splitKobo(amount);
  const segments: string[] = [];

  if (naira > 0n || koboPart === 0n) {
    segments.push(`${integerToWords(naira)} Naira`);
  }
  if (koboPart > 0n) {
    segments.push(`${integerToWords(koboPart)} Kobo`);
  }

  const body = `${segments.join(' and ')} Only`;
  return negative ? `Minus ${body}` : body;
}

/** Converts a database `bigint`/numeric text column into kobo. */
export function koboFromDb(value: string | number | bigint | null | undefined): Kobo {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

/** Converts kobo to the string form node-postgres writes to a bigint column. */
export function koboToDb(amount: Kobo): string {
  return amount.toString();
}
