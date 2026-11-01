import { describe, expect, it } from 'vitest';
import { CATEGORY_HINTS, categoryKeyFor, foldText } from '../src/categoryHints.js';
import { ReceiptCategoryKey } from '../src/receipt.js';

/**
 * The words that point a piece of text at one of the five default categories, shared by the receipt
 * parser (OCR text) and quick add (a typed sentence). Hints are accent-free and lower-case, matched as
 * whole words, so a word that is also common elsewhere does not belong here.
 */

describe('foldText', () => {
  it('lower-cases and drops accents, one character for one, so positions still line up', () => {
    const text = 'Cà phê Đà Nẵng';
    expect(foldText(text)).toBe('ca phe da nang');
    expect(foldText(text)).toHaveLength(text.length);
  });

  it('leaves characters it cannot fold alone', () => {
    expect(foldText('₫ 45k $4.50')).toBe('₫ 45k $4.50');
  });
});

describe('CATEGORY_HINTS', () => {
  it('covers exactly the five receipt categories', () => {
    expect(Object.keys(CATEGORY_HINTS).sort()).toEqual([...ReceiptCategoryKey.options].sort());
  });

  it('is written folded, so matching never depends on how someone typed an accent', () => {
    for (const hints of Object.values(CATEGORY_HINTS)) {
      for (const hint of hints) expect(hint).toBe(foldText(hint));
    }
  });
});

describe('categoryKeyFor', () => {
  it.each([
    ['FRESH SUPERMARKET', 'groceries'],
    ['Cafe Nero', 'eating_out'],
    ['lunch', 'eating_out'],
    ['Uber trip', 'transport'],
    ['Pharmacy', 'health'],
    ['Internet bill', 'bills'],
    ['rent', 'bills'],
    ['Cà phê sữa', 'eating_out'],
    ['trà sữa', 'eating_out'],
    ['ăn trưa', 'eating_out'],
    ['đổ xăng', 'transport'],
    ['thuốc cảm', 'health'],
    ['tiền điện', 'bills'],
    ['tiền nhà', 'bills'],
    ['mua rau', 'groceries'],
  ])('reads %s as %s', (text, key) => {
    expect(categoryKeyFor(text)).toBe(key);
  });

  it.each([
    ['nothing in it', 'zxqv'],
    ['a web address, not a meal', 'www.shop.com'],
    ['a soft drink, not a water bill', 'nước ngọt'],
    ['the word for invoice on every receipt', 'HÓA ĐƠN BÁN HÀNG'],
    ['part of a longer word', 'barbecue sauce'],
  ])('says nothing for %s', (_name, text) => {
    expect(categoryKeyFor(text)).toBeNull();
  });

  it('goes to the more specific, earlier category on a tie', () => {
    expect(categoryKeyFor('market pharmacy')).toBe('groceries');
  });

  it('counts hints, so the category with the most evidence wins', () => {
    expect(categoryKeyFor('pharmacy clinic market')).toBe('health');
  });
});
